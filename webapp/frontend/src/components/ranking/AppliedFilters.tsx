import type { ReactNode } from 'react';
import { activeFilterCount, resetFilter, toggleStatus, toggleTag, type RankingFilter } from '../../utils/rankingQuery';

const MODE_LABEL = { 'include-and': '모두 포함', 'include-or': '하나라도 포함', exclude: '제외' } as const;

type Extra = { key: string; label: ReactNode; onClear: () => void };

/** extra: 페이지 고유 조건(예: 공모전 '수상작만', 수치 조건 한 줄씩). 초기화하면 모두의 onClear 를 부른다. */
export default function AppliedFilters({ filter, onChange, extra = [] }: {
  filter: RankingFilter; onChange: (next: RankingFilter) => void;
  extra?: Extra[];
}) {
  if (activeFilterCount(filter) === 0 && extra.length === 0) return null;
  const eps = filter.minEps !== null || filter.maxEps !== null
    ? `${filter.minEps ?? 1}–${filter.maxEps ?? ''}화` : null;
  return (
    <div className="applied-filters" aria-label="적용 중인 조건">
      {filter.rule ? (
        <span className="applied-filters__part">조건식 <b>{filter.rule}</b>
          <button type="button" aria-label="조건식 해제" onClick={() => onChange({ ...filter, rule: '' })}>×</button></span>
      ) : filter.tags.length > 0 ? (
        <span className="applied-filters__part">태그
          {filter.tags.map(t => (
            <span key={t}> <b className={filter.tagMode === 'exclude' ? 'is-exclude' : ''}>{t}</b>
              <button type="button" aria-label={`${t} 해제`} onClick={() => onChange(toggleTag(filter, t))}>×</button></span>
          ))} {MODE_LABEL[filter.tagMode]}</span>
      ) : null}
      {(filter.statuses ?? []).length > 0 ? (
        <span className="applied-filters__part">연재 상태
          {filter.statuses.map(st => (
            <span key={st}> <b>{st}</b>
              <button type="button" aria-label={`${st} 해제`} onClick={() => onChange(toggleStatus(filter, st))}>×</button></span>
          ))}</span>
      ) : null}
      {extra.map(x => (
        <span key={x.key} className="applied-filters__part">{x.label}
          <button type="button" aria-label="조건 해제" onClick={x.onClear}>×</button></span>
      ))}
      {eps ? (
        <span className="applied-filters__part">회차 <b>{eps}</b>
          <button type="button" aria-label="회차 조건 해제" onClick={() => onChange({ ...filter, minEps: null, maxEps: null })}>×</button></span>
      ) : null}
      <button type="button" className="applied-filters__reset" onClick={() => { onChange(resetFilter(filter)); extra.forEach(x => x.onClear()); }}>초기화</button>
    </div>
  );
}
