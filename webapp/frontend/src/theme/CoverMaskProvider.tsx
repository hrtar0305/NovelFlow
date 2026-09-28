import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'coverMask';

type CoverMaskContextValue = {
  /**
   * true(기본값)면 모든 표지를 가린다. false로 내리면 표지가 보이고, 개별 카드의
   * 토글로 다시 가릴 수 있다. 성인작도 같은 규칙을 따른다(전용 단계 없음).
   */
  maskAll: boolean;
  toggleMaskAll: () => void;
};

const CoverMaskContext = createContext<CoverMaskContextValue | undefined>(undefined);

const getInitialMaskAll = (): boolean => {
  // 기본값은 '가리기 켜짐'이다. 첫 방문자와 스크린샷 촬영 시 표지가 노출되지 않도록
  // 안전한 쪽을 기본으로 두고, 사용자가 명시적으로 해제한 경우에만 표시한다.
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // 프라이빗 모드 등에서 storage 접근이 예외를 던질 수 있다.
    return true;
  }
};

export const CoverMaskProvider = ({ children }: { children: ReactNode }) => {
  const [maskAll, setMaskAll] = useState<boolean>(getInitialMaskAll);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, maskAll ? 'on' : 'off');
    } catch {
      // 저장 실패는 무시한다 — 현재 세션 동작에는 영향이 없다.
    }
  }, [maskAll]);

  const toggleMaskAll = useCallback(() => setMaskAll((prev) => !prev), []);

  const value = useMemo(() => ({ maskAll, toggleMaskAll }), [maskAll, toggleMaskAll]);

  return <CoverMaskContext.Provider value={value}>{children}</CoverMaskContext.Provider>;
};

export const useCoverMask = (): CoverMaskContextValue => {
  const context = useContext(CoverMaskContext);
  if (!context) {
    throw new Error('useCoverMask must be used within a CoverMaskProvider');
  }
  return context;
};
