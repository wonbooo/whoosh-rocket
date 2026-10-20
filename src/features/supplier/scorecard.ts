import type { SupplierPortrait } from '@/features/supplier/portrait';
import {
  AGILITY_FAST_DAYS,
  AGILITY_SLOW_DAYS,
  DEFAULT_SCORE_WEIGHTS,
  RATING_A,
  RATING_B,
  type ScoreWeights,
} from '@/features/supplier/supplierTargets';

export type Rating = 'A' | 'B' | 'C';
export type ScaleBasis = 'instock' | 'purchase' | 'none';

export interface ScoreRow {
  supplier: string;
  category: string | null;
  instockAmount: number | null;
  amountChange: number | null;
  instockOrderCount: number | null;
  timeliness: number | null;
  quality: number | null;
  deliveryDays: number | null;
  score: number | null;
  rating: Rating | null;
  scaleBasis: ScaleBasis;
}

export function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const values = [
    weights.timeliness,
    weights.quality,
    weights.scale,
    weights.agility,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return { ...DEFAULT_SCORE_WEIGHTS };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) {
    return { ...DEFAULT_SCORE_WEIGHTS };
  }
  return {
    timeliness: weights.timeliness / sum,
    quality: weights.quality / sum,
    scale: weights.scale / sum,
    agility: weights.agility / sum,
  };
}

export function weightsFromPercent(input: ScoreWeights): ScoreWeights {
  return normalizeWeights({
    timeliness: input.timeliness / 100,
    quality: input.quality / 100,
    scale: input.scale / 100,
    agility: input.agility / 100,
  });
}

export function agilityScore(days: number | null): number | null {
  if (days == null || !Number.isFinite(days)) {
    return null;
  }
  const span = AGILITY_SLOW_DAYS - AGILITY_FAST_DAYS;
  const clamped = Math.min(
    AGILITY_SLOW_DAYS,
    Math.max(AGILITY_FAST_DAYS, days),
  );
  return ((AGILITY_SLOW_DAYS - clamped) / span) * 100;
}

export function scaleScore(
  amount: number | null,
  maxAmount: number | null,
): number | null {
  if (amount == null || maxAmount == null || !(maxAmount > 0)) {
    return null;
  }
  return Math.min(100, Math.max(0, (amount / maxAmount) * 100));
}

export function ratingOf(score: number | null): Rating | null {
  if (score == null || !Number.isFinite(score)) {
    return null;
  }
  if (score >= RATING_A) {
    return 'A';
  }
  if (score >= RATING_B) {
    return 'B';
  }
  return 'C';
}

export function ratingLabel(rating: Rating | null): string {
  if (rating === 'A') {
    return '优秀';
  }
  if (rating === 'B') {
    return '良好';
  }
  if (rating === 'C') {
    return '待改进';
  }
  return '—';
}

export function formatWan(yuan: number | null): string {
  if (yuan == null || !Number.isFinite(yuan)) {
    return '—';
  }
  const wan = yuan / 10000;
  if (Math.abs(wan) >= 100) {
    return wan.toFixed(0);
  }
  return wan.toFixed(1);
}

export function formatRatioChange(ratio: number | null): string | null {
  if (ratio == null || !Number.isFinite(ratio)) {
    return null;
  }
  const text = (ratio * 100).toFixed(1);
  if (ratio > 0) {
    return `+${text}%`;
  }
  return `${text}%`;
}

export function formatDays(days: number | null): string {
  if (days == null || !Number.isFinite(days)) {
    return '—';
  }
  return days.toFixed(1);
}

export function formatScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) {
    return '—';
  }
  return score.toFixed(1);
}

function scaleAmount(portrait: SupplierPortrait): {
  amount: number | null;
  basis: ScaleBasis;
} {
  if (portrait.instockAmount != null) {
    return { amount: portrait.instockAmount, basis: 'instock' };
  }
  if (portrait.purchaseAmount != null) {
    return { amount: portrait.purchaseAmount, basis: 'purchase' };
  }
  return { amount: null, basis: 'none' };
}

function amountChange(portrait: SupplierPortrait): number | null {
  const current = portrait.instockAmount;
  const previous = portrait.previousInstockAmount;
  if (current == null || previous == null || !(previous > 0)) {
    return null;
  }
  return (current - previous) / previous;
}

export function scoreSuppliers(
  portraits: SupplierPortrait[],
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreRow[] {
  const normalized = normalizeWeights(weights);
  const amounts = portraits.map((portrait) => scaleAmount(portrait).amount);
  const known = amounts.filter((amount): amount is number => amount != null);
  const maxAmount = known.length > 0 ? Math.max(...known) : null;
  const rows = portraits.map((portrait) => {
    const scale = scaleAmount(portrait);
    const parts = [
      {
        value: portrait.timeliness == null ? null : portrait.timeliness * 100,
        weight: normalized.timeliness,
      },
      {
        value: portrait.quality == null ? null : portrait.quality * 100,
        weight: normalized.quality,
      },
      {
        value: scaleScore(scale.amount, maxAmount),
        weight: normalized.scale,
      },
      {
        value: agilityScore(portrait.deliveryDays),
        weight: normalized.agility,
      },
    ];
    const usable = parts.filter(
      (part): part is { value: number; weight: number } =>
        part.value != null && part.weight > 0,
    );
    const weightSum = usable.reduce((sum, part) => sum + part.weight, 0);
    const score =
      weightSum > 0
        ? usable.reduce((sum, part) => sum + part.value * part.weight, 0) /
          weightSum
        : null;
    return {
      supplier: portrait.supplier,
      category: portrait.category,
      instockAmount: portrait.instockAmount,
      amountChange: amountChange(portrait),
      instockOrderCount: portrait.instockOrderCount,
      timeliness: portrait.timeliness,
      quality: portrait.quality,
      deliveryDays: portrait.deliveryDays,
      score,
      rating: ratingOf(score),
      scaleBasis: scale.basis,
    };
  });
  rows.sort((left, right) => {
    if (left.score == null && right.score == null) {
      return left.supplier.localeCompare(right.supplier, 'zh');
    }
    if (left.score == null) {
      return 1;
    }
    if (right.score == null) {
      return -1;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.supplier.localeCompare(right.supplier, 'zh');
  });
  return rows;
}
