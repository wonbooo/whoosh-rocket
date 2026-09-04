import { kingdeeApi } from '@/apis/kingdee/api';
import {
  flattenCreatedBills,
  operateAftersaleBills,
  readSaveOutcome,
  toKingdeeDate,
  type BillOperators,
  type PlaceOrderResult,
} from '@/features/aftersale/requisition';
import type { CreatedBill } from '@/features/aftersale/types';
import { groupPackagingBySupplier } from '@/features/packaging/parseExcel';
import type { PackagingDetail } from '@/features/packaging/types';
import { KINGDEE_FORM_IDS } from '@/types/kingdee';

export { flattenCreatedBills };

export function basedata(number: string): { FNumber: string } {
  return { FNumber: number };
}

export function buildInStockApplyModel(
  details: PackagingDetail[],
): Record<string, unknown> {
  const first = details[0];
  return {
    F_PRZG_GYS: basedata(first?.supplier ?? ''),
    F_PRZG_CGY: basedata(first?.purchaser ?? ''),
    F_PRZG_HZ: basedata(first?.owner ?? ''),
    FEntity: details.map((detail) => {
      const entry: Record<string, unknown> = {
        F_PRZG_WLBM: basedata(detail.materialNumber),
        F_PRZG_SHCK: basedata(detail.warehouse),
        F_PRZG_HZ1: basedata(detail.owner),
        F_PRZG_YJRKRQ: toKingdeeDate(detail.expectInDate),
        F_PRZG_SQSL: detail.qty,
      };
      if (detail.keeper) {
        entry.F_PRZG_BGZ1 = basedata(detail.keeper);
      }
      return entry;
    }),
  };
}

type SaveFn = (model: Record<string, unknown>) => Promise<unknown>;

export async function placePackagingOrders(
  details: PackagingDetail[],
  _orgId?: number | null,
  save: SaveFn = (model) =>
    kingdeeApi.saveBill({
      formId: KINGDEE_FORM_IDS.IN_STOCK_APPLY,
      model,
    }),
): Promise<PlaceOrderResult> {
  const succeeded: PlaceOrderResult['succeeded'] = [];
  const failed: PlaceOrderResult['failed'] = [];

  for (const group of groupPackagingBySupplier(details)) {
    try {
      const data = await save(buildInStockApplyModel(group.details));
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

const defaultOperators: BillOperators = {
  submit: (numbers, ids) =>
    kingdeeApi.submitBill({
      formId: KINGDEE_FORM_IDS.IN_STOCK_APPLY,
      numbers,
      ids,
    }),
  audit: (numbers, ids) =>
    kingdeeApi.auditBill({
      formId: KINGDEE_FORM_IDS.IN_STOCK_APPLY,
      numbers,
      ids,
    }),
  push: (numbers, ids) =>
    kingdeeApi.pushBill({
      formId: KINGDEE_FORM_IDS.IN_STOCK_APPLY,
      numbers,
      ids,
      targetFormId: KINGDEE_FORM_IDS.IN_STOCK,
      isEnableDefaultRule: true,
    }),
};

export function operatePackagingBills(
  action: 'submit' | 'audit' | 'push',
  bills: CreatedBill[],
  operators: BillOperators = defaultOperators,
) {
  return operateAftersaleBills(action, bills, operators);
}
