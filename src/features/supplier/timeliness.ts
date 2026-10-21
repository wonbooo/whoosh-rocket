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
  /** 订单行上的累计收货数量。金蝶到货及时率按它判定，不看收货单日期。 */
  receivedQty?: number;
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
  pendingQty: number;
  overdueQty: number;
  undeliveredQty: number;
  delayDays: number | null;
}

export interface SupplierTimeliness {
  supplier: string;
  dueQty: number;
  onTimeQty: number;
  lateQty: number;
  pendingQty: number;
  overdueQty: number;
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
  pendingQty: number;
  overdueQty: number;
  undeliveredQty: number;
}

export interface MonthBar {
  month: string;
  onTimeQty: number;
  lateQty: number;
  pendingQty: number;
  overdueQty: number;
  undeliveredQty: number;
}

export interface OverdueLine {
  supplier: string;
  billNo: string;
  materialNumber: string;
  materialName: string;
  deliveryDate: string;
  orderQty: number;
  overdueQty: number;
  undeliveredQty: number;
  delayDays: number | null;
}

export interface TimelinessEvaluation {
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
  pendingQty: number;
  overdueQty: number;
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

export function matchesLine(
  line: PurchaseLine,
  receipt: ArrivalReceipt,
): boolean {
  if (line.entryId && receipt.entryId === line.entryId) {
    return true;
  }
  // 收料通知单、采购入库单上的「采购订单分录内码」经常是空的，
  // 这时按订单编号 + 物料编码回退，和金蝶到货及时率报表的关联口径一致。
  return (
    !receipt.entryId &&
    line.billNo !== '' &&
    receipt.billNo === line.billNo &&
    line.materialNumber !== '' &&
    receipt.materialNumber === line.materialNumber
  );
}

function allocate(
  line: PurchaseLine,
  graceDays: number,
  today: string,
): AllocatedLine | null {
  const month = monthOf(line.deliveryDate);
  const deadline = addDays(line.deliveryDate, graceDays);
  if (!month || !deadline) {
    return null;
  }
  // 金蝶云星空的到货及时率不看收货单的日期：累计收货数量达到订单数量即算及时，
  // 没收满的部分在宽限截止日及之前算准时未交货，过了截止日才算逾期未交货。
  const received = Math.min(Math.max(line.receivedQty ?? 0, 0), line.orderQty);
  const onTimeQty = received >= line.orderQty ? line.orderQty : 0;
  const open = line.orderQty - received;
  const pendingQty = open > 0 && today <= deadline ? open : 0;
  const overdueQty = open > 0 && today > deadline ? open : 0;
  const delayDays =
    overdueQty > 0 ? daysBetween(line.deliveryDate, today) : null;
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
  return {
    line,
    month,
    onTimeQty,
    lateQty: 0,
    pendingQty,
    overdueQty,
    delayWeight: delayDays == null ? 0 : delayDays * overdueQty,
    details: [
      {
        ...base,
        actualDate: '',
        onTimeQty,
        lateQty: 0,
        pendingQty,
        overdueQty,
        undeliveredQty: open,
        delayDays,
      },
    ],
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
  const leftProblem =
    left.lateQty > 0 || left.overdueQty > 0 || left.pendingQty > 0 ? 0 : 1;
  const rightProblem =
    right.lateQty > 0 || right.overdueQty > 0 || right.pendingQty > 0 ? 0 : 1;
  if (leftProblem !== rightProblem) {
    return leftProblem - rightProblem;
  }
  const leftDelay = left.delayDays ?? -1;
  const rightDelay = right.delayDays ?? -1;
  if (leftDelay !== rightDelay) {
    return rightDelay - leftDelay;
  }
  if (left.overdueQty !== right.overdueQty) {
    return right.overdueQty - left.overdueQty;
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
  const allocated = scoped.flatMap((line) => {
    const row = allocate(line, graceDays, input.today);
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
      const pendingQty = rows.reduce((sum, row) => sum + row.pendingQty, 0);
      const overdueQty = rows.reduce((sum, row) => sum + row.overdueQty, 0);
      const delayWeight = rows.reduce((sum, row) => sum + row.delayWeight, 0);
      const delayedQty = lateQty + overdueQty;
      return {
        supplier: name,
        dueQty,
        onTimeQty,
        lateQty,
        pendingQty,
        overdueQty,
        undeliveredQty: pendingQty + overdueQty,
        rate: ratio(onTimeQty, dueQty),
        averageDelayDays: delayedQty === 0 ? null : delayWeight / delayedQty,
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
    .filter((row) => row.overdueQty > 0)
    .map((row) => ({
      supplier: row.line.supplier,
      billNo: row.line.billNo,
      materialNumber: row.line.materialNumber,
      materialName: row.line.materialName,
      deliveryDate: row.line.deliveryDate,
      orderQty: row.line.orderQty,
      overdueQty: row.overdueQty,
      undeliveredQty: row.overdueQty,
      delayDays: daysBetween(row.line.deliveryDate, input.today),
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
    suppliers,
    monthRates,
    details,
    overdue,
    lateBars: suppliers
      .filter(
        (row) => row.lateQty > 0 || row.pendingQty > 0 || row.overdueQty > 0,
      )
      .map((row) => ({
        name: row.supplier,
        lateQty: row.lateQty,
        pendingQty: row.pendingQty,
        overdueQty: row.overdueQty,
        undeliveredQty: row.undeliveredQty,
      })),
    monthBars: months.map((item) => {
      const rows = allocated.filter((row) => row.month === item);
      const pendingQty = rows.reduce((sum, row) => sum + row.pendingQty, 0);
      const overdueQty = rows.reduce((sum, row) => sum + row.overdueQty, 0);
      return {
        month: item,
        onTimeQty: rows.reduce((sum, row) => sum + row.onTimeQty, 0),
        lateQty: rows.reduce((sum, row) => sum + row.lateQty, 0),
        pendingQty,
        overdueQty,
        undeliveredQty: pendingQty + overdueQty,
      };
    }),
  };
}
