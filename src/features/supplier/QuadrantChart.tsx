import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from '@antv/g2';
import { chartTheme } from '@/features/analysis/chartTheme';
import {
  formatAxisRate,
  pointsInOrderRange,
  type QuadrantPoint,
} from '@/features/supplier/quadrant';

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function QuadrantChart({
  points,
  target,
  meanAmount,
  xLabel,
}: {
  points: QuadrantPoint[];
  target: number;
  meanAmount: number;
  xLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const signature = points
    .map(
      (point) =>
        `${point.supplier}:${point.rate}:${point.amountWan}:${point.orderCount}`,
    )
    .join('|');
  const [orderMin, orderMax] = useMemo(() => {
    const counts = points.map((point) => point.orderCount);
    return [Math.min(...counts), Math.max(...counts)] as const;
  }, [signature, points]);
  const [orderRange, setOrderRange] = useState<[number, number]>([
    orderMin,
    orderMax,
  ]);
  useEffect(() => {
    setOrderRange([orderMin, orderMax]);
  }, [orderMax, orderMin]);
  const visible = pointsInOrderRange(points, orderRange[0], orderRange[1]);
  const visibleKey = visible.map((point) => point.supplier).join('|');

  useEffect(() => {
    const node = container.current;
    if (!node || points.length === 0) {
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
      const rates = points.map((point) => point.rate);
      const amounts = points.map((point) => point.amountWan);
      const counts = points.map((point) => point.orderCount);
      const xMin = Math.min(target, ...rates) - 2;
      const xMax = Math.max(100, target, ...rates) + 1;
      const yMax = Math.max(meanAmount, ...amounts, 1) * 1.2;
      chart.options({
        type: 'view',
        theme: chartTheme(isDark()),
        scale: {
          x: { domain: [xMin, xMax], nice: false },
          y: { domain: [0, yMax], nice: false },
          size: {
            domain: [Math.min(...counts), Math.max(...counts)],
            range: [12, 48],
          },
        },
        axis: {
          x: {
            title: xLabel,
            labelFormatter: (value: number) => formatAxisRate(Number(value)),
          },
          y: { title: '采购金额（万元）' },
        },
        legend: { size: false },
        interaction: { legendFilter: false },
        children: [
          {
            type: 'line',
            data: [
              { rate: target, amountWan: 0 },
              { rate: target, amountWan: yMax },
            ],
            encode: { x: 'rate', y: 'amountWan' },
            style: { stroke: '#64748b', lineDash: [4, 4], lineWidth: 1 },
            tooltip: false,
          },
          {
            type: 'line',
            data: [
              { rate: xMin, amountWan: meanAmount },
              { rate: xMax, amountWan: meanAmount },
            ],
            encode: { x: 'rate', y: 'amountWan' },
            style: { stroke: '#64748b', lineDash: [4, 4], lineWidth: 1 },
            tooltip: false,
          },
          {
            type: 'point',
            data: visible.map((point) => ({
              ...point,
              rateText: formatAxisRate(point.rate),
            })),
            encode: {
              x: 'rate',
              y: 'amountWan',
              size: 'orderCount',
              shape: 'point',
            },
            legend: false,
            style: {
              fill: '#3B82F6',
              fillOpacity: 0.86,
              stroke: '#1D4ED8',
              lineWidth: 1,
            },
            labels: [
              {
                text: 'shortName',
                position: 'top',
                style: { fontSize: 11, dy: -6 },
              },
            ],
            tooltip: {
              title: 'supplier',
              items: [
                { field: 'rateText', name: xLabel },
                { field: 'amountWan', name: '采购金额（万元）' },
                { field: 'orderCount', name: '采购单量' },
              ],
            },
          },
        ],
      });
      void chart.render();
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart?.destroy();
    };
  }, [meanAmount, points, signature, target, visibleKey, xLabel]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {orderMax > orderMin ? (
        <div
          className="mb-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span>采购单量</span>
          <input
            type="range"
            aria-label="采购单量下限"
            min={orderMin}
            max={orderMax}
            step={1}
            value={orderRange[0]}
            onChange={(event) => {
              const next = Number(event.target.value);
              setOrderRange(([, high]) => [Math.min(next, high), high]);
            }}
          />
          <input
            type="range"
            aria-label="采购单量上限"
            min={orderMin}
            max={orderMax}
            step={1}
            value={orderRange[1]}
            onChange={(event) => {
              const next = Number(event.target.value);
              setOrderRange(([low]) => [low, Math.max(next, low)]);
            }}
          />
          <span className="tabular-nums">
            {orderRange[0]}–{orderRange[1]}
          </span>
        </div>
      ) : null}
      <div
        ref={container}
        className="min-h-0 w-full flex-1"
        role="img"
        aria-label={`${xLabel}、采购金额和单量气泡图`}
      />
    </div>
  );
}
