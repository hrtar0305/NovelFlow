import { createContext, useContext } from 'react';

export type CoverMaskContextValue = {
  /**
   * true(기본값)면 모든 표지를 가린다. false로 내리면 표지가 보이고, 개별 카드의
   * 토글로 다시 가릴 수 있다. 성인작도 같은 규칙을 따른다(전용 단계 없음).
   */
  maskAll: boolean;
  toggleMaskAll: () => void;
};

export const CoverMaskContext = createContext<CoverMaskContextValue | undefined>(undefined);

export const useCoverMask = (): CoverMaskContextValue => {
  const context = useContext(CoverMaskContext);
  if (!context) {
    throw new Error('useCoverMask must be used within a CoverMaskProvider');
  }
  return context;
};
