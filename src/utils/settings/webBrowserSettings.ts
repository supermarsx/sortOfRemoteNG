import type {
  InternalProxySettings,
  WebBrowserSettingsConfig,
} from "../../types/settings/webBrowser";
import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import { normalizeHttpProxyPolicy } from "../connection/httpProxyPolicy";
import { MAX_BROWSER_FORM_COMBINED_DELAY_MS } from "../connection/httpFormAutomation";
import { normalizeWebsiteDomainPermissions } from "./websiteDomainPermissions";
import {
  normalizeBrowserHttpCacheSettings,
  normalizeBrowserTlsInterception,
  normalizeBrowserUpstreamTlsProfile,
  normalizeBrowserSessionRetention,
} from "./browserSessionSettings";

export const DEFAULT_INTERNAL_PROXY_SETTINGS: Readonly<InternalProxySettings> =
  Object.freeze({
    version: 1,
    connectTimeoutSeconds: 15,
    requestTimeoutSeconds: 120,
    poolIdleTimeoutSeconds: 20,
    maxIdleConnectionsPerHost: 4,
    tcpKeepaliveSeconds: 30,
    tcpNoDelay: true,
    maxClients: 256,
    maxConnectionsPerHost: 6,
    dnsConcurrency: 16,
    includeErrorTrace: true,
    expandErrorDetails: false,
    httpErrorConversion: "off",
    maxHeaderBytes: 8192,
    headerTimeoutSeconds: 10,
    responseTimeoutSeconds: 5,
    httpResponseTimeoutSeconds: 60,
    httpIdleTimeoutSeconds: 60,
    dnsTimeoutSeconds: 10,
    dnsCacheTtlSeconds: 0,
    dnsCacheMaxEntries: 256,
    addressFamily: "system",
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

function boolean(
  value: unknown,
  fallback: boolean,
  section = "web browser",
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") return invalid(section);
  return value;
}

function choice<T extends string>(
  value: unknown,
  fallback: T,
  choices: readonly T[],
  section: string,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value as T))
    return invalid(section);
  return value as T;
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
          "engine",
          "idlePrewarmEnabled",
          "showBookmarksBar",
          "showSecurityInfo",
          "showLoadingProgress",
          "defaultZoomPercent",
          "allowDownloads",
          "allowPageDialogs",
          "xsltEnabled",
          "preferNativeUserAgent",
          "preferNativeLanguage",
          "hideAutomationIndicator",
          "localStorageEnabled",
          "databasesEnabled",
          "webglEnabled",
          "cookiesEnabled",
          "mediaStreamEnabled",
          "crossOriginRequestsEnabled",
          "websiteExtensionsEnabled",
          "minimumFormFillDelayMs",
          "minimumFormSubmitDelayMs",
          "manualFormSubmit",
          "popupPolicy",
          "initialLoadTimeoutSeconds",
          "documentReadyTimeoutSeconds",
          "defaultPolicy",
          "domainPermissions",
          "sessionRetention",
          "restoreCookies",
          "httpCache",
          "tlsInterception",
          "upstreamTlsProfile",
          "allowWeakCertificates",
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
  if (
    row.engine !== undefined &&
    row.engine !== "real-origin" &&
    row.engine !== "legacy"
  )
    return invalid("web browser");
  // Global defaults contain neither secrets nor redirect/credential grants.
  // Those decisions continue to require per-connection review.
  if (
    defaultPolicy.queryParameters.length ||
    defaultPolicy.allowAllScripts ||
    defaultPolicy.allowAllRequests ||
    defaultPolicy.allowCrossOriginRedirects ||
    defaultPolicy.allowHttpDowngradeRedirects
  )
    return invalid("web browser");
  const settings: WebBrowserSettingsConfig = {
    version: 1,
    // Persisted legacy values may be explicit choices or earlier normalized
    // defaults. Without provenance, preserve both; only missing keys migrate.
    engine: row.engine === "legacy" ? "legacy" : "real-origin",
    idlePrewarmEnabled: boolean(row.idlePrewarmEnabled, true),
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
    allowDownloads: boolean(row.allowDownloads, row.engine !== "legacy"),
    allowPageDialogs: boolean(row.allowPageDialogs, row.engine !== "legacy"),
    xsltEnabled: boolean(row.xsltEnabled, true),
    preferNativeUserAgent: boolean(row.preferNativeUserAgent, true),
    preferNativeLanguage: boolean(row.preferNativeLanguage, true),
    hideAutomationIndicator: boolean(row.hideAutomationIndicator, true),
    localStorageEnabled: boolean(row.localStorageEnabled, true),
    databasesEnabled: boolean(row.databasesEnabled, true),
    webglEnabled: boolean(row.webglEnabled, true),
    cookiesEnabled: boolean(row.cookiesEnabled, true),
    mediaStreamEnabled: boolean(row.mediaStreamEnabled, true),
    crossOriginRequestsEnabled: boolean(row.crossOriginRequestsEnabled, true),
    websiteExtensionsEnabled: boolean(row.websiteExtensionsEnabled, true),
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
    // Match native authorization for missing saved policy on every engine.
    // Preserve explicit booleans, including previously normalized false values.
    manualFormSubmit: boolean(row.manualFormSubmit, true),
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
    sessionRetention: normalizeBrowserSessionRetention(row.sessionRetention),
    restoreCookies: boolean(row.restoreCookies, true),
    httpCache: normalizeBrowserHttpCacheSettings(row.httpCache),
    tlsInterception: normalizeBrowserTlsInterception(row.tlsInterception),
    allowWeakCertificates: boolean(row.allowWeakCertificates, false),
    upstreamTlsProfile: normalizeBrowserUpstreamTlsProfile(
      row.upstreamTlsProfile,
    ),
    ...(row.domainPermissions === undefined
      ? {}
      : {
          domainPermissions: normalizeWebsiteDomainPermissions(
            row.domainPermissions,
          ),
        }),
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
          "tcpNoDelay",
          "maxClients",
          "maxConnectionsPerHost",
          "dnsConcurrency",
          "includeErrorTrace",
          "expandErrorDetails",
          "httpErrorConversion",
          "maxHeaderBytes",
          "headerTimeoutSeconds",
          "responseTimeoutSeconds",
          "httpResponseTimeoutSeconds",
          "httpIdleTimeoutSeconds",
          "dnsTimeoutSeconds",
          "dnsCacheTtlSeconds",
          "dnsCacheMaxEntries",
          "addressFamily",
        ].includes(key),
    )
  )
    return invalid("internal proxy");
  const settings: InternalProxySettings = {
    version: 1,
    tcpNoDelay: boolean(row.tcpNoDelay, true, "internal proxy"),
    maxClients: integer(row.maxClients, 256, 16, 256, "internal proxy"),
    maxConnectionsPerHost: integer(
      row.maxConnectionsPerHost,
      6,
      1,
      64,
      "internal proxy",
    ),
    dnsConcurrency: integer(row.dnsConcurrency, 16, 1, 16, "internal proxy"),
    includeErrorTrace: boolean(row.includeErrorTrace, true, "internal proxy"),
    expandErrorDetails: boolean(
      row.expandErrorDetails,
      false,
      "internal proxy",
    ),
    httpErrorConversion: (() => {
      const mode = row.httpErrorConversion ?? "off";
      if (mode !== "off" && mode !== "server-errors" && mode !== "all-errors")
        return invalid("internal proxy error conversion");
      return mode;
    })(),
    maxHeaderBytes: integer(
      row.maxHeaderBytes,
      8192,
      1024,
      16384,
      "internal proxy",
    ),
    headerTimeoutSeconds: integer(
      row.headerTimeoutSeconds,
      10,
      1,
      120,
      "internal proxy",
    ),
    responseTimeoutSeconds: integer(
      row.responseTimeoutSeconds,
      5,
      1,
      120,
      "internal proxy",
    ),
    httpResponseTimeoutSeconds: integer(
      row.httpResponseTimeoutSeconds,
      60,
      5,
      120,
      "internal proxy",
    ),
    httpIdleTimeoutSeconds: integer(
      row.httpIdleTimeoutSeconds,
      60,
      5,
      120,
      "internal proxy",
    ),
    dnsTimeoutSeconds: integer(
      row.dnsTimeoutSeconds,
      10,
      1,
      60,
      "internal proxy",
    ),
    dnsCacheTtlSeconds: integer(
      row.dnsCacheTtlSeconds,
      0,
      0,
      3600,
      "internal proxy",
    ),
    dnsCacheMaxEntries: integer(
      row.dnsCacheMaxEntries,
      256,
      16,
      4096,
      "internal proxy",
    ),
    addressFamily: choice(
      row.addressFamily,
      "system",
      ["system", "ipv4-first", "ipv6-first", "ipv4-only", "ipv6-only"] as const,
      "internal proxy",
    ),
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
