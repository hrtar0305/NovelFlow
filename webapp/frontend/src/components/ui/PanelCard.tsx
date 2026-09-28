import type { PropsWithChildren, ReactNode } from 'react';

interface PanelCardProps extends PropsWithChildren {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

function PanelCard({
  title,
  meta,
  actions,
  className = '',
  bodyClassName = '',
  children,
}: PanelCardProps) {
  return (
    <section className={`panel-card ${className}`.trim()}>
      {(title || meta || actions) ? (
        <header className="panel-card__header">
          <div className="panel-card__header-copy">
            {title ? <h2 className="panel-card__title">{title}</h2> : null}
            {meta ? <div className="panel-card__meta">{meta}</div> : null}
          </div>
          {actions ? <div className="panel-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`panel-card__body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}

export default PanelCard;
