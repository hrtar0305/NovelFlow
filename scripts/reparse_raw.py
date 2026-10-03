"""S3 에 적재된 원본 HTML을 **지금의 파싱 규칙으로 다시 뽑는다** (ELT 의 T).

이 스크립트가 ELT 로 바꾼 이유 그 자체다
    예전 구조(ETL)에서는 크롤러가 HTML을 파싱해 24개 컬럼 CSV로 만들고 HTML을 버렸다.
    그래서 새 필드를 알게 되어도 **과거를 채울 방법이 없었다.** 이 리포에는 그 필요가
    실제로 두 번 있었다 — 성인 배지를 `span.b_19` 로 넓혀 회차 배지까지 잡은 일,
    정규식으로 HTML을 훑어 `<script>` 안 템플릿 때문에 일반작을 전부 오판한 일.
    원본이 있으면 둘 다 소급해서 고칠 수 있다.

무엇을 뽑을지는 여기서 정한다
    `EXTRACTORS` 에 `(필드명, 함수)` 를 추가하면 그 필드가 과거 전체에 채워진다.
    새 규칙을 넣기 전에 반드시 `--dry-run` 으로 몇 건을 확인할 것 — 셀렉터를 넓게
    잡으면 엉뚱한 것이 잡힌다(위의 두 전례가 정확히 그것이었다).

사용법
    python scripts/reparse_raw.py --date 2026-09-05 --dry-run
    python scripts/reparse_raw.py --date 2026-09-05 --fields Badges
    python scripts/reparse_raw.py --from 2026-09-01 --to 2026-09-05 --fields Badges
    python scripts/reparse_raw.py --date 2026-09-05 --novel-id 610 --dry-run --show 3
"""

import argparse
import gzip
import io
import json
import os
import re
import sys

import boto3
from botocore.exceptions import ClientError
from bs4 import BeautifulSoup

RAW_BUCKET = os.environ.get('RAW_HTML_BUCKET')
RAW_PREFIX = os.environ.get('RAW_HTML_PREFIX', 'raw')
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'NovelRanks')


# ─────────────────────────────────────────────────────────────────────────────
# 추출 규칙
# ─────────────────────────────────────────────────────────────────────────────

def _detail_soup(payload: dict) -> BeautifulSoup | None:
    for p in payload.get('pages') or []:
        if p.get('kind') == 'detail':
            return BeautifulSoup(p.get('html') or '', 'html.parser')
    return None


def badge_spans(soup: BeautifulSoup) -> list[dict] | None:
    """`p.in-badge` 안의 span 을 **하나도 빼지 않고** 기록한다. 해석은 하지 않는다.

    **`b_*` class 만 모으면 안 된다.** 연재중단·연재지연 배지에는 class 가 `s_inv`
    하나뿐이고 구분은 텍스트와 인라인 배경색으로만 되어 있다 —
    실측(2026-09-05):

        212573  <span class="s_inv" style="…background-color:#ea4a4a…">연재중단</span>
        427211  <span class="s_inv" style="…background-color:#BAA576…">연재지연</span>
        610     (해당 span 없음)

    처음에는 `b_` 로 시작하는 class 만 걷었는데 그러면 이 둘이 통째로 사라졌다.
    class·텍스트·색을 다 남겨 두면, 나중에 노벨피아가 표기를 바꿔도 원본에서 다시
    뽑을 수 있고 모르는 배지가 조용히 없어지지 않는다.

    **`p.in-badge` 안으로 한정하는 것은 그대로 지킨다.** 회차 목록에도 같은 class 가
    쓰여서 문서 전체를 훑으면 회차 배지까지 잡힌다(docs/DECISIONS.md 의 실패 사례).
    """
    holder = soup.select_one('p.in-badge')
    if holder is None:
        return None
    out = []
    for sp in holder.find_all('span'):
        classes = [c for c in (sp.get('class') or []) if c != 's_inv']
        color = None
        m = re.search(r'background-color:\s*([^;]+)', sp.get('style') or '', re.I)
        if m:
            color = m.group(1).strip()
        out.append({
            'class': classes or None,
            'text': sp.get_text(strip=True) or None,
            'color': color,
        })
    return out


def extract_badges(payload: dict) -> list[dict] | None:
    soup = _detail_soup(payload)
    return None if soup is None else badge_spans(soup)


def extract_serial_status(payload: dict) -> str | None:
    """연재 상태(연재중단 / 연재지연 / 그 밖).

    판정: `p.in-badge` 안에서 **`b_*` class 가 없고 텍스트가 있는** span 의 텍스트.
    등급(`b_19`)·PLUS(`b_plus`)·독점(`b_mono`)은 class 를 갖고 있어 걸러진다.

    **아는 값으로 좁히지 않는다.** 모르는 상태(예: 완결)가 나오면 그 문자열이 그대로
    남아야 한다 — 화이트리스트로 좁히면 새 상태가 조용히 사라지고, 그게 ETL 에서
    필드를 잃던 것과 같은 실수가 된다.

    상태 배지가 없으면(정상 연재) `None` 을 돌려주고 이 스크립트는 그 필드를 쓰지
    않는다. 빈 문자열을 쓰면 적재 Lambda 의 `if v != ""` 필터에 걸려 사라지므로
    '정상 연재'와 '판정 불가'가 구별되지 않는다. 판정 가능성은 `Badges` 로 가린다.
    """
    soup = _detail_soup(payload)
    if soup is None:
        return None
    spans = badge_spans(soup)
    if spans is None:
        return None
    for sp in spans:
        if not sp['class'] and sp['text']:
            return sp['text']
    return None


def extract_is_adult(payload: dict) -> bool | None:
    """등급 배지로 성인작 판정. 백엔드·크롤러와 같은 규칙이어야 한다.

    `p.in-badge span.b_19` 로 **반드시 한정한다.** `span.b_19` 로 넓히면 회차 목록
    배지까지 잡히고, 정규식으로 HTML 을 훑으면 `<script>` 안 템플릿 문자열 때문에
    일반작이 전부 오판된다 — 둘 다 실제로 겪은 실패다(docs/DECISIONS.md).
    """
    soup = _detail_soup(payload)
    if soup is None:
        return None
    return soup.select_one('p.in-badge span.b_19') is not None


EXTRACTORS = {
    'Badges': extract_badges,
    'SerialStatus': extract_serial_status,
    'IsAdult': extract_is_adult,
}


# ─────────────────────────────────────────────────────────────────────────────

def iter_raw(s3, date: str, novel_id: str | None):
    """그 날짜의 원본을 하나씩 돌려준다.

    형식이 둘이다. 새 방식은 **하루치 한 덩어리**(`raw/{date}.jsonl.zst`) 이고,
    옛 방식은 소설별 개별 객체(`raw/{date}/{id}.json.gz`) 다. 개별 방식은 gzip 이
    묶어도 이득이 없다는 실측 때문에 폐기됐지만, 그때 쌓인 것은 계속 읽혀야 한다.
    """
    bundle_key = f'{RAW_PREFIX}/{date}.jsonl.zst'
    try:
        body = s3.get_object(Bucket=RAW_BUCKET, Key=bundle_key)['Body'].read()
    except Exception:
        body = None

    if body is not None:
        import zstandard as zstd
        dctx = zstd.ZstdDecompressor(max_window_size=2 ** 27)
        with dctx.stream_reader(io.BytesIO(body)) as reader:
            for line in io.BufferedReader(reader, buffer_size=1 << 20):
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError as e:
                    print(f"  줄 파싱 실패 {bundle_key}: {e}", file=sys.stderr)
                    continue
                if novel_id and str(payload.get('novel_id')) != str(novel_id):
                    continue
                yield bundle_key, payload
        return

    # 옛 개별 객체 방식
    if novel_id:
        keys = [f'{RAW_PREFIX}/{date}/{novel_id}.json.gz']
    else:
        keys, token = [], None
        while True:
            kw = {'Bucket': RAW_BUCKET, 'Prefix': f'{RAW_PREFIX}/{date}/'}
            if token:
                kw['ContinuationToken'] = token
            page = s3.list_objects_v2(**kw)
            keys += [o['Key'] for o in page.get('Contents', [])]
            token = page.get('NextContinuationToken')
            if not token:
                break
    for key in keys:
        try:
            body = s3.get_object(Bucket=RAW_BUCKET, Key=key)['Body'].read()
            yield key, json.loads(gzip.decompress(body))
        except Exception as e:                                  # noqa: BLE001
            print(f"  읽기 실패 {key}: {e}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date')
    ap.add_argument('--from', dest='date_from')
    ap.add_argument('--to', dest='date_to')
    ap.add_argument('--novel-id')
    ap.add_argument('--fields', help='쉼표로 구분. 생략하면 전부')
    ap.add_argument('--dry-run', action='store_true', help='DynamoDB 를 쓰지 않는다')
    ap.add_argument('--show', type=int, default=5, help='dry-run 에서 보여줄 건수')
    args = ap.parse_args()

    if not RAW_BUCKET:
        sys.exit('RAW_HTML_BUCKET 환경변수가 필요하다.')

    fields = [f.strip() for f in args.fields.split(',')] if args.fields else list(EXTRACTORS)
    unknown = [f for f in fields if f not in EXTRACTORS]
    if unknown:
        sys.exit(f'모르는 필드: {unknown} (가능: {list(EXTRACTORS)})')

    if args.date:
        dates = [args.date]
    elif args.date_from and args.date_to:
        from datetime import date as D, timedelta
        a = D.fromisoformat(args.date_from)
        b = D.fromisoformat(args.date_to)
        dates = [(a + timedelta(days=i)).isoformat() for i in range((b - a).days + 1)]
    else:
        sys.exit('--date 또는 --from/--to 가 필요하다.')

    s3 = boto3.client('s3')
    table = None if args.dry_run else boto3.resource('dynamodb').Table(TABLE_NAME)

    grand = shown = grand_missing = 0
    for date in dates:
        n = missing = 0
        for key, payload in iter_raw(s3, date, args.novel_id):
            values = {}
            for f in fields:
                try:
                    v = EXTRACTORS[f](payload)
                except Exception as e:                          # noqa: BLE001
                    print(f"  추출 실패 {key} {f}: {e}", file=sys.stderr)
                    continue
                if v is not None:
                    values[f] = v
            if not values:
                continue

            if args.dry_run:
                if shown < args.show:
                    print(f"  {payload.get('novel_id')} @{date}  {values}")
                    shown += 1
            else:
                expr = ', '.join(f'#{f} = :{f}' for f in values)
                # update_item 은 행이 없으면 새로 만든다. 적재가 빠진 날짜에 Ranking·Score 없는
                # 유령 행을 만들지 않도록 기존 행에만 쓴다 — 없으면 reparse 가 아니라 적재부터 다시.
                try:
                    table.update_item(
                        Key={'ID': str(payload['novel_id']), 'Date': date},
                        UpdateExpression=f'SET {expr}',
                        ConditionExpression='attribute_exists(ID)',
                        ExpressionAttributeNames={f'#{f}': f for f in values},
                        ExpressionAttributeValues={f':{f}': v for f, v in values.items()},
                    )
                except ClientError as e:
                    if e.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                        raise
                    missing += 1
                    continue
            n += 1
        grand += n
        grand_missing += missing
        tail = f" · 행 없음 {missing}건(적재 누락 의심)" if missing else ''
        print(f"{date}: {n}건 {'(저장 안 함)' if args.dry_run else '갱신'}{tail}")

    tail = f" · 행 없음 {grand_missing}건 — 그 날짜는 적재부터 다시 할 것" if grand_missing else ''
    print(f"\n합계 {grand}건 · 필드 {fields}{tail}")


if __name__ == '__main__':
    main()
