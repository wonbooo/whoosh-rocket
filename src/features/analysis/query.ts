import { kingdeeApi } from '@/apis/kingdee/api';
import { parseCatalog, type FieldCatalog } from '@/features/analysis/catalog';
import {
  aggregate,
  compileFilters,
  fieldKeys,
} from '@/features/analysis/model';
import type { Dataset } from '@/features/analysis/types';
import type { AggregateResult } from '@/features/analysis/model';

export interface QueryChartResult extends AggregateResult {
  fetched: number;
  queryTruncated: boolean;
}

const QUERY_CAP = 2000;

type QueryFn = (params: {
  formId: string;
  fieldKeys: string;
  filterString: string;
  topCount: number;
}) => Promise<{ rows: unknown[]; truncated: boolean }>;

const defaultQuery: QueryFn = (params) =>
  kingdeeApi.queryBill<unknown>({
    formId: params.formId,
    fieldKeys: params.fieldKeys,
    filterString: params.filterString,
    topCount: params.topCount,
  });

export async function queryChart(
  dataset: Dataset,
  query: QueryFn = defaultQuery,
): Promise<QueryChartResult> {
  const page = await query({
    formId: dataset.formId.trim(),
    fieldKeys: fieldKeys(dataset),
    filterString: compileFilters(dataset.filters),
    topCount: QUERY_CAP,
  });
  return {
    ...aggregate(page.rows, dataset),
    fetched: page.rows.length,
    queryTruncated: page.truncated,
  };
}

type MetadataFn = (formId: string) => Promise<unknown>;

export async function loadCatalog(
  formId: string,
  metadata: MetadataFn = (id) => kingdeeApi.queryMetadata(id),
): Promise<FieldCatalog> {
  return parseCatalog(formId, await metadata(formId));
}
