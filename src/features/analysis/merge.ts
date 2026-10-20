import {
  aggregate,
  compileFilters,
  fieldKeys,
} from '@/features/analysis/model';
import type { AggregateResult } from '@/features/analysis/model';
import type { Dataset } from '@/features/analysis/types';

export interface QueryChartResult extends AggregateResult {
  fetched: number;
  queryTruncated: boolean;
}

export const DETAIL_PAGE_SIZES = [20, 50, 100, 200, 500] as const;

export type DetailPageSize = (typeof DETAIL_PAGE_SIZES)[number];

export const DETAIL_PAGE_SIZE: DetailPageSize = 20;

export function detailPageSize(value: number | undefined): DetailPageSize {
  return (DETAIL_PAGE_SIZES as readonly number[]).includes(value ?? -1)
    ? (value as DetailPageSize)
    : DETAIL_PAGE_SIZE;
}

export interface QuerySource {
  formId: string;
  fieldKeys: string;
  filterString: string;
  topCount: number;
  startRow?: number;
  limit?: number;
  orderString?: string;
}

export interface QueryPage {
  rows: unknown[];
  truncated: boolean;
}

export type QueryFn = (params: QuerySource) => Promise<QueryPage>;

export interface MergeSource {
  dataset: Dataset;
  legend: string;
}

const QUERY_CAP = 2000;

function detailOrder(fieldKeys: string): string {
  return fieldKeys
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => `${key} ASC`)
    .join(',');
}

export async function queryChart(
  dataset: Dataset,
  query: QueryFn,
  today: Date = new Date(),
  page = 0,
  pageSize?: number,
): Promise<QueryChartResult> {
  const keys = fieldKeys(dataset);
  const pageIndex = Number.isInteger(page) && page > 0 ? page : 0;
  const size = detailPageSize(pageSize);
  const requested = await query(
    dataset.columns.length > 0
      ? {
          formId: dataset.formId.trim(),
          fieldKeys: keys,
          filterString: compileFilters(dataset.filters, today),
          topCount: 0,
          startRow: pageIndex * size,
          limit: size,
          orderString: detailOrder(keys),
        }
      : {
          formId: dataset.formId.trim(),
          fieldKeys: keys,
          filterString: compileFilters(dataset.filters, today),
          topCount: QUERY_CAP,
        },
  );
  return {
    ...aggregate(requested.rows, dataset, today),
    fetched: requested.rows.length,
    queryTruncated: requested.truncated,
  };
}

export async function queryMerged(
  sources: MergeSource[],
  query: QueryFn,
  today: Date = new Date(),
): Promise<QueryChartResult> {
  const pages = await Promise.all(
    sources.map((source) => queryChart(source.dataset, query, today)),
  );
  const combined = new Map<string, Record<string, number>>();
  for (const [index, page] of pages.entries()) {
    const legend = sources[index]?.legend ?? `来源${index + 1}`;
    for (const row of page.rows) {
      const bucket = combined.get(row.dimension) ?? {};
      bucket[legend] = (bucket[legend] ?? 0) + row.value;
      combined.set(row.dimension, bucket);
    }
  }
  const rows = [...combined.entries()]
    .map(([dimension, series]) => ({
      dimension,
      series,
      value: Object.values(series).reduce((sum, item) => sum + item, 0),
    }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
  return {
    rows,
    detail: [],
    skipped: pages.reduce((sum, page) => sum + page.skipped, 0),
    truncated: pages.some((page) => page.truncated),
    fetched: pages.reduce((sum, page) => sum + page.fetched, 0),
    queryTruncated: pages.some((page) => page.queryTruncated),
  };
}
