export interface InspectLine {
  supplier: string;
  materialNumber: string;
  materialName: string;
  month: string;
  qualifiedQty: number;
  arrivalQty: number;
  remark: string;
}

export interface MonthRate {
  month: string;
  rate: number | null;
}

export interface SupplierMonthRates {
  supplier: string;
  months: MonthRate[];
}

export interface ProductDetail {
  supplier: string;
  month: string;
  materialNumber: string;
  materialName: string;
  qualifiedQty: number;
  arrivalQty: number;
  rate: number | null;
  reasonSummary: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function orderedMonthRange(
  from: string,
  to: string,
): { start: string; end: string } {
  if (!from) {
    return { start: to, end: to };
  }
  if (!to) {
    return { start: from, end: from };
  }
  return from <= to ? { start: from, end: to } : { start: to, end: from };
}

export type SupplierMatch = 'eq' | 'neq' | 'contains' | 'notContains';

export function matchSupplier(
  name: string,
  query: string,
  operator: SupplierMatch = 'eq',
): boolean {
  const value = query.trim();
  if (!value) {
    return true;
  }
  if (operator === 'eq') {
    return name === value;
  }
  if (operator === 'neq') {
    return name !== value;
  }
  if (operator === 'contains') {
    return name.includes(value);
  }
  return !name.includes(value);
}

export function monthInRange(month: string, from: string, to: string): boolean {
  if (!from && !to) {
    return true;
  }
  const { start, end } = orderedMonthRange(from, to);
  if (start && month < start) {
    return false;
  }
  if (end && month > end) {
    return false;
  }
  return true;
}

export function recentMonths(today: Date, count = 6): string[] {
  const months: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    months.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
  }
  return months;
}

export function queryRange(
  today: Date,
  count = 6,
): { dateFrom: string; dateTo: string } {
  const oldest = recentMonths(today, count)[0];
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return {
    dateFrom: `${oldest}-01`,
    dateTo: formatDay(nextMonth),
  };
}

function ratio(qualified: number, arrival: number): number | null {
  if (arrival === 0) {
    return null;
  }
  return qualified / arrival;
}

function totals(lines: InspectLine[]): { qualified: number; arrival: number } {
  return lines.reduce(
    (sum, line) => ({
      qualified: sum.qualified + line.qualifiedQty,
      arrival: sum.arrival + line.arrivalQty,
    }),
    { qualified: 0, arrival: 0 },
  );
}

export function supplierMonthRates(
  lines: InspectLine[],
  months: string[],
): SupplierMonthRates[] {
  const suppliers = [...new Set(lines.map((line) => line.supplier))].sort(
    (left, right) => left.localeCompare(right, 'zh'),
  );
  return suppliers.map((supplier) => ({
    supplier,
    months: months.map((month) => {
      const { qualified, arrival } = totals(
        lines.filter(
          (line) => line.supplier === supplier && line.month === month,
        ),
      );
      return { month, rate: ratio(qualified, arrival) };
    }),
  }));
}

export function formatRate(rate: number | null): string {
  if (rate == null) {
    return '—';
  }
  if (rate >= 1) {
    return '100.00%';
  }
  if (rate <= 0) {
    return '0.00%';
  }
  const rounded = (rate * 100).toFixed(2);
  if (rounded === '100.00') {
    return '99.99%';
  }
  if (rounded === '0.00') {
    return '0.01%';
  }
  return `${rounded}%`;
}

export function monthOverallRate(
  lines: InspectLine[],
  month: string,
  supplier = '',
): number | null {
  const matched = lines.filter(
    (line) =>
      (!month || line.month === month) &&
      (!supplier || line.supplier === supplier),
  );
  const { qualified, arrival } = totals(matched);
  return ratio(qualified, arrival);
}

export interface ReasonContribution {
  remark: string;
  unqualifiedQty: number;
}

export function summarizeReasons(entries: ReasonContribution[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const remark = entry.remark.trim();
    if (!remark || entry.unqualifiedQty <= 0) {
      continue;
    }
    counts.set(remark, (counts.get(remark) ?? 0) + entry.unqualifiedQty);
  }
  return [...counts.entries()]
    .map(([text, count]) => `${text}共计${count}件`)
    .join('，');
}

function lineUnqualified(line: InspectLine): number {
  const gap = line.arrivalQty - line.qualifiedQty;
  return gap > 0 ? gap : 0;
}

export function productDetails(
  lines: InspectLine[],
  supplier: string,
  month: string,
): ProductDetail[] {
  const grouped = new Map<
    string,
    {
      supplier: string;
      month: string;
      materialName: string;
      qualifiedQty: number;
      arrivalQty: number;
      reasons: ReasonContribution[];
    }
  >();

  for (const line of lines) {
    if (
      (supplier && line.supplier !== supplier) ||
      (month && line.month !== month)
    ) {
      continue;
    }
    const key = `${line.supplier}\0${line.month}\0${line.materialNumber}`;
    const current = grouped.get(key) ?? {
      supplier: line.supplier,
      month: line.month,
      materialName: '',
      qualifiedQty: 0,
      arrivalQty: 0,
      reasons: [],
    };
    if (!current.materialName && line.materialName.trim()) {
      current.materialName = line.materialName.trim();
    }
    current.qualifiedQty += line.qualifiedQty;
    current.arrivalQty += line.arrivalQty;
    current.reasons.push({
      remark: line.remark,
      unqualifiedQty: lineUnqualified(line),
    });
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, item]) => ({
      supplier: item.supplier,
      month: item.month,
      materialNumber: key.split('\0')[2] ?? '',
      materialName: item.materialName,
      qualifiedQty: item.qualifiedQty,
      arrivalQty: item.arrivalQty,
      rate: ratio(item.qualifiedQty, item.arrivalQty),
      reasonSummary: summarizeReasons(item.reasons),
    }))
    .sort((left, right) => {
      const bySupplier = left.supplier.localeCompare(right.supplier, 'zh');
      if (bySupplier !== 0) {
        return bySupplier;
      }
      const byMonth = left.month.localeCompare(right.month);
      if (byMonth !== 0) {
        return byMonth;
      }
      return left.materialName.localeCompare(right.materialName, 'zh');
    });
}
