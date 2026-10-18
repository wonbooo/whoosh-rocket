import { useEffect, useRef } from 'react';
import { Chart } from '@antv/g2';
import type { G2Spec } from '@antv/g2';
import { chartTheme } from '@/features/analysis/chartTheme';

export interface RatePoint {
  month: string;
  supplier: string;
  rate: number;
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function RateChart({ points }: { points: RatePoint[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) {
      return;
    }

    let chart: Chart | null = null;
    let width = -1;
    let height = -1;

    const render = () => {
      const nextWidth = node.clientWidth;
      const nextHeight = node.clientHeight;
      if (chart && nextWidth === width && nextHeight === height) {
        return;
      }
      width = nextWidth;
      height = nextHeight;
      chart?.destroy();
      chart = new Chart({ container: node, autoFit: true });
      chart.options({
        type: 'interval',
        theme: chartTheme(isDark()),
        data: points,
        encode: { x: 'month', y: 'rate', color: 'supplier' },
        transform: [{ type: 'dodgeX' }],
        scale: { y: { domain: [0, 100], nice: false } },
        axis: {
          x: { title: false },
          y: {
            title: '合格率（%）',
            labelFormatter: (value: unknown) => `${value}%`,
          },
        },
        legend: { color: { position: 'bottom' } },
        tooltip: {
          title: 'month',
          items: [
            { field: 'supplier', name: '供应商' },
            {
              field: 'rate',
              name: '合格率',
              valueFormatter: (value: unknown) =>
                `${Number(value).toFixed(2)}%`,
            },
          ],
        },
      } as G2Spec);
      void chart.render();
    };

    render();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => render());
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      chart?.destroy();
    };
  }, [points]);

  return (
    <div
      ref={container}
      data-testid="supplier-rate-chart"
      className="h-full min-h-40 w-full"
    />
  );
}
