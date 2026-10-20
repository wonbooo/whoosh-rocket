import { describe, expect, it } from 'vitest';
import {
  buildQuadrant,
  formatAxisRate,
  pointsInOrderRange,
  shortSupplierName,
} from '@/features/supplier/quadrant';
import type { SupplierPortrait } from '@/features/supplier/portrait';

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
    purchaseOrderCount: 1,
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

describe('buildQuadrant', () => {
  const portraits = [
    portrait({
      supplier: '大而及时',
      timeliness: 0.96,
      quality: 0.5,
      purchaseAmount: 8_000_000,
      purchaseOrderCount: 12,
    }),
    portrait({
      supplier: '大而延误',
      timeliness: 0.8,
      quality: 0.99,
      purchaseAmount: 6_000_000,
      purchaseOrderCount: 4,
    }),
    portrait({
      supplier: '小而延误',
      timeliness: 0.7,
      quality: 0.99,
      purchaseAmount: 1_000_000,
      purchaseOrderCount: 2,
    }),
    portrait({
      supplier: '没有金额',
      timeliness: 0.99,
      purchaseAmount: null,
      purchaseOrderCount: 3,
    }),
  ];

  it('places suppliers by timeliness and mean amount, and names only real points', () => {
    const model = buildQuadrant(portraits, 'timeliness');
    expect(model.target).toBe(90);
    expect(model.meanAmount).toBeCloseTo(500);
    expect(model.points.map((point) => [point.supplier, point.zone])).toEqual([
      ['大而及时', 'scale-good'],
      ['大而延误', 'scale-improve'],
      ['小而延误', 'watch'],
    ]);
    expect(model.summary).toBe(
      '右上（规模大且及时）有大而及时；左上（规模大但需改善）有大而延误；左下纳入考察的有小而延误。',
    );
    expect(model.summary).not.toContain('华康蛋白');
    expect(shortSupplierName('大而及时供应商')).toBe('大而及时...');
    expect(formatAxisRate(96)).toBe('96.00');
    expect(formatAxisRate(96.666)).toBe('96.67');
    expect(
      pointsInOrderRange(model.points, 4, 12).map((point) => point.supplier),
    ).toEqual(['大而及时', '大而延误']);
  });

  it('switches the horizontal axis to the quality rate', () => {
    const model = buildQuadrant(portraits, 'quality');
    expect(
      model.points.find((point) => point.supplier === '大而及时')?.zone,
    ).toBe('scale-improve');
    expect(
      model.points.find((point) => point.supplier === '大而延误')?.zone,
    ).toBe('scale-good');
    expect(model.summary).toContain('规模大且合格');
  });

  it('returns an empty model when amount or the selected rate is missing', () => {
    const model = buildQuadrant(
      [portrait({ supplier: '甲供', timeliness: 1, purchaseAmount: null })],
      'timeliness',
    );
    expect(model.points).toEqual([]);
    expect(model.summary).toBe('');
    expect(model.meanAmount).toBeNull();
  });
});
