import { aggregate, validateDataset } from '@/features/analysis/model';
import {
  compatibleChartTypes,
  fieldLabels,
  presentDataset,
} from '@/features/analysis/presentation';
import type { Dataset } from '@/features/analysis/types';

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: '销售按客户',
    formId: 'SAL_SaleOrder',
    dimension: { field: 'FCustId', display: 'name' },
    series: { field: 'FSalerId', display: 'name' },
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

describe('dataset presentation', () => {
  it('keeps category fields and drops detail columns for a chart', () => {
    const presented = presentDataset(
      dataset({
        columns: [{ field: 'FBillNo', display: 'value' }],
      }),
      'chart',
    );
    expect(presented.columns).toEqual([]);
    expect(presented.dimension.field).toBe('FCustId');
    expect(presented.series?.field).toBe('FSalerId');
    expect(presented.measure.field).toBe('FBillAmount');
  });

  it('drops the series when the chart color is the category itself', () => {
    const presented = presentDataset(dataset({ chartType: 'pie' }), 'chart');
    expect(presented.series).toBeNull();
    expect(presented.dimension.field).toBe('FCustId');
    expect(presented.measure.field).toBe('FBillAmount');
  });

  it('keeps only the total for a single-value chart', () => {
    const presented = presentDataset(
      dataset({ chartType: 'kpi', aggregation: 'count' }),
      'chart',
    );
    expect(presented.dimension.field).toBe('');
    expect(presented.series).toBeNull();
    expect(presented.measure.field).toBe('');
    expect(presented.limit).toBe(20);
  });

  it('keeps detail columns and ignores chart fields', () => {
    const presented = presentDataset(
      dataset({
        columns: [{ field: 'FBillNo', display: 'value' }],
      }),
      'detail',
    );
    expect(presented.columns).toEqual([{ field: 'FBillNo', display: 'value' }]);
    expect(presented.dimension.field).toBe('');
    expect(presented.series).toBeNull();
    expect(validateDataset(presented, 'detail').valid).toBe(true);
  });

  it('requires a series for a matrix and a column for a detail table', () => {
    expect(
      validateDataset(
        presentDataset(
          dataset({ chartType: 'heatmap', series: null }),
          'chart',
        ),
        'chart',
      ).message,
    ).toBe('请填写Y 轴');
    expect(validateDataset(dataset({ columns: [] }), 'detail').message).toBe(
      '请添加明细列',
    );
  });

  it('names axes for the chart the user picked', () => {
    expect(fieldLabels('bar')).toEqual({
      dimension: 'X 轴',
      measure: 'Y 轴',
      series: '图例',
      aggregation: '统计方式',
    });
    expect(fieldLabels('bar-horizontal')).toMatchObject({
      dimension: 'Y 轴',
      measure: 'X 轴',
    });
    expect(fieldLabels('bar-horizontal')).not.toHaveProperty('grain');
    expect(fieldLabels('pie')).toMatchObject({
      dimension: '分类',
      measure: '数值',
    });
    expect(fieldLabels('pie')).not.toHaveProperty('grain');
    expect(fieldLabels('heatmap')).toMatchObject({
      dimension: 'X 轴',
      series: 'Y 轴',
      measure: '颜色',
    });
    expect(fieldLabels('histogram').dimension).toBe('分布字段');
    expect(fieldLabels('kpi')).toMatchObject({
      aggregation: '统计方式',
      measure: '指标',
    });
  });

  it('limits a dashboard chart switch to the same shape', () => {
    expect(compatibleChartTypes('pie').map((item) => item.value)).toEqual([
      'pie',
      'donut',
      'rose',
      'radial',
    ]);
    expect(compatibleChartTypes('pie').map((item) => item.value)).not.toContain(
      'bar',
    );
  });

  it('totals every row when a single-value chart has no dimension', () => {
    const result = aggregate(
      [[3], [4], [5]],
      presentDataset(
        dataset({
          chartType: 'kpi',
          dimension: { field: '', display: 'name' },
          series: null,
          aggregation: 'sum',
          limit: 1,
        }),
        'chart',
      ),
    );
    expect(result.rows).toEqual([
      { dimension: '合计', value: 12, series: { '': 12 } },
    ]);
  });
});
