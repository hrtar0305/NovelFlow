import {
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { ThemeContext, type ThemeContextValue, type ThemeMode } from './themeContext';

const THEME_BG_COLORS: Record<ThemeMode, string> = {
  dark: '#121418',
  light: '#ffffff',
};

function getInitialTheme(): ThemeMode {
  // 프라이빗 모드·사이트 데이터 차단 등에서 storage 접근이 예외를 던질 수 있다(CoverMaskProvider와 같은 이유).
  let persistedTheme: string | null = null;
  try { persistedTheme = window.localStorage.getItem('theme'); } catch { /* storage 차단 시 무시 */ }
  if (persistedTheme === 'dark' || persistedTheme === 'light') {
    return persistedTheme;
  }

  const existingTheme = document.documentElement.getAttribute('data-theme');
  if (existingTheme === 'dark' || existingTheme === 'light') {
    return existingTheme;
  }

  return 'dark';
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);

    const bgColor = THEME_BG_COLORS[theme];
    root.style.backgroundColor = bgColor;
    document.body.style.backgroundColor = bgColor;
    try { window.localStorage.setItem('theme', theme); } catch { /* 저장 실패 무시 */ }

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

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => {
        setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
