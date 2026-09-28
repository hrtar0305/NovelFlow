import type { ReactNode } from 'react';
import { jumpTo } from '../../utils/footnoteJump';

export interface Footnote { id: string; content: ReactNode; }

/** 책 주석. 본문의 작은 번호(FootnoteRef)를 누르면 여기로 오고, ↩로 돌아간다.
 *  번호는 notes 순서(1, 2, …)이며 FootnoteRef의 n과 맞춰 쓴다. */
export default function Footnotes({ notes }: { notes: Footnote[] }) {
  return (
    <ol className="footnotes">
      {notes.map((n, i) => (
        <li key={n.id} id={`fn-${n.id}`} tabIndex={-1}>
          <span className="footnotes__mark">{i + 1}</span>
          {n.content}
          <a href={`#fnref-${n.id}`} className="footnotes__back" onClick={jumpTo(`fnref-${n.id}`)} aria-label="본문으로 돌아가기">↩</a>
        </li>
      ))}
    </ol>
  );
}

/** 본문 쪽 주석 번호. 누르면 해당 주석으로 이동한다. */
export function FootnoteRef({ id, n }: { id: string; n: number }) {
  return (
    <sup className="fn-ref">
      <a id={`fnref-${id}`} href={`#fn-${id}`} onClick={jumpTo(`fn-${id}`)} aria-label={`주석 ${n}`}>{n}</a>
    </sup>
  );
}
