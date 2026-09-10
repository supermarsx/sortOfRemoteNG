/** Saved per-connection proxy policy. Query values may contain secrets. */
export interface HttpProxyPolicy {
  version: 1;
  pageScripts: "allow" | "inline-only" | "block";
  httpsOnly: boolean;
  /** Restricts mediated redirects, resources and forms; not a browser sandbox. */
  sameOriginOnly: boolean;
  cacheMode: "normal" | "bypass";
  queryParameters: Array<{ name: string; value: string }>;
}

export const DEFAULT_HTTP_PROXY_POLICY: Readonly<HttpProxyPolicy> =
  Object.freeze({
    version: 1,
    pageScripts: "allow",
    httpsOnly: false,
    sameOriginOnly: false,
    cacheMode: "normal",
    queryParameters: [],
  });
