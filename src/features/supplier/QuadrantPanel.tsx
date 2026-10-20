import { useMemo, useState } from 'react';
import type { LayoutItem } from 'react-grid-layout';
import { buildQuadrant, type RateAxis } from '@/features/supplier/quadrant';
import { QuadrantChart } from '@/features/supplier/QuadrantChart';
import { DashboardGrid } from '@/features/supplier/DashboardGrid';
import type { SupplierPortrait } from '@/features/supplier/portrait';
import { RATE_TARGET } from '@/features/supplier/supplierTargets';

const LAYOUT_KEY = 'supplier-quadrant-layout';
const WIDGETS = [{ id: 'matrix', title: '四象限矩阵' }] as const;
const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'matrix', x: 0, y: 0, w: 12, h: 16, minW: 4, minH: 8 },
];

export function QuadrantPanel({
  portraits,
  ready,
  loading,
}: {
  portraits: SupplierPortrait[];
  ready: boolean;
  loading: boolean;
}) {
  const [axis, setAxis] = useState<RateAxis>('timeliness');
  const model = useMemo(
    () => buildQuadrant(portraits, axis),
    [axis, portraits],
  );
  const xLabel = axis === 'timeliness' ? '及时率' : '合格率';

  return (
    <section id="supplier-quadrant" className="mt-8 scroll-mt-24">
      <h2 className="mb-3 text-lg font-medium">供应商四象限矩阵</h2>
      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          正在汇总供应商指标…
        </p>
      ) : !ready ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          连接金蝶后，这里按真实供应商的及时率或合格率、采购金额和单量绘制。
        </p>
      ) : portraits.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          当前筛选下没有供应商。
        </p>
      ) : model.points.length === 0 || model.meanAmount == null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          当前供应商没有同时具备{xLabel}
          和采购金额，无法落点。采购金额取采购订单分录的价税合计；元数据里没有该字段时这里保持空白。
        </p>
      ) : (
        <DashboardGrid
          storageKey={LAYOUT_KEY}
          widgets={[...WIDGETS]}
          defaultLayout={DEFAULT_LAYOUT}
          render={() =>
            model.meanAmount == null ? null : (
              <MatrixCard
                axis={axis}
                xLabel={xLabel}
                points={model.points}
                target={model.target}
                meanAmount={model.meanAmount}
                summary={model.summary}
                onAxis={setAxis}
              />
            )
          }
        />
      )}
    </section>
  );
}

function MatrixCard({
  axis,
  xLabel,
  points,
  target,
  meanAmount,
  summary,
  onAxis,
}: {
  axis: RateAxis;
  xLabel: string;
  points: ReturnType<typeof buildQuadrant>['points'];
  target: number;
  meanAmount: number;
  summary: string;
  onAxis: (axis: RateAxis) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="mb-2 flex flex-wrap items-center justify-between gap-3"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          X 为{xLabel}，Y
          为所选期间采购金额（万元），气泡大小为采购单量。竖线是目标{' '}
          {RATE_TARGET * 100}%，横线是金额均值。
        </p>
        <div className="flex rounded-lg border border-zinc-200 p-0.5 text-sm dark:border-zinc-700">
          {(
            [
              ['timeliness', '及时率'],
              ['quality', '合格率'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={axis === value}
              className={
                axis === value
                  ? 'rounded-md bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'rounded-md px-3 py-1 text-zinc-600 dark:text-zinc-300'
              }
              onClick={() => onAxis(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <QuadrantChart
        points={points}
        target={target}
        meanAmount={meanAmount}
        xLabel={xLabel}
      />
      <p className="mt-3 shrink-0 text-sm text-zinc-600 dark:text-zinc-300">
        {summary}
      </p>
    </div>
  );
}
