export type ChartType =
  | 'bar'
  | 'bar-horizontal'
  | 'bar-stacked'
  | 'line'
  | 'area'
  | 'area-stacked'
  | 'point'
  | 'pie'
  | 'donut'
  | 'rose'
  | 'radar'
  | 'radial'
  | 'cell'
  | 'heatmap'
  | 'histogram'
  | 'boxplot'
  | 'gauge'
  | 'liquid'
  | 'kpi';

export type FilterOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt';

export type RelativeDate =
  'today' | 'thisMonth' | 'last6Months' | 'last365Days';

export type FilterValueMode = 'literal' | 'field' | 'relativeDate';

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: string;
  valueMode?: FilterValueMode;
}

export type FieldDisplay = 'value' | 'name' | 'number';

export interface FieldRef {
  field: string;
  display: FieldDisplay;
}

export type TimeGrain = 'month';

export interface SeriesCase {
  label: string;
  field: string;
  operator: FilterOperator;
  value: string;
  valueMode?: FilterValueMode;
}

export interface DatasetOrigin {
  templateId: string;
}

export interface Dataset {
  id: string;
  name: string;
  formId: string;
  dimension: FieldRef;
  grain: TimeGrain | null;
  series: FieldRef | null;
  seriesCases: SeriesCase[];
  measure: FieldRef;
  aggregation: 'sum' | 'count';
  columns: FieldRef[];
  filters: Filter[];
  limit: number;
  chartType: ChartType;
  origin?: DatasetOrigin;
}

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Widget {
  id: string;
  title: string;
  datasetId: string;
  chartType: ChartType;
  sources: string[];
  layout: WidgetLayout;
}

export interface Dashboard {
  id: string;
  name: string;
  filters: Filter[];
  widgets: Widget[];
}

export interface AnalysisState {
  datasets: Dataset[];
  dashboards: Dashboard[];
}
