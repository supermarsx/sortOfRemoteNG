import React, { useEffect, useId, useState } from "react";
import { Select } from "../ui/forms/Select";

export function BrowserSelectRow({
  settingKey,
  label,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: {
  settingKey: string;
  label: string;
  description?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      data-setting-key={settingKey}
      className="sor-settings-select-row flex-wrap gap-3"
    >
      <div className="min-w-0 flex-1">
        <span className="sor-settings-row-label">{label}</span>
        {description && (
          <p className="sor-settings-toggle-description">{description}</p>
        )}
      </div>
      <Select
        className="min-w-0 max-w-full"
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        variant="settings"
      />
    </div>
  );
}

/** Keep partial numbers local; publish only a complete, bounded integer. */
export function BrowserNumberRow({
  settingKey,
  label,
  description,
  value,
  min,
  max,
  onChange,
  disabled = false,
}: {
  settingKey: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setError(false);
  }, [value]);
  const apply = () => {
    if (disabled) return;
    const next = Number(draft);
    if (
      !/^\d+$/.test(draft.trim()) ||
      !Number.isSafeInteger(next) ||
      next < min ||
      next > max
    ) {
      setError(true);
      return;
    }
    setError(false);
    if (next !== value) onChange(next);
  };
  return (
    <div data-setting-key={settingKey} className="space-y-1">
      <div className="sor-settings-select-row flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="sor-settings-row-label">
            {label}
          </label>
          <p id={`${id}-help`} className="sor-settings-toggle-description">
            {description}
          </p>
        </div>
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          aria-invalid={error}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          className="sor-settings-input w-28"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(false);
          }}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              setDraft(String(value));
              setError(false);
            }
          }}
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-error">
          Enter a whole number from {min} to {max}.
        </p>
      )}
    </div>
  );
}
