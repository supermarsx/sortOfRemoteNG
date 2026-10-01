import type {
  InternalProxySettings,
  WebBrowserSettingsConfig,
} from "../../types/settings/webBrowser";
import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import { normalizeHttpProxyPolicy } from "../connection/httpProxyPolicy";
import { MAX_BROWSER_FORM_COMBINED_DELAY_MS } from "../connection/httpFormAutomation";

export const DEFAULT_INTERNAL_PROXY_SETTINGS: Readonly<InternalProxySettings> =
  Object.freeze({
    version: 1,
    connectTimeoutSeconds: 15,
    requestTimeoutSeconds: 120,
    poolIdleTimeoutSeconds: 20,
    maxIdleConnectionsPerHost: 4,
    tcpKeepaliveSeconds: 30,
  });

const invalid = (section: string): never => {
  throw new Error(
    `Invalid ${section} settings. Review the values in Settings.`,
  );
};

function record(value: unknown, section: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid(section);
  const row = value as Record<string, unknown>;
  if (row.version !== undefined && row.version !== 1) return invalid(section);
  return row;
}

function integer(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  section: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    return invalid(section);
  return value;
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") return invalid("web browser");
  return value;
}

/** Fill missing legacy keys; never silently widen a malformed website policy. */
export function normalizeWebBrowserSettings(
  value: unknown,
): WebBrowserSettingsConfig {
  const row = record(value, "web browser");
  if (
    Object.keys(row).some(
      (key) =>
        ![
          "version",
          "showBookmarksBar",
          "showSecurityInfo",
          "showLoadingProgress",
          "defaultZoomPercent",
          "allowDownloads",
          "allowPageDialogs",
          "preferNativeUserAgent",
          "preferNativeLanguage",
          "hideAutomationIndicator",
          "minimumFormFillDelayMs",
          "minimumFormSubmitDelayMs",
          "manualFormSubmit",
          "popupPolicy",
          "initialLoadTimeoutSeconds",
          "documentReadyTimeoutSeconds",
          "defaultPolicy",
        ].includes(key),
    )
  )
    return invalid("web browser");
  if (
    row.popupPolicy !== undefined &&
    row.popupPolicy !== "tabs" &&
    row.popupPolicy !== "block"
  )
    return invalid("web browser");
  const defaultPolicy = normalizeHttpProxyPolicy(row.defaultPolicy);
  // Global defaults contain neither secrets nor redirect/credential grants.
  // Those decisions continue to require per-connection review.
  if (
    defaultPolicy.queryParameters.length ||
    defaultPolicy.allowCrossOriginRedirects ||
    defaultPolicy.allowHttpDowngradeRedirects
  )
    return invalid("web browser");
  const settings: WebBrowserSettingsConfig = {
    version: 1,
    showBookmarksBar: boolean(row.showBookmarksBar, true),
    showSecurityInfo: boolean(row.showSecurityInfo, true),
    showLoadingProgress: boolean(row.showLoadingProgress, true),
    defaultZoomPercent: integer(
      row.defaultZoomPercent,
      100,
      50,
      200,
      "web browser",
    ),
    allowDownloads: boolean(row.allowDownloads, false),
    allowPageDialogs: boolean(row.allowPageDialogs, false),
    preferNativeUserAgent: boolean(row.preferNativeUserAgent, true),
    preferNativeLanguage: boolean(row.preferNativeLanguage, true),
    hideAutomationIndicator: boolean(row.hideAutomationIndicator, false),
    minimumFormFillDelayMs: integer(
      row.minimumFormFillDelayMs,
      0,
      0,
      30000,
      "web browser",
    ),
    minimumFormSubmitDelayMs: integer(
      row.minimumFormSubmitDelayMs,
      0,
      0,
      30000,
      "web browser",
    ),
    manualFormSubmit: boolean(row.manualFormSubmit, false),
    popupPolicy: row.popupPolicy === "block" ? "block" : "tabs",
    initialLoadTimeoutSeconds: integer(
      row.initialLoadTimeoutSeconds,
      30,
      10,
      120,
      "web browser",
    ),
    documentReadyTimeoutSeconds: integer(
      row.documentReadyTimeoutSeconds,
      120,
      30,
      240,
      "web browser",
    ),
    defaultPolicy,
  };
  if (
    settings.minimumFormFillDelayMs + settings.minimumFormSubmitDelayMs >
    MAX_BROWSER_FORM_COMBINED_DELAY_MS
  )
    throw new Error(
      "Invalid web browser settings: combined autofill and submit delays must total at most 52,000 ms.",
    );
  return settings;
}

/** The field bounds mirror native validation; invalid patches are rejected. */
export function normalizeInternalProxySettings(
  value: unknown,
): InternalProxySettings {
  const row = record(value, "internal proxy");
  if (
    Object.keys(row).some(
      (key) =>
        ![
          "version",
          "connectTimeoutSeconds",
          "requestTimeoutSeconds",
          "poolIdleTimeoutSeconds",
          "maxIdleConnectionsPerHost",
          "tcpKeepaliveSeconds",
        ].includes(key),
    )
  )
    return invalid("internal proxy");
  const settings: InternalProxySettings = {
    version: 1,
    connectTimeoutSeconds: integer(
      row.connectTimeoutSeconds,
      15,
      1,
      120,
      "internal proxy",
    ),
    requestTimeoutSeconds: integer(
      row.requestTimeoutSeconds,
      120,
      5,
      600,
      "internal proxy",
    ),
    poolIdleTimeoutSeconds: integer(
      row.poolIdleTimeoutSeconds,
      20,
      0,
      300,
      "internal proxy",
    ),
    maxIdleConnectionsPerHost: integer(
      row.maxIdleConnectionsPerHost,
      4,
      0,
      32,
      "internal proxy",
    ),
    tcpKeepaliveSeconds: integer(
      row.tcpKeepaliveSeconds,
      30,
      0,
      300,
      "internal proxy",
    ),
  };
  if (settings.requestTimeoutSeconds < settings.connectTimeoutSeconds)
    return invalid("internal proxy");
  return settings;
}

/** A saved connection policy is a complete override, never merged with grants. */
export function resolveBrowserProxyPolicy(
  savedPolicy: unknown,
  browserSettings: unknown,
): HttpProxyPolicy {
  return savedPolicy === undefined
    ? normalizeWebBrowserSettings(browserSettings).defaultPolicy
    : normalizeHttpProxyPolicy(savedPolicy);
}
