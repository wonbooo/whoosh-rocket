import type {
  AnalysisState,
  Dashboard,
  Dataset,
  SavedBoardTemplate,
} from '@/features/analysis/types';
import {
  normalizeDashboard,
  normalizeDataset,
  normalizeSavedTemplate,
} from '@/features/analysis/normalize';
import { DEFAULT_THEME_ID, findTheme } from '@/features/analysis/themes';
import { createRecord, type PersistedRecord } from '@/lib/persistedRecord';

const DATASETS = 'datasets';
const DASHBOARDS = 'dashboards';
const THEME = 'theme';
const HIDDEN_TEMPLATES = 'hiddenTemplates';
const SAVED_TEMPLATES = 'savedTemplates';

export function emptyAnalysisState(): AnalysisState {
  return { datasets: [], dashboards: [], savedTemplates: [] };
}

function readList<T>(record: PersistedRecord, key: string): T[] {
  const raw = record.get(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function loadAnalysisState(
  record: PersistedRecord = createRecord('analysis'),
): AnalysisState {
  return {
    datasets: readList<Dataset>(record, DATASETS).map(normalizeDataset),
    dashboards: readList<Dashboard>(record, DASHBOARDS).map(normalizeDashboard),
    savedTemplates: readList<unknown>(record, SAVED_TEMPLATES)
      .map(normalizeSavedTemplate)
      .filter((item): item is SavedBoardTemplate => item != null),
  };
}

export interface AnalysisSettings {
  themeId: string;
  hiddenTemplateIds: string[];
}

function readHiddenTemplateIds(record: PersistedRecord): string[] {
  const raw = record.get(HIDDEN_TEMPLATES);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function loadAnalysisSettings(
  record: PersistedRecord = createRecord('analysis'),
): AnalysisSettings {
  return {
    themeId: findTheme(record.get(THEME) ?? DEFAULT_THEME_ID).id,
    hiddenTemplateIds: readHiddenTemplateIds(record),
  };
}

export function saveAnalysisSettings(
  settings: { themeId: string; hiddenTemplateIds?: string[] },
  record: PersistedRecord = createRecord('analysis'),
): void {
  record.set(THEME, settings.themeId);
  if (settings.hiddenTemplateIds !== undefined) {
    record.set(HIDDEN_TEMPLATES, JSON.stringify(settings.hiddenTemplateIds));
  }
}

export function saveAnalysisState(
  state: {
    datasets: Dataset[];
    dashboards: Dashboard[];
    savedTemplates?: SavedBoardTemplate[];
  },
  record: PersistedRecord = createRecord('analysis'),
): void {
  record.set(DATASETS, JSON.stringify(state.datasets));
  record.set(DASHBOARDS, JSON.stringify(state.dashboards));
  record.set(SAVED_TEMPLATES, JSON.stringify(state.savedTemplates ?? []));
}
