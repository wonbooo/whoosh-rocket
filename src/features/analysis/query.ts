import { kingdeeApi } from '@/apis/kingdee/api';
import { parseCatalog, type FieldCatalog } from '@/features/analysis/catalog';
import {
  readCatalogCache,
  writeCatalogCache,
  type CatalogScope,
} from '@/features/analysis/catalogCache';
import type { PersistedRecord } from '@/lib/persistedRecord';
import {
  queryChart,
  queryMerged,
  type QueryFn,
} from '@/features/analysis/merge';
import type { QueryChartResult } from '@/features/analysis/merge';
import { cellText } from '@/features/analysis/model';
import type { Dataset } from '@/features/analysis/types';
import type { BillQueryParams } from '@/types/kingdee';

export type { QueryChartResult };

const defaultQuery: QueryFn = (params) =>
  kingdeeApi.queryBill<unknown>({
    formId: params.formId,
    fieldKeys: params.fieldKeys,
    filterString: params.filterString,
    orderString: params.orderString,
    topCount: params.topCount,
    startRow: params.startRow,
    limit: params.limit,
  });

export async function runQuery(
  dataset: Dataset,
  options: { query?: QueryFn; page?: number; pageSize?: number } = {},
): Promise<QueryChartResult> {
  return queryChart(
    dataset,
    options.query ?? defaultQuery,
    new Date(),
    options.page ?? 0,
    options.pageSize,
  );
}

export async function runMerged(
  sources: { dataset: Dataset; legend: string }[],
  query: QueryFn = defaultQuery,
): Promise<QueryChartResult> {
  return queryMerged(sources, query);
}

type MetadataFn = (formId: string) => Promise<unknown>;

export interface LookupMatch {
  number: string;
  name: string;
}

type LookupQuery = (params: BillQueryParams) => Promise<{ rows: unknown[] }>;

export async function searchLookup(
  formId: string,
  keyword: string,
  query: LookupQuery = (params) => kingdeeApi.queryBill(params),
): Promise<LookupMatch[]> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return [];
  }
  const escaped = trimmed.replaceAll("'", "''");
  const page = await query({
    formId,
    fieldKeys: 'FNumber,FName',
    filterString: `(FNumber like '%${escaped}%' OR FName like '%${escaped}%')`,
    topCount: 20,
  });
  const matches: LookupMatch[] = [];
  for (const row of page.rows) {
    if (!Array.isArray(row)) {
      continue;
    }
    const number = cellText(row[0]).trim();
    const name = cellText(row[1]).trim();
    if (!number && !name) {
      continue;
    }
    matches.push({ number: number || name, name: name || number });
  }
  return matches;
}

export async function loadCatalog(
  formId: string,
  metadata: MetadataFn = (id) => kingdeeApi.queryMetadata(id),
): Promise<FieldCatalog> {
  return parseCatalog(formId, await metadata(formId));
}

export function beginCatalogLoad(
  scope: CatalogScope,
  formId: string,
  options: {
    force?: boolean;
    metadata?: MetadataFn;
    record?: PersistedRecord;
  } = {},
): { cached: FieldCatalog | null; fresh: Promise<FieldCatalog> } {
  const cached = options.force
    ? null
    : readCatalogCache(scope, formId, options.record);
  const fresh = loadCatalog(formId, options.metadata).then((catalog) => {
    writeCatalogCache(scope, formId, catalog, options.record);
    return catalog;
  });
  return { cached, fresh };
}
