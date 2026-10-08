import { useEffect, useRef } from 'react';
import { Chart } from '@antv/g2';
import {
  chartData,
  chartSpec,
  legendLabel,
} from '@/features/analysis/chartSpec';
import type { AggregatedRow } from '@/features/analysis/model';
import type { QueryChartResult } from '@/features/analysis/query';
import type { ChartType, Dataset } from '@/features/analysis/types';

export interface ColumnHeader {
  field: string;
  label: string;
}

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
  headers,
}: {
  dataset: Dataset;
  chartType: ChartType;
  result: QueryChartResult;
  headers?: ColumnHeader[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const total = result.rows.reduce((sum, row) => sum + row.value, 0);
  const split = seriesNames(result.rows).length > 0;

  useEffect(() => {
    const node = container.current;
    if (
      !node ||
      chartType === 'kpi' ||
      dataset.columns.length > 0 ||
      typeof document === 'undefined'
    ) {
      return;
    }
    let chart: Chart | null = null;
    const render = () => {
      const compact = node.clientHeight < 220 || node.clientWidth < 320;
      chart?.destroy();
      chart = new Chart({ container: node, autoFit: true });
      chart.options(
        chartSpec(
          chartType,
          chartData(result.rows, split),
          split,
          legendLabel(dataset),
          compact,
        ),
      );
      void chart.render();
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart?.destroy();
    };
  }, [chartType, dataset, result, split]);

  return (
    <div className="flex h-full flex-col">
      {dataset.columns.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                {dataset.columns.map((column, index) => (
                  <th
                    key={index}
                    className="sticky top-0 bg-white px-2 py-1.5 font-medium"
                  >
                    {headers?.find((header) => header.field === column.field)
                      ?.label ?? column.field}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.detail.map((row, index) => (
                <tr key={index} className="border-b border-zinc-100">
                  {row.cells.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-2 py-1.5">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : chartType === 'kpi' ? (
        <div className="flex h-full min-h-16 items-center justify-center">
          <div className="text-[clamp(1rem,6cqh,2.25rem)] font-semibold leading-none tracking-tight">
            {numberFormat.format(total)}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1" ref={container} />
      )}
    </div>
  );
}
