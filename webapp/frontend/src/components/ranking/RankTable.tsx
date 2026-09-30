import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useMediaQuery } from '../../hooks/useIsMobile';

export interface RankColumn<T> {
  key: string;
  header: ReactNode;
  /** grid-template-columns 한 칸 (예: '64px', 'minmax(0,1.5fr)') */
  width: string;
  align?: 'left' | 'right' | 'center';
  sortKey?: string;
  /** 머리글 툴팁(산식). 터치 기기용으로는 표 아래 Footnotes에도 같은 문구를 둔다. */
  title?: string;
  /** 머리글 옆 주석 번호 등. 정렬 버튼 밖에 둔다(버튼 안에 링크를 넣지 않는다). */
  aside?: ReactNode;
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
  /** 이 폭(px) 미만이면 표 대신 renderMobileRow로 그린다. 열이 많은 표는 md(768)보다 넓게 잡는다. */
  compactBelow?: number;
  /** 행에 마우스가 올라가거나(행) 표를 벗어날 때(null). 표와 짝인 차트를 강조할 때 쓴다. */
  onRowHover?: (row: T | null) => void;
}

const ariaSort = (on: boolean, dir?: 'ascending' | 'descending') => (on ? dir : 'none') as 'ascending' | 'descending' | 'none';

export default function RankTable<T>(props: RankTableProps<T>) {
  const { rows, rowKey, columns, sort, onSort, expandedKey, onToggleRow, renderExpanded, renderMobileRow, emptyText, rowHeight = 60, ariaLabel, compactBelow = 768, onRowHover } = props;
  const isMobile = useMediaQuery(`(max-width: ${compactBelow - 0.02}px)`);
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
                  // 이름 → 주석 번호 → 정렬 표시 순서. 주석 링크를 버튼 안에 넣을 수 없어 버튼을 나눴다.
                  // 정렬 표시도 눌리지만 키보드·낭독에서는 빼서 같은 버튼이 두 번 잡히지 않게 한다.
                  <>
                    <button type="button" onClick={() => onSort?.(c.sortKey!)}>{c.header}</button>
                    {c.aside}
                    <button type="button" className="rank-table__sort" tabIndex={-1} aria-hidden="true" onClick={() => onSort?.(c.sortKey!)}>
                      {on ? (sort?.direction === 'ascending' ? '↑' : '↓') : '↕'}
                    </button>
                  </>
                ) : <>{c.header}{c.aside}</>}
              </div>
            );
          })}
        </div>
      ) : null}
      <div ref={listRef} className="rank-table__body" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}>
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
                    onClick={() => onToggleRow?.(row)} aria-expanded={renderExpanded ? open : undefined}
                    onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}>
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
