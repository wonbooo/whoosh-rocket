import { createContext, useContext } from 'react';
import type { LicenseStatus } from '@/features/license/types';

export interface LicenseContextValue {
  status: LicenseStatus;
  refresh: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export const LicenseProvider = LicenseContext.Provider;

export function useLicense(): LicenseContextValue | null {
  return useContext(LicenseContext);
}
