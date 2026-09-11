import React from "react";
import type {
  WebsiteDarkTheme,
  WebsiteDarkPreset,
} from "../../types/connection/websiteDarkMode";
import { Checkbox, Select } from "../ui/forms";

interface Props {
  theme: WebsiteDarkTheme;
  onChange: (theme: WebsiteDarkTheme) => void;
  disabled?: boolean;
  presets?: WebsiteDarkPreset[];
}

/** Draft-only fields shared by the tab, connection editor and app settings. */
export function WebsiteDarkModeFields({
  theme,
  onChange,
  disabled = false,
  presets = [],
}: Props) {
  const patch = (value: Partial<WebsiteDarkTheme>) =>
    onChange({ ...theme, ...value });
  return (
    <fieldset disabled={disabled} className="space-y-4 min-w-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Conversion mode</span>
          <Select
            label="Conversion mode"
            value={theme.mode}
            disabled={disabled}
            searchable
            variant="form-sm"
            options={[
              { value: "dynamic", label: "Dynamic colors" },
              { value: "filter", label: "Filter" },
              { value: "dynamicFilter", label: "Dynamic + filter" },
              { value: "customCss", label: "Custom CSS" },
            ]}
            onChange={(mode) =>
              patch({ mode: mode as WebsiteDarkTheme["mode"] })
            }
          />
        </label>
        {presets.length > 0 && (
          <label className="space-y-1 text-sm">
            <span>Apply preset</span>
            <Select
              label="Apply appearance preset"
              value=""
              placeholder="Choose a preset"
              searchable
              disabled={disabled}
              variant="form-sm"
              options={presets.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => {
                const preset = presets.find((p) => p.id === id);
                if (preset) onChange({ ...preset.theme });
              }}
            />
          </label>
        )}
      </div>
      {theme.mode !== "customCss" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["brightness", "Brightness", 200],
                ["contrast", "Contrast", 200],
                ["sepia", "Sepia", 100],
                ["grayscale", "Grayscale", 100],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key} className="text-xs space-y-1">
                <span className="flex justify-between gap-2">
                  {label}
                  <output>{theme[key]}%</output>
                </span>
                <input
                  aria-label={label}
                  type="range"
                  min={0}
                  max={max}
                  step={1}
                  value={theme[key]}
                  onChange={(event) =>
                    patch({ [key]: Number(event.target.value) })
                  }
                  className="w-full accent-[var(--color-primary)]"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["backgroundColor", "Background color"],
                ["textColor", "Text color"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  aria-label={label}
                  type="color"
                  value={theme[key]}
                  onChange={(event) => patch({ [key]: event.target.value })}
                  className="h-8 w-10 rounded border border-[var(--color-border)] bg-transparent"
                />
                {label}
              </label>
            ))}
          </div>
          <label className="flex gap-2 items-center text-sm">
            <Checkbox
              checked={theme.preserveMedia}
              onChange={(preserveMedia) => patch({ preserveMedia })}
            />
            Preserve image and video colors
          </label>
        </>
      )}
      {theme.mode === "customCss" && (
        <label className="block text-sm space-y-2">
          <span>Custom CSS</span>
          <textarea
            aria-label="Custom CSS"
            value={theme.customCss}
            onChange={(event) => patch({ customCss: event.target.value })}
            rows={7}
            maxLength={16384}
            spellCheck={false}
            className="sor-form-input w-full font-mono text-xs"
          />
          <span className="block text-xs text-[var(--color-textMuted)]">
            Local styles only, up to 16 KiB. External resources, imports and
            active content are not allowed. CSS is validated before saving.
          </span>
        </label>
      )}
      <p className="text-xs text-[var(--color-textMuted)]">
        Some websites may need a different mode. Appearance changes never enable
        the extension automatically.
      </p>
    </fieldset>
  );
}
