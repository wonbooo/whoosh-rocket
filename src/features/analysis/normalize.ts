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

export interface BoardExport {
  kind: 'whoosh-board';
  version: 1;
  name: string;
  filters: SavedBoardTemplate['filters'];
  widgets: SavedBoardTemplate['widgets'];
  datasets: SavedBoardTemplate['datasets'];
}

/** 看板导出文件：看板本身加上它引用的数据集，不含本地 id。 */
export function boardExport(
  dashboard: Dashboard,
  datasets: Dataset[],
): BoardExport {
  const referenced = new Set<string>();
  for (const widget of dashboard.widgets) {
    if (widget.datasetId) {
      referenced.add(widget.datasetId);
    }
    for (const source of widget.sources ?? []) {
      referenced.add(source);
    }
  }
  return {
    kind: 'whoosh-board',
    version: 1,
    name: dashboard.name,
    filters: dashboard.filters.map((filter) => ({ ...filter })),
    widgets: dashboard.widgets.map((widget) => ({
      ...widget,
      sources: [...(widget.sources ?? [])],
      layout: { ...widget.layout },
    })),
    datasets: datasets
      .filter((dataset) => referenced.has(dataset.id))
      .map((dataset) => {
        const copy = { ...dataset };
        delete copy.dashboardId;
        delete copy.origin;
        return copy;
      }),
  };
}

/** 读入别人导出的看板文件；格式不对返回 null。 */
export function parseBoardExport(text: string): SavedBoardTemplate | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const item = parsed as Partial<BoardExport>;
  if (item.kind !== 'whoosh-board' || item.version !== 1) {
    return null;
  }
  return normalizeSavedTemplate({
    id: 'imported',
    name: item.name,
    datasets: item.datasets,
    filters: item.filters,
    widgets: item.widgets,
  });
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
