import { db } from '@/lib/db';

export interface PersistedRecord {
  get(key: string): string | null;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
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
const pendingWrites = new Map<string, Promise<void>>();

function trackWrite(namespace: string, write: Promise<void>): Promise<void> {
  const previous = (pendingWrites.get(namespace) ?? Promise.resolve()).catch(
    () => undefined,
  );
  const tracked = previous.then(() => write);
  pendingWrites.set(namespace, tracked);
  void tracked.then(
    () => undefined,
    () => undefined,
  );
  return tracked;
}

export function whenPersisted(namespace: string): Promise<void> {
  return pendingWrites.get(namespace) ?? Promise.resolve();
}

export function createRecord(namespace: string): PersistedRecord {
  if (!db.isAvailable()) {
    return memoryRecord(namespace);
  }
  const bucket = memoryNamespace(namespace);
  void whenHydrated(namespace).catch(() => {
    // A rejected load is dropped so the next attempt can try again.
  });
  return {
    get: (key) => bucket.get(key) ?? null,
    set: (key, value) => {
      bucket.set(key, value);
      return trackWrite(namespace, db.put(namespace, key, value));
    },
    remove: (key) => {
      bucket.delete(key);
      return trackWrite(namespace, db.delete(namespace, key));
    },
  };
}

export function whenHydrated(namespace: string): Promise<void> {
  if (!db.isAvailable()) {
    return Promise.resolve();
  }
  let pending = hydrated.get(namespace);
  if (!pending) {
    pending = hydrate(namespace, memoryNamespace(namespace)).catch(
      (error: unknown) => {
        hydrated.delete(namespace);
        throw error;
      },
    );
    hydrated.set(namespace, pending);
  }
  return pending;
}

async function hydrate(
  namespace: string,
  bucket: Map<string, string>,
): Promise<void> {
  for (const entry of await db.list(namespace)) {
    if (!bucket.has(entry.key)) {
      bucket.set(entry.key, entry.value);
    }
  }
}
