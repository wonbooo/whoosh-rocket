import {
  aggregate,
  compileFilters,
  fieldKeys,
  queryKey,
  resolveRelativeDate,
  validateDataset,
} from '@/features/analysis/model';
import type { AggregatedRow } from '@/features/analysis/model';
import { chartData, chartSpec } from '@/features/analysis/chartSpec';
import { parseCatalog } from '@/features/analysis/catalog';
import { queryChart, queryMerged } from '@/features/analysis/merge';
import {
  loadAnalysisState,
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

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: '销售按客户',
    formId: 'SAL_SaleOrder',
    dimension: { field: 'FCustId', display: 'name' },
    grain: null,
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
});

describe('aggregation', () => {
  it('sums per dimension and keeps the top groups', () => {
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
    ]);
    expect(result.skipped).toBe(2);
    expect(result.truncated).toBe(true);
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

  it('buckets dates by month and sorts chronologically', () => {
    const result = aggregate(
      [
        ['2026-08-15', 5],
        ['2026-07-02', 3],
        ['2026-08-30', 7],
        ['2026-09-01', 1],
      ],
      dataset({
        dimension: { field: 'FDate', display: 'value' },
        grain: 'month',
        limit: 2,
      }),
    );
    expect(result.rows.map((row) => row.dimension)).toEqual([
      '2026-07',
      '2026-08',
    ]);
    expect(result.rows[1]?.value).toBe(12);
    expect(result.truncated).toBe(true);
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
  it('returns no fields for an unrecognized payload', () => {
    expect(parseCatalog('X', { unexpected: true }).fields).toEqual([]);
  });
});

describe('analysis storage', () => {
  function memoryRecord(): PersistedRecord {
    const values = new Map<string, string>();
    return {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => values.set(key, value),
      remove: (key) => values.delete(key),
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
      JSON.stringify([{ ...dataset(), grain: undefined, columns: undefined }]),
    );
    record.set(
      'dashboards',
      JSON.stringify([{ id: 'board-1', name: '销售看板', widgets: [] }]),
    );
    const loaded = loadAnalysisState(record);
    expect(loaded.datasets[0]).toMatchObject({
      grain: null,
      seriesCases: [],
      columns: [],
      chartType: 'bar',
    });
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
      slider: { x: {} },
    });
  });

  it('draws a line of the totals without grouping', () => {
    expect(
      chartSpec('line', chartData(rows, false), false, '计数'),
    ).toMatchObject({
      type: 'line',
      transform: [],
      encode: { color: undefined },
    });
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
  });

  it('produces a fresh copy on every instantiation', () => {
    const first = instantiateTemplate(template!);
    const second = instantiateTemplate(template!);
    expect(first.dashboard.id).not.toBe(second.dashboard.id);
    expect(first.datasets.map((item) => item.id)).not.toEqual(
      second.datasets.map((item) => item.id),
    );
  });
});
