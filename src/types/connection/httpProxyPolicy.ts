import commonResourceOrigins from "../../utils/protocol/commonResourceOrigins.json";

export interface HttpExternalResourceOrigin {
  origin: string;
  kinds: Array<"script" | "stylesheet">;
}

export const DEFAULT_EXTERNAL_FONT_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
] as const;

/** Common publisher/CDN hosts, not a guarantee about hosted script contents. */
export const DEFAULT_EXTERNAL_RESOURCE_ORIGINS: readonly HttpExternalResourceOrigin[] =
  commonResourceOrigins as HttpExternalResourceOrigin[];

/** Saved per-connection proxy policy. Query values may contain secrets. */
export interface HttpProxyPolicy {
  version: 1;
  pageScripts: "allow" | "inline-only" | "block";
  /** Per-connection trust for all HTTPS script sources through the app proxy.
   * Legacy mode also overrides script CSP; native mode preserves website CSP.
   * pageScripts restrictions and sameOriginOnly still take precedence. */
  allowAllScripts?: boolean;
  /** Connection-scoped trust for supported HTTP(S) requests and navigation
   * through the app proxy. Legacy resources retain anonymous transport rules;
   * native requests use their isolated browser session and website CSP/CORS.
   * Overrides source lists, not explicit native domain denials, HTTPS,
   * sameOriginOnly, transport support or saved-login/credential consent. */
  allowAllRequests?: boolean;
  httpsOnly: boolean;
  /** Restricts mediated redirects, resources and forms; not a browser sandbox. */
  sameOriginOnly: boolean;
  /** Anonymous external font requests through the proxy; sameOriginOnly overrides. */
  allowExternalFonts?: boolean;
  /** Exact HTTPS origins for both font stylesheets and font binaries (maximum 16). */
  externalFontOrigins?: string[];
  /** Anonymous script/stylesheet GETs through the proxy; [] removes listed grants,
   * but does not revoke a broader allowAllScripts/allowAllRequests opt-in. */
  externalResourceOrigins?: HttpExternalResourceOrigin[];
  /** Review each origin before same-tab or anonymous handoff; login consent is separate. */
  allowCrossOriginRedirects?: boolean;
  /** Separate explicit downgrade review consent; httpsOnly always takes precedence. */
  allowHttpDowngradeRedirects?: boolean;
  cacheMode: "normal" | "bypass";
  queryParameters: Array<{ name: string; value: string }>;
}

export const DEFAULT_HTTP_PROXY_POLICY: Readonly<HttpProxyPolicy> =
  Object.freeze({
    version: 1,
    pageScripts: "allow",
    allowAllScripts: false,
    allowAllRequests: false,
    httpsOnly: false,
    sameOriginOnly: false,
    allowExternalFonts: true,
    externalFontOrigins: [...DEFAULT_EXTERNAL_FONT_ORIGINS],
    externalResourceOrigins: DEFAULT_EXTERNAL_RESOURCE_ORIGINS.map((row) => ({
      origin: row.origin,
      kinds: [...row.kinds],
    })),
    allowCrossOriginRedirects: false,
    allowHttpDowngradeRedirects: false,
    cacheMode: "normal",
    queryParameters: [],
  });
