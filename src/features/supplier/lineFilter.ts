import type { PurchaseLine } from '@/features/supplier/timeliness';

export type LineFilterOperator =
  'eq' | 'neq' | 'contains' | 'notContains' | 'gt' | 'lt';

export type LineFilterField = Exclude<
  keyof PurchaseLine,
  'entryId' | 'excluded'
>;

export interface LineFilter {
  field: LineFilterField | '';
  operator: LineFilterOperator;
  value: string;
}

export interface LineFilterOption<T extends string> {
  value: T;
  label: string;
}

export const LINE_FILTER_FIELDS: LineFilterOption<LineFilterField>[] = [
  { value: 'supplier', label: '供应商' },
  { value: 'billNo', label: '采购订单号' },
  { value: 'materialNumber', label: '物料编码' },
  { value: 'materialName', label: '物料名称' },
  { value: 'orderQty', label: '订单数量' },
  { value: 'receivedQty', label: '累计收货数量' },
  { value: 'deliveryDate', label: '要求交货日' },
];

const TEXT_OPERATORS: LineFilterOption<LineFilterOperator>[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
];

const ORDER_OPERATORS: LineFilterOption<LineFilterOperator>[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
];

export function lineFilterOperators(
  field: LineFilterField | '',
): LineFilterOption<LineFilterOperator>[] {
  if (
    field === 'orderQty' ||
    field === 'receivedQty' ||
    field === 'deliveryDate'
  ) {
    return ORDER_OPERATORS;
  }
  return TEXT_OPERATORS;
}

function asNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value.trim().replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function compare(cell: string, expected: string): number | null {
  const left = asNumber(cell);
  const right = asNumber(expected);
  if (left != null && right != null) {
    return left - right;
  }
  if (cell === expected) {
    return 0;
  }
  return cell.localeCompare(expected);
}

function matchesOne(line: PurchaseLine, filter: LineFilter): boolean {
  const expected = filter.value.trim();
  if (!filter.field || !expected) {
    return true;
  }
  const raw = line[filter.field];
  const cell = raw == null ? '' : String(raw);
  if (filter.operator === 'contains') {
    return cell.includes(expected);
  }
  if (filter.operator === 'notContains') {
    return !cell.includes(expected);
  }
  const order = compare(cell, expected);
  switch (filter.operator) {
    case 'eq':
      return order === 0;
    case 'neq':
      return order !== 0;
    case 'gt':
      return order != null && order > 0;
    case 'lt':
      return order != null && order < 0;
    default:
      return true;
  }
}

/** 字段或值还没填完的条件先跳过，避免边输入边把数据全部过滤掉。 */
export function matchesLineFilters(
  line: PurchaseLine,
  filters: LineFilter[],
): boolean {
  return filters.every((filter) => matchesOne(line, filter));
}
