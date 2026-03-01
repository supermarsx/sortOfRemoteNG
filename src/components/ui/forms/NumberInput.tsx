import React, { InputHTMLAttributes } from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<NumberInputVariant, string> = {
  settings: 'sor-settings-input',
  'settings-compact': 'sor-settings-input sor-settings-input-compact',
  form: 'sor-form-input',
  'form-sm': 'sor-form-input-sm',
};

/* ── Types ────────────────────────────────────────────────────── */
export type NumberInputVariant = 'settings' | 'settings-compact' | 'form' | 'form-sm';

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  value: number;
  onChange: (value: number) => void;
  /** Visual variant. Defaults to `"settings"`. */
  variant?: NumberInputVariant;
  /** Clamp the output value between `min` and `max`. Defaults to `true`. */
  clamp?: boolean;
}

/**
 * Numeric input primitive.
 *
 * Wraps `<input type="number">` with project CSS classes and a
 * simplified `onChange(number)` callback. Values are parsed with
 * `Number()` and optionally clamped to the `min`/`max` range.
 */
export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  variant = 'settings',
  clamp = true,
  className,
  min,
  max,
  ...rest
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = Number(e.target.value);
    if (Number.isNaN(v)) v = 0;
    if (clamp) {
      if (min !== undefined) v = Math.max(Number(min), v);
      if (max !== undefined) v = Math.min(Number(max), v);
    }
    onChange(v);
  };

  return (
    <input
      type="number"
      value={value}
      onChange={handleChange}
      min={min}
      max={max}
      className={cx(VARIANT_CLASS[variant], className)}
      {...rest}
    />
  );
};

export default NumberInput;
