import { Link } from 'react-router-dom';

export interface ViewSwitchItem { to: string; label: string; on: boolean; }

/** 제목 줄 오른쪽의 보기 전환(공모전 작품 / 태그, 태그 오늘 / 기간 트렌드). 탭이 아니라 페이지 이동이다. */
export default function ViewSwitch({ items, label }: { items: ViewSwitchItem[]; label: string }) {
  return (
    <nav className="view-switch" aria-label={label}>
      {items.map(i => (
        <Link key={i.to} to={i.to} className={i.on ? 'is-on' : undefined} aria-current={i.on ? 'page' : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
