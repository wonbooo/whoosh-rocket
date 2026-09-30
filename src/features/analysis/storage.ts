import type {
  AnalysisState,
  Dashboard,
  Dataset,
} from '@/features/analysis/types';
import { createRecord, type PersistedRecord } from '@/lib/persistedRecord';

const DATASETS = 'datasets';
const DASHBOARDS = 'dashboards';

export function emptyAnalysisState(): AnalysisState {
  return { datasets: [], dashboards: [] };
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
    datasets: readList<Dataset>(record, DATASETS),
    dashboards: readList<Dashboard>(record, DASHBOARDS),
  };
}

export function saveAnalysisState(
  state: AnalysisState,
  record: PersistedRecord = createRecord('analysis'),
): void {
  record.set(DATASETS, JSON.stringify(state.datasets));
  record.set(DASHBOARDS, JSON.stringify(state.dashboards));
}
