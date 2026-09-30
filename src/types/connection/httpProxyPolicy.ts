/** Saved per-connection proxy policy. Query values may contain secrets. */
export interface HttpProxyPolicy {
  version: 1;
  pageScripts: "allow" | "inline-only" | "block";
  httpsOnly: boolean;
  /** Restricts mediated redirects, resources and forms; not a browser sandbox. */
  sameOriginOnly: boolean;
  /** Anonymous external font requests through the proxy; sameOriginOnly overrides. */
  allowExternalFonts?: boolean;
  /** Exact HTTPS origins for both font stylesheets and font binaries (maximum 16). */
  externalFontOrigins?: string[];
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
    httpsOnly: false,
    sameOriginOnly: false,
    allowExternalFonts: false,
    externalFontOrigins: [],
    allowCrossOriginRedirects: false,
    allowHttpDowngradeRedirects: false,
    cacheMode: "normal",
    queryParameters: [],
  });
