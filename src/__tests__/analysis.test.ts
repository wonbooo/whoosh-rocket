import {
  aggregate,
  compileFilter,
  compileFilters,
  defaultFieldDisplay,
  fieldKeys,
  queryKey,
  resolveDataset,
  resolveRelativeDate,
  validateDataset,
} from '@/features/analysis/model';
import type { AggregatedRow } from '@/features/analysis/model';
import { chartData, chartSpec } from '@/features/analysis/chartSpec';
import {
  controlKind,
  mergeCatalogs,
  parseCatalog,
} from '@/features/analysis/catalog';
import type { FieldCatalog } from '@/features/analysis/catalog';
import {
  readCatalogCache,
  writeCatalogCache,
  catalogCacheKey,
} from '@/features/analysis/catalogCache';
import type { CatalogScope } from '@/features/analysis/catalogCache';
import { beginCatalogLoad, searchLookup } from '@/features/analysis/query';
import { queryChart, queryMerged } from '@/features/analysis/merge';
import {
  loadAnalysisSettings,
  loadAnalysisState,
  saveAnalysisSettings,
  saveAnalysisState,
} from '@/features/analysis/storage';
import {
  filterFormOptions,
  formLabel,
  FORM_OPTIONS,
} from '@/features/analysis/forms';
import type { Dataset } from '@/features/analysis/types';
import type { PersistedRecord } from '@/lib/persistedRecord';
import {
  BOARD_TEMPLATES,
  instantiateTemplate,
} from '@/features/analysis/templates';
import { groupOverlaps } from '@/features/analysis/overlap';
import { findTheme } from '@/features/analysis/themes';
import { useAnalysisStore } from '@/features/analysis/store';
import type { Widget } from '@/features/analysis/types';

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: '销售按客户',
    formId: 'SAL_SaleOrder',
    dimension: { field: 'FCustId', display: 'name' },
    series: null,
    seriesCases: [],
    measure: { field: 'FBillAmount', display: 'value' },
    aggregation: 'sum',
    columns: [],
    filters: [],
    limit: 20,
    chartType: 'bar',
    ...overrides,
  };
}

describe('dataset validation', () => {
  it('requires a name', () => {
    expect(validateDataset(dataset({ name: ' ' })).message).toBe(
      '请填写数据集名称',
    );
  });

  it('rejects fields that are not identifiers', () => {
    expect(
      validateDataset(
        dataset({ dimension: { field: 'FName; DROP', display: 'value' } }),
      ).valid,
    ).toBe(false);
  });

  it('rejects a filter whose comparison value is not numeric', () => {
    expect(
      validateDataset(
        dataset({ filters: [{ field: 'FQty', operator: 'gt', value: 'abc' }] }),
      ).message,
    ).toBe('大于、小于比较的值必须是数字');
  });

  it('accepts a field comparison and a relative date without a literal value', () => {
    expect(
      validateDataset(
        dataset({
          filters: [
            {
              field: 'FInStockQty',
              operator: 'lt',
              value: 'FReceiveQty',
              valueMode: 'field',
            },
            {
              field: 'FDeliveryDate',
              operator: 'lt',
              value: 'today',
              valueMode: 'relativeDate',
            },
          ],
        }),
      ).valid,
    ).toBe(true);
  });

  it('rejects a field comparison against a non-identifier', () => {
    expect(
      validateDataset(
        dataset({
          filters: [
            {
              field: 'FInStockQty',
              operator: 'lt',
              value: '1 OR 1',
              valueMode: 'field',
            },
          ],
        }),
      ).valid,
    ).toBe(false);
  });

  it('accepts a complete dataset', () => {
    expect(validateDataset(dataset()).valid).toBe(true);
  });

  it('rejects a sum measure the catalog knows is not numeric', () => {
    const catalog: FieldCatalog = {
      formId: 'SAL_SaleOrder',
      formName: '销售订单',
      fields: [
        {
          key: 'FNote',
          name: '备注',
          entity: '',
          kind: 'text',
          lookupFormId: null,
          options: [],
        },
      ],
    };
    expect(
      validateDataset(
        dataset({
          chartType: 'bar-horizontal',
          measure: { field: 'FNote', display: 'value' },
        }),
        'chart',
        catalog,
      ).message,
    ).toBe(
      'X 轴不是数值。要按两个文本字段交叉统计，请把第二个字段填到「图例」，X 轴留空并把统计方式改为计数；要求和、请把X 轴换成数量或金额字段',
    );
  });

  it('accepts a sum measure when the catalog is missing or does not list the field', () => {
    const catalog: FieldCatalog = {
      formId: 'SAL_SaleOrder',
      formName: '销售订单',
      fields: [
        {
          key: 'FQty',
          name: '数量',
          entity: '',
          kind: 'number',
          lookupFormId: null,
          options: [],
        },
      ],
    };
    expect(
      validateDataset(
        dataset({ measure: { field: 'FNote', display: 'value' } }),
        'chart',
        null,
      ).valid,
    ).toBe(true);
    expect(
      validateDataset(
        dataset({ measure: { field: 'FNote', display: 'value' } }),
        'chart',
        catalog,
      ).valid,
    ).toBe(true);
    expect(
      validateDataset(
        dataset({ measure: { field: 'FQty', display: 'value' } }),
        'chart',
        catalog,
      ).valid,
    ).toBe(true);
  });
});

describe('query compilation', () => {
  it('resolves a base-data field to its name or number', () => {
    expect(queryKey({ field: 'FSupplierId', display: 'name' })).toBe(
      'FSupplierId.FName',
    );
    expect(queryKey({ field: 'FMaterialId', display: 'number' })).toBe(
      'FMaterialId.FNumber',
    );
    expect(queryKey({ field: 'FQty', display: 'value' })).toBe('FQty');
  });

  it('does not suffix plain fields that were stored as names', () => {
    const catalog: FieldCatalog = {
      formId: 'PUR_PurchaseOrder',
      formName: '采购订单',
      fields: [
        {
          key: 'FSupplierId',
          name: '供应商',
          entity: 'FBillHead',
          kind: 'lookup',
          lookupFormId: 'BD_Supplier',
          options: [],
        },
        {
          key: 'FQty',
          name: '采购数量',
          entity: 'FPOOrderEntry',
          kind: 'number',
          lookupFormId: null,
          options: [],
        },
        {
          key: 'FDate',
          name: '采购日期',
          entity: 'FBillHead',
          kind: 'date',
          lookupFormId: null,
          options: [],
        },
        {
          key: 'FBillNo',
          name: '单据编号',
          entity: 'FBillHead',
          kind: 'text',
          lookupFormId: null,
          options: [],
        },
        {
          key: 'FDocumentStatus',
          name: '单据状态',
          entity: 'FBillHead',
          kind: 'enum',
          lookupFormId: null,
          options: [],
        },
      ],
    };
    expect(defaultFieldDisplay(catalog, 'FQty')).toBe('value');
    expect(defaultFieldDisplay(catalog, 'FDate')).toBe('value');
    expect(defaultFieldDisplay(catalog, 'FBillNo')).toBe('value');
    expect(defaultFieldDisplay(catalog, 'FDocumentStatus')).toBe('value');
    expect(defaultFieldDisplay(catalog, 'FSupplierId')).toBe('name');
    expect(defaultFieldDisplay(catalog, 'FUnknown')).toBe('name');
    expect(defaultFieldDisplay(null, 'FQty')).toBe('name');
    expect(
      fieldKeys(
        resolveDataset(
          dataset({
            formId: 'PUR_PurchaseOrder',
            dimension: { field: 'FSupplierId', display: 'name' },
            series: { field: 'FDocumentStatus', display: 'name' },
            measure: { field: 'FQty', display: 'name' },
            columns: [
              { field: 'FDate', display: 'name' },
              { field: 'FBillNo', display: 'number' },
            ],
          }),
          catalog,
        ),
      ),
    ).toBe('FSupplierId.FName,FDocumentStatus,FQty,FDate,FBillNo');
    expect(
      fieldKeys(
        resolveDataset(
          dataset({
            dimension: { field: 'FSupplierId', display: 'number' },
            measure: { field: 'FQty', display: 'value' },
          }),
          catalog,
        ),
      ),
    ).toBe('FSupplierId.FNumber,FQty');
    expect(
      fieldKeys(
        resolveDataset(
          dataset({ measure: { field: 'FQty', display: 'name' } }),
          null,
        ),
      ),
    ).toBe('FCustId.FName,FQty.FName');
  });

  it('compiles field keys with the display property appended', () => {
    expect(
      fieldKeys(
        dataset({
          filters: [
            { field: 'FDocumentStatus', operator: 'eq', value: 'C' },
            { field: 'FCustId.FName', operator: 'contains', value: '甲' },
          ],
        }),
      ),
    ).toBe('FCustId.FName,FBillAmount,FDocumentStatus');
  });

  it('omits the measure when aggregating by count', () => {
    expect(fieldKeys(dataset({ aggregation: 'count' }))).toBe('FCustId.FName');
  });

  it('compiles filters and escapes quotes', () => {
    expect(
      compileFilters([
        { field: 'FDocumentStatus', operator: 'eq', value: "C'1" },
        { field: 'FBillAmount', operator: 'gt', value: '1000' },
        { field: 'FCustId.FName', operator: 'contains', value: '甲' },
      ]),
    ).toBe(
      "FDocumentStatus = 'C''1' AND FBillAmount > 1000 AND FCustId.FName like '%甲%'",
    );
  });

  it('compiles a field comparison unquoted and includes both fields', () => {
    expect(
      compileFilters([
        {
          field: 'FInStockQty',
          operator: 'lt',
          value: 'FReceiveQty',
          valueMode: 'field',
        },
      ]),
    ).toBe('FInStockQty < FReceiveQty');
    expect(
      fieldKeys(
        dataset({
          filters: [
            {
              field: 'FInStockQty',
              operator: 'lt',
              value: 'FReceiveQty',
              valueMode: 'field',
            },
          ],
        }),
      ),
    ).toBe('FCustId.FName,FBillAmount,FInStockQty,FReceiveQty');
  });

  it('resolves relative dates against a fixed day', () => {
    const today = new Date(2026, 8, 30);
    expect(resolveRelativeDate('today', today)).toEqual({
      start: '2026-09-30',
      end: '2026-09-30',
    });
    expect(resolveRelativeDate('thisMonth', today)).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    });
    expect(resolveRelativeDate('last365Days', today).start).toBe('2025-09-30');
    expect(
      compileFilters(
        [
          {
            field: 'FDeliveryDate',
            operator: 'lt',
            value: 'today',
            valueMode: 'relativeDate',
          },
          {
            field: 'FDate',
            operator: 'eq',
            value: 'thisMonth',
            valueMode: 'relativeDate',
          },
        ],
        today,
      ),
    ).toBe(
      "FDeliveryDate < '2026-09-30' AND FDate >= '2026-09-01' AND FDate <= '2026-09-30'",
    );
  });

  it('compiles a calendar date as a day range and keeps numeric comparisons', () => {
    expect(
      compileFilters([
        { field: 'FDate', operator: 'eq', value: '2026-09-30' },
        { field: 'FDate', operator: 'gt', value: '2026-09-30' },
        { field: 'FDate', operator: 'lt', value: '2026-09-30' },
        { field: 'FDate', operator: 'neq', value: '2026-12-31' },
        { field: 'FBillAmount', operator: 'gt', value: '1000' },
      ]),
    ).toBe(
      "FDate >= '2026-09-30' AND FDate < '2026-10-01' AND FDate >= '2026-10-01' AND FDate < '2026-09-30' AND (FDate < '2026-12-31' OR FDate >= '2027-01-01') AND FBillAmount > 1000",
    );
  });

  it('compiles a supplier code by number and a contains by name', () => {
    expect(
      compileFilter({
        field: 'FSupplierId',
        operator: 'eq',
        value: 'VEN001',
        valueLabel: '甲供应商',
        valueMode: 'lookup',
      }),
    ).toBe("FSupplierId.FNumber = 'VEN001'");
    expect(
      compileFilter({
        field: 'FSupplierId',
        operator: 'neq',
        value: "O'Hara",
        valueMode: 'lookup',
      }),
    ).toBe("FSupplierId.FNumber <> 'O''Hara'");
    expect(
      compileFilter({
        field: 'FSupplierId',
        operator: 'contains',
        value: 'VEN001',
        valueLabel: '甲供应商',
        valueMode: 'lookup',
      }),
    ).toBe("FSupplierId.FName like '%甲供应商%'");
    expect(
      compileFilter({
        field: 'FSupplierId.FName',
        operator: 'contains',
        value: '甲',
        valueMode: 'lookup',
      }),
    ).toBe("FSupplierId.FName like '%甲%'");
  });

  it('accepts a calendar date for greater-than and still rejects text', () => {
    expect(
      validateDataset(
        dataset({
          filters: [{ field: 'FDate', operator: 'gt', value: '2026-09-30' }],
        }),
      ).valid,
    ).toBe(true);
    expect(
      validateDataset(
        dataset({
          filters: [{ field: 'FDate', operator: 'lt', value: '2026-02-31' }],
        }),
      ).message,
    ).toBe('大于、小于比较的值必须是数字');
  });
});

describe('aggregation', () => {
  it('sums per dimension and keeps every group', () => {
    const result = aggregate(
      [
        ['甲公司', 100],
        ['乙公司', '20'],
        ['甲公司', 50],
        ['丙公司', 'not-a-number'],
        ['丁公司', 5],
        { not: 'a row' },
      ],
      dataset({ limit: 2 }),
    );
    expect(result.rows).toEqual([
      { dimension: '甲公司', value: 150, series: { '': 150 } },
      { dimension: '乙公司', value: 20, series: { '': 20 } },
      { dimension: '丁公司', value: 5, series: { '': 5 } },
    ]);
    expect(result.skipped).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('filters rows before aggregating', () => {
    const result = aggregate(
      [
        ['甲公司', 100, 'C'],
        ['乙公司', 40, 'A'],
        ['甲公司', 10, 'C'],
      ],
      dataset({
        filters: [{ field: 'FDocumentStatus', operator: 'eq', value: 'C' }],
      }),
    );
    expect(result.rows).toEqual([
      { dimension: '甲公司', value: 110, series: { '': 110 } },
    ]);
  });

  it('keeps rows whose field is below another field', () => {
    const result = aggregate(
      [
        ['甲', 1, 8, 10],
        ['乙', 1, 12, 10],
        ['甲', 1, 5, 5],
      ],
      dataset({
        filters: [
          {
            field: 'FInStockQty',
            operator: 'lt',
            value: 'FReceiveQty',
            valueMode: 'field',
          },
        ],
      }),
    );
    expect(result.rows).toEqual([
      { dimension: '甲', value: 1, series: { '': 1 } },
    ]);
  });

  it('matches a lookup filter on the name or number, not the inner id', () => {
    const contains = dataset({
      aggregation: 'count',
      dimension: { field: 'FMaterialId', display: 'name' },
      columns: [{ field: 'FBillNo', display: 'value' }],
      filters: [
        {
          field: 'FSupplierId',
          operator: 'contains',
          value: 'XLS',
          valueMode: 'lookup',
        },
      ],
    });
    expect(fieldKeys(contains)).toBe(
      'FMaterialId.FName,FBillNo,FSupplierId,FSupplierId.FName',
    );
    expect(
      aggregate(
        [
          ['冻干鸡胸肉', 'CG001', '10001', '中宝（福建）食品科技有限公司XLS'],
          ['玻璃瓶', 'CG002', '10002', '徐州乐蒂安玻璃制品有限公司'],
        ],
        contains,
      ).rows,
    ).toEqual([{ dimension: '冻干鸡胸肉', value: 1, series: { '': 1 } }]);

    const equals = dataset({
      aggregation: 'count',
      dimension: { field: 'FMaterialId', display: 'name' },
      columns: [{ field: 'FBillNo', display: 'value' }],
      filters: [
        {
          field: 'FSupplierId',
          operator: 'eq',
          value: 'VEN001',
          valueLabel: '中宝（福建）食品科技有限公司XLS',
          valueMode: 'lookup',
        },
      ],
    });
    expect(fieldKeys(equals)).toBe(
      'FMaterialId.FName,FBillNo,FSupplierId,FSupplierId.FNumber',
    );
    expect(
      aggregate(
        [
          ['冻干鸡胸肉', 'CG001', '10001', 'VEN001'],
          ['玻璃瓶', 'CG002', '10002', 'VEN002'],
        ],
        equals,
      ).rows,
    ).toEqual([{ dimension: '冻干鸡胸肉', value: 1, series: { '': 1 } }]);
  });

  it('matches a datetime cell against the whole day', () => {
    const result = aggregate(
      [
        ['甲', '2026-09-30T08:15:00'],
        ['乙', '2026-09-29T23:00:00'],
      ],
      dataset({
        aggregation: 'count',
        filters: [
          {
            field: 'FDeliveryDate',
            operator: 'eq',
            value: 'today',
            valueMode: 'relativeDate',
          },
        ],
      }),
      new Date(2026, 8, 30),
    );
    expect(result.rows).toEqual([
      { dimension: '甲', value: 1, series: { '': 1 } },
    ]);
  });

  it('matches a datetime cell against a calendar day', () => {
    const result = aggregate(
      [
        ['甲', '2026-09-30T08:15:00'],
        ['乙', '2026-10-01T00:00:00'],
      ],
      dataset({
        aggregation: 'count',
        filters: [
          { field: 'FDeliveryDate', operator: 'eq', value: '2026-09-30' },
        ],
      }),
    );
    expect(result.rows).toEqual([
      { dimension: '甲', value: 1, series: { '': 1 } },
    ]);
  });

  it('keeps rows dated before today', () => {
    const result = aggregate(
      [
        ['甲', 1, '2026-09-29'],
        ['乙', 1, '2026-10-01'],
      ],
      dataset({
        filters: [
          {
            field: 'FDeliveryDate',
            operator: 'lt',
            value: 'today',
            valueMode: 'relativeDate',
          },
        ],
      }),
      new Date(2026, 8, 30),
    );
    expect(result.rows).toEqual([
      { dimension: '甲', value: 1, series: { '': 1 } },
    ]);
  });

  it('counts rows when aggregation is count', () => {
    const result = aggregate(
      [['甲公司'], ['甲公司'], ['乙公司']],
      dataset({ aggregation: 'count' }),
    );
    expect(result.rows).toEqual([
      { dimension: '甲公司', value: 2, series: { '': 2 } },
      { dimension: '乙公司', value: 1, series: { '': 1 } },
    ]);
    expect(result.skipped).toBe(0);
  });

  it('reads the display name out of base-data cells', () => {
    const result = aggregate(
      [[{ FName: '甲公司', FNumber: 'C001' }, 3]],
      dataset(),
    );
    expect(result.rows).toEqual([
      { dimension: '甲公司', value: 3, series: { '': 3 } },
    ]);
  });

  it('counts rows split by a second text field', () => {
    const result = aggregate(
      [
        ['甲供应商', '螺栓'],
        ['甲供应商', '螺母'],
        ['甲供应商', '螺栓'],
        ['乙供应商', '螺栓'],
      ],
      dataset({
        aggregation: 'count',
        measure: { field: '', display: 'value' },
        series: { field: 'FMaterialId', display: 'name' },
      }),
    );
    expect(result.skipped).toBe(0);
    expect(result.rows).toEqual([
      { dimension: '甲供应商', value: 3, series: { 螺栓: 2, 螺母: 1 } },
      { dimension: '乙供应商', value: 1, series: { 螺栓: 1 } },
    ]);
  });

  it('sums a numeric measure per dimension and series', () => {
    const result = aggregate(
      [
        ['甲供应商', '螺栓', 10],
        ['甲供应商', '螺栓', 5],
        ['甲供应商', '螺母', 4],
      ],
      dataset({ series: { field: 'FMaterialId', display: 'name' } }),
    );
    expect(result.rows).toEqual([
      {
        dimension: '甲供应商',
        value: 19,
        series: { 螺栓: 15, 螺母: 4 },
      },
    ]);
  });

  it('keeps each date when an older dataset still asks to group by month', () => {
    const result = aggregate(
      [
        ['2026-08-15', 5],
        ['2026-07-02', 3],
        ['2026-08-30', 7],
        ['2026-09-01', 1],
      ],
      Object.assign(
        dataset({
          dimension: { field: 'FDate', display: 'value' },
          limit: 2,
        }),
        { grain: 'month' },
      ),
    );
    expect(result.rows).toEqual([
      { dimension: '2026-08-30', value: 7, series: { '': 7 } },
      { dimension: '2026-08-15', value: 5, series: { '': 5 } },
      { dimension: '2026-07-02', value: 3, series: { '': 3 } },
      { dimension: '2026-09-01', value: 1, series: { '': 1 } },
    ]);
  });

  it('splits rows into named series by conditions', () => {
    const result = aggregate(
      [
        ['甲', '2026-09-01'],
        ['甲', '2026-10-05'],
        ['乙', '2026-10-20'],
      ],
      dataset({
        aggregation: 'count',
        seriesCases: [
          {
            label: '逾期',
            field: 'FDeliveryDate',
            operator: 'lt',
            value: 'today',
            valueMode: 'relativeDate',
          },
          {
            label: '未逾期',
            field: 'FDeliveryDate',
            operator: 'gt',
            value: 'today',
            valueMode: 'relativeDate',
          },
        ],
      }),
      new Date(2026, 8, 30),
    );
    expect(result.rows).toEqual([
      { dimension: '甲', value: 2, series: { 逾期: 1, 未逾期: 1 } },
      { dimension: '乙', value: 1, series: { 未逾期: 1 } },
    ]);
  });

  it('keeps the detail rows instead of only the totals', () => {
    const result = aggregate(
      [
        ['甲', 10, 'PO001'],
        ['乙', 4, 'PO002'],
      ],
      dataset({
        columns: [
          { field: 'FBillNo', display: 'value' },
          { field: 'FBillAmount', display: 'value' },
        ],
      }),
    );
    expect(result.detail).toEqual([
      { cells: ['PO001', '10'] },
      { cells: ['PO002', '4'] },
    ]);
  });
});

describe('field catalog', () => {
  it('parses fields from the kingdee metadata shape', () => {
    const catalog = parseCatalog('SAL_SaleOrder', {
      Result: {
        NeedReturnData: {
          Name: [{ Key: 2052, Value: '销售订单' }],
          Entrys: [
            {
              Key: 'FBillHead',
              Fields: [
                { Key: 'FBillNo', Name: [{ Key: 2052, Value: '单据编号' }] },
                {
                  Key: 'FCustId',
                  Name: [{ Key: 2052, Value: '客户' }],
                  LookUpObjectFormId: 'BD_Customer',
                },
              ],
            },
            {
              Key: 'FSaleOrderEntry',
              Fields: [
                { Key: 'FMaterialId', Name: [{ Key: 2052, Value: '物料' }] },
                { Key: 'FBillNo', Name: [{ Key: 2052, Value: '重复字段' }] },
              ],
            },
          ],
        },
      },
    });
    expect(catalog.formName).toBe('销售订单');
    expect(catalog.fields.map((field) => field.key)).toEqual([
      'FBillNo',
      'FCustId',
      'FMaterialId',
    ]);
    expect(catalog.fields[1]).toMatchObject({
      name: '客户',
      lookupFormId: 'BD_Customer',
      options: [],
    });
    expect(catalog.fields[2]).toMatchObject({
      name: '物料',
      entity: 'FSaleOrderEntry',
      lookupFormId: null,
    });
  });

  it('reads dropdown options from the metadata and keeps the stored code', () => {
    const catalog = parseCatalog('PUR_PurchaseOrder', {
      Result: {
        NeedReturnData: {
          Entrys: [
            {
              Key: 'FBillHead',
              Fields: [
                {
                  Key: 'FDocumentStatus',
                  Name: [{ Key: 2052, Value: '单据状态' }],
                  EnumObject: {
                    Items: [
                      { Value: 'A', Caption: [{ Key: 2052, Value: '创建' }] },
                      { Value: 'C', Caption: [{ Key: 2052, Value: '已审核' }] },
                    ],
                  },
                },
                { Key: 'FBillNo', Name: [{ Key: 2052, Value: '单据编号' }] },
              ],
            },
          ],
        },
      },
    });
    expect(catalog.fields[0]?.options).toEqual([
      { value: 'A', label: '创建' },
      { value: 'C', label: '已审核' },
    ]);
    expect(catalog.fields[1]?.options).toEqual([]);
  });

  it('classifies date, number, lookup, enum and text fields', () => {
    const catalog = parseCatalog('PUR_PurchaseOrder', {
      Result: {
        NeedReturnData: {
          Entrys: [
            {
              Key: 'FBillHead',
              Fields: [
                {
                  Key: 'FDate',
                  Name: [{ Key: 2052, Value: '日期' }],
                  FieldType: 61,
                },
                {
                  Key: 'FQty',
                  Name: [{ Key: 2052, Value: '数量' }],
                  FieldType: '56',
                },
                {
                  Key: 'FSupplierId',
                  Name: [{ Key: 2052, Value: '供应商' }],
                  LookUpObjectFormId: 'BD_Supplier',
                  FieldType: 56,
                },
                {
                  Key: 'FDocumentStatus',
                  Name: [{ Key: 2052, Value: '单据状态' }],
                  EnumObject: {
                    Items: [
                      { Value: 'A', Caption: [{ Key: 2052, Value: '创建' }] },
                      { Value: 'C', Caption: [{ Key: 2052, Value: '已审核' }] },
                    ],
                  },
                },
                {
                  Key: 'FDeliveryDate',
                  Name: [{ Key: 2052, Value: '交货日期' }],
                },
                {
                  Key: 'FNote',
                  Name: [{ Key: 2052, Value: '备注日期' }],
                  FieldType: 167,
                },
                { Key: 'FBillNo', Name: [{ Key: 2052, Value: '单据编号' }] },
              ],
            },
          ],
        },
      },
    });
    expect(catalog.fields.map((field) => [field.key, field.kind])).toEqual([
      ['FDate', 'date'],
      ['FQty', 'number'],
      ['FSupplierId', 'lookup'],
      ['FDocumentStatus', 'enum'],
      ['FDeliveryDate', 'date'],
      ['FNote', 'text'],
      ['FBillNo', 'text'],
    ]);
    expect(controlKind(catalog, 'FCloseStatus')).toBe('enum');
    expect(controlKind(null, 'FDeliveryDate')).toBe('date');
  });

  it('unions fields from the forms on a dashboard by key', () => {
    const merged = mergeCatalogs([
      {
        formId: 'PUR_PurchaseOrder',
        formName: '采购订单',
        fields: [
          {
            key: 'FSupplierId',
            name: '供应商',
            entity: '',
            kind: 'lookup',
            lookupFormId: 'BD_Supplier',
            options: [],
          },
          {
            key: 'FDate',
            name: '日期',
            entity: '',
            kind: 'date',
            lookupFormId: null,
            options: [],
          },
          {
            key: 'FDocumentStatus',
            name: '单据状态',
            entity: '',
            kind: 'enum',
            lookupFormId: null,
            options: [{ value: 'C', label: '已审核' }],
          },
        ],
      },
      {
        formId: 'PUR_ReceiveBill',
        formName: '收料通知单',
        fields: [
          {
            key: 'FSupplierId',
            name: '供应商',
            entity: '',
            kind: 'text',
            lookupFormId: null,
            options: [],
          },
          {
            key: 'FDate',
            name: 'FDate',
            entity: '',
            kind: 'text',
            lookupFormId: null,
            options: [],
          },
          {
            key: 'FBillNo',
            name: '单据编号',
            entity: '',
            kind: 'text',
            lookupFormId: null,
            options: [],
          },
          {
            key: 'FDocumentStatus',
            name: '单据状态',
            entity: '',
            kind: 'enum',
            lookupFormId: null,
            options: [{ value: 'A', label: '创建' }],
          },
        ],
      },
    ]);
    expect(
      merged.fields.map((field) => [field.key, field.kind, field.name]),
    ).toEqual([
      ['FSupplierId', 'lookup', '供应商'],
      ['FDate', 'date', '日期'],
      ['FDocumentStatus', 'enum', '单据状态'],
      ['FBillNo', 'text', '单据编号'],
    ]);
    expect(merged.fields[0]?.lookupFormId).toBe('BD_Supplier');
    expect(merged.fields[2]?.options).toEqual([
      { value: 'C', label: '已审核' },
      { value: 'A', label: '创建' },
    ]);
  });

  it('searches lookup numbers and names without extra filters', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [['VEN001', '甲供应商']],
    });
    await expect(searchLookup('BD_Supplier', "O'Hara", query)).resolves.toEqual(
      [{ number: 'VEN001', name: '甲供应商' }],
    );
    expect(query).toHaveBeenCalledWith({
      formId: 'BD_Supplier',
      fieldKeys: 'FNumber,FName',
      filterString: "(FNumber like '%O''Hara%' OR FName like '%O''Hara%')",
      topCount: 20,
    });
    await expect(searchLookup('BD_Supplier', '  ', query)).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns no fields for an unrecognized payload', () => {
    expect(parseCatalog('X', { unexpected: true }).fields).toEqual([]);
  });
});

describe('analysis storage', () => {
  function memoryRecord(): PersistedRecord {
    const values = new Map<string, string>();
    return {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => {
        values.set(key, value);
      },
      remove: (key) => {
        values.delete(key);
      },
    };
  }

  it('round-trips datasets and dashboards', () => {
    const record = memoryRecord();
    saveAnalysisState(
      {
        datasets: [dataset()],
        dashboards: [
          {
            id: 'board-1',
            name: '销售看板',
            filters: [],
            widgets: [],
          },
        ],
      },
      record,
    );
    expect(loadAnalysisState(record)).toMatchObject({
      datasets: [{ id: 'ds-1', name: '销售按客户' }],
      dashboards: [{ id: 'board-1', name: '销售看板' }],
    });
  });

  it('fills in fields missing from older saved definitions', () => {
    const record = memoryRecord();
    record.set(
      'datasets',
      JSON.stringify([
        { ...dataset(), grain: undefined, columns: undefined },
        { ...dataset(), id: 'ds-month', grain: 'month' },
      ]),
    );
    record.set(
      'dashboards',
      JSON.stringify([{ id: 'board-1', name: '销售看板', widgets: [] }]),
    );
    const loaded = loadAnalysisState(record);
    expect(loaded.datasets[0]).toMatchObject({
      seriesCases: [],
      columns: [],
      chartType: 'bar',
    });
    expect(loaded.datasets[0]).not.toHaveProperty('grain');
    expect(loaded.datasets[1]).not.toHaveProperty('grain');
    expect(loaded.dashboards[0]?.filters).toEqual([]);
  });

  it('returns an empty state when nothing is stored', () => {
    expect(loadAnalysisState(memoryRecord())).toEqual({
      datasets: [],
      dashboards: [],
    });
  });

  it('ignores malformed stored values', () => {
    const record = memoryRecord();
    record.set('datasets', '{not json');
    record.set('dashboards', '"a string"');
    expect(loadAnalysisState(record)).toEqual({ datasets: [], dashboards: [] });
  });

  it('remembers the chosen theme and falls back when it is unknown', () => {
    const record = memoryRecord();
    expect(loadAnalysisSettings(record).themeId).toBe('default');
    saveAnalysisSettings({ themeId: 'dark' }, record);
    expect(loadAnalysisSettings(record).themeId).toBe('dark');
    record.set('theme', 'no-such-theme');
    expect(loadAnalysisSettings(record).themeId).toBe('default');
    expect(findTheme('no-such-theme').id).toBe('default');
  });
});

describe('form options', () => {
  it('labels a form as chinese name plus identifier', () => {
    expect(formLabel(FORM_OPTIONS[0])).toBe('销售订单（SAL_SaleOrder）');
  });

  it('filters by chinese name or identifier', () => {
    expect(
      filterFormOptions(FORM_OPTIONS, '出库').map((option) => option.id),
    ).toEqual(['SAL_OUTSTOCK', 'STK_MisDelivery']);
    expect(
      filterFormOptions(FORM_OPTIONS, 'pur_req').map((option) => option.id),
    ).toEqual(['PUR_Requisition']);
  });

  it('returns every option for a blank query', () => {
    expect(filterFormOptions(FORM_OPTIONS, '  ')).toHaveLength(
      FORM_OPTIONS.length,
    );
  });
});

describe('chart spec', () => {
  const rows: AggregatedRow[] = [
    { dimension: '甲供应商', value: 3, series: { 螺栓: 2, 螺母: 1 } },
    { dimension: '乙供应商', value: 1, series: { 螺栓: 1 } },
  ];

  it('flattens grouped rows into one datum per series', () => {
    expect(chartData(rows, true)).toEqual([
      { dimension: '甲供应商', series: '螺栓', value: 2 },
      { dimension: '甲供应商', series: '螺母', value: 1 },
      { dimension: '乙供应商', series: '螺栓', value: 1 },
    ]);
  });

  it('keeps one datum per row when there is no series split', () => {
    expect(
      chartData(
        [{ dimension: '甲公司', value: 150, series: { '': 150 } }],
        false,
      ),
    ).toEqual([{ dimension: '甲公司', series: '', value: 150 }]);
  });

  it('groups split bars and adds a zoom slider', () => {
    expect(
      chartSpec('bar', chartData(rows, true), true, 'FMaterialId'),
    ).toMatchObject({
      type: 'interval',
      transform: [{ type: 'dodgeX' }],
      encode: { x: 'dimension', y: 'value', color: 'series' },
      slider: {
        x: {
          labelFormatter: expect.any(Function),
          style: { showLabel: false, showLabelOnInteraction: true },
        },
      },
    });
  });

  it('draws a line of the totals in one color', () => {
    expect(
      chartSpec(
        'line',
        chartData(rows, false),
        false,
        '计数',
        false,
        undefined,
        undefined,
        'line-1',
      ),
    ).toMatchObject({
      type: 'line',
      transform: [],
      encode: { x: 'dimension', y: 'value', color: undefined },
      legend: false,
      style: {
        lineWidth: 2,
        fill: expect.any(String),
        stroke: expect.any(String),
      },
    });
  });

  it('paints an unsplit bar with one stable palette color and no legend', () => {
    const palette = {
      colors: ['#111111', '#222222', '#333333', '#444444'],
      text: '#000',
      muted: '#111',
      grid: '#222',
    };
    const specFor = (seed: string) =>
      chartSpec(
        'bar',
        chartData(
          [{ dimension: '甲公司', value: 150, series: { '': 150 } }],
          false,
        ),
        false,
        '采购数量',
        false,
        palette,
        undefined,
        seed,
      );
    const first = specFor('supplier-qty');
    expect(first).toMatchObject({
      type: 'interval',
      transform: [],
      encode: { x: 'dimension', y: 'value', color: undefined },
      legend: false,
    });
    const fill = (first.style as { fill?: string } | undefined)?.fill;
    expect(palette.colors).toContain(fill);
    expect(specFor('supplier-qty')).toMatchObject({
      style: { fill, stroke: fill },
    });
    const fills = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(
      (seed) => (specFor(seed).style as { fill?: string }).fill,
    );
    expect(new Set(fills).size).toBeGreaterThan(1);
  });

  it('draws a pie on a theta coordinate', () => {
    expect(
      chartSpec('pie', chartData(rows, false), false, '计数'),
    ).toMatchObject({
      type: 'interval',
      coordinate: { type: 'theta' },
      transform: [{ type: 'stackY' }],
      slider: false,
    });
  });
});

describe('query execution', () => {
  it('does not require a row cap for a detail table', () => {
    expect(
      validateDataset(
        dataset({
          columns: [{ field: 'FBillNo', display: 'value' }],
          limit: 0,
        }),
        'detail',
      ).valid,
    ).toBe(true);
  });

  it('pages a detail table from the server instead of slicing a local cap', async () => {
    const seen: unknown[] = [];
    const rows = Array.from({ length: 50 }, (_, index) => [`PO${index}`]);
    const result = await queryChart(
      dataset({
        limit: 20,
        dimension: { field: '', display: 'name' },
        measure: { field: '', display: 'value' },
        aggregation: 'count',
        columns: [{ field: 'FBillNo', display: 'value' }],
      }),
      async (params) => {
        seen.push(params);
        return { rows, truncated: true };
      },
      new Date(),
      1,
    );
    expect(seen).toEqual([
      {
        formId: 'SAL_SaleOrder',
        fieldKeys: 'FBillNo',
        filterString: '',
        topCount: 0,
        startRow: 50,
        limit: 50,
        orderString: 'FBillNo ASC',
      },
    ]);
    expect(result.detail).toHaveLength(50);
    expect(result.queryTruncated).toBe(true);
  });

  it('compiles the query and reports truncation', async () => {
    const seen: unknown[] = [];
    const result = await queryChart(
      dataset({
        limit: 5,
        filters: [{ field: 'FDocumentStatus', operator: 'eq', value: 'C' }],
      }),
      async (params) => {
        seen.push(params);
        return {
          rows: [
            ['甲公司', 10, 'C'],
            ['乙公司', 4, 'C'],
          ],
          truncated: true,
        };
      },
    );
    expect(seen).toEqual([
      {
        formId: 'SAL_SaleOrder',
        fieldKeys: 'FCustId.FName,FBillAmount,FDocumentStatus',
        filterString: "FDocumentStatus = 'C'",
        topCount: 2000,
      },
    ]);
    expect(result.rows[0]).toEqual({
      dimension: '甲公司',
      value: 10,
      series: { '': 10 },
    });
    expect(result.fetched).toBe(2);
    expect(result.queryTruncated).toBe(true);
  });

  it('queries each source and lines the totals up by dimension', async () => {
    const seen: string[] = [];
    const result = await queryMerged(
      [
        {
          dataset: dataset({ formId: 'PUR_PurchaseOrder' }),
          legend: '采购订单',
        },
        { dataset: dataset({ formId: 'STK_InStock' }), legend: '采购入库单' },
      ],
      async (params) => {
        seen.push(params.formId);
        return {
          rows:
            params.formId === 'PUR_PurchaseOrder'
              ? [['2026-08', 100]]
              : [
                  ['2026-08', 40],
                  ['2026-09', 7],
                ],
          truncated: false,
        };
      },
    );
    expect(seen).toEqual(['PUR_PurchaseOrder', 'STK_InStock']);
    expect(result.rows).toEqual([
      {
        dimension: '2026-08',
        value: 140,
        series: { 采购订单: 100, 采购入库单: 40 },
      },
      { dimension: '2026-09', value: 7, series: { 采购入库单: 7 } },
    ]);
  });
});

describe('catalog cache', () => {
  function memoryRecord(): PersistedRecord {
    const values = new Map<string, string>();
    return {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => {
        values.set(key, value);
      },
      remove: (key) => {
        values.delete(key);
      },
    };
  }

  const scope: CatalogScope = {
    serverUrl: 'http://47.99.149.34/k3cloud/',
    acctName: '测试账套',
  };

  const stored: FieldCatalog = {
    formId: 'PUR_PurchaseOrder',
    formName: '采购订单',
    fields: [
      {
        key: 'FSupplierId',
        name: '供应商',
        entity: 'FBillHead',
        kind: 'lookup',
        lookupFormId: 'BD_Supplier',
        options: [],
      },
      {
        key: 'FQty',
        name: '采购数量',
        entity: 'FPOOrderEntry',
        kind: 'number',
        lookupFormId: null,
        options: [],
      },
    ],
  };

  const metadataPayload = {
    Result: {
      NeedReturnData: {
        Name: [{ Key: 2052, Value: '采购订单' }],
        Entrys: [
          {
            Key: 'FBillHead',
            Fields: [
              {
                Key: 'FQty',
                Name: [{ Key: 2052, Value: '采购数量' }],
                FieldType: 56,
              },
            ],
          },
        ],
      },
    },
  };

  it('keeps catalogs for each server, account and form', () => {
    const record = memoryRecord();
    writeCatalogCache(scope, 'PUR_PurchaseOrder', stored, record);
    expect(readCatalogCache(scope, 'PUR_PurchaseOrder', record)).toEqual(
      stored,
    );
    expect(
      readCatalogCache(
        { ...scope, serverUrl: 'http://47.99.149.34/k3cloud' },
        'PUR_PurchaseOrder',
        record,
      ),
    ).toEqual(stored);
    expect(
      readCatalogCache(
        { ...scope, acctName: '另一账套' },
        'PUR_PurchaseOrder',
        record,
      ),
    ).toBeNull();
    expect(readCatalogCache(scope, 'SAL_SaleOrder', record)).toBeNull();
    expect(
      writeCatalogCache(
        { serverUrl: '', acctName: scope.acctName },
        'PUR_PurchaseOrder',
        stored,
        record,
      ),
    ).toBeUndefined();
    expect(
      catalogCacheKey({ serverUrl: ' ', acctName: '账套' }, 'X'),
    ).toBeNull();
  });

  it('ignores a catalog that cannot be read back', () => {
    const record = memoryRecord();
    const key = catalogCacheKey(scope, 'PUR_PurchaseOrder');
    record.set(key!, '{');
    expect(readCatalogCache(scope, 'PUR_PurchaseOrder', record)).toBeNull();
    record.set(
      key!,
      JSON.stringify({ formId: 'PUR_PurchaseOrder', fields: [] }),
    );
    expect(readCatalogCache(scope, 'PUR_PurchaseOrder', record)).toBeNull();
  });

  it('shows the saved catalog and replaces it when refresh succeeds', async () => {
    const record = memoryRecord();
    writeCatalogCache(scope, 'PUR_PurchaseOrder', stored, record);
    let release: (value: unknown) => void = () => undefined;
    const pending = beginCatalogLoad(scope, 'PUR_PurchaseOrder', {
      record,
      metadata: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    expect(pending.cached).toEqual(stored);
    release(metadataPayload);
    const fresh = await pending.fresh;
    expect(fresh.fields.map((field) => field.key)).toEqual(['FQty']);
    expect(
      readCatalogCache(scope, 'PUR_PurchaseOrder', record)?.fields.map(
        (field) => field.key,
      ),
    ).toEqual(['FQty']);
  });

  it('keeps the saved catalog when refresh fails', async () => {
    const record = memoryRecord();
    writeCatalogCache(scope, 'PUR_PurchaseOrder', stored, record);
    const pending = beginCatalogLoad(scope, 'PUR_PurchaseOrder', {
      record,
      metadata: () => Promise.reject(new Error('offline')),
    });
    expect(pending.cached).toEqual(stored);
    await expect(pending.fresh).rejects.toThrow('offline');
    expect(readCatalogCache(scope, 'PUR_PurchaseOrder', record)).toEqual(
      stored,
    );
  });

  it('does not report a cache hit when the read is forced', async () => {
    const record = memoryRecord();
    writeCatalogCache(scope, 'PUR_PurchaseOrder', stored, record);
    const pending = beginCatalogLoad(scope, 'PUR_PurchaseOrder', {
      force: true,
      record,
      metadata: async () => metadataPayload,
    });
    expect(pending.cached).toBeNull();
    await pending.fresh;
    expect(
      readCatalogCache(scope, 'PUR_PurchaseOrder', record)?.fields.map(
        (field) => field.key,
      ),
    ).toEqual(['FQty']);
  });
});

describe('board templates', () => {
  const template = BOARD_TEMPLATES.find(
    (item) => item.id === 'purchase-inbound',
  );

  it('builds the purchase inbound board with its datasets', () => {
    expect(template).toBeDefined();
    const board = instantiateTemplate(template!);
    expect(board.datasets).toHaveLength(14);
    expect(board.dashboard.name).toBe('采购入库看板');
    expect(board.dashboard.widgets).toHaveLength(14);
    expect(board.dashboard.filters).toEqual([]);

    const overdue = board.datasets.find((item) => item.name === '逾期订单数');
    expect(overdue?.filters).toContainEqual({
      field: 'FDocumentStatus',
      operator: 'eq',
      value: 'C',
    });
    expect(overdue?.filters).toContainEqual({
      field: 'FDeliveryDate',
      operator: 'lt',
      value: 'today',
      valueMode: 'relativeDate',
    });

    const detail = board.datasets.find(
      (item) => item.name === '今日应入库订单明细',
    );
    expect(detail?.columns).toContainEqual({
      field: 'FSupplierId',
      display: 'name',
    });
    expect(detail?.columns).toContainEqual({
      field: 'FBillNo',
      display: 'value',
    });

    const orderAmount = board.datasets.find(
      (item) => item.name === '采购金额·订单',
    );
    const widget = board.dashboard.widgets.find(
      (item) => item.datasetId === orderAmount?.id,
    );
    expect(widget?.sources).toEqual([
      board.datasets.find((item) => item.name === '采购金额·入库')?.id,
      board.datasets.find((item) => item.name === '采购金额·退料')?.id,
    ]);
    expect(widget?.chartType).toBe('bar-stacked');

    const ids = new Set([
      ...board.datasets.map((item) => item.id),
      ...board.dashboard.widgets.map((item) => item.id),
      board.dashboard.id,
    ]);
    expect(ids.size).toBe(
      board.datasets.length + board.dashboard.widgets.length + 1,
    );

    const positions = board.dashboard.widgets.map(
      (item) => `${item.layout.x},${item.layout.y}`,
    );
    expect(new Set(positions).size).toBe(positions.length);
    const placed = board.dashboard.widgets.map((item) => item.layout);
    for (const item of placed) {
      const covered = placed.filter(
        (other) =>
          item.x < other.x + other.w &&
          other.x < item.x + item.w &&
          item.y < other.y + other.h &&
          other.y < item.y + item.h,
      );
      expect(covered).toHaveLength(1);
    }
  });

  it('reuses the same datasets and makes a new board each time', () => {
    const first = instantiateTemplate(template!);
    const second = instantiateTemplate(template!);
    expect(first.datasets.map((item) => item.id)).toEqual(
      second.datasets.map((item) => item.id),
    );
    expect(
      first.datasets.every((item) => item.origin?.templateId === template!.id),
    ).toBe(true);
    expect(first.dashboard.id).not.toBe(second.dashboard.id);
    expect(first.dashboard.widgets.map((item) => item.id)).not.toEqual(
      second.dashboard.widgets.map((item) => item.id),
    );

    useAnalysisStore.setState({
      datasets: [],
      dashboards: [],
      themeId: 'default',
    });
    useAnalysisStore.getState().applyTemplate(first);
    useAnalysisStore.getState().applyTemplate(second);
    const state = useAnalysisStore.getState();
    expect(state.datasets).toHaveLength(first.datasets.length);
    expect(state.dashboards).toHaveLength(2);
    const shared = new Set(state.datasets.map((item) => item.id));
    for (const board of state.dashboards) {
      for (const widget of board.widgets) {
        expect(shared.has(widget.datasetId)).toBe(true);
      }
    }
  });
});

function widget(id: string, x: number, y: number, w = 6, h = 8): Widget {
  return {
    id,
    title: id,
    datasetId: 'ds',
    chartType: 'bar',
    sources: [],
    layout: { x, y, w, h },
  };
}

describe('overlapping widgets', () => {
  it('merges widgets that cover each other into one group', () => {
    const groups = groupOverlaps([
      widget('甲', 0, 0, 6, 8),
      widget('乙', 1, 1, 6, 8),
      widget('丙', 6, 10),
    ]);
    expect(groups).toHaveLength(2);
    const stacked = groups.find((group) => group.members.length > 1);
    expect(stacked?.anchor.id).toBe('甲');
    expect(stacked?.members.map((member) => member.id).sort()).toEqual([
      '乙',
      '甲',
    ]);
  });

  it('keeps widgets apart when they only share an edge', () => {
    const groups = groupOverlaps([widget('甲', 0, 0), widget('乙', 6, 0)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.members.length === 1)).toBe(true);
  });

  it('merges only when one card is dropped onto the other', () => {
    const grazing = groupOverlaps([
      widget('甲', 0, 0, 6, 8),
      widget('乙', 5, 0, 6, 8),
    ]);
    expect(grazing).toHaveLength(2);

    const covered = groupOverlaps([
      widget('甲', 0, 0, 6, 8),
      widget('乙', 2, 2, 6, 8),
    ]);
    expect(covered).toHaveLength(1);

    const beside = groupOverlaps([
      widget('甲', 0, 0, 6, 8),
      widget('乙', 5, 0, 6, 8),
    ]);
    expect(beside).toHaveLength(2);
  });

  it('chains overlap through a third widget', () => {
    const groups = groupOverlaps([
      widget('甲', 0, 0, 6, 6),
      widget('乙', 4, 4, 6, 6),
      widget('丙', 2, 2, 6, 6),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
  });
});
