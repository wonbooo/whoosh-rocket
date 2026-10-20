import type { SupplierPortrait } from '@/features/supplier/portrait';
import { RATE_TARGET } from '@/features/supplier/supplierTargets';

export type RateAxis = 'timeliness' | 'quality';
export type QuadrantZone = 'scale-good' | 'scale-improve' | 'watch' | 'steady';

export interface QuadrantPoint {
  supplier: string;
  shortName: string;
  rate: number;
  amountWan: number;
  orderCount: number;
  zone: QuadrantZone;
}

export interface QuadrantModel {
  points: QuadrantPoint[];
  target: number;
  meanAmount: number | null;
  summary: string;
}

export function formatAxisRate(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  return value.toFixed(2);
}

export function pointsInOrderRange(
  points: QuadrantPoint[],
  min: number,
  max: number,
): QuadrantPoint[] {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return points.filter(
    (point) => point.orderCount >= low && point.orderCount <= high,
  );
}

export function shortSupplierName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= 4) {
    return name;
  }
  return `${chars.slice(0, 4).join('')}...`;
}

function rateOf(portrait: SupplierPortrait, axis: RateAxis): number | null {
  return axis === 'timeliness' ? portrait.timeliness : portrait.quality;
}

function zoneOf(rate: number, amountWan: number, mean: number): QuadrantZone {
  const onTime = rate >= RATE_TARGET * 100;
  const large = amountWan >= mean;
  if (onTime && large) {
    return 'scale-good';
  }
  if (!onTime && large) {
    return 'scale-improve';
  }
  if (!onTime && !large) {
    return 'watch';
  }
  return 'steady';
}

function listNames(points: QuadrantPoint[], zone: QuadrantZone): string {
  const names = points
    .filter((point) => point.zone === zone)
    .map((point) => point.supplier);
  if (names.length === 0) {
    return '';
  }
  if (names.length <= 3) {
    return names.join('、');
  }
  return `${names.slice(0, 3).join('、')}等${names.length}家`;
}

export function quadrantSummary(
  points: QuadrantPoint[],
  axis: RateAxis,
): string {
  if (points.length === 0) {
    return '';
  }
  const word = axis === 'timeliness' ? '及时' : '合格';
  const good = listNames(points, 'scale-good');
  const improve = listNames(points, 'scale-improve');
  const watch = listNames(points, 'watch');
  const parts = [
    good
      ? `右上（规模大且${word}）有${good}`
      : `右上（规模大且${word}）暂无供应商`,
    improve
      ? `左上（规模大但需改善）有${improve}`
      : `左上（规模大但需改善）暂无供应商`,
    watch ? `左下纳入考察的有${watch}` : `左下暂无需要纳入考察的供应商`,
  ];
  return `${parts.join('；')}。`;
}

export function buildQuadrant(
  portraits: SupplierPortrait[],
  axis: RateAxis,
): QuadrantModel {
  const drafts = portraits.flatMap((portrait) => {
    const rate = rateOf(portrait, axis);
    const orders = portrait.purchaseOrderCount;
    if (
      rate == null ||
      portrait.purchaseAmount == null ||
      orders == null ||
      !(orders > 0)
    ) {
      return [];
    }
    return [
      {
        supplier: portrait.supplier,
        shortName: shortSupplierName(portrait.supplier),
        rate: rate * 100,
        amountWan: portrait.purchaseAmount / 10000,
        orderCount: orders,
      },
    ];
  });
  const meanAmount =
    drafts.length === 0
      ? null
      : drafts.reduce((sum, point) => sum + point.amountWan, 0) / drafts.length;
  const points: QuadrantPoint[] = drafts.map((point) => ({
    ...point,
    zone: zoneOf(point.rate, point.amountWan, meanAmount ?? 0),
  }));
  points.sort((left, right) =>
    left.supplier.localeCompare(right.supplier, 'zh'),
  );
  return {
    points,
    target: RATE_TARGET * 100,
    meanAmount,
    summary: quadrantSummary(points, axis),
  };
}
