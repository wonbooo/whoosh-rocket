export interface PurchaseLine {
  supplier: string;
  billNo: string;
  entryId: string;
  materialNumber: string;
  materialName: string;
  orderQty: number;
  deliveryDate: string;
  excluded: boolean;
  amount?: number | null;
  orderDate?: string;
}

export interface ArrivalReceipt {
  entryId: string;
  billNo: string;
  materialNumber: string;
  date: string;
  qty: number;
  amount?: number | null;
}

export interface TimelinessDetail {
  supplier: string;
  billNo: string;
  entryId: string;
  materialNumber: string;
  materialName: string;
  orderQty: number;
  deliveryDate: string;
  month: string;
  actualDate: string;
  onTimeQty: number;
  lateQty: number;
  undeliveredQty: number;
  delayDays: number | null;
}

export interface SupplierTimeliness {
  supplier: string;
  dueQty: number;
  onTimeQty: number;
  lateQty: number;
  undeliveredQty: number;
  rate: number | null;
  averageDelayDays: number | null;
}

export interface MonthRateCell {
  month: string;
  rate: number | null;
}

export interface SupplierMonthRate {
  supplier: string;
  months: MonthRateCell[];
}

export interface LateBar {
  name: string;
  lateQty: number;
  undeliveredQty: number;
}

export interface MonthBar {
  month: string;
  onTimeQty: number;
  lateQty: number;
  undeliveredQty: number;
}

export interface OverdueLine {
  supplier: string;
  billNo: string;
  materialNumber: string;
  materialName: string;
  deliveryDate: string;
  orderQty: number;
  undeliveredQty: number;
}

export interface TimelinessEvaluation {
  excludedQty: number;
  suppliers: SupplierTimeliness[];
  monthRates: SupplierMonthRate[];
  details: TimelinessDetail[];
  overdue: OverdueLine[];
  lateBars: LateBar[];
  monthBars: MonthBar[];
}

const DAY = 86_400_000;

interface AllocatedLine {
  line: PurchaseLine;
  month: string;
  onTimeQty: number;
  lateQty: number;
  undeliveredQty: number;
  delayWeight: number;
  details: TimelinessDetail[];
}

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

function formatUtc(utc: number): string {
  const date = new Date(utc);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string | null {
  const utc = parseDay(value);
  if (utc == null) {
    return null;
  }
  return formatUtc(utc + days * DAY);
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

function graceDaysOf(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function ratio(part: number, total: number): number | null {
  if (total === 0) {
    return null;
  }
  return part / total;
}

function inScope(line: PurchaseLine, supplier: string, month: string): boolean {
  if (supplier && line.supplier !== supplier) {
    return false;
  }
  if (month && monthOf(line.deliveryDate) !== month) {
    return false;
  }
  return monthOf(line.deliveryDate) != null && line.orderQty > 0;
}

function matchingReceipts(
  line: PurchaseLine,
  receipts: ArrivalReceipt[],
  today: string,
): ArrivalReceipt[] {
  return receipts
    .filter((receipt) => {
      if (receipt.qty <= 0 || parseDay(receipt.date) == null) {
        return false;
      }
      if (receipt.date > today) {
        return false;
      }
      if (line.entryId) {
        return receipt.entryId === line.entryId;
      }
      return (
        !receipt.entryId &&
        receipt.billNo === line.billNo &&
        receipt.materialNumber === line.materialNumber
      );
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function allocate(
  line: PurchaseLine,
  receipts: ArrivalReceipt[],
  graceDays: number,
  today: string,
): AllocatedLine | null {
  const month = monthOf(line.deliveryDate);
  const deadline = addDays(line.deliveryDate, graceDays);
  if (!month || !deadline) {
    return null;
  }
  let remaining = line.orderQty;
  let onTimeQty = 0;
  let lateQty = 0;
  let delayWeight = 0;
  const details: TimelinessDetail[] = [];
  for (const receipt of matchingReceipts(line, receipts, today)) {
    const take = Math.min(receipt.qty, remaining);
    if (take <= 0) {
      continue;
    }
    const base = {
      supplier: line.supplier,
      billNo: line.billNo,
      entryId: line.entryId,
      materialNumber: line.materialNumber,
      materialName: line.materialName,
      orderQty: line.orderQty,
      deliveryDate: line.deliveryDate,
      month,
    };
    if (receipt.date <= deadline) {
      onTimeQty += take;
      details.push({
        ...base,
        actualDate: receipt.date,
        onTimeQty: take,
        lateQty: 0,
        undeliveredQty: 0,
        delayDays: null,
      });
    } else {
      const delayDays = daysBetween(line.deliveryDate, receipt.date) ?? 0;
      lateQty += take;
      delayWeight += delayDays * take;
      details.push({
        ...base,
        actualDate: receipt.date,
        onTimeQty: 0,
        lateQty: take,
        undeliveredQty: 0,
        delayDays,
      });
    }
    remaining -= take;
  }
  if (remaining > 0) {
    details.push({
      supplier: line.supplier,
      billNo: line.billNo,
      entryId: line.entryId,
      materialNumber: line.materialNumber,
      materialName: line.materialName,
      orderQty: line.orderQty,
      deliveryDate: line.deliveryDate,
      month,
      actualDate: '',
      onTimeQty: 0,
      lateQty: 0,
      undeliveredQty: remaining,
      delayDays: null,
    });
  }
  return {
    line,
    month,
    onTimeQty,
    lateQty,
    undeliveredQty: remaining,
    delayWeight,
    details,
  };
}

function compareSuppliers(
  left: SupplierTimeliness,
  right: SupplierTimeliness,
): number {
  if (left.lateQty !== right.lateQty) {
    return right.lateQty - left.lateQty;
  }
  if (left.undeliveredQty !== right.undeliveredQty) {
    return right.undeliveredQty - left.undeliveredQty;
  }
  return left.supplier.localeCompare(right.supplier, 'zh');
}

function compareDetails(
  left: TimelinessDetail,
  right: TimelinessDetail,
): number {
  const leftProblem = left.lateQty > 0 || left.undeliveredQty > 0 ? 0 : 1;
  const rightProblem = right.lateQty > 0 || right.undeliveredQty > 0 ? 0 : 1;
  if (leftProblem !== rightProblem) {
    return leftProblem - rightProblem;
  }
  const leftDelay = left.delayDays ?? -1;
  const rightDelay = right.delayDays ?? -1;
  if (leftDelay !== rightDelay) {
    return rightDelay - leftDelay;
  }
  if (left.undeliveredQty !== right.undeliveredQty) {
    return right.undeliveredQty - left.undeliveredQty;
  }
  const bySupplier = left.supplier.localeCompare(right.supplier, 'zh');
  if (bySupplier !== 0) {
    return bySupplier;
  }
  const byBill = left.billNo.localeCompare(right.billNo);
  if (byBill !== 0) {
    return byBill;
  }
  return left.actualDate.localeCompare(right.actualDate);
}

export function formatQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function formatDelay(days: number | null): string {
  if (days == null || !Number.isFinite(days)) {
    return '—';
  }
  return days.toFixed(1);
}

export function evaluateTimeliness(input: {
  lines: PurchaseLine[];
  receipts: ArrivalReceipt[];
  graceDays: number;
  today: string;
  supplier?: string;
  month?: string;
  months?: string[];
}): TimelinessEvaluation {
  const graceDays = graceDaysOf(input.graceDays);
  const supplier = input.supplier ?? '';
  const month = input.month ?? '';
  const scoped = input.lines.filter((line) => inScope(line, supplier, month));
  const excludedQty = scoped
    .filter((line) => line.excluded)
    .reduce((sum, line) => sum + line.orderQty, 0);
  const allocated = scoped
    .filter((line) => !line.excluded)
    .flatMap((line) => {
      const row = allocate(line, input.receipts, graceDays, input.today);
      return row ? [row] : [];
    });

  const bySupplier = new Map<string, AllocatedLine[]>();
  for (const row of allocated) {
    const current = bySupplier.get(row.line.supplier) ?? [];
    current.push(row);
    bySupplier.set(row.line.supplier, current);
  }
  const suppliers = [...bySupplier.entries()]
    .map(([name, rows]) => {
      const dueQty = rows.reduce((sum, row) => sum + row.line.orderQty, 0);
      const onTimeQty = rows.reduce((sum, row) => sum + row.onTimeQty, 0);
      const lateQty = rows.reduce((sum, row) => sum + row.lateQty, 0);
      const undeliveredQty = rows.reduce(
        (sum, row) => sum + row.undeliveredQty,
        0,
      );
      const delayWeight = rows.reduce((sum, row) => sum + row.delayWeight, 0);
      return {
        supplier: name,
        dueQty,
        onTimeQty,
        lateQty,
        undeliveredQty,
        rate: ratio(onTimeQty, dueQty),
        averageDelayDays: lateQty === 0 ? null : delayWeight / lateQty,
      };
    })
    .sort(compareSuppliers);

  const months =
    input.months ?? [...new Set(allocated.map((row) => row.month))].sort();
  const monthRates = suppliers.map((row) => ({
    supplier: row.supplier,
    months: months.map((item) => {
      const rows = (bySupplier.get(row.supplier) ?? []).filter(
        (allocatedRow) => allocatedRow.month === item,
      );
      const dueQty = rows.reduce(
        (sum, allocatedRow) => sum + allocatedRow.line.orderQty,
        0,
      );
      const onTimeQty = rows.reduce(
        (sum, allocatedRow) => sum + allocatedRow.onTimeQty,
        0,
      );
      return { month: item, rate: ratio(onTimeQty, dueQty) };
    }),
  }));

  const details = allocated.flatMap((row) => row.details).sort(compareDetails);
  const overdue = allocated
    .filter(
      (row) => row.undeliveredQty > 0 && row.line.deliveryDate < input.today,
    )
    .map((row) => ({
      supplier: row.line.supplier,
      billNo: row.line.billNo,
      materialNumber: row.line.materialNumber,
      materialName: row.line.materialName,
      deliveryDate: row.line.deliveryDate,
      orderQty: row.line.orderQty,
      undeliveredQty: row.undeliveredQty,
    }))
    .sort((left, right) => {
      const byDate = left.deliveryDate.localeCompare(right.deliveryDate);
      if (byDate !== 0) {
        return byDate;
      }
      const bySupplier = left.supplier.localeCompare(right.supplier, 'zh');
      if (bySupplier !== 0) {
        return bySupplier;
      }
      return left.billNo.localeCompare(right.billNo);
    });

  return {
    excludedQty,
    suppliers,
    monthRates,
    details,
    overdue,
    lateBars: suppliers
      .filter((row) => row.lateQty > 0 || row.undeliveredQty > 0)
      .map((row) => ({
        name: row.supplier,
        lateQty: row.lateQty,
        undeliveredQty: row.undeliveredQty,
      })),
    monthBars: months.map((item) => {
      const rows = allocated.filter((row) => row.month === item);
      return {
        month: item,
        onTimeQty: rows.reduce((sum, row) => sum + row.onTimeQty, 0),
        lateQty: rows.reduce((sum, row) => sum + row.lateQty, 0),
        undeliveredQty: rows.reduce((sum, row) => sum + row.undeliveredQty, 0),
      };
    }),
  };
}
