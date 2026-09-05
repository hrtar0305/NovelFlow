"""수집한 원본 HTML을 S3에 적재한다 (ELT의 L).

왜 필요한가
    지금까지는 크롤러가 HTML을 파싱해 24개 컬럼짜리 CSV로 만들고 HTML은 그 자리에서
    버렸다(ETL). 그래서 **나중에 새 필드를 알게 되면 과거를 채울 방법이 없다.**
    `CSV_HEADERS` 에 없는 필드는 `extrasaction='ignore'` 때문에 에러도 없이 사라졌다.

    원본을 남기면 그 반대가 된다 — 그때 페이지에 있던 것이면 어떤 비즈니스 로직으로
    바뀌어도 소급 적용할 수 있다. 이 리포에는 그 필요가 실제로 두 번 있었다:
    성인 배지 판정을 `span.b_19` 로 넓혀 회차 배지까지 잡은 일, 정규식으로 HTML을
    훑어 `<script>` 안 템플릿 문자열 때문에 일반작을 전부 오판한 일
    (docs/DECISIONS.md 참고). 원본이 있었다면 둘 다 소급해서 고칠 수 있었다.

무엇을 남기는가
    **스크립트를 포함해 페이지를 그대로 남긴다.** 한때 `<script>` 를 지워 용량을
    반으로 줄이려 했는데(실측 91KB → 42KB), 그건 "여기엔 값어치가 없다"를 미리
    굳히는 것이고 ELT가 피하려는 바로 그 행위다. 차이가 월 $0.18이라 살 이유가 없다.

    다만 **비밀값은 지운다.** 크롤러는 로그인 세션으로 받으므로 CSRF 토큰 같은 것이
    본문에 실릴 수 있다(익명 응답에서는 `"csrf": ""` 로 비어 있었다). 블록을 지우지
    않고 **값만 치환**해서 구조는 보존한다.

형식
    소설 하나당 JSON 한 덩어리를 gzip 해 올린다 — `raw/{date}/{novel_id}.json.gz`.
    파일을 따로 쓰면 PUT 이 5배가 되고(월 $0.075 → $0.38), 묶어도 크기는 같다
    (실측: 개별 gzip 합 91KB vs JSON 감싼 뒤 89KB, 압축 7ms).
"""

import base64
import gzip
import json
import logging
import re

logger = logging.getLogger()

# 적재 형식 버전. 재파싱 스크립트가 옛 객체를 만났을 때 분기할 근거가 된다.
RAW_FORMAT = 1

# SQS 메시지에서 원본이 실리는 키. consolidate 가 이 키를 떼어내고 NDJSON 을 만든다.
RAW_FIELD = '_raw_gz_b64'

# 비밀값처럼 보이는 키. 값만 비우고 키와 구조는 남긴다.
#
# 실측 근거(novel/610 익명 응답): `"csrf": ""`, `csrf: ''` 형태로 16회 등장했다.
# 익명이라 비어 있었지만 로그인 세션에서는 채워진다. `chainUserId` 처럼 값이 아니라
# **DOM 셀렉터 참조**인 것들은 건드리지 않는다(`$('#STPG_payForm [name="chainUserId"]').val()`).
_SECRET_KEYS = r'(?:csrf|csrf_token|_csrf|authenticity_token|access_token|refresh_token|id_token|api_key|apikey|secret)'

REDACTED = '__REDACTED__'

# (정규식, 치환 템플릿). 패턴마다 치환 형태가 달라 공용 로직을 쓰면 안 된다 —
# 한때 하나의 `_sub` 로 처리했다가 `value=""__REDACTED__"` 처럼 인용부호가 겹쳤다.
_SECRET_PATTERNS = [
    # JS/JSON 할당:  "csrf": "값"   |   csrf: '값'   (여는 인용부호가 그룹 2)
    (re.compile(rf'(["\']?{_SECRET_KEYS}["\']?\s*[:=]\s*)(["\'])(?:(?!\2).){{4,}}\2', re.I),
     rf'\1\g<2>{REDACTED}\g<2>'),
    # HTML hidden input:  <input ... name="csrf" ... value="값">  (여는 인용부호는 그룹 1에 포함)
    (re.compile(rf'(<input[^>]*\bname=["\']{_SECRET_KEYS}["\'][^>]*\bvalue=["\'])[^"\']{{4,}}(["\'])', re.I),
     rf'\g<1>{REDACTED}\g<2>'),
    # meta 태그:  <meta name="csrf-token" content="값">
    (re.compile(rf'(<meta[^>]*\bname=["\'][^"\']*{_SECRET_KEYS}[^"\']*["\'][^>]*\bcontent=["\'])[^"\']{{4,}}(["\'])', re.I),
     rf'\g<1>{REDACTED}\g<2>'),
]


def redact(html: str) -> tuple[str, int]:
    """비밀값을 치환한다. (치환된 HTML, 치환 횟수)를 돌려준다.

    값만 비우고 키·태그·스크립트 블록은 그대로 둔다 — 구조가 남아 있어야 나중에
    "그때 이 페이지에 이런 폼이 있었다"를 알 수 있다.
    """
    if not html:
        return html, 0
    total = 0
    for pat, repl in _SECRET_PATTERNS:
        html, n = pat.subn(repl, html)
        total += n
    return html, total


def scan_for_secrets(html: str) -> list[str]:
    """치환 후에도 비밀값처럼 보이는 것이 남았는지 훑는다.

    치환 패턴은 관측된 형태를 겨냥한 것이라 **인증 세션의 실제 응답으로 한 번
    확인해야 한다.** 이 함수가 그 확인용이다 — 무언가 걸리면 패턴을 늘린다.
    """
    if not html:
        return []
    out = []
    # **할당 형태만** 본다. 키워드 근처를 넓게 훑으면 URL 쿼리까지 걸린다 —
    # Apple 로그인 링크의 `response_type=code id_token&state=<nonce>` 가 매번 오탐이었다.
    # 경고가 소설마다 뜨면 아무도 안 본다.
    pat = rf'{_SECRET_KEYS}["\']?\s*[:=]\s*["\']([A-Za-z0-9+/_=-]{{12,}})["\']'
    for m in re.finditer(pat, html, re.I):
        if REDACTED in m.group(0):
            continue
        out.append(m.group(0)[:80])
    return out[:20]


def build_json_payload(novel_id: str, date: str, pages: list[dict],
                       meta: dict | None = None) -> tuple[bytes, dict]:
    """묶음(`bundle`)에 바로 넣을 **비압축 JSON 바이트**를 만든다.

    gzip 은 SQS 전송용이다. 배치 안에서 곧바로 묶는 경로(공모전 파서)에서는 gzip 을
    거칠 이유가 없다 — 만들었다가 바로 다시 푸는 낭비가 된다.
    """
    redacted_pages, redactions, leftovers = _redact_pages(pages)
    obj = {
        'raw_format': RAW_FORMAT,
        'novel_id': str(novel_id),
        'date': date,
        'pages': redacted_pages,
        **(meta or {}),
    }
    body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    return body, {'pages': len(redacted_pages), 'bytes': len(body),
                  'redactions': redactions, 'suspect': leftovers[:5]}


def _redact_pages(pages: list[dict]) -> tuple[list[dict], int, list[str]]:
    """페이지마다 비밀값을 치환하고 (치환된 페이지, 치환 수, 의심 잔류)를 돌려준다."""
    out, total, leftovers = [], 0, []
    for p in pages:
        html, n = redact(p.get('html') or '')
        total += n
        if n == 0:
            leftovers.extend(scan_for_secrets(html))
        out.append({**{k: v for k, v in p.items() if k != 'html'}, 'html': html})
    return out, total, leftovers


def build_payload(novel_id: str, date: str, pages: list[dict],
                  meta: dict | None = None) -> tuple[bytes, dict]:
    """적재할 gzip 바이트와 요약 정보를 만든다.

    `pages` 는 `{kind, url, status, html, ...}` 목록이다. 무엇을 어떤 순서로 받았는지
    까지 남기므로, 재파싱 시 "회차 목록 3페이지까지만 받았다" 같은 사정도 재현된다.
    """
    body, summary = build_json_payload(novel_id, date, pages, meta)
    gz = gzip.compress(body, 6)
    summary['bytes'] = len(gz)
    return gz, summary


def build_message_payload(novel_id: str, date: str, pages: list[dict],
                          meta: dict | None = None) -> tuple[str, dict]:
    """SQS 메시지에 실을 base64 문자열을 만든다.

    **왜 S3 개별 업로드가 아니라 SQS 인가.** 한때 소설마다 S3 에 하나씩 올렸는데,
    그러면 (a) PUT 이 소설 수만큼 들고 (b) 나중에 하루치를 묶으려면 그걸 전부 다시
    읽어야 하고 (c) gzip 은 개별 압축이라 문서 간 중복을 못 잡는다.

    실측(2026-09-05, 상세+회차 30편):
        개별 gzip        편당 91KB
        묶어서 zstd-10   편당  9KB   ← 10배 차이. gzip 은 윈도가 32KB 라 묶어도 이득 0.

    SQS 로 보내면 consolidate 가 전건을 들고 있게 되어 **한 번에 묶어 한 번 PUT** 한다.
    한도도 문제가 아니다 — 실측으로 큐 기본 한도는 1MB 이고(프로드 큐만 옛 설정 256KB),
    gzip+base64 페이로드가 122KB 라 256KB 에서도 절반밖에 안 쓴다.
    (비압축 JSON 은 768KB 라 그대로는 못 보낸다.)
    """
    body, summary = build_payload(novel_id, date, pages, meta)
    encoded = base64.b64encode(body).decode('ascii')
    summary['b64_bytes'] = len(encoded)
    return encoded, summary


def decode_message_payload(encoded: str) -> dict:
    """`build_message_payload` 가 만든 문자열을 원래 dict 로 되돌린다."""
    return json.loads(gzip.decompress(base64.b64decode(encoded)))


def bundle(json_payloads: list[bytes], level: int = 10, window_log: int = 23) -> bytes:
    """하루치 원본을 한 덩어리로 묶어 zstd 로 압축한다.

    **입력은 gzip 이 아니라 비압축 JSON 바이트다.** 한때 소설별 gzip 바이트를 그대로
    이어 붙였는데 두 가지가 깨졌다:
      ① gzip 출력은 고엔트로피라 zstd 가 더 줄이지 못한다 — 편당 79KB 로 개별
         gzip(91KB)과 거의 같았다. 이중 압축은 의미가 없다.
      ② gzip 바이트에 `0x0A` 가 섞여 있어 `b'\n'.join` 이 경계를 깨뜨렸다
         (30건이 10,799줄로 쪼개졌다).
    `json.dumps` 결과에는 날 것의 줄바꿈이 없으므로(문자열 안 개행은 `\n` 으로
    이스케이프된다) 비압축 JSON 이면 줄 구분자가 안전하다.

    **gzip 이 아니라 zstd 인 이유**: gzip 윈도는 32KB 인데 페이지 하나가 400KB 라,
    묶어도 문서 간 중복을 전혀 못 잡는다(실측 2252KB → 2281KB 로 오히려 증가).

    **`window_log=23`(8MB)**: 128MB 윈도 대비 결과가 2% 나쁠 뿐인데 메모리는 16배
    적다(실측 편당 9.0KB vs 8.8KB). **레벨 10**: 19 는 21MB/s 라 4,500편에 86초가
    걸리는데 결과 차이는 5% 뿐이다(10 은 408MB/s).
    """
    import zstandard as zstd
    params = zstd.ZstdCompressionParameters.from_level(level, window_log=window_log)
    blob = b'\n'.join(json_payloads)
    return zstd.ZstdCompressor(compression_params=params).compress(blob)


def decode_to_json_bytes(encoded: str) -> bytes:
    """SQS 로 온 base64(gzip) 를 **비압축 JSON 바이트**로 되돌린다.

    묶음(`bundle`)에 넣을 형태다 — gzip 인 채로 넘기면 이중 압축이 되어 이득이 없다.
    """
    return gzip.decompress(base64.b64decode(encoded))


def store(s3_client, bucket: str, novel_id: str, date: str, pages: list[dict],
          prefix: str = 'raw', meta: dict | None = None) -> dict:
    """S3 에 올린다. 실패해도 예외를 올리지 않는다 —
    원본 적재는 부가 기능이고, 여기서 막으면 그날 수집 자체가 무너진다."""
    body, summary = build_payload(novel_id, date, pages, meta)
    key = f'{prefix}/{date}/{novel_id}.json.gz'
    try:
        s3_client.put_object(
            Bucket=bucket, Key=key, Body=body,
            ContentType='application/json', ContentEncoding='gzip',
        )
        summary['key'] = key
        if summary['suspect']:
            logger.warning(
                "원본 적재: 치환 후에도 비밀값 의심 문자열이 남았다 — 패턴을 늘려야 한다 "
                f"novel_id={novel_id} samples={summary['suspect']}"
            )
        return summary
    except Exception as e:                                  # noqa: BLE001
        logger.error(f"원본 적재 실패 novel_id={novel_id} key={key}: {e}")
        summary['key'] = None
        summary['error'] = str(e)
        return summary
