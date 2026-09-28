import type { PropsWithChildren, ReactNode } from 'react';

interface DataTableShellProps extends PropsWithChildren {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

function DataTableShell({ title, description, actions, className = '', children }: DataTableShellProps) {
  return (
    <section className={`data-table-shell ${className}`.trim()}>
      {(title || description || actions) ? (
        <header className="data-table-shell__header">
          <div className="data-table-shell__copy">
            {title ? <h2 className="data-table-shell__title">{title}</h2> : null}
            {description ? <p className="data-table-shell__description">{description}</p> : null}
          </div>
          {actions ? <div className="data-table-shell__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="data-table-shell__body">{children}</div>
    </section>
  );
}

export default DataTableShell;
