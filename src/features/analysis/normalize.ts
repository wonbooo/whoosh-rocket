import type {
  Dashboard,
  Dataset,
  FieldRef,
  SavedBoardTemplate,
  SeriesCase,
  Widget,
} from '@/features/analysis/types';

function cases(value: unknown): SeriesCase[] {
  return Array.isArray(value)
    ? (value as SeriesCase[]).map(migrateRelative)
    : [];
}

function migrateRelative<T extends { value?: string; valueMode?: string }>(
  item: T,
): T {
  if (item.valueMode === 'relativeDate' && item.value === 'last365Days') {
    return { ...item, value: 'thisYear' };
  }
  return item;
}

function migrateFilters<T extends { value?: string; valueMode?: string }>(
  filters: T[] | undefined,
): T[] | undefined {
  return Array.isArray(filters) ? filters.map(migrateRelative) : filters;
}

function normalizeField(field: FieldRef): FieldRef {
  if (field.groupByMonth === true) {
    return field;
  }
  if (!('groupByMonth' in field)) {
    return field;
  }
  const next = { ...field };
  delete next.groupByMonth;
  return next;
}

export function normalizeDataset(dataset: Dataset): Dataset {
  const normalized = {
    ...dataset,
    dimension: normalizeField(dataset.dimension),
    series: dataset.series ? normalizeField(dataset.series) : null,
    measure: normalizeField(dataset.measure),
    seriesCases: cases(dataset.seriesCases),
    filters: migrateFilters(dataset.filters) ?? [],
    columns: Array.isArray(dataset.columns)
      ? dataset.columns.map(normalizeField)
      : [],
    chartType: dataset.chartType ?? 'bar',
  };
  delete (normalized as { grain?: unknown }).grain;
  return normalized;
}

export function normalizeDashboard(dashboard: Dashboard): Dashboard {
  return {
    ...dashboard,
    filters: migrateFilters(dashboard.filters) ?? [],
    widgets: dashboard.widgets.map(normalizeWidget),
  };
}

function normalizeWidget(widget: Widget): Widget {
  return {
    ...widget,
    sources: Array.isArray(widget.sources) ? widget.sources : [],
  };
}

export function normalizeSavedTemplate(
  value: unknown,
): SavedBoardTemplate | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<SavedBoardTemplate>;
  if (typeof item.id !== 'string' || typeof item.name !== 'string') {
    return null;
  }
  return {
    id: item.id,
    name: item.name,
    datasets: Array.isArray(item.datasets)
      ? item.datasets.map((dataset) => normalizeDataset(dataset))
      : [],
    filters: migrateFilters(item.filters) ?? [],
    widgets: Array.isArray(item.widgets)
      ? item.widgets.map((widget) => normalizeWidget(widget))
      : [],
  };
}
