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
  hiddenTemplateIds: string[];
  setTheme: (themeId: string) => void;
  hideTemplate: (id: string) => void;
  deleteTemplate: (id: string) => void;
  saveDataset: (dataset: Dataset) => void;
  deleteDataset: (id: string) => void;
  saveDashboard: (dashboard: Dashboard) => void;
  deleteDashboard: (id: string) => void;
  saveWidget: (dashboardId: string, widget: Widget) => void;
  deleteWidget: (dashboardId: string, widgetId: string) => void;
  applyTemplate: (board: InstantiatedBoard) => void;
  saveBoardTemplate: (
    template: AnalysisState['savedTemplates'][number],
  ) => void;
  deleteSavedTemplate: (id: string) => void;
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
  setTheme: (themeId) =>
    set((state) => {
      saveAnalysisSettings({
        themeId,
        hiddenTemplateIds: state.hiddenTemplateIds ?? [],
      });
      return { themeId };
    }),
  hideTemplate: (id) =>
    set((state) => {
      const current = state.hiddenTemplateIds ?? [];
      if (current.includes(id)) {
        return {};
      }
      const hiddenTemplateIds = [...current, id];
      saveAnalysisSettings({ themeId: state.themeId, hiddenTemplateIds });
      return { hiddenTemplateIds };
    }),
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
          widgets: dashboard.widgets
            .filter((widget) => widget.datasetId !== id)
            .map((widget) => ({
              ...widget,
              sources: (widget.sources ?? []).filter((source) => source !== id),
            })),
        })),
        savedTemplates: state.savedTemplates ?? [],
      }),
    ),
  saveDashboard: (dashboard) =>
    set((state) =>
      persist({ ...state, dashboards: upsert(state.dashboards, dashboard) }),
    ),
  deleteDashboard: (id) =>
    set((state) => {
      const board = state.dashboards.find((dashboard) => dashboard.id === id);
      const owned = datasetIdsOf(board);
      for (const dataset of state.datasets) {
        if (dataset.dashboardId === id) {
          owned.add(dataset.id);
        }
      }
      const keptBoards = state.dashboards.filter(
        (dashboard) => dashboard.id !== id,
      );
      const stillUsed = datasetIdsOfBoards(keptBoards);
      return persist({
        ...state,
        dashboards: keptBoards,
        datasets: state.datasets.filter(
          (dataset) => !owned.has(dataset.id) || stillUsed.has(dataset.id),
        ),
      });
    }),
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
        savedTemplates: state.savedTemplates ?? [],
      }),
    ),
  saveBoardTemplate: (template) =>
    set((state) =>
      persist({
        ...state,
        savedTemplates: upsert(state.savedTemplates ?? [], template),
      }),
    ),
  deleteSavedTemplate: (id) =>
    set((state) =>
      persist({
        ...state,
        savedTemplates: (state.savedTemplates ?? []).filter(
          (template) => template.id !== id,
        ),
        datasets: withoutTemplateDatasets(state.datasets, state.dashboards, id),
      }),
    ),
  deleteTemplate: (id) =>
    set((state) => {
      const saved = (state.savedTemplates ?? []).some(
        (template) => template.id === id,
      );
      if (saved) {
        return persist({
          ...state,
          savedTemplates: (state.savedTemplates ?? []).filter(
            (template) => template.id !== id,
          ),
          datasets: withoutTemplateDatasets(
            state.datasets,
            state.dashboards,
            id,
          ),
        });
      }
      const hiddenTemplateIds = [
        ...new Set([...(state.hiddenTemplateIds ?? []), id]),
      ];
      saveAnalysisSettings({
        themeId: state.themeId,
        hiddenTemplateIds,
      });
      return {
        ...persist({
          ...state,
          datasets: withoutTemplateDatasets(
            state.datasets,
            state.dashboards,
            id,
          ),
        }),
        hiddenTemplateIds,
      };
    }),
}));

function datasetIdsOf(board: Dashboard | undefined): Set<string> {
  const ids = new Set<string>();
  for (const widget of board?.widgets ?? []) {
    if (widget.datasetId) {
      ids.add(widget.datasetId);
    }
    for (const source of widget.sources ?? []) {
      ids.add(source);
    }
  }
  return ids;
}

function datasetIdsOfBoards(dashboards: Dashboard[]): Set<string> {
  const ids = new Set<string>();
  for (const dashboard of dashboards) {
    for (const id of datasetIdsOf(dashboard)) {
      ids.add(id);
    }
  }
  return ids;
}

function withoutTemplateDatasets(
  datasets: AnalysisState['datasets'],
  dashboards: Dashboard[],
  templateId: string,
): AnalysisState['datasets'] {
  const used = datasetIdsOfBoards(dashboards);
  return datasets.filter((dataset) => {
    if (used.has(dataset.id) || dataset.dashboardId) {
      return true;
    }
    return !(
      dataset.origin?.templateId === templateId ||
      dataset.id.startsWith(`template:${templateId}:`)
    );
  });
}

void whenHydrated('analysis')
  .then(() => {
    useAnalysisStore.setState({
      ...loadAnalysisState(),
      ...loadAnalysisSettings(),
    });
  })
  .catch(() => {
    // The next read retries a failed load.
  });
