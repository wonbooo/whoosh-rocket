import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import GridLayout, { getCompactor, useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import { Button } from '@/components/ui/button';
import {
  formatRate,
  monthOverallRate,
  productDetails,
  recentMonths,
  supplierMonthRates,
  type InspectLine,
  type SupplierMonthRates,
} from '@/features/supplier/aggregate';
import { RateChart, type RatePoint } from '@/features/supplier/RateChart';
import { loadInspectLines } from '@/features/supplier/load';
import { SuggestInput } from '@/components/shared/SuggestInput';
import { useKingdeeStore } from '@/store/useKingdeeStore';

const LAYOUT_KEY = 'supplier-evaluation-layout';
const PAGE_SIZE = 20;
const stickyHead =
  'sticky top-0 z-10 border-b border-zinc-200 bg-white px-2 py-1.5 font-medium dark:border-zinc-800 dark:bg-zinc-900';

type WidgetId = 'summary' | 'chart' | 'detail';

const WIDGETS: { id: WidgetId; title: string }[] = [
  { id: 'summary', title: '近6个月供应商到货合格率' },
  { id: 'chart', title: '分组柱状图' },
  { id: 'detail', title: '到货质检明细' },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'summary', x: 0, y: 0, w: 12, h: 8, minW: 4, minH: 4 },
  { i: 'chart', x: 0, y: 8, w: 12, h: 10, minW: 4, minH: 6 },
  { i: 'detail', x: 0, y: 18, w: 12, h: 12, minW: 4, minH: 6 },
];

function isWidgetId(value: string): value is WidgetId {
  return WIDGETS.some((widget) => widget.id === value);
}

function readLayout(): LayoutItem[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) {
      return DEFAULT_LAYOUT;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_LAYOUT;
    }
    return normalizeLayout(parsed);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function normalizeLayout(items: readonly unknown[]): LayoutItem[] {
  const saved = new Map<WidgetId, LayoutItem>();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Partial<LayoutItem>;
    if (typeof record.i !== 'string' || !isWidgetId(record.i)) {
      continue;
    }
    const box = [record.x, record.y, record.w, record.h];
    if (
      !box.every((part) => typeof part === 'number' && Number.isFinite(part))
    ) {
      continue;
    }
    saved.set(record.i, record as LayoutItem);
  }
  if (saved.size !== WIDGETS.length) {
    return DEFAULT_LAYOUT;
  }
  return DEFAULT_LAYOUT.map((fallback) => {
    const item = saved.get(fallback.i as WidgetId);
    if (!item) {
      return fallback;
    }
    return {
      ...fallback,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    };
  });
}

function sameLayout(left: LayoutItem[], right: LayoutItem[]): boolean {
  return left.every((item, index) => {
    const other = right[index];
    return (
      other != null &&
      item.i === other.i &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    );
  });
}

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

function ratePoints(rates: SupplierMonthRates[]): RatePoint[] {
  return rates.flatMap((row) =>
    row.months.flatMap((item) =>
      item.rate == null
        ? []
        : [
            {
              month: item.month,
              supplier: row.supplier,
              rate: item.rate * 100,
            },
          ],
    ),
  );
}

export function SupplierEvaluationPage() {
  const sessionId = useKingdeeStore((state) => state.sessionId);
  const today = useMemo(() => new Date(), []);
  const months = useMemo(() => recentMonths(today), [today]);
  const [lines, setLines] = useState<InspectLine[] | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutItem[]>(readLayout);
  const layoutRef = useRef(layout);
  const [expanded, setExpanded] = useState<WidgetId | null>(null);
  const [supplier, setSupplier] = useState('');
  const [month, setMonth] = useState(() => months[months.length - 1] ?? '');
  const { width, containerRef, mounted } = useContainerWidth();

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

  const rates = useMemo(
    () => supplierMonthRates(lines ?? [], months),
    [lines, months],
  );
  const points = useMemo(() => ratePoints(rates), [rates]);
  const handleLayoutChange = useCallback((next: readonly LayoutItem[]) => {
    const normalized = normalizeLayout(next);
    if (sameLayout(layoutRef.current, normalized)) {
      return;
    }
    layoutRef.current = normalized;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(normalized));
    setLayout(normalized);
  }, []);

  const renderBody = (id: WidgetId) => {
    if (id === 'summary') {
      return <SummaryTable rates={rates} />;
    }
    if (id === 'chart') {
      return <RateChart points={points} />;
    }
    return (
      <DetailPanel
        lines={lines ?? []}
        months={months}
        supplier={supplier}
        month={month}
        onSupplier={setSupplier}
        onMonth={setMonth}
      />
    );
  };

  const gridWidth = width > 0 ? width : 1280;

  return (
    <div className="w-full px-6 py-8">
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
      <div ref={containerRef} className="w-full">
        {sessionId && lines != null && mounted ? (
          <GridLayout
            width={gridWidth}
            layout={layout}
            gridConfig={{ cols: 12, rowHeight: 32, margin: [16, 16] }}
            compactor={getCompactor(null, true)}
            dragConfig={{
              enabled: true,
              bounded: false,
              handle: '.widget-drag',
              cancel: '',
              threshold: 3,
            }}
            resizeConfig={{ enabled: true, handles: ['se'] }}
            onLayoutChange={handleLayoutChange}
          >
            {WIDGETS.map((widget) => (
              <div key={widget.id}>
                <WidgetCard
                  title={widget.title}
                  onExpand={() => setExpanded(widget.id)}
                >
                  {renderBody(widget.id)}
                </WidgetCard>
              </div>
            ))}
          </GridLayout>
        ) : null}
        {expanded ? (
          <ExpandedCard
            title={
              WIDGETS.find((widget) => widget.id === expanded)?.title ?? ''
            }
            onClose={() => setExpanded(null)}
          >
            {renderBody(expanded)}
          </ExpandedCard>
        ) : null}
      </div>
    </div>
  );
}

function WidgetCard({
  title,
  onExpand,
  children,
}: {
  title: string;
  onExpand: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="widget-drag mb-2 flex cursor-move items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="放大"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onExpand}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function ExpandedCard({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="缩小"
          onClick={onClose}
        >
          <Minimize2 className="h-4 w-4" />
          缩小
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
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
  months,
  supplier,
  month,
  onSupplier,
  onMonth,
}: {
  lines: InspectLine[];
  months: string[];
  supplier: string;
  month: string;
  onSupplier: (supplier: string) => void;
  onMonth: (month: string) => void;
}) {
  const [page, setPage] = useState(0);
  const names = supplierNames(lines);
  const overall = formatRate(monthOverallRate(lines, month, supplier));
  const rows = productDetails(lines, supplier, month);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [supplier, month, rows.length]);
  const selectClass =
    'h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';
  const supplierOptions = [
    { value: '', label: '全部' },
    ...names.map((name) => ({ value: name, label: name })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          供应商
          <div className="w-52">
            <SuggestInput
              value={supplier}
              options={supplierOptions}
              placeholder="搜索供应商"
              onChange={onSupplier}
            />
          </div>
        </label>
        <label className="flex items-center gap-2 text-sm">
          月份
          <select
            aria-label="月份"
            className={selectClass}
            value={month}
            onChange={(event) => onMonth(event.target.value)}
          >
            <option value="">全部</option>
            {months.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm font-medium">
        {month ? '当月' : '近6个月'}综合到货合格率 {overall}
      </p>
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
