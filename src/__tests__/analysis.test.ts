import {
  aggregate,
  chartTitle,
  compileFilters,
  fieldKeys,
  queryKey,
  validateDataset,
} from '@/features/analysis/model';
import type { AggregatedRow } from '@/features/analysis/model';
import { chartData, chartSpec } from '@/features/analysis/chartSpec';
import { parseCatalog } from '@/features/analysis/catalog';
import { queryChart } from '@/features/analysis/query';
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

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: '销售按客户',
    formId: 'SAL_SaleOrder',
    dimension: { field: 'FCustId', display: 'name' },
    series: null,
    measure: { field: 'FBillAmount', display: 'value' },
    aggregation: 'sum',
    filters: [],
    limit: 20,
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

  it('builds a chart title from the fields', () => {
    expect(chartTitle(dataset(), 'pie')).toBe('FBillAmount 按 FCustId（饼图）');
    expect(chartTitle(dataset({ aggregation: 'count' }), 'kpi')).toBe(
      '计数 按 FCustId（指标卡）',
    );
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
    });
    expect(catalog.fields[2]).toMatchObject({
      name: '物料',
      entity: 'FSaleOrderEntry',
      lookupFormId: null,
    });
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
});
