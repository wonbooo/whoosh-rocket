import type { FieldCatalog } from '@/features/analysis/catalog';
import {
  fieldLabels,
  fieldNeeds,
  measureNotNumericMessage,
} from '@/features/analysis/presentation';
import type { Presentation } from '@/features/analysis/presentation';
import type {
  Dataset,
  FieldDisplay,
  FieldRef,
  Filter,
  FilterOperator,
  RelativeDate,
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

export function validateDataset(
  dataset: Dataset,
  mode: Presentation = dataset.columns.length > 0 ? 'detail' : 'chart',
  catalog: FieldCatalog | null = null,
): ValidationResult {
  if (!dataset.name.trim()) {
    return { valid: false, message: '请填写数据集名称' };
  }
  const formProblem = checkIdentifier(dataset.formId, '表单 ID');
  if (formProblem) {
    return formProblem;
  }
  const needs = fieldNeeds(mode, dataset.chartType);
  const labels = fieldLabels(dataset.chartType);
  if (needs.columns) {
    if (dataset.columns.length === 0) {
      return { valid: false, message: '请添加明细列' };
    }
    for (const column of dataset.columns) {
      const problem = checkIdentifier(column.field, '明细列字段');
      if (problem) {
        return problem;
      }
    }
  }
  if (needs.dimension) {
    const problem = checkIdentifier(dataset.dimension.field, labels.dimension);
    if (problem) {
      return problem;
    }
  }
  if (needs.seriesRequired) {
    const problem = checkIdentifier(dataset.series?.field ?? '', labels.series);
    if (problem) {
      return problem;
    }
  } else if (needs.series && dataset.series) {
    const problem = checkIdentifier(dataset.series.field, labels.series);
    if (problem) {
      return problem;
    }
  }
  if (needs.seriesCases) {
    for (const item of dataset.seriesCases) {
      const problem = checkIdentifier(item.field, '条件拆分字段');
      if (problem) {
        return problem;
      }
      if (!item.label.trim()) {
        return { valid: false, message: '请填写条件拆分的系列名' };
      }
    }
  }
  if (needs.measure && dataset.aggregation === 'sum') {
    const problem = checkIdentifier(dataset.measure.field, labels.measure);
    if (problem) {
      return problem;
    }
    const known = catalog?.fields.find(
      (item) => item.key === dataset.measure.field.trim(),
    );
    if (known && known.kind !== 'number') {
      return {
        valid: false,
        message: measureNotNumericMessage(dataset.chartType),
      };
    }
  }
  if (
    needs.dimension &&
    needs.measure &&
    dataset.aggregation === 'sum' &&
    !dataset.series &&
    dataset.dimension.field.trim() === dataset.measure.field.trim()
  ) {
    return {
      valid: false,
      message: `${labels.dimension}和${labels.measure}不能是同一个字段`,
    };
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
      !isCalendarDate(filter.value.trim()) &&
      Number.isNaN(Number(filter.value.trim()))
    ) {
      return { valid: false, message: '大于、小于比较的值必须是数字' };
    }
  }
  if (!needs.columns && fieldKeys(dataset) === '') {
    return {
      valid: false,
      message: `计数需要至少一条过滤条件，或改为求和并填写${labels.measure}`,
    };
  }
  return { valid: true, message: '' };
}

/** 目录里能确认该字段不是基础资料。没有目录或目录里没有这个字段时返回 false。 */
function confirmedPlainField(
  catalog: FieldCatalog | null,
  field: string,
): boolean {
  const key = field.trim();
  if (!catalog || !key) {
    return false;
  }
  const match = catalog.fields.find((item) => item.key === key);
  if (!match) {
    return false;
  }
  return !match.lookupFormId && match.kind !== 'lookup';
}

export function defaultFieldDisplay(
  catalog: FieldCatalog | null,
  field: string,
): FieldDisplay {
  return confirmedPlainField(catalog, field) ? 'value' : 'name';
}

function withoutMonthGrouping(ref: FieldRef): FieldRef {
  if (!ref.groupByMonth) {
    return ref;
  }
  const next = { ...ref };
  delete next.groupByMonth;
  return next;
}

function resolveField(ref: FieldRef, catalog: FieldCatalog | null): FieldRef {
  const kind = catalog?.fields.find(
    (field) => field.key === ref.field.trim(),
  )?.kind;
  const resolved = kind && kind !== 'date' ? withoutMonthGrouping(ref) : ref;
  if (
    !confirmedPlainField(catalog, resolved.field) ||
    resolved.display === 'value'
  ) {
    return resolved;
  }
  return { ...resolved, display: 'value' };
}

/** 数量、日期、枚举、文本没有名称和编码。选字段时曾一律记成「名称」，这里按目录改回原值。 */
export function resolveDataset(
  dataset: Dataset,
  catalog: FieldCatalog | null,
): Dataset {
  if (!catalog) {
    return dataset;
  }
  return {
    ...dataset,
    dimension: resolveField(dataset.dimension, catalog),
    series: dataset.series ? resolveField(dataset.series, catalog) : null,
    measure: resolveField(dataset.measure, catalog),
    columns: dataset.columns.map((column) => resolveField(column, catalog)),
  };
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
  const keys: string[] = [];
  const add = (key: string) => {
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  };
  if (dataset.dimension.field.trim()) {
    add(queryKey(dataset.dimension));
  }
  if (dataset.series?.field.trim()) {
    add(queryKey(dataset.series));
  }
  if (dataset.aggregation === 'sum' && dataset.measure.field.trim()) {
    add(queryKey(dataset.measure));
  }
  for (const item of dataset.seriesCases) {
    add(item.field.trim());
  }
  for (const column of dataset.columns) {
    add(queryKey(column));
  }
  for (const filter of dataset.filters) {
    add(filter.field.trim());
    if (filter.valueMode === 'field') {
      add(filter.value.trim());
    }
    if (filter.valueMode === 'lookup') {
      add(lookupMatchKey(filter));
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
  'thisYear',
  'last6Months',
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
  if (token === 'thisYear') {
    return {
      start: formatDate(new Date(start.getFullYear(), 0, 1)),
      end: formatDate(new Date(start.getFullYear(), 11, 31)),
    };
  }
  const from = new Date(start);
  from.setDate(from.getDate() - 183);
  return { start: formatDate(from), end: formatDate(start) };
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function nextCalendarDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  date.setDate(date.getDate() + 1);
  return formatDate(date);
}

function compileCalendarDate(
  field: string,
  operator: FilterOperator,
  value: string,
): string {
  const next = nextCalendarDay(value);
  if (operator === 'gt') {
    return `${field} >= ${quote(next)}`;
  }
  if (operator === 'lt') {
    return `${field} < ${quote(value)}`;
  }
  if (operator === 'neq') {
    return `(${field} < ${quote(value)} OR ${field} >= ${quote(next)})`;
  }
  return `${field} >= ${quote(value)} AND ${field} < ${quote(next)}`;
}

function hasLookupSuffix(field: string): boolean {
  return field.endsWith('.FNumber') || field.endsWith('.FName');
}

function isContainsOperator(operator: FilterOperator): boolean {
  return operator === 'contains' || operator === 'notContains';
}

function lookupMatchKey(filter: Filter): string {
  const field = filter.field.trim();
  if (hasLookupSuffix(field)) {
    return field;
  }
  return isContainsOperator(filter.operator)
    ? `${field}.FName`
    : `${field}.FNumber`;
}

function compileLookup(filter: Filter): string {
  const field = filter.field.trim();
  const code = filter.value.trim();
  const name = filter.valueLabel?.trim() || code;
  if (isContainsOperator(filter.operator)) {
    const target = hasLookupSuffix(field) ? field : `${field}.FName`;
    const verb = filter.operator === 'notContains' ? 'not like' : 'like';
    return `${target} ${verb} ${quote(`%${name}%`)}`;
  }
  const target = hasLookupSuffix(field) ? field : `${field}.FNumber`;
  const rendered = quote(code);
  if (filter.operator === 'neq') {
    return `${target} <> ${rendered}`;
  }
  if (filter.operator === 'gt') {
    return `${target} > ${rendered}`;
  }
  if (filter.operator === 'lt') {
    return `${target} < ${rendered}`;
  }
  return `${target} = ${rendered}`;
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
  if (mode === 'lookup') {
    return compileLookup(filter);
  }
  if (
    mode !== 'field' &&
    isCalendarDate(value) &&
    !isContainsOperator(filter.operator)
  ) {
    return compileCalendarDate(field, filter.operator, value);
  }
  const rendered = mode === 'field' ? value : quote(value);
  switch (filter.operator) {
    case 'eq':
      return `${field} = ${rendered}`;
    case 'neq':
      return `${field} <> ${rendered}`;
    case 'contains':
      return `${field} like ${quote(`%${value}%`)}`;
    case 'notContains':
      return `${field} not like ${quote(`%${value}%`)}`;
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

export function monthGroup(value: string): string {
  const match = /^(\d{4})[-/](\d{1,2})/.exec(value.trim());
  if (!match) {
    return value;
  }
  return `${match[1]}-${match[2].padStart(2, '0')}`;
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
  notContains: (cell, expected) => !cell.includes(expected),
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
  const mode = filter.valueMode ?? 'literal';
  const column = filterColumn(
    dataset,
    mode === 'lookup' ? lookupMatchKey(filter) : filter.field,
  );
  if (column < 0) {
    return false;
  }
  const cell = cellText(cells[column]);
  if (mode === 'lookup') {
    const expected = isContainsOperator(filter.operator)
      ? filter.valueLabel?.trim() || filter.value.trim()
      : filter.value.trim();
    return expected.length > 0 && OPERATORS[filter.operator](cell, expected);
  }
  if (mode === 'relativeDate') {
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
  if (
    mode === 'literal' &&
    isCalendarDate(filter.value.trim()) &&
    !isContainsOperator(filter.operator)
  ) {
    return matchesCalendar(filter.operator, cell, filter.value.trim());
  }
  const expected = filterExpected(dataset, filter, cells);
  return expected != null && OPERATORS[filter.operator](cell, expected);
}

function matchesCalendar(
  operator: FilterOperator,
  cell: string,
  value: string,
): boolean {
  const day = cell.trim().slice(0, 10);
  if (operator === 'gt') {
    return day > value;
  }
  if (operator === 'lt') {
    return day < value;
  }
  if (operator === 'neq') {
    return day !== value;
  }
  if (operator === 'eq') {
    return day === value;
  }
  return false;
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
          valueLabel: item.valueLabel,
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

function groupedText(value: string, byMonth: boolean): string {
  const text = value || '（空）';
  return byMonth ? monthGroup(text) : text;
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
  const keys = fieldKeys(dataset)
    .split(',')
    .filter((key) => key.length > 0);
  const dimensionIndex = dataset.dimension.field.trim()
    ? keys.indexOf(queryKey(dataset.dimension))
    : -1;
  const seriesIndex = dataset.series?.field.trim()
    ? keys.indexOf(queryKey(dataset.series))
    : -1;
  const measureIndex =
    dataset.aggregation === 'sum' && dataset.measure.field.trim()
      ? keys.indexOf(queryKey(dataset.measure))
      : -1;

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
    const contribution = measureIndex < 0 ? 1 : cellNumber(cells[measureIndex]);
    if (contribution == null) {
      skipped += 1;
      continue;
    }
    const dimension =
      dimensionIndex < 0
        ? '合计'
        : groupedText(
            cellText(cells[dimensionIndex]),
            dataset.dimension.groupByMonth === true,
          );
    const seriesName = dataset.seriesCases.length
      ? (matchedCase(dataset, cells, today) ?? '其他')
      : seriesIndex < 0
        ? ''
        : groupedText(
            cellText(cells[seriesIndex]),
            dataset.series?.groupByMonth === true,
          );
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
  return {
    rows,
    detail,
    skipped,
    truncated: false,
  };
}
