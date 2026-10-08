import type {
  Dataset,
  FieldRef,
  Filter,
  FilterOperator,
  RelativeDate,
  TimeGrain,
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
  for (const item of dataset.seriesCases) {
    const problem = checkIdentifier(item.field, '条件拆分字段');
    if (problem) {
      return problem;
    }
    if (!item.label.trim()) {
      return { valid: false, message: '请填写条件拆分的系列名' };
    }
  }
  for (const column of dataset.columns) {
    const problem = checkIdentifier(column.field, '明细列字段');
    if (problem) {
      return problem;
    }
  }
  if (dataset.grain && !dataset.dimension.field.trim()) {
    return { valid: false, message: '按时间分组需要维度字段' };
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
    const mode = filter.valueMode ?? 'literal';
    if (mode === 'field') {
      const target = checkIdentifier(filter.value, '比较字段');
      if (target) {
        return target;
      }
      continue;
    }
    if (mode === 'relativeDate') {
      if (!RELATIVE_DATES.includes(filter.value as RelativeDate)) {
        return { valid: false, message: '请选择相对日期' };
      }
      continue;
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
  for (const item of dataset.seriesCases) {
    const field = item.field.trim();
    if (!keys.includes(field)) {
      keys.push(field);
    }
  }
  for (const column of dataset.columns) {
    const key = queryKey(column);
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }
  for (const filter of dataset.filters) {
    const field = filter.field.trim();
    if (!keys.includes(field)) {
      keys.push(field);
    }
    if (filter.valueMode === 'field') {
      const target = filter.value.trim();
      if (!keys.includes(target)) {
        keys.push(target);
      }
    }
  }
  return keys.join(',');
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export const RELATIVE_DATES: RelativeDate[] = [
  'today',
  'thisMonth',
  'last6Months',
  'last365Days',
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DateRange {
  start: string;
  end: string;
}

export function resolveRelativeDate(
  token: RelativeDate,
  today: Date,
): DateRange {
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  if (token === 'today') {
    return { start: formatDate(start), end: formatDate(start) };
  }
  if (token === 'thisMonth') {
    return {
      start: formatDate(new Date(start.getFullYear(), start.getMonth(), 1)),
      end: formatDate(new Date(start.getFullYear(), start.getMonth() + 1, 0)),
    };
  }
  const days = token === 'last6Months' ? 183 : 365;
  const from = new Date(start);
  from.setDate(from.getDate() - days);
  return { start: formatDate(from), end: formatDate(start) };
}

function dateClause(filter: Filter, today: Date): string {
  const field = filter.field.trim();
  const range = resolveRelativeDate(filter.value as RelativeDate, today);
  if (filter.operator === 'gt') {
    return `${field} > ${quote(range.end)}`;
  }
  if (filter.operator === 'lt') {
    return `${field} < ${quote(range.start)}`;
  }
  if (filter.operator === 'neq') {
    return `${field} < ${quote(range.start)} OR ${field} > ${quote(range.end)}`;
  }
  return `${field} >= ${quote(range.start)} AND ${field} <= ${quote(range.end)}`;
}

export function compileFilter(
  filter: Filter,
  today: Date = new Date(),
): string {
  if ((filter.valueMode ?? 'literal') === 'relativeDate') {
    return dateClause(filter, today);
  }
  const field = filter.field.trim();
  const mode = filter.valueMode ?? 'literal';
  const value = filter.value.trim();
  const rendered = mode === 'field' ? value : quote(value);
  switch (filter.operator) {
    case 'eq':
      return `${field} = ${rendered}`;
    case 'neq':
      return `${field} <> ${rendered}`;
    case 'contains':
      return `${field} like ${quote(`%${value}%`)}`;
    case 'gt':
      return `${field} > ${mode === 'literal' ? Number(value) : rendered}`;
    case 'lt':
      return `${field} < ${mode === 'literal' ? Number(value) : rendered}`;
    default:
      return `${field} = ${rendered}`;
  }
}

export function compileFilters(
  filters: Filter[],
  today: Date = new Date(),
): string {
  return filters.map((filter) => compileFilter(filter, today)).join(' AND ');
}

export interface AggregatedRow {
  dimension: string;
  value: number;
  series: Record<string, number>;
}

export interface DetailRow {
  cells: string[];
}

export interface AggregateResult {
  rows: AggregatedRow[];
  detail: DetailRow[];
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
  gt: (cell, expected) => compare(cell, expected, (a, b) => a > b),
  lt: (cell, expected) => compare(cell, expected, (a, b) => a < b),
};

function compare(
  cell: string,
  expected: string,
  compareNumbers: (left: number, right: number) => boolean,
): boolean {
  const left = cellNumber(cell);
  const right = cellNumber(expected);
  if (left != null && right != null) {
    return compareNumbers(left, right);
  }
  return compareNumbers(cell.localeCompare(expected), 0);
}

function inDateRange(cell: string, range: DateRange): boolean {
  const day = cell.trim().slice(0, 10);
  return day >= range.start && day <= range.end;
}

function matchesFilter(
  dataset: Dataset,
  filter: Filter,
  cells: unknown[],
  today: Date,
): boolean {
  const column = filterColumn(dataset, filter.field);
  if (column < 0) {
    return false;
  }
  const cell = cellText(cells[column]);
  if ((filter.valueMode ?? 'literal') === 'relativeDate') {
    const range = resolveRelativeDate(filter.value as RelativeDate, today);
    if (filter.operator === 'gt') {
      return cell.trim().slice(0, 10) > range.end;
    }
    if (filter.operator === 'lt') {
      return cell.trim().slice(0, 10) < range.start;
    }
    if (filter.operator === 'neq') {
      return !inDateRange(cell, range);
    }
    return inDateRange(cell, range);
  }
  const expected = filterExpected(dataset, filter, cells);
  return expected != null && OPERATORS[filter.operator](cell, expected);
}

function filterColumn(dataset: Dataset, field: string): number {
  const keys = fieldKeys(dataset).split(',');
  return keys.indexOf(field.trim());
}

function matchedCase(
  dataset: Dataset,
  cells: unknown[],
  today: Date,
): string | null {
  for (const item of dataset.seriesCases) {
    if (
      matchesFilter(
        dataset,
        {
          field: item.field,
          operator: item.operator,
          value: item.value,
          valueMode: item.valueMode,
        },
        cells,
        today,
      )
    ) {
      return item.label.trim();
    }
  }
  return null;
}

export function bucketOf(value: string, grain: TimeGrain | null): string {
  if (!grain) {
    return value;
  }
  const match = /^(\d{4})-(\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}` : value || '（空）';
}

function filterExpected(
  dataset: Dataset,
  filter: Filter,
  cells: unknown[],
): string | null {
  if ((filter.valueMode ?? 'literal') === 'field') {
    const column = filterColumn(dataset, filter.value);
    return column >= 0 ? cellText(cells[column]) : null;
  }
  return filter.value.trim();
}

export function aggregate(
  rawRows: unknown[],
  dataset: Dataset,
  today: Date = new Date(),
): AggregateResult {
  const grouped = new Map<string, Map<string, number>>();
  const detail: DetailRow[] = [];
  let skipped = 0;
  const seriesColumn = dataset.series ? 1 : -1;
  const measureColumn =
    dataset.aggregation === 'sum' ? (dataset.series ? 2 : 1) : -1;
  const keys = fieldKeys(dataset).split(',');

  for (const raw of rawRows) {
    const cells = Array.isArray(raw) ? raw : null;
    if (!cells) {
      skipped += 1;
      continue;
    }
    const matched = dataset.filters.every((filter) =>
      matchesFilter(dataset, filter, cells, today),
    );
    if (!matched) {
      continue;
    }
    if (dataset.columns.length > 0) {
      detail.push({
        cells: dataset.columns.map((column) => {
          const index = keys.indexOf(queryKey(column));
          return index >= 0 ? cellText(cells[index]) : '';
        }),
      });
    }
    const contribution =
      measureColumn < 0 ? 1 : cellNumber(cells[measureColumn]);
    if (contribution == null) {
      skipped += 1;
      continue;
    }
    const dimension = bucketOf(cellText(cells[0]), dataset.grain) || '（空）';
    const seriesName = dataset.seriesCases.length
      ? (matchedCase(dataset, cells, today) ?? '其他')
      : seriesColumn < 0
        ? ''
        : cellText(cells[seriesColumn]) || '（空）';
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
    .sort((a, b) =>
      dataset.grain
        ? a.dimension.localeCompare(b.dimension)
        : b.value - a.value,
    );
  const truncated = rows.length > dataset.limit;
  return {
    rows: rows.slice(0, dataset.limit),
    detail: detail.slice(0, dataset.limit),
    skipped,
    truncated: truncated || detail.length > dataset.limit,
  };
}
