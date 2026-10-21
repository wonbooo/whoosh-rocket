import {
  matchSupplier,
  monthInRange,
  type InspectLine,
  type SupplierMatch,
} from '@/features/supplier/aggregate';
import {
  evaluateTimeliness,
  matchesLine,
  type ArrivalReceipt,
  type PurchaseLine,
} from '@/features/supplier/timeliness';

export interface MonthRatePoint {
  month: string;
  rate: number | null;
}

export interface SupplierPortrait {
  supplier: string;
  category: string | null;
  timeliness: number | null;
  quality: number | null;
  purchaseAmount: number | null;
  instockAmount: number | null;
  previousInstockAmount: number | null;
  purchaseOrderCount: number | null;
  instockOrderCount: number | null;
  deliveryDays: number | null;
  overdueLines: number;
  overdueQty: number;
  overdueAmount: number | null;
  monthTimeliness: MonthRatePoint[];
  priceChange: number | null;
}

const DAY = 86_400_000;

function parseDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}

function daysBetween(from: string, to: string): number | null {
  const start = parseDay(from);
  const end = parseDay(to);
  if (start == null || end == null) {
    return null;
  }
  return Math.round((end - start) / DAY);
}

function monthOf(value: string): string | null {
  const match = /^(\d{4}-\d{2})-\d{2}/.exec(value.trim());
  return match?.[1] ?? null;
}

function shiftYear(month: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return null;
  }
  return `${Number(match[1]) - 1}-${match[2]}`;
}

function amountOf(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function sumAmounts(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value != null);
  if (known.length === 0) {
    return null;
  }
  return known.reduce((sum, value) => sum + value, 0);
}

function topName(pairs: Array<{ name: string; qty: number }>): string | null {
  const totals = new Map<string, number>();
  for (const pair of pairs) {
    const name = pair.name.trim();
    if (!name || !(pair.qty > 0)) {
      continue;
    }
    totals.set(name, (totals.get(name) ?? 0) + pair.qty);
  }
  const ranked = [...totals.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0], 'zh');
  });
  return ranked[0]?.[0] ?? null;
}

function priceChangeFor(lines: PurchaseLine[]): number | null {
  const byMonth = new Map<string, { amount: number; qty: number }>();
  for (const line of lines) {
    if (line.excluded || !(line.orderQty > 0)) {
      continue;
    }
    const amount = amountOf(line.amount);
    const month = monthOf(line.deliveryDate);
    if (amount == null || !month) {
      continue;
    }
    const current = byMonth.get(month) ?? { amount: 0, qty: 0 };
    current.amount += amount;
    current.qty += line.orderQty;
    byMonth.set(month, current);
  }
  const months = [...byMonth.keys()].sort();
  if (months.length < 2) {
    return null;
  }
  const latestMonth = months[months.length - 1] ?? '';
  const latest = byMonth.get(latestMonth);
  if (!latest || !(latest.qty > 0)) {
    return null;
  }
  let earlierAmount = 0;
  let earlierQty = 0;
  for (const month of months.slice(0, -1)) {
    const row = byMonth.get(month);
    if (!row) {
      continue;
    }
    earlierAmount += row.amount;
    earlierQty += row.qty;
  }
  if (!(earlierQty > 0) || earlierAmount === 0) {
    return null;
  }
  const latestUnit = latest.amount / latest.qty;
  const earlierUnit = earlierAmount / earlierQty;
  return (latestUnit - earlierUnit) / earlierUnit;
}

function leadDays(
  lines: PurchaseLine[],
  receipts: ArrivalReceipt[],
  today: string,
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const line of lines) {
    const orderDate = line.orderDate?.trim() ?? '';
    if (line.excluded || !orderDate || !(line.orderQty > 0)) {
      continue;
    }
    let remaining = line.orderQty;
    const matched = receipts
      .filter(
        (receipt) =>
          receipt.qty > 0 &&
          receipt.date <= today &&
          matchesLine(line, receipt),
      )
      .sort((left, right) => left.date.localeCompare(right.date));
    for (const receipt of matched) {
      const take = Math.min(receipt.qty, remaining);
      if (!(take > 0)) {
        continue;
      }
      const days = daysBetween(orderDate, receipt.date);
      if (days == null || days < 0) {
        remaining -= take;
        continue;
      }
      weighted += days * take;
      weight += take;
      remaining -= take;
    }
  }
  if (!(weight > 0)) {
    return null;
  }
  return weighted / weight;
}

export function buildPortraits(input: {
  inspect: InspectLine[];
  lines: PurchaseLine[];
  receipts: ArrivalReceipt[];
  instock: ArrivalReceipt[];
  monthFrom?: string;
  monthTo?: string;
  months: string[];
  today: string;
  graceDays: number;
  supplier?: string;
  supplierOp?: SupplierMatch;
}): SupplierPortrait[] {
  const monthFrom = input.monthFrom ?? '';
  const monthTo = input.monthTo ?? '';
  const supplier = input.supplier ?? '';
  const supplierOp = input.supplierOp ?? 'eq';
  const period = input.months.filter((month) =>
    monthInRange(month, monthFrom, monthTo),
  );
  const periodSet = new Set(period);
  const previousSet = new Set(
    period.flatMap((month) => {
      const shifted = shiftYear(month);
      return shifted ? [shifted] : [];
    }),
  );
  const inSupplier = (name: string) =>
    matchSupplier(name, supplier, supplierOp);
  const purchase = input.lines.filter((line) => inSupplier(line.supplier));
  const scoped = purchase.filter((line) => {
    const month = monthOf(line.deliveryDate);
    return month != null && periodSet.has(month);
  });
  const inspect = input.inspect.filter((line) => {
    return inSupplier(line.supplier) && periodSet.has(line.month);
  });
  const evaluation = evaluateTimeliness({
    lines: scoped,
    receipts: input.receipts,
    graceDays: input.graceDays,
    today: input.today,
    months: period,
  });
  const supplierOfEntry = new Map<string, string>();
  for (const line of purchase) {
    if (line.entryId && line.supplier) {
      supplierOfEntry.set(line.entryId, line.supplier);
    }
  }
  const names = new Set<string>();
  for (const line of scoped) {
    if (line.supplier) {
      names.add(line.supplier);
    }
  }
  for (const line of inspect) {
    if (line.supplier) {
      names.add(line.supplier);
    }
  }
  const instockKnown = input.instock.length > 0;
  const portraits = [...names].map((name) => {
    const ownLines = scoped.filter((line) => line.supplier === name);
    const activeLines = ownLines.filter((line) => !line.excluded);
    const ownInspect = inspect.filter((line) => line.supplier === name);
    const qualified = ownInspect.reduce(
      (sum, line) => sum + line.qualifiedQty,
      0,
    );
    const arrival = ownInspect.reduce((sum, line) => sum + line.arrivalQty, 0);
    const timed = evaluation.suppliers.find((row) => row.supplier === name);
    const monthRow = evaluation.monthRates.find((row) => row.supplier === name);
    const purchaseAmount = sumAmounts(
      activeLines.map((line) => amountOf(line.amount)),
    );
    const bills = new Set(
      activeLines
        .filter((line) => line.orderQty > 0 && line.billNo)
        .map((line) => line.billNo),
    );
    const ownInstock = input.instock.filter((receipt) => {
      const owner = receipt.entryId ? supplierOfEntry.get(receipt.entryId) : '';
      const month = monthOf(receipt.date);
      return owner === name && month != null && periodSet.has(month);
    });
    const previousInstock = input.instock.filter((receipt) => {
      const owner = receipt.entryId ? supplierOfEntry.get(receipt.entryId) : '';
      const month = monthOf(receipt.date);
      return owner === name && month != null && previousSet.has(month);
    });
    const instockBills = new Set(
      ownInstock
        .filter((receipt) => receipt.billNo)
        .map((receipt) => receipt.billNo),
    );
    const overdue = evaluation.overdue.filter((row) => row.supplier === name);
    let overdueAmount = 0;
    let overdueComplete = overdue.length > 0;
    for (const row of overdue) {
      const line = ownLines.find(
        (item) =>
          item.billNo === row.billNo &&
          item.materialNumber === row.materialNumber &&
          item.deliveryDate === row.deliveryDate,
      );
      const amount = amountOf(line?.amount);
      if (amount == null || !(line && line.orderQty > 0)) {
        overdueComplete = false;
        continue;
      }
      overdueAmount += amount * (row.undeliveredQty / line.orderQty);
    }
    return {
      supplier: name,
      category: topName([
        ...activeLines.map((line) => ({
          name: line.materialName,
          qty: line.orderQty,
        })),
        ...ownInspect.map((line) => ({
          name: line.materialName,
          qty: line.arrivalQty,
        })),
      ]),
      timeliness: timed?.rate ?? null,
      quality: arrival > 0 ? qualified / arrival : null,
      purchaseAmount,
      instockAmount: sumAmounts(
        ownInstock.map((receipt) => amountOf(receipt.amount)),
      ),
      previousInstockAmount: sumAmounts(
        previousInstock.map((receipt) => amountOf(receipt.amount)),
      ),
      purchaseOrderCount: activeLines.length > 0 ? bills.size : null,
      instockOrderCount: instockKnown ? instockBills.size : null,
      deliveryDays: leadDays(activeLines, input.receipts, input.today),
      overdueLines: overdue.length,
      overdueQty: overdue.reduce((sum, row) => sum + row.undeliveredQty, 0),
      overdueAmount: overdueComplete ? overdueAmount : null,
      monthTimeliness:
        monthRow?.months ??
        period.map((month) => ({
          month,
          rate: null,
        })),
      priceChange: priceChangeFor(activeLines),
    };
  });
  portraits.sort((left, right) =>
    left.supplier.localeCompare(right.supplier, 'zh'),
  );
  return portraits;
}
