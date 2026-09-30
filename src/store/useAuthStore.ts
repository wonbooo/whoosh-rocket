import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createRecord, whenHydrated } from '@/lib/persistedRecord';
import { recordStorage } from '@/lib/recordStorage';
import type { UserInfo } from '@/types/user';

interface AuthState {
  token: string | null;
  userInfo: UserInfo | null;
  setToken: (token: string) => void;
  setUserInfo: (userInfo: UserInfo | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userInfo: null,
      setToken: (token) => set({ token }),
      setUserInfo: (userInfo) => set({ userInfo }),
      logout: () => set({ token: null, userInfo: null }),
    }),
    {
      name: 'auth',
      storage: createJSONStorage(() => recordStorage(createRecord('auth'))),
      skipHydration: true,
    },
  ),
);

void whenHydrated('auth').then(() => {
  void useAuthStore.persist.rehydrate();
});
