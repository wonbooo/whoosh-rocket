import { describe, expect, it } from 'vitest';
import type { SupplierPortrait } from '@/features/supplier/portrait';
import {
  agilityScore,
  formatRatioChange,
  normalizeWeights,
  ratingOf,
  scaleScore,
  scoreSuppliers,
  weightsFromPercent,
} from '@/features/supplier/scorecard';
import { DEFAULT_SCORE_WEIGHTS } from '@/features/supplier/supplierTargets';

function portrait(
  overrides: Partial<SupplierPortrait> & { supplier: string },
): SupplierPortrait {
  return {
    category: null,
    timeliness: null,
    quality: null,
    purchaseAmount: null,
    instockAmount: null,
    previousInstockAmount: null,
    purchaseOrderCount: null,
    instockOrderCount: null,
    deliveryDays: null,
    overdueLines: 0,
    overdueQty: 0,
    overdueAmount: null,
    monthTimeliness: [],
    priceChange: null,
    ...overrides,
  };
}

describe('score weights and components', () => {
  it('gives full agility at 3 days and zero at 15 days', () => {
    expect(agilityScore(3)).toBe(100);
    expect(agilityScore(1)).toBe(100);
    expect(agilityScore(15)).toBe(0);
    expect(agilityScore(20)).toBe(0);
    expect(agilityScore(9)).toBeCloseTo(50);
    expect(agilityScore(null)).toBeNull();
  });

  it('normalizes amount against the largest supplier', () => {
    expect(scaleScore(50, 100)).toBe(50);
    expect(scaleScore(null, 100)).toBeNull();
    expect(scaleScore(10, 0)).toBeNull();
    expect(scaleScore(150, 100)).toBe(100);
  });

  it('renormalizes weights that do not add up to 100%', () => {
    const weights = weightsFromPercent({
      timeliness: 30,
      quality: 30,
      scale: 25,
      agility: 15,
    });
    expect(weights.timeliness).toBeCloseTo(DEFAULT_SCORE_WEIGHTS.timeliness);
    expect(weights.quality).toBeCloseTo(DEFAULT_SCORE_WEIGHTS.quality);
    expect(weights.scale).toBeCloseTo(DEFAULT_SCORE_WEIGHTS.scale);
    expect(weights.agility).toBeCloseTo(DEFAULT_SCORE_WEIGHTS.agility);
    expect(
      normalizeWeights({ timeliness: 1, quality: 1, scale: 1, agility: 1 }),
    ).toEqual({
      timeliness: 0.25,
      quality: 0.25,
      scale: 0.25,
      agility: 0.25,
    });
    expect(
      normalizeWeights({ timeliness: 0, quality: 0, scale: 0, agility: 0 }),
    ).toEqual(DEFAULT_SCORE_WEIGHTS);
  });

  it('rates A at 85, B from 75, and C below 75', () => {
    expect(ratingOf(85)).toBe('A');
    expect(ratingOf(84.9)).toBe('B');
    expect(ratingOf(75)).toBe('B');
    expect(ratingOf(74.9)).toBe('C');
    expect(ratingOf(null)).toBeNull();
  });
});

describe('scoreSuppliers', () => {
  it('combines the four default weights and sorts by score', () => {
    const rows = scoreSuppliers([
      portrait({
        supplier: '乙供',
        timeliness: 0.8,
        quality: 0.8,
        instockAmount: 100,
        deliveryDays: 15,
      }),
      portrait({
        supplier: '甲供',
        timeliness: 1,
        quality: 1,
        instockAmount: 200,
        deliveryDays: 3,
      }),
    ]);
    expect(rows.map((row) => row.supplier)).toEqual(['甲供', '乙供']);
    expect(rows[0]).toMatchObject({
      score: 100,
      rating: 'A',
      scaleBasis: 'instock',
    });
    expect(rows[1]?.score).toBeCloseTo(60.5);
    expect(rows[1]?.rating).toBe('C');
  });

  it('drops missing metrics and renormalizes the remaining weights', () => {
    const [row] = scoreSuppliers([
      portrait({
        supplier: '甲供',
        timeliness: 0.9,
        quality: null,
        instockAmount: null,
        purchaseAmount: null,
        deliveryDays: null,
      }),
    ]);
    expect(row?.score).toBeCloseTo(90);
    expect(row?.scaleBasis).toBe('none');
    expect(row?.rating).toBe('A');
  });

  it('uses purchase amount for scale when instock amount is missing', () => {
    const rows = scoreSuppliers([
      portrait({
        supplier: '甲供',
        timeliness: null,
        quality: null,
        purchaseAmount: 100,
        deliveryDays: null,
      }),
      portrait({
        supplier: '乙供',
        timeliness: null,
        quality: null,
        purchaseAmount: 50,
        deliveryDays: null,
      }),
    ]);
    expect(rows.find((row) => row.supplier === '甲供')).toMatchObject({
      score: 100,
      scaleBasis: 'purchase',
      instockAmount: null,
    });
    expect(rows.find((row) => row.supplier === '乙供')?.score).toBeCloseTo(50);
  });

  it('leaves the score empty when every metric is missing', () => {
    const [row] = scoreSuppliers([portrait({ supplier: '甲供' })]);
    expect(row?.score).toBeNull();
    expect(row?.rating).toBeNull();
  });

  it('formats a year-over-year change only when both instock amounts exist', () => {
    const [row] = scoreSuppliers([
      portrait({
        supplier: '甲供',
        quality: 1,
        instockAmount: 106,
        previousInstockAmount: 100,
      }),
    ]);
    expect(row?.amountChange).toBeCloseTo(0.06);
    expect(formatRatioChange(row?.amountChange ?? null)).toBe('+6.0%');
    expect(formatRatioChange(-0.024)).toBe('-2.4%');
    expect(formatRatioChange(null)).toBeNull();
  });
});
