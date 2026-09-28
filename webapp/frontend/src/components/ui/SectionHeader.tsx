import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

function SectionHeader({ title, description, actions }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div className="section-header__copy">
        <h2 className="section-header__title">{title}</h2>
        {description ? <div className="section-header__description">{description}</div> : null}
      </div>
      {actions ? <div className="section-header__actions">{actions}</div> : null}
    </div>
  );
}

export default SectionHeader;
