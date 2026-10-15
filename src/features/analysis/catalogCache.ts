import type { FieldCatalog, FieldKind } from '@/features/analysis/catalog';
import { createRecord, type PersistedRecord } from '@/lib/persistedRecord';

export interface CatalogScope {
  serverUrl: string;
  acctName: string;
}

const NAMESPACE = 'analysis-catalog';
const KINDS = new Set<FieldKind>(['date', 'lookup', 'enum', 'number', 'text']);

function normalizeServer(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** 没有服务器或账套时不缓存，避免不同账套的目录写到一起。 */
export function catalogCacheKey(
  scope: CatalogScope,
  formId: string,
): string | null {
  const server = normalizeServer(scope.serverUrl);
  const account = scope.acctName.trim();
  const form = formId.trim();
  if (!server || !account || !form) {
    return null;
  }
  return JSON.stringify([server, account, form]);
}

function isOption(value: unknown): value is { value: string; label: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const option = value as { value?: unknown; label?: unknown };
  return typeof option.value === 'string' && typeof option.label === 'string';
}

function isCatalog(value: unknown): value is FieldCatalog {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const catalog = value as Partial<FieldCatalog>;
  if (
    typeof catalog.formId !== 'string' ||
    typeof catalog.formName !== 'string'
  ) {
    return false;
  }
  if (!Array.isArray(catalog.fields)) {
    return false;
  }
  return catalog.fields.every((field) => {
    if (!field || typeof field !== 'object') {
      return false;
    }
    const item = field as Partial<FieldCatalog['fields'][number]>;
    return (
      typeof item.key === 'string' &&
      typeof item.name === 'string' &&
      typeof item.entity === 'string' &&
      typeof item.kind === 'string' &&
      KINDS.has(item.kind) &&
      (item.lookupFormId === null || typeof item.lookupFormId === 'string') &&
      Array.isArray(item.options) &&
      item.options.every(isOption)
    );
  });
}

export function readCatalogCache(
  scope: CatalogScope,
  formId: string,
  record: PersistedRecord = createRecord(NAMESPACE),
): FieldCatalog | null {
  const key = catalogCacheKey(scope, formId);
  if (!key) {
    return null;
  }
  const raw = record.get(key);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isCatalog(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCatalogCache(
  scope: CatalogScope,
  formId: string,
  catalog: FieldCatalog,
  record: PersistedRecord = createRecord(NAMESPACE),
): void {
  const key = catalogCacheKey(scope, formId);
  if (!key) {
    return;
  }
  record.set(key, JSON.stringify(catalog));
}
