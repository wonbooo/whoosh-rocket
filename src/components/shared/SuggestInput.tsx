import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

export interface SuggestOption {
  value: string;
  label: string;
}

export interface SuggestColors {
  panel: string;
  panelAlt: string;
  border: string;
  text: string;
}

function findMatch(
  options: SuggestOption[],
  query: string,
): SuggestOption | null {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const exact = options.find(
    (option) =>
      option.value.toLowerCase() === trimmed ||
      option.label.toLowerCase() === trimmed,
  );
  if (exact) {
    return exact;
  }
  const narrowed = options.filter(
    (option) =>
      option.label.toLowerCase().includes(trimmed) ||
      option.value.toLowerCase().includes(trimmed),
  );
  return narrowed.length === 1 ? narrowed[0] : null;
}

export function SuggestInput({
  value,
  options,
  placeholder,
  colors,
  onChange,
  onPick,
  onQuery,
}: {
  value: string;
  options: SuggestOption[];
  placeholder?: string;
  colors?: SuggestColors;
  onChange: (value: string) => void;
  onPick?: (option: SuggestOption) => void;
  onQuery?: (query: string) => void;
}) {
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState<string | null>(null);

  const matched = options.find((option) => option.value === value);
  const display = query ?? matched?.label ?? value;
  const keyword = (query ?? '').trim().toLowerCase();
  const matches = keyword
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(keyword) ||
          option.value.toLowerCase().includes(keyword),
      )
    : options;

  useEffect(() => {
    setQuery(null);
  }, [value]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const apply = (next: string, option?: SuggestOption) => {
    if (next !== value) {
      onChange(next);
    }
    if (option && option.value !== value) {
      onPick?.(option);
    }
    setQuery(null);
    setOpen(false);
  };

  const pick = (option: SuggestOption) => {
    apply(option.value, option);
  };

  const commitQuery = () => {
    if (query === null) {
      return;
    }
    const trimmed = query.trim();
    const chosen = findMatch(options, trimmed);
    if (chosen) {
      apply(chosen.value, chosen);
      return;
    }
    apply(trimmed);
  };

  return (
    <div ref={container} className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={display}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          onQuery?.(event.target.value);
        }}
        onFocus={(event) => {
          setOpen(true);
          const index = options.findIndex((option) => option.value === value);
          setActive(index >= 0 ? index : 0);
          event.currentTarget.select();
        }}
        onBlur={() => {
          commitQuery();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.min(current + 1, matches.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && open && matches[active]) {
            event.preventDefault();
            pick(matches[active]);
          } else if (event.key === 'Escape') {
            setQuery(null);
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border py-1 text-sm shadow-md"
          style={{
            background: colors?.panel ?? '#ffffff',
            borderColor: colors?.border ?? '#e4e4e7',
            color: colors?.text ?? '#18181b',
          }}
        >
          {matches.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={index === active}
            >
              <button
                type="button"
                className="block w-full truncate px-3 py-1.5 text-left"
                style={{
                  background:
                    index === active
                      ? (colors?.panelAlt ?? '#f4f4f5')
                      : 'transparent',
                }}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
