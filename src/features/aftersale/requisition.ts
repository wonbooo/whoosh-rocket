import { kingdeeApi } from '@/apis/kingdee/api';
import { getKingdeeConfig } from '@/apis/kingdee/client';
import { responseStatuses } from '@/apis/kingdee/utils';
import { groupAftersaleBySupplier } from '@/features/aftersale/parseExcel';
import type { AftersaleRow, CreatedBill } from '@/features/aftersale/types';
import { KINGDEE_FORM_IDS } from '@/types/kingdee';

/** 售后 Excel 无单价，下推采购订单时用最小非零含税单价，避免「非赠品单价不能为 0」。 */
export const AFTERSALE_DEFAULT_PRICE = 0.01;

export function toKingdeeDate(ymd: string): string {
  return ymd.replaceAll('/', '-');
}

/** 周六、周日顺延到下周一，尽量落到工作日历的生产日。 */
export function toNextWeekdayDate(ymd: string): string {
  const iso = toKingdeeDate(ymd);
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = date.getUTCDay();
  if (weekday === 6) {
    date.setUTCDate(date.getUTCDate() + 2);
  } else if (weekday === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

export function buildPurchaseRequisitionModel(
  rows: AftersaleRow[],
  orgId?: number | null,
): Record<string, unknown> {
  const today = toKingdeeDate(
    new Date().toISOString().slice(0, 10).replaceAll('-', '/'),
  );
  const org = orgId ? { Id: orgId } : undefined;
  const model: Record<string, unknown> = {
    FBillTypeID: { FNumber: 'CGSQD01_SYS' },
    FRequestType: 'Material',
    FApplicationDate: today,
    FCurrencyId: { FNumber: 'PRE001' },
    FExchangeTypeId: { FNumber: 'HLTX01_SYS' },
    FEntity: rows.map((row) => {
      const entry: Record<string, unknown> = {
        FMaterialId: { FNumber: row.materialNumber },
        FReqQty: row.qty,
        FArrivalDate: toKingdeeDate(row.arrivalDate),
        FSuggestSupplierId: { FNumber: row.supplier },
      };
      if (row.warehouse) {
        entry.FStockId = { FNumber: row.warehouse };
      }
      if (row.purchaser) {
        entry.FPurchaserId = { FNumber: row.purchaser };
      }
      if (org) {
        entry.FPurchaseOrgId = org;
        entry.FRequireOrgId = org;
        entry.FReceiveOrgId = org;
      }
      entry.FEvaluatePrice = AFTERSALE_DEFAULT_PRICE;
      entry.FTAXPRICE = AFTERSALE_DEFAULT_PRICE;
      return entry;
    }),
  };
  if (org) {
    model.FApplicationOrgId = org;
  }
  return model;
}

export function readSaveOutcome(data: unknown): {
  success: boolean;
  numbers: string[];
  ids: string[];
  message: string;
} {
  for (const status of responseStatuses(data)) {
    const numbers = (status.SuccessEntitys ?? [])
      .map((item) => String(item.Number ?? '').trim())
      .filter(Boolean);
    const ids = (status.SuccessEntitys ?? [])
      .map((item) => String(item.Id ?? '').trim())
      .filter(Boolean);
    const message = (status.Errors ?? [])
      .map((item) => item.Message)
      .filter(Boolean)
      .join('；');
    if (status.IsSuccess) {
      return { success: true, numbers, ids, message: '' };
    }
    if (message || status.IsSuccess === false) {
      return {
        success: false,
        numbers,
        ids,
        message: message || '操作失败',
      };
    }
  }
  return {
    success: false,
    numbers: [],
    ids: [],
    message: '金蝶未返回保存结果',
  };
}

export interface PlaceOrderGroupResult {
  supplier: string;
  billNos: string[];
  billIds: string[];
}

export interface PlaceOrderResult {
  succeeded: PlaceOrderGroupResult[];
  failed: { supplier: string; message: string }[];
}

type SaveFn = (model: Record<string, unknown>) => Promise<unknown>;

export async function placeAftersaleOrders(
  rows: AftersaleRow[],
  orgId?: number | null,
  save: SaveFn = (model) =>
    kingdeeApi.saveBill({
      formId: KINGDEE_FORM_IDS.PUR_REQUISITION,
      model,
    }),
): Promise<PlaceOrderResult> {
  const succeeded: PlaceOrderGroupResult[] = [];
  const failed: { supplier: string; message: string }[] = [];

  for (const group of groupAftersaleBySupplier(rows)) {
    try {
      const data = await save(buildPurchaseRequisitionModel(group.rows, orgId));
      const outcome = readSaveOutcome(data);
      if (outcome.success) {
        succeeded.push({
          supplier: group.supplier,
          billNos: outcome.numbers,
          billIds: outcome.ids,
        });
      } else {
        failed.push({ supplier: group.supplier, message: outcome.message });
      }
    } catch (error) {
      failed.push({
        supplier: group.supplier,
        message: error instanceof Error ? error.message : '下单失败',
      });
    }
  }

  return { succeeded, failed };
}

export function flattenCreatedBills(
  succeeded: PlaceOrderGroupResult[],
): CreatedBill[] {
  const bills: CreatedBill[] = [];
  for (const group of succeeded) {
    const count = Math.max(group.billNos.length, group.billIds.length);
    for (let index = 0; index < count; index += 1) {
      const billNo = group.billNos[index] ?? '';
      const billId = group.billIds[index] ?? '';
      if (!billNo && !billId) {
        continue;
      }
      bills.push({
        key: `${group.supplier}-${billNo || billId}-${index}`,
        billNo,
        billId,
        supplier: group.supplier,
      });
    }
  }
  return bills;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function kingdeeResultModel(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  const result = asRecord(root?.Result) ?? root;
  return asRecord(result?.Result) ?? result;
}

export function readConvertSuccessIds(data: unknown): string[] {
  const ids: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const convert = asRecord(record.ConvertResponseStatus);
    const entities = convert?.SuccessEntitys;
    if (Array.isArray(entities)) {
      for (const item of entities) {
        const entity = asRecord(item);
        const id = String(entity?.Id ?? '').trim();
        if (id) {
          ids.push(id);
        }
      }
    }
    visit(record.Result);
  };
  visit(data);
  return ids;
}

export function isNonGiftZeroPriceError(data: unknown): boolean {
  for (const status of responseStatuses(data)) {
    for (const error of status.Errors ?? []) {
      if ((error.Message ?? '').includes('非赠品单价不能为0')) {
        return true;
      }
    }
  }
  return false;
}

function purchaseOrderEntryId(
  entry: Record<string, unknown>,
): string | number | undefined {
  const value = entry.Id ?? entry.FENTRYID ?? entry.FEntryID;
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return undefined;
}

export interface AftersalePushApi {
  pushBill: (params: {
    formId: string;
    numbers?: string;
    ids?: string;
    targetFormId?: string;
    isEnableDefaultRule?: boolean;
    isDraftWhenSaveFail?: boolean;
  }) => Promise<unknown>;
  viewBill: (params: {
    formId: string;
    number?: string;
    billId?: string;
  }) => Promise<unknown>;
  saveBill: (params: {
    formId: string;
    model: Record<string, unknown> | { Model: Record<string, unknown> };
  }) => Promise<unknown>;
}

export async function pushAftersaleRequisitions(
  numbers: string,
  ids: string,
  api: AftersalePushApi = kingdeeApi,
): Promise<unknown> {
  const pushed = await api.pushBill({
    formId: KINGDEE_FORM_IDS.PUR_REQUISITION,
    numbers,
    ids,
    targetFormId: KINGDEE_FORM_IDS.PURCHASE_ORDER,
    isEnableDefaultRule: true,
    isDraftWhenSaveFail: true,
  });
  if (readSaveOutcome(pushed).success || !isNonGiftZeroPriceError(pushed)) {
    return pushed;
  }
  const poIds = readConvertSuccessIds(pushed);
  if (poIds.length === 0) {
    return pushed;
  }

  let last: unknown = pushed;
  for (const poId of poIds) {
    const viewed = await api.viewBill({
      formId: KINGDEE_FORM_IDS.PURCHASE_ORDER,
      billId: poId,
    });
    const model = kingdeeResultModel(viewed);
    const entries = Array.isArray(model?.FPOOrderEntry)
      ? (model.FPOOrderEntry as Record<string, unknown>[])
      : [];
    last = await api.saveBill({
      formId: KINGDEE_FORM_IDS.PURCHASE_ORDER,
      model: {
        IsDeleteEntry: 'false',
        Model: {
          FID: poId,
          FPOOrderEntry: entries.map((entry) => ({
            FENTRYID: purchaseOrderEntryId(entry),
            FPrice: AFTERSALE_DEFAULT_PRICE,
            FTaxPrice: AFTERSALE_DEFAULT_PRICE,
          })),
        },
      },
    });
    const saved = readSaveOutcome(last);
    if (!saved.success) {
      return last;
    }
  }
  return last;
}

export type AftersaleBillAction = 'submit' | 'audit' | 'push';

export interface BillOperators {
  submit: (numbers: string, ids: string) => Promise<unknown>;
  audit: (numbers: string, ids: string) => Promise<unknown>;
  push: (numbers: string, ids: string) => Promise<unknown>;
}

const defaultOperators: BillOperators = {
  submit: (numbers, ids) =>
    kingdeeApi.submitBill({
      formId: KINGDEE_FORM_IDS.PUR_REQUISITION,
      numbers,
      ids,
    }),
  audit: (numbers, ids) =>
    kingdeeApi.workflowAudit({
      formId: KINGDEE_FORM_IDS.PUR_REQUISITION,
      numbers,
      ids,
      userName: getKingdeeConfig().username,
    }),
  push: (numbers, ids) => pushAftersaleRequisitions(numbers, ids),
};

export async function operateAftersaleBills(
  action: AftersaleBillAction,
  bills: CreatedBill[],
  operators: BillOperators = defaultOperators,
): Promise<{ success: boolean; message: string }> {
  if (bills.length === 0) {
    return { success: false, message: '请先勾选订单' };
  }
  const numbers = bills
    .map((item) => item.billNo)
    .filter(Boolean)
    .join(',');
  const ids = bills
    .map((item) => item.billId)
    .filter(Boolean)
    .join(',');
  const data = await operators[action](numbers, ids);
  return readSaveOutcome(data);
}
