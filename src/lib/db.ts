import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '@/apis/kingdee/transport';

export interface DbEntry {
  key: string;
  value: string;
}

export const db = {
  isAvailable: isTauriRuntime,

  get(namespace: string, key: string): Promise<string | null> {
    return invoke<string | null>('db_get', { namespace, key });
  },

  put(namespace: string, key: string, value: string): Promise<void> {
    return invoke<void>('db_put', { namespace, key, value });
  },

  delete(namespace: string, key: string): Promise<void> {
    return invoke<void>('db_delete', { namespace, key });
  },

  async list(namespace: string): Promise<DbEntry[]> {
    const rows = await invoke<[string, string][]>('db_list', { namespace });
    return rows.map(([key, value]) => ({ key, value }));
  },
};
