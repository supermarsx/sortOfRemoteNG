import React, { TextareaHTMLAttributes, forwardRef } from 'react';
import { cx } from '../lib/cx';

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<TextareaVariant, string> = {
  form: 'sor-form-textarea',
  'form-sm': 'sor-form-textarea-sm',
  'form-xs': 'sor-form-textarea-xs',
};

/* ── Types ────────────────────────────────────────────────────── */
export type TextareaVariant = 'form' | 'form-sm' | 'form-xs';

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  /** Visual variant. Defaults to `"form"`. */
  variant?: TextareaVariant;
  /** Simplified string callback. */
  onChange?: (value: string) => void;
  /** Label text (consumed by wrapper layouts, not rendered by Textarea itself). */
  label?: string;
  /** Error message to display. When set, marks the textarea as invalid. */
  error?: string;
  /** Helper text displayed below the textarea. */
  helperText?: string;
}

/**
 * Textarea primitive.
 *
 * Wraps `<textarea>` with project CSS classes.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ variant = 'form', className, label, onChange, error, helperText, ...rest }, ref) => {
    const descriptionId = rest.id ? `${rest.id}-desc` : undefined;
    const hasDescription = !!(error || helperText);

    const textarea = (
      <textarea
        ref={ref}
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

    if (!hasDescription) return textarea;

    return (
      <div className="flex flex-col">
        {textarea}
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

Textarea.displayName = 'Textarea';

export default Textarea;
