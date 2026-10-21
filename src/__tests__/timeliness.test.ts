import {
  evaluateTimeliness,
  type ArrivalReceipt,
  type PurchaseLine,
} from '@/features/supplier/timeliness';

const today = '2026-10-18';

function line(overrides: Partial<PurchaseLine> = {}): PurchaseLine {
  return {
    supplier: '甲供',
    billNo: 'PO-1',
    entryId: 'E1',
    materialNumber: 'M-1',
    materialName: '螺丝',
    orderQty: 100,
    deliveryDate: '2026-10-01',
    excluded: false,
    ...overrides,
  };
}

function receipt(overrides: Partial<ArrivalReceipt> = {}): ArrivalReceipt {
  return {
    entryId: 'E1',
    billNo: 'PO-1',
    materialNumber: 'M-1',
    date: '2026-09-28',
    qty: 40,
    ...overrides,
  };
}

describe('evaluateTimeliness', () => {
  const lines: PurchaseLine[] = [
    line(),
    line({
      billNo: 'PO-2',
      entryId: 'E2',
      materialNumber: 'M-2',
      materialName: '螺母',
      orderQty: 10,
      deliveryDate: '2026-10-10',
    }),
    line({
      supplier: '乙供',
      billNo: 'PO-X',
      entryId: 'EX',
      materialNumber: 'M-X',
      materialName: '关闭件',
      orderQty: 8,
      deliveryDate: '2026-10-02',
      excluded: true,
    }),
    line({
      supplier: '乙供',
      billNo: 'PO-3',
      entryId: 'E3',
      materialNumber: 'M-3',
      materialName: '今日应交',
      orderQty: 5,
      deliveryDate: '2026-10-18',
    }),
    line({
      supplier: '乙供',
      billNo: 'PO-4',
      entryId: 'E4',
      materialNumber: 'M-4',
      materialName: '昨日未到',
      orderQty: 6,
      deliveryDate: '2026-10-17',
    }),
    line({
      supplier: '甲供',
      billNo: 'PO-9',
      entryId: 'E9',
      materialNumber: 'M-9',
      materialName: '上月',
      orderQty: 2,
      deliveryDate: '2026-09-15',
    }),
  ];
  const receipts: ArrivalReceipt[] = [
    receipt(),
    receipt({ date: '2026-10-05', qty: 30 }),
    receipt({ date: '2026-10-20', qty: 15 }),
    receipt({
      entryId: 'E2',
      billNo: 'PO-2',
      materialNumber: 'M-2',
      date: '2026-10-12',
      qty: 10,
    }),
  ];

  it('splits receipts, ignores future arrivals, and weights the rate by quantity', () => {
    const result = evaluateTimeliness({
      lines,
      receipts,
      graceDays: 0,
      today,
      months: ['2026-09', '2026-10'],
    });

    expect(result.excludedQty).toBe(8);
    const jia = result.suppliers.find((row) => row.supplier === '甲供');
    expect(jia).toMatchObject({
      dueQty: 112,
      onTimeQty: 40,
      lateQty: 40,
      pendingQty: 0,
      overdueQty: 32,
      undeliveredQty: 32,
      averageDelayDays: (4 * 30 + 2 * 10 + 17 * 30 + 33 * 2) / 72,
    });
    expect(jia?.rate).toBeCloseTo(40 / 112);
    expect(result.suppliers.map((row) => row.supplier)).toEqual([
      '甲供',
      '乙供',
    ]);

    const october = result.monthRates.find((row) => row.supplier === '甲供');
    expect(october?.months).toEqual([
      { month: '2026-09', rate: 0 },
      { month: '2026-10', rate: 40 / 110 },
    ]);

    expect(
      result.details.map((row) => [
        row.billNo,
        row.actualDate,
        row.lateQty,
        row.pendingQty,
        row.overdueQty,
        row.delayDays,
      ]),
    ).toEqual([
      ['PO-9', '', 0, 0, 2, 33],
      ['PO-1', '', 0, 0, 30, 17],
      ['PO-1', '2026-10-05', 30, 0, 0, 4],
      ['PO-2', '2026-10-12', 10, 0, 0, 2],
      ['PO-4', '', 0, 0, 6, 1],
      ['PO-3', '', 0, 5, 0, null],
      ['PO-1', '2026-09-28', 0, 0, 0, null],
    ]);

    expect(
      result.overdue.map((row) => [row.billNo, row.overdueQty, row.delayDays]),
    ).toEqual([
      ['PO-9', 2, 33],
      ['PO-1', 30, 17],
      ['PO-4', 6, 1],
    ]);
    expect(result.lateBars.map((row) => row.name)).toEqual(['甲供', '乙供']);
    expect(result.lateBars[0]).toMatchObject({
      lateQty: 40,
      pendingQty: 0,
      overdueQty: 32,
    });
    expect(
      result.monthBars.find((row) => row.month === '2026-10'),
    ).toMatchObject({
      onTimeQty: 40,
      lateQty: 40,
      pendingQty: 5,
      overdueQty: 36,
      undeliveredQty: 41,
    });
  });

  it('counts a receipt past the grace window as late and an open shortfall past it as overdue', () => {
    const result = evaluateTimeliness({
      lines: [line({ orderQty: 10 })],
      receipts: [receipt({ date: '2026-10-03', qty: 10 })],
      graceDays: 2,
      today,
    });
    expect(result.suppliers[0]).toMatchObject({
      onTimeQty: 10,
      lateQty: 0,
      pendingQty: 0,
      overdueQty: 0,
      averageDelayDays: null,
      rate: 1,
    });

    const late = evaluateTimeliness({
      lines: [line({ orderQty: 10 })],
      receipts: [receipt({ date: '2026-10-03', qty: 10 })],
      graceDays: 1,
      today,
    });
    expect(late.suppliers[0]).toMatchObject({
      onTimeQty: 0,
      lateQty: 10,
      averageDelayDays: 2,
    });

    const open = evaluateTimeliness({
      lines: [line({ orderQty: 10 })],
      receipts: [],
      graceDays: 2,
      today,
    });
    expect(open.suppliers[0]).toMatchObject({
      onTimeQty: 0,
      lateQty: 0,
      pendingQty: 0,
      overdueQty: 10,
      averageDelayDays: 17,
    });
    expect(open.overdue).toEqual([
      expect.objectContaining({ overdueQty: 10, delayDays: 17 }),
    ]);
  });

  it('caps allocated quantity at the order quantity and matches by entry id', () => {
    const result = evaluateTimeliness({
      lines: [
        line({ orderQty: 10 }),
        line({
          billNo: 'PO-1',
          entryId: 'E2',
          materialNumber: 'M-1',
          materialName: '螺丝',
          orderQty: 4,
          deliveryDate: '2026-10-01',
        }),
      ],
      receipts: [
        receipt({ qty: 15, date: '2026-09-28' }),
        receipt({
          entryId: '',
          billNo: 'PO-1',
          materialNumber: 'M-1',
          qty: 4,
          date: '2026-10-09',
        }),
      ],
      graceDays: 0,
      today,
    });
    const first = result.details.filter((row) => row.entryId === 'E1');
    expect(first).toEqual([
      expect.objectContaining({ onTimeQty: 10, lateQty: 0, undeliveredQty: 0 }),
    ]);
    const second = result.details.filter((row) => row.entryId === 'E2');
    expect(second).toEqual([
      expect.objectContaining({ overdueQty: 4, onTimeQty: 0, lateQty: 0 }),
    ]);
  });

  it('falls back to bill number and material when the line has no entry id', () => {
    const result = evaluateTimeliness({
      lines: [line({ entryId: '', orderQty: 5 })],
      receipts: [receipt({ entryId: '', date: '2026-10-01', qty: 5 })],
      graceDays: 0,
      today,
    });
    expect(result.suppliers[0]).toMatchObject({
      onTimeQty: 5,
      overdueQty: 0,
    });
  });

  it('limits excluded quantity, details, and charts to the selected supplier and month', () => {
    const result = evaluateTimeliness({
      lines,
      receipts,
      graceDays: 0,
      today,
      supplier: '乙供',
      month: '2026-10',
      months: ['2026-10'],
    });
    expect(result.excludedQty).toBe(8);
    expect(result.suppliers.map((row) => row.supplier)).toEqual(['乙供']);
    expect(result.details.every((row) => row.supplier === '乙供')).toBe(true);
    expect(result.monthBars.map((row) => row.month)).toEqual(['2026-10']);
  });

  it('uses zero grace when the input is blank or negative', () => {
    const result = evaluateTimeliness({
      lines: [line({ orderQty: 1 })],
      receipts: [receipt({ date: '2026-10-02', qty: 1 })],
      graceDays: Number.NaN,
      today,
    });
    expect(result.suppliers[0]?.lateQty).toBe(1);
  });
});
