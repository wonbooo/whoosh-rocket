import { useEffect, useRef } from 'react';
import { Chart } from '@antv/g2';
import { chartTheme } from '@/features/analysis/chartTheme';
import {
  formatQty,
  type LateBar,
  type MonthBar,
} from '@/features/supplier/timeliness';

interface StackPoint {
  name: string;
  series: string;
  value: number;
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

const LATE_SERIES = ['延迟数量', '未到数量'] as const;
const MONTH_SERIES = ['及时数量', '延迟数量', '未到数量'] as const;
const SERIES_COLOR: Record<string, string> = {
  及时数量: '#16A34A',
  延迟数量: '#EA580C',
  未到数量: '#E11D48',
};

function lateChartLabel(bars: LateBar[]): string {
  const body = bars
    .map(
      (bar) =>
        `${bar.name} 延迟 ${formatQty(bar.lateQty)}、未到 ${formatQty(bar.undeliveredQty)}`,
    )
    .join('、');
  return `延迟与未到：${body}`;
}

function monthChartLabel(bars: MonthBar[]): string {
  const body = bars
    .map(
      (bar) =>
        `${bar.month} 及时 ${formatQty(bar.onTimeQty)}、延迟 ${formatQty(bar.lateQty)}、未到 ${formatQty(bar.undeliveredQty)}`,
    )
    .join('、');
  return `月度到货结构：${body}`;
}

function latePoints(bars: LateBar[]): StackPoint[] {
  return bars.flatMap((bar) =>
    LATE_SERIES.map((series) => ({
      name: bar.name,
      series,
      value: series === '延迟数量' ? bar.lateQty : bar.undeliveredQty,
    })),
  );
}

function monthPoints(bars: MonthBar[]): StackPoint[] {
  return bars.flatMap((bar) =>
    MONTH_SERIES.map((series) => ({
      name: bar.month,
      series,
      value:
        series === '及时数量'
          ? bar.onTimeQty
          : series === '延迟数量'
            ? bar.lateQty
            : bar.undeliveredQty,
    })),
  );
}

export function LateArrivalChart({ bars }: { bars: LateBar[] }) {
  const names = bars.map((bar) => bar.name);
  return (
    <StackChart
      label={lateChartLabel(bars)}
      points={latePoints(bars)}
      names={names.slice().reverse()}
      series={[...LATE_SERIES]}
      horizontal
    />
  );
}

export function MonthArrivalChart({ bars }: { bars: MonthBar[] }) {
  return (
    <StackChart
      label={monthChartLabel(bars)}
      points={monthPoints(bars)}
      names={bars.map((bar) => bar.month)}
      series={[...MONTH_SERIES]}
      horizontal={false}
    />
  );
}

function StackChart({
  label,
  points,
  names,
  series,
  horizontal,
}: {
  label: string;
  points: StackPoint[];
  names: string[];
  series: string[];
  horizontal: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const pointsRef = useRef(points);
  const namesRef = useRef(names);
  const seriesRef = useRef(series);
  pointsRef.current = points;
  namesRef.current = names;
  seriesRef.current = series;
  const signature = points
    .map((point) => `${point.name}:${point.series}:${point.value}`)
    .join('|');

  useEffect(() => {
    const node = container.current;
    const currentPoints = pointsRef.current;
    if (!node || currentPoints.length === 0) {
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
      chart = null;
      try {
        const currentNames = namesRef.current;
        const currentSeries = seriesRef.current;
        chart = new Chart({ container: node, autoFit: true });
        chart.options({
          type: 'interval',
          theme: chartTheme(isDark()),
          data: pointsRef.current,
          ...(horizontal
            ? { coordinate: { transform: [{ type: 'transpose' }] } }
            : {}),
          transform: [{ type: 'stackY' }],
          encode: { x: 'name', y: 'value', color: 'series' },
          scale: {
            x: { domain: currentNames },
            color: {
              domain: currentSeries,
              range: currentSeries.map(
                (item) => SERIES_COLOR[item] ?? '#2563EB',
              ),
            },
          },
          axis: { x: { title: false }, y: { title: false } },
          legend: { color: { position: 'bottom' } },
          tooltip: { title: 'name' },
        });
        void Promise.resolve(chart.render()).catch(() => {
          chart?.destroy();
          chart = null;
        });
      } catch {
        chart?.destroy();
        chart = null;
      }
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart?.destroy();
    };
  }, [horizontal, signature]);

  return (
    <div
      ref={container}
      className="h-full min-h-0 w-full flex-1"
      role="img"
      aria-label={label}
    />
  );
}
