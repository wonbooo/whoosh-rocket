import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayoutItem } from 'react-grid-layout';
import {
  formatRate,
  matchSupplier,
  monthInRange,
  monthOverallRate,
  orderedMonthRange,
  productDetails,
  recentMonths,
  supplierMonthRates,
  type InspectLine,
  type SupplierMatch,
  type SupplierMonthRates,
} from '@/features/supplier/aggregate';
import { AftersaleQualityPanel } from '@/features/supplier/AftersaleQualityPanel';
import { DashboardGrid } from '@/features/supplier/DashboardGrid';
import { loadInspectLines } from '@/features/supplier/load';
import { MonthPicker } from '@/features/supplier/MonthPicker';
import {
  TimelinessPanel,
  type ArrivalPanelState,
} from '@/features/supplier/TimelinessPanel';
import { QuadrantPanel } from '@/features/supplier/QuadrantPanel';
import { RiskPanel } from '@/features/supplier/RiskPanel';
import { ScorecardPanel } from '@/features/supplier/ScorecardPanel';
import { buildPortraits } from '@/features/supplier/portrait';
import { SelectMenu } from '@/components/shared/SelectMenu';
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
  const thisMonth = months[months.length - 1] ?? '';
  const [lines, setLines] = useState<InspectLine[] | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('XLS');
  const [supplierOp, setSupplierOp] = useState<SupplierMatch>('contains');
  const [monthFrom, setMonthFrom] = useState(thisMonth);
  const [monthTo, setMonthTo] = useState(thisMonth);
  const [aftersaleSuppliers, setAftersaleSuppliers] = useState<string[]>([]);
  const [arrivalSuppliers, setArrivalSuppliers] = useState<string[]>([]);
  const [arrival, setArrival] = useState<ArrivalPanelState | null>(null);
  const handleArrival = useCallback((state: ArrivalPanelState) => {
    setArrival(state);
  }, []);
  const handleCatalog = useCallback(
    (catalog: { suppliers: string[]; months: string[] }) => {
      setAftersaleSuppliers((current) =>
        sameNames(current, catalog.suppliers) ? current : catalog.suppliers,
      );
    },
    [],
  );
  const handleArrivalCatalog = useCallback((suppliers: string[]) => {
    setArrivalSuppliers((current) =>
      sameNames(current, suppliers) ? current : suppliers,
    );
  }, []);

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

  const rates = useMemo(() => {
    const table = supplierMonthRates(lines ?? [], months);
    return table.filter((row) =>
      matchSupplier(row.supplier, supplier, supplierOp),
    );
  }, [lines, months, supplier, supplierOp]);
  const supplierOptions = useMemo(() => {
    const names = [
      ...new Set([
        ...(lines ? supplierNames(lines) : []),
        ...aftersaleSuppliers,
        ...arrivalSuppliers,
      ]),
    ].sort((left, right) => left.localeCompare(right, 'zh'));
    return names.map((name) => ({ value: name, label: name }));
  }, [aftersaleSuppliers, arrivalSuppliers, lines]);
  const portraits = useMemo(() => {
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const sources = arrival?.sources;
    return buildPortraits({
      inspect: lines ?? [],
      lines: sources?.lines ?? [],
      receipts: sources?.receive ?? [],
      instock: sources?.instock ?? [],
      monthFrom,
      monthTo,
      months,
      today: `${year}-${month}-${day}`,
      graceDays: arrival?.graceDays ?? 0,
      supplier,
      supplierOp,
    });
  }, [arrival, lines, monthFrom, monthTo, months, supplier, supplierOp, today]);
  const insightsLoading =
    Boolean(sessionId) &&
    (lines == null ||
      arrival == null ||
      (arrival.loading && arrival.sources == null));
  const insightsReady = Boolean(sessionId) && !insightsLoading;

  const renderBody = (id: WidgetId) => {
    if (id === 'summary') {
      return <SummaryTable rates={rates} />;
    }
    return (
      <DetailPanel
        lines={lines ?? []}
        supplier={supplier}
        supplierOp={supplierOp}
        monthFrom={monthFrom}
        monthTo={monthTo}
      />
    );
  };

  return (
    <div className="w-full px-6 py-8">
      <section className="mb-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          过滤条件
        </div>
        <div className="grid max-w-3xl grid-cols-[4.5rem_7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
          <span className="text-right text-sm text-zinc-700 dark:text-zinc-200">
            供应商
          </span>
          <SelectMenu
            aria-label="供应商比较"
            className="w-full"
            value={supplierOp}
            options={[
              { value: 'eq', label: '等于' },
              { value: 'neq', label: '不等于' },
              { value: 'contains', label: '包含' },
              { value: 'notContains', label: '不包含' },
            ]}
            onChange={(value) => setSupplierOp(value as SupplierMatch)}
          />
          <SuggestInput
            value={supplier}
            options={supplierOptions}
            placeholder="搜索供应商"
            onChange={setSupplier}
          />
          <span className="text-right text-sm text-zinc-700 dark:text-zinc-200">
            时间
          </span>
          <div className="col-span-2 grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">从</span>
            <MonthPicker
              label="开始年月"
              value={monthFrom}
              before={monthTo}
              onChange={setMonthFrom}
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">到</span>
            <MonthPicker
              label="结束年月"
              value={monthTo}
              after={monthFrom}
              onChange={setMonthTo}
            />
          </div>
        </div>
      </section>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="供应商评价">
        {(
          [
            ['supplier-inspect', '到货检验'],
            ['supplier-timeliness', '到货及时'],
            ['supplier-aftersale', '售后质量'],
            ['supplier-quadrant', '四象限矩阵'],
            ['supplier-scorecard', '综合评分'],
            ['supplier-risk', '风险预警'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            onClick={() =>
              document.getElementById(id)?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          >
            {label}
          </button>
        ))}
      </nav>
      <section id="supplier-inspect" className="scroll-mt-24">
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
      </section>
      <TimelinessPanel
        sessionId={sessionId}
        supplier={supplier}
        supplierOp={supplierOp}
        monthFrom={monthFrom}
        monthTo={monthTo}
        months={months}
        today={today}
        onCatalog={handleArrivalCatalog}
        onArrivalState={handleArrival}
      />
      <AftersaleQualityPanel
        supplier={supplier}
        supplierOp={supplierOp}
        monthFrom={monthFrom}
        monthTo={monthTo}
        onCatalog={handleCatalog}
      />
      <QuadrantPanel
        portraits={portraits}
        ready={insightsReady}
        loading={insightsLoading}
      />
      <ScorecardPanel
        portraits={portraits}
        ready={insightsReady}
        loading={insightsLoading}
      />
      <RiskPanel
        portraits={portraits}
        ready={insightsReady}
        loading={insightsLoading}
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
  supplierOp,
  monthFrom,
  monthTo,
}: {
  lines: InspectLine[];
  supplier: string;
  supplierOp: SupplierMatch;
  monthFrom: string;
  monthTo: string;
}) {
  const [page, setPage] = useState(0);
  const { start, end } = orderedMonthRange(monthFrom, monthTo);
  const ranged = lines.filter(
    (line) =>
      matchSupplier(line.supplier, supplier, supplierOp) &&
      monthInRange(line.month, monthFrom, monthTo),
  );
  const spansMonths = Boolean(start && end && start !== end);
  const overallRate = monthOverallRate(ranged, '', '');
  const overall = formatRate(overallRate);
  const overallPerfect = overallRate === 1;
  const rows = productDetails(ranged, '', '');
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [supplier, supplierOp, monthFrom, monthTo, rows.length]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-right text-lg font-medium">
          {!start && !end ? '' : spansMonths ? `${start} 至 ${end}` : '当月'}
          综合到货合格率{' '}
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
                {spansMonths ? <th className={stickyHead}>月份</th> : null}
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
                  {spansMonths ? (
                    <td className="px-2 py-1.5">{row.month}</td>
                  ) : null}
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
