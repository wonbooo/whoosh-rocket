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

export type FilterOperator =
  'eq' | 'neq' | 'contains' | 'notContains' | 'gt' | 'lt';

export type RelativeDate = 'today' | 'thisMonth' | 'thisYear' | 'last6Months';

export type FilterValueMode = 'literal' | 'field' | 'relativeDate' | 'lookup';

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: string;
  valueMode?: FilterValueMode;
  /** 基础资料点选后的名称，编译「包含」「不包含」和回显时使用。 */
  valueLabel?: string;
}

export type FieldDisplay = 'value' | 'name' | 'number';

export interface FieldRef {
  field: string;
  display: FieldDisplay;
  /** 明细列勾选后，表格底部显示该列合计。 */
  sum?: boolean;
  /** 日期字段按年月汇总，而不是按每一天。 */
  groupByMonth?: boolean;
}

export interface SeriesCase {
  label: string;
  field: string;
  operator: FilterOperator;
  value: string;
  valueMode?: FilterValueMode;
  valueLabel?: string;
}

export interface DatasetOrigin {
  templateId: string;
}

export interface Dataset {
  id: string;
  name: string;
  formId: string;
  dimension: FieldRef;
  series: FieldRef | null;
  seriesCases: SeriesCase[];
  measure: FieldRef;
  aggregation: 'sum' | 'count';
  columns: FieldRef[];
  filters: Filter[];
  limit: number;
  chartType: ChartType;
  origin?: DatasetOrigin;
  /** 数据集只属于这一块看板。 */
  dashboardId?: string;
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

export interface SavedBoardTemplate {
  id: string;
  name: string;
  datasets: Dataset[];
  filters: Filter[];
  widgets: Widget[];
}

export interface AnalysisState {
  datasets: Dataset[];
  dashboards: Dashboard[];
  savedTemplates: SavedBoardTemplate[];
}
