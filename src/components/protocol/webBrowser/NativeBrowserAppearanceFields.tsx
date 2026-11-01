"use client";

import React, { useId, useRef, useState } from "react";
import type { NativeBrowserExtensionsController } from "../../../hooks/protocol/useNativeBrowserExtensions";
import {
  BUILTIN_WEBSITE_DARK_PRESETS,
  normalizeWebsiteDarkModeConfig,
} from "../../../utils/connection/websiteDarkMode";
import { WebsiteDarkModeFields } from "../../websites/WebsiteDarkModeFields";
import { CheckboxField } from "../../ui/forms/Checkbox";
import { Select } from "../../ui/forms/Select";

/** An explicit draft/save boundary, separate from immediate automation saves. */
export default function NativeBrowserAppearanceFields({
  controller,
}: {
  controller: NativeBrowserExtensionsController;
}) {
  const [configuration, setConfiguration] = useState(
    controller.appearance.configuration,
  );
  const [enabled, setEnabled] = useState(controller.appearance.enabled);
  const signature = (on: boolean, config: typeof configuration) =>
    JSON.stringify([on, config]);
  const [baseline, setBaseline] = useState(() =>
    signature(enabled, configuration),
  );
  const customStarted = useRef(!configuration.useGlobalDefaults);
  const sourceId = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = signature(enabled, configuration) !== baseline;
  const disabled = !controller.available || controller.busy || saving;
  const theme = configuration.useGlobalDefaults
    ? controller.appearance.defaults.defaults
    : configuration.theme;
  const source = (useGlobalDefaults: boolean) => {
    const initialCustomTheme = !useGlobalDefaults && !customStarted.current;
    setConfiguration((previous) => ({
      ...previous,
      useGlobalDefaults,
      theme: initialCustomTheme
        ? { ...controller.appearance.defaults.defaults }
        : previous.theme,
    }));
    if (!useGlobalDefaults) customStarted.current = true;
    setError(null);
  };
  return (
    <section
      ref={setPortalContainer}
      aria-label="Website appearance"
      className="space-y-4"
    >
      <div>
        <h4 className="text-sm font-semibold">Website appearance</h4>
        <p className="mt-1 text-xs text-[var(--color-textMuted)]">
          Adjust how this website looks. Review your changes, then save to apply
          them.
        </p>
      </div>
      <CheckboxField
        label="Enable website appearance"
        aria-label="Enable website appearance"
        description="Apply the app’s dark-mode styling to this website."
        reverse
        variant="settings"
        checked={enabled}
        disabled={disabled}
        onChange={setEnabled}
      />
      {!enabled && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Appearance is off. You can prepare settings below; they apply only
          when enabled and saved.
        </p>
      )}
      <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
        <label
          className="block text-xs font-medium text-[var(--color-textSecondary)]"
          htmlFor={sourceId}
        >
          Appearance settings
        </label>
        <Select
          id={sourceId}
          label="Appearance settings"
          portalContainer={portalContainer}
          value={configuration.useGlobalDefaults ? "global" : "custom"}
          disabled={disabled}
          variant="form"
          className="w-full"
          onChange={(value) => source(value === "global")}
          options={[
            { value: "global", label: "Use app defaults" },
            { value: "custom", label: "Customize this connection" },
          ]}
        />
        <p className="text-xs text-[var(--color-textMuted)]">
          {configuration.useGlobalDefaults
            ? "Following the app’s website appearance defaults. Choose Customize this connection to edit the settings below."
            : "These adjustments affect this connection only. Your app defaults stay unchanged."}
        </p>
      </div>
      <div
        className={`rounded-lg border border-[var(--color-border)] p-3 ${configuration.useGlobalDefaults ? "opacity-70" : ""}`}
      >
        <WebsiteDarkModeFields
          portalContainer={portalContainer}
          theme={theme}
          disabled={disabled || configuration.useGlobalDefaults}
          presets={[
            ...BUILTIN_WEBSITE_DARK_PRESETS,
            ...controller.appearance.defaults.presets,
          ]}
          onChange={(next) => {
            setConfiguration((previous) => ({ ...previous, theme: next }));
            setError(null);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] py-3">
        <p role="status" className="text-xs text-[var(--color-textMuted)]">
          {saving
            ? "Saving appearance…"
            : dirty
              ? "Unsaved appearance changes"
              : "Appearance is up to date"}
        </p>
        <button
          type="button"
          className="sor-btn-primary-sm shrink-0"
          disabled={disabled || !dirty}
          onClick={async () => {
            setError(null);
            setSaving(true);
            try {
              const normalized = normalizeWebsiteDarkModeConfig(configuration);
              if (
                await controller.save({
                  kind: "appearance",
                  enabled,
                  configuration: normalized,
                })
              )
                setBaseline(signature(enabled, normalized));
              else
                setError(
                  "Appearance was not saved. Check database access and try again.",
                );
            } catch {
              setError(
                "Review the appearance values. Custom CSS must contain local styles only.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          Save appearance
        </button>
      </div>
    </section>
  );
}
