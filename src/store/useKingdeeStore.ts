import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface KingdeeConnectionSettings {
  serverUrl: string;
  acctName: string;
  username: string;
  password: string;
}

interface KingdeeState extends KingdeeConnectionSettings {
  sessionId: string | null;
  userName: string | null;
  orgId: number | null;
  setSettings: (settings: KingdeeConnectionSettings) => void;
  setSession: (
    sessionId: string,
    userName?: string | null,
    orgId?: number | null,
  ) => void;
  clearSession: () => void;
  hasSettings: () => boolean;
}

export const useKingdeeStore = create<KingdeeState>()(
  persist(
    (set, get) => ({
      serverUrl: '',
      acctName: '',
      username: '',
      password: '',
      sessionId: null,
      userName: null,
      orgId: null,
      setSettings: (settings) =>
        set({ ...settings, sessionId: null, userName: null, orgId: null }),
      setSession: (sessionId, userName = null, orgId = null) =>
        set({ sessionId, userName, orgId }),
      clearSession: () => set({ sessionId: null, userName: null, orgId: null }),
      hasSettings: () => {
        const { serverUrl, acctName, username, password } = get();
        return Boolean(serverUrl && acctName && username && password);
      },
    }),
    {
      name: 'kingdee-session',
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        acctName: state.acctName,
        username: state.username,
        password: state.password,
        sessionId: state.sessionId,
        userName: state.userName,
        orgId: state.orgId,
      }),
    },
  ),
);
