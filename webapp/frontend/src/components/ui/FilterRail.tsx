import type { PropsWithChildren, ReactNode } from 'react';

interface FilterRailProps extends PropsWithChildren {
  title?: ReactNode;
  className?: string;
}

function FilterRail({ title, className = '', children }: FilterRailProps) {
  return (
    <aside className={`filter-rail ${className}`.trim()}>
      {title ? <div className="filter-rail__title">{title}</div> : null}
      <div className="filter-rail__body">{children}</div>
    </aside>
  );
}

export default FilterRail;
