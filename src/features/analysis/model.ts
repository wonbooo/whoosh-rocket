import type {
  ChartType,
  Dataset,
  FieldRef,
  Filter,
  FilterOperator,
} from '@/features/analysis/types';

export interface ValidationResult {
  valid: boolean;
  message: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export function isIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

function checkIdentifier(
  value: string,
  label: string,
): ValidationResult | null {
  if (!value.trim()) {
    return { valid: false, message: `请填写${label}` };
  }
  if (!isIdentifier(value.trim())) {
    return {
      valid: false,
      message: `${label}只能包含字母、数字、下划线和点`,
    };
  }
  return null;
}

export function validateDataset(dataset: Dataset): ValidationResult {
  if (!dataset.name.trim()) {
    return { valid: false, message: '请填写数据集名称' };
  }
  for (const [value, label] of [
    [dataset.formId, '表单 ID'],
    [dataset.dimension.field, '维度字段'],
  ] as const) {
    const problem = checkIdentifier(value, label);
    if (problem) {
      return problem;
    }
  }
  if (dataset.series) {
    const problem = checkIdentifier(dataset.series.field, '拆分系列字段');
    if (problem) {
      return problem;
    }
  }
  if (dataset.aggregation === 'sum') {
    const problem = checkIdentifier(dataset.measure.field, '度量字段');
    if (problem) {
      return problem;
    }
  }
  if (
    dataset.aggregation === 'sum' &&
    !dataset.series &&
    dataset.dimension.field.trim() === dataset.measure.field.trim()
  ) {
    return { valid: false, message: '维度和度量不能是同一个字段' };
  }
  if (!Number.isInteger(dataset.limit) || dataset.limit < 1) {
    return { valid: false, message: '显示组数上限至少为 1' };
  }
  for (const filter of dataset.filters) {
    const problem = checkIdentifier(filter.field, '过滤字段');
    if (problem) {
      return problem;
    }
    if (!filter.value.trim()) {
      return { valid: false, message: '过滤条件的值不能为空' };
    }
    if (
      (filter.operator === 'gt' || filter.operator === 'lt') &&
      Number.isNaN(Number(filter.value.trim()))
    ) {
      return { valid: false, message: '大于、小于比较的值必须是数字' };
    }
  }
  return { valid: true, message: '' };
}

export function queryKey(ref: FieldRef): string {
  const field = ref.field.trim();
  if (ref.display === 'name') {
    return `${field}.FName`;
  }
  if (ref.display === 'number') {
    return `${field}.FNumber`;
  }
  return field;
}

export function fieldKeys(dataset: Dataset): string {
  const keys = [queryKey(dataset.dimension)];
  if (dataset.series) {
    keys.push(queryKey(dataset.series));
  }
  if (dataset.aggregation === 'sum') {
    keys.push(queryKey(dataset.measure));
  }
  for (const filter of dataset.filters) {
    const field = filter.field.trim();
    if (!keys.includes(field)) {
      keys.push(field);
    }
  }
  return keys.join(',');
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function compileFilter(filter: Filter): string {
  const field = filter.field.trim();
  const value = filter.value.trim();
  switch (filter.operator) {
    case 'eq':
      return `${field} = ${quote(value)}`;
    case 'neq':
      return `${field} <> ${quote(value)}`;
    case 'contains':
      return `${field} like ${quote(`%${value}%`)}`;
    case 'gt':
      return `${field} > ${Number(value)}`;
    case 'lt':
      return `${field} < ${Number(value)}`;
    default:
      return `${field} = ${quote(value)}`;
  }
}

export function compileFilters(filters: Filter[]): string {
  return filters.map(compileFilter).join(' AND ');
}

export interface AggregatedRow {
  dimension: string;
  value: number;
  series: Record<string, number>;
}

export interface AggregateResult {
  rows: AggregatedRow[];
  skipped: number;
  truncated: boolean;
}

export function cellText(cell: unknown): string {
  if (cell == null) {
    return '';
  }
  if (typeof cell === 'object') {
    const record = cell as Record<string, unknown>;
    const name = record.FName ?? record.Name ?? record.FNumber ?? record.Number;
    return name == null ? '' : String(name);
  }
  return String(cell);
}

export function cellNumber(cell: unknown): number | null {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? cell : null;
  }
  if (typeof cell === 'string') {
    const trimmed = cell.trim().replaceAll(',', '');
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const OPERATORS: Record<
  FilterOperator,
  (cell: string, expected: string) => boolean
> = {
  eq: (cell, expected) => cell === expected,
  neq: (cell, expected) => cell !== expected,
  contains: (cell, expected) => cell.includes(expected),
  gt: (cell, expected) => compareNumber(cell, expected, (a, b) => a > b),
  lt: (cell, expected) => compareNumber(cell, expected, (a, b) => a < b),
};

function compareNumber(
  cell: string,
  expected: string,
  compare: (left: number, right: number) => boolean,
): boolean {
  const left = cellNumber(cell);
  const right = Number(expected);
  return left != null && Number.isFinite(right) && compare(left, right);
}

function filterColumn(dataset: Dataset, filter: Filter): number {
  const keys = fieldKeys(dataset).split(',');
  return keys.indexOf(filter.field.trim());
}

export function aggregate(
  rawRows: unknown[],
  dataset: Dataset,
): AggregateResult {
  const grouped = new Map<string, Map<string, number>>();
  let skipped = 0;
  const seriesColumn = dataset.series ? 1 : -1;
  const measureColumn =
    dataset.aggregation === 'sum' ? (dataset.series ? 2 : 1) : -1;

  for (const raw of rawRows) {
    const cells = Array.isArray(raw) ? raw : null;
    if (!cells) {
      skipped += 1;
      continue;
    }
    const matched = dataset.filters.every((filter) => {
      const column = filterColumn(dataset, filter);
      return (
        column >= 0 &&
        OPERATORS[filter.operator](cellText(cells[column]), filter.value.trim())
      );
    });
    if (!matched) {
      continue;
    }
    const contribution =
      measureColumn < 0 ? 1 : cellNumber(cells[measureColumn]);
    if (contribution == null) {
      skipped += 1;
      continue;
    }
    const dimension = cellText(cells[0]) || '（空）';
    const seriesName =
      seriesColumn < 0 ? '' : cellText(cells[seriesColumn]) || '（空）';
    const bucket = grouped.get(dimension) ?? new Map<string, number>();
    bucket.set(seriesName, (bucket.get(seriesName) ?? 0) + contribution);
    grouped.set(dimension, bucket);
  }

  const rows = [...grouped.entries()]
    .map(([dimension, bucket]) => ({
      dimension,
      value: [...bucket.values()].reduce((sum, item) => sum + item, 0),
      series: Object.fromEntries(bucket),
    }))
    .sort((a, b) => b.value - a.value);
  const truncated = rows.length > dataset.limit;
  return { rows: rows.slice(0, dataset.limit), skipped, truncated };
}

const CHART_LABELS: Record<ChartType, string> = {
  bar: '柱状图',
  'bar-horizontal': '条形图',
  'bar-stacked': '堆叠柱状图',
  line: '折线图',
  area: '面积图',
  'area-stacked': '堆叠面积图',
  point: '散点图',
  pie: '饼图',
  donut: '环形图',
  rose: '玫瑰图',
  radar: '雷达图',
  radial: '玉珏图',
  cell: '色块图',
  heatmap: '热力图',
  histogram: '直方图',
  boxplot: '箱线图',
  gauge: '仪表盘',
  liquid: '水波图',
  kpi: '指标卡',
};

export function chartTitle(dataset: Dataset, chartType: ChartType): string {
  const subject = dataset.series
    ? `${dataset.dimension.field.trim()} × ${dataset.series.field.trim()}`
    : dataset.dimension.field.trim();
  const measure =
    dataset.aggregation === 'count' ? '计数' : dataset.measure.field.trim();
  return `${measure} 按 ${subject}（${CHART_LABELS[chartType]}）`;
}
