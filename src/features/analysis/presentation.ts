import { CHART_TYPES } from '@/features/analysis/chartSpec';
import type { ChartType, Dataset, FieldRef } from '@/features/analysis/types';

export type Presentation = 'chart' | 'detail';

export type ChartShape =
  'category' | 'share' | 'matrix' | 'distribution' | 'single';

const SHAPE_OF: Record<ChartType, ChartShape> = {
  bar: 'category',
  'bar-horizontal': 'category',
  'bar-stacked': 'category',
  line: 'category',
  area: 'category',
  'area-stacked': 'category',
  point: 'category',
  radar: 'category',
  boxplot: 'category',
  pie: 'share',
  donut: 'share',
  rose: 'share',
  radial: 'share',
  heatmap: 'matrix',
  cell: 'matrix',
  histogram: 'distribution',
  kpi: 'single',
  gauge: 'single',
  liquid: 'single',
};

const SHAPE_ORDER: ChartShape[] = [
  'category',
  'share',
  'matrix',
  'distribution',
  'single',
];

export const SHAPE_HINTS: Record<ChartShape, string> = {
  category: '比较各类的数值，可用另一个字段拆成多个系列',
  share: '看各类占整体的比例',
  matrix: '用两个分类交叉看数值',
  distribution: '看一个字段的分布',
  single: '只显示一个合计数字',
};

const BLANK_FIELD: FieldRef = { field: '', display: 'name' };

export interface FieldNeeds {
  dimension: boolean;
  series: boolean;
  seriesRequired: boolean;
  seriesCases: boolean;
  aggregation: boolean;
  measure: boolean;
  columns: boolean;
}

export function chartShape(chartType: ChartType): ChartShape {
  return SHAPE_OF[chartType];
}

export function presentationOf(dataset: Dataset): Presentation {
  return dataset.columns.length > 0 ? 'detail' : 'chart';
}

export function orderedChartTypes(): { value: ChartType; label: string }[] {
  return SHAPE_ORDER.flatMap((shape) =>
    CHART_TYPES.filter((item) => chartShape(item.value) === shape),
  );
}

export function compatibleChartTypes(
  chartType: ChartType,
): { value: ChartType; label: string }[] {
  const shape = chartShape(chartType);
  return CHART_TYPES.filter((item) => chartShape(item.value) === shape);
}

export interface FieldLabels {
  dimension: string;
  measure: string;
  series: string;
  aggregation: string;
}

export function measureNotNumericMessage(chartType: ChartType): string {
  const labels = fieldLabels(chartType);
  return `${labels.measure}不是数值。要按两个文本字段交叉统计，请把第二个字段填到「${labels.series}」，${labels.measure}留空并把统计方式改为计数；要求和、请把${labels.measure}换成数量或金额字段`;
}

export function fieldLabels(chartType: ChartType): FieldLabels {
  switch (chartType) {
    case 'bar-horizontal':
      return {
        dimension: 'Y 轴',
        measure: 'X 轴',
        series: '图例',
        aggregation: '统计方式',
      };
    case 'pie':
    case 'donut':
    case 'rose':
    case 'radial':
    case 'radar':
      return {
        dimension: '分类',
        measure: '数值',
        series: '图例',
        aggregation: '统计方式',
      };
    case 'heatmap':
    case 'cell':
      return {
        dimension: 'X 轴',
        measure: '颜色',
        series: 'Y 轴',
        aggregation: '统计方式',
      };
    case 'histogram':
      return {
        dimension: '分布字段',
        measure: '数值',
        series: '图例',
        aggregation: '统计方式',
      };
    case 'kpi':
    case 'gauge':
    case 'liquid':
      return {
        dimension: '分类',
        measure: '指标',
        series: '图例',
        aggregation: '统计方式',
      };
    default:
      return {
        dimension: 'X 轴',
        measure: 'Y 轴',
        series: '图例',
        aggregation: '统计方式',
      };
  }
}

export function fieldNeeds(
  mode: Presentation,
  chartType: ChartType,
): FieldNeeds {
  if (mode === 'detail') {
    return {
      dimension: false,
      series: false,
      seriesRequired: false,
      seriesCases: false,
      aggregation: false,
      measure: false,
      columns: true,
    };
  }
  const shape = chartShape(chartType);
  const category = shape === 'category';
  return {
    dimension: shape !== 'single',
    series: category || shape === 'matrix',
    seriesRequired: shape === 'matrix',
    seriesCases: category,
    aggregation: shape !== 'distribution',
    measure: shape !== 'distribution',
    columns: false,
  };
}

export function presentDataset(
  dataset: Dataset,
  mode: Presentation = presentationOf(dataset),
): Dataset {
  if (mode === 'detail') {
    return {
      ...dataset,
      dimension: BLANK_FIELD,
      series: null,
      seriesCases: [],
      measure: { field: '', display: 'value' },
      aggregation: 'count',
    };
  }
  const needs = fieldNeeds('chart', dataset.chartType);
  const series =
    needs.series && dataset.series?.field.trim() ? dataset.series : null;
  return {
    ...dataset,
    dimension: needs.dimension ? dataset.dimension : BLANK_FIELD,
    series,
    seriesCases: needs.seriesCases ? dataset.seriesCases : [],
    measure:
      needs.measure && dataset.aggregation === 'sum'
        ? dataset.measure
        : { field: '', display: 'value' },
    aggregation: needs.aggregation ? dataset.aggregation : 'count',
    columns: [],
  };
}
