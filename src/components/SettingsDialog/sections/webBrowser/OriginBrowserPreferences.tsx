import React, { useId } from "react";
import type { WebBrowserSettingsConfig } from "../../../../types/settings/webBrowser";
import type { WebsiteDomainPermissionsSettings } from "../../../../types/settings/websiteDomainPermissions";
import WebsiteDomainPermissionsEditor from "./WebsiteDomainPermissionsEditor";
import { Select } from "../../../ui/forms/Select";
import { FormField } from "../../../ui/forms/FormField";

/** Engine selection belongs exclusively to the global settings page. */
export function OriginBrowserPreferences({
  config,
  onChange,
  disabled = false,
}: {
  config: WebBrowserSettingsConfig;
  onChange: (config: WebBrowserSettingsConfig) => void;
  disabled?: boolean;
}) {
  const engineId = useId();
  return (
    <div className="space-y-4">
      <FormField
        label="Default browser engine"
        htmlFor={engineId}
        layout="inline"
        className="sor-settings-select-row flex-wrap gap-3"
      >
        <Select
          id={engineId}
          className="min-w-0 max-w-full"
          label="Default browser engine"
          settingKey="webBrowser.engine"
          value={config.engine ?? "real-origin"}
          disabled={disabled}
          onChange={(value) =>
            onChange({
              ...config,
              engine: value as WebBrowserSettingsConfig["engine"],
            })
          }
          options={[
            { value: "legacy", label: "Legacy rewrite browser" },
            {
              value: "real-origin",
              label: "Real-origin native browser (experimental)",
              description:
                "Requires verified native runtime availability; no automatic fallback.",
            },
          ]}
        />
      </FormField>
      <p className="text-xs text-[var(--color-textMuted)]">
        Real-origin is the default. Native availability is checked before
        connecting; unavailable runtimes never fall back to legacy. Saved legacy
        choices are preserved. Engine changes apply to newly opened tabs.
      </p>
      <WebsiteDomainPermissionsEditor
        settings={config.domainPermissions}
        disabled={disabled}
        onChange={(domainPermissions) =>
          onChange({ ...config, domainPermissions })
        }
      />
    </div>
  );
}

export function OriginConnectionPermissions({
  settings,
  sharedSettings,
  onChange,
  disabled,
}: {
  settings: WebsiteDomainPermissionsSettings | undefined;
  sharedSettings: WebsiteDomainPermissionsSettings | undefined;
  onChange: (settings: WebsiteDomainPermissionsSettings) => void;
  disabled?: boolean;
}) {
  return (
    <WebsiteDomainPermissionsEditor
      scope="connection"
      settings={settings}
      sharedSettings={sharedSettings}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
