#!/usr/bin/env bash
# 2026 공모전 파이프라인 배포(처음 만들기 + 다시 올리기 겸용). 2025 스택은 건드리지 않는다.
# 새 리소스는 NovelFlow 이름을 쓴다(사용자 결정 2026-10-01). 기존 np-trend/NpTrend 리소스(역할 등)는 그대로 둔다.
# 자정 수집은 Distributed Map 판(NovelFlowContest2026DMapWorkflow) 하나다. SQS 판(작업·결과 큐 + 완료 폴링)은 2026-10-04 에 걷어냈다.
#   bash contests/2026/deploy.sh                 # infra + code + orchestration (스케줄은 따로)
#   bash contests/2026/deploy.sh infra           # S3 버킷·DynamoDB 테이블·ECR
#   bash contests/2026/deploy.sh code            # Lambda 코드·이미지만 다시 올리기(수집기·날짜/시도 시작·파서/원본 재계산·적재)
#   bash contests/2026/deploy.sh orchestration   # 상태 머신 + 상태 머신 역할 정책 + 실패 알림 규칙 (dmap 은 같은 뜻의 옛 이름)
# 순서: code → orchestration. 상태 머신의 StartAttempt(날짜 함수 action=attempt_start)·ReprocessIndex/ReprocessMap(파서의 원본 재계산)은
# 새 코드에만 있다 — 옛 코드에 새 상태 머신을 올리면 마감 확인 없이 돌고 원본 재계산은 실패한다. 새 코드는 옛 상태 머신과도 맞는다.
#   bash contests/2026/deploy.sh schedule        # 자정 수집·준비 실행 스케줄 + 수집기 알람
#   bash contests/2026/deploy.sh alarm           # 수집기 오류 알람만
# 계정 ID 는 실행 시 조회한다(공개 리포라 박지 않는다).
#
# 버전: 배포한 변경을 main 에 합칠 때 `contest2026-vX.Y.Z` git 태그를 건다(데일리 `crawler-vX.Y.Z` 와 같은 규칙).
# ECR 은 최신 이미지만 남기는 운영이라(비용) 되돌리기는 태그에서 다시 배포하는 것이다. `code` 는 그 버전을
# (git describe — 태그 뒤 커밋이 있으면 `-N-g<sha>`, 커밋 안 한 변경이 있으면 `-dirty`) 파서 이미지 태그와
# 2026 Lambda 4개의 설명(description)에 남긴다 — 콘솔에서 지금 무엇이 배포돼 있는지 보인다.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(git describe --tags --match 'contest2026-v*' --dirty --always 2>/dev/null || echo unknown)
DESC="NovelFlow contest 2026 $VERSION"

R=ap-northeast-2
ACC=$(aws sts get-caller-identity --query Account --output text)
Y=2026
BUCKET=novelflow-contest-$Y-$ACC
TABLE=NovelFlowContest$Y
ECR_REPO=novelflow/contest-$Y
LAMBDA_ROLE=arn:aws:iam::$ACC:role/NpTrendCrawlerLambdaExecutionRole
SFN_ROLE_NAME=NpTrendCrawlerStepFunctionExecutionRole
SM_NAME=NovelFlowContest${Y}DMapWorkflow
SCHED_NAME=NovelFlowContest${Y}Daily
SCHED_ROLE_NAME=Amazon_EventBridge_Scheduler_SFN_376ddf2108
SCHED_POLICY_ARN=arn:aws:iam::$ACC:policy/service-role/Amazon-EventBridge-Scheduler-Execution-Policy-9ebb732f-2dab-4fbf-b8d1-533947056425
RAW_BUCKET=$(aws lambda get-function-configuration --region $R --function-name np-trend-crawler-get-novel-data --query 'Environment.Variables.RAW_HTML_BUCKET' --output text)
F_COLLECTOR=novelflow-contest-$Y-id-collector
# 이름은 SQS 판 시절 그대로다 — 배포된 상태 머신(ResolveDate)이 이 함수를 부른다. 이제 기록 날짜만 정하고 큐에는 보내지 않는다.
F_FANOUT=novelflow-contest-$Y-fanout
F_PARSER=novelflow-contest-$Y-parser-dmap
F_CONSOLIDATE=novelflow-contest-$Y-consolidate-dmap
SM_ARN=arn:aws:states:$R:$ACC:stateMachine:$SM_NAME
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
exists() { "$@" >/dev/null 2>&1; }

infra() {
  echo "== S3 $BUCKET"
  exists aws s3api head-bucket --bucket $BUCKET || aws s3api create-bucket --bucket $BUCKET --region $R \
    --create-bucket-configuration LocationConstraint=$R >/dev/null
  aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-versioning --bucket $BUCKET --versioning-configuration Status=Enabled

  echo "== DynamoDB $TABLE (PITR·삭제 방지 — 백로그 #9)"
  if ! exists aws dynamodb describe-table --region $R --table-name $TABLE; then
    aws dynamodb create-table --region $R --table-name $TABLE --billing-mode PAY_PER_REQUEST \
      --attribute-definitions AttributeName=ID,AttributeType=S AttributeName=Date,AttributeType=S AttributeName=View,AttributeType=N \
      --key-schema AttributeName=ID,KeyType=HASH AttributeName=Date,KeyType=RANGE \
      --global-secondary-indexes 'IndexName=DateViewIndex,KeySchema=[{AttributeName=Date,KeyType=HASH},{AttributeName=View,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      --deletion-protection-enabled >/dev/null
    aws dynamodb wait table-exists --region $R --table-name $TABLE
  fi
  aws dynamodb update-continuous-backups --region $R --table-name $TABLE \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null

  echo "== ECR $ECR_REPO"
  exists aws ecr describe-repositories --region $R --repository-names $ECR_REPO || \
    aws ecr create-repository --region $R --repository-name $ECR_REPO >/dev/null
}


code() {
  echo "== 수집기 zip (requests·bs4 동봉)"
  mkdir -p "$BUILD/col"
  pip install -q --target "$BUILD/col" --platform manylinux2014_x86_64 --python-version 3.13 --only-binary=:all: \
    -r contest_id_collector/requirements.txt
  cp contest_id_collector/app.py "$BUILD/col/"
  (cd "$BUILD/col" && zip -qr "$BUILD/collector.zip" .)
  zip -qj "$BUILD/fanout.zip" contest_detail_parser/app.py
  zip -qj "$BUILD/consolidate.zip" contest_detail_parser/consolidate_contest_data.py

  echo "== 파서 이미지 ($VERSION)"
  case "$VERSION" in *-dirty|unknown) echo "   ⚠ 커밋되지 않은 변경(또는 버전 모름)으로 배포합니다 — 이 배포는 git 에서 다시 만들 수 없습니다." ;; esac
  aws ecr get-login-password --region $R | docker login --username AWS --password-stdin $ACC.dkr.ecr.$R.amazonaws.com >/dev/null
  IMG=$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO:latest
  docker build --platform linux/amd64 --provenance=false -q -t "$IMG" contest_detail_parser >/dev/null
  docker push -q "$IMG" >/dev/null
  # 같은 이미지에 버전 태그도 단다(추가 저장 비용 없음 — 같은 다이제스트). 'latest' 만으로는 어느 커밋인지 모른다.
  docker tag "$IMG" "$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO:$VERSION"
  docker push -q "$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO:$VERSION" >/dev/null
  DIGEST=$(aws ecr describe-images --region $R --repository-name $ECR_REPO --image-ids imageTag=latest --query 'imageDetails[0].imageDigest' --output text)

  upsert_zip $F_COLLECTOR "$BUILD/collector.zip" app.handler 900 256 \
    "Variables={S3_BUCKET_NAME=$BUCKET,CONTEST_YEAR=$Y,START_ID=455000,CONTEST_FIRST_ID=455325}"
  # 23:30 준비 실행은 스케줄러의 비동기 호출이다. Lambda 기본 재시도(2번)가 시간 초과 뒤 자정 실행과 겹치면 같은 상태
  # 파일을 둘이 쓰므로 재시도를 끈다 — 실패한 준비 실행은 다음 날 다시 돈다(자정 수집은 무관).
  aws lambda put-function-event-invoke-config --region $R --function-name $F_COLLECTOR --maximum-retry-attempts 0 >/dev/null
  # 날짜 함수(ResolveDate·StartAttempt)는 환경 변수가 필요 없다 — 수집기 재호출 마감(DISCOVERY_RECALL_MINUTES=12)·받기 마감
  # (REFETCH_GRACE_MINUTES=60, 자정 + 1시간)은 코드 기본값이고, 시도 표지를 쓸 상태 버킷은 상태 머신이 넘긴다(S3 권한은 Lambda 역할).
  upsert_zip $F_FANOUT "$BUILD/fanout.zip" app.get_id_list_from_s3 120 256 '{"Variables":{}}'

  # 파서 Lambda 는 원본 재계산(reprocess)도 맡는다 — action=reprocess_index·BatchInput.reprocess 로 갈린다(같은 이미지·같은 해석 코드).
  echo "== 파서(DMap 묶음 + 원본 재계산) $F_PARSER"
  PENV="Variables={RAW_HTML_BUCKET=$RAW_BUCKET,RAW_HTML_PREFIX=contest,CONTEST_YEAR=$Y}"
  if exists aws lambda get-function --region $R --function-name $F_PARSER; then
    aws lambda update-function-code --region $R --function-name $F_PARSER --image-uri "$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO@$DIGEST" >/dev/null
    aws lambda wait function-updated --region $R --function-name $F_PARSER
    # EXPRESS 자식은 5분이 한도다 — 파서가 그보다 오래 살면 Step Functions 가 끊은 뒤에도 Lambda 가 계속 돈다(리뷰 #36).
    # 파서는 시간 예산(남은 작품은 failed 로 돌려 재시도 라운드가 받는다) 안에서 끝나고, Lambda 는 290초에서 끊는다.
    aws lambda update-function-configuration --region $R --function-name $F_PARSER --timeout 290 --memory-size 512 \
      --image-config 'Command=["parser.parse_dmap_batch"]' --environment "$PENV" --description "$DESC" >/dev/null
    aws lambda wait function-updated --region $R --function-name $F_PARSER
  else
    aws lambda create-function --region $R --function-name $F_PARSER --package-type Image \
      --code ImageUri="$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO@$DIGEST" --role $LAMBDA_ROLE \
      --image-config 'Command=["parser.parse_dmap_batch"]' --timeout 290 --memory-size 512 --environment "$PENV" --description "$DESC" >/dev/null
    aws lambda wait function-active --region $R --function-name $F_PARSER
  fi

  # 대조(action: reconcile)와 최종 적재를 한 함수가 한다.
  upsert_zip $F_CONSOLIDATE "$BUILD/consolidate.zip" consolidate_contest_data.handler_dmap 600 512 \
    "Variables={DYNAMODB_TABLE_NAME=$TABLE,STATE_BUCKET=$BUCKET}"
}

upsert_zip() {  # name zip handler timeout memory env
  if exists aws lambda get-function --region $R --function-name $1; then
    aws lambda update-function-code --region $R --function-name $1 --zip-file "fileb://$2" >/dev/null
    aws lambda wait function-updated --region $R --function-name $1
    aws lambda update-function-configuration --region $R --function-name $1 --handler $3 --timeout $4 --memory-size $5 --environment "$6" \
      --description "$DESC" >/dev/null
  else
    aws lambda create-function --region $R --function-name $1 --runtime python3.13 --role $LAMBDA_ROLE \
      --handler $3 --timeout $4 --memory-size $5 --environment "$6" --description "$DESC" --zip-file "fileb://$2" >/dev/null
  fi
  aws lambda wait function-updated --region $R --function-name $1 2>/dev/null || aws lambda wait function-active --region $R --function-name $1
}

failure_rule() {
  echo "== 실패 알림 규칙에 2026 상태 머신 추가"
  # put-rule 은 패턴을 통째로 바꾼다 — 데일리·2025 공모전 상태 머신을 함께 적는다.
  aws events put-rule --region $R --name novelflow-pipeline-failure --event-pattern "{
    \"source\":[\"aws.states\"],\"detail-type\":[\"Step Functions Execution Status Change\"],
    \"detail\":{\"status\":[\"FAILED\",\"TIMED_OUT\",\"ABORTED\"],\"stateMachineArn\":[
      \"arn:aws:states:$R:$ACC:stateMachine:NpTrendCrawlerWorkflow\",
      \"arn:aws:states:$R:$ACC:stateMachine:NpTrendContestDataPipelineMainWorkflow\",\"$SM_ARN\"]}}" >/dev/null
}

orchestration() {
  # 상태 머신 역할의 큐 purge 정책은 통째로 덮어쓴다 — 2026 큐(SQS 판)를 빼고 데일리·2025 큐만 남긴다.
  # 2026 DMap 판은 큐를 쓰지 않지만, 데일리·2025 상태 머신이 쓰는 이 공유 정책의 정의가 리포에서 여기뿐이라 남긴다.
  echo "== 상태 머신 역할: 큐 purge 권한(데일리·2025 큐만)"
  aws iam put-role-policy --role-name $SFN_ROLE_NAME --policy-name PurgePipelineQueues --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sqs:PurgeQueue\",\"Resource\":[
      \"arn:aws:sqs:$R:$ACC:np-trend-crawler-queue\",
      \"arn:aws:sqs:$R:$ACC:np-trend-contest-task-queue-2025\",\"arn:aws:sqs:$R:$ACC:np-trend-contest-result-queue-2025\"]}]}"

  # 이 정책은 시도 실패 기록(RecordAttemptError, aws-sdk:s3:putObject → runs/{date}/{exec}/attempt-errors/)에도 쓰인다.
  echo "== 상태 머신 역할: 2026 버킷 읽기·쓰기(ItemReader·ResultWriter·시도 실패 기록)"
  aws iam put-role-policy --role-name $SFN_ROLE_NAME --policy-name NovelFlowContest${Y}DMapS3 --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:ListMultipartUploadParts\",\"s3:AbortMultipartUpload\"],
      \"Resource\":\"arn:aws:s3:::$BUCKET/*\"},{\"Effect\":\"Allow\",\"Action\":\"s3:ListBucket\",\"Resource\":\"arn:aws:s3:::$BUCKET\"}]}"

  # 원본 재계산(reprocess)의 ReprocessMap 은 ItemReader(s3:listObjectsV2)로 그 날짜 원본 묶음 목록을 읽는다. 묶음 내용은 파서
  # Lambda 가 읽는다(Lambda 역할). GetObject 는 목록 단계에 필요 없지만 같은 접두어 읽기로 함께 둔다. 2026 공모전 접두어로만 묶는다.
  echo "== 상태 머신 역할: 원본 버킷 2026 공모전 접두어 목록·읽기(원본 재계산)"
  aws iam put-role-policy --role-name $SFN_ROLE_NAME --policy-name NovelFlowContest${Y}RawRead --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:ListBucket\",\"Resource\":\"arn:aws:s3:::$RAW_BUCKET\",
      \"Condition\":{\"StringLike\":{\"s3:prefix\":[\"contest/$Y/*\"]}}},
      {\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$RAW_BUCKET/contest/$Y/*\"}]}"

  echo "== 상태 머신 역할: 날짜 잠금(RUN_LOCK#{date}) 쓰기 — 예약 중복 전달 방지"
  aws iam put-role-policy --role-name $SFN_ROLE_NAME --policy-name NovelFlowContest${Y}RunLock --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"dynamodb:PutItem\",
      \"Resource\":\"arn:aws:dynamodb:$R:$ACC:table/$TABLE\"}]}"

  echo "== 상태 머신 $SM_NAME"
  DEF=$(sed "s/YOUR_AWS_REGION/$R/g; s/YOUR_AWS_ACCOUNT_ID/$ACC/g" contest_detail_parser/NovelFlowContest2026DMapWorkflow.json)
  if exists aws stepfunctions describe-state-machine --region $R --state-machine-arn $SM_ARN; then
    aws stepfunctions update-state-machine --region $R --state-machine-arn $SM_ARN --definition "$DEF" >/dev/null
  else
    aws stepfunctions create-state-machine --region $R --name $SM_NAME --type STANDARD \
      --role-arn arn:aws:iam::$ACC:role/$SFN_ROLE_NAME --definition "$DEF" >/dev/null
  fi

  failure_rule
}

schedule() {
  echo "== 스케줄러 역할에 2026 상태 머신 실행 권한(정책 새 버전)"
  OLD=$(aws iam list-policy-versions --policy-arn $SCHED_POLICY_ARN --query 'Versions[?!IsDefaultVersion].VersionId' --output text)
  for v in $OLD; do aws iam delete-policy-version --policy-arn $SCHED_POLICY_ARN --version-id $v; done
  aws iam create-policy-version --policy-arn $SCHED_POLICY_ARN --set-as-default --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"states:StartExecution\"],\"Resource\":[
      \"arn:aws:states:$R:$ACC:stateMachine:NpTrendContestDataPipelineMainWorkflow\",\"$SM_ARN\"]},
      {\"Effect\":\"Allow\",\"Action\":[\"lambda:InvokeFunction\"],\"Resource\":[\"arn:aws:lambda:$R:$ACC:function:$F_COLLECTOR\"]}]}" >/dev/null

  # 시작 요청이 실패해도 1시간 안에서만 다시 보낸다 — 그보다 늦은 시작은 자정 값이 아니다(실행도 거절하지만 애초에 보내지 않는다).
  echo "== 스케줄 $SCHED_NAME (매일 00:00 KST → $SM_NAME)"
  ARGS=(--region $R --name $SCHED_NAME --schedule-expression "cron(0 0 * * ? *)" --schedule-expression-timezone Asia/Seoul
        --flexible-time-window Mode=OFF
        --target "Arn=$SM_ARN,RoleArn=arn:aws:iam::$ACC:role/service-role/$SCHED_ROLE_NAME,RetryPolicy={MaximumEventAgeInSeconds=3600,MaximumRetryAttempts=185}")
  if exists aws scheduler get-schedule --region $R --name $SCHED_NAME; then aws scheduler update-schedule "${ARGS[@]}" >/dev/null
  else aws scheduler create-schedule "${ARGS[@]}" >/dev/null; fi

  # 준비 실행(11:30·23:30): 오래 걸리는 훑기·재확인·작가 받기를 자정 전에 나눠 해 두고, 자정 경로는 짧게 둔다(DECISIONS 2026-10-02·10-03).
  # 실행 ID 는 날마다 달라야 한다(재확인의 '이번 실행에서 본 번호' 판정) — 스케줄러가 예약 시각을 넣어 준다.
  echo "== 스케줄 ${SCHED_NAME%Daily}Prep (매일 11:30·23:30 KST, 수집기 직접 호출)"
  PARGS=(--region $R --name ${SCHED_NAME%Daily}Prep --schedule-expression "cron(30 11,23 * * ? *)" --schedule-expression-timezone Asia/Seoul
         --flexible-time-window Mode=OFF
         --target "{\"Arn\":\"arn:aws:lambda:$R:$ACC:function:$F_COLLECTOR\",\"RoleArn\":\"arn:aws:iam::$ACC:role/service-role/$SCHED_ROLE_NAME\",\"Input\":\"{\\\"mode\\\":\\\"prep\\\",\\\"execution_id\\\":\\\"prep-<aws.scheduler.scheduled-time>\\\"}\",\"RetryPolicy\":{\"MaximumRetryAttempts\":0}}")
  if exists aws scheduler get-schedule --region $R --name ${SCHED_NAME%Daily}Prep; then aws scheduler update-schedule "${PARGS[@]}" >/dev/null
  else aws scheduler create-schedule "${PARGS[@]}" >/dev/null; fi

  collector_alarm
}

collector_alarm() {
  # 준비 실행은 스케줄러가 수집기를 직접 부른다 — 상태 머신 밖이라 실패 알림 규칙·성공 부재 알람이 못 본다. 재확인·작가 받기는
  # 이제 준비 실행에만 있어서 조용히 계속 실패하면 공개로 돌린 참가작을 놓친다. 수집기 Errors(예외·15분 초과, 자정 호출 포함)를
  # 알람으로 걸고 기존 알림 경로(이메일 = 알람 액션, Discord = 규칙 novelflow-alarm-state)에 잇는다. 웹훅은 알림 Lambda 에만 있다.
  ALARM=novelflow-contest-$Y-collector-errors
  TOPIC=arn:aws:sns:$R:$ACC:np-trend-crawler-failure-notifications
  echo "== 알람 $ALARM (수집기 오류 → 이메일 + Discord)"
  aws cloudwatch put-metric-alarm --region $R --alarm-name $ALARM \
    --alarm-description "2026 공모전 ID 수집기(준비 실행 11:30·23:30 / 자정) Lambda 오류 — 로그 /aws/lambda/$F_COLLECTOR" \
    --namespace AWS/Lambda --metric-name Errors --dimensions Name=FunctionName,Value=$F_COLLECTOR \
    --statistic Sum --period 3600 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching --alarm-actions $TOPIC
  # 성공 부재: 자정 예약이 아예 시작되지 않은 날(스케줄 비활성·시작 실패)은 실패 이벤트가 없어 실패 알림 규칙이 못 본다.
  # 데일리·2025 의 *-no-success-26h 와 같은 설정(1시간 × 26 연속 성공 0, 데이터 없음 = 위반). 실행이 하루 한 번이라 26시간이면
  # 하루를 놓친 뒤 2시간 안에 울린다. 시험 실행의 SUCCEEDED 도 성공으로 센다(그날 시험을 돌리면 늦게 울린다).
  NOSUCCESS=novelflow-contest-$Y-no-success-26h
  echo "== 알람 $NOSUCCESS (자정 수집 26시간 성공 없음 → 이메일 + Discord)"
  aws cloudwatch put-metric-alarm --region $R --alarm-name $NOSUCCESS \
    --alarm-description "2026 공모전 자정 수집($SM_NAME)이 26시간 동안 한 번도 성공하지 않음(스케줄 미실행 포함)" \
    --namespace AWS/States --metric-name ExecutionsSucceeded --dimensions Name=StateMachineArn,Value=$SM_ARN \
    --statistic Sum --period 3600 --evaluation-periods 26 --datapoints-to-alarm 26 --threshold 1 \
    --comparison-operator LessThanThreshold --treat-missing-data breaching --alarm-actions $TOPIC --ok-actions $TOPIC
  # put-rule 은 패턴을 통째로 바꾼다 — 다른 알람(OPERATIONS 「실패 알림」, 데일리 적재 오류 포함)을 함께 적는다.
  aws events put-rule --region $R --name novelflow-alarm-state \
    --description "NovelFlow 알람 상태 변경 → Discord (ALARM 은 멘션)" --event-pattern "{
    \"source\":[\"aws.cloudwatch\"],\"detail-type\":[\"CloudWatch Alarm State Change\"],\"resources\":[
      \"arn:aws:cloudwatch:$R:$ACC:alarm:novelflow-daily-no-success-26h\",
      \"arn:aws:cloudwatch:$R:$ACC:alarm:novelflow-contest-no-success-26h\",
      \"arn:aws:cloudwatch:$R:$ACC:alarm:np-trend-crawler-dlq-alarm\",
      \"arn:aws:cloudwatch:$R:$ACC:alarm:novelflow-daily-ingestion-errors\",
      \"arn:aws:cloudwatch:$R:$ACC:alarm:$NOSUCCESS\",
      \"arn:aws:cloudwatch:$R:$ACC:alarm:$ALARM\"]}" >/dev/null
}

case "${1:-all}" in
  infra) infra ;;
  code) code ;;
  orchestration|dmap) orchestration ;;   # dmap: SQS 판과 나란히 있던 시절의 옛 이름(문서 호환)
  schedule) schedule ;;
  alarm) collector_alarm ;;
  all) infra; code; orchestration ;;   # 스케줄은 시험 실행이 통과한 뒤 따로 켠다
  *) echo "usage: $0 [all|infra|code|orchestration|dmap|schedule|alarm]"; exit 1 ;;
esac
echo "done: ${1:-all} ($VERSION)"
