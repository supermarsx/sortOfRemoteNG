import React, { useEffect, useId, useState } from "react";
import {
  Globe,
  Bookmark,
  Shield,
  Timer,
  Fingerprint,
  Info,
  Trash2,
} from "lucide-react";
import type { GlobalSettings } from "../../../types/settings/settings";
import type { WebBrowserSettingsConfig } from "../../../types/settings/webBrowser";
import type { BrowserSessionRetentionCapabilities } from "../../../types/settings/browserSession";
import {
  DEFAULT_EXTERNAL_FONT_ORIGINS,
  type HttpProxyPolicy,
} from "../../../types/connection/httpProxyPolicy";
import { normalizeWebBrowserSettings } from "../../../utils/settings/webBrowserSettings";
import { MAX_BROWSER_FORM_COMBINED_DELAY_MS } from "../../../utils/connection/httpFormAutomation";
import { normalizeExternalFontOrigins } from "../../../utils/connection/httpProxyPolicy";
import SectionHeading from "../../ui/SectionHeading";
import { TextInput } from "../../ui/forms/TextInput";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../ui/settings/SettingsPrimitives";
import { BrowserNumberRow, BrowserSelectRow } from "../BrowserSettingsFields";
import WebsiteAppearanceSection from "./WebsiteAppearanceSection";
import ExternalResourceOriginsEditor from "../../security/ExternalResourceOriginsEditor";
import { OriginBrowserPreferences } from "./webBrowser/OriginBrowserPreferences";
import BrowserSessionRetentionFields from "./webBrowser/BrowserSessionRetentionFields";
import { normalizeBrowserSessionRetention } from "../../../utils/settings/browserSessionSettings";
import { useBrowserRetentionCapabilities } from "../../../hooks/protocol/useBrowserRetentionCapabilities";
import BrowserNativeCapabilitiesCard from "./webBrowser/BrowserNativeCapabilitiesCard";
import BrowserDataDirectorySettings from "./webBrowser/BrowserDataDirectorySettings";

interface WebBrowserSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  /** Supplied only from verified native capabilities; omitted uses a read-only native probe. */
  retentionCapabilities?: BrowserSessionRetentionCapabilities;
}

export default function WebBrowserSettings(props: WebBrowserSettingsProps) {
  let config: WebBrowserSettingsConfig;
  try {
    config = normalizeWebBrowserSettings(props.settings.webBrowser);
  } catch {
    return (
      <Card>
        <p role="alert">
          Web Browser settings are invalid. Reset them before editing.
        </p>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={() =>
            props.updateSettings({
              webBrowser: normalizeWebBrowserSettings(undefined),
            })
          }
        >
          Reset Web Browser settings
        </button>
      </Card>
    );
  }
  return <WebBrowserSettingsContent {...props} config={config} />;
}

function WebBrowserSettingsContent({
  settings,
  updateSettings,
  config,
  retentionCapabilities,
}: WebBrowserSettingsProps & { config: WebBrowserSettingsConfig }) {
  const nativeRetentionCapabilities = useBrowserRetentionCapabilities(
    retentionCapabilities === undefined && config.engine !== "legacy",
  );
  const id = useId();
  const [fontOrigin, setFontOrigin] = useState("");
  const [fontError, setFontError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userAgent, setUserAgent] = useState("Unavailable");
  const [environment, setEnvironment] = useState<{
    cookies: boolean;
    automation: boolean | null;
  } | null>(null);
  useEffect(() => {
    setUserAgent(navigator.userAgent || "Unavailable");
    setEnvironment({
      cookies: navigator.cookieEnabled,
      automation:
        typeof navigator.webdriver === "boolean" ? navigator.webdriver : null,
    });
  }, []);
  const policy = config.defaultPolicy;
  const nativeCapabilitiesBlocked = config.engine !== "legacy";
  const fontOrigins = policy.externalFontOrigins ?? [];
  const fontsDisabled = policy.sameOriginOnly || !policy.allowExternalFonts;
  const update = (change: Partial<WebBrowserSettingsConfig>) => {
    if (
      (change.minimumFormFillDelayMs ?? config.minimumFormFillDelayMs) +
        (change.minimumFormSubmitDelayMs ?? config.minimumFormSubmitDelayMs) >
      MAX_BROWSER_FORM_COMBINED_DELAY_MS
    ) {
      setError(
        "Combined autofill and submit delays must total at most 52,000 ms, leaving time for form detection.",
      );
      return false;
    }
    try {
      updateSettings({
        webBrowser: normalizeWebBrowserSettings({ ...config, ...change }),
      });
      setError(null);
      return true;
    } catch {
      setError(
        "These browser settings are invalid. Review the values before saving.",
      );
      return false;
    }
  };
  const updatePolicy = (change: Partial<HttpProxyPolicy>) =>
    update({ defaultPolicy: { ...policy, ...change } });
  const updateOrigins = (origins: string[]) => {
    try {
      const normalized = normalizeExternalFontOrigins(origins);
      if (!updatePolicy({ externalFontOrigins: normalized })) return false;
      setFontError(null);
      return true;
    } catch {
      setFontError(
        "Enter up to 16 unique exact HTTPS origins, without paths, wildcards, credentials, queries or fragments.",
      );
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Globe className="w-5 h-5 text-primary" />}
        title="Web Browser"
        description="Appearance, browsing behavior and default website policies for embedded web sessions."
      />
      <div data-setting-key="websiteDarkMode">
        <WebsiteAppearanceSection
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
      <Card>
        <OriginBrowserPreferences
          config={config}
          onChange={(next) => {
            update(next);
          }}
        />
      </Card>
      <BrowserNativeCapabilitiesCard
        defaults={config}
        engine={config.engine}
        onChange={(key, value) => {
          if (value !== undefined) update({ [key]: value });
        }}
      />
      <BrowserDataDirectorySettings />
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield size={16} />}
          title="Browser session isolation and retention"
        />
        <Card>
          <BrowserSessionRetentionFields
            value={normalizeBrowserSessionRetention(config.sessionRetention)}
            capabilities={retentionCapabilities ?? nativeRetentionCapabilities}
            onChange={(sessionRetention) => update({ sessionRetention })}
          />
        </Card>
      </div>
      <div className="space-y-4">
        <SectionHeader
          icon={<Bookmark size={16} />}
          title="Bookmarks and browsing"
        />
        <Card>
          <Toggle
            settingKey="webBrowser.showBookmarksBar"
            icon={<Bookmark size={16} />}
            label="Show bookmarks bar"
            description="Keep saved bookmarks visible below the address bar"
            checked={config.showBookmarksBar}
            onChange={(showBookmarksBar) => update({ showBookmarksBar })}
          />
          <Toggle
            settingKey="confirmDeleteAllBookmarks"
            icon={<Trash2 size={16} />}
            label="Confirm before deleting all bookmarks"
            description="Show a confirmation dialog before clearing all bookmarks for a connection"
            checked={settings.confirmDeleteAllBookmarks}
            onChange={(confirmDeleteAllBookmarks) =>
              updateSettings({ confirmDeleteAllBookmarks })
            }
          />
          <Toggle
            settingKey="webBrowser.showSecurityInfo"
            icon={<Shield size={16} />}
            label="Show security information"
            description="Show connection security details. Security warnings remain visible when details are hidden."
            checked={config.showSecurityInfo}
            onChange={(showSecurityInfo) => update({ showSecurityInfo })}
          />
          <BrowserSelectRow
            settingKey="webBrowser.popupPolicy"
            label="Tactical RMM popups"
            description={
              nativeCapabilitiesBlocked
                ? "The native browser blocks popups. The saved legacy popup preference is inactive."
                : "Popup handling currently supports Tactical RMM only. Other websites' popup requests are not covered by this setting."
            }
            value={nativeCapabilitiesBlocked ? "block" : config.popupPolicy}
            disabled={nativeCapabilitiesBlocked}
            onChange={(value) =>
              update({
                popupPolicy: value as WebBrowserSettingsConfig["popupPolicy"],
              })
            }
            options={[
              { value: "tabs", label: "Open in tabs" },
              { value: "block", label: "Block popups" },
            ]}
          />
          <BrowserNumberRow
            settingKey="webBrowser.defaultZoomPercent"
            label="Website zoom (%)"
            description="Scale website content from 50–200%. Applies immediately without reloading or changing the app toolbar."
            value={config.defaultZoomPercent}
            min={50}
            max={200}
            onChange={(defaultZoomPercent) => update({ defaultZoomPercent })}
          />
          <Toggle
            settingKey="webBrowser.showLoadingProgress"
            label="Show loading progress"
            description="Display the slim loading bar. Trust prompts, errors and the dark-mode paint shield remain visible."
            checked={config.showLoadingProgress}
            onChange={(showLoadingProgress) => update({ showLoadingProgress })}
          />
        </Card>
      </div>
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield size={16} />}
          title="Website capabilities"
        />
        <Card>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {nativeCapabilitiesBlocked
              ? "The native browser currently blocks downloads and page dialogs. Saved legacy preferences are preserved but inactive."
              : "Apply on the next reload or navigation in legacy web tabs, including supported popup tabs. Browser and operating-system restrictions still apply. Unapproved destinations remain blocked."}
          </p>
          <Toggle
            settingKey="webBrowser.allowDownloads"
            label="Allow website downloads"
            description="Permit downloads from approved proxy pages. Downloaded files may be unencrypted and are not scanned by this app."
            checked={!nativeCapabilitiesBlocked && config.allowDownloads}
            disabled={nativeCapabilitiesBlocked}
            onChange={(allowDownloads) => update({ allowDownloads })}
          />
          <Toggle
            settingKey="webBrowser.allowPageDialogs"
            label="Allow website dialogs"
            description="Permit alert, confirm and prompt dialogs where supported by the embedded runtime. Does not allow websites to open external windows."
            checked={!nativeCapabilitiesBlocked && config.allowPageDialogs}
            disabled={nativeCapabilitiesBlocked}
            onChange={(allowPageDialogs) => update({ allowPageDialogs })}
          />
        </Card>
      </div>
      <div className="space-y-4">
        <SectionHeader icon={<Timer size={16} />} title="Page load deadlines" />
        <Card>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Deadlines apply to subsequent page loads. Values are in seconds.
          </p>
          <BrowserNumberRow
            settingKey="webBrowser.initialLoadTimeoutSeconds"
            label="Initial load timeout"
            description={
              nativeCapabilitiesBlocked
                ? "Maximum time to prepare the native browser context (10–120 seconds; default 30)."
                : "Wait for the first page response (10–120 seconds; default 30)"
            }
            value={config.initialLoadTimeoutSeconds}
            min={10}
            max={120}
            onChange={(initialLoadTimeoutSeconds) =>
              update({ initialLoadTimeoutSeconds })
            }
          />
          <BrowserNumberRow
            settingKey="webBrowser.documentReadyTimeoutSeconds"
            label="Document ready timeout"
            description={
              nativeCapabilitiesBlocked
                ? "Maximum page loading time before the native browser stops loading and shows a timeout notice (30–240 seconds; default 120)."
                : "Wait for the page document to become ready (30–240 seconds; default 120)"
            }
            value={config.documentReadyTimeoutSeconds}
            min={30}
            max={240}
            onChange={(documentReadyTimeoutSeconds) =>
              update({ documentReadyTimeoutSeconds })
            }
          />
        </Card>
      </div>
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield size={16} />}
          title="Website policy defaults"
        />
        <Card>
          <p className="text-sm text-[var(--color-textSecondary)]">
            These defaults apply only to connections without a saved website
            policy. Explicit saved connection policies override these defaults.
            Save settings, then close and reopen the browser tab to apply policy
            changes. Existing tabs keep their original policy.
          </p>
          <BrowserSelectRow
            settingKey="webBrowser.defaultPolicy.pageScripts"
            label="Page scripts"
            value={policy.pageScripts}
            description="Restrict scripts supplied by the website"
            onChange={(value) =>
              updatePolicy({
                pageScripts: value as HttpProxyPolicy["pageScripts"],
              })
            }
            options={[
              { value: "allow", label: "Allow scripts" },
              { value: "inline-only", label: "Inline scripts only" },
              { value: "block", label: "Block scripts" },
            ]}
          />
          <Toggle
            settingKey="webBrowser.defaultPolicy.httpsOnly"
            label="Require HTTPS"
            checked={policy.httpsOnly}
            description="Require HTTPS for mediated website requests"
            onChange={(httpsOnly) => updatePolicy({ httpsOnly })}
          />
          <Toggle
            settingKey="webBrowser.defaultPolicy.sameOriginOnly"
            label="Restrict to the same origin"
            checked={policy.sameOriginOnly}
            description="Restrict mediated redirects, resources and forms to the website origin"
            onChange={(sameOriginOnly) => updatePolicy({ sameOriginOnly })}
          />
          <BrowserSelectRow
            settingKey="webBrowser.defaultPolicy.cacheMode"
            label="Website cache"
            value={policy.cacheMode}
            onChange={(value) =>
              updatePolicy({ cacheMode: value as HttpProxyPolicy["cacheMode"] })
            }
            options={[
              { value: "normal", label: "Normal caching" },
              { value: "bypass", label: "Bypass cache" },
            ]}
          />
          <Toggle
            settingKey="webBrowser.defaultPolicy.allowExternalFonts"
            label="Allow external fonts"
            description="Fetch fonts anonymously through the internal proxy from approved origins"
            checked={policy.allowExternalFonts === true}
            disabled={policy.sameOriginOnly}
            onChange={(allowExternalFonts) =>
              updatePolicy({ allowExternalFonts })
            }
          />
          {policy.sameOriginOnly && (
            <p role="status" className="text-xs text-warning">
              The same-origin restriction overrides external fonts. Font
              settings are preserved while inactive.
            </p>
          )}
          <div
            data-setting-key="webBrowser.defaultPolicy.externalFontOrigins"
            className="space-y-3"
          >
            <p
              id={id + "-font-help"}
              className="text-xs text-[var(--color-textSecondary)]"
            >
              Allow up to 16 exact HTTPS origins for both font stylesheets and
              font files. Paths, wildcards and duplicate origins are rejected.
            </p>
            {fontOrigins.length > 0 && (
              <ul aria-label="Saved font origins" className="space-y-2">
                {fontOrigins.map((origin) => (
                  <li
                    key={origin}
                    className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--color-text)]">
                      {origin}
                    </span>
                    <button
                      type="button"
                      className="sor-btn sor-icon-btn-sm shrink-0"
                      disabled={fontsDisabled}
                      aria-label={"Remove font origin " + origin}
                      onClick={() =>
                        updateOrigins(
                          fontOrigins.filter((item) => item !== origin),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-[1_1_16rem] space-y-1.5">
                <label
                  htmlFor={id + "-font-origin"}
                  className="sor-settings-row-label block"
                >
                  External font origin
                </label>
                <TextInput
                  id={id + "-font-origin"}
                  variant="settings"
                  className="min-h-9 w-full min-w-0 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ maxWidth: "none" }}
                  placeholder="https://fonts.example.com"
                  value={fontOrigin}
                  disabled={fontsDisabled}
                  aria-invalid={!!fontError}
                  aria-describedby={
                    id +
                    "-font-help" +
                    (fontError ? " " + id + "-font-error" : "")
                  }
                  onChange={(value) => {
                    setFontOrigin(value);
                    setFontError(null);
                  }}
                />
              </div>
              <button
                type="button"
                className="sor-btn sor-btn-secondary min-h-9 shrink-0"
                disabled={
                  fontsDisabled ||
                  !fontOrigin.trim() ||
                  fontOrigins.length >= 16
                }
                onClick={() => {
                  if (updateOrigins([...fontOrigins, fontOrigin]))
                    setFontOrigin("");
                }}
              >
                Add font origin
              </button>
            </div>
            {fontError && (
              <p
                id={id + "-font-error"}
                role="alert"
                className="text-xs text-error"
              >
                {fontError}
              </p>
            )}
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={policy.sameOriginOnly}
              onClick={() => {
                if (
                  updatePolicy({
                    allowExternalFonts: true,
                    externalFontOrigins: [...DEFAULT_EXTERNAL_FONT_ORIGINS],
                  })
                )
                  setFontError(null);
              }}
            >
              Restore common fonts
            </button>
          </div>
          <div data-setting-key="webBrowser.defaultPolicy.externalResourceOrigins">
            <ExternalResourceOriginsEditor
              origins={policy.externalResourceOrigins ?? []}
              onChange={(externalResourceOrigins) =>
                updatePolicy({ externalResourceOrigins })
              }
              sameOriginOnly={policy.sameOriginOnly}
              pageScripts={policy.pageScripts}
              variant="settings"
            />
          </div>
          <p className="flex items-start gap-2 border-t border-[var(--color-border)] pt-3 text-xs leading-relaxed text-[var(--color-textMuted)]">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Credentials, login forwarding and consent remain controlled per
              connection. These defaults do not grant login consent.
            </span>
          </p>
        </Card>
      </div>
      <div className="space-y-4" data-setting-key="webBrowser.identity">
        <SectionHeader
          icon={<Fingerprint size={16} />}
          title="Browser identity and compatibility"
        />
        <Card>
          <Toggle
            settingKey="webBrowser.preferNativeUserAgent"
            label="Keep browser identity consistent"
            description="Ignore saved User-Agent header overrides so requests use the actual WebView identity and native client hints. Does not impersonate another browser. Close and reopen tabs to apply."
            checked={config.preferNativeUserAgent}
            onChange={(preferNativeUserAgent) =>
              update({ preferNativeUserAgent })
            }
          />
          {!config.preferNativeUserAgent && (
            <p role="status" className="text-xs text-warning">
              Saved User-Agent overrides will be honored where permitted. They
              can disagree with JavaScript browser identity and increase
              rejection. Provider-specific identity restrictions still apply.
            </p>
          )}
          <Toggle
            settingKey="webBrowser.preferNativeLanguage"
            label="Keep browser language consistent"
            description="Ignore saved Accept-Language header overrides and forward the runtime's language preference. Does not invent a locale or change your app language. Close and reopen tabs to apply."
            checked={config.preferNativeLanguage}
            onChange={(preferNativeLanguage) =>
              update({ preferNativeLanguage })
            }
          />
          <Toggle
            settingKey="webBrowser.hideAutomationIndicator"
            label="Hide WebDriver indicator (legacy only)"
            description="On by default for the legacy rewrite browser; not undetectable browsing. Native sessions already keep app automation in a private closure and do not enable the WebDriver flag. This preference does not change native security. Close and reopen legacy tabs to apply."
            checked={config.hideAutomationIndicator}
            disabled={config.engine !== "legacy"}
            onChange={(hideAutomationIndicator) =>
              update({ hideAutomationIndicator })
            }
          />
          {config.engine === "legacy" && config.hideAutomationIndicator && (
            <p role="status" className="text-xs text-warning">
              This is a detectable JavaScript override, not an undetectable
              browser mode. Some runtimes cannot apply it, and some sites may
              reject modified signals. Turn it off if verification gets worse.
            </p>
          )}
          <BrowserNumberRow
            settingKey="webBrowser.minimumFormFillDelayMs"
            label="Minimum autofill delay (ms)"
            description="Wait 0–30000 ms before generic DOM form autofill. Useful for pages that are still initializing. Longer connection-specific delays are preserved; staged application logins keep their own timing. Reopen tabs to apply."
            value={config.minimumFormFillDelayMs}
            min={0}
            max={30000}
            onChange={(minimumFormFillDelayMs) =>
              update({ minimumFormFillDelayMs })
            }
          />
          <BrowserNumberRow
            settingKey="webBrowser.minimumFormSubmitDelayMs"
            label="Minimum sign-in submit delay (ms)"
            description="Wait 0–30000 ms after filling a generic DOM form before its single automatic submit. Does not add retries or affect staged application logins, challenges, API-based logins or HTTP authentication. Reopen tabs to apply."
            value={config.minimumFormSubmitDelayMs}
            min={0}
            max={30000}
            onChange={(minimumFormSubmitDelayMs) =>
              update({ minimumFormSubmitDelayMs })
            }
          />
          <Toggle
            settingKey="webBrowser.manualFormSubmit"
            label="Require manual sign-in submission"
            description="Let consented DOM form auto-login fill fields, then click Sign in yourself. Also pauses automatic 2FA. API-based application logins and HTTP authentication are unaffected. Close and reopen tabs to apply form behavior."
            checked={config.manualFormSubmit}
            onChange={(manualFormSubmit) => update({ manualFormSubmit })}
          />
          <p className="text-xs text-[var(--color-textSecondary)]">
            Combined delays, including longer connection overrides, must fit
            within 52,000 ms to leave time for form detection. Incompatible
            combinations stop before automatic login starts.
          </p>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Compatibility controls reduce identity mismatches and automatic
            submissions. The optional WebDriver override changes only that
            page-visible indicator. These controls do not hide the iframe,
            change the TLS fingerprint, or guarantee browser verification.
          </p>
          <span className="sor-settings-row-label">
            Native user agent (read-only)
          </span>
          <output
            aria-label="Native user agent"
            className="block break-all font-mono text-xs text-[var(--color-textSecondary)]"
          >
            {userAgent}
          </output>
          <dl className="space-y-2 rounded-lg border border-[var(--color-border)] p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[var(--color-textSecondary)]">
                Runtime cookie support
              </dt>
              <dd>
                {environment
                  ? environment.cookies
                    ? "Enabled"
                    : "Disabled"
                  : "Unavailable"}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[var(--color-textSecondary)]">
                Runtime automation indicator
              </dt>
              <dd
                className={environment?.automation ? "text-warning" : undefined}
              >
                {environment?.automation == null
                  ? "Not reported"
                  : environment.automation
                    ? "Automation reported"
                    : "Not set"}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--color-textMuted)]">
            Runtime indicators describe this app window, not a site's cookie
            permissions or every native launch flag. No browser signals are
            modified by this diagnostic.
          </p>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Browser identity headers pass through from the embedded webview. The
            internal proxy mediates website traffic; this embedded environment
            is not a full browser. These settings do not guarantee Google
            sign-in or Cloudflare challenge compatibility.
          </p>
        </Card>
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
