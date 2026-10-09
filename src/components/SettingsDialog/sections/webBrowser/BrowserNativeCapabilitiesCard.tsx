import React from "react";
import type { BrowserNativePreferences } from "../../../../types/settings/browserSession";
import type { WebBrowserEngine } from "../../../../types/settings/webBrowser";
import { Card, Toggle } from "../../../ui/settings/SettingsPrimitives";
import { BrowserSelectRow } from "../../BrowserSettingsFields";

const capabilities = [
  [
    "localStorageEnabled",
    "Allow localStorage",
    "Allow site key/value storage within this isolated attempt. It is ephemeral and is not included in retained sign-in cookies.",
  ],
  [
    "databasesEnabled",
    "Allow IndexedDB",
    "Not configurable in the current native runtime: its deprecated databases switch does not control IndexedDB. The saved preference is preserved but inactive. Site databases remain isolated and ephemeral; this does not enable the removed WebSQL API.",
  ],
  [
    "webglEnabled",
    "Allow page-canvas WebGL",
    "Requires a compatible GPU and driver; Chromium’s safety blocklist remains enforced. Off is unsupported because native CEF cannot disable all WebGL contexts, including OffscreenCanvas. Off blocks new native attempts. Existing values are preserved.",
  ],
  [
    "cookiesEnabled",
    "Allow cookies",
    "Allow cookies in this isolated attempt. Keeping sign-in cookies between attempts requires a separate, supported retention policy.",
  ],
  [
    "mediaStreamEnabled",
    "Allow media-stream APIs",
    "Camera and microphone requests ask you through a native prompt bound to this session; enabling this setting never automatically grants access. Screen capture is unsupported. WebRTC non-proxied UDP remains disabled.",
  ],
  [
    "crossOriginRequestsEnabled",
    "Allow normal cross-origin requests",
    "CORS and the same-origin policy (SOP) remain enforced. Requests must also pass configured route permissions; this does not bypass the app proxy or allow every destination.",
  ],
  [
    "websiteExtensionsEnabled",
    "Allow app login and website scripts",
    "Allow native-authorized app login and injected website scripts, subject to script policy and credential consent. Turning this off does not disable globally forced dark styling. This does not install or enable Chromium extensions.",
  ],
] as const;
const automation = [
  "hideAutomationIndicator",
  "Hide WebDriver indicator (legacy only)",
  "Legacy rewrite browser only; this is not undetectable browsing. Native sessions already keep app automation in a private closure and do not enable the WebDriver flag. This preference does not change native security.",
] as const;

export default function BrowserNativeCapabilitiesCard({
  defaults,
  engine,
  scope = "global",
  overrides,
  onChange,
}: {
  defaults: BrowserNativePreferences;
  engine?: WebBrowserEngine;
  scope?: "global" | "connection";
  overrides?: Partial<BrowserNativePreferences>;
  onChange: (
    key: keyof BrowserNativePreferences,
    value: boolean | undefined,
  ) => void;
}) {
  const fields =
    scope === "connection" ? [...capabilities, automation] : capabilities;
  return (
    <section aria-label="Native browser capabilities" className="space-y-3">
      <h4 className="sor-settings-section-header">
        Native browser capabilities
      </h4>
      <Card>
        <p className="text-sm text-[var(--color-textSecondary)]">
          Requested preferences for new attempts, not an indication of active
          capabilities. They apply only when the native runtime implements them;
          saving a setting does not confirm runtime support.
        </p>
        {engine === "legacy" && (
          <p role="status" className="sor-alert-warning text-sm">
            Native capability preferences do not apply to the legacy rewrite
            browser. Saved values are preserved.
          </p>
        )}
        {fields.map(([key, label, description]) => {
          const disabled =
            key === "hideAutomationIndicator"
              ? engine !== "legacy"
              : engine === "legacy" || key === "databasesEnabled";
          return scope === "connection" ? (
            <BrowserSelectRow
              key={key}
              settingKey={`browserSession.${key}`}
              label={label}
              description={description}
              value={
                overrides?.[key] === undefined
                  ? "inherit"
                  : String(overrides[key])
              }
              disabled={disabled}
              options={[
                {
                  value: "inherit",
                  label: `Use app default (${defaults[key] ? "on" : "off"})`,
                },
                { value: "true", label: "On" },
                {
                  value: "false",
                  label:
                    key === "webglEnabled"
                      ? "Off (unsupported for native)"
                      : "Off",
                },
              ]}
              onChange={(value) =>
                onChange(
                  key,
                  value === "inherit" ? undefined : value === "true",
                )
              }
            />
          ) : (
            <Toggle
              key={key}
              settingKey={`webBrowser.${key}`}
              label={label}
              description={description}
              checked={defaults[key]}
              disabled={disabled}
              onChange={(value) => onChange(key, value)}
            />
          );
        })}
        <p className="text-xs text-[var(--color-textMuted)]">
          localStorage and IndexedDB remain ephemeral even when sign-in cookies
          are retained in the owning encrypted database. Browser profiles are
          never shared. Installable Chromium extensions are not supported by the
          current Alloy runtime; no extension-installation setting is enabled
          here.
        </p>
      </Card>
    </section>
  );
}
