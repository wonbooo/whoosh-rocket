import * as XLSX from 'xlsx';
import { excelSerialToYmd } from '@/features/aftersale/parseExcel';
import {
  buildInStockApplyModel,
  placePackagingOrders,
} from '@/features/packaging/order';
import {
  groupPackagingBySupplier,
  parsePackagingWorkbook,
} from '@/features/packaging/parseExcel';
import { KINGDEE_FORM_IDS } from '@/types/kingdee';
import type { PackagingDetail } from '@/features/packaging/types';

function workbookFromAoa(rows: unknown[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  }) as Uint8Array;
}

const sampleDetails: PackagingDetail[] = [
  {
    id: 'd1',
    materialNumber: 'BCDJS10063',
    warehouse: 'CK338',
    qty: 200,
    owner: 'CP00220',
    expectInDate: '2026/09/29',
    keeper: 'mjs',
    supplier: 'CP00220',
    purchaser: '23050514',
  },
  {
    id: 'd2',
    materialNumber: 'BCDJS10101',
    warehouse: 'CK338',
    qty: 300,
    owner: 'CP00220',
    expectInDate: '2026/09/29',
    keeper: 'mjs',
    supplier: 'CP00220',
    purchaser: '23050514',
  },
  {
    id: 'd3',
    materialNumber: 'BCDJS20001',
    warehouse: 'CK338',
    qty: 10,
    owner: 'CP00182',
    expectInDate: '2026/09/29',
    keeper: 'mjs',
    supplier: 'CP00182',
    purchaser: '23050514',
  },
];

describe('packaging excel', () => {
  it('uses the custom 入库申请单 form id from Kingdee HTML5', () => {
    expect(KINGDEE_FORM_IDS.IN_STOCK_APPLY).toBe('PRZG_RKSQD');
  });
  it('converts excel serial 预计入库时间 to YYYY/MM/DD', () => {
    expect(excelSerialToYmd(46294)).toBe('2026/09/29');
  });

  it('parses two-row headers, nests details by 货主, and formats dates', () => {
    const buffer = workbookFromAoa([
      ['基础信息', '', '', '明细信息', '', '', '', '', ''],
      [
        '供应商',
        '采购员',
        '货主',
        '物料编码',
        '收货仓库',
        '申请数量',
        '货主',
        '预计入库时间',
        '保管者',
      ],
      [
        'CP00220',
        23050514,
        'CP00220',
        'BCDJS10063',
        'CK338',
        200,
        'CP00220',
        46294,
        'mjs',
      ],
      ['', '', '', 'BCDJS10101', 'CK338', 300, 'CP00220', 46294, 'mjs'],
      [
        'CP00182',
        '23050514',
        'CP00182',
        'BCDJS20001',
        'CK338',
        10,
        'CP00182',
        '2026/09/29',
        'mjs',
      ],
    ]);

    const groups = parsePackagingWorkbook(buffer);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.basic).toEqual(
      expect.objectContaining({
        supplier: 'CP00220',
        purchaser: '23050514',
        owner: 'CP00220',
      }),
    );
    expect(groups[0]?.details.map((item) => item.materialNumber)).toEqual([
      'BCDJS10063',
      'BCDJS10101',
    ]);
    expect(groups[0]?.details[0]?.expectInDate).toBe('2026/09/29');
    expect(groups[0]?.details[1]?.supplier).toBe('CP00220');
    expect(groups[1]?.details).toHaveLength(1);
    expect(groups[1]?.basic.owner).toBe('CP00182');
    expect(
      groupPackagingBySupplier(groups.flatMap((group) => group.details)).map(
        (item) => item.supplier,
      ),
    ).toEqual(['CP00220', 'CP00182']);
  });

  it('throws when a detail 货主 has no matching basic row', () => {
    const buffer = workbookFromAoa([
      ['基础信息', '', '', '明细信息', '', '', '', '', ''],
      [
        '供应商',
        '采购员',
        '货主',
        '物料编码',
        '收货仓库',
        '申请数量',
        '货主',
        '预计入库时间',
        '保管者',
      ],
      [
        'CP00220',
        '23050514',
        'CP00220',
        'BCDJS10063',
        'CK338',
        200,
        'CP99999',
        '2026/09/29',
        'mjs',
      ],
    ]);

    expect(() => parsePackagingWorkbook(buffer)).toThrow(/没有对应的基础信息/);
  });

  it('builds one in-stock apply model per supplier', () => {
    const model = buildInStockApplyModel([
      sampleDetails[0]!,
      sampleDetails[1]!,
    ]);
    expect(model.F_PRZG_GYS).toEqual({ FNumber: 'CP00220' });
    expect(model.F_PRZG_CGY).toEqual({ FNumber: '23050514' });
    expect(model.F_PRZG_HZ).toEqual({ FNumber: 'CP00220' });
    expect(model.FEntity).toEqual([
      expect.objectContaining({
        F_PRZG_WLBM: { FNumber: 'BCDJS10063' },
        F_PRZG_SHCK: { FNumber: 'CK338' },
        F_PRZG_HZ1: { FNumber: 'CP00220' },
        F_PRZG_YJRKRQ: '2026-09-29',
        F_PRZG_SQSL: 200,
        F_PRZG_BGZ1: { FNumber: 'mjs' },
      }),
      expect.objectContaining({
        F_PRZG_WLBM: { FNumber: 'BCDJS10101' },
        F_PRZG_SQSL: 300,
      }),
    ]);
  });

  it('places one in-stock apply per supplier', async () => {
    const saved: Record<string, unknown>[] = [];
    const result = await placePackagingOrders(
      sampleDetails,
      100201,
      async (model) => {
        saved.push(model);
        const supplier = (model.F_PRZG_GYS as { FNumber: string }).FNumber;
        return {
          Result: {
            ResponseStatus: {
              IsSuccess: true,
              SuccessEntitys: [{ Number: `RK-${supplier}` }],
            },
          },
        };
      },
    );

    expect(saved).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.succeeded.map((item) => item.billNos[0])).toEqual([
      'RK-CP00220',
      'RK-CP00182',
    ]);
    expect((saved[0]?.FEntity as unknown[]).length).toBe(2);
    expect((saved[1]?.FEntity as unknown[]).length).toBe(1);
  });
});
