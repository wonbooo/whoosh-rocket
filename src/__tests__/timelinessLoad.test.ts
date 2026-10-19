import { beforeEach, expect, vi } from 'vitest';
import { kingdeeApi } from '@/apis/kingdee/api';
import {
  arrivalWindows,
  loadArrivalSources,
} from '@/features/supplier/loadTimeliness';

vi.mock('@/apis/kingdee/api', () => ({
  kingdeeApi: {
    queryMetadata: vi.fn(),
    queryBill: vi.fn(),
  },
}));

function localized(name: string, value: string) {
  return {
    Key: name,
    Name: [{ Key: 2052, Value: value }],
    FieldType: value.includes('日期') ? 61 : value.includes('数量') ? 56 : 0,
    ...(value.includes('供应商') || value.includes('物料')
      ? {
          LookUpObjectFormId: value.includes('物料')
            ? 'BD_MATERIAL'
            : 'BD_Supplier',
        }
      : {}),
  };
}

function metadata(
  formName: string,
  entities: { key: string; fields: Array<[string, string]> }[],
) {
  return {
    Result: {
      NeedReturnData: {
        Name: [{ Key: 2052, Value: formName }],
        Entrys: entities.map((entity) => ({
          Key: entity.key,
          Fields: entity.fields.map(([key, name]) => localized(key, name)),
        })),
      },
    },
  };
}

const purchaseMetadata = metadata('采购订单', [
  {
    key: 'FBillHead',
    fields: [
      ['FBillNo', '单据编号'],
      ['FSupplierId', '供应商'],
      ['FCloseStatus', '关闭状态'],
      ['FCancelStatus', '作废状态'],
    ],
  },
  {
    key: 'FPOOrderEntry',
    fields: [
      ['FMaterialId', '物料编码'],
      ['FQty', '采购数量'],
      ['FDeliveryDate', '交货日期'],
      ['FEntryID', '分录内码'],
      ['FMRPCloseStatus', '业务关闭'],
      ['FMRPFreezeStatus', '业务冻结'],
      ['FMRPTerminateStatus', '业务终止'],
    ],
  },
]);

const receiveMetadata = metadata('收料通知单', [
  { key: 'FBillHead', fields: [['FDate', '收料日期']] },
  {
    key: 'FDetailEntity',
    fields: [
      ['FActReceiveQty', '实收数量'],
      ['FOrderBillNo', '订单单号'],
      ['FPOOrderEntryId', '采购订单分录内码'],
      ['FMaterialId', '物料编码'],
    ],
  },
]);

const instockMetadata = metadata('采购入库单', [
  { key: 'FBillHead', fields: [['FDate', '入库日期']] },
  {
    key: 'FInStockEntry',
    fields: [
      ['FRealQty', '实收数量'],
      ['FPOOrderNo', '订单单号'],
      ['FPOOrderEntryId', '采购订单分录内码'],
      ['FMaterialId', '物料编码'],
    ],
  },
]);

function valuesFor(
  fieldKeys: string,
  values: Record<string, unknown>,
): unknown[] {
  return fieldKeys.split(',').map((key) => values[key] ?? '');
}

describe('loadArrivalSources', () => {
  beforeEach(() => {
    vi.mocked(kingdeeApi.queryMetadata).mockReset();
    vi.mocked(kingdeeApi.queryBill).mockReset();
    vi.mocked(kingdeeApi.queryMetadata).mockImplementation(async (formId) => {
      if (formId === 'PUR_ReceiveBill') {
        return receiveMetadata;
      }
      if (formId === 'STK_InStock') {
        return instockMetadata;
      }
      return purchaseMetadata;
    });
  });

  it('reads approved order lines and both arrival documents', async () => {
    const today = new Date(2026, 9, 18);
    const windows = arrivalWindows(today);
    vi.mocked(kingdeeApi.queryBill).mockImplementation(async (params) => {
      const fieldKeys = params.fieldKeys ?? '';
      const empty = { rows: [], rowCount: 0, truncated: false };
      if (!params.filterString?.includes(">= '2026-10-01'")) {
        return empty;
      }
      if (params.formId === 'PUR_PurchaseOrder') {
        const rows = [
          valuesFor(fieldKeys, {
            FBillNo: 'PO-1',
            'FSupplierId.FName': [{ Key: 2052, Value: '甲供' }],
            'FMaterialId.FName': '螺丝',
            'FMaterialId.FNumber': 'M-1',
            FQty: 10,
            FDeliveryDate: '2026-10-01T00:00:00',
            FPOOrderEntry_FEntryID: 'E1',
            FCloseStatus: 'A',
            FMRPCloseStatus: 'A',
            FMRPFreezeStatus: 'A',
            FMRPTerminateStatus: 'A',
          }),
          valuesFor(fieldKeys, {
            FBillNo: 'PO-2',
            'FSupplierId.FName': '乙供',
            'FMaterialId.FName': '垫片',
            'FMaterialId.FNumber': 'M-2',
            FQty: 4,
            FDeliveryDate: '2026-10-02',
            FPOOrderEntry_FEntryID: 'E2',
            FCloseStatus: 'A',
            FMRPCloseStatus: 'B',
            FMRPFreezeStatus: 'A',
            FMRPTerminateStatus: 'A',
          }),
        ];
        return { rows, rowCount: rows.length, truncated: false };
      }
      if (params.formId === 'PUR_ReceiveBill') {
        const rows = [
          valuesFor(fieldKeys, {
            FDate: '2026-10-01',
            FActReceiveQty: 6,
            FOrderBillNo: 'PO-1',
            FPOOrderEntryId: 'E1',
            'FMaterialId.FNumber': 'M-1',
          }),
        ];
        return { rows, rowCount: rows.length, truncated: false };
      }
      const rows = [
        valuesFor(fieldKeys, {
          FDate: '2026-10-03',
          FRealQty: 4,
          FPOOrderNo: 'PO-1',
          FPOOrderEntryId: 'E1',
          'FMaterialId.FNumber': 'M-1',
        }),
      ];
      return { rows, rowCount: rows.length, truncated: false };
    });

    const loaded = await loadArrivalSources(today);
    const purchaseCall = vi
      .mocked(kingdeeApi.queryBill)
      .mock.calls.map((call) => call[0])
      .find((params) => params?.formId === 'PUR_PurchaseOrder');
    expect(purchaseCall?.filterString).toContain(
      `FDeliveryDate >= '${windows.delivery.dateFrom}'`,
    );
    expect(purchaseCall?.filterString).toContain("FDocumentStatus = 'C'");
    expect(purchaseCall?.filterString).toContain("FCancelStatus = 'A'");
    const receiveCall = vi
      .mocked(kingdeeApi.queryBill)
      .mock.calls.map((call) => call[0])
      .find((params) => params?.formId === 'PUR_ReceiveBill');
    expect(receiveCall?.filterString).toContain(
      `FDate >= '${windows.receipt.dateFrom}'`,
    );
    expect(receiveCall?.filterString).toContain("FDocumentStatus = 'C'");

    expect(loaded.lines).toEqual([
      {
        supplier: '甲供',
        billNo: 'PO-1',
        entryId: 'E1',
        materialNumber: 'M-1',
        materialName: '螺丝',
        orderQty: 10,
        deliveryDate: '2026-10-01',
        excluded: false,
      },
      {
        supplier: '乙供',
        billNo: 'PO-2',
        entryId: 'E2',
        materialNumber: 'M-2',
        materialName: '垫片',
        orderQty: 4,
        deliveryDate: '2026-10-02',
        excluded: true,
      },
    ]);
    expect(loaded.receive).toEqual([
      {
        entryId: 'E1',
        billNo: 'PO-1',
        materialNumber: 'M-1',
        date: '2026-10-01',
        qty: 6,
      },
    ]);
    expect(loaded.instock).toEqual([
      {
        entryId: 'E1',
        billNo: 'PO-1',
        materialNumber: 'M-1',
        date: '2026-10-03',
        qty: 4,
      },
    ]);
  });
});
