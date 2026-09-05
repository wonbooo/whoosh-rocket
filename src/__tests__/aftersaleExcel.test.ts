import * as XLSX from 'xlsx';
import {
  excelSerialToYmd,
  groupAftersaleBySupplier,
  normalizeArrivalDate,
  parseAftersaleWorkbook,
} from '@/features/aftersale/parseExcel';
import {
  AFTERSALE_DEFAULT_PRICE,
  buildPurchaseRequisitionModel,
  flattenCreatedBills,
  operateAftersaleBills,
  placeAftersaleOrders,
  pushAftersaleRequisitions,
  readSaveOutcome,
  toKingdeeDate,
} from '@/features/aftersale/requisition';
import type { AftersaleRow } from '@/features/aftersale/types';

const sampleRows: AftersaleRow[] = [
  {
    id: 'r1',
    materialNumber: 'BCDJS10063',
    qty: 1000,
    arrivalDate: '2026/08/26',
    supplier: 'CP00220',
    purchaser: '23050514',
    warehouse: 'CK338',
  },
  {
    id: 'r2',
    materialNumber: 'BCDJS10101',
    qty: 4000,
    arrivalDate: '2026/08/26',
    supplier: 'CP00182',
    purchaser: '23050514',
    warehouse: 'CK338',
  },
];

describe('aftersale excel', () => {
  it('keeps YYYY/MM/DD formatted cell text', () => {
    expect(normalizeArrivalDate(46632, '2027/09/02')).toBe('2027/09/02');
  });

  it('converts excel serial to YYYY/MM/DD', () => {
    expect(excelSerialToYmd(46632)).toBe('2027/09/02');
    expect(normalizeArrivalDate(46632, '9/2/27')).toBe('2027/09/02');
  });

  it('parses workbook and groups by supplier', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['物料编码', '申请数量', '到货日期', '建议供应商', '采购员', '仓库'],
      ['BCDJS10063', 1000, '2026/08/26', 'CP00220', '23050514', 'CK338'],
      ['BCDJS10101', 4000, '2026/08/26', 'CP00182', '23050514', 'CK338'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
    }) as Uint8Array;

    const rows = parseAftersaleWorkbook(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.arrivalDate).toBe('2026/08/26');
    expect(groupAftersaleBySupplier(rows).map((item) => item.supplier)).toEqual(
      ['CP00220', 'CP00182'],
    );
  });

  it('builds one requisition model per supplier', () => {
    const model = buildPurchaseRequisitionModel([sampleRows[0]!], 100201);
    expect(model.FApplicationOrgId).toEqual({ Id: 100201 });
    expect(model.FEntity).toEqual([
      expect.objectContaining({
        FMaterialId: { FNumber: 'BCDJS10063' },
        FReqQty: 1000,
        FArrivalDate: '2026-08-26',
        FSuggestSupplierId: { FNumber: 'CP00220' },
        FStockId: { FNumber: 'CK338' },
        FPurchaserId: { FNumber: '23050514' },
        FEvaluatePrice: AFTERSALE_DEFAULT_PRICE,
        FTAXPRICE: AFTERSALE_DEFAULT_PRICE,
      }),
    ]);
    expect(toKingdeeDate('2026/08/26')).toBe('2026-08-26');
  });

  it('places one purchase requisition per supplier', async () => {
    const saved: Record<string, unknown>[] = [];
    const result = await placeAftersaleOrders(
      sampleRows,
      100201,
      async (model) => {
        saved.push(model);
        const entity = model.FEntity as Array<{
          FSuggestSupplierId: { FNumber: string };
        }>;
        return {
          Result: {
            ResponseStatus: {
              IsSuccess: true,
              SuccessEntitys: [
                { Number: `REQ-${entity[0]?.FSuggestSupplierId.FNumber}` },
              ],
            },
          },
        };
      },
    );

    expect(saved).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.succeeded.map((item) => item.billNos[0])).toEqual([
      'REQ-CP00220',
      'REQ-CP00182',
    ]);
  });

  it('reads kingdee save errors', () => {
    expect(
      readSaveOutcome({
        Result: {
          ResponseStatus: {
            IsSuccess: false,
            Errors: [{ Message: '物料不存在' }],
          },
        },
      }),
    ).toEqual({
      success: false,
      numbers: [],
      ids: [],
      message: '物料不存在',
    });
  });

  it('flattens created bills and operates on selected numbers', async () => {
    const created = flattenCreatedBills([
      { supplier: 'CP00220', billNos: ['REQ-1'], billIds: ['11'] },
      { supplier: 'CP00182', billNos: ['REQ-2'], billIds: ['22'] },
    ]);
    expect(created.map((item) => item.billNo)).toEqual(['REQ-1', 'REQ-2']);

    const calls: Array<{ action: string; numbers: string; ids: string }> = [];
    const result = await operateAftersaleBills('submit', created, {
      submit: async (numbers, ids) => {
        calls.push({ action: 'submit', numbers, ids });
        return {
          Result: { ResponseStatus: { IsSuccess: true } },
        };
      },
      audit: async () => ({ Result: { ResponseStatus: { IsSuccess: true } } }),
      push: async () => ({ Result: { ResponseStatus: { IsSuccess: true } } }),
    });
    expect(result.success).toBe(true);
    expect(calls).toEqual([
      { action: 'submit', numbers: 'REQ-1,REQ-2', ids: '11,22' },
    ]);
  });

  it('fills purchase-order prices when push fails on zero unit price', async () => {
    const pushResult = {
      Result: {
        ResponseStatus: {
          ErrorCode: 500,
          IsSuccess: false,
          Errors: [{ FieldName: '', Message: '第1行分录，非赠品单价不能为0' }],
          SuccessEntitys: [],
          MsgCode: 11,
        },
        ConvertResponseStatus: {
          IsSuccess: true,
          Errors: [],
          SuccessEntitys: [{ Id: '115404', Number: null, DIndex: 0 }],
          MsgCode: 0,
        },
      },
    };
    const pushBill = vi.fn(async () => pushResult);
    const viewBill = vi.fn(async () => ({
      Result: {
        ResponseStatus: { IsSuccess: true },
        Result: {
          Id: 115404,
          FPOOrderEntry: [{ Id: 9001, FPrice: 0, FTaxPrice: 0 }],
        },
      },
    }));
    const saveBill = vi.fn(async () => ({
      Result: { ResponseStatus: { IsSuccess: true } },
    }));

    const data = await pushAftersaleRequisitions('REQ-1', '11', {
      pushBill,
      viewBill,
      saveBill,
    });

    expect(pushBill).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: 'PUR_Requisition',
        targetFormId: 'PUR_PurchaseOrder',
        isEnableDefaultRule: true,
        isDraftWhenSaveFail: true,
      }),
    );
    expect(viewBill).toHaveBeenCalledWith({
      formId: 'PUR_PurchaseOrder',
      billId: '115404',
    });
    expect(saveBill).toHaveBeenCalledWith({
      formId: 'PUR_PurchaseOrder',
      model: {
        IsDeleteEntry: 'false',
        Model: {
          FID: '115404',
          FPOOrderEntry: [
            {
              FENTRYID: 9001,
              FPrice: AFTERSALE_DEFAULT_PRICE,
              FTaxPrice: AFTERSALE_DEFAULT_PRICE,
            },
          ],
        },
      },
    });
    expect(readSaveOutcome(data).success).toBe(true);
  });
});
