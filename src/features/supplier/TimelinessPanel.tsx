import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LayoutItem } from 'react-grid-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectMenu } from '@/components/shared/SelectMenu';
import {
  formatRate,
  matchSupplier,
  monthInRange,
  type SupplierMatch,
} from '@/features/supplier/aggregate';
import { DashboardGrid } from '@/features/supplier/DashboardGrid';
import {
  LINE_FILTER_FIELDS,
  lineFilterOperators,
  matchesLineFilters,
  type LineFilter,
  type LineFilterField,
  type LineFilterOperator,
} from '@/features/supplier/lineFilter';
import {
  loadArrivalSources,
  type ArrivalSources,
} from '@/features/supplier/loadTimeliness';
import {
  LateArrivalChart,
  MonthArrivalChart,
} from '@/features/supplier/TimelinessCharts';
import {
  evaluateTimeliness,
  formatDelay,
  formatQty,
  type PurchaseLine,
  type TimelinessEvaluation,
} from '@/features/supplier/timeliness';

const LAYOUT_KEY = 'supplier-timeliness-layout';
const PAGE_SIZE = 20;
const stickyHead =
  'sticky top-0 z-10 border-b border-zinc-200 bg-white px-2 py-1.5 font-medium dark:border-zinc-800 dark:bg-zinc-900';

type WidgetId = 'rates' | 'qty' | 'detail' | 'late' | 'months' | 'overdue';

const WIDGETS: { id: WidgetId; title: string }[] = [
  { id: 'rates', title: '近6个月供应商到货及时率' },
  { id: 'qty', title: '到货数量' },
  { id: 'detail', title: '订单到货明细' },
  { id: 'late', title: '逾期与未交货' },
  { id: 'months', title: '月度到货结构' },
  { id: 'overdue', title: '逾期未到' },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'rates', x: 0, y: 0, w: 12, h: 8, minW: 4, minH: 4 },
  { i: 'qty', x: 0, y: 8, w: 12, h: 8, minW: 4, minH: 4 },
  { i: 'detail', x: 0, y: 16, w: 12, h: 12, minW: 4, minH: 6 },
  { i: 'late', x: 0, y: 28, w: 6, h: 10, minW: 3, minH: 6 },
  { i: 'months', x: 6, y: 28, w: 6, h: 10, minW: 3, minH: 6 },
  { i: 'overdue', x: 0, y: 38, w: 12, h: 10, minW: 4, minH: 6 },
];

function formatToday(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseGrace(text: string): number {
  const parsed = Number(text);
  if (!text.trim() || !Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '读取采购订单失败。';
}

function supplierNames(lines: PurchaseLine[]): string[] {
  return [...new Set(lines.map((line) => line.supplier).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, 'zh'),
  );
}

export interface ArrivalPanelState {
  sources: ArrivalSources | null;
  loading: boolean;
  error: string | null;
  graceDays: number;
}

export function TimelinessPanel({
  sessionId = null,
  supplier = '',
  supplierOp = 'eq',
  monthFrom = '',
  monthTo = '',
  months,
  today = new Date(),
  onCatalog,
  onArrivalState,
}: {
  sessionId?: string | null;
  supplier?: string;
  supplierOp?: SupplierMatch;
  monthFrom?: string;
  monthTo?: string;
  months: string[];
  today?: Date;
  onCatalog?: (suppliers: string[]) => void;
  onArrivalState?: (state: ArrivalPanelState) => void;
}) {
  const [sources, setSources] = useState<ArrivalSources | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);
  const [graceText, setGraceText] = useState('2');
  const [filters, setFilters] = useState<LineFilter[]>([]);
  const arrivalExtras = useRef({ graceText, onArrivalState });
  arrivalExtras.current = { graceText, onArrivalState };
  const todayText = useMemo(() => formatToday(today), [today]);
  const rangeMonths = useMemo(
    () => months.filter((item) => monthInRange(item, monthFrom, monthTo)),
    [monthFrom, monthTo, months],
  );
  const names = useMemo(() => supplierNames(sources?.lines ?? []), [sources]);
  const filteredLines = useMemo(
    () =>
      (sources?.lines ?? []).filter((line) =>
        matchesLineFilters(line, filters),
      ),
    [filters, sources],
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadArrivalSources(today)
      .then((loaded) => {
        if (!cancelled) {
          setSources(loaded);
          setLoading(false);
          const extras = arrivalExtras.current;
          extras.onArrivalState?.({
            sources: loaded,
            loading: false,
            error: null,
            graceDays: parseGrace(extras.graceText),
          });
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setSources(null);
          const message = errorMessage(caught);
          setError(message);
          setLoading(false);
          const extras = arrivalExtras.current;
          extras.onArrivalState?.({
            sources: null,
            loading: false,
            error: message,
            graceDays: parseGrace(extras.graceText),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, today]);

  useEffect(() => {
    if (!sources) {
      return;
    }
    onCatalog?.(names);
  }, [names, onCatalog, sources]);

  const recentResult = useMemo(() => {
    if (!sources) {
      return null;
    }
    return evaluateTimeliness({
      lines: filteredLines.filter((line) =>
        matchSupplier(line.supplier, supplier, supplierOp),
      ),
      receipts: [],
      graceDays: parseGrace(graceText),
      today: todayText,
      months,
    });
  }, [
    filteredLines,
    graceText,
    months,
    sources,
    supplier,
    supplierOp,
    todayText,
  ]);
  const result = useMemo(() => {
    if (!sources) {
      return null;
    }
    const lines = filteredLines.filter(
      (line) =>
        matchSupplier(line.supplier, supplier, supplierOp) &&
        monthInRange(line.deliveryDate.slice(0, 7), monthFrom, monthTo),
    );
    return evaluateTimeliness({
      lines,
      receipts: [],
      graceDays: parseGrace(graceText),
      today: todayText,
      months: rangeMonths,
    });
  }, [
    filteredLines,
    graceText,
    monthFrom,
    monthTo,
    rangeMonths,
    sources,
    supplierOp,
    supplier,
    todayText,
  ]);

  const selectClass =
    'h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <section id="supplier-timeliness" className="mt-8 scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">到货及时率</h2>
        {sessionId ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              宽限天数
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                aria-label="宽限天数"
                className={`${selectClass} w-20`}
                value={graceText}
                onChange={(event) => {
                  const next = event.target.value;
                  setGraceText(next);
                  onArrivalState?.({
                    sources,
                    loading,
                    error,
                    graceDays: parseGrace(next),
                  });
                }}
              />
            </label>
          </div>
        ) : null}
      </div>
      {sessionId ? (
        <FilterConditions filters={filters} onChange={setFilters} />
      ) : null}
      {!sessionId ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          连接金蝶后，这里按采购订单的交货日期汇总到货及时率。
        </p>
      ) : null}
      {sessionId && loading && sources == null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          正在加载采购订单和到货单…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {result && sources ? (
        sources.lines.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            近 6 个月没有已审核的采购订单。
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
              按金蝶口径统计，关闭、冻结、终止的订单行也计入。
            </p>
            <DashboardGrid
              storageKey={LAYOUT_KEY}
              widgets={WIDGETS}
              defaultLayout={DEFAULT_LAYOUT}
              render={(id) =>
                renderWidget(
                  id,
                  id === 'rates' && recentResult ? recentResult : result,
                )
              }
            />
          </>
        )
      ) : null}
    </section>
  );
}

function FilterConditions({
  filters,
  onChange,
}: {
  filters: LineFilter[];
  onChange: (filters: LineFilter[]) => void;
}) {
  const updateAt = (index: number, patch: Partial<LineFilter>) =>
    onChange(
      filters.map((filter, current) =>
        current === index ? { ...filter, ...patch } : filter,
      ),
    );
  return (
    <div className="mb-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          过滤条件
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...filters, { field: '', operator: 'eq', value: '' }])
          }
        >
          添加条件
        </Button>
      </div>
      {filters.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {filters.map((filter, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <SelectMenu
                aria-label="字段"
                className="w-40 shrink-0"
                placeholder="字段"
                value={filter.field}
                options={LINE_FILTER_FIELDS}
                onChange={(value) => {
                  const field = value as LineFilterField;
                  const supported = lineFilterOperators(field).some(
                    (option) => option.value === filter.operator,
                  );
                  updateAt(index, {
                    field,
                    operator: supported ? filter.operator : 'eq',
                  });
                }}
              />
              <SelectMenu
                aria-label="比较符"
                className="w-32 shrink-0"
                value={filter.operator}
                options={lineFilterOperators(filter.field)}
                onChange={(value) =>
                  updateAt(index, { operator: value as LineFilterOperator })
                }
              />
              <Input
                aria-label="值"
                className="min-w-0 flex-1"
                placeholder="值"
                value={filter.value}
                onChange={(event) =>
                  updateAt(index, { value: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(filters.filter((_, current) => current !== index))
                }
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderWidget(id: WidgetId, result: TimelinessEvaluation): ReactNode {
  if (id === 'rates') {
    return <RateMatrix result={result} />;
  }
  if (id === 'qty') {
    return <QtyTable result={result} />;
  }
  if (id === 'detail') {
    return <DetailTable result={result} />;
  }
  if (id === 'late') {
    return result.lateBars.length === 0 ? (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        没有逾期或未交货。
      </p>
    ) : (
      <LateArrivalChart bars={result.lateBars} />
    );
  }
  if (id === 'months') {
    return result.monthBars.every(
      (bar) =>
        bar.onTimeQty + bar.lateQty + bar.pendingQty + bar.overdueQty === 0,
    ) ? (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">没有到货数据。</p>
    ) : (
      <MonthArrivalChart bars={result.monthBars} />
    );
  }
  return <OverdueTable result={result} />;
}

function TablePager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= PAGE_SIZE) {
    return null;
  }
  const pageCount = Math.ceil(total / PAGE_SIZE);
  return (
    <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-800">
      <span className="mr-auto text-zinc-500 dark:text-zinc-400">
        共 {total} 条
      </span>
      <button
        type="button"
        className="rounded-md border border-zinc-200 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
        disabled={page <= 0}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </button>
      <span className="tabular-nums">
        第 {page + 1} / {pageCount} 页
      </span>
      <button
        type="button"
        className="rounded-md border border-zinc-200 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
        disabled={page + 1 >= pageCount}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}

function usePage(
  total: number,
  resetKey: string,
): [number, (page: number) => void] {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [resetKey]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return [Math.min(page, pageCount - 1), setPage];
}

function RateMatrix({ result }: { result: TimelinessEvaluation }) {
  const months = result.monthRates[0]?.months.map((item) => item.month) ?? [];
  const [page, setPage] = usePage(result.monthRates.length, months.join('|'));
  const visible = result.monthRates.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className={stickyHead}>供应商</th>
              {months.map((item) => (
                <th key={item} className={`${stickyHead} text-right`}>
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.monthRates.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(months.length + 1, 1)}
                  className="px-2 py-4 text-zinc-400"
                >
                  没有符合过滤条件的采购订单
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={row.supplier}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-2 py-1.5">{row.supplier}</td>
                  {row.months.map((item) => (
                    <td
                      key={item.month}
                      className="px-2 py-1.5 text-right tabular-nums"
                    >
                      {formatRate(item.rate)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <TablePager
        page={page}
        total={result.monthRates.length}
        onPage={setPage}
      />
    </div>
  );
}

function QtyTable({ result }: { result: TimelinessEvaluation }) {
  const [page, setPage] = usePage(
    result.suppliers.length,
    result.suppliers.map((row) => row.supplier).join('|'),
  );
  const visible = result.suppliers.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className={stickyHead}>供应商</th>
              <th className={`${stickyHead} text-right`}>应交数量</th>
              <th className={`${stickyHead} text-right`}>准时已交货</th>
              <th className={`${stickyHead} text-right`}>逾期已交货</th>
              <th className={`${stickyHead} text-right`}>准时未交货</th>
              <th className={`${stickyHead} text-right`}>逾期未交货</th>
              <th className={`${stickyHead} text-right`}>到货及时率</th>
              <th className={`${stickyHead} text-right`}>平均逾期天数</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.supplier}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-2 py-1.5">{row.supplier}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.dueQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.onTimeQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.lateQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.pendingQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.overdueQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatRate(row.rate)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatDelay(row.averageDelayDays)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager
        page={page}
        total={result.suppliers.length}
        onPage={setPage}
      />
    </div>
  );
}

function DetailTable({ result }: { result: TimelinessEvaluation }) {
  const due = result.suppliers.reduce((sum, row) => sum + row.dueQty, 0);
  const onTime = result.suppliers.reduce((sum, row) => sum + row.onTimeQty, 0);
  const overall = due === 0 ? null : onTime / due;
  const overallText = formatRate(overall);
  const [page, setPage] = usePage(result.details.length, overallText);
  const visible = result.details.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="text-right text-lg font-medium">
        综合到货及时率{' '}
        <span
          data-testid="overall-timeliness-rate"
          className={
            overall == null
              ? 'text-2xl font-semibold text-zinc-500'
              : overall === 1
                ? 'text-2xl font-semibold text-green-600'
                : 'text-2xl font-semibold text-red-600'
          }
        >
          {overallText}
        </span>
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className={stickyHead}>供应商</th>
              <th className={stickyHead}>采购订单号</th>
              <th className={stickyHead}>物料</th>
              <th className={`${stickyHead} text-right`}>订单数量</th>
              <th className={stickyHead}>要求交货日</th>
              <th className={stickyHead}>实际到货日</th>
              <th className={`${stickyHead} text-right`}>准时已交货</th>
              <th className={`${stickyHead} text-right`}>逾期已交货</th>
              <th className={`${stickyHead} text-right`}>准时未交货</th>
              <th className={`${stickyHead} text-right`}>逾期未交货</th>
              <th className={`${stickyHead} text-right`}>逾期天数</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={`${row.billNo}-${row.entryId}-${row.actualDate}-${index}`}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-2 py-1.5">{row.supplier}</td>
                <td className="px-2 py-1.5">{row.billNo}</td>
                <td className="px-2 py-1.5">
                  {row.materialName || row.materialNumber}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.orderQty)}
                </td>
                <td className="px-2 py-1.5">{row.deliveryDate}</td>
                <td className="px-2 py-1.5">{row.actualDate || '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.onTimeQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.lateQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.pendingQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.overdueQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatDelay(row.delayDays)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={page} total={result.details.length} onPage={setPage} />
    </div>
  );
}

function OverdueTable({ result }: { result: TimelinessEvaluation }) {
  const [page, setPage] = usePage(
    result.overdue.length,
    result.overdue.map((row) => row.billNo).join('|'),
  );
  const visible = result.overdue.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  if (result.overdue.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        没有逾期未交货。
      </p>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className={stickyHead}>供应商</th>
              <th className={stickyHead}>采购订单号</th>
              <th className={stickyHead}>物料</th>
              <th className={stickyHead}>要求交货日</th>
              <th className={`${stickyHead} text-right`}>逾期未交货</th>
              <th className={`${stickyHead} text-right`}>逾期天数</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.billNo}-${row.materialNumber}`}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-2 py-1.5">{row.supplier}</td>
                <td className="px-2 py-1.5">{row.billNo}</td>
                <td className="px-2 py-1.5">
                  {row.materialName || row.materialNumber}
                </td>
                <td className="px-2 py-1.5">{row.deliveryDate}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatQty(row.overdueQty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatDelay(row.delayDays)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={page} total={result.overdue.length} onPage={setPage} />
    </div>
  );
}
