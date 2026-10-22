import { useMemo, useState } from 'react';
import { formatRate } from '@/features/supplier/aggregate';
import type { SupplierPortrait } from '@/features/supplier/portrait';
import {
  formatDays,
  formatRatioChange,
  formatScore,
  formatWan,
  ratingLabel,
  scoreSuppliers,
} from '@/features/supplier/scorecard';
import {
  DEFAULT_SCORE_WEIGHTS,
  type ScoreWeights,
} from '@/features/supplier/supplierTargets';

const stickyHead =
  'sticky top-0 z-10 border-b border-zinc-200 bg-white px-2 py-1.5 text-left font-medium dark:border-zinc-800 dark:bg-zinc-900';

const DEFAULT_PERCENT: ScoreWeights = {
  timeliness: DEFAULT_SCORE_WEIGHTS.timeliness * 100,
  quality: DEFAULT_SCORE_WEIGHTS.quality * 100,
  scale: DEFAULT_SCORE_WEIGHTS.scale * 100,
  agility: DEFAULT_SCORE_WEIGHTS.agility * 100,
};

const WEIGHT_FIELDS: Array<{ key: keyof ScoreWeights; label: string }> = [
  { key: 'timeliness', label: '及时率权重' },
  { key: 'quality', label: '合格率权重' },
  { key: 'scale', label: '规模权重' },
  { key: 'agility', label: '敏捷权重' },
];

function ratingClass(rating: string | null): string {
  if (rating === 'A') {
    return 'bg-emerald-500 text-white';
  }
  if (rating === 'B') {
    return 'bg-sky-500 text-white';
  }
  if (rating === 'C') {
    return 'bg-amber-500 text-white';
  }
  return 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';
}

export function ScorecardPanel({
  portraits,
  ready,
  loading,
}: {
  portraits: SupplierPortrait[];
  ready: boolean;
  loading: boolean;
}) {
  const [percent, setPercent] = useState<ScoreWeights>(DEFAULT_PERCENT);
  const weights = useMemo(
    () => ({
      timeliness: percent.timeliness / 100,
      quality: percent.quality / 100,
      scale: percent.scale / 100,
      agility: percent.agility / 100,
    }),
    [percent],
  );
  const rows = useMemo(
    () => scoreSuppliers(portraits, weights),
    [portraits, weights],
  );
  const total =
    percent.timeliness + percent.quality + percent.scale + percent.agility;

  return (
    <section id="supplier-scorecard" className="mt-8 scroll-mt-24">
      <h2 className="mb-2 text-lg font-medium">供应商综合评分卡</h2>
      <p className="mb-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        综合评分 = 到货及时率 × 及时率权重 + 来料合格率 × 合格率权重 +
        供货规模分 × 规模权重 + 交付敏捷分 × 敏捷权重。评级 A ≥ 85 优秀，B 75–85
        良好，C {'<'} 75 待改进。
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {WEIGHT_FIELDS.map((field) => (
          <label key={field.key} className="text-xs text-zinc-500">
            {field.label}
            <input
              aria-label={field.label}
              type="number"
              min={0}
              max={100}
              step={1}
              className="mt-1 block h-9 w-24 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              value={percent[field.key]}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPercent((current) => ({
                  ...current,
                  [field.key]: Number.isFinite(next) ? next : 0,
                }));
              }}
            />
          </label>
        ))}
        <p className="pb-2 text-xs text-zinc-500">
          合计 {Number.isFinite(total) ? total : 0}%
          {Math.abs(total - 100) > 0.01 ? '，评分时按比例归一' : ''}
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-zinc-500">正在汇总供应商指标…</p>
      ) : !ready ? (
        <p className="text-sm text-zinc-500">
          连接金蝶后，这里按及时率、合格率、金额和交付天数计算评分。
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">当前筛选下没有供应商。</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th className={stickyHead}>供应商</th>
                <th className={`${stickyHead} text-right`}>入库金额（万元）</th>
                <th className={`${stickyHead} text-right`}>入库单量</th>
                <th className={`${stickyHead} text-right`}>到货及时率</th>
                <th className={`${stickyHead} text-right`}>来料合格率</th>
                <th className={`${stickyHead} text-right`}>平均交付（天）</th>
                <th className={`${stickyHead} text-right`}>综合评分</th>
                <th className={stickyHead}>评级</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const change = formatRatioChange(row.amountChange);
                return (
                  <tr
                    key={row.supplier}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-2 py-2">
                      <div>{row.supplier}</div>
                      {row.category ? (
                        <div className="text-xs text-zinc-500">
                          品类 {row.category}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatWan(row.instockAmount)}
                      {change ? (
                        <span
                          className={
                            (row.amountChange ?? 0) < 0
                              ? 'ml-1 text-red-600'
                              : 'ml-1 text-emerald-600'
                          }
                        >
                          {change}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.instockOrderCount == null
                        ? '—'
                        : row.instockOrderCount}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatRate(row.timeliness)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatRate(row.quality)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatDays(row.deliveryDays)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">
                      {formatScore(row.score)}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${ratingClass(row.rating)}`}
                      >
                        {row.rating ?? '—'} {ratingLabel(row.rating)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
