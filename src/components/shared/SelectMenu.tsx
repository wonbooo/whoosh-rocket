import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type {
  SuggestColors,
  SuggestOption,
} from '@/components/shared/SuggestInput';

export function SelectMenu({
  value,
  options,
  placeholder,
  colors,
  className,
  'aria-label': ariaLabel,
  onChange,
}: {
  value: string;
  options: SuggestOption[];
  placeholder?: string;
  colors?: SuggestColors;
  className?: string;
  'aria-label'?: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = options.findIndex((option) => option.value === value);
  const label = selected >= 0 ? options[selected]?.label : (placeholder ?? '');

  useEffect(() => {
    if (!open) {
      return;
    }
    setActive(selected >= 0 ? selected : 0);
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, selected]);

  const pick = (option: SuggestOption) => {
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div ref={container} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.min(current + 1, options.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && open && options[active]) {
            event.preventDefault();
            pick(options[active]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open && options.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-md border py-1 text-sm shadow-md"
          style={{
            background: colors?.panel ?? '#ffffff',
            borderColor: colors?.border ?? '#e4e4e7',
            color: colors?.text ?? '#18181b',
          }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
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
