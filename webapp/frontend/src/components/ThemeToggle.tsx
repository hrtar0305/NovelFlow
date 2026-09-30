import { Sun, Moon } from 'react-bootstrap-icons';
import { useTheme } from '../theme/themeContext';
import StableLabel from './ui/StableLabel';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle-btn"
      aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      <span className="theme-toggle-btn__icon">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</span>
      <StableLabel current={theme === 'dark' ? '라이트' : '다크'} options={['라이트', '다크']} />
    </button>
  );
};

export default ThemeToggle;
