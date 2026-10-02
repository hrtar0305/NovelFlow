#!/usr/bin/env bash
# 2026 공모전 파이프라인 배포(처음 만들기 + 다시 올리기 겸용). 2025 스택은 건드리지 않는다.
# 새 리소스는 NovelFlow 이름을 쓴다(사용자 결정 2026-10-01). 기존 np-trend/NpTrend 리소스(역할 등)는 그대로 둔다.
#   bash contests/2026/deploy.sh            # 전부
#   bash contests/2026/deploy.sh code       # Lambda 코드·이미지만 다시 올리기
# 계정 ID 는 실행 시 조회한다(공개 리포라 박지 않는다).
set -euo pipefail
cd "$(dirname "$0")"

R=ap-northeast-2
ACC=$(aws sts get-caller-identity --query Account --output text)
Y=2026
BUCKET=novelflow-contest-$Y-$ACC
TABLE=NovelFlowContest$Y
TASK_Q=novelflow-contest-$Y-task
RESULT_Q=novelflow-contest-$Y-result
ECR_REPO=novelflow/contest-$Y
LAMBDA_ROLE=arn:aws:iam::$ACC:role/NpTrendCrawlerLambdaExecutionRole
SFN_ROLE_NAME=NpTrendCrawlerStepFunctionExecutionRole
SM_NAME=NovelFlowContest${Y}Workflow
SCHED_NAME=NovelFlowContest${Y}Daily
SCHED_ROLE_NAME=Amazon_EventBridge_Scheduler_SFN_376ddf2108
SCHED_POLICY_ARN=arn:aws:iam::$ACC:policy/service-role/Amazon-EventBridge-Scheduler-Execution-Policy-9ebb732f-2dab-4fbf-b8d1-533947056425
RAW_BUCKET=$(aws lambda get-function-configuration --region $R --function-name np-trend-crawler-get-novel-data --query 'Environment.Variables.RAW_HTML_BUCKET' --output text)
F_COLLECTOR=novelflow-contest-$Y-id-collector
F_FANOUT=novelflow-contest-$Y-fanout
F_PARSER=novelflow-contest-$Y-parser
F_CHECK=novelflow-contest-$Y-check-completion
F_CONSOLIDATE=novelflow-contest-$Y-consolidate
TASK_URL=https://sqs.$R.amazonaws.com/$ACC/$TASK_Q
RESULT_URL=https://sqs.$R.amazonaws.com/$ACC/$RESULT_Q
SM_ARN=arn:aws:states:$R:$ACC:stateMachine:$SM_NAME
DSM_ARN=arn:aws:states:$R:$ACC:stateMachine:${SM_NAME%Workflow}DMapWorkflow
# 자정 스케줄이 부르는 판: dmap(기본, 2026-10-02 전환) | sqs(되돌릴 때 — `PIPELINE=sqs bash deploy.sh schedule`)
PIPELINE=${PIPELINE:-dmap}
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

  echo "== SQS"
  # 작업 큐 가시성 = 파서 제한(600초) + 여유. 결과 큐는 2025 와 같다.
  aws sqs create-queue --region $R --queue-name $TASK_Q --attributes VisibilityTimeout=960,MessageRetentionPeriod=345600 >/dev/null
  aws sqs create-queue --region $R --queue-name $RESULT_Q --attributes VisibilityTimeout=90,MessageRetentionPeriod=345600 >/dev/null

  echo "== ECR $ECR_REPO"
  exists aws ecr describe-repositories --region $R --repository-names $ECR_REPO || \
    aws ecr create-repository --region $R --repository-name $ECR_REPO >/dev/null
}


code() {
  echo "== 수집기 zip (requests·bs4 동봉)"
  mkdir -p "$BUILD/col"
  pip install -q --target "$BUILD/col" --platform manylinux2014_x86_64 --python-version 3.13 --only-binary=:all: \
    requests==2.32.4 beautifulsoup4==4.13.4
  cp contest_id_collector/app.py "$BUILD/col/"
  (cd "$BUILD/col" && zip -qr "$BUILD/collector.zip" .)
  zip -qj "$BUILD/fanout.zip" contest_detail_parser/app.py
  zip -qj "$BUILD/check.zip" contest_detail_parser/check_completion.py
  zip -qj "$BUILD/consolidate.zip" contest_detail_parser/consolidate_contest_data.py

  echo "== 파서 이미지"
  aws ecr get-login-password --region $R | docker login --username AWS --password-stdin $ACC.dkr.ecr.$R.amazonaws.com >/dev/null
  IMG=$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO:latest
  docker build --platform linux/amd64 --provenance=false -q -t "$IMG" contest_detail_parser >/dev/null
  docker push -q "$IMG" >/dev/null
  DIGEST=$(aws ecr describe-images --region $R --repository-name $ECR_REPO --image-ids imageTag=latest --query 'imageDetails[0].imageDigest' --output text)

  upsert_zip $F_COLLECTOR "$BUILD/collector.zip" app.handler 900 256 \
    "Variables={S3_BUCKET_NAME=$BUCKET,CONTEST_YEAR=$Y,START_ID=455000,CONTEST_FIRST_ID=455325}"
  # 23:30 준비 실행은 스케줄러의 비동기 호출이다. Lambda 기본 재시도(2번)가 시간 초과 뒤 자정 실행과 겹치면 같은 상태
  # 파일을 둘이 쓰므로 재시도를 끈다 — 실패한 준비 실행은 다음 날 다시 돈다(자정 수집은 무관).
  aws lambda put-function-event-invoke-config --region $R --function-name $F_COLLECTOR --maximum-retry-attempts 0 >/dev/null
  upsert_zip $F_FANOUT "$BUILD/fanout.zip" app.get_id_list_from_s3 120 256 \
    "Variables={S3_BUCKET_NAME=$BUCKET,S3_FILE_NAME=contest_novel_ids_$Y.json,SQS_TASK_QUEUE_URL=$TASK_URL,SQS_RESULT_QUEUE_URL=$RESULT_URL}"
  upsert_zip $F_CHECK "$BUILD/check.zip" check_completion.handler 180 256 "Variables={SQS_RESULT_QUEUE_URL=$RESULT_URL}"
  upsert_zip $F_CONSOLIDATE "$BUILD/consolidate.zip" consolidate_contest_data.handler 600 512 \
    "Variables={DYNAMODB_TABLE_NAME=$TABLE,SQS_RESULT_QUEUE_URL=$RESULT_URL,STATE_BUCKET=$BUCKET}"

  PENV="Variables={SQS_RESULT_QUEUE_URL=$RESULT_URL,RAW_HTML_BUCKET=$RAW_BUCKET,RAW_HTML_PREFIX=contest,CONTEST_YEAR=$Y}"
  if exists aws lambda get-function --region $R --function-name $F_PARSER; then
    aws lambda update-function-code --region $R --function-name $F_PARSER --image-uri "$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO@$DIGEST" >/dev/null
    aws lambda wait function-updated --region $R --function-name $F_PARSER
    aws lambda update-function-configuration --region $R --function-name $F_PARSER --timeout 600 --memory-size 512 --environment "$PENV" >/dev/null
  else
    aws lambda create-function --region $R --function-name $F_PARSER --package-type Image \
      --code ImageUri="$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO@$DIGEST" --role $LAMBDA_ROLE \
      --timeout 600 --memory-size 512 --environment "$PENV" >/dev/null
  fi
  aws lambda wait function-updated --region $R --function-name $F_PARSER 2>/dev/null || aws lambda wait function-active --region $R --function-name $F_PARSER

  echo "== 작업 큐 → 파서 (배치 40, 동시 10, 실패한 작품만 재시도)"
  UUID=$(aws lambda list-event-source-mappings --region $R --function-name $F_PARSER --query 'EventSourceMappings[0].UUID' --output text)
  if [ "$UUID" = "None" ]; then
    aws lambda create-event-source-mapping --region $R --function-name $F_PARSER \
      --event-source-arn arn:aws:sqs:$R:$ACC:$TASK_Q --batch-size 40 --maximum-batching-window-in-seconds 5 \
      --scaling-config MaximumConcurrency=10 --function-response-types ReportBatchItemFailures >/dev/null
  fi
}

upsert_zip() {  # name zip handler timeout memory env
  if exists aws lambda get-function --region $R --function-name $1; then
    aws lambda update-function-code --region $R --function-name $1 --zip-file "fileb://$2" >/dev/null
    aws lambda wait function-updated --region $R --function-name $1
    aws lambda update-function-configuration --region $R --function-name $1 --handler $3 --timeout $4 --memory-size $5 --environment "$6" >/dev/null
  else
    aws lambda create-function --region $R --function-name $1 --runtime python3.13 --role $LAMBDA_ROLE \
      --handler $3 --timeout $4 --memory-size $5 --environment "$6" --zip-file "fileb://$2" >/dev/null
  fi
  aws lambda wait function-updated --region $R --function-name $1 2>/dev/null || aws lambda wait function-active --region $R --function-name $1
}

failure_rule() {
  echo "== 실패 알림 규칙에 2026 상태 머신 두 판 추가"
  aws events put-rule --region $R --name novelflow-pipeline-failure --event-pattern "{
    \"source\":[\"aws.states\"],\"detail-type\":[\"Step Functions Execution Status Change\"],
    \"detail\":{\"status\":[\"FAILED\",\"TIMED_OUT\",\"ABORTED\"],\"stateMachineArn\":[
      \"arn:aws:states:$R:$ACC:stateMachine:NpTrendCrawlerWorkflow\",
      \"arn:aws:states:$R:$ACC:stateMachine:NpTrendContestDataPipelineMainWorkflow\",\"$SM_ARN\",\"$DSM_ARN\"]}}" >/dev/null
}

orchestration() {
  echo "== 상태 머신 역할: 2026 큐 purge 권한 추가"
  aws iam put-role-policy --role-name $SFN_ROLE_NAME --policy-name PurgePipelineQueues --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sqs:PurgeQueue\",\"Resource\":[
      \"arn:aws:sqs:$R:$ACC:np-trend-crawler-queue\",
      \"arn:aws:sqs:$R:$ACC:np-trend-contest-task-queue-2025\",\"arn:aws:sqs:$R:$ACC:np-trend-contest-result-queue-2025\",
      \"arn:aws:sqs:$R:$ACC:$TASK_Q\",\"arn:aws:sqs:$R:$ACC:$RESULT_Q\"]}]}"

  echo "== 상태 머신 $SM_NAME"
  DEF=$(sed "s/YOUR_AWS_REGION/$R/g; s/YOUR_AWS_ACCOUNT_ID/$ACC/g" contest_detail_parser/NovelFlowContest2026Workflow.json)
  if exists aws stepfunctions describe-state-machine --region $R --state-machine-arn $SM_ARN; then
    aws stepfunctions update-state-machine --region $R --state-machine-arn $SM_ARN --definition "$DEF" >/dev/null
  else
    aws stepfunctions create-state-machine --region $R --name $SM_NAME --type STANDARD \
      --role-arn arn:aws:iam::$ACC:role/$SFN_ROLE_NAME --definition "$DEF" >/dev/null
  fi

  failure_rule
}

dmap() {
  # Distributed Map 판(그림자 실행으로 운영과 비교한 뒤 교체한다). 운영 함수와 같은 코드·이미지, 입구만 다르다.
  echo "== DMap 함수(파서·적재 입구만 다름)"
  DIGEST=$(aws ecr describe-images --region $R --repository-name $ECR_REPO --image-ids imageTag=latest --query 'imageDetails[0].imageDigest' --output text)
  PENV="Variables={SQS_RESULT_QUEUE_URL=$RESULT_URL,RAW_HTML_BUCKET=$RAW_BUCKET,RAW_HTML_PREFIX=contest,CONTEST_YEAR=$Y}"
  if exists aws lambda get-function --region $R --function-name ${F_PARSER}-dmap; then
    aws lambda update-function-code --region $R --function-name ${F_PARSER}-dmap --image-uri "$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO@$DIGEST" >/dev/null
    aws lambda wait function-updated --region $R --function-name ${F_PARSER}-dmap
  else
    aws lambda create-function --region $R --function-name ${F_PARSER}-dmap --package-type Image \
      --code ImageUri="$ACC.dkr.ecr.$R.amazonaws.com/$ECR_REPO@$DIGEST" --role $LAMBDA_ROLE \
      --image-config 'Command=["parser.parse_dmap_batch"]' --timeout 600 --memory-size 512 --environment "$PENV" >/dev/null
    aws lambda wait function-active --region $R --function-name ${F_PARSER}-dmap
  fi
  zip -qj "$BUILD/consolidate.zip" contest_detail_parser/consolidate_contest_data.py
  upsert_zip ${F_CONSOLIDATE}-dmap "$BUILD/consolidate.zip" consolidate_contest_data.handler_dmap 600 512 \
    "Variables={DYNAMODB_TABLE_NAME=$TABLE,SQS_RESULT_QUEUE_URL=$RESULT_URL,STATE_BUCKET=$BUCKET}"

  echo "== 상태 머신 역할: 2026 버킷 읽기·쓰기(ItemReader·ResultWriter)"
  aws iam put-role-policy --role-name $SFN_ROLE_NAME --policy-name NovelFlowContest${Y}DMapS3 --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:ListMultipartUploadParts\",\"s3:AbortMultipartUpload\"],
      \"Resource\":\"arn:aws:s3:::$BUCKET/*\"},{\"Effect\":\"Allow\",\"Action\":\"s3:ListBucket\",\"Resource\":\"arn:aws:s3:::$BUCKET\"}]}"

  echo "== 상태 머신 역할: 날짜 잠금(RUN_LOCK#{date}) 쓰기 — 예약 중복 전달 방지"
  aws iam put-role-policy --role-name $SFN_ROLE_NAME --policy-name NovelFlowContest${Y}RunLock --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"dynamodb:PutItem\",
      \"Resource\":\"arn:aws:dynamodb:$R:$ACC:table/$TABLE\"}]}"

  echo "== 상태 머신 ${SM_NAME%Workflow}DMapWorkflow"
  DEF=$(sed "s/YOUR_AWS_REGION/$R/g; s/YOUR_AWS_ACCOUNT_ID/$ACC/g" contest_detail_parser/NovelFlowContest2026DMapWorkflow.json)
  if exists aws stepfunctions describe-state-machine --region $R --state-machine-arn $DSM_ARN; then
    aws stepfunctions update-state-machine --region $R --state-machine-arn $DSM_ARN --definition "$DEF" >/dev/null
  else
    aws stepfunctions create-state-machine --region $R --name ${SM_NAME%Workflow}DMapWorkflow --type STANDARD \
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
      \"arn:aws:states:$R:$ACC:stateMachine:NpTrendContestDataPipelineMainWorkflow\",\"$SM_ARN\",\"$DSM_ARN\"]},
      {\"Effect\":\"Allow\",\"Action\":[\"lambda:InvokeFunction\"],\"Resource\":[\"arn:aws:lambda:$R:$ACC:function:$F_COLLECTOR\"]}]}" >/dev/null

  # SQS 판은 지우지 않고 남겨 둔다 — 문제가 생기면 스케줄 대상만 되돌린다.
  TARGET_ARN=$([ "$PIPELINE" = sqs ] && echo $SM_ARN || echo $DSM_ARN)
  echo "== 스케줄 $SCHED_NAME (매일 00:00 KST → ${TARGET_ARN##*:})"
  ARGS=(--region $R --name $SCHED_NAME --schedule-expression "cron(0 0 * * ? *)" --schedule-expression-timezone Asia/Seoul
        --flexible-time-window Mode=OFF --target "Arn=$TARGET_ARN,RoleArn=arn:aws:iam::$ACC:role/service-role/$SCHED_ROLE_NAME")
  if exists aws scheduler get-schedule --region $R --name $SCHED_NAME; then aws scheduler update-schedule "${ARGS[@]}" >/dev/null
  else aws scheduler create-schedule "${ARGS[@]}" >/dev/null; fi

  # 23:30 준비 실행: 오래 걸리는 재확인·작가 받기를 자정 전에 해 두고, 자정 경로는 짧게 둔다(DECISIONS 2026-10-02).
  # 실행 ID 는 날마다 달라야 한다(재확인의 '이번 실행에서 본 번호' 판정) — 스케줄러가 예약 시각을 넣어 준다.
  echo "== 스케줄 ${SCHED_NAME%Daily}Prep (매일 23:30 KST, 수집기 직접 호출)"
  PARGS=(--region $R --name ${SCHED_NAME%Daily}Prep --schedule-expression "cron(30 23 * * ? *)" --schedule-expression-timezone Asia/Seoul
         --flexible-time-window Mode=OFF
         --target "{\"Arn\":\"arn:aws:lambda:$R:$ACC:function:$F_COLLECTOR\",\"RoleArn\":\"arn:aws:iam::$ACC:role/service-role/$SCHED_ROLE_NAME\",\"Input\":\"{\\\"mode\\\":\\\"prep\\\",\\\"execution_id\\\":\\\"prep-<aws.scheduler.scheduled-time>\\\"}\",\"RetryPolicy\":{\"MaximumRetryAttempts\":0}}")
  if exists aws scheduler get-schedule --region $R --name ${SCHED_NAME%Daily}Prep; then aws scheduler update-schedule "${PARGS[@]}" >/dev/null
  else aws scheduler create-schedule "${PARGS[@]}" >/dev/null; fi
}

case "${1:-all}" in
  infra) infra ;;
  code) code ;;
  orchestration) orchestration ;;
  schedule) schedule ;;
  dmap) dmap ;;
  all) infra; code; orchestration ;;   # 스케줄은 시험 실행이 통과한 뒤 따로 켠다
  *) echo "usage: $0 [all|infra|code|orchestration|schedule|dmap]"; exit 1 ;;
esac
echo "done: ${1:-all}"
