import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  createRecord,
  whenHydrated,
  whenPersisted,
} from '@/lib/persistedRecord';
import { recordStorage } from '@/lib/recordStorage';

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
  setSettings: (settings: KingdeeConnectionSettings) => Promise<void>;
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
      setSettings: (settings) => {
        set({ ...settings, sessionId: null, userName: null, orgId: null });
        return whenPersisted('kingdee');
      },
      setSession: (sessionId, userName = null, orgId = null) =>
        set({ sessionId, userName, orgId }),
      clearSession: () => set({ sessionId: null, userName: null, orgId: null }),
      hasSettings: () => {
        const { serverUrl, acctName, username, password } = get();
        return Boolean(serverUrl && acctName && username && password);
      },
    }),
    {
      name: 'kingdee',
      storage: createJSONStorage(() => recordStorage(createRecord('kingdee'))),
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        acctName: state.acctName,
        username: state.username,
        password: state.password,
        sessionId: state.sessionId,
        userName: state.userName,
        orgId: state.orgId,
      }),
      skipHydration: true,
    },
  ),
);

void whenHydrated('kingdee')
  .then(() => {
    void useKingdeeStore.persist.rehydrate();
  })
  .catch(() => {
    // The settings dialog retries the load when it opens.
  });
