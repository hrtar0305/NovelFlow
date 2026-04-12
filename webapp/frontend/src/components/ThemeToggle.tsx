import { useState, useEffect } from 'react';
import { SunFill, MoonFill } from 'react-bootstrap-icons';

const ThemeToggle = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    // 테마 전환 직전에 모든 transition을 일시 차단해 "snap change"로 만들고,
    // 색/배경 변화가 수백 개 요소에서 150ms 동안 animated repaint 되는 것을 막는다.
    // (DOM 규모가 큰 페이지에서 테마 토글이 거의 먹통이 되는 문제의 근본 해결)
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);
    const bgColor = theme === 'light' ? '#eef4fc' : '#0b1622';
    root.style.backgroundColor = bgColor;
    document.body.style.backgroundColor = bgColor;
    localStorage.setItem('theme', theme);

    // iOS Safari Dynamic Island / status bar 배경색 동기화.
    // Safari는 단일 theme-color meta의 content 변경/노드 재생성/scroll perturbation으로
    // chrome(상단 status bar / Dynamic Island)을 안정적으로 갱신하지 않는 알려진 버그가 있다.
    // 우회: index.html에 두 개의 theme-color meta(dark/light)를 미리 등록해 두고,
    // 활성/비활성을 media="all" ↔ media="not all" 로 swap한다.
    // Safari는 이 media 속성 변경에는 안정적으로 반응한다.
    const darkMeta = document.getElementById('theme-color-dark');
    const lightMeta = document.getElementById('theme-color-light');
    if (darkMeta && lightMeta) {
      if (theme === 'light') {
        lightMeta.setAttribute('media', 'all');
        darkMeta.setAttribute('media', 'not all');
      } else {
        darkMeta.setAttribute('media', 'all');
        lightMeta.setAttribute('media', 'not all');
      }
    }

    // 다음 페인트가 끝난 뒤 transition 차단을 해제한다.
    // requestAnimationFrame 두 번으로 현재 프레임의 paint 완료 후 실행을 보장.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        root.classList.remove('theme-switching');
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      root.classList.remove('theme-switching');
    };
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
