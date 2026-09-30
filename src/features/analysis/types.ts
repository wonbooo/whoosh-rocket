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

export type FieldDisplay = 'value' | 'name' | 'number';

export interface FieldRef {
  field: string;
  display: FieldDisplay;
}

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface Dataset {
  id: string;
  name: string;
  formId: string;
  dimension: FieldRef;
  series: FieldRef | null;
  measure: FieldRef;
  aggregation: 'sum' | 'count';
  filters: Filter[];
  limit: number;
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
  layout: WidgetLayout;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: Widget[];
}

export interface AnalysisState {
  datasets: Dataset[];
  dashboards: Dashboard[];
}
