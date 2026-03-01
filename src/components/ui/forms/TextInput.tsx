import React, { InputHTMLAttributes, forwardRef } from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<TextInputVariant, string> = {
  settings: 'sor-settings-input',
  'settings-sm': 'sor-settings-input sor-settings-input-sm',
  form: 'sor-form-input',
  'form-sm': 'sor-form-input-sm',
  'form-xs': 'sor-form-input-xs',
};

/* ── Types ────────────────────────────────────────────────────── */
export type TextInputVariant = 'settings' | 'settings-sm' | 'form' | 'form-sm' | 'form-xs';

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visual variant. Defaults to `"form"`. */
  variant?: TextInputVariant;
}

/**
 * Text input primitive.
 *
 * Wraps `<input type="text">` with project CSS classes.
 * Use `type="email"`, `type="url"`, etc. via the underlying HTML attribute
 * (passed through via `...rest`).
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ variant = 'form', className, ...rest }, ref) => (
    <input
      ref={ref}
      type="text"
      className={cx(VARIANT_CLASS[variant], className)}
      {...rest}
    />
  ),
);

TextInput.displayName = 'TextInput';

export default TextInput;
