import type { G2Spec, Theme } from '@antv/g2';
import type { AggregatedRow } from '@/features/analysis/model';
import type { ChartType, Dataset } from '@/features/analysis/types';

const FALLBACK_COLORS = [
  '#1783FF',
  '#00C9C9',
  '#F0884D',
  '#D580FF',
  '#7863FF',
  '#60C42D',
  '#BD8F24',
  '#FF80CA',
  '#2491B3',
  '#17C76F',
];

const numberFormat = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
});

export const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: '柱状图' },
  { value: 'bar-horizontal', label: '条形图' },
  { value: 'bar-stacked', label: '堆叠柱状图' },
  { value: 'line', label: '折线图' },
  { value: 'area', label: '面积图' },
  { value: 'area-stacked', label: '堆叠面积图' },
  { value: 'point', label: '散点图' },
  { value: 'pie', label: '饼图' },
  { value: 'donut', label: '环形图' },
  { value: 'rose', label: '玫瑰图' },
  { value: 'radar', label: '雷达图' },
  { value: 'radial', label: '玉珏图' },
  { value: 'cell', label: '色块图' },
  { value: 'heatmap', label: '热力图' },
  { value: 'histogram', label: '直方图' },
  { value: 'boxplot', label: '箱线图' },
  { value: 'gauge', label: '仪表盘' },
  { value: 'liquid', label: '水波图' },
  { value: 'kpi', label: '指标卡' },
];

export interface ChartDatum {
  dimension: string;
  series: string;
  value: number;
}

export function chartData(rows: AggregatedRow[], split: boolean): ChartDatum[] {
  const data: ChartDatum[] = [];
  for (const row of rows) {
    if (split) {
      for (const [series, value] of Object.entries(row.series)) {
        if (series) {
          data.push({ dimension: row.dimension, series, value });
        }
      }
    } else {
      data.push({ dimension: row.dimension, series: '', value: row.value });
    }
  }
  return data;
}

interface ChartShape {
  type: string;
  coordinate?: Record<string, unknown>;
  transform: { type: string; y?: string }[];
  colorBy: 'none' | 'series' | 'dimension';
  slider: boolean;
  labels: boolean;
}

const SHAPES: Record<Exclude<ChartType, 'kpi'>, ChartShape> = {
  bar: {
    type: 'interval',
    transform: [{ type: 'dodgeX' }],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  'bar-horizontal': {
    type: 'interval',
    coordinate: { transform: [{ type: 'transpose' }] },
    transform: [{ type: 'dodgeX' }],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  'bar-stacked': {
    type: 'interval',
    transform: [{ type: 'stackY' }],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  line: {
    type: 'line',
    transform: [],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  area: {
    type: 'area',
    transform: [],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  'area-stacked': {
    type: 'area',
    transform: [{ type: 'stackY' }],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  point: {
    type: 'point',
    transform: [],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  pie: {
    type: 'interval',
    coordinate: { type: 'theta', outerRadius: 0.8 },
    transform: [{ type: 'stackY' }],
    colorBy: 'dimension',
    slider: false,
    labels: true,
  },
  donut: {
    type: 'interval',
    coordinate: { type: 'theta', innerRadius: 0.5, outerRadius: 0.8 },
    transform: [{ type: 'stackY' }],
    colorBy: 'dimension',
    slider: false,
    labels: true,
  },
  rose: {
    type: 'interval',
    coordinate: { type: 'polar' },
    transform: [],
    colorBy: 'dimension',
    slider: false,
    labels: false,
  },
  radar: {
    type: 'line',
    coordinate: { type: 'polar' },
    transform: [],
    colorBy: 'series',
    slider: false,
    labels: false,
  },
  radial: {
    type: 'interval',
    coordinate: { type: 'radial', innerRadius: 0.2, endAngle: Math.PI },
    transform: [],
    colorBy: 'dimension',
    slider: false,
    labels: false,
  },
  cell: {
    type: 'cell',
    transform: [],
    colorBy: 'series',
    slider: false,
    labels: false,
  },
  heatmap: {
    type: 'heatmap',
    transform: [],
    colorBy: 'series',
    slider: false,
    labels: false,
  },
  histogram: {
    type: 'rect',
    transform: [{ type: 'binX', y: 'count' }],
    colorBy: 'none',
    slider: false,
    labels: false,
  },
  boxplot: {
    type: 'boxplot',
    transform: [],
    colorBy: 'series',
    slider: true,
    labels: false,
  },
  gauge: {
    type: 'gauge',
    transform: [],
    colorBy: 'none',
    slider: false,
    labels: false,
  },
  liquid: {
    type: 'liquid',
    transform: [],
    colorBy: 'none',
    slider: false,
    labels: false,
  },
};

export interface ChartPalette {
  colors: string[];
  text: string;
  muted: string;
  grid: string;
  panel?: string;
  panelAlt?: string;
}

export function chartSpec(
  chartType: ChartType,
  data: ChartDatum[],
  split: boolean,
  legend: string,
  compact = false,
  palette?: ChartPalette,
  theme?: Theme,
): G2Spec {
  const shape = SHAPES[chartType === 'kpi' ? 'bar' : chartType];
  const colorBy =
    shape.colorBy === 'series' && !split ? 'dimension' : shape.colorBy;
  const grouped =
    shape.transform.some((item) => item.type === 'dodgeX') && split;
  const encode: Record<string, string | undefined> = {
    x: 'dimension',
    y: 'value',
    color: colorBy === 'none' ? undefined : colorBy,
  };
  const colors = palette?.colors ?? FALLBACK_COLORS;
  const labelColor = palette?.muted ?? '#71717a';
  const gridColor = palette?.grid ?? 'rgba(0, 0, 0, 0.08)';
  return {
    type: shape.type,
    theme,
    data,
    encode,
    transform: grouped
      ? shape.transform
      : shape.transform.filter((item) => item.type !== 'dodgeX'),
    coordinate: (shape.coordinate ?? { type: 'cartesian' }) as never,
    scale: { y: { nice: true }, color: { range: colors } },
    axis:
      shape.slider || chartType === 'cell' || chartType === 'heatmap'
        ? {
            x: {
              title: false,
              labelFill: labelColor,
              labelFontSize: compact ? 10 : 12,
              labelAutoRotate: false,
              labelAutoHide: true,
              labelAutoEllipsis: true,
              size: compact ? 24 : 48,
              grid: false,
            },
            y: {
              title: false,
              labelFill: labelColor,
              labelFontSize: compact ? 10 : 12,
              gridStroke: gridColor,
              gridStrokeOpacity: 1,
            },
          }
        : false,
    legend:
      colorBy === 'none' || compact
        ? false
        : {
            color: { position: 'bottom', layout: { justifyContent: 'center' } },
          },
    slider:
      shape.slider && !compact
        ? {
            x: {
              labelFormatter: (value: unknown) => String(value),
              style: { showLabel: false, showLabelOnInteraction: true },
            },
          }
        : false,
    style:
      chartType === 'line' || chartType === 'radar'
        ? { lineWidth: 2 }
        : undefined,
    labels: shape.labels
      ? [{ position: 'outside', text: (datum: ChartDatum) => datum.dimension }]
      : undefined,
    tooltip: {
      title: 'dimension',
      items: [
        {
          field: 'value',
          name: split ? undefined : legend,
          valueFormatter: (value) => numberFormat.format(Number(value)),
        },
      ],
    },
    interaction: shape.slider ? { sliderWheel: { minRange: 0.02 } } : undefined,
  } as G2Spec;
}

export function legendLabel(dataset: Dataset): string {
  return dataset.series ? dataset.series.field : dataset.measure.field;
}
