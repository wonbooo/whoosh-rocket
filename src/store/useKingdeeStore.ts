import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface KingdeeState {
  sessionId: string | null;
  userName: string | null;
  setSession: (sessionId: string, userName?: string | null) => void;
  clearSession: () => void;
}

export const useKingdeeStore = create<KingdeeState>()(
  persist(
    (set) => ({
      sessionId: null,
      userName: null,
      setSession: (sessionId, userName = null) => set({ sessionId, userName }),
      clearSession: () => set({ sessionId: null, userName: null }),
    }),
    {
      name: 'kingdee-session',
    },
  ),
);
