#!/usr/bin/env bash
# dev 서버(npm run dev, 기본 5173)에 붙어 경로 × 폭 × 테마를 PNG로 찍는다.
#   scripts/shots.sh <출력폴더> [경로...]      예) scripts/shots.sh /tmp/shots /novels/rankings /novels/433986
# BASE 로 서버 주소를 바꾼다. 백엔드(localhost:8000)도 떠 있어야 데이터가 나온다.
set -euo pipefail
OUT=${1:?출력 폴더를 주세요}; shift || true
[ $# -eq 0 ] && set -- /novels/rankings
BASE=${BASE:-http://localhost:5173}
mkdir -p "$OUT"
for p in "$@"; do
  slug=$(printf '%s' "$p" | tr '/?=&' '____' | sed 's/^_//')
  for w in 360 768 1200; do
    for t in light dark; do
      sep='?'; case "$p" in *\?*) sep='&';; esac
      google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
        --virtual-time-budget=15000 --window-size="$w,2600" \
        --screenshot="$OUT/${slug:-root}-$w-$t.png" "$BASE$p${sep}theme=$t" >/dev/null 2>&1
    done
  done
done
ls -1 "$OUT"
