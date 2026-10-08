import { kingdeeApi } from '@/apis/kingdee/api';
import { parseCatalog, type FieldCatalog } from '@/features/analysis/catalog';
import {
  queryChart,
  queryMerged,
  type QueryFn,
} from '@/features/analysis/merge';
import type { QueryChartResult } from '@/features/analysis/merge';
import type { Dataset } from '@/features/analysis/types';

export type { QueryChartResult };

const defaultQuery: QueryFn = (params) =>
  kingdeeApi.queryBill<unknown>({
    formId: params.formId,
    fieldKeys: params.fieldKeys,
    filterString: params.filterString,
    topCount: params.topCount,
  });

export async function runQuery(
  dataset: Dataset,
  query: QueryFn = defaultQuery,
): Promise<QueryChartResult> {
  return queryChart(dataset, query);
}

export async function runMerged(
  sources: { dataset: Dataset; legend: string }[],
  query: QueryFn = defaultQuery,
): Promise<QueryChartResult> {
  return queryMerged(sources, query);
}

type MetadataFn = (formId: string) => Promise<unknown>;

export async function loadCatalog(
  formId: string,
  metadata: MetadataFn = (id) => kingdeeApi.queryMetadata(id),
): Promise<FieldCatalog> {
  return parseCatalog(formId, await metadata(formId));
}
