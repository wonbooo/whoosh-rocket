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
    closed: false,
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
      materialName: '冻结件',
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

  it('splits receipts into on-time and late quantities and ignores future arrivals', () => {
    const result = evaluateTimeliness({
      lines,
      receipts,
      graceDays: 0,
      today,
      months: ['2026-09', '2026-10'],
    });

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

    const yi = result.suppliers.find((row) => row.supplier === '乙供');
    expect(yi).toMatchObject({
      dueQty: 19,
      onTimeQty: 0,
      lateQty: 0,
      pendingQty: 5,
      overdueQty: 14,
      undeliveredQty: 19,
      rate: 0,
    });

    expect(result.details).toHaveLength(8);
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          billNo: 'PO-1',
          actualDate: '2026-09-28',
          onTimeQty: 40,
          lateQty: 0,
          pendingQty: 0,
          overdueQty: 0,
        }),
        expect.objectContaining({
          billNo: 'PO-1',
          actualDate: '2026-10-05',
          onTimeQty: 0,
          lateQty: 30,
          pendingQty: 0,
          overdueQty: 0,
        }),
        expect.objectContaining({
          billNo: 'PO-1',
          actualDate: '',
          onTimeQty: 0,
          lateQty: 0,
          pendingQty: 0,
          overdueQty: 30,
        }),
        expect.objectContaining({
          billNo: 'PO-2',
          actualDate: '2026-10-12',
          onTimeQty: 0,
          lateQty: 10,
          pendingQty: 0,
          overdueQty: 0,
        }),
        expect.objectContaining({
          billNo: 'PO-3',
          actualDate: '',
          pendingQty: 5,
          overdueQty: 0,
        }),
        expect.objectContaining({
          billNo: 'PO-4',
          actualDate: '',
          pendingQty: 0,
          overdueQty: 6,
        }),
        expect.objectContaining({
          billNo: 'PO-9',
          actualDate: '',
          pendingQty: 0,
          overdueQty: 2,
        }),
        expect.objectContaining({
          billNo: 'PO-X',
          actualDate: '',
          pendingQty: 0,
          overdueQty: 8,
        }),
      ]),
    );

    expect(
      result.overdue.map((row) => [row.billNo, row.overdueQty, row.delayDays]),
    ).toEqual([
      ['PO-9', 2, 33],
      ['PO-1', 30, 17],
      ['PO-X', 8, 16],
      ['PO-4', 6, 1],
    ]);
    expect(result.lateBars.find((row) => row.name === '甲供')).toMatchObject({
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
      overdueQty: 44,
      undeliveredQty: 49,
    });
  });

  it('uses the grace window for on-time receipts and overdue shortfalls', () => {
    const onTime = evaluateTimeliness({
      lines: [line({ orderQty: 10 })],
      receipts: [receipt({ date: '2026-10-03', qty: 10 })],
      graceDays: 2,
      today,
    });
    expect(onTime.suppliers[0]).toMatchObject({
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

  it('caps allocated quantity at the order quantity', () => {
    const result = evaluateTimeliness({
      lines: [line({ orderQty: 10 })],
      receipts: [receipt({ qty: 15, date: '2026-09-28' })],
      graceDays: 0,
      today,
    });
    expect(result.suppliers[0]).toMatchObject({
      dueQty: 10,
      onTimeQty: 10,
      lateQty: 0,
      overdueQty: 0,
      rate: 1,
    });
    expect(result.details).toHaveLength(1);
  });

  it('matches by order number and material when the receipt has no entry id', () => {
    const result = evaluateTimeliness({
      lines: [line({ entryId: '', orderQty: 5 })],
      receipts: [receipt({ entryId: '', date: '2026-10-01', qty: 5 })],
      graceDays: 0,
      today,
    });
    expect(result.suppliers[0]).toMatchObject({
      onTimeQty: 5,
      lateQty: 0,
      overdueQty: 0,
    });
  });

  it('omits closed order lines from the overdue list but keeps them in details', () => {
    const result = evaluateTimeliness({
      lines: [
        line({ billNo: 'PO-OPEN', orderQty: 2, deliveryDate: '2026-10-10' }),
        line({
          billNo: 'PO-CLOSED',
          orderQty: 5,
          deliveryDate: '2026-10-09',
          closed: true,
        }),
      ],
      receipts: [],
      graceDays: 0,
      today,
    });

    expect(result.overdue.map((row) => row.billNo)).toEqual(['PO-OPEN']);
    expect(result.details.map((row) => row.billNo).sort()).toEqual([
      'PO-CLOSED',
      'PO-OPEN',
    ]);
  });

  it('limits details and charts to the selected supplier and month', () => {
    const result = evaluateTimeliness({
      lines,
      receipts,
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
      lines: [line({ orderQty: 1 })],
      receipts: [],
      graceDays: Number.NaN,
      today: '2026-10-02',
    });
    expect(result.suppliers[0]?.overdueQty).toBe(1);
  });
});
