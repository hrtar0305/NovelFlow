#!/usr/bin/env bash
# 연재 기록 저장소(NovelFlowEpisodeHistory, 키 NovelId) + 권한: 크롤러·2026 파서 Lambda 역할 읽기·쓰기, 웹 API 역할 읽기.
# 설계 docs/superpowers/specs/2026-10-05-episode-upload-history-design.md 3.1. 여러 번 돌려도 같다.
set -euo pipefail
R=ap-northeast-2; ACC=$(aws sts get-caller-identity --query Account --output text); T=NovelFlowEpisodeHistory
ARN=arn:aws:dynamodb:$R:$ACC:table/$T
if ! aws dynamodb describe-table --region $R --table-name $T >/dev/null 2>&1; then
  aws dynamodb create-table --region $R --table-name $T --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=NovelId,AttributeType=S --key-schema AttributeName=NovelId,KeyType=HASH \
    --deletion-protection-enabled >/dev/null
  aws dynamodb wait table-exists --region $R --table-name $T
fi
# 만든 직후에는 백업 켜기가 잠시 거절된다(ContinuousBackupsUnavailableException) — 몇 번 다시 시도한다.
for i in 1 2 3 4 5 6; do
  aws dynamodb update-continuous-backups --region $R --table-name $T --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null 2>&1 && break
  sleep 10
done
aws iam put-role-policy --role-name NpTrendCrawlerLambdaExecutionRole --policy-name NovelFlowEpisodeHistoryRW --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\"],\"Resource\":\"$ARN\"}]}"
aws iam put-role-policy --role-name NpTrendWebappAPIRole --policy-name NovelFlowEpisodeHistoryRead --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\"],\"Resource\":\"$ARN\"}]}"
echo "done: $T"
