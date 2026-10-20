import { describe, expect, it } from 'vitest';
import type { SupplierPortrait } from '@/features/supplier/portrait';
import {
  buildRiskSignals,
  mergeRiskNarratives,
  parseRiskNarratives,
  trailingLowMonths,
} from '@/features/supplier/riskSignals';

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

describe('buildRiskSignals', () => {
  it('counts a trailing run below target and ignores a single low month', () => {
    expect(
      trailingLowMonths([
        { month: '2026-08', rate: 0.5 },
        { month: '2026-09', rate: 0.95 },
        { month: '2026-10', rate: 0.8 },
      ]),
    ).toBe(1);
    expect(
      trailingLowMonths([
        { month: '2026-09', rate: 0.5 },
        { month: '2026-10', rate: 0.4 },
      ]),
    ).toBe(2);
    const signals = buildRiskSignals([
      portrait({
        supplier: '甲供',
        monthTimeliness: [
          { month: '2026-09', rate: 0.8 },
          { month: '2026-10', rate: 0.7 },
        ],
      }),
      portrait({
        supplier: '乙供',
        monthTimeliness: [
          { month: '2026-09', rate: 0.5 },
          { month: '2026-10', rate: 0.95 },
        ],
      }),
    ]);
    expect(signals.map((signal) => signal.id)).toEqual(['delay']);
    expect(signals[0]?.facts).toContain('甲供连续2个月');
    expect(signals[0]?.facts).not.toContain('乙供');
    expect(signals[0]?.facts).not.toContain('汇丰香精');
  });

  it('builds overdue, quality, and price cards from aggregated numbers', () => {
    const signals = buildRiskSignals([
      portrait({
        supplier: '甲供',
        quality: 0.8,
        overdueLines: 2,
        overdueQty: 15,
        overdueAmount: 50_000,
        priceChange: 0.081,
      }),
      portrait({
        supplier: '乙供',
        quality: 0.99,
        priceChange: 0.03,
      }),
    ]);
    expect(signals.map((signal) => signal.id)).toEqual([
      'overdue',
      'quality',
      'price',
    ]);
    expect(signals[0]?.facts).toContain('逾期 2 行');
    expect(signals[0]?.facts).toContain('未到数量 15');
    expect(signals[0]?.facts).toContain('5.0 万元');
    expect(signals[1]?.facts).toContain('甲供来料合格率80.0%');
    expect(signals[1]?.facts).toContain('10.0个百分点');
    expect(signals[1]?.facts).not.toContain('乙供');
    expect(signals[2]?.facts).toContain('上涨8.1%');
    expect(signals[2]?.facts).not.toContain('乙供');
  });

  it('returns no cards when nothing is actually at risk', () => {
    expect(
      buildRiskSignals([
        portrait({
          supplier: '甲供',
          quality: 0.95,
          timeliness: 0.96,
          priceChange: 0.01,
          monthTimeliness: [{ month: '2026-10', rate: 0.96 }],
        }),
      ]),
    ).toEqual([]);
  });
});

describe('FreeLM narrative merge', () => {
  it('keeps rule facts when the model rewrites the wording', () => {
    const signals = buildRiskSignals([
      portrait({
        supplier: '甲供',
        overdueLines: 1,
        overdueQty: 4,
        overdueAmount: 2000,
      }),
    ]);
    const merged = mergeRiskNarratives(signals, [
      {
        id: 'overdue',
        title: '交期已过',
        detail: '甲供仍有未到货，请先催货。',
        action: '今天完成对账。',
      },
      {
        id: 'made-up',
        title: '虚构',
        detail: '不要出现',
        action: '',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      source: 'ai',
      title: '交期已过',
      detail: '甲供仍有未到货，请先催货。',
      action: '今天完成对账。',
    });
    expect(merged[0]?.facts).toBe(signals[0]?.facts);
  });

  it('parses fenced JSON and ignores a broken reply', () => {
    expect(
      parseRiskNarratives(
        '```json\n{"items":[{"id":"quality","title":"质量","detail":"偏低","action":"复检"}]}\n```',
      ),
    ).toEqual([
      { id: 'quality', title: '质量', detail: '偏低', action: '复检' },
    ]);
    expect(parseRiskNarratives('不是 json')).toEqual([]);
  });
});
