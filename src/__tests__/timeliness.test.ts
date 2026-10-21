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
    receivedQty: 0,
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
    line({ receivedQty: 100 }),
    line({
      billNo: 'PO-2',
      entryId: 'E2',
      materialNumber: 'M-2',
      materialName: '螺母',
      orderQty: 10,
      deliveryDate: '2026-10-10',
      receivedQty: 6,
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
      receivedQty: 8,
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

  it('counts a fully received line as on time and an open shortfall by the grace deadline', () => {
    const result = evaluateTimeliness({
      lines,
      receipts: [],
      graceDays: 0,
      today,
      months: ['2026-09', '2026-10'],
    });

    const jia = result.suppliers.find((row) => row.supplier === '甲供');
    expect(jia).toMatchObject({
      dueQty: 112,
      onTimeQty: 100,
      lateQty: 0,
      pendingQty: 0,
      overdueQty: 6,
      undeliveredQty: 6,
      averageDelayDays: (33 * 2 + 8 * 4) / 6,
    });
    expect(jia?.rate).toBeCloseTo(100 / 112);
    expect(result.suppliers.map((row) => row.supplier)).toEqual([
      '乙供',
      '甲供',
    ]);

    const october = result.monthRates.find((row) => row.supplier === '甲供');
    expect(october?.months).toEqual([
      { month: '2026-09', rate: 0 },
      { month: '2026-10', rate: 100 / 110 },
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
      ['PO-2', '', 0, 0, 4, 8],
      ['PO-4', '', 0, 0, 6, 1],
      ['PO-3', '', 0, 5, 0, null],
      ['PO-1', '', 0, 0, 0, null],
      ['PO-X', '', 0, 0, 0, null],
    ]);

    expect(
      result.overdue.map((row) => [row.billNo, row.overdueQty, row.delayDays]),
    ).toEqual([
      ['PO-9', 2, 33],
      ['PO-2', 4, 8],
      ['PO-4', 6, 1],
    ]);
    expect(result.lateBars.map((row) => row.name)).toEqual(['乙供', '甲供']);
    expect(result.lateBars[1]).toMatchObject({
      lateQty: 0,
      pendingQty: 0,
      overdueQty: 6,
    });
    expect(
      result.monthBars.find((row) => row.month === '2026-10'),
    ).toMatchObject({
      onTimeQty: 108,
      lateQty: 0,
      pendingQty: 5,
      overdueQty: 10,
      undeliveredQty: 15,
    });
  });

  it('treats a shortfall inside the grace window as still pending', () => {
    const open = evaluateTimeliness({
      lines: [line({ orderQty: 10, receivedQty: 4 })],
      receipts: [],
      graceDays: 2,
      today: '2026-10-03',
    });
    expect(open.suppliers[0]).toMatchObject({
      onTimeQty: 0,
      lateQty: 0,
      pendingQty: 6,
      overdueQty: 0,
      averageDelayDays: null,
      rate: 0,
    });

    const overdue = evaluateTimeliness({
      lines: [line({ orderQty: 10, receivedQty: 4 })],
      receipts: [],
      graceDays: 1,
      today: '2026-10-03',
    });
    expect(overdue.suppliers[0]).toMatchObject({
      onTimeQty: 0,
      pendingQty: 0,
      overdueQty: 6,
      averageDelayDays: 2,
    });
    expect(overdue.overdue).toEqual([
      expect.objectContaining({ overdueQty: 6, delayDays: 2 }),
    ]);
  });

  it('caps received quantity at the order quantity', () => {
    const result = evaluateTimeliness({
      lines: [line({ orderQty: 10, receivedQty: 15 })],
      receipts: [],
      graceDays: 0,
      today,
    });
    expect(result.suppliers[0]).toMatchObject({
      dueQty: 10,
      onTimeQty: 10,
      overdueQty: 0,
      rate: 1,
    });
  });

  it('counts nothing received when the order line has no received quantity', () => {
    const result = evaluateTimeliness({
      lines: [line({ orderQty: 5 })],
      receipts: [],
      graceDays: 0,
      today,
    });
    expect(result.suppliers[0]).toMatchObject({
      onTimeQty: 0,
      overdueQty: 5,
    });
  });

  it('limits details and charts to the selected supplier and month', () => {
    const result = evaluateTimeliness({
      lines,
      receipts: [],
      graceDays: 0,
      today,
      supplier: '乙供',
      month: '2026-10',
      months: ['2026-10'],
    });
    expect(result.suppliers.map((row) => row.supplier)).toEqual(['乙供']);
    expect(result.details.every((row) => row.supplier === '乙供')).toBe(true);
    expect(result.monthBars.map((row) => row.month)).toEqual(['2026-10']);
  });

  it('uses zero grace when the input is blank or negative', () => {
    const result = evaluateTimeliness({
      lines: [line({ orderQty: 1, receivedQty: 0 })],
      receipts: [],
      graceDays: Number.NaN,
      today: '2026-10-02',
    });
    expect(result.suppliers[0]?.overdueQty).toBe(1);
  });
});
