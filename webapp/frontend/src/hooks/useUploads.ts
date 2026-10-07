import { useEffect, useState } from 'react';
import { getUploads } from '../services/api';
import { uploadDays, type UploadsState } from '../utils/uploads';

/**
 * 연재 줄 — 기간 [start, end] 의 연재 기록. 받는 동안 'loading', 실패하면 'error', `enabled=false`(2025 공모전)면 undefined.
 * `asof` 를 주면 그날 수집 마감까지 본 회차만 센다(랭킹 표 펼침).
 */
export function useUploads(novelId: string | undefined, start: string | undefined, end: string | undefined, enabled = true,
  asof?: { date: string; source: 'daily' | 'contest' }): UploadsState | undefined {
  const [days, setDays] = useState<{ key: string; days: UploadsState } | null>(null);
  const asofDate = asof?.date;
  const asofSource = asof?.source;
  const key = `${novelId}:${start}:${end}:${asofDate}:${asofSource}`;
  useEffect(() => {
    if (!enabled || !novelId || !start || !end) return;
    let cancelled = false;
    getUploads(novelId, start, end, asofDate && asofSource ? { date: asofDate, source: asofSource } : undefined)
      .then(r => { if (!cancelled) setDays({ key, days: uploadDays(r.data) }); })
      .catch(() => { if (!cancelled) setDays({ key, days: 'error' }); });
    return () => { cancelled = true; };
  }, [enabled, novelId, start, end, asofDate, asofSource, key]);
  if (!enabled) return undefined;
  return days?.key === key ? days.days : 'loading';
}
