import type { ReactNode } from 'react';

export interface TabItem<K extends string> { key: K; label: string; count?: number; }

interface TabBarProps<K extends string> { items: TabItem<K>[]; value: K; onChange: (key: K) => void; ariaLabel: string; children?: ReactNode; }

export default function TabBar<K extends string>({ items, value, onChange, ariaLabel, children }: TabBarProps<K>) {
  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs" role="tablist" aria-label={ariaLabel}>
        {items.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === value}
            className={`tab-bar__tab${t.key === value ? ' is-on' : ''}`} onClick={() => onChange(t.key)}>
            {t.label}{t.count != null ? <span className="tab-bar__count">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {children ? <div className="tab-bar__tools">{children}</div> : null}
    </div>
  );
}
