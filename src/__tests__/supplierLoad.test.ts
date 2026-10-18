import { beforeEach, expect, vi } from 'vitest';
import { kingdeeApi } from '@/apis/kingdee/api';
import { loadInspectLines } from '@/features/supplier/load';

vi.mock('@/apis/kingdee/api', () => ({
  kingdeeApi: {
    queryMetadata: vi.fn(),
    queryBill: vi.fn(),
    queryBillRange: vi.fn(),
  },
}));

const metadata = {
  Result: {
    NeedReturnData: {
      Name: [{ Key: 2052, Value: '检验单' }],
      Entrys: [
        {
          Key: 'FBillHead',
          Fields: [
            {
              Key: 'FDate',
              Name: [{ Key: 2052, Value: '单据日期' }],
              FieldType: 61,
            },
            {
              Key: 'FHeadSupplier',
              Name: [{ Key: 2052, Value: '供应商' }],
              LookUpObjectFormId: 'BD_Supplier',
            },
          ],
        },
        {
          Key: 'FEntity',
          Fields: [
            {
              Key: 'FSupplierId',
              Name: [{ Key: 2052, Value: '供应商' }],
              LookUpObjectFormId: 'BD_Supplier',
            },
            {
              Key: 'FMaterialId',
              Name: [{ Key: 2052, Value: '物料编码' }],
              LookUpObjectFormId: 'BD_MATERIAL',
            },
            {
              Key: 'FQualifiedQty',
              Name: [{ Key: 2052, Value: '合格数' }],
              FieldType: 56,
            },
            {
              Key: 'FInspectQty',
              Name: [{ Key: 2052, Value: '检验数量' }],
              FieldType: 56,
            },
            {
              Key: 'FNote',
              Name: [{ Key: 2052, Value: '备注' }],
            },
          ],
        },
      ],
    },
  },
};

describe('loadInspectLines', () => {
  beforeEach(() => {
    vi.mocked(kingdeeApi.queryMetadata).mockReset();
    vi.mocked(kingdeeApi.queryBill).mockReset();
    vi.mocked(kingdeeApi.queryBillRange).mockReset();
    vi.mocked(kingdeeApi.queryMetadata).mockResolvedValue(metadata);
  });

  it('reads supplier names from ExecuteBillQuery rows, including localized names', async () => {
    vi.mocked(kingdeeApi.queryBill).mockImplementation(async (params) => {
      const rows =
        params.filterString?.includes(">= '2026-10-01'") === true
          ? [
              [
                '2026-10-02',
                [{ Key: 2052, Value: '甲供' }],
                'VEN001',
                '螺丝',
                'M-1',
                8,
                10,
                '包装破损',
              ],
              ['2026-10-03', '', 'VEN002', '螺母', 'M-2', 1, 1, ''],
            ]
          : [];
      return { rows, rowCount: rows.length, truncated: false };
    });

    const lines = await loadInspectLines(new Date(2026, 9, 18));

    expect(kingdeeApi.queryBillRange).not.toHaveBeenCalled();
    expect(kingdeeApi.queryBill).toHaveBeenCalled();
    const firstCall = vi.mocked(kingdeeApi.queryBill).mock.calls[0]?.[0];
    expect(firstCall?.topCount).toBe(0);
    expect(firstCall?.fieldKeys).toContain('FSupplierId.FName');
    expect(firstCall?.fieldKeys).not.toContain('FHeadSupplier');
    expect(lines.map((line) => line.supplier)).toEqual(['甲供', 'VEN002']);
    expect(lines[0]?.materialName).toBe('螺丝');
  });
});
