import React, { InputHTMLAttributes, forwardRef } from 'react';
import { cx } from '../lib/cx';

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
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  /** Visual variant. Defaults to `"form"`. */
  variant?: TextInputVariant;
  /** Simplified string callback. */
  onChange?: (value: string) => void;
  /** Label text (consumed by wrapper layouts, not rendered by TextInput itself). */
  label?: string;
  /** Error message to display. When set, marks the input as invalid. */
  error?: string;
  /** Helper text displayed below the input. */
  helperText?: string;
}

/**
 * Text input primitive.
 *
 * Wraps `<input type="text">` with project CSS classes.
 * Use `type="email"`, `type="url"`, etc. via the underlying HTML attribute
 * (passed through via `...rest`).
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ variant = 'form', className, label, onChange, error, helperText, ...rest }, ref) => {
    const descriptionId = rest.id ? `${rest.id}-desc` : undefined;
    const hasDescription = !!(error || helperText);

    const input = (
      <input
        ref={ref}
        type="text"
        className={cx(
          VARIANT_CLASS[variant],
          error && 'border-error',
          className,
        )}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-label={rest['aria-label'] ?? label}
        aria-invalid={error ? true : undefined}
        aria-describedby={hasDescription ? descriptionId : undefined}
        {...rest}
      />
    );

    if (!hasDescription) return input;

    return (
      <div className="flex flex-col">
        {input}
        <span
          id={descriptionId}
          className={cx(
            'text-xs mt-1',
            error ? 'text-error' : 'text-[var(--color-textMuted)]',
          )}
        >
          {error || helperText}
        </span>
      </div>
    );
  },
);

TextInput.displayName = 'TextInput';

export default TextInput;
