import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="page-shell">
      <p className="empty-line">페이지를 찾을 수 없습니다. <Link to="/novels/rankings">일간 랭킹으로 가기</Link></p>
    </div>
  );
}
