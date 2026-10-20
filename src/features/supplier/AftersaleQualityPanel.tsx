import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import type { LayoutItem } from 'react-grid-layout';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  complaintBars,
  factoryPaySlices,
  loadAftersaleMonths,
  parseAftersaleQualityWorkbook,
  saveAftersaleMonth,
  supplierSummaries,
  aftersalePreview,
  type AftersaleMonth,
} from '@/features/supplier/aftersaleQuality';
import {
  ComplaintBars,
  FactoryPayPie,
} from '@/features/supplier/AftersaleCharts';
import {
  matchSupplier,
  monthInRange,
  type SupplierMatch,
} from '@/features/supplier/aggregate';
import { DashboardGrid } from '@/features/supplier/DashboardGrid';
import { db } from '@/lib/db';
import { createRecord, whenHydrated } from '@/lib/persistedRecord';
import type { PersistedRecord } from '@/lib/persistedRecord';

const NAMESPACE = 'supplier-aftersale';
const LAYOUT_KEY = 'supplier-aftersale-layout';
const defaultRecord = createRecord(NAMESPACE);

type WidgetId = 'table' | 'pie' | 'bars';

const WIDGETS: { id: WidgetId; title: string }[] = [
  { id: 'table', title: '客诉汇总' },
  { id: 'pie', title: '工厂赔付金额' },
  { id: 'bars', title: '客诉事件' },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'table', x: 0, y: 0, w: 12, h: 10, minW: 4, minH: 6 },
  { i: 'pie', x: 0, y: 10, w: 6, h: 10, minW: 3, minH: 6 },
  { i: 'bars', x: 6, y: 10, w: 6, h: 10, minW: 3, minH: 6 },
];

const stickyHead =
  'sticky top-0 z-10 border-b border-zinc-200 bg-white px-2 py-1.5 text-left font-medium dark:border-zinc-800 dark:bg-zinc-900';

function renderWidget(
  id: WidgetId,
  rows: ReturnType<typeof supplierSummaries>,
  slices: ReturnType<typeof factoryPaySlices>,
  bars: ReturnType<typeof complaintBars>,
): ReactNode {
  if (id === 'table') {
    return <SummaryTable rows={rows} />;
  }
  if (id === 'pie') {
    return slices.length === 0 ? (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        没有工厂赔付金额。
      </p>
    ) : (
      <FactoryPayPie slices={slices} />
    );
  }
  return <ComplaintBars items={bars} />;
}

function SummaryTable({
  rows,
}: {
  rows: ReturnType<typeof supplierSummaries>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-xs text-zinc-500 dark:text-zinc-400">
            <th className={stickyHead}>供应商</th>
            <th className={`${stickyHead} text-right`}>客诉事件（个）</th>
            <th className={`${stickyHead} text-right`}>产品问题数量（个）</th>
            <th className={stickyHead}>产品问题概括</th>
            <th className={stickyHead}>结案情况</th>
            <th className={`${stickyHead} text-right`}>我司赔付金额</th>
            <th className={`${stickyHead} text-right`}>工厂赔付金额</th>
            <th className={`${stickyHead} text-right`}>工厂赔付率%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.supplier}
              className="border-b border-zinc-100 dark:border-zinc-800"
            >
              <td className="px-2 py-1.5">{row.supplier}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {row.eventCount}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {row.quantity}
              </td>
              <td className="px-2 py-1.5">{row.categories}</td>
              <td className="px-2 py-1.5">{row.closure}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {row.companyPayText}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {row.factoryPayText}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {row.payRateText}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '读取售后问题登记表失败。';
}

export function AftersaleQualityPanel({
  record = defaultRecord,
  supplier = '',
  supplierOp = 'eq',
  monthFrom = '',
  monthTo = '',
  onMonth,
  onCatalog,
}: {
  record?: PersistedRecord;
  supplier?: string;
  supplierOp?: SupplierMatch;
  monthFrom?: string;
  monthTo?: string;
  onMonth?: (month: string) => void;
  onCatalog?: (catalog: { suppliers: string[]; months: string[] }) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [months, setMonths] = useState<AftersaleMonth[]>(() =>
    loadAftersaleMonths(record),
  );
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!db.isAvailable()) {
      setMonths((current) => {
        const loaded = loadAftersaleMonths(record);
        return JSON.stringify(current) === JSON.stringify(loaded)
          ? current
          : loaded;
      });
      return;
    }
    let cancelled = false;
    void whenHydrated(NAMESPACE).then(() => {
      if (!cancelled) {
        setMonths(loadAftersaleMonths(record));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [record]);

  const catalogSuppliers = useMemo(
    () =>
      [
        ...new Set(
          months.flatMap((item) => item.events.map((event) => event.supplier)),
        ),
      ].sort((left, right) => left.localeCompare(right, 'zh')),
    [months],
  );
  const catalogMonths = useMemo(
    () => months.map((item) => item.month),
    [months],
  );

  useEffect(() => {
    onCatalog?.({ suppliers: catalogSuppliers, months: catalogMonths });
  }, [catalogMonths, catalogSuppliers, onCatalog]);

  const events = useMemo(
    () =>
      months
        .filter((item) => monthInRange(item.month, monthFrom, monthTo))
        .flatMap((item) => item.events)
        .filter((event) => matchSupplier(event.supplier, supplier, supplierOp)),
    [monthFrom, monthTo, months, supplier, supplierOp],
  );
  const rows = useMemo(() => supplierSummaries(events), [events]);
  const slices = useMemo(() => factoryPaySlices(rows), [rows]);
  const bars = useMemo(() => complaintBars(rows), [rows]);

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('请上传 .xlsx 文件。');
      return;
    }
    try {
      const parsed = parseAftersaleQualityWorkbook(await file.arrayBuffer());
      const next = await saveAftersaleMonth(record, parsed);
      setMonths(next);
      onMonth?.(parsed.month);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <section id="supplier-aftersale" className="mt-8 scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">售后质量指标</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            aria-label="上传售后问题登记表"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void handleFile(file);
            }}
          />
          <Button type="button" onClick={() => setLibraryOpen(true)}>
            <Upload className="h-4 w-4" />
            上传 Excel
          </Button>
        </div>
      </div>
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>已上传的售后 Excel</DialogTitle>
            <DialogDescription>
              先查看已有年月和解析后的表格，再选择文件上传。同一年月会覆盖原表。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-auto">
            {months.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                还没有上传过 Excel。
              </p>
            ) : (
              months.map((item) => {
                const preview = aftersalePreview(item);
                const expanded = openMonth === item.month;
                return (
                  <div
                    key={item.month}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                      aria-expanded={expanded}
                      onClick={() =>
                        setOpenMonth((current) =>
                          current === item.month ? null : item.month,
                        )
                      }
                    >
                      <span>
                        {item.month}
                        <span className="ml-2 text-zinc-500">
                          {item.events.length} 行
                        </span>
                      </span>
                      <span className="text-xs text-zinc-400">
                        {expanded ? '收起' : '查看原始数据'}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="max-h-64 overflow-auto border-t border-zinc-200 dark:border-zinc-800">
                        <table className="w-full border-separate border-spacing-0 text-xs">
                          <thead>
                            <tr>
                              {preview.headers.map((header, index) => (
                                <th
                                  key={`${header}-${index}`}
                                  className="sticky top-0 bg-white px-2 py-1.5 text-left font-medium dark:bg-zinc-900"
                                >
                                  {header || '—'}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.map((row, rowIndex) => (
                              <tr key={`${item.month}-${rowIndex}`}>
                                {preview.headers.map((_, column) => (
                                  <td
                                    key={`${item.month}-${rowIndex}-${column}`}
                                    className="px-2 py-1.5 align-top"
                                  >
                                    {row[column] || '—'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" />
              选择文件上传
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {error ? (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {months.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          上传每月的售后问题登记表后，这里按登记月份汇总客诉。
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          没有符合过滤条件的客诉数据。
        </p>
      ) : (
        <DashboardGrid
          storageKey={LAYOUT_KEY}
          widgets={WIDGETS}
          defaultLayout={DEFAULT_LAYOUT}
          render={(id) => renderWidget(id, rows, slices, bars)}
        />
      )}
    </section>
  );
}
