/** Saved per-connection proxy policy. Query values may contain secrets. */
export interface HttpProxyPolicy {
  version: 1;
  pageScripts: "allow" | "inline-only" | "block";
  httpsOnly: boolean;
  /** Restricts mediated redirects, resources and forms; not a browser sandbox. */
  sameOriginOnly: boolean;
  /** Review redirects in a fresh anonymous tab; never forward credentials. */
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
    allowCrossOriginRedirects: false,
    allowHttpDowngradeRedirects: false,
    cacheMode: "normal",
    queryParameters: [],
  });
