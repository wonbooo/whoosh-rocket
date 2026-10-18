import { kingdeeApi } from '@/apis/kingdee/api';
import { buildDateFilter, iterDateChunks } from '@/apis/kingdee/utils';
import { parseCatalog } from '@/features/analysis/catalog';
import { queryRange, type InspectLine } from '@/features/supplier/aggregate';
import {
  resolveInspectFields,
  type InspectFields,
} from '@/features/supplier/fields';

const FORM_ID = 'QM_InspectBill';

function isComplete(fields: Partial<InspectFields>): fields is InspectFields {
  return Boolean(
    fields.date &&
    fields.supplier &&
    fields.materialName &&
    fields.materialNumber &&
    fields.qualified &&
    fields.arrival &&
    fields.remark,
  );
}

function fieldKeyList(fields: InspectFields): string[] {
  const keys = [
    fields.date,
    fields.supplier,
    supplierNumberKey(fields.supplier),
    fields.materialName,
    fields.materialNumber,
    fields.qualified,
    fields.arrival,
    fields.remark,
  ];
  return keys.filter(
    (key, index) => key.length > 0 && keys.indexOf(key) === index,
  );
}

function supplierNumberKey(nameKey: string): string {
  return nameKey.endsWith('.FName')
    ? `${nameKey.slice(0, -'.FName'.length)}.FNumber`
    : '';
}

function cellAt(row: unknown, key: string, index: number): unknown {
  if (Array.isArray(row)) {
    return row[index];
  }
  if (!row || typeof row !== 'object') {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  const aliases = [key, key.replaceAll('.', '_')];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) {
      return record[alias];
    }
  }
  let current: unknown = record;
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function localizedText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = value.filter(
    (item): item is { Key?: unknown; Value?: unknown } =>
      Boolean(item) && typeof item === 'object' && 'Value' in item,
  );
  const preferred = entries.find((item) => item.Key === 2052) ?? entries[0];
  if (!preferred) {
    return null;
  }
  return preferred.Value == null ? '' : String(preferred.Value);
}

function asText(value: unknown): string {
  if (value == null) {
    return '';
  }
  const localized = localizedText(value);
  if (localized != null) {
    return localized;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const name = record.FName ?? record.Name ?? record.FNumber ?? record.Number;
    return name == null ? '' : asText(name);
  }
  return String(value);
}

function asQty(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replaceAll(',', ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function monthOf(value: unknown): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(asText(value).trim());
  return match ? `${match[1]}-${match[2]}` : null;
}

function toInspectLine(
  row: unknown,
  fields: InspectFields,
  keys: string[],
): InspectLine | null {
  const read = (key: string) => cellAt(row, key, keys.indexOf(key));
  const month = monthOf(read(fields.date));
  if (!month) {
    return null;
  }
  const supplierName = asText(read(fields.supplier)).trim();
  const supplierNumber = asText(
    read(supplierNumberKey(fields.supplier)),
  ).trim();
  return {
    supplier: supplierName || supplierNumber,
    materialNumber: asText(read(fields.materialNumber)).trim(),
    materialName: asText(read(fields.materialName)).trim(),
    month,
    qualifiedQty: asQty(read(fields.qualified)),
    arrivalQty: asQty(read(fields.arrival)),
    remark: asText(read(fields.remark)).trim(),
  };
}

export async function loadInspectLines(today: Date): Promise<InspectLine[]> {
  const catalog = parseCatalog(
    FORM_ID,
    await kingdeeApi.queryMetadata(FORM_ID),
  );
  const { fields, missing } = resolveInspectFields(catalog);
  if (!isComplete(fields)) {
    throw new Error(`检验单缺少字段：${missing.join('、')}`);
  }

  const range = queryRange(today);
  const keys = fieldKeyList(fields);
  const fieldKeys = keys.join(',');
  const rows: unknown[] = [];
  for (const [from, to] of iterDateChunks(
    range.dateFrom,
    range.dateTo,
    'month',
  )) {
    rows.push(
      ...(await queryChunk(
        buildDateFilter(fields.date, from, to, "FDocumentStatus = 'C'"),
        fieldKeys,
      )),
    );
  }

  return rows.flatMap((row) => {
    const line = toInspectLine(row, fields, keys);
    return line ? [line] : [];
  });
}

const PAGE_SIZE = 2000;
const MAX_ROWS = 20_000;

async function queryChunk(
  filterString: string,
  fieldKeys: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let startRow = 0;
  while (rows.length < MAX_ROWS) {
    const page = await kingdeeApi.queryBill<unknown>({
      formId: FORM_ID,
      fieldKeys,
      filterString,
      topCount: 0,
      startRow,
      limit: PAGE_SIZE,
    });
    rows.push(...page.rows);
    if (!page.truncated || page.rows.length === 0) {
      break;
    }
    startRow = page.nextStartRow ?? startRow + page.rows.length;
  }
  return rows;
}
