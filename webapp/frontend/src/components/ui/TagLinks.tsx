import { Link } from 'react-router-dom';

interface TagLinksProps {
  tags: string[];
  highlighted?: ReadonlySet<string>;
  limit?: number;
  /** 누르면 필터에 추가(표 안). hrefFor가 있으면 그 주소로 이동(상세 등). */
  onSelect?: (tag: string) => void;
  hrefFor?: (tag: string) => string;
}

export default function TagLinks({ tags, highlighted, limit = 3, onSelect, hrefFor }: TagLinksProps) {
  const shown = tags.slice(0, limit);
  const rest = tags.length - shown.length;
  return (
    <span className="tag-links">
      {shown.map(t => {
        const cls = `tag-links__tag${highlighted?.has(t) ? ' is-hit' : ''}`;
        if (hrefFor) return <Link key={t} to={hrefFor(t)} className={cls}>#{t}</Link>;
        return (
          <button key={t} type="button" className={cls}
            onClick={(e) => { e.stopPropagation(); onSelect?.(t); }} aria-pressed={highlighted?.has(t) ?? false}>#{t}</button>
        );
      })}
      {rest > 0 ? <span className="tag-links__more" title={tags.slice(limit).join(', ')}>+{rest}</span> : null}
    </span>
  );
}
