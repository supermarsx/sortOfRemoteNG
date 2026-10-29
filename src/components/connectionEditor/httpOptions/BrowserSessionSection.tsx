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
import {
  clearConnectionData,
  formatCacheBytes,
} from "../../../services/originBrowserData";
import {
  httpCacheUnavailableText,
  originBrowserDataErrorText,
  useHttpCacheUsage,
} from "../../../hooks/protocol/useHttpCacheUsage";
import {
  HTTP_CACHE_DIRECT_TLS_CONNECTION,
  HTTP_CACHE_NEEDS_INSPECTION,
  TLS_INTERCEPTION_HELP,
  TLS_INTERCEPTION_LABEL,
  TLS_INTERCEPTION_OPTION_LABELS,
} from "../../SettingsDialog/sections/webBrowser/browserTlsInterceptionCopy";

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
  const [clearStatus, setClearStatus] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const nativeRetentionCapabilities = useBrowserRetentionCapabilities(
    retentionCapabilities === undefined && defaults.engine !== "legacy",
  );
  const capabilities = retentionCapabilities ?? nativeRetentionCapabilities;
  // Present only once native parses saved page-cache overrides; until then a
  // saved override would make native reject the connection's preferences.
  const cacheCapability = capabilities.httpDiskCache;
  const connectionId = mgr.formData.id;
  const nativeEngine = defaults.engine !== "legacy";
  const { usage, refresh: refreshUsage } = useHttpCacheUsage(
    connectionId,
    nativeEngine && !!connectionId && cacheCapability?.available === true,
  );
  const clearData = async (cookies: boolean) => {
    if (!connectionId) return;
    setClearing(true);
    setClearStatus(null);
    try {
      const outcome = await clearConnectionData({
        connectionId,
        cookies,
        cache: !cookies,
      });
      setClearStatus(
        !outcome.ok
          ? originBrowserDataErrorText(outcome.error)
          : cookies
            ? outcome.value.cookiesCleared
              ? "Saved sign-in cleared."
              : "No saved sign-in to clear."
            : outcome.value.cachePendingRestart
              ? "Page cache will be cleared on next start."
              : "Page cache cleared.",
      );
      if (!cookies) refreshUsage();
    } finally {
      setClearing(false);
    }
  };
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
      <h5 className="text-sm font-medium">
        Saved sign-in (cookies, encrypted in this database, 7-day idle / 30-day
        max)
      </h5>
      <BrowserSelectRow
        settingKey="browserSession.restoreCookies"
        label="Restore saved cookies"
        description="Use cookies saved for this same database and connection. Off starts with a fresh temporary cookie jar; this attempt does not restore or change stored cookies, even with ephemeral retention selected. Configured expiry and clearing on database lock still apply independently. Applies only to new attempts and never grants permission to send login credentials."
        value={
          overrides.restoreCookies === undefined
            ? "inherit"
            : String(overrides.restoreCookies)
        }
        options={[
          {
            value: "inherit",
            label: `Use app default (${defaults.restoreCookies !== false ? "on" : "off"})`,
          },
          { value: "true", label: "On" },
          { value: "false", label: "Off" },
        ]}
        onChange={(value) =>
          update(
            "restoreCookies",
            value === "inherit" ? undefined : value === "true",
          )
        }
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
        disabled={clearing || !connectionId || !nativeEngine}
        onClick={() => void clearData(true)}
      >
        Clear saved sign-in
      </button>
      <h5 className="text-sm font-medium">{TLS_INTERCEPTION_LABEL}</h5>
      <BrowserSelectRow
        settingKey="browserSession.tlsInterception"
        label={TLS_INTERCEPTION_LABEL}
        description={TLS_INTERCEPTION_HELP}
        value={overrides.tlsInterception ?? "inherit"}
        options={[
          {
            value: "inherit",
            label: `Use app default (${TLS_INTERCEPTION_OPTION_LABELS[defaults.tlsInterception ?? "auto"]})`,
          },
          { value: "auto", label: TLS_INTERCEPTION_OPTION_LABELS.auto },
          { value: "off", label: TLS_INTERCEPTION_OPTION_LABELS.off },
        ]}
        onChange={(value) =>
          update(
            "tlsInterception",
            value === "auto" || value === "off" ? value : undefined,
          )
        }
      />
      <h5 className="text-sm font-medium">
        Page cache (this device only, never synced, follows site cache rules)
      </h5>
      <BrowserSelectRow
        settingKey="browserSession.httpCache.enabled"
        label="Use page cache for this connection"
        description={`Keeps this connection's pages cached on this device so later visits load faster. Sites decide what may be cached. ${HTTP_CACHE_NEEDS_INSPECTION} Applies to new attempts.`}
        value={
          overrides.httpCache?.enabled === undefined
            ? "inherit"
            : String(overrides.httpCache.enabled)
        }
        disabled={cacheCapability === undefined}
        options={[
          {
            value: "inherit",
            label: `Use app default (${defaults.httpCache?.enabled !== false ? "on" : "off"})`,
          },
          { value: "true", label: "On" },
          { value: "false", label: "Off" },
        ]}
        onChange={(value) => {
          const next = { ...overrides.httpCache };
          if (value === "inherit") delete next.enabled;
          else next.enabled = value === "true";
          update("httpCache", Object.keys(next).length ? next : undefined);
        }}
      />
      {effective.tlsInterception === "off" && (
        <p className="text-sm text-warning">
          {HTTP_CACHE_DIRECT_TLS_CONNECTION}
        </p>
      )}
      {(cacheCapability === undefined || !cacheCapability.available) && (
        <p className="text-sm text-warning">
          {httpCacheUnavailableText(cacheCapability?.reason ?? "unavailable")}
        </p>
      )}
      {usage?.available && (
        <p className="text-sm text-[var(--color-textSecondary)]">
          Page cache for this connection: {formatCacheBytes(usage.bytes)} of{" "}
          {formatCacheBytes(usage.limitBytes)}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={clearing || !connectionId || !nativeEngine}
          onClick={() => void clearData(false)}
        >
          Clear page cache
        </button>
        {clearStatus && (
          <span role="status" className="text-sm">
            {clearStatus}
          </span>
        )}
      </div>
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
