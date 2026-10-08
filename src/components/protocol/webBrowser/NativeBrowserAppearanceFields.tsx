"use client";

import React, { useState } from "react";
import type { NativeBrowserExtensionsController } from "../../../hooks/protocol/useNativeBrowserExtensions";
import {
  BUILTIN_WEBSITE_DARK_PRESETS,
  normalizeWebsiteDarkModeConfig,
} from "../../../utils/connection/websiteDarkMode";
import { WebsiteDarkModeFields } from "../../websites/WebsiteDarkModeFields";
import { CheckboxField } from "../../ui/forms/Checkbox";

/** Draft edits use the same database-fenced save as other website extensions. */
export default function NativeBrowserAppearanceFields({
  controller,
}: {
  controller: NativeBrowserExtensionsController;
}) {
  const [configuration, setConfiguration] = useState(
    controller.appearance.configuration,
  );
  const [enabled, setEnabled] = useState(controller.appearance.enabled);
  const [error, setError] = useState<string | null>(null);
  const disabled = !controller.available || controller.busy;
  const theme = configuration.useGlobalDefaults
    ? controller.appearance.defaults.defaults
    : configuration.theme;
  return (
    <section
      aria-label="Native website appearance"
      className="space-y-3 border-t border-[var(--color-border)] pt-3"
    >
      <h4 className="font-semibold">Website appearance</h4>
      <CheckboxField
        label="Enable dark-mode extension"
        variant="settings"
        checked={enabled}
        disabled={disabled}
        onChange={setEnabled}
      />
      <CheckboxField
        label="Use global website appearance defaults"
        variant="settings"
        checked={configuration.useGlobalDefaults}
        disabled={disabled}
        onChange={(useGlobalDefaults) =>
          setConfiguration((previous) => ({
            ...previous,
            useGlobalDefaults,
            theme: previous.useGlobalDefaults ? { ...theme } : previous.theme,
          }))
        }
      />
      <WebsiteDarkModeFields
        theme={theme}
        disabled={disabled || configuration.useGlobalDefaults}
        presets={[
          ...BUILTIN_WEBSITE_DARK_PRESETS,
          ...controller.appearance.defaults.presets,
        ]}
        onChange={(next) =>
          setConfiguration((previous) => ({ ...previous, theme: next }))
        }
      />
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          className="sor-btn-primary-sm"
          disabled={disabled}
          onClick={async () => {
            setError(null);
            try {
              const normalized = normalizeWebsiteDarkModeConfig(configuration);
              if (
                !(await controller.save({
                  kind: "appearance",
                  enabled,
                  configuration: normalized,
                }))
              )
                setError(
                  "Appearance was not saved. Check database access and try again.",
                );
            } catch {
              setError(
                "Review the appearance values. Custom CSS must contain local styles only.",
              );
            }
          }}
        >
          Save appearance
        </button>
      </div>
    </section>
  );
}
