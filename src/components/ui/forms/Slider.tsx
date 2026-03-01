import React, { InputHTMLAttributes } from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<SliderVariant, string> = {
  default: 'sor-settings-range',
  wide: 'sor-settings-range sor-settings-range-wide',
  full: 'sor-settings-range-full',
};

/* ── Types ────────────────────────────────────────────────────── */
export type SliderVariant = 'default' | 'wide' | 'full';

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Visual variant. Defaults to `"default"`. */
  variant?: SliderVariant;
}

/**
 * Range slider primitive.
 *
 * Wraps `<input type="range">` with project CSS classes and a
 * simplified `onChange(number)` callback.
 */
export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  variant = 'default',
  className,
  ...rest
}) => (
  <input
    type="range"
    value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    min={min}
    max={max}
    step={step}
    className={cx(VARIANT_CLASS[variant], className)}
    {...rest}
  />
);

export default Slider;
