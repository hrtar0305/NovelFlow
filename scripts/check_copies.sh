#!/usr/bin/env bash
# 이미지·배포가 따로라 같은 파일을 복사해 둔 것들이 서로 같은지 본다(CLAUDE.md 「컨벤션」).
set -euo pipefail
cd "$(dirname "$0")/.."
bad=0
for pair in "crawler/raw_store.py contests/2025/contest_detail_parser/raw_store.py" \
            "crawler/raw_store.py contests/2026/contest_detail_parser/raw_store.py" \
            "crawler/episode_history.py contests/2026/contest_detail_parser/episode_history.py" \
            "crawler/episode_history.py webapp/backend/api/episode_history.py"; do
  set -- $pair
  [ -f "$2" ] || { echo "없음: $2"; continue; }
  cmp -s "$1" "$2" || { echo "다름: $1 ↔ $2"; bad=1; }
done
exit $bad
