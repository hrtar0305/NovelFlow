import type { ColumnCondition, ColumnDef, ColumnKey } from '../../utils/columnConditions';

/** 공모전 필터의 '열 조건' — 열 · 이상/이하 · 값을 눌러 고른다(사용자 2026-10-18: 열은 정해져 있으니 입력이 아니라 클릭).
 *  값은 치는 대로 바로 걸린다(비우면 그 줄은 무시). 줄끼리는 모두 만족. */
export default function ColumnConditionEditor({ columns, value, onChange }: {
  columns: ColumnDef[]; value: ColumnCondition[]; onChange: (next: ColumnCondition[]) => void;
}) {
  const unitOf = (k: ColumnKey) => columns.find(c => c.key === k)?.unit ?? '';
  const set = (i: number, patch: Partial<ColumnCondition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...value, { key: columns.find(c => c.key === 'View')?.key ?? columns[0].key, op: 'gte', value: null }]);
  return (
    <div className="col-conds">
      {value.map((c, i) => (
        <div key={i} className="col-conds__row">
          <select aria-label="열" value={c.key} onChange={e => set(i, { key: e.target.value as ColumnKey })}>
            {columns.map(col => <option key={col.key} value={col.key}>{col.label}</option>)}
          </select>
          <select aria-label="비교" value={c.op} onChange={e => set(i, { op: e.target.value as ColumnCondition['op'] })}>
            <option value="gte">이상</option>
            <option value="lte">이하</option>
          </select>
          <input inputMode="decimal" aria-label="값" value={c.value ?? ''}
            onChange={e => { const v = parseFloat(e.target.value.replace(/[^\d.]/g, '')); set(i, { value: Number.isFinite(v) ? v : null }); }} />
          <span className="col-conds__unit">{unitOf(c.key)}</span>
          <button type="button" className="col-conds__del" aria-label="조건 빼기" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="link-button col-conds__add" onClick={add}>+ 조건 추가</button>
    </div>
  );
}
