import * as XLSX from 'xlsx';
import { normalizeArrivalDate } from '@/features/aftersale/parseExcel';
import type {
  PackagingBasic,
  PackagingDetail,
  PackagingGroup,
} from '@/features/packaging/types';

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

function findHeaderRow(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
): { row: number; headers: string[] } {
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const headers: string[] = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      headers[column] = cellText(sheet, row, column);
    }
    if (
      headers.includes('供应商') &&
      headers.includes('物料编码') &&
      headers.includes('申请数量')
    ) {
      return { row, headers };
    }
  }
  throw new Error(
    'Excel 表头需包含供应商、物料编码、申请数量，并区分基础信息与明细信息',
  );
}

function firstIndex(headers: string[], name: string): number {
  return headers.indexOf(name);
}

function nthIndex(headers: string[], name: string, nth: number): number {
  let seen = 0;
  for (let index = 0; index < headers.length; index += 1) {
    if (headers[index] === name) {
      if (seen === nth) {
        return index;
      }
      seen += 1;
    }
  }
  return -1;
}

export function parsePackagingSheet(sheet: XLSX.WorkSheet): PackagingGroup[] {
  if (!sheet['!ref']) {
    throw new Error('Excel 为空');
  }
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const { row: headerRow, headers } = findHeaderRow(sheet, range);

  const supplierIndex = firstIndex(headers, '供应商');
  const purchaserIndex = firstIndex(headers, '采购员');
  const basicOwnerIndex = nthIndex(headers, '货主', 0);
  const materialIndex = firstIndex(headers, '物料编码');
  const warehouseIndex = firstIndex(headers, '收货仓库');
  const qtyIndex = firstIndex(headers, '申请数量');
  const detailOwnerIndex = nthIndex(headers, '货主', 1);
  const dateIndex = firstIndex(headers, '预计入库时间');
  const keeperIndex = firstIndex(headers, '保管者');

  if (
    supplierIndex < 0 ||
    basicOwnerIndex < 0 ||
    materialIndex < 0 ||
    qtyIndex < 0 ||
    dateIndex < 0
  ) {
    throw new Error(
      'Excel 表头需包含供应商、货主、物料编码、申请数量、预计入库时间',
    );
  }

  const basics: PackagingBasic[] = [];
  const details: Omit<PackagingDetail, 'supplier' | 'purchaser'>[] = [];

  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    const supplier = cellText(sheet, row, supplierIndex);
    const purchaser = cellText(sheet, row, purchaserIndex);
    const basicOwner = cellText(sheet, row, basicOwnerIndex);
    if (supplier || purchaser || basicOwner) {
      basics.push({
        id: `b${row}`,
        supplier,
        purchaser,
        owner: basicOwner || supplier,
      });
    }

    const materialNumber = cellText(sheet, row, materialIndex);
    if (!materialNumber) {
      continue;
    }
    const detailOwner =
      cellText(sheet, row, detailOwnerIndex) || basicOwner || supplier;
    if (!detailOwner) {
      throw new Error(`第 ${row + 1} 行明细缺少货主`);
    }
    const dateCell = cellAt(sheet, row, dateIndex);
    let expectInDate: string;
    try {
      expectInDate = normalizeArrivalDate(dateCell?.v, dateCell?.w);
    } catch {
      throw new Error(`第 ${row + 1} 行预计入库时间格式无效`);
    }
    const qty = Number(cellAt(sheet, row, qtyIndex)?.v);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`第 ${row + 1} 行申请数量无效`);
    }
    details.push({
      id: `d${row}`,
      materialNumber,
      warehouse: cellText(sheet, row, warehouseIndex),
      qty,
      owner: detailOwner,
      expectInDate,
      keeper: cellText(sheet, row, keeperIndex),
    });
  }

  if (basics.length === 0) {
    throw new Error('Excel 没有基础信息');
  }
  if (details.length === 0) {
    throw new Error('Excel 没有可下单的明细');
  }

  const groups: PackagingGroup[] = basics.map((basic) => ({
    basic,
    details: details
      .filter((detail) => detail.owner === basic.owner)
      .map((detail) => ({
        ...detail,
        supplier: basic.supplier,
        purchaser: basic.purchaser,
      })),
  }));

  const hanging = details.filter(
    (detail) => !basics.some((basic) => basic.owner === detail.owner),
  );
  if (hanging.length > 0) {
    throw new Error(
      `明细货主 ${hanging.map((item) => item.owner).join('、')} 没有对应的基础信息`,
    );
  }

  return groups.filter((group) => group.details.length > 0);
}

export function parsePackagingWorkbook(
  data: ArrayBuffer | Uint8Array,
): PackagingGroup[] {
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: false,
    cellText: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error('Excel 为空');
  }
  return parsePackagingSheet(sheet);
}

export function flattenPackagingDetails(
  groups: PackagingGroup[],
): PackagingDetail[] {
  return groups.flatMap((group) => group.details);
}

export function groupPackagingBySupplier(
  details: PackagingDetail[],
): Array<{ supplier: string; details: PackagingDetail[] }> {
  const grouped = new Map<string, PackagingDetail[]>();
  for (const detail of details) {
    const list = grouped.get(detail.supplier);
    if (list) {
      list.push(detail);
    } else {
      grouped.set(detail.supplier, [detail]);
    }
  }
  return [...grouped.entries()].map(([supplier, groupDetails]) => ({
    supplier,
    details: groupDetails,
  }));
}
