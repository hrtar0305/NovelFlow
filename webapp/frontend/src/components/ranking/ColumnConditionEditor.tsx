import { opsFor, type ColumnCondition, type ColumnDef, type ColumnKey } from '../../utils/columnConditions';

/** 공모전 필터의 '수치 조건' — 열 · 값 · 비교를 눌러 고른다(사용자 2026-10-18: 열은 정해져 있으니 입력이 아니라 클릭).
 *  한 줄은 한국어 어순 '누적 조회 [1000]회 [이상]', '일간 순위 [300]위 [이내]'. 값은 치는 대로 바로 걸린다(비우면 그 줄은 무시).
 *  줄끼리는 모두 만족. */
export default function ColumnConditionEditor({ columns, value, onChange }: {
  columns: ColumnDef[]; value: ColumnCondition[]; onChange: (next: ColumnCondition[]) => void;
}) {
  const unitOf = (k: ColumnKey) => columns.find(c => c.key === k)?.unit ?? '';
  const set = (i: number, patch: Partial<ColumnCondition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  // 열을 바꾸면 비교도 그 열의 기본값으로 — 순위(이내 · 밖)와 나머지(이상 · 이하)는 고를 수 있는 것이 다르다.
  const setKey = (i: number, key: ColumnKey) => set(i, { key, op: opsFor(key)[0].op });
  const add = () => {
    const key = columns.find(c => c.key === 'View')?.key ?? columns[0].key;
    onChange([...value, { key, op: opsFor(key)[0].op, value: null }]);
  };
  return (
    <div className="col-conds">
      {value.map((c, i) => (
        <div key={i} className="col-conds__row">
          <select aria-label="수치" value={c.key} onChange={e => setKey(i, e.target.value as ColumnKey)}>
            {columns.map(col => <option key={col.key} value={col.key}>{col.label}</option>)}
          </select>
          {/* 변동은 내려간 쪽(음수)도 걸 수 있게 '-' 를 남긴다. */}
          <input inputMode="decimal" aria-label="값" value={c.value ?? ''}
            onChange={e => { const v = parseFloat(e.target.value.replace(/[^\d.-]/g, '')); set(i, { value: Number.isFinite(v) ? v : null }); }} />
          <span className="col-conds__unit">{unitOf(c.key)}</span>
          <select aria-label="비교" value={c.op} onChange={e => set(i, { op: e.target.value as ColumnCondition['op'] })}>
            {opsFor(c.key).map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
          </select>
          <button type="button" className="col-conds__del" aria-label="조건 빼기" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="link-button col-conds__add" onClick={add}>+ 조건 추가</button>
    </div>
  );
}
