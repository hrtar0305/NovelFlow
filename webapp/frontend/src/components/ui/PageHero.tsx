import type { PropsWithChildren, ReactNode } from 'react';

interface PageHeroProps extends PropsWithChildren {
  eyebrow?: string;
  title: string;
  titleAction?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

function PageHero({ title, titleAction, description, actions, children }: PageHeroProps) {
  return (
    <section className="page-hero">
      <div className="page-hero__main">
        <div className="page-hero__row">
          <div className="page-hero__copy">
            <div className="page-hero__title-row">
              <h1 className="page-hero__title">{title}</h1>
              {titleAction ? <div className="page-hero__title-action">{titleAction}</div> : null}
            </div>
            {description ? <div className="page-hero__description">{description}</div> : null}
          </div>
          {actions ? <div className="page-hero__actions">{actions}</div> : null}
        </div>
      </div>
      {children ? <div className="page-hero__aside">{children}</div> : null}
    </section>
  );
}

export default PageHero;
