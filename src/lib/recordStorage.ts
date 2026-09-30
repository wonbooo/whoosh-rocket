import type { StateStorage } from 'zustand/middleware';
import type { PersistedRecord } from '@/lib/persistedRecord';

export function recordStorage(record: PersistedRecord): StateStorage {
  return {
    getItem: (name) => record.get(name),
    setItem: (name, value) => record.set(name, value),
    removeItem: (name) => record.remove(name),
  };
}
