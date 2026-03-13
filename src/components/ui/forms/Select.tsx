import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
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
  title,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
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
    // Clamp horizontal
    let left = rect.left;
    const minW = Math.max(rect.width, 200);
    if (left + minW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - minW - 8);
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
  }, [disabled, updatePosition, options, value]);

  const close = useCallback(() => {
    setIsOpen(false);
    setHighlightIdx(-1);
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
    const reposition = () => updatePosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
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
          while (next < options.length && options[next].disabled) next++;
          if (next < options.length) setHighlightIdx(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          let prev = highlightIdx - 1;
          while (prev >= 0 && options[prev].disabled) prev--;
          if (prev >= 0) setHighlightIdx(prev);
          break;
        }
        case 'Home': {
          e.preventDefault();
          let first = 0;
          while (first < options.length && options[first].disabled) first++;
          if (first < options.length) setHighlightIdx(first);
          break;
        }
        case 'End': {
          e.preventDefault();
          let last = options.length - 1;
          while (last >= 0 && options[last].disabled) last--;
          if (last >= 0) setHighlightIdx(last);
          break;
        }
        case 'Enter':
        case ' ': {
          e.preventDefault();
          if (highlightIdx >= 0 && highlightIdx < options.length) {
            selectOption(options[highlightIdx]);
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
    [isOpen, disabled, highlightIdx, options, open, close, selectOption],
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
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={handleKeyDown}
        className={cx(
          VARIANT_CLASS[variant],
          'sor-select-trigger',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
      >
        <span className="sor-select-trigger-label">{displayLabel}</span>
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
            <div className="sor-select-dropdown-scroll">
              {options.map((opt, i) => {
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
                    <span className="sor-select-option-label">{opt.label}</span>
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
