/** 끊긴 선(connectNulls 끔)에서 앞뒤가 모두 비어 선분이 생기지 않는 점의 위치.
 *  이런 점은 점 표시를 끈 긴 기간 차트에서 아예 보이지 않으므로 따로 점을 찍어야 한다. */
export function isolatedIndices(values: (number | null)[]): number[] {
  const out: number[] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const before = i > 0 ? values[i - 1] : null;
    const after = i < values.length - 1 ? values[i + 1] : null;
    if (before == null && after == null) out.push(i);
  });
  return out;
}
