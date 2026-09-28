/** 상태에 따라 바뀌는 버튼 문구. 모든 후보를 한 칸에 겹쳐 두고 현재 것만 보여서,
 *  폭이 늘 가장 긴 문구 기준으로 고정된다 — 문구가 바뀌어도 옆 요소가 밀리지 않는다. */
export default function StableLabel({ current, options }: { current: string; options: string[] }) {
  return (
    <span className="stable-label">
      {options.map(o => (
        <span key={o} className={o === current ? undefined : 'stable-label__ghost'} aria-hidden={o === current ? undefined : true}>{o}</span>
      ))}
    </span>
  );
}
