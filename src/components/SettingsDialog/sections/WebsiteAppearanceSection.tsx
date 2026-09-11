import React, { useState } from "react";
import { Moon, Trash2 } from "lucide-react";
import type { GlobalSettings } from "../../../types/settings/settings";
import {
  BUILTIN_WEBSITE_DARK_PRESETS,
  normalizeWebsiteDarkModeSettings,
  normalizeWebsiteDarkTheme,
} from "../../../utils/connection/websiteDarkMode";
import { WebsiteDarkModeFields } from "../../websites/WebsiteDarkModeFields";
import { Checkbox } from "../../ui/forms";
import { normalizeSessionQuickActions } from "../../../utils/connection/sessionQuickActions";

export default function WebsiteAppearanceSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  let appearance;
  try {
    appearance = normalizeWebsiteDarkModeSettings(settings.websiteDarkMode);
  } catch {
    return (
      <section className="rounded-lg border border-warning p-4">
        <p role="alert">
          Website appearance settings are invalid. Review and reset them before
          using the extension.
        </p>
        <button
          type="button"
          className="sor-btn-secondary-sm mt-2"
          onClick={() =>
            updateSettings({
              websiteDarkMode: normalizeWebsiteDarkModeSettings(undefined),
            })
          }
        >
          Reset website appearance
        </button>
      </section>
    );
  }
  const quick = normalizeSessionQuickActions(settings.sessionQuickActions);
  const applyTheme = (theme: typeof appearance.defaults) => {
    // Keep an invalid custom-CSS draft local so it never enters app settings.
    try {
      updateSettings({
        websiteDarkMode: {
          ...appearance,
          defaults: normalizeWebsiteDarkTheme(theme),
        },
      });
      setError(null);
    } catch {
      setError(
        "Invalid appearance settings. CSS must use local, safe styles and stay within 16 KiB.",
      );
    }
  };
  return (
    <section className="space-y-4 rounded-lg border border-[var(--color-border)] p-4">
      <h3 className="flex gap-2 items-center font-medium">
        <Moon size={17} />
        Website appearance
      </h3>
      <label className="flex gap-2 items-center text-sm">
        <Checkbox
          checked={quick.allowWebForceDark}
          onChange={(allowWebForceDark) =>
            updateSettings({
              sessionQuickActions: { ...quick, allowWebForceDark },
            })
          }
        />
        Allow dark-mode extension
      </label>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Availability only. Enable the extension separately in each website tab
        or saved connection. Disabling this option turns it off everywhere.
      </p>
      <AppearanceDefaults
        key={JSON.stringify(appearance.defaults)}
        theme={appearance.defaults}
        presets={[...BUILTIN_WEBSITE_DARK_PRESETS, ...appearance.presets]}
        onApply={applyTheme}
      />
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <h4 className="text-sm font-medium">Custom presets</h4>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Custom preset name"
            placeholder="Preset name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="sor-form-input min-w-0 flex-1"
          />
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={!name.trim()}
            onClick={() => {
              try {
                const next = normalizeWebsiteDarkModeSettings({
                  ...appearance,
                  presets: [
                    ...appearance.presets,
                    {
                      id: crypto.randomUUID(),
                      name: name.trim(),
                      theme: appearance.defaults,
                    },
                  ],
                });
                updateSettings({ websiteDarkMode: next });
                setName("");
                setError(null);
              } catch {
                setError(
                  "The preset could not be added. Check its name and the preset limit.",
                );
              }
            }}
          >
            Save defaults as preset
          </button>
        </div>
        <ul className="space-y-1">
          {appearance.presets.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate">{p.name}</span>
              <button
                type="button"
                aria-label={`Remove preset ${p.name}`}
                data-tooltip="Remove custom preset"
                className="sor-icon-btn-sm"
                onClick={() =>
                  updateSettings({
                    websiteDarkMode: {
                      ...appearance,
                      presets: appearance.presets.filter(
                        (item) => item.id !== p.id,
                      ),
                    },
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--color-textMuted)]">
          Changes follow the Settings dialog’s save controls. Removing a preset
          does not erase appearances already copied into connections.
        </p>
      </div>
    </section>
  );
}

function AppearanceDefaults({
  theme,
  presets,
  onApply,
}: {
  theme: import("../../../types/connection/websiteDarkMode").WebsiteDarkTheme;
  presets: import("../../../types/connection/websiteDarkMode").WebsiteDarkPreset[];
  onApply: (
    theme: import("../../../types/connection/websiteDarkMode").WebsiteDarkTheme,
  ) => void;
}) {
  const [draft, setDraft] = useState(theme);
  return (
    <div className="space-y-3">
      <WebsiteDarkModeFields
        theme={draft}
        presets={presets}
        onChange={setDraft}
      />
      <button
        type="button"
        className="sor-btn-secondary-sm"
        onClick={() => onApply(draft)}
      >
        Apply appearance defaults
      </button>
    </div>
  );
}
