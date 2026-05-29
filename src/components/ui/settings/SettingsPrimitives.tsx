import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cx } from '../lib/cx';
import { Select } from '../forms/Select';
import { PasswordInput } from '../forms/PasswordInput';
import { InfoTooltip } from '../InfoTooltip';

interface BaseSettingProps {
  settingKey?: string;
  className?: string;
}

export const SettingsSectionHeader: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  className?: string;
}> = ({ icon, title, className }) => (
  <h4 className={cx('sor-settings-section-header', className)}>
    {icon}
    {title}
  </h4>
);

export const SettingsCard: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cx('sor-settings-card', className)}>{children}</div>
);

interface SettingsToggleRowProps extends BaseSettingProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
  description?: string;
  infoTooltip?: string;
  /** Optional id forwarded to the underlying checkbox. */
  inputId?: string;
  /** Optional data-testid forwarded to the underlying checkbox. */
  testId?: string;
  /** Optional disabled forwarded to the underlying checkbox. */
  disabled?: boolean;
}

export const SettingsToggleRow: React.FC<SettingsToggleRowProps> = ({
  checked,
  onChange,
  icon,
  label,
  description,
  settingKey,
  className,
  infoTooltip,
  inputId,
  testId,
  disabled,
}) => (
  <label
    className={cx('sor-settings-toggle-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="sor-settings-checkbox"
      {...(inputId ? { id: inputId } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
      disabled={disabled}
    />
    {icon && <div className="sor-settings-toggle-icon">{icon}</div>}
    <div className="min-w-0">
      <span className="sor-settings-toggle-label flex items-center gap-1">{label}{infoTooltip && <InfoTooltip text={infoTooltip} />}</span>
      {description && <p className="sor-settings-toggle-description">{description}</p>}
    </div>
  </label>
);

interface SettingsSliderRowProps extends BaseSettingProps {
  label: string;
  icon?: React.ReactNode;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  infoTooltip?: string;
}

export const SettingsSliderRow: React.FC<SettingsSliderRowProps> = ({
  label,
  icon,
  description,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  settingKey,
  className,
  infoTooltip,
}) => (
  <div
    className={cx('sor-settings-slider-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <div className="min-w-0">
      <span className="sor-settings-row-label flex items-center gap-1">
        {icon && <span className="text-[var(--color-textSecondary)] mr-1">{icon}</span>}
        {label}{infoTooltip && <InfoTooltip text={infoTooltip} />}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
    <div className="sor-settings-slider-controls">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sor-settings-range"
      />
      <span className="sor-settings-slider-value">
        {value}
        {unit}
      </span>
    </div>
  </div>
);

interface SelectOption {
  value: string;
  label: string;
}

interface SettingsSelectRowProps extends BaseSettingProps {
  label: string;
  icon?: React.ReactNode;
  description?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  infoTooltip?: string;
  /** Show a filter input in the dropdown (for long option lists). */
  searchable?: boolean;
  searchPlaceholder?: string;
}

export const SettingsSelectRow: React.FC<SettingsSelectRowProps> = ({
  label,
  icon,
  description,
  value,
  options,
  onChange,
  settingKey,
  className,
  infoTooltip,
  searchable,
  searchPlaceholder,
}) => (
  <div
    className={cx('sor-settings-select-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <div className="min-w-0">
      <span className="sor-settings-row-label flex items-center gap-1">
        {icon && <span className="text-[var(--color-textSecondary)] mr-1">{icon}</span>}
        {label}{infoTooltip && <InfoTooltip text={infoTooltip} />}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
    <Select
      value={value}
      onChange={onChange}
      options={options}
      variant="settings"
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
    />
  </div>
);

export const SettingsCollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}> = ({ title, icon, children, defaultOpen = true, className }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cx('sor-settings-collapsible', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="sor-settings-collapsible-trigger"
      >
        <div className="sor-settings-collapsible-title">
          {icon}
          <span>{title}</span>
        </div>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {isOpen && <div className="sor-settings-collapsible-body">{children}</div>}
    </div>
  );
};

interface SettingsTextRowProps extends BaseSettingProps {
  label: string;
  icon?: React.ReactNode;
  description?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  infoTooltip?: string;
  /** Optional element rendered after the input (e.g. a Browse button). */
  trailing?: React.ReactNode;
}

export const SettingsTextRow: React.FC<SettingsTextRowProps> = ({
  label,
  icon,
  description,
  value,
  placeholder,
  onChange,
  settingKey,
  className,
  infoTooltip,
  trailing,
}) => (
  <div
    className={cx('sor-settings-select-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <div className="min-w-0">
      <span className="sor-settings-row-label flex items-center gap-1">
        {icon && <span className="text-[var(--color-textSecondary)] mr-1">{icon}</span>}
        {label}{infoTooltip && <InfoTooltip text={infoTooltip} />}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
    {trailing ? (
      <div className="flex items-center gap-2 min-w-0 sor-settings-row-control ml-auto">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="sor-settings-input"
          style={{ width: '22rem' }}
        />
        {trailing}
      </div>
    ) : (
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="sor-settings-input"
      />
    )}
  </div>
);

interface SettingsNumberRowProps extends BaseSettingProps {
  label: string;
  icon?: React.ReactNode;
  description?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  infoTooltip?: string;
}

export const SettingsNumberRow: React.FC<SettingsNumberRowProps> = ({
  label,
  icon,
  description,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  settingKey,
  className,
  infoTooltip,
}) => (
  <div
    className={cx('sor-settings-select-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <div className="min-w-0">
      <span className="sor-settings-row-label flex items-center gap-1">
        {icon && <span className="text-[var(--color-textSecondary)] mr-1">{icon}</span>}
        {label}{unit && ` (${unit})`}{infoTooltip && <InfoTooltip text={infoTooltip} />}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="sor-settings-input"
      style={{ width: '5rem' }}
    />
  </div>
);

interface SettingsColorRowProps extends BaseSettingProps {
  label: string;
  icon?: React.ReactNode;
  description?: string;
  /** The persisted color value (e.g. "#3b82f6"). May be empty when a
   *  fallback like "follows accent" applies. */
  value: string;
  onChange: (value: string) => void;
  /** Hex used by the underlying color input when `value` is empty or not a
   *  valid hex. Defaults to `#3b82f6`. */
  fallbackValue?: string;
  /** What to show in the hex chip. Defaults to `value` (or "(default)"). */
  chipLabel?: string;
  infoTooltip?: string;
  /** Optional element rendered between the picker and the hex chip
   *  (e.g. a "Match loader" / clear button). */
  trailing?: React.ReactNode;
}

export const SettingsColorRow: React.FC<SettingsColorRowProps> = ({
  label,
  icon,
  description,
  value,
  onChange,
  fallbackValue = '#3b82f6',
  chipLabel,
  settingKey,
  className,
  infoTooltip,
  trailing,
}) => {
  const pickerValue = value && value.startsWith('#') ? value : fallbackValue;
  const chip = chipLabel ?? value ?? '';
  return (
    <div
      className={cx('sor-settings-select-row', className)}
      {...(settingKey ? { 'data-setting-key': settingKey } : {})}
    >
      <div className="min-w-0">
        <span className="sor-settings-row-label flex items-center gap-1">
          {icon && <span className="text-[var(--color-textSecondary)] mr-1">{icon}</span>}
          {label}{infoTooltip && <InfoTooltip text={infoTooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-8 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer"
        />
        {trailing}
        <span className="text-xs text-[var(--color-textMuted)] bg-[var(--color-surface)] px-2 py-1 rounded font-mono">
          {chip}
        </span>
      </div>
    </div>
  );
};

interface SettingsPasswordRowProps extends BaseSettingProps {
  label: string;
  icon?: React.ReactNode;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  infoTooltip?: string;
  disabled?: boolean;
  /** Width of the input container. Defaults to `18rem` to match the
   *  Backup / Cloud Sync / Proxy call sites. */
  inputWidth?: string;
  /** Forwarded to the underlying PasswordInput. */
  revealable?: boolean;
  /** Forwarded to the underlying PasswordInput — marks the field as
   *  containing a previously saved password so the global
   *  `lockSavedPasswords` policy can apply. */
  isSaved?: boolean;
}

/**
 * Standard "label + masked input" row used by Backup Encryption,
 * Cloud Sync Encryption, and Proxy authentication. The input itself is
 * the shared `PasswordInput` so the global password-reveal policy
 * (mode / autoHide / lockSavedPasswords) applies uniformly.
 */
export const SettingsPasswordRow: React.FC<SettingsPasswordRowProps> = ({
  label,
  icon,
  description,
  value,
  onChange,
  placeholder,
  settingKey,
  className,
  infoTooltip,
  disabled,
  inputWidth = '18rem',
  revealable,
  isSaved,
}) => (
  <div
    className={cx('sor-settings-select-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <div className="min-w-0">
      <span className="sor-settings-row-label flex items-center gap-1">
        {icon && <span className="text-[var(--color-textSecondary)] mr-1">{icon}</span>}
        {label}{infoTooltip && <InfoTooltip text={infoTooltip} />}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
    <div style={{ width: inputWidth }}>
      <PasswordInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="sor-settings-input w-full"
        disabled={disabled}
        revealable={revealable}
        isSaved={isSaved}
      />
    </div>
  </div>
);

/* ── Short aliases (used by behavior/ sub-files) ── */
export {
  SettingsCard as Card,
  SettingsSectionHeader as SectionHeader,
  SettingsToggleRow as Toggle,
  SettingsSliderRow as SliderRow,
  SettingsSelectRow as SelectRow,
  SettingsTextRow as TextRow,
  SettingsNumberRow as NumberRow,
  SettingsColorRow as ColorRow,
  SettingsPasswordRow as PasswordRow,
};
