import { db } from '@/lib/db';

export interface PersistedRecord {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const memory = new Map<string, Map<string, string>>();

function memoryNamespace(namespace: string): Map<string, string> {
  let bucket = memory.get(namespace);
  if (!bucket) {
    bucket = new Map();
    memory.set(namespace, bucket);
  }
  return bucket;
}

function memoryRecord(namespace: string): PersistedRecord {
  const bucket = memoryNamespace(namespace);
  const storageKey = (key: string) => `${namespace}:${key}`;
  const persistent =
    typeof localStorage !== 'undefined'
      ? {
          get: (key: string) => {
            try {
              return localStorage.getItem(storageKey(key));
            } catch {
              return null;
            }
          },
          set: (key: string, value: string) => {
            try {
              localStorage.setItem(storageKey(key), value);
            } catch {
              // Storage can be disabled or full; the in-memory copy still works.
            }
          },
          remove: (key: string) => {
            try {
              localStorage.removeItem(storageKey(key));
            } catch {
              // See set.
            }
          },
        }
      : null;
  return {
    get: (key) => bucket.get(key) ?? persistent?.get(key) ?? null,
    set: (key, value) => {
      bucket.set(key, value);
      persistent?.set(key, value);
    },
    remove: (key) => {
      bucket.delete(key);
      persistent?.remove(key);
    },
  };
}

const hydrated = new Map<string, Promise<void>>();

export function createRecord(namespace: string): PersistedRecord {
  if (!db.isAvailable()) {
    return memoryRecord(namespace);
  }
  const bucket = memoryNamespace(namespace);
  void whenHydrated(namespace);
  return {
    get: (key) => bucket.get(key) ?? null,
    set: (key, value) => {
      bucket.set(key, value);
      void db.put(namespace, key, value);
    },
    remove: (key) => {
      bucket.delete(key);
      void db.delete(namespace, key);
    },
  };
}

export function whenHydrated(namespace: string): Promise<void> {
  if (!db.isAvailable()) {
    return Promise.resolve();
  }
  let pending = hydrated.get(namespace);
  if (!pending) {
    pending = hydrate(namespace, memoryNamespace(namespace));
    hydrated.set(namespace, pending);
  }
  return pending;
}

async function hydrate(
  namespace: string,
  bucket: Map<string, string>,
): Promise<void> {
  try {
    for (const entry of await db.list(namespace)) {
      if (!bucket.has(entry.key)) {
        bucket.set(entry.key, entry.value);
      }
    }
  } catch {
    // The database is unavailable; the in-memory copy keeps working.
  }
}
