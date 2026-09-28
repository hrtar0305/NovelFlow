import { describeRankChange, type RankChangeValue } from '../../utils/rankChange';

export default function ChangeMark({ value }: { value: RankChangeValue }) {
  const v = describeRankChange(value);
  return (
    <span className={`change-mark change-mark--${v.kind}`} title={v.label} aria-label={v.label}>
      {v.text}
    </span>
  );
}
