import * as XLSX from 'xlsx';
import { toNextWeekdayDate } from '@/features/aftersale/requisition';
import {
  buildSubcontractOrderModel,
  placeSubcontractOrders,
} from '@/features/subcontract/order';
import {
  groupSubcontractBySupplier,
  parseSubcontractWorkbook,
} from '@/features/subcontract/parseExcel';
import type { SubcontractRow } from '@/features/subcontract/types';

const sampleRows: SubcontractRow[] = [
  {
    id: 'r1',
    materialName: 'DJS魔芋糯糯饼芋泥馅202g*24XLS-ZM1',
    materialNumber: 'DJS10020060132',
    qty: 2,
    planFinishDate: '2027/08/29',
    supplier: 'CP00219',
    purchaser: '23050514',
    warehouse: 'CK338',
  },
  {
    id: 'r2',
    materialName: 'DJS车轮坚果欧包（五黑味）50g*40XLS',
    materialNumber: 'DJS10010020191',
    qty: 2,
    planFinishDate: '2027/08/29',
    supplier: 'CP00123',
    purchaser: '23050514',
    warehouse: 'CK338',
  },
];

describe('subcontract excel', () => {
  it('moves weekend plan dates to the next weekday', () => {
    expect(toNextWeekdayDate('2027/08/29')).toBe('2027-08-30');
    expect(toNextWeekdayDate('2027/08/28')).toBe('2027-08-30');
    expect(toNextWeekdayDate('2027/08/30')).toBe('2027-08-30');
  });
  it('parses workbook dates as YYYY/MM/DD and groups by supplier', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        '物料名称',
        '物料编码',
        '数量',
        '计划完工时间',
        '供应商',
        '采购员',
        '仓库',
      ],
      ['饼A', 'DJS10020060132', 2, '2027/8/29', 'CP00219', '23050514', 'CK338'],
      ['饼B', 'DJS10010020191', 2, '2027/8/29', 'CP00123', '23050514', 'CK338'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
    }) as Uint8Array;

    const rows = parseSubcontractWorkbook(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.planFinishDate).toBe('2027/08/29');
    expect(
      groupSubcontractBySupplier(rows).map((item) => item.supplier),
    ).toEqual(['CP00219', 'CP00123']);
  });

  it('builds one subcontract order per supplier', () => {
    const model = buildSubcontractOrderModel([sampleRows[0]!], 100201);
    expect(model.FBillTypeID).toEqual({ FNumber: 'WWDD01_SYS' });
    expect(model.FSupplierId).toEqual({ FNumber: 'CP00219' });
    expect(model.FSubOrgId).toEqual({ Id: 100201 });
    expect(model.FTreeEntity).toEqual([
      expect.objectContaining({
        FMaterialId: { FNumber: 'DJS10020060132' },
        FQty: 2,
        FPlanFinishDate: '2027-08-30',
        FSupplierId: { FNumber: 'CP00219' },
        F_PRZG_procure: { FNumber: '23050514' },
        FStockId: { FNumber: 'CK338' },
      }),
    ]);
  });

  it('places one subcontract order per supplier', async () => {
    const saved: Record<string, unknown>[] = [];
    const result = await placeSubcontractOrders(
      sampleRows,
      100201,
      async (model) => {
        saved.push(model);
        const supplier = (model.FSupplierId as { FNumber: string }).FNumber;
        return {
          Result: {
            ResponseStatus: {
              IsSuccess: true,
              SuccessEntitys: [{ Number: `WW-${supplier}` }],
            },
          },
        };
      },
    );

    expect(saved).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.succeeded.map((item) => item.billNos[0])).toEqual([
      'WW-CP00219',
      'WW-CP00123',
    ]);
  });
});
