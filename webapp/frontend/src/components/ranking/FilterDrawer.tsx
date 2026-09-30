import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Offcanvas } from 'react-bootstrap';
import { resetFilter, toggleStatus, toggleTag, type RankingFilter, type TagMode } from '../../utils/rankingQuery';
import { SERIAL_STATUS_NOTICE } from '../../utils/serialStatusNotice';

type Mode = TagMode | 'rule';
const MODES: Array<{ key: Mode; label: string }> = [
  { key: 'include-and', label: '모두 포함' },
  { key: 'include-or', label: '하나라도 포함' },
  { key: 'exclude', label: '제외' },
  { key: 'rule', label: '조건식' },
];

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  filter: RankingFilter;
  onChange: (next: RankingFilter) => void;
  tagStats: Array<{ tag: string; count: number }>;
  resultCount: number;
  error: string | null;
  extra?: ReactNode;
  /** 연재 상태 선택지와 그날 개수. 주면 '연재 상태' 칸을 그린다. */
  statusStats?: Array<{ status: string; count: number }>;
  /** 그날 목록에 연재 상태 기록이 있는가(2026-09-05 이전은 없음). */
  statusAvailable?: boolean;
  /** 초기화 때 페이지 고유 조건(extra)도 풀어야 하면 준다. */
  onResetExtra?: () => void;
}

const toNum = (s: string): number | null => {
  const v = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(v) ? v : null;
};

export default function FilterDrawer({ open, onClose, filter, onChange, tagStats, resultCount, error, extra, statusStats, statusAvailable = true, onResetExtra }: FilterDrawerProps) {
  const [mode, setMode] = useState<Mode>(filter.rule ? 'rule' : filter.tagMode);
  const [ruleText, setRuleText] = useState(filter.rule);
  const [q, setQ] = useState('');
  const [minEps, setMinEps] = useState(filter.minEps?.toString() ?? '');
  const [maxEps, setMaxEps] = useState(filter.maxEps?.toString() ?? '');

  // 바깥(적용 조건 한 줄의 ×, 초기화)에서 바뀐 값을 입력칸에 되돌려 놓는다.
  useEffect(() => { setMinEps(filter.minEps?.toString() ?? ''); setMaxEps(filter.maxEps?.toString() ?? ''); }, [filter.minEps, filter.maxEps]);
  useEffect(() => { setRuleText(filter.rule); if (filter.rule) setMode('rule'); }, [filter.rule]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? tagStats.filter(t => t.tag.toLowerCase().includes(s)) : tagStats;
  }, [q, tagStats]);

  const applyEps = () => onChange({ ...filter, minEps: toNum(minEps), maxEps: toNum(maxEps) });
  const pickMode = (m: Mode) => {
    setMode(m);
    if (m !== 'rule') onChange({ ...filter, tagMode: m, rule: '' });
  };
  const applyRule = () => onChange({ ...filter, rule: ruleText.trim(), tags: [] });
  const reset = () => { setQ(''); setRuleText(''); setMode('include-and'); onChange(resetFilter(filter)); onResetExtra?.(); };

  return (
    <Offcanvas show={open} onHide={onClose} placement="end" className="filter-drawer" aria-labelledby="filter-drawer-title">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title id="filter-drawer-title" className="filter-drawer__title">필터</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body className="filter-drawer__body">
        <section className="filter-drawer__group">
          <h3 className="filter-drawer__h">회차</h3>
          <div className="filter-drawer__range">
            <input inputMode="numeric" aria-label="최소 회차" value={minEps} onChange={e => setMinEps(e.target.value)}
              onBlur={applyEps} onKeyDown={e => e.key === 'Enter' && applyEps()} />
            <span>–</span>
            <input inputMode="numeric" aria-label="최대 회차" value={maxEps} onChange={e => setMaxEps(e.target.value)}
              onBlur={applyEps} onKeyDown={e => e.key === 'Enter' && applyEps()} />
            <span>화</span>
          </div>
        </section>

        {statusStats ? (
          <section className="filter-drawer__group">
            <h3 className="filter-drawer__h">연재 상태</h3>
            <div className="filter-drawer__statuses">
              {statusStats.map(({ status, count }) => {
                const on = (filter.statuses ?? []).includes(status);
                return (
                  <button key={status} type="button" aria-pressed={on} className={on ? 'is-on' : ''} onClick={() => onChange(toggleStatus(filter, status))}>
                    <span>{status}</span>{statusAvailable ? <i>{count}</i> : null}
                  </button>
                );
              })}
            </div>
            {!statusAvailable && (filter.statuses ?? []).length > 0 ? <p className="filter-drawer__notice">{SERIAL_STATUS_NOTICE}</p> : null}
          </section>
        ) : null}

        {extra ? <section className="filter-drawer__group">{extra}</section> : null}

        <section className="filter-drawer__group filter-drawer__group--tags">
          <h3 className="filter-drawer__h">태그</h3>
          <div className="filter-drawer__modes" role="radiogroup" aria-label="태그 조건">
            {MODES.map(m => (
              <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
                className={`filter-drawer__mode${mode === m.key ? ' is-on' : ''}`} onClick={() => pickMode(m.key)}>{m.label}</button>
            ))}
          </div>

          {mode === 'rule' ? (
            <div className="filter-drawer__rule">
              <input value={ruleText} onChange={e => setRuleText(e.target.value)} onKeyDown={e => e.key === 'Enter' && applyRule()}
                placeholder="(하렘 AND 순애) OR (TS AND NOT BL)" aria-label="태그 조건식" aria-invalid={!!error} />
              <button type="button" className="filter-drawer__rule-apply" onClick={applyRule}>적용</button>
              <p className={error ? 'filter-drawer__error' : 'filter-drawer__help'}>{error ?? 'AND · OR · NOT · 괄호를 쓸 수 있습니다. 엔터로 적용합니다.'}</p>
            </div>
          ) : (
            <>
              {filter.tags.length > 0 ? (
                <div className="filter-drawer__chosen">
                  {filter.tags.map(t => (
                    <button key={t} type="button" onClick={() => onChange(toggleTag(filter, t))} aria-label={`${t} 해제`}>
                      <b className={filter.tagMode === 'exclude' ? 'is-exclude' : ''}>{t}</b><i aria-hidden="true">×</i>
                    </button>
                  ))}
                </div>
              ) : null}
              <input className="filter-drawer__search" value={q} onChange={e => setQ(e.target.value)} placeholder={`태그 검색 · ${tagStats.length}개`} aria-label="태그 검색" />
              <ul className="filter-drawer__tags">
                {shown.map(({ tag, count }) => {
                  const on = filter.tags.includes(tag);
                  return (
                    <li key={tag}>
                      <button type="button" aria-pressed={on} className={on ? (filter.tagMode === 'exclude' ? 'is-exclude' : 'is-on') : ''}
                        onClick={() => onChange(toggleTag({ ...filter, tagMode: mode }, tag))}>
                        <span>{tag}</span><i>{count}</i>
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 ? <li className="filter-drawer__none">검색된 태그가 없습니다.</li> : null}
              </ul>
            </>
          )}
        </section>
      </Offcanvas.Body>
      <div className="filter-drawer__actions">
        <button type="button" className="filter-drawer__reset" onClick={reset}>초기화</button>
        <button type="button" className="filter-drawer__done" onClick={onClose}>{resultCount.toLocaleString('ko-KR')}편 보기</button>
      </div>
    </Offcanvas>
  );
}
