import React from "react";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}> = ({ checked, onChange, label, description }) => (
  <label className="flex items-start gap-3 cursor-pointer group">
    <div className="relative flex-shrink-0 mt-0.5">
      <Checkbox checked={checked} onChange={(v: boolean) => onChange(v)} className="sr-only peer" />
      <div className="w-10 h-5 bg-[var(--color-border)] rounded-full peer-checked:bg-blue-600 transition-colors" />
      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
    </div>
    <div className="flex-1">
      <span className="text-sm text-[var(--color-text)] group-hover:text-blue-400 transition-colors">
        {label}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
  </label>
);

const Select: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}> = ({ value, onChange, options, label }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--color-textSecondary)]">{label}</label>
    <Select value={value} onChange={(v: string) => onChange(v)} options={[...options.map((opt) => ({ value: opt.value, label: opt.label }))]} className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
  </div>
);

const NumberInput: React.FC<{
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}> = ({ value, onChange, label, min, max, step = 1, disabled }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--color-textSecondary)]">{label}</label>
    <NumberInput value={value} onChange={(v: number) => onChange(v)} className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]  focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" min={min} max={max} step={step} disabled={disabled} />
  </div>
);

const TextInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}> = ({ value, onChange, label, placeholder }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--color-textSecondary)]">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

export default Toggle;
