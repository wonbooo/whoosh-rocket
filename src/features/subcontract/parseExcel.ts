import * as XLSX from 'xlsx';
import { normalizeArrivalDate } from '@/features/aftersale/parseExcel';
import type {
  SubcontractRow,
  SubcontractSupplierGroup,
} from '@/features/subcontract/types';

export const SUBCONTRACT_COLUMNS = {
  materialName: '物料名称',
  material: '物料编码',
  qty: '数量',
  date: '计划完工时间',
  supplier: '供应商',
  purchaser: '采购员',
  warehouse: '仓库',
} as const;

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

export function parseSubcontractSheet(sheet: XLSX.WorkSheet): SubcontractRow[] {
  if (!sheet['!ref']) {
    throw new Error('Excel 为空');
  }

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headers: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    headers[column] = cellText(sheet, range.s.r, column);
  }

  const materialIndex = headers.indexOf(SUBCONTRACT_COLUMNS.material);
  const qtyIndex = headers.indexOf(SUBCONTRACT_COLUMNS.qty);
  const dateIndex = headers.indexOf(SUBCONTRACT_COLUMNS.date);
  const supplierIndex = headers.indexOf(SUBCONTRACT_COLUMNS.supplier);
  const nameIndex = headers.indexOf(SUBCONTRACT_COLUMNS.materialName);
  const purchaserIndex = headers.indexOf(SUBCONTRACT_COLUMNS.purchaser);
  const warehouseIndex = headers.indexOf(SUBCONTRACT_COLUMNS.warehouse);

  if (materialIndex < 0 || qtyIndex < 0 || dateIndex < 0 || supplierIndex < 0) {
    throw new Error('Excel 表头需包含物料编码、数量、计划完工时间、供应商');
  }

  const rows: SubcontractRow[] = [];
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const materialNumber = cellText(sheet, row, materialIndex);
    if (!materialNumber) {
      continue;
    }
    const supplier = cellText(sheet, row, supplierIndex);
    if (!supplier) {
      throw new Error(`第 ${row + 1} 行缺少供应商`);
    }
    const dateCell = cellAt(sheet, row, dateIndex);
    let planFinishDate: string;
    try {
      planFinishDate = normalizeArrivalDate(dateCell?.v, dateCell?.w);
    } catch {
      throw new Error(`第 ${row + 1} 行计划完工时间格式无效`);
    }
    const qty = Number(cellAt(sheet, row, qtyIndex)?.v);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`第 ${row + 1} 行数量无效`);
    }
    rows.push({
      id: `r${row}`,
      materialName: cellText(sheet, row, nameIndex),
      materialNumber,
      qty,
      planFinishDate,
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

export function parseSubcontractWorkbook(
  data: ArrayBuffer | Uint8Array,
): SubcontractRow[] {
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: false,
    cellText: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error('Excel 为空');
  }
  return parseSubcontractSheet(sheet);
}

export function groupSubcontractBySupplier(
  rows: SubcontractRow[],
): SubcontractSupplierGroup[] {
  const grouped = new Map<string, SubcontractRow[]>();
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
