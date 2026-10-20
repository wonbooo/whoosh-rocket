import * as XLSX from 'xlsx';
import type { PersistedRecord } from '@/lib/persistedRecord';

const STORAGE_KEY = 'months';

const REQUIRED_COLUMNS = [
  ['supplier', '厂家'],
  ['quantity', '数量（个）'],
  ['solution', '处理方案'],
  ['companyPay', '我司赔付金额'],
  ['factoryPay', '厂家赔付金额'],
  ['category', '产品问题大类'],
  ['registeredAt', '登记日期'],
] as const;

type ColumnKey = (typeof REQUIRED_COLUMNS)[number][0];

const MISSING_TOKENS = new Set(['-', '—', '–', '－', '/', '／']);

export interface ComplaintEvent {
  supplier: string;
  quantity: number | null;
  companyPay: number | null;
  factoryPay: number | null;
  category: string;
  pending: boolean;
}

export interface AftersaleMonth {
  month: string;
  events: ComplaintEvent[];
  sheet?: AftersaleSheet;
}

export interface AftersaleSheet {
  headers: string[];
  rows: string[][];
}

export interface SupplierSummary {
  supplier: string;
  eventCount: number;
  quantity: number;
  categories: string;
  closure: string;
  companyPay: number | null;
  factoryPay: number | null;
  companyPayText: string;
  factoryPayText: string;
  payRateText: string;
}

export interface NamedValue {
  name: string;
  value: number;
}

interface RawCell {
  value: unknown;
  text: string;
}

export function normalizeSupplier(raw: string): string {
  return raw.replace(/[\r\n]+/g, '').trim();
}

export function parseAftersaleQualityWorkbook(
  data: ArrayBuffer | Uint8Array,
): AftersaleMonth {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array' });
  } catch {
    throw new Error('无法读取 Excel。');
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet?.['!ref']) {
    throw new Error('Excel 为空。');
  }
  return parseSheet(sheet);
}

export function supplierSummaries(events: ComplaintEvent[]): SupplierSummary[] {
  const groups = new Map<string, ComplaintEvent[]>();
  for (const event of events) {
    const list = groups.get(event.supplier);
    if (list) {
      list.push(event);
    } else {
      groups.set(event.supplier, [event]);
    }
  }
  const rows = [...groups.entries()].map(([supplier, list]) =>
    summarizeSupplier(supplier, list),
  );
  rows.sort((left, right) => {
    const pay = payRank(right.factoryPay) - payRank(left.factoryPay);
    if (pay !== 0) {
      return pay;
    }
    if (right.eventCount !== left.eventCount) {
      return right.eventCount - left.eventCount;
    }
    return left.supplier.localeCompare(right.supplier, 'zh');
  });
  return rows;
}

export function factoryPaySlices(rows: SupplierSummary[]): NamedValue[] {
  return rows
    .filter((row) => row.factoryPay != null && row.factoryPay > 0)
    .map((row) => ({ name: row.supplier, value: row.factoryPay ?? 0 }))
    .sort(
      (left, right) =>
        right.value - left.value || left.name.localeCompare(right.name, 'zh'),
    );
}

export function complaintBars(rows: SupplierSummary[]): NamedValue[] {
  return [...rows]
    .sort((left, right) => {
      if (right.eventCount !== left.eventCount) {
        return right.eventCount - left.eventCount;
      }
      const pay = payRank(right.factoryPay) - payRank(left.factoryPay);
      if (pay !== 0) {
        return pay;
      }
      return left.supplier.localeCompare(right.supplier, 'zh');
    })
    .map((row) => ({ name: row.supplier, value: row.eventCount }));
}

export function loadAftersaleMonths(record: PersistedRecord): AftersaleMonth[] {
  const raw = record.get(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isAftersaleMonth)
      .map(sanitizeMonth)
      .sort((left, right) => left.month.localeCompare(right.month));
  } catch {
    return [];
  }
}

export async function saveAftersaleMonth(
  record: PersistedRecord,
  month: AftersaleMonth,
): Promise<AftersaleMonth[]> {
  const next = [
    ...loadAftersaleMonths(record).filter((item) => item.month !== month.month),
    month,
  ].sort((left, right) => left.month.localeCompare(right.month));
  await record.set(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function parseSheet(sheet: XLSX.WorkSheet): AftersaleMonth {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const headers: string[] = [];
  const displayHeaders: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const label = cellString(readCell(sheet, 1, column)).trim();
    displayHeaders[column] = label;
    headers[column] = label.replace(/\s+/g, '');
  }
  const columns = new Map<ColumnKey, number>();
  const missing: string[] = [];
  for (const [key, label] of REQUIRED_COLUMNS) {
    const index = headers.findIndex((header) => header === label);
    if (index < 0) {
      missing.push(label);
    } else {
      columns.set(key, index);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Excel 表头需包含${missing.join('、')}。`);
  }

  const events: ComplaintEvent[] = [];
  const sheetRows: string[][] = [];
  const months = new Set<string>();
  for (let row = 2; row <= range.e.r; row += 1) {
    if (rowIsEmpty(sheet, row, range)) {
      continue;
    }
    const cells: string[] = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      cells.push(
        cellString(readCell(sheet, row, column))
          .replace(/\r?\n/g, ' ')
          .trim(),
      );
    }
    sheetRows.push(cells);
    const event = readEvent(sheet, row, columns);
    if (!event) {
      continue;
    }
    events.push(event.event);
    months.add(event.month);
  }
  if (events.length === 0) {
    throw new Error('Excel 没有客诉数据。');
  }
  if (months.size !== 1) {
    throw new Error(
      `一份表格只能包含一个年月，当前有 ${[...months].sort().join('、')}。`,
    );
  }
  return {
    month: [...months][0] ?? '',
    events,
    sheet: trimSheet(displayHeaders, sheetRows),
  };
}

function readEvent(
  sheet: XLSX.WorkSheet,
  row: number,
  columns: Map<ColumnKey, number>,
): { event: ComplaintEvent; month: string } | null {
  const supplierCell = readCell(sheet, row, columns.get('supplier') ?? -1);
  const quantityCell = readCell(sheet, row, columns.get('quantity') ?? -1);
  const solutionCell = readCell(sheet, row, columns.get('solution') ?? -1);
  const companyCell = readCell(sheet, row, columns.get('companyPay') ?? -1);
  const factoryCell = readCell(sheet, row, columns.get('factoryPay') ?? -1);
  const categoryCell = readCell(sheet, row, columns.get('category') ?? -1);
  const dateCell = readCell(sheet, row, columns.get('registeredAt') ?? -1);
  const supplier = normalizeSupplier(cellString(supplierCell));
  const quantityText = cellString(quantityCell).trim();
  const solutionText = cellString(solutionCell).trim();
  const companyText = cellString(companyCell).trim();
  const factoryText = cellString(factoryCell).trim();
  const category = firstSegment(categoryCell);
  const dateText = cellString(dateCell).trim();
  if (
    !supplier &&
    !quantityText &&
    !solutionText &&
    !companyText &&
    !factoryText &&
    !category &&
    !dateText &&
    !numericValue(quantityCell) &&
    !numericValue(companyCell) &&
    !numericValue(factoryCell) &&
    !numericValue(dateCell)
  ) {
    return null;
  }
  if (!supplier) {
    throw new Error(`第 ${row + 1} 行缺少厂家。`);
  }
  let month = '';
  try {
    month = yearMonth(dateCell);
  } catch (error) {
    const message = error instanceof Error ? error.message : '登记日期无效';
    throw new Error(`第 ${row + 1} 行${message}。`);
  }
  return {
    month,
    event: {
      supplier,
      quantity: parseQuantity(quantityCell, row),
      companyPay: parseAmount(companyCell, row, '我司赔付金额'),
      factoryPay: parseAmount(factoryCell, row, '厂家赔付金额'),
      category,
      pending: solutionText === '待跟进',
    },
  };
}

function summarizeSupplier(
  supplier: string,
  events: ComplaintEvent[],
): SupplierSummary {
  let quantity = 0;
  let companyCents: number | null = null;
  let factoryCents: number | null = null;
  let pending = 0;
  const categories = new Map<string, number>();
  for (const event of events) {
    if (event.quantity != null) {
      quantity += event.quantity;
    }
    if (event.companyPay != null) {
      companyCents = (companyCents ?? 0) + toCents(event.companyPay);
    }
    if (event.factoryPay != null) {
      factoryCents = (factoryCents ?? 0) + toCents(event.factoryPay);
    }
    if (event.pending) {
      pending += 1;
    }
    if (event.category) {
      categories.set(event.category, (categories.get(event.category) ?? 0) + 1);
    }
  }
  const companyPay = companyCents == null ? null : companyCents / 100;
  const factoryPay = factoryCents == null ? null : factoryCents / 100;
  const closed = events.length - pending;
  return {
    supplier,
    eventCount: events.length,
    quantity,
    categories: categoryText(categories),
    closure: `已结案 ${closed}个，待跟进 ${pending}个`,
    companyPay,
    factoryPay,
    companyPayText: formatMoney(companyPay),
    factoryPayText: formatMoney(factoryPay),
    payRateText: formatRate(companyPay, factoryPay),
  };
}

function categoryText(categories: Map<string, number>): string {
  const parts = [...categories.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0], 'zh');
  });
  if (parts.length === 0) {
    return '—';
  }
  return parts.map(([name, count]) => `${name} ${count}个`).join('、');
}

function formatMoney(value: number | null): string {
  if (value == null) {
    return '—';
  }
  return value.toFixed(2);
}

function formatRate(company: number | null, factory: number | null): string {
  if (company == null || company === 0 || factory == null) {
    return '—';
  }
  return `${((factory / company) * 100).toFixed(2)}%`;
}

function payRank(value: number | null): number {
  return value == null ? Number.NEGATIVE_INFINITY : value;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function parseQuantity(cell: RawCell, row: number): number | null {
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    return cell.value;
  }
  const source = cellString(cell).trim();
  if (!source) {
    return null;
  }
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const numbers: number[] = [];
  for (const line of lines) {
    if (MISSING_TOKENS.has(line)) {
      continue;
    }
    const value = Number(line.replace(/,/g, ''));
    if (!Number.isFinite(value)) {
      throw new Error(`第 ${row + 1} 行数量无效。`);
    }
    numbers.push(value);
  }
  if (numbers.length === 0) {
    return null;
  }
  return numbers.reduce((sum, value) => sum + value, 0);
}

function parseAmount(cell: RawCell, row: number, label: string): number | null {
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    return toCents(cell.value) / 100;
  }
  const source = cellString(cell).trim();
  if (!source) {
    return null;
  }
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const numbers: number[] = [];
  for (const line of lines) {
    if (MISSING_TOKENS.has(line)) {
      continue;
    }
    const value = Number(line.replace(/,/g, ''));
    if (!Number.isFinite(value)) {
      throw new Error(`第 ${row + 1} 行${label}无效。`);
    }
    numbers.push(value);
  }
  if (numbers.length === 0) {
    return null;
  }
  return toCents(numbers.reduce((sum, value) => sum + value, 0)) / 100;
}

function yearMonth(cell: RawCell): string {
  if (cell.value instanceof Date && !Number.isNaN(cell.value.getTime())) {
    return formatMonth(cell.value.getFullYear(), cell.value.getMonth() + 1);
  }
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(cell.value) * 86_400_000;
    const date = new Date(utc);
    return formatMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
  }
  const text = cellString(cell).trim();
  const match = text.match(/^(\d{4})[./\-年](\d{1,2})/);
  if (!match) {
    throw new Error('登记日期无效');
  }
  return formatMonth(Number(match[1]), Number(match[2]));
}

function formatMonth(year: number, month: number): string {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error('登记日期无效');
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function firstSegment(cell: RawCell): string {
  for (const part of cellString(cell).split(/\r?\n/)) {
    const trimmed = part.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function numericValue(cell: RawCell): boolean {
  return typeof cell.value === 'number' && Number.isFinite(cell.value);
}

function rowIsEmpty(
  sheet: XLSX.WorkSheet,
  row: number,
  range: XLSX.Range,
): boolean {
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = readCell(sheet, row, column);
    if (cell.text.trim() || (cell.value != null && String(cell.value).trim())) {
      return false;
    }
  }
  return true;
}

function readCell(sheet: XLSX.WorkSheet, row: number, column: number): RawCell {
  if (column < 0) {
    return { value: null, text: '' };
  }
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
    { v?: unknown; w?: string } | undefined;
  if (!cell) {
    return { value: null, text: '' };
  }
  return { value: cell.v ?? null, text: String(cell.w ?? '') };
}

function cellString(cell: RawCell): string {
  if (typeof cell.value === 'string') {
    return cell.value;
  }
  if (cell.text) {
    return cell.text;
  }
  if (cell.value == null) {
    return '';
  }
  return String(cell.value);
}

function trimSheet(headers: string[], rows: string[][]): AftersaleSheet {
  let last = headers.length - 1;
  while (
    last >= 0 &&
    !headers[last] &&
    rows.every((row) => !(row[last] ?? '').trim())
  ) {
    last -= 1;
  }
  const width = Math.max(last + 1, 0);
  return {
    headers: headers.slice(0, width),
    rows: rows.map((row) => row.slice(0, width)),
  };
}

export function aftersalePreview(month: AftersaleMonth): AftersaleSheet {
  if (month.sheet && month.sheet.headers.length > 0) {
    return month.sheet;
  }
  return {
    headers: [
      '厂家',
      '数量（个）',
      '产品问题大类',
      '我司赔付金额',
      '厂家赔付金额',
      '结案',
    ],
    rows: month.events.map((event) => [
      event.supplier,
      event.quantity == null ? '' : String(event.quantity),
      event.category,
      event.companyPay == null ? '' : String(event.companyPay),
      event.factoryPay == null ? '' : String(event.factoryPay),
      event.pending ? '待跟进' : '',
    ]),
  };
}

function sanitizeMonth(month: AftersaleMonth): AftersaleMonth {
  const sheet = normalizeSheet(month.sheet);
  if (!sheet) {
    return { month: month.month, events: month.events };
  }
  return { month: month.month, events: month.events, sheet };
}

function normalizeSheet(value: unknown): AftersaleSheet | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Partial<AftersaleSheet>;
  if (!Array.isArray(record.headers) || !Array.isArray(record.rows)) {
    return undefined;
  }
  if (record.headers.some((header) => typeof header !== 'string')) {
    return undefined;
  }
  const rows: string[][] = [];
  for (const row of record.rows) {
    if (!Array.isArray(row) || row.some((cell) => typeof cell !== 'string')) {
      return undefined;
    }
    rows.push(row);
  }
  return { headers: record.headers, rows };
}

function isAftersaleMonth(value: unknown): value is AftersaleMonth {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<AftersaleMonth>;
  return (
    typeof record.month === 'string' &&
    /^\d{4}-\d{2}$/.test(record.month) &&
    Array.isArray(record.events) &&
    record.events.every(isComplaintEvent)
  );
}

function isComplaintEvent(value: unknown): value is ComplaintEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<ComplaintEvent>;
  return (
    typeof record.supplier === 'string' &&
    (record.quantity == null || typeof record.quantity === 'number') &&
    (record.companyPay == null || typeof record.companyPay === 'number') &&
    (record.factoryPay == null || typeof record.factoryPay === 'number') &&
    typeof record.category === 'string' &&
    typeof record.pending === 'boolean'
  );
}
