import type { CSSProperties, ReactNode } from 'react';

/**
 * 로딩 중에 요소를 지우지 않는다(2026-10-18 사용자). 날짜·기간을 바꾸는 동안 이전 값을 흐리게 둔 채,
 * 새 값이 오면 바꿔 끼운다 — 블록이 사라졌다 나타나며 아래가 밀리던 것을 없앤다. 처음처럼 이전 값이 없으면 평소 크기의 빈 틀(Skeleton*)을 둔다.
 */
export function Stale({ loading, children, className }: { loading: boolean; children: ReactNode; className?: string }) {
  return <div className={['stale', loading ? 'is-stale' : '', className ?? ''].filter(Boolean).join(' ')} aria-busy={loading || undefined}>{children}</div>;
}

/** 표 자리의 빈 줄들. */
export function SkeletonRows({ n = 10, height }: { n?: number; height?: number }) {
  return <div className="rank-skeleton" aria-busy="true">{Array.from({ length: n }, (_, i) => <div key={i} style={height ? { height } : undefined} />)}</div>;
}

/** 블록 자리의 빈 틀(지도·칩·섹션). 크기는 쓰는 곳의 class 나 style 이 정한다. */
export function SkeletonBox({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={['skeleton-box', className ?? ''].filter(Boolean).join(' ')} style={style} aria-hidden="true" />;
}
