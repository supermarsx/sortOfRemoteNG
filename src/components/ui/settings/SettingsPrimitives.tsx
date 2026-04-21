import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cx } from '../lib/cx';
import { Select } from '../forms/Select';
import { InfoTooltip } from '../InfoTooltip';

interface BaseSettingProps {
  settingKey?: string;
  className?: string;
}

export const SettingsSectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
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
  label: string;
  description?: string;
  infoTooltip?: string;
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
    <span className="sor-settings-row-label flex items-center gap-1">{label}{infoTooltip && <InfoTooltip text={infoTooltip} />}</span>
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
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  infoTooltip?: string;
}

export const SettingsSelectRow: React.FC<SettingsSelectRowProps> = ({
  label,
  value,
  options,
  onChange,
  settingKey,
  className,
  infoTooltip,
}) => (
  <div
    className={cx('sor-settings-select-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <span className="sor-settings-row-label flex items-center gap-1">{label}{infoTooltip && <InfoTooltip text={infoTooltip} />}</span>
    <Select
      value={value}
      onChange={onChange}
      options={options}
      variant="settings"
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
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

export const SettingsTextRow: React.FC<SettingsTextRowProps> = ({
  label,
  value,
  placeholder,
  onChange,
  settingKey,
  className,
}) => (
  <div
    className={cx('sor-settings-select-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <span className="sor-settings-row-label">{label}</span>
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="sor-settings-input"
    />
  </div>
);

interface SettingsNumberRowProps extends BaseSettingProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

export const SettingsNumberRow: React.FC<SettingsNumberRowProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  settingKey,
  className,
}) => (
  <div
    className={cx('sor-settings-select-row', className)}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    <span className="sor-settings-row-label">{label}{unit && ` (${unit})`}</span>
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

/* ── Short aliases (used by behavior/ sub-files) ── */
export {
  SettingsCard as Card,
  SettingsSectionHeader as SectionHeader,
  SettingsToggleRow as Toggle,
  SettingsSliderRow as SliderRow,
  SettingsSelectRow as SelectRow,
  SettingsTextRow as TextRow,
  SettingsNumberRow as NumberRow,
};
