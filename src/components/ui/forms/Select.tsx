import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { cx } from '../lib/cx';

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<SelectVariant, string> = {
  settings: 'sor-settings-select',
  form: 'sor-form-select',
  'form-sm': 'sor-form-select-sm',
};

/* ── Types ────────────────────────────────────────────────────── */
export type SelectVariant = 'settings' | 'form' | 'form-sm';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  title?: string;
  icon?: LucideIcon;
}

export interface SelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Placeholder shown when no value is selected. */
  placeholder?: string;
  /** Visual variant. Defaults to `"settings"`. */
  variant?: SelectVariant;
  /** Label text (consumed by wrapper layouts, not rendered by Select itself). */
  label?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  'data-testid'?: string;
  /** Show a filter input at the top of the dropdown to search options. */
  searchable?: boolean;
  /** Placeholder for the search input (when `searchable`). */
  searchPlaceholder?: string;
}

/**
 * Custom themed Select / dropdown.
 *
 * Renders a button trigger with a portal-based dropdown panel that uses
 * the app's theme variables for full visual consistency.
 */
export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  variant = 'settings',
  className,
  disabled,
  id,
  label,
  title,
  'data-testid': dataTestId,
  searchable = false,
  searchPlaceholder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Options visible after the search filter (case-insensitive label match).
  const visibleOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [searchable, search, options]);
  const itemsRef = useRef<(HTMLDivElement | null)[]>([]);

  const selectedOption = options.find((o) => String(o.value) === String(value));
  const displayLabel = selectedOption?.label ?? placeholder ?? '';

  // ── Position the dropdown ───────────────────────────────────
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    const dd = dropdownRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ddHeight = dd?.offsetHeight ?? 200;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    // Flip above if not enough space below and more space above
    const top = spaceBelow < ddHeight && spaceAbove > spaceBelow
      ? rect.top - ddHeight - 4
      : rect.bottom + 4;
    // Clamp horizontal — use the dropdown's actual rendered width
    // when it's already mounted so wide option labels don't push the
    // panel past the right edge of the viewport. Falls back to the
    // 200px minimum for the first paint (before the dropdown mounts).
    let left = rect.left;
    const measuredWidth = dd?.offsetWidth ?? 0;
    const effectiveWidth = Math.max(rect.width, 200, measuredWidth);
    if (left + effectiveWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - effectiveWidth - 8);
    }
    setPos({ top, left, width: rect.width });
  }, []);

  const open = useCallback(() => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
    // Pre-highlight current value
    const idx = options.findIndex((o) => String(o.value) === String(value));
    setHighlightIdx(idx >= 0 ? idx : 0);
    if (searchable) {
      // Focus the filter input once the portal has mounted.
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [disabled, updatePosition, options, value, searchable]);

  const close = useCallback(() => {
    setIsOpen(false);
    setHighlightIdx(-1);
    setSearch('');
    triggerRef.current?.focus();
  }, []);

  const selectOption = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      onChange(String(opt.value));
      close();
    },
    [onChange, close],
  );

  // ── Click outside ───────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, close]);

  // ── Scroll / resize ─────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    // Re-measure after the dropdown mounts so wide option labels can
    // clamp the panel back inside the viewport (first call inside
    // `open` ran before the dropdown existed).
    const raf = requestAnimationFrame(() => updatePosition());
    const reposition = () => updatePosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [isOpen, updatePosition]);

  // ── Scroll highlighted item into view ───────────────────────
  useEffect(() => {
    if (!isOpen || highlightIdx < 0) return;
    itemsRef.current[highlightIdx]?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, highlightIdx]);

  // ── Keyboard navigation ─────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          open();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          let next = highlightIdx + 1;
          while (next < visibleOptions.length && visibleOptions[next].disabled) next++;
          if (next < visibleOptions.length) setHighlightIdx(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          let prev = highlightIdx - 1;
          while (prev >= 0 && visibleOptions[prev].disabled) prev--;
          if (prev >= 0) setHighlightIdx(prev);
          break;
        }
        case 'Home': {
          e.preventDefault();
          let first = 0;
          while (first < visibleOptions.length && visibleOptions[first].disabled) first++;
          if (first < visibleOptions.length) setHighlightIdx(first);
          break;
        }
        case 'End': {
          e.preventDefault();
          let last = visibleOptions.length - 1;
          while (last >= 0 && visibleOptions[last].disabled) last--;
          if (last >= 0) setHighlightIdx(last);
          break;
        }
        case ' ': {
          // In searchable mode let Space type into the filter input.
          if (searchable) break;
          e.preventDefault();
          if (highlightIdx >= 0 && highlightIdx < visibleOptions.length) {
            selectOption(visibleOptions[highlightIdx]);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (highlightIdx >= 0 && highlightIdx < visibleOptions.length) {
            selectOption(visibleOptions[highlightIdx]);
          }
          break;
        }
        case 'Escape':
        case 'Tab':
          e.preventDefault();
          close();
          break;
      }
    },
    [isOpen, disabled, highlightIdx, visibleOptions, searchable, open, close, selectOption],
  );

  const dropdownMinWidth = Math.max(pos.width, 200);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={label}
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={handleKeyDown}
        data-testid={dataTestId}
        className={cx(
          VARIANT_CLASS[variant],
          'sor-select-trigger',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
      >
        <span className="sor-select-trigger-label inline-flex items-center gap-2 min-w-0">
          {selectedOption?.icon && (
            <selectedOption.icon size={14} className="flex-shrink-0 text-[var(--color-textSecondary)]" />
          )}
          <span className="truncate">{displayLabel}</span>
        </span>
        <ChevronDown
          size={14}
          className={cx(
            'sor-select-chevron',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            className="sor-select-dropdown sor-popover-panel"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: dropdownMinWidth,
              zIndex: 99999,
            }}
          >
            {searchable && (
              <div className="sor-select-search">
                <Search size={14} className="sor-select-search-icon" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  placeholder={searchPlaceholder ?? 'Search…'}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setHighlightIdx(0);
                  }}
                  onKeyDown={handleKeyDown}
                  className="sor-select-search-input"
                  aria-label={searchPlaceholder ?? 'Search options'}
                />
              </div>
            )}
            <div className="sor-select-dropdown-scroll">
              {visibleOptions.length === 0 && (
                <div className="sor-select-option sor-select-option-disabled">
                  <span className="sor-select-option-label">No matches</span>
                </div>
              )}
              {visibleOptions.map((opt, i) => {
                const isSelected = String(opt.value) === String(value);
                const isHighlighted = i === highlightIdx;
                return (
                  <div
                    key={opt.value}
                    ref={(el) => { itemsRef.current[i] = el; }}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    title={opt.title}
                    className={cx(
                      'sor-select-option',
                      isHighlighted && 'sor-select-option-highlighted',
                      isSelected && 'sor-select-option-selected',
                      opt.disabled && 'sor-select-option-disabled',
                    )}
                    onMouseEnter={() => !opt.disabled && setHighlightIdx(i)}
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent blur
                      selectOption(opt);
                    }}
                  >
                    <span className="sor-select-option-label inline-flex items-center gap-2 min-w-0">
                      {opt.icon && (
                        <opt.icon size={14} className="flex-shrink-0 text-[var(--color-textSecondary)]" />
                      )}
                      <span className="truncate">{opt.label}</span>
                    </span>
                    {isSelected && (
                      <Check size={14} className="sor-select-option-check" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default Select;
