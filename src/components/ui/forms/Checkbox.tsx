import React, { InputHTMLAttributes } from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

/* ── Variant → CSS class mapping ──────────────────────────────── */
const VARIANT_CLASS: Record<CheckboxVariant, string> = {
  settings: 'sor-settings-checkbox',
  form: 'sor-form-checkbox',
};

/* ── Types ────────────────────────────────────────────────────── */
export type CheckboxVariant = 'settings' | 'form';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visual variant. Defaults to `"settings"`. */
  variant?: CheckboxVariant;
}

/**
 * Low-level checkbox primitive.
 *
 * Wraps `<input type="checkbox">` with the project's CSS classes and
 * a simplified `onChange(boolean)` callback.
 *
 * For a labeled checkbox row, use `<CheckboxField>` instead.
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  variant = 'settings',
  className,
  ...rest
}) => (
  <input
    type="checkbox"
    checked={checked}
    onChange={(e) => onChange(e.target.checked)}
    className={cx(VARIANT_CLASS[variant], className)}
    {...rest}
  />
);

/* ── CheckboxField (labeled checkbox) ─────────────────────────── */
export interface CheckboxFieldProps extends CheckboxProps {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** CSS classes for the outer `<label>` wrapper. */
  wrapperClassName?: string;
  /** CSS classes for the label text `<span>`. */
  labelClassName?: string;
  /** Place the checkbox to the right of the label (settings layout). */
  reverse?: boolean;
  /** `data-setting-key` value for GPO/search identification. */
  settingKey?: string;
}

/**
 * Labeled checkbox with optional icon and description.
 *
 * The default layout matches the most common settings pattern:
 * `[checkbox] [icon?] [label]`
 *
 * Set `reverse` to render `[label] … [checkbox]` (right-aligned toggle).
 */
export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  label,
  description,
  icon,
  wrapperClassName,
  labelClassName,
  reverse = false,
  settingKey,
  /* CheckboxProps */
  checked,
  onChange,
  variant = 'settings',
  className,
  disabled,
  ...rest
}) => {
  const checkbox = (
    <Checkbox
      checked={checked}
      onChange={onChange}
      variant={variant}
      className={className}
      disabled={disabled}
      {...rest}
    />
  );

  return (
    <label
      className={cx(
        reverse
          ? 'flex items-center justify-between cursor-pointer group'
          : 'flex items-center space-x-3 cursor-pointer group',
        disabled && 'opacity-50 pointer-events-none',
        wrapperClassName,
      )}
      {...(settingKey ? { 'data-setting-key': settingKey } : {})}
    >
      {reverse ? (
        <>
          <div className="flex items-center gap-3">
            {icon && <div className="sor-settings-toggle-icon">{icon}</div>}
            <div className="min-w-0">
              <span className={cx('text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]', labelClassName)}>
                {label}
              </span>
              {description && (
                <p className="text-[10px] text-[var(--color-textMuted)] mt-0.5">{description}</p>
              )}
            </div>
          </div>
          {checkbox}
        </>
      ) : (
        <>
          {checkbox}
          {icon && (
            <div className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-blue-400 flex items-center">
              {icon}
            </div>
          )}
          <span className={cx('text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]', labelClassName)}>
            {label}
          </span>
          {description && (
            <p className="text-[10px] text-[var(--color-textMuted)] mt-0.5">{description}</p>
          )}
        </>
      )}
    </label>
  );
};

export default Checkbox;
