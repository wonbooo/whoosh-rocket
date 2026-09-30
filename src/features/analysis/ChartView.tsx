import { useEffect, useRef } from 'react';
import { Chart } from '@antv/g2';
import {
  chartData,
  chartSpec,
  legendLabel,
} from '@/features/analysis/chartSpec';
import { chartTitle } from '@/features/analysis/model';
import type { AggregatedRow } from '@/features/analysis/model';
import type { QueryChartResult } from '@/features/analysis/query';
import type { ChartType, Dataset } from '@/features/analysis/types';

const numberFormat = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
});

function seriesNames(rows: AggregatedRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const name of Object.keys(row.series)) {
      if (name) {
        names.add(name);
      }
    }
  }
  return [...names];
}

export function ChartView({
  dataset,
  chartType,
  result,
}: {
  dataset: Dataset;
  chartType: ChartType;
  result: QueryChartResult;
}) {
  const container = useRef<HTMLDivElement>(null);
  const total = result.rows.reduce((sum, row) => sum + row.value, 0);
  const split = seriesNames(result.rows).length > 0;

  useEffect(() => {
    const node = container.current;
    if (!node || chartType === 'kpi' || typeof document === 'undefined') {
      return;
    }
    const chart = new Chart({ container: node, autoFit: true });
    chart.options(
      chartSpec(
        chartType,
        chartData(result.rows, split),
        split,
        legendLabel(dataset),
      ),
    );
    void chart.render();
    return () => chart.destroy();
  }, [chartType, dataset, result, split]);

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-zinc-700">
        {chartTitle(dataset, chartType)}
      </h3>
      {chartType === 'kpi' ? (
        <div className="flex h-40 flex-col items-center justify-center">
          <div className="text-4xl font-semibold tracking-tight">
            {numberFormat.format(total)}
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            {result.rows.length} 个维度合计
          </div>
        </div>
      ) : (
        <div className="h-72" ref={container} />
      )}
      <p className="mt-3 text-xs text-zinc-500">
        取回 {result.fetched} 行，聚合为 {result.rows.length} 组
        {result.skipped > 0 ? `，跳过 ${result.skipped} 行无法解析的数据` : ''}
        {result.queryTruncated ? '。查询已达 2000 行上限，结果可能不完整' : ''}
        {result.truncated ? `。仅显示前 ${dataset.limit} 组` : ''}
      </p>
    </div>
  );
}
