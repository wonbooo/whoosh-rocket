import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, expect, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  createRecord,
  whenHydrated,
  whenPersisted,
} from '@/lib/persistedRecord';

vi.mock('@/lib/db', () => ({
  db: {
    isAvailable: () => true,
    list: vi.fn(async () => []),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
  },
}));

beforeEach(() => {
  vi.mocked(db.list).mockReset();
  vi.mocked(db.put).mockReset();
  vi.mocked(db.list).mockResolvedValue([]);
  vi.mocked(db.put).mockResolvedValue(undefined);
});

describe('persisted settings', () => {
  it('reads settings back after the database load finishes', async () => {
    vi.mocked(db.list).mockResolvedValue([
      { key: 'kingdee', value: '{"serverUrl":"http://kd"}' },
    ]);

    const record = createRecord('settings-load');
    await whenHydrated('settings-load');

    expect(record.get('kingdee')).toBe('{"serverUrl":"http://kd"}');
  });

  it('retries a database load that failed', async () => {
    vi.mocked(db.list)
      .mockRejectedValueOnce(new Error('db_list not allowed'))
      .mockResolvedValueOnce([
        { key: 'kingdee', value: '{"serverUrl":"http://kd"}' },
      ]);

    await expect(whenHydrated('settings-retry')).rejects.toThrow(
      'db_list not allowed',
    );
    const record = createRecord('settings-retry');
    await whenHydrated('settings-retry');

    expect(record.get('kingdee')).toBe('{"serverUrl":"http://kd"}');
  });

  it('surfaces a failed write instead of dropping it', async () => {
    vi.mocked(db.put).mockRejectedValueOnce('db_put not allowed');
    const record = createRecord('settings-write');

    await expect(record.set('kingdee', '{"a":1}')).rejects.toBe(
      'db_put not allowed',
    );
    await expect(whenPersisted('settings-write')).rejects.toBe(
      'db_put not allowed',
    );
  });

  it('allows the desktop commands that store settings', () => {
    const capability = readFileSync(
      resolve('src-tauri/capabilities/default.json'),
      'utf8',
    );
    const permission = readFileSync(
      resolve('src-tauri/permissions/db.toml'),
      'utf8',
    );

    expect(capability).toContain('"allow-db"');
    expect(permission).toContain('identifier = "allow-db"');
    for (const command of ['db_get', 'db_put', 'db_delete', 'db_list']) {
      expect(permission).toContain(`"${command}"`);
    }
  });
});
