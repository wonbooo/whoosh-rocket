import { kingdeeApi } from '@/apis/kingdee/api';
import { buildDateFilter, iterDateChunks } from '@/apis/kingdee/utils';
import { parseCatalog } from '@/features/analysis/catalog';
import { queryRange } from '@/features/supplier/aggregate';
import {
  resolveInstockFields,
  resolvePurchaseFields,
  resolveReceiveFields,
  type ArrivalBillFields,
  type PurchaseFields,
} from '@/features/supplier/timelinessFields';
import type {
  ArrivalReceipt,
  PurchaseLine,
} from '@/features/supplier/timeliness';

const PURCHASE_FORM = 'PUR_PurchaseOrder';
const RECEIVE_FORM = 'PUR_ReceiveBill';
const INSTOCK_FORM = 'STK_InStock';
const PAGE_SIZE = 2000;
const MAX_ROWS = 20_000;
const EXCLUDED_STATUS = new Set([
  'B',
  '已关闭',
  '业务关闭',
  '业务冻结',
  '业务终止',
]);

export interface ArrivalSources {
  lines: PurchaseLine[];
  receive: ArrivalReceipt[];
  instock: ArrivalReceipt[];
}

function shiftMonth(iso: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    throw new Error(`日期格式错误（需要 YYYY-MM-DD）: ${iso}`);
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1 + months,
    Number(match[3]),
  );
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function arrivalWindows(today: Date): {
  delivery: { dateFrom: string; dateTo: string };
  receipt: { dateFrom: string; dateTo: string };
} {
  const delivery = queryRange(today);
  return {
    delivery,
    receipt: {
      dateFrom: shiftMonth(delivery.dateFrom, -6),
      dateTo: shiftMonth(delivery.dateTo, 6),
    },
  };
}

function isCompletePurchase(
  fields: Partial<PurchaseFields>,
): fields is PurchaseFields {
  return Boolean(
    fields.billNo &&
    fields.supplier &&
    fields.materialName &&
    fields.materialNumber &&
    fields.qty &&
    fields.deliveryDate &&
    fields.entryId &&
    fields.closeStatus &&
    fields.mrpClose &&
    fields.mrpFreeze &&
    fields.mrpTerminate,
  );
}

function isCompleteArrival(
  fields: Partial<ArrivalBillFields>,
): fields is ArrivalBillFields {
  return Boolean(
    fields.date &&
    fields.qty &&
    fields.billNo &&
    fields.entryId &&
    fields.materialNumber,
  );
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
  return undefined;
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

function asDate(value: unknown): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(asText(value).trim());
  return match?.[1] ?? '';
}

function isExcluded(values: string[]): boolean {
  return values.some((value) => EXCLUDED_STATUS.has(value.trim()));
}

async function queryChunk(
  formId: string,
  filterString: string,
  fieldKeys: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let startRow = 0;
  while (rows.length < MAX_ROWS) {
    const page = await kingdeeApi.queryBill<unknown>({
      formId,
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

async function queryRangeRows(
  formId: string,
  dateField: string,
  range: { dateFrom: string; dateTo: string },
  extraFilter: string,
  fieldKeys: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const [from, to] of iterDateChunks(
    range.dateFrom,
    range.dateTo,
    'month',
  )) {
    rows.push(
      ...(await queryChunk(
        formId,
        buildDateFilter(dateField, from, to, extraFilter),
        fieldKeys,
      )),
    );
  }
  return rows;
}

function readPurchase(
  row: unknown,
  fields: PurchaseFields,
  keys: string[],
): PurchaseLine | null {
  const read = (key: string) => cellAt(row, key, keys.indexOf(key));
  const deliveryDate = asDate(read(fields.deliveryDate));
  if (!deliveryDate) {
    return null;
  }
  const supplier = asText(read(fields.supplier)).trim();
  return {
    supplier,
    billNo: asText(read(fields.billNo)).trim(),
    entryId: asText(read(fields.entryId)).trim(),
    materialNumber: asText(read(fields.materialNumber)).trim(),
    materialName: asText(read(fields.materialName)).trim(),
    orderQty: asQty(read(fields.qty)),
    deliveryDate,
    excluded: isExcluded([
      asText(read(fields.closeStatus)),
      asText(read(fields.mrpClose)),
      asText(read(fields.mrpFreeze)),
      asText(read(fields.mrpTerminate)),
    ]),
  };
}

function readReceipt(
  row: unknown,
  fields: ArrivalBillFields,
  keys: string[],
): ArrivalReceipt | null {
  const read = (key: string) => cellAt(row, key, keys.indexOf(key));
  const date = asDate(read(fields.date));
  if (!date) {
    return null;
  }
  return {
    entryId: asText(read(fields.entryId)).trim(),
    billNo: asText(read(fields.billNo)).trim(),
    materialNumber: asText(read(fields.materialNumber)).trim(),
    date,
    qty: asQty(read(fields.qty)),
  };
}

export async function loadArrivalSources(today: Date): Promise<ArrivalSources> {
  const [purchaseCatalog, receiveCatalog, instockCatalog] = await Promise.all([
    kingdeeApi
      .queryMetadata(PURCHASE_FORM)
      .then((payload) => parseCatalog(PURCHASE_FORM, payload)),
    kingdeeApi
      .queryMetadata(RECEIVE_FORM)
      .then((payload) => parseCatalog(RECEIVE_FORM, payload)),
    kingdeeApi
      .queryMetadata(INSTOCK_FORM)
      .then((payload) => parseCatalog(INSTOCK_FORM, payload)),
  ]);
  const purchase = resolvePurchaseFields(purchaseCatalog);
  const receive = resolveReceiveFields(receiveCatalog);
  const instock = resolveInstockFields(instockCatalog);
  if (!isCompletePurchase(purchase.fields)) {
    throw new Error(`采购订单缺少字段：${purchase.missing.join('、')}`);
  }
  if (!isCompleteArrival(receive.fields)) {
    throw new Error(`收料通知单缺少字段：${receive.missing.join('、')}`);
  }
  if (!isCompleteArrival(instock.fields)) {
    throw new Error(`采购入库单缺少字段：${instock.missing.join('、')}`);
  }
  const purchaseFields = purchase.fields;
  const receiveFields = receive.fields;
  const instockFields = instock.fields;

  const windows = arrivalWindows(today);
  const purchaseKeys = [
    purchaseFields.billNo,
    purchaseFields.supplier,
    purchaseFields.materialName,
    purchaseFields.materialNumber,
    purchaseFields.qty,
    purchaseFields.deliveryDate,
    purchaseFields.entryId,
    purchaseFields.closeStatus,
    purchaseFields.mrpClose,
    purchaseFields.mrpFreeze,
    purchaseFields.mrpTerminate,
  ];
  const purchaseFilter = [
    "FDocumentStatus = 'C'",
    purchaseFields.cancelStatus ? `${purchaseFields.cancelStatus} = 'A'` : '',
  ]
    .filter(Boolean)
    .join(' AND ');
  const purchaseRows = await queryRangeRows(
    PURCHASE_FORM,
    purchaseFields.deliveryDate,
    windows.delivery,
    purchaseFilter,
    purchaseKeys.join(','),
  );

  const receiveKeys = [
    receiveFields.date,
    receiveFields.qty,
    receiveFields.billNo,
    receiveFields.entryId,
    receiveFields.materialNumber,
  ];
  const instockKeys = [
    instockFields.date,
    instockFields.qty,
    instockFields.billNo,
    instockFields.entryId,
    instockFields.materialNumber,
  ];
  const [receiveRows, instockRows] = await Promise.all([
    queryRangeRows(
      RECEIVE_FORM,
      receiveFields.date,
      windows.receipt,
      "FDocumentStatus = 'C'",
      receiveKeys.join(','),
    ),
    queryRangeRows(
      INSTOCK_FORM,
      instockFields.date,
      windows.receipt,
      "FDocumentStatus = 'C'",
      instockKeys.join(','),
    ),
  ]);

  return {
    lines: purchaseRows.flatMap((row) => {
      const line = readPurchase(row, purchaseFields, purchaseKeys);
      return line ? [line] : [];
    }),
    receive: receiveRows.flatMap((row) => {
      const receipt = readReceipt(row, receiveFields, receiveKeys);
      return receipt ? [receipt] : [];
    }),
    instock: instockRows.flatMap((row) => {
      const receipt = readReceipt(row, instockFields, instockKeys);
      return receipt ? [receipt] : [];
    }),
  };
}
