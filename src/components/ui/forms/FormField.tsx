import React from 'react';
import { cx } from '../lib/cx';

export type FormFieldLayout = 'stacked' | 'inline';

export interface FormFieldProps {
  /** Label text displayed above (stacked) or beside (inline) the input */
  label: React.ReactNode;
  /** Associates the label with an input via htmlFor */
  htmlFor?: string;
  /** Error message shown below the input in red */
  error?: string;
  /** Hint text shown below the input in muted color */
  hint?: string;
  /** Whether the field is required (shows * after label) */
  required?: boolean;
  /** Layout mode: stacked (label above) or inline (label beside) */
  layout?: FormFieldLayout;
  /** Additional className on the wrapper */
  className?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  error,
  hint,
  required,
  layout = 'stacked',
  className,
  children,
}) => (
  <div
    className={cx(
      layout === 'inline' ? 'sor-form-field-inline' : 'sor-form-field',
      error && 'sor-form-field-error',
      className,
    )}
  >
    <label htmlFor={htmlFor} className={layout === 'inline' ? 'sor-form-field-inline-label' : 'sor-form-field-label'}>
      {label}
      {required && <span className="sor-form-field-required">*</span>}
    </label>
    {children}
    {error && <p className="sor-form-field-error-text">{error}</p>}
    {hint && !error && <p className="sor-form-field-hint">{hint}</p>}
  </div>
);
