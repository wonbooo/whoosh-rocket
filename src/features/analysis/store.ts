import { create } from 'zustand';
import { whenHydrated } from '@/lib/persistedRecord';
import {
  loadAnalysisSettings,
  loadAnalysisState,
  saveAnalysisSettings,
  saveAnalysisState,
} from '@/features/analysis/storage';
import type {
  AnalysisState,
  Dashboard,
  Dataset,
  Widget,
} from '@/features/analysis/types';
import type { InstantiatedBoard } from '@/features/analysis/templates';

interface AnalysisStore extends AnalysisState {
  themeId: string;
  setTheme: (themeId: string) => void;
  saveDataset: (dataset: Dataset) => void;
  deleteDataset: (id: string) => void;
  saveDashboard: (dashboard: Dashboard) => void;
  deleteDashboard: (id: string) => void;
  saveWidget: (dashboardId: string, widget: Widget) => void;
  deleteWidget: (dashboardId: string, widgetId: string) => void;
  applyTemplate: (board: InstantiatedBoard) => void;
}

function persist(state: AnalysisState): AnalysisState {
  saveAnalysisState(state);
  return state;
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index < 0) {
    return [...items, item];
  }
  return items.map((current) => (current.id === item.id ? item : current));
}

export const useAnalysisStore = create<AnalysisStore>((set) => ({
  ...loadAnalysisState(),
  ...loadAnalysisSettings(),
  setTheme: (themeId) => {
    saveAnalysisSettings({ themeId });
    set({ themeId });
  },
  saveDataset: (dataset) =>
    set((state) =>
      persist({ ...state, datasets: upsert(state.datasets, dataset) }),
    ),
  deleteDataset: (id) =>
    set((state) =>
      persist({
        datasets: state.datasets.filter((dataset) => dataset.id !== id),
        dashboards: state.dashboards.map((dashboard) => ({
          ...dashboard,
          widgets: dashboard.widgets.filter(
            (widget) => widget.datasetId !== id,
          ),
        })),
      }),
    ),
  saveDashboard: (dashboard) =>
    set((state) =>
      persist({ ...state, dashboards: upsert(state.dashboards, dashboard) }),
    ),
  deleteDashboard: (id) =>
    set((state) =>
      persist({
        ...state,
        dashboards: state.dashboards.filter((dashboard) => dashboard.id !== id),
      }),
    ),
  saveWidget: (dashboardId, widget) =>
    set((state) =>
      persist({
        ...state,
        dashboards: state.dashboards.map((dashboard) =>
          dashboard.id === dashboardId
            ? { ...dashboard, widgets: upsert(dashboard.widgets, widget) }
            : dashboard,
        ),
      }),
    ),
  deleteWidget: (dashboardId, widgetId) =>
    set((state) =>
      persist({
        ...state,
        dashboards: state.dashboards.map((dashboard) =>
          dashboard.id === dashboardId
            ? {
                ...dashboard,
                widgets: dashboard.widgets.filter(
                  (widget) => widget.id !== widgetId,
                ),
              }
            : dashboard,
        ),
      }),
    ),
  applyTemplate: (board) =>
    set((state) =>
      persist({
        datasets: board.datasets.reduce(
          (datasets, dataset) =>
            datasets.some((current) => current.id === dataset.id)
              ? datasets
              : [...datasets, dataset],
          state.datasets,
        ),
        dashboards: upsert(state.dashboards, board.dashboard),
      }),
    ),
}));

void whenHydrated('analysis').then(() => {
  useAnalysisStore.setState({
    ...loadAnalysisState(),
    ...loadAnalysisSettings(),
  });
});
