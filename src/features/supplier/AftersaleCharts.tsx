import { useEffect, useRef } from 'react';
import { Chart } from '@antv/g2';
import { chartTheme } from '@/features/analysis/chartTheme';
import type { NamedValue } from '@/features/supplier/aftersaleQuality';

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

const GRADIENTS = [
  ['#93C5FD', '#2563EB'],
  ['#5EEAD4', '#0F766E'],
  ['#FDBA74', '#EA580C'],
  ['#C4B5FD', '#7C3AED'],
  ['#86EFAC', '#16A34A'],
  ['#FDA4AF', '#E11D48'],
  ['#FDE047', '#CA8A04'],
  ['#67E8F9', '#0891B2'],
  ['#F9A8D4', '#DB2777'],
  ['#A5B4FC', '#4F46E5'],
  ['#BEF264', '#65A30D'],
  ['#FCD34D', '#D97706'],
] as const;

export function seriesGradient(index: number, kind: 'pie' | 'bar'): string {
  const [from, to] = GRADIENTS[index % GRADIENTS.length] ?? GRADIENTS[0];
  const angle = kind === 'bar' ? 0 : 90;
  return `l(${angle}) 0:${from} 1:${to}`;
}

function seriesColor(index: number): string {
  return GRADIENTS[index % GRADIENTS.length]?.[1] ?? '#2563EB';
}

function fillByName(points: NamedValue[], kind: 'pie' | 'bar') {
  const indexByName = new Map(
    points.map((point, index) => [point.name, index]),
  );
  return (datum: { name?: string }, index: number) => {
    const found = datum?.name ? indexByName.get(datum.name) : undefined;
    return seriesGradient(found ?? index, kind);
  };
}

function seriesLabel(
  title: string,
  points: NamedValue[],
  digits: number,
): string {
  const body = points
    .map((point) => `${point.name} ${point.value.toFixed(digits)}`)
    .join('、');
  return `${title}：${body}`;
}

export function FactoryPayPie({ slices }: { slices: NamedValue[] }) {
  return (
    <QualityChart
      label={seriesLabel('工厂赔付金额', slices, 2)}
      points={slices}
      kind="pie"
    />
  );
}

export function ComplaintBars({ items }: { items: NamedValue[] }) {
  return (
    <QualityChart
      label={seriesLabel('客诉事件', items, 0)}
      points={items}
      kind="bar"
    />
  );
}

function QualityChart({
  label,
  points,
  kind,
}: {
  label: string;
  points: NamedValue[];
  kind: 'pie' | 'bar';
}) {
  const container = useRef<HTMLDivElement>(null);
  const signature = points
    .map((point) => `${point.name}:${point.value}`)
    .join('|');

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
      chart.options(kind === 'pie' ? pieOptions(points) : barOptions(points));
      void chart.render();
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart?.destroy();
    };
  }, [kind, points, signature]);

  return (
    <div
      ref={container}
      className="h-full min-h-0 w-full flex-1"
      role="img"
      aria-label={label}
    />
  );
}

function pieOptions(points: NamedValue[]): Record<string, unknown> {
  return {
    type: 'interval',
    theme: chartTheme(isDark()),
    data: points,
    coordinate: { type: 'theta', outerRadius: 0.8 },
    transform: [{ type: 'stackY' }],
    encode: { y: 'value', color: 'name' },
    scale: {
      color: {
        domain: points.map((point) => point.name),
        range: points.map((_, index) => seriesColor(index)),
      },
    },
    style: { fill: fillByName(points, 'pie') },
    legend: { color: { position: 'bottom' } },
    axis: false,
    tooltip: {
      title: 'name',
      items: [{ field: 'value', name: '工厂赔付金额' }],
    },
  };
}

function barOptions(points: NamedValue[]): Record<string, unknown> {
  return {
    type: 'interval',
    theme: chartTheme(isDark()),
    data: points,
    coordinate: { transform: [{ type: 'transpose' }] },
    encode: { x: 'name', y: 'value', color: 'name' },
    scale: {
      x: { domain: points.map((point) => point.name) },
      color: {
        domain: points.map((point) => point.name),
        range: points.map((_, index) => seriesColor(index)),
      },
    },
    style: { radius: 6, fill: fillByName(points, 'bar') },
    axis: { x: { title: false }, y: { title: false } },
    legend: false,
    tooltip: {
      title: 'name',
      items: [{ field: 'value', name: '客诉事件（个）' }],
    },
  };
}
