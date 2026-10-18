import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import GridLayout, { getCompactor, useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import { Button } from '@/components/ui/button';

export function DashboardGrid<Id extends string>({
  storageKey,
  widgets,
  defaultLayout,
  render,
}: {
  storageKey: string;
  widgets: { id: Id; title: string }[];
  defaultLayout: LayoutItem[];
  render: (id: Id) => ReactNode;
}) {
  const [layout, setLayout] = useState<LayoutItem[]>(() =>
    readLayout(storageKey, widgets, defaultLayout),
  );
  const layoutRef = useRef(layout);
  const [expanded, setExpanded] = useState<Id | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();
  const handleLayoutChange = useCallback(
    (next: readonly LayoutItem[]) => {
      const normalized = normalizeLayout(next, widgets, defaultLayout);
      if (sameLayout(layoutRef.current, normalized)) {
        return;
      }
      layoutRef.current = normalized;
      localStorage.setItem(storageKey, JSON.stringify(normalized));
      setLayout(normalized);
    },
    [defaultLayout, storageKey, widgets],
  );
  const gridWidth = width > 0 ? width : 1280;
  const expandedTitle =
    widgets.find((widget) => widget.id === expanded)?.title ?? '';

  return (
    <div ref={containerRef} className="w-full">
      {mounted ? (
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
          {widgets.map((widget) => (
            <div key={widget.id}>
              <WidgetCard
                title={widget.title}
                onExpand={() => setExpanded(widget.id)}
              >
                {render(widget.id)}
              </WidgetCard>
            </div>
          ))}
        </GridLayout>
      ) : null}
      {expanded ? (
        <ExpandedCard title={expandedTitle} onClose={() => setExpanded(null)}>
          {render(expanded)}
        </ExpandedCard>
      ) : null}
    </div>
  );
}

function readLayout<Id extends string>(
  storageKey: string,
  widgets: { id: Id }[],
  fallback: LayoutItem[],
): LayoutItem[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    return normalizeLayout(parsed, widgets, fallback);
  } catch {
    return fallback;
  }
}

function normalizeLayout<Id extends string>(
  items: readonly unknown[],
  widgets: { id: Id }[],
  fallback: LayoutItem[],
): LayoutItem[] {
  const ids = new Set(widgets.map((widget) => widget.id));
  const saved = new Map<string, LayoutItem>();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Partial<LayoutItem>;
    if (typeof record.i !== 'string' || !ids.has(record.i as Id)) {
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
  if (saved.size !== widgets.length) {
    return fallback;
  }
  return fallback.map((item) => {
    const savedItem = saved.get(item.i);
    if (!savedItem) {
      return item;
    }
    return {
      ...item,
      x: savedItem.x,
      y: savedItem.y,
      w: savedItem.w,
      h: savedItem.h,
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
