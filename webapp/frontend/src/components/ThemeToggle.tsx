import { useState, useEffect } from 'react';
import { SunFill, MoonFill } from 'react-bootstrap-icons';

const ThemeToggle = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <button
      onClick={toggle}
      className="theme-toggle-btn"
      aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      {theme === 'dark'
        ? <><SunFill size={13} /><span>라이트</span></>
        : <><MoonFill size={13} /><span>다크</span></>
      }
    </button>
  );
};

export default ThemeToggle;
