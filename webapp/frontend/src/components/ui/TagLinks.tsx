import { Link } from 'react-router-dom';

interface TagLinksProps {
  tags: string[];
  highlighted?: ReadonlySet<string>;
  /** 누르면 필터에 추가(표 안). hrefFor가 있으면 그 주소로 이동(상세 등). */
  onSelect?: (tag: string) => void;
  hrefFor?: (tag: string) => string;
}

/** 태그를 줄바꿈해 모두 보인다. */
export default function TagLinks({ tags, highlighted, onSelect, hrefFor }: TagLinksProps) {
  return (
    <span className="tag-links">
      {tags.map(t => {
        const cls = `tag-links__tag${highlighted?.has(t) ? ' is-hit' : ''}`;
        if (hrefFor) return <Link key={t} to={hrefFor(t)} className={cls}>#{t}</Link>;
        return (
          <button key={t} type="button" className={cls}
            onClick={(e) => { e.stopPropagation(); onSelect?.(t); }} aria-pressed={highlighted?.has(t) ?? false}>#{t}</button>
        );
      })}
    </span>
  );
}
