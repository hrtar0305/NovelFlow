import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useIsMobile } from '../../hooks/useIsMobile';

export interface RankColumn<T> {
  key: string;
  header: ReactNode;
  /** grid-template-columns 한 칸 (예: '64px', 'minmax(0,1.5fr)') */
  width: string;
  align?: 'left' | 'right' | 'center';
  sortKey?: string;
  /** 머리글 툴팁(산식). 터치 기기용으로는 표 아래 Footnotes에도 같은 문구를 둔다. */
  title?: string;
  render: (row: T) => ReactNode;
}

interface RankTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: RankColumn<T>[];
  sort?: { key: string; direction: 'ascending' | 'descending' };
  onSort?: (key: string) => void;
  expandedKey?: string | null;
  onToggleRow?: (row: T) => void;
  renderExpanded?: (row: T) => ReactNode;
  renderMobileRow: (row: T) => ReactNode;
  emptyText: string;
  rowHeight?: number;
  ariaLabel: string;
}

const ariaSort = (on: boolean, dir?: 'ascending' | 'descending') => (on ? dir : 'none') as 'ascending' | 'descending' | 'none';

export default function RankTable<T>(props: RankTableProps<T>) {
  const { rows, rowKey, columns, sort, onSort, expandedKey, onToggleRow, renderExpanded, renderMobileRow, emptyText, rowHeight = 60, ariaLabel } = props;
  const isMobile = useIsMobile();
  const listRef = useRef<HTMLDivElement>(null);
  // 창 스크롤 가상화는 목록이 문서 맨 위에서 얼마나 떨어져 있는지(scrollMargin)를 알아야 한다.
  // 위쪽 쇼케이스·적용 조건 줄이 늦게 그려져 목록이 밀리므로, 레이아웃 뒤에 재고 크기 변화마다 다시 잰다.
  const [scrollMargin, setScrollMargin] = useState(0);
  const isEmpty = rows.length === 0;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [isEmpty, isMobile]);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => (isMobile ? 112 : rowHeight),
    overscan: 8,
    scrollMargin,
  });
  const template = columns.map(c => c.width).join(' ');

  if (isEmpty) return <p className="empty-line">{emptyText}</p>;

  return (
    <div className="rank-table" role="table" aria-label={ariaLabel} aria-rowcount={rows.length}>
      {!isMobile ? (
        <div className="rank-table__head" role="row" style={{ gridTemplateColumns: template }}>
          {columns.map(c => {
            const on = !!c.sortKey && sort?.key === c.sortKey;
            return (
              <div key={c.key} role="columnheader" aria-sort={c.sortKey ? ariaSort(on, sort?.direction) : undefined}
                className={`rank-table__th is-${c.align ?? 'left'}${c.sortKey ? ' is-sortable' : ''}${on ? ' is-on' : ''}`} title={c.title}>
                {c.sortKey ? (
                  <button type="button" onClick={() => onSort?.(c.sortKey!)}>
                    {c.header}<span className="rank-table__sort" aria-hidden="true">{on ? (sort?.direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
                  </button>
                ) : c.header}
              </div>
            );
          })}
        </div>
      ) : null}
      <div ref={listRef} className="rank-table__body" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(v => {
          const row = rows[v.index];
          const key = rowKey(row);
          const open = expandedKey === key;
          return (
            <div key={key} data-index={v.index} ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}>
              {isMobile ? (
                <div className="rank-table__mrow" role="row">{renderMobileRow(row)}</div>
              ) : (
                <Fragment>
                  <div role="row" className={`rank-table__row${open ? ' is-open' : ''}${onToggleRow ? ' is-clickable' : ''}`}
                    style={{ gridTemplateColumns: template, minHeight: rowHeight }}
                    onClick={() => onToggleRow?.(row)} aria-expanded={renderExpanded ? open : undefined}>
                    {columns.map(c => <div key={c.key} role="cell" className={`rank-table__td is-${c.align ?? 'left'}`}>{c.render(row)}</div>)}
                  </div>
                  {open && renderExpanded ? <div className="rank-table__expand">{renderExpanded(row)}</div> : null}
                </Fragment>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
