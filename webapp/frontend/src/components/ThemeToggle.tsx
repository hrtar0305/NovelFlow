import { SunFill, MoonFill } from 'react-bootstrap-icons';
import { useTheme } from '../theme/ThemeProvider';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle-btn"
      aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      {theme === 'dark'
        ? <><span className="theme-toggle-btn__icon"><SunFill size={14} /></span><span>라이트</span></>
        : <><span className="theme-toggle-btn__icon"><MoonFill size={14} /></span><span>다크</span></>
      }
    </button>
  );
};

export default ThemeToggle;
