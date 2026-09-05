import { kingdeeApi } from '@/apis/kingdee/api';
import { getKingdeeConfig } from '@/apis/kingdee/client';
import {
  flattenCreatedBills,
  operateAftersaleBills,
  readSaveOutcome,
  toKingdeeDate,
  toNextWeekdayDate,
  type BillOperators,
  type PlaceOrderResult,
} from '@/features/aftersale/requisition';
import { groupSubcontractBySupplier } from '@/features/subcontract/parseExcel';
import type { SubcontractRow } from '@/features/subcontract/types';
import type { CreatedBill } from '@/features/aftersale/types';
import { KINGDEE_FORM_IDS } from '@/types/kingdee';

export { flattenCreatedBills };

export function buildSubcontractOrderModel(
  rows: SubcontractRow[],
  orgId?: number | null,
): Record<string, unknown> {
  const supplier = rows[0]?.supplier ?? '';
  const purchaser = rows[0]?.purchaser ?? '';
  const today = toKingdeeDate(
    new Date().toISOString().slice(0, 10).replaceAll('-', '/'),
  );
  const org = orgId ? { Id: orgId } : undefined;
  const model: Record<string, unknown> = {
    FBillTypeID: { FNumber: 'WWDD01_SYS' },
    FDate: today,
    FSupplierId: { FNumber: supplier },
    FTreeEntity: rows.map((row) => {
      const entry: Record<string, unknown> = {
        FMaterialId: { FNumber: row.materialNumber },
        FQty: row.qty,
        FPlanFinishDate: toNextWeekdayDate(row.planFinishDate),
        FSupplierId: { FNumber: row.supplier },
      };
      if (row.purchaser) {
        entry.F_PRZG_procure = { FNumber: row.purchaser };
      }
      if (row.warehouse) {
        entry.FStockId = { FNumber: row.warehouse };
      }
      if (org) {
        entry.FStockInOrgId = org;
        entry.FRequireOrgId = org;
      }
      return entry;
    }),
  };
  if (purchaser) {
    model.FPurchaseId = { FNumber: purchaser };
  }
  if (org) {
    model.FSubOrgId = org;
  }
  return model;
}

type SaveFn = (model: Record<string, unknown>) => Promise<unknown>;

export async function placeSubcontractOrders(
  rows: SubcontractRow[],
  orgId?: number | null,
  save: SaveFn = (model) =>
    kingdeeApi.saveBill({
      formId: KINGDEE_FORM_IDS.SUB_SUBREQORDER,
      model,
    }),
): Promise<PlaceOrderResult> {
  const succeeded: PlaceOrderResult['succeeded'] = [];
  const failed: PlaceOrderResult['failed'] = [];

  for (const group of groupSubcontractBySupplier(rows)) {
    try {
      const data = await save(buildSubcontractOrderModel(group.rows, orgId));
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
      formId: KINGDEE_FORM_IDS.SUB_SUBREQORDER,
      numbers,
      ids,
    }),
  audit: (numbers, ids) =>
    kingdeeApi.workflowAudit({
      formId: KINGDEE_FORM_IDS.SUB_SUBREQORDER,
      numbers,
      ids,
      userName: getKingdeeConfig().username,
    }),
  push: (numbers, ids) =>
    kingdeeApi.pushBill({
      formId: KINGDEE_FORM_IDS.SUB_SUBREQORDER,
      numbers,
      ids,
      targetFormId: KINGDEE_FORM_IDS.PURCHASE_ORDER,
      isEnableDefaultRule: true,
    }),
};

export function operateSubcontractBills(
  action: 'submit' | 'audit' | 'push',
  bills: CreatedBill[],
  operators: BillOperators = defaultOperators,
) {
  return operateAftersaleBills(action, bills, operators);
}
