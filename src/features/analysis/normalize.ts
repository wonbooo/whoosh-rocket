import type {
  Dashboard,
  Dataset,
  SeriesCase,
  Widget,
} from '@/features/analysis/types';

function cases(value: unknown): SeriesCase[] {
  return Array.isArray(value) ? (value as SeriesCase[]) : [];
}

export function normalizeDataset(dataset: Dataset): Dataset {
  const normalized = {
    ...dataset,
    seriesCases: cases(dataset.seriesCases),
    columns: Array.isArray(dataset.columns) ? dataset.columns : [],
    chartType: dataset.chartType ?? 'bar',
  };
  delete (normalized as { grain?: unknown }).grain;
  return normalized;
}

export function normalizeDashboard(dashboard: Dashboard): Dashboard {
  return {
    ...dashboard,
    filters: Array.isArray(dashboard.filters) ? dashboard.filters : [],
    widgets: dashboard.widgets.map(normalizeWidget),
  };
}

function normalizeWidget(widget: Widget): Widget {
  return {
    ...widget,
    sources: Array.isArray(widget.sources) ? widget.sources : [],
  };
}
