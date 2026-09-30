import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SuggestOption {
  value: string;
  label: string;
}

export function SuggestInput({
  value,
  options,
  placeholder,
  onChange,
  onPick,
}: {
  value: string;
  options: SuggestOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  onPick?: (option: SuggestOption) => void;
}) {
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const keyword = value.trim().toLowerCase();
  const matches = options.filter(
    (option) =>
      option.label.toLowerCase().includes(keyword) ||
      option.value.toLowerCase().includes(keyword),
  );

  useEffect(() => {
    setActive(0);
  }, [value]);

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

  const pick = (option: SuggestOption) => {
    onChange(option.value);
    onPick?.(option);
    setOpen(false);
  };

  return (
    <div ref={container} className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
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
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-md"
        >
          {matches.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={index === active}
            >
              <button
                type="button"
                className={cn(
                  'block w-full truncate px-3 py-1.5 text-left',
                  index === active ? 'bg-zinc-100' : 'hover:bg-zinc-50',
                )}
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
