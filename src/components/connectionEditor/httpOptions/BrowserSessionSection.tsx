import React, { useState } from "react";
import { useSettings } from "../../../contexts/SettingsContext";
import type {
  BrowserSessionOverrides,
  BrowserSessionRetentionCapabilities,
} from "../../../types/settings/browserSession";
import type { WebBrowserSettingsConfig } from "../../../types/settings/webBrowser";
import { normalizeWebBrowserSettings } from "../../../utils/settings/webBrowserSettings";
import {
  normalizeBrowserSessionOverrides,
  resolveConnectionBrowserSettings,
} from "../../../utils/settings/browserSessionSettings";
import { Checkbox } from "../../ui/forms";
import {
  BrowserNumberRow,
  BrowserSelectRow,
} from "../../SettingsDialog/BrowserSettingsFields";
import BrowserSessionRetentionFields from "../../SettingsDialog/sections/webBrowser/BrowserSessionRetentionFields";
import type { Mgr } from "./types";
import { useBrowserRetentionCapabilities } from "../../../hooks/protocol/useBrowserRetentionCapabilities";
import BrowserNativeCapabilitiesCard from "../../SettingsDialog/sections/webBrowser/BrowserNativeCapabilitiesCard";
import BrowserSettingsRepair from "../../SettingsDialog/sections/webBrowser/BrowserSettingsRepair";

const numbers = [
  ["defaultZoomPercent", "Website zoom (%)", 50, 200],
  ["initialLoadTimeoutSeconds", "Initial load timeout (seconds)", 10, 120],
  ["documentReadyTimeoutSeconds", "Document ready timeout (seconds)", 30, 240],
  ["minimumFormFillDelayMs", "Minimum autofill delay (ms)", 0, 30000],
  ["minimumFormSubmitDelayMs", "Minimum submit delay (ms)", 0, 30000],
] as const;
const toggles = [
  ["showBookmarksBar", "Show bookmarks bar"],
  ["showSecurityInfo", "Show security information"],
  ["showLoadingProgress", "Show loading progress"],
  ["manualFormSubmit", "Require manual form submission"],
] as const;

export default function BrowserSessionSection({
  mgr,
  retentionCapabilities,
}: {
  mgr: Mgr;
  retentionCapabilities?: BrowserSessionRetentionCapabilities;
}) {
  const { settings, settingsReady } = useSettings();
  if (settingsReady === false)
    return <p role="status">Loading browser session defaults…</p>;
  let defaults: WebBrowserSettingsConfig;
  try {
    defaults = normalizeWebBrowserSettings(settings.webBrowser);
  } catch {
    return (
      <p role="alert" className="sor-alert-error">
        Global browser settings are invalid. Correct them in Web Browser
        settings before editing overrides.
      </p>
    );
  }
  return (
    <SessionOverrides
      key={mgr.formData.id}
      mgr={mgr}
      defaults={defaults}
      retentionCapabilities={retentionCapabilities}
    />
  );
}

function SessionOverrides({
  mgr,
  defaults,
  retentionCapabilities,
}: {
  mgr: Mgr;
  defaults: WebBrowserSettingsConfig;
  retentionCapabilities?: BrowserSessionRetentionCapabilities;
}) {
  const [error, setError] = useState<string | null>(null);
  const nativeRetentionCapabilities = useBrowserRetentionCapabilities(
    retentionCapabilities === undefined && defaults.engine !== "legacy",
  );
  const timeoutHelp: Record<string, string> = {
    initialLoadTimeoutSeconds:
      defaults.engine !== "legacy"
        ? "Maximum time to prepare the native browser context. "
        : "Maximum wait for the first page response. ",
    documentReadyTimeoutSeconds:
      defaults.engine !== "legacy"
        ? "Maximum page loading time before native Stop and a timeout notice. "
        : "Maximum wait for the page document to become ready. ",
  };
  let overrides: BrowserSessionOverrides;
  let effective;
  const save = (browserSession: BrowserSessionOverrides | undefined) =>
    mgr.setFormData((previous) =>
      previous.id !== mgr.formData.id
        ? previous
        : { ...previous, browserSession },
    );
  try {
    overrides = normalizeBrowserSessionOverrides(
      mgr.formData.browserSession,
    ) ?? { version: 1 };
    effective = resolveConnectionBrowserSettings(defaults, overrides);
  } catch {
    return (
      <section className="space-y-3">
        <p role="alert" className="sor-alert-error">
          Browser session overrides are invalid or conflict with inherited
          delays. Repair the saved overrides or explicitly reset them to inherit
          the global defaults.
        </p>
        <BrowserSettingsRepair
          value={mgr.formData.browserSession}
          label="Browser session overrides JSON"
          validate={(input) => {
            const normalized = normalizeBrowserSessionOverrides(input);
            resolveConnectionBrowserSettings(defaults, normalized);
            return normalized;
          }}
          onApply={save}
        />
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={() => save(undefined)}
        >
          Reset browser session overrides
        </button>
      </section>
    );
  }
  const update = (
    key: Exclude<keyof BrowserSessionOverrides, "version">,
    value: unknown,
  ) => {
    const next = { ...overrides, [key]: value };
    if (value === undefined) delete next[key];
    try {
      const normalized = normalizeBrowserSessionOverrides(next)!;
      resolveConnectionBrowserSettings(defaults, normalized);
      save(Object.keys(normalized).length === 1 ? undefined : normalized);
      setError(null);
    } catch {
      setError(
        "These overrides are invalid. Combined autofill and submit delays must total at most 52,000 ms, including inherited values.",
      );
    }
  };
  return (
    <section
      aria-label="Browser session settings"
      className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <h4 className="text-sm font-medium">Browser session settings</h4>
      <p className="text-sm text-[var(--color-textSecondary)]">
        Unset values follow Web Browser app settings. Each attempt remains
        isolated by database and connection. Security warnings and credential
        checks remain enabled.
      </p>
      {numbers.map(([key, label, min, max]) => (
        <div key={key} className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={overrides[key] !== undefined}
              onChange={(checked) =>
                update(key, checked ? effective[key] : undefined)
              }
            />
            Override {label}
          </label>
          <BrowserNumberRow
            settingKey={`browserSession.${key}`}
            label={label}
            description={`${timeoutHelp[key] ?? ""}App default: ${defaults[key]}. ${overrides[key] === undefined ? "Inherited." : "Set for this connection."}`}
            value={effective[key]}
            min={min}
            max={max}
            disabled={overrides[key] === undefined}
            onChange={(value) => update(key, value)}
          />
        </div>
      ))}
      {toggles.map(([key, label]) => (
        <BrowserSelectRow
          key={key}
          settingKey={`browserSession.${key}`}
          label={label}
          value={
            overrides[key] === undefined ? "inherit" : String(overrides[key])
          }
          options={[
            {
              value: "inherit",
              label: `Use app default (${defaults[key] ? "on" : "off"})`,
            },
            { value: "true", label: "On" },
            { value: "false", label: "Off" },
          ]}
          onChange={(value) =>
            update(key, value === "inherit" ? undefined : value === "true")
          }
        />
      ))}
      <p className="text-xs text-[var(--color-textMuted)]">
        Autofill preferences do not enable automatic login. Explicit selectors
        and additional fields remain in Advanced form automation below; these
        minimum delays still apply.
      </p>
      <BrowserNativeCapabilitiesCard
        defaults={defaults}
        engine={defaults.engine}
        scope="connection"
        overrides={overrides}
        onChange={update}
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={overrides.sessionRetention !== undefined}
          onChange={(checked) =>
            update(
              "sessionRetention",
              checked ? effective.sessionRetention : undefined,
            )
          }
        />
        Override session retention
      </label>
      {overrides.sessionRetention ? (
        <BrowserSessionRetentionFields
          value={overrides.sessionRetention}
          settingPrefix="browserSession.sessionRetention"
          capabilities={retentionCapabilities ?? nativeRetentionCapabilities}
          onChange={(value) => update("sessionRetention", value)}
        />
      ) : (
        <p className="text-sm text-[var(--color-textSecondary)]">
          Inherited requested retention: {effective.sessionRetention.mode}.
          Runtime support must be confirmed before retention can become active.
        </p>
      )}
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={mgr.formData.browserSession === undefined}
        onClick={() => {
          save(undefined);
          setError(null);
        }}
      >
        Reset browser session overrides
      </button>
      {error && (
        <p role="alert" className="sor-alert-error">
          {error}
        </p>
      )}
    </section>
  );
}
