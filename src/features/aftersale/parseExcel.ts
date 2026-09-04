import * as XLSX from 'xlsx';
import type {
  AftersaleRow,
  AftersaleSupplierGroup,
} from '@/features/aftersale/types';

export const AFTERSALE_COLUMNS = {
  material: '物料编码',
  qty: '申请数量',
  date: '到货日期',
  supplier: '建议供应商',
  purchaser: '采购员',
  warehouse: '仓库',
} as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function toYmd(year: number, month: number, day: number): string {
  return `${year}/${pad2(month)}/${pad2(day)}`;
}

export function excelSerialToYmd(serial: number): string {
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const date = new Date(utc);
  return toYmd(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function parseYmdString(text?: string): string | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  const ymd = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymd) {
    return toYmd(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }
  return null;
}

export function normalizeArrivalDate(
  value: unknown,
  formatted?: string,
): string {
  const formattedYmd = parseYmdString(formatted);
  if (formattedYmd && formatted && /^\d{4}[/-]/.test(formatted.trim())) {
    return formattedYmd;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToYmd(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toYmd(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }
  const fromValue = parseYmdString(value == null ? '' : String(value));
  if (fromValue) {
    return fromValue;
  }
  if (formattedYmd) {
    return formattedYmd;
  }
  throw new Error('到货日期格式无效');
}

type ExcelCell = {
  v?: unknown;
  w?: string;
};

function cellAt(
  sheet: XLSX.WorkSheet,
  row: number,
  column: number,
): ExcelCell | undefined {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
    ExcelCell | undefined;
}

function cellText(sheet: XLSX.WorkSheet, row: number, column: number): string {
  if (column < 0) {
    return '';
  }
  const cell = cellAt(sheet, row, column);
  if (!cell) {
    return '';
  }
  return String(cell.w ?? cell.v ?? '').trim();
}

export function parseAftersaleSheet(sheet: XLSX.WorkSheet): AftersaleRow[] {
  if (!sheet['!ref']) {
    throw new Error('Excel 为空');
  }

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headers: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    headers[column] = cellText(sheet, range.s.r, column);
  }

  const materialIndex = headers.indexOf(AFTERSALE_COLUMNS.material);
  const qtyIndex = headers.indexOf(AFTERSALE_COLUMNS.qty);
  const dateIndex = headers.indexOf(AFTERSALE_COLUMNS.date);
  const supplierIndex = headers.indexOf(AFTERSALE_COLUMNS.supplier);
  const purchaserIndex = headers.indexOf(AFTERSALE_COLUMNS.purchaser);
  const warehouseIndex = headers.indexOf(AFTERSALE_COLUMNS.warehouse);

  if (materialIndex < 0 || qtyIndex < 0 || dateIndex < 0 || supplierIndex < 0) {
    throw new Error('Excel 表头需包含物料编码、申请数量、到货日期、建议供应商');
  }

  const rows: AftersaleRow[] = [];
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const materialNumber = cellText(sheet, row, materialIndex);
    if (!materialNumber) {
      continue;
    }
    const supplier = cellText(sheet, row, supplierIndex);
    if (!supplier) {
      throw new Error(`第 ${row + 1} 行缺少建议供应商`);
    }
    const dateCell = cellAt(sheet, row, dateIndex);
    const arrivalDate = normalizeArrivalDate(dateCell?.v, dateCell?.w);
    const qty = Number(cellAt(sheet, row, qtyIndex)?.v);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`第 ${row + 1} 行申请数量无效`);
    }
    rows.push({
      id: `r${row}`,
      materialNumber,
      qty,
      arrivalDate,
      supplier,
      purchaser: cellText(sheet, row, purchaserIndex),
      warehouse: cellText(sheet, row, warehouseIndex),
    });
  }

  if (rows.length === 0) {
    throw new Error('Excel 没有可下单的明细');
  }
  return rows;
}

export function parseAftersaleWorkbook(
  data: ArrayBuffer | Uint8Array,
): AftersaleRow[] {
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: false,
    cellText: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error('Excel 为空');
  }
  return parseAftersaleSheet(sheet);
}

export function groupAftersaleBySupplier(
  rows: AftersaleRow[],
): AftersaleSupplierGroup[] {
  const grouped = new Map<string, AftersaleRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.supplier);
    if (list) {
      list.push(row);
    } else {
      grouped.set(row.supplier, [row]);
    }
  }
  return [...grouped.entries()].map(([supplier, groupRows]) => ({
    supplier,
    rows: groupRows,
  }));
}
