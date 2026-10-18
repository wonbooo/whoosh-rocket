import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayoutItem } from 'react-grid-layout';
import {
  formatRate,
  monthOverallRate,
  productDetails,
  recentMonths,
  supplierMonthRates,
  type InspectLine,
  type SupplierMonthRates,
} from '@/features/supplier/aggregate';
import { AftersaleQualityPanel } from '@/features/supplier/AftersaleQualityPanel';
import { DashboardGrid } from '@/features/supplier/DashboardGrid';
import { loadInspectLines } from '@/features/supplier/load';
import { SuggestInput } from '@/components/shared/SuggestInput';
import { useKingdeeStore } from '@/store/useKingdeeStore';

const LAYOUT_KEY = 'supplier-evaluation-layout-v2';
const PAGE_SIZE = 20;
const stickyHead =
  'sticky top-0 z-10 border-b border-zinc-200 bg-white px-2 py-1.5 font-medium dark:border-zinc-800 dark:bg-zinc-900';

type WidgetId = 'summary' | 'detail';

const WIDGETS: { id: WidgetId; title: string }[] = [
  { id: 'summary', title: '近6个月供应商到货合格率' },
  { id: 'detail', title: '到货质检明细' },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'summary', x: 0, y: 0, w: 12, h: 8, minW: 4, minH: 4 },
  { i: 'detail', x: 0, y: 8, w: 12, h: 12, minW: 4, minH: 6 },
];

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '读取检验单失败。';
}

function supplierNames(lines: InspectLine[]): string[] {
  return [...new Set(lines.map((line) => line.supplier).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, 'zh'),
  );
}

function sameNames(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

export function SupplierEvaluationPage() {
  const sessionId = useKingdeeStore((state) => state.sessionId);
  const today = useMemo(() => new Date(), []);
  const months = useMemo(() => recentMonths(today), [today]);
  const [lines, setLines] = useState<InspectLine[] | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
  const [month, setMonth] = useState(() => months[months.length - 1] ?? '');
  const [aftersaleSuppliers, setAftersaleSuppliers] = useState<string[]>([]);
  const [aftersaleMonths, setAftersaleMonths] = useState<string[]>([]);
  const handleCatalog = useCallback(
    (catalog: { suppliers: string[]; months: string[] }) => {
      setAftersaleSuppliers((current) =>
        sameNames(current, catalog.suppliers) ? current : catalog.suppliers,
      );
      setAftersaleMonths((current) =>
        sameNames(current, catalog.months) ? current : catalog.months,
      );
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadInspectLines(today)
      .then((loaded) => {
        if (!cancelled) {
          setLines(loaded);
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLines(null);
          setError(errorMessage(caught));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, today]);

  const visibleMonths = useMemo(
    () => (month ? [month] : months),
    [month, months],
  );
  const rates = useMemo(() => {
    const table = supplierMonthRates(lines ?? [], visibleMonths);
    return supplier ? table.filter((row) => row.supplier === supplier) : table;
  }, [lines, supplier, visibleMonths]);
  const supplierOptions = useMemo(() => {
    const names = [
      ...new Set([
        ...(lines ? supplierNames(lines) : []),
        ...aftersaleSuppliers,
      ]),
    ].sort((left, right) => left.localeCompare(right, 'zh'));
    return [
      { value: '', label: '全部' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [aftersaleSuppliers, lines]);
  const monthOptions = useMemo(
    () => [...new Set([...months, ...aftersaleMonths])].sort(),
    [aftersaleMonths, months],
  );

  const renderBody = (id: WidgetId) => {
    if (id === 'summary') {
      return <SummaryTable rates={rates} />;
    }
    return (
      <DetailPanel lines={lines ?? []} supplier={supplier} month={month} />
    );
  };

  const selectClass =
    'h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <div className="w-full px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          供应商
          <div className="w-52">
            <SuggestInput
              value={supplier}
              options={supplierOptions}
              placeholder="搜索供应商"
              onChange={setSupplier}
            />
          </div>
        </label>
        <label className="flex items-center gap-2 text-sm">
          年月
          <select
            aria-label="年月"
            className={selectClass}
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          >
            <option value="">全部</option>
            {monthOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <header className="mb-4">
        <h1 className="text-lg font-medium">到货检验分析</h1>
      </header>
      {!sessionId ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          请先点击右上角「连接金蝶」完成登录。
        </p>
      ) : null}
      {sessionId && loading && lines == null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          正在加载检验单…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {sessionId && lines != null ? (
        <DashboardGrid
          storageKey={LAYOUT_KEY}
          widgets={WIDGETS}
          defaultLayout={DEFAULT_LAYOUT}
          render={renderBody}
        />
      ) : null}
      <AftersaleQualityPanel
        supplier={supplier}
        month={month}
        onMonth={setMonth}
        onCatalog={handleCatalog}
      />
    </div>
  );
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

function SummaryTable({ rates }: { rates: SupplierMonthRates[] }) {
  const [page, setPage] = useState(0);
  const months = rates[0]?.months.map((item) => item.month) ?? [];
  const pageCount = Math.max(1, Math.ceil(rates.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rates.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [rates]);

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
            {rates.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(months.length + 1, 1)}
                  className="px-2 py-4 text-zinc-400"
                >
                  暂无检验数据
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
      <TablePager page={current} total={rates.length} onPage={setPage} />
    </div>
  );
}

function DetailPanel({
  lines,
  supplier,
  month,
}: {
  lines: InspectLine[];
  supplier: string;
  month: string;
}) {
  const [page, setPage] = useState(0);
  const overallRate = monthOverallRate(lines, month, supplier);
  const overall = formatRate(overallRate);
  const overallPerfect = overallRate === 1;
  const rows = productDetails(lines, supplier, month);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [supplier, month, rows.length]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-right text-lg font-medium">
          {month ? '当月' : '近6个月'}综合到货合格率{' '}
          <span
            data-testid="overall-rate"
            className={
              overallPerfect
                ? 'text-2xl font-semibold text-green-600'
                : 'text-2xl font-semibold text-red-600'
            }
          >
            {overall}
          </span>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">没有质检明细</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className={stickyHead}>供应商</th>
                {month ? null : <th className={stickyHead}>月份</th>}
                <th className={stickyHead}>商品</th>
                <th className={`${stickyHead} text-right`}>到货数量</th>
                <th className={`${stickyHead} text-right`}>合格数量</th>
                <th className={`${stickyHead} text-right`}>到货合格率</th>
                <th className={stickyHead}>不合格原因汇总</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={`${row.supplier}-${row.month}-${row.materialNumber}`}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-2 py-1.5">{row.supplier}</td>
                  {month ? null : <td className="px-2 py-1.5">{row.month}</td>}
                  <td className="px-2 py-1.5">
                    {row.materialName || row.materialNumber}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {row.arrivalQty}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {row.qualifiedQty}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatRate(row.rate)}
                  </td>
                  <td className="px-2 py-1.5">{row.reasonSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TablePager page={current} total={rows.length} onPage={setPage} />
    </div>
  );
}
