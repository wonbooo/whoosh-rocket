import {
  formatRate,
  monthOverallRate,
  productDetails,
  queryRange,
  recentMonths,
  summarizeReasons,
  supplierMonthRates,
  type InspectLine,
} from '@/features/supplier/aggregate';

function line(overrides: Partial<InspectLine> = {}): InspectLine {
  return {
    supplier: '甲供',
    materialNumber: 'M-1',
    materialName: '螺丝',
    month: '2026-10',
    qualifiedQty: 1,
    arrivalQty: 1,
    remark: '',
    ...overrides,
  };
}

describe('recent months', () => {
  it('lists six calendar months oldest first, including the current month', () => {
    expect(recentMonths(new Date(2026, 9, 18))).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });

  it('crosses the year boundary', () => {
    expect(recentMonths(new Date(2026, 0, 15))).toEqual([
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('uses the first day of the oldest month and the first day of the next month', () => {
    expect(queryRange(new Date(2026, 9, 18))).toEqual({
      dateFrom: '2026-05-01',
      dateTo: '2026-11-01',
    });
    expect(queryRange(new Date(2026, 0, 15))).toEqual({
      dateFrom: '2025-08-01',
      dateTo: '2026-02-01',
    });
  });
});

describe('supplier monthly rates', () => {
  const months = ['2026-09', '2026-10'];

  it('sums qualified over arrival per supplier and month, sorted by Chinese name', () => {
    const rates = supplierMonthRates(
      [
        line({
          supplier: '乙供',
          month: '2026-10',
          qualifiedQty: 1,
          arrivalQty: 2,
        }),
        line({
          supplier: '甲供',
          month: '2026-10',
          qualifiedQty: 90,
          arrivalQty: 100,
        }),
        line({
          supplier: '甲供',
          month: '2026-10',
          qualifiedQty: 107,
          arrivalQty: 100,
        }),
        line({
          supplier: '甲供',
          month: '2026-09',
          qualifiedQty: 3,
          arrivalQty: 4,
        }),
      ],
      months,
    );

    expect(rates.map((item) => item.supplier)).toEqual(['甲供', '乙供']);
    expect(rates[0]?.months).toEqual([
      { month: '2026-09', rate: 0.75 },
      { month: '2026-10', rate: 197 / 200 },
    ]);
    expect(rates[1]?.months).toEqual([
      { month: '2026-09', rate: null },
      { month: '2026-10', rate: 0.5 },
    ]);
  });

  it('returns null when the arrival sum is zero', () => {
    const rates = supplierMonthRates(
      [
        line({
          month: '2026-10',
          qualifiedQty: 5,
          arrivalQty: 0,
        }),
      ],
      months,
    );

    expect(rates[0]?.months[1]?.rate).toBeNull();
    expect(rates[0]?.months[1]?.rate).not.toBe(0);
  });
});

describe('product details', () => {
  it('sums one row per material and leaves the rate null when arrival is zero', () => {
    const rows = productDetails(
      [
        line({
          materialNumber: 'M-2',
          materialName: '',
          qualifiedQty: 1,
          arrivalQty: 0,
          remark: '包装漏气',
        }),
        line({
          materialNumber: 'M-2',
          materialName: '包装袋',
          qualifiedQty: 0,
          arrivalQty: 0,
          remark: '包装漏气，重量不足',
        }),
        line({
          materialNumber: 'M-1',
          materialName: '螺丝',
          qualifiedQty: 8,
          arrivalQty: 10,
          remark: '重量不足',
        }),
        line({
          supplier: '乙供',
          materialNumber: 'M-9',
          materialName: '不应出现',
          qualifiedQty: 1,
          arrivalQty: 1,
        }),
        line({
          month: '2026-09',
          materialNumber: 'M-8',
          materialName: '不应出现',
        }),
      ],
      '甲供',
      '2026-10',
    );

    expect(rows).toEqual([
      {
        supplier: '甲供',
        month: '2026-10',
        materialNumber: 'M-2',
        materialName: '包装袋',
        qualifiedQty: 1,
        arrivalQty: 0,
        rate: null,
        reasonSummary: '',
      },
      {
        supplier: '甲供',
        month: '2026-10',
        materialNumber: 'M-1',
        materialName: '螺丝',
        qualifiedQty: 8,
        arrivalQty: 10,
        rate: 0.8,
        reasonSummary: '重量不足共计2件',
      },
    ]);
  });

  it('lists every supplier and month when the filters are empty', () => {
    const rows = productDetails(
      [
        line({ materialNumber: 'M-1', materialName: '螺丝' }),
        line({
          supplier: '乙供',
          materialNumber: 'M-9',
          materialName: '垫片',
        }),
        line({
          month: '2026-09',
          materialNumber: 'M-8',
          materialName: '纸箱',
        }),
      ],
      '',
      '',
    );

    expect(
      rows.map((row) => [row.supplier, row.month, row.materialName]),
    ).toEqual([
      ['甲供', '2026-09', '纸箱'],
      ['甲供', '2026-10', '螺丝'],
      ['乙供', '2026-10', '垫片'],
    ]);
  });
});

describe('overall rate', () => {
  it('divides every supplier in that month and ignores other months', () => {
    const rate = monthOverallRate(
      [
        line({
          supplier: '甲供',
          month: '2026-10',
          qualifiedQty: 10,
          arrivalQty: 20,
        }),
        line({
          supplier: '乙供',
          month: '2026-10',
          qualifiedQty: 30,
          arrivalQty: 50,
        }),
        line({
          supplier: '丙供',
          month: '2026-09',
          qualifiedQty: 100,
          arrivalQty: 100,
        }),
      ],
      '2026-10',
    );

    expect(rate).toBe(40 / 70);
  });

  it('uses only the selected supplier when one is given', () => {
    const lines = [
      line({
        supplier: '甲供',
        month: '2026-05',
        qualifiedQty: 390,
        arrivalQty: 393,
      }),
      line({
        supplier: '甲供',
        month: '2026-05',
        qualifiedQty: 590,
        arrivalQty: 590,
      }),
      line({
        supplier: '乙供',
        month: '2026-05',
        qualifiedQty: 1000,
        arrivalQty: 1000,
      }),
    ];

    expect(monthOverallRate(lines, '2026-05', '甲供')).toBe(980 / 983);
    expect(monthOverallRate(lines, '2026-05')).toBe(1980 / 1983);
  });

  it('returns null when that month has no arrival', () => {
    expect(
      monthOverallRate(
        [line({ month: '2026-10', qualifiedQty: 4, arrivalQty: 0 })],
        '2026-10',
      ),
    ).toBeNull();
  });
});

describe('remark summary', () => {
  it('keeps the remark text intact and sums unqualified qty for identical text', () => {
    expect(
      summarizeReasons([
        { remark: '内盒变形，实际日期4.26', unqualifiedQty: 1 },
        { remark: '内盒变形，实际日期4.26', unqualifiedQty: 2 },
        { remark: '纸箱3', unqualifiedQty: 3 },
        { remark: '纸箱5', unqualifiedQty: 5 },
        { remark: '外观良好', unqualifiedQty: 0 },
      ]),
    ).toBe('内盒变形，实际日期4.26共计3件，纸箱3共计3件，纸箱5共计5件');
  });

  it('returns an empty string when nothing remains', () => {
    expect(summarizeReasons([])).toBe('');
    expect(
      summarizeReasons([
        { remark: '', unqualifiedQty: 3 },
        { remark: '   ', unqualifiedQty: 1 },
        { remark: '纸箱1', unqualifiedQty: 0 },
      ]),
    ).toBe('');
  });
});

describe('formatRate', () => {
  it('prints a percent with two decimals', () => {
    expect(formatRate(0.985)).toBe('98.50%');
    expect(formatRate(0)).toBe('0.00%');
    expect(formatRate(1)).toBe('100.00%');
    expect(formatRate(99997 / 100000)).toBe('99.99%');
  });

  it('prints a dash when the rate is null', () => {
    expect(formatRate(null)).toBe('—');
  });
});
