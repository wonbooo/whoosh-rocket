import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function parseMonth(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() + 1 };
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

function formatMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function MonthPicker({
  label,
  value,
  after,
  before,
  className,
  onChange,
}: {
  label: string;
  value: string;
  after?: string;
  before?: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = parseMonth(value);
  const [year, setYear] = useState(selected.year);

  useEffect(() => {
    if (open) {
      setYear(selected.year);
    }
  }, [open, selected.year]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className ?? ''}`}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 text-left text-sm dark:border-zinc-700 dark:bg-zinc-900"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value ? undefined : 'text-zinc-400'}>
          {value || '选择年月'}
        </span>
        <ChevronRight className="h-4 w-4 rotate-90 opacity-60" />
      </button>
      {open ? (
        <div
          id={listId}
          className="absolute z-20 mt-1 w-64 rounded-md border border-zinc-200 bg-white p-3 shadow-md dark:border-zinc-700 dark:bg-zinc-950"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="上一年"
              className="rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setYear((current) => current - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{year}</span>
            <button
              type="button"
              aria-label="下一年"
              className="rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setYear((current) => current + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((month) => {
              const token = formatMonth(year, month);
              const active = token === value;
              const blocked =
                (after != null && after !== '' && token < after) ||
                (before != null && before !== '' && token > before);
              return (
                <button
                  key={month}
                  type="button"
                  aria-label={token}
                  disabled={blocked}
                  className={
                    blocked
                      ? 'cursor-not-allowed rounded-md px-2 py-1.5 text-sm text-zinc-300 dark:text-zinc-600'
                      : active
                        ? 'rounded-md bg-blue-600 px-2 py-1.5 text-sm text-white'
                        : 'rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }
                  onClick={() => {
                    if (blocked) {
                      return;
                    }
                    onChange(token);
                    setOpen(false);
                  }}
                >
                  {month}月
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
