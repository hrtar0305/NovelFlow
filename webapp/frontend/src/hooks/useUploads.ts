import { useEffect, useState } from 'react';
import { getUploads } from '../services/api';
import { uploadDays, type UploadsState } from '../utils/uploads';

/** 작품 상세의 연재 줄 — 기간 [start, end] 의 연재 기록. 받는 동안 'loading', 실패하면 'error', `enabled=false`(2025 공모전)면 undefined. */
export function useUploads(novelId: string | undefined, start: string | undefined, end: string | undefined, enabled = true): UploadsState | undefined {
  const [days, setDays] = useState<{ key: string; days: UploadsState } | null>(null);
  const key = `${novelId}:${start}:${end}`;
  useEffect(() => {
    if (!enabled || !novelId || !start || !end) return;
    let cancelled = false;
    getUploads(novelId, start, end)
      .then(r => { if (!cancelled) setDays({ key, days: uploadDays(r.data) }); })
      .catch(() => { if (!cancelled) setDays({ key, days: 'error' }); });
    return () => { cancelled = true; };
  }, [enabled, novelId, start, end, key]);
  if (!enabled) return undefined;
  return days?.key === key ? days.days : 'loading';
}
