import { Eye, EyeSlash } from 'react-bootstrap-icons';
import { useCoverMask } from '../theme/coverMaskContext';
import StableLabel from './ui/StableLabel';

const CoverMaskToggle = () => {
  const { maskAll, toggleMaskAll } = useCoverMask();

  return (
    <button
      type="button"
      onClick={toggleMaskAll}
      className="theme-toggle-btn"
      aria-pressed={maskAll}
      aria-label={maskAll ? '모든 표지 보기' : '모든 표지 가리기'}
      title={maskAll ? '모든 표지를 다시 표시합니다' : '성인 여부와 무관하게 모든 표지를 가립니다'}
    >
      <span className="theme-toggle-btn__icon">
        {maskAll ? <EyeSlash size={15} /> : <Eye size={15} />}
      </span>
      <StableLabel current={maskAll ? '표지 숨김' : '표지 표시'} options={['표지 숨김', '표지 표시']} />
    </button>
  );
};

export default CoverMaskToggle;
