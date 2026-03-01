import React, { SelectHTMLAttributes } from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<SelectVariant, string> = {
  settings: 'sor-settings-select',
  form: 'sor-form-select',
  'form-sm': 'sor-form-select-sm',
};

/* ── Types ────────────────────────────────────────────────────── */
export type SelectVariant = 'settings' | 'form' | 'form-sm';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Placeholder shown as a disabled first option. */
  placeholder?: string;
  /** Visual variant. Defaults to `"settings"`. */
  variant?: SelectVariant;
}

/**
 * Select / dropdown primitive.
 *
 * Wraps `<select>` with project CSS classes and a simplified
 * `onChange(string)` callback.
 */
export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  variant = 'settings',
  className,
  ...rest
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={cx(VARIANT_CLASS[variant], className)}
    {...rest}
  >
    {placeholder && (
      <option value="" disabled>
        {placeholder}
      </option>
    )}
    {options.map((opt) => (
      <option key={opt.value} value={opt.value} disabled={opt.disabled} title={opt.title}>
        {opt.label}
      </option>
    ))}
  </select>
);

export default Select;
