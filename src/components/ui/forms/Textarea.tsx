import React, { TextareaHTMLAttributes, forwardRef } from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<TextareaVariant, string> = {
  form: 'sor-form-textarea',
  'form-sm': 'sor-form-textarea-sm',
  'form-xs': 'sor-form-textarea-xs',
};

/* ── Types ────────────────────────────────────────────────────── */
export type TextareaVariant = 'form' | 'form-sm' | 'form-xs';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visual variant. Defaults to `"form"`. */
  variant?: TextareaVariant;
}

/**
 * Textarea primitive.
 *
 * Wraps `<textarea>` with project CSS classes.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ variant = 'form', className, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={cx(VARIANT_CLASS[variant], className)}
      {...rest}
    />
  ),
);

Textarea.displayName = 'Textarea';

export default Textarea;
