import { Component, type ReactNode } from 'react';

/**
 * 화면을 그리다 예외가 나면 앱 전체가 백지가 되던 것을 막는다(리뷰 #12·#47). 한 줄 문장 + 다시 시도.
 * 경로(`resetKey`)가 바뀌면 오류 상태만 지운다 — 한 화면의 오류가 다른 화면까지 막지 않게. `key` 로 다시 마운트하면
 * 날짜만 바꿔도(날짜가 경로라) 아래 화면이 통째로 새로 그려져 필터·정렬이 초기화됐다(최종 검증 2026-10-03).
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-shell">
        <p className="empty-line">화면을 그리다 문제가 생겼습니다. <button type="button" className="link-button" onClick={() => window.location.reload()}>다시 시도</button></p>
      </div>
    );
  }
}
