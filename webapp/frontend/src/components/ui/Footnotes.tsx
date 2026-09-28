import type { ReactNode } from 'react';

const MARKS = '①②③④⑤⑥⑦⑧⑨';

/** 산식·해명은 헤딩 아래가 아니라 여기(표·섹션 끝)에만 둔다. */
export default function Footnotes({ notes }: { notes: ReactNode[] }) {
  return (
    <ol className="footnotes">
      {notes.map((n, i) => <li key={i}><span className="footnotes__mark" aria-hidden="true">{MARKS[i]}</span>{n}</li>)}
    </ol>
  );
}
