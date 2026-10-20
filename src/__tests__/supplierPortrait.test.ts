import { describe, expect, it } from 'vitest';
import type { InspectLine } from '@/features/supplier/aggregate';
import { buildPortraits } from '@/features/supplier/portrait';
import type {
  ArrivalReceipt,
  PurchaseLine,
} from '@/features/supplier/timeliness';

function line(overrides: Partial<PurchaseLine> = {}): PurchaseLine {
  return {
    supplier: '甲供',
    billNo: 'PO-1',
    entryId: 'E1',
    materialNumber: 'M-1',
    materialName: '螺丝',
    orderQty: 10,
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
    date: '2026-10-01',
    qty: 10,
    ...overrides,
  };
}

const inspect: InspectLine[] = [
  {
    supplier: '甲供',
    materialNumber: 'M-1',
    materialName: '螺丝',
    month: '2026-10',
    qualifiedQty: 9,
    arrivalQty: 10,
    remark: '',
  },
];

describe('buildPortraits', () => {
  it('aggregates rates, amounts, lead time, instock, and price from real lines', () => {
    const portraits = buildPortraits({
      inspect,
      lines: [
        line({
          billNo: 'PO-SEP',
          entryId: 'E-sep',
          deliveryDate: '2026-09-20',
          orderDate: '2026-09-18',
          amount: 80_000,
        }),
        line({
          billNo: 'PO-OCT',
          entryId: 'E-oct',
          deliveryDate: '2026-10-01',
          orderDate: '2026-09-25',
          amount: 100_000,
        }),
        line({
          supplier: '乙供',
          billNo: 'PO-LATE',
          entryId: 'E-late',
          materialName: '垫片',
          orderQty: 4,
          deliveryDate: '2026-10-02',
          amount: 20_000,
        }),
      ],
      receipts: [
        receipt({
          entryId: 'E-sep',
          billNo: 'PO-SEP',
          date: '2026-09-20',
        }),
        receipt({
          entryId: 'E-oct',
          billNo: 'PO-OCT',
          date: '2026-10-01',
        }),
      ],
      instock: [
        receipt({
          entryId: 'E-oct',
          billNo: 'RK-1',
          date: '2026-10-05',
          amount: 826_000,
        }),
        receipt({
          entryId: 'E-oct',
          billNo: 'RK-OLD',
          date: '2025-10-05',
          amount: 400_000,
        }),
      ],
      months: ['2026-09', '2026-10'],
      today: '2026-10-20',
      graceDays: 0,
    });

    const jia = portraits.find((row) => row.supplier === '甲供');
    const yi = portraits.find((row) => row.supplier === '乙供');
    expect(jia).toMatchObject({
      category: '螺丝',
      timeliness: 1,
      quality: 0.9,
      purchaseAmount: 180_000,
      instockAmount: 826_000,
      previousInstockAmount: 400_000,
      purchaseOrderCount: 2,
      instockOrderCount: 1,
      deliveryDays: 4,
      overdueLines: 0,
      priceChange: 0.25,
    });
    expect(yi).toMatchObject({
      category: '垫片',
      timeliness: 0,
      quality: null,
      purchaseAmount: 20_000,
      overdueLines: 1,
      overdueQty: 4,
      overdueAmount: 20_000,
      purchaseOrderCount: 1,
    });
  });

  it('leaves amount and lead time empty when those fields were not loaded', () => {
    const [row] = buildPortraits({
      inspect: [],
      lines: [line()],
      receipts: [receipt()],
      instock: [],
      months: ['2026-10'],
      today: '2026-10-20',
      graceDays: 0,
    });
    expect(row).toMatchObject({
      purchaseAmount: null,
      instockAmount: null,
      instockOrderCount: null,
      deliveryDays: null,
      priceChange: null,
      timeliness: 1,
    });
  });
});
