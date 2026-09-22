const kinds = new Set([
  "fetch",
  "xhr",
  "beacon",
  "eventsource",
  "websocket",
  "resource",
  "css",
  "font",
  "form",
  "navigation",
  "document",
  "compatibility",
  "window",
  "Worker",
  "SharedWorker",
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "WebTransport",
  "serviceworker",
  "worklet",
]);
const reasons = new Set([
  "origin-not-approved",
  "policy-blocked-resource",
  "font-read-only",
  "quickconnect-control-method",
  "quickconnect-probe-method",
  "unsupported-network-context",
  "unsupported-scheme",
  "invalid-url",
  "url-credentials",
  "document-closed",
  "document-expired",
  "document-activation-failed",
  "reserved-url-parameter",
  "unavailable-interceptor",
  "unsupported-srcset",
  "unsupported-css-url-syntax",
  "request-body-too-large",
  "unsupported-request-body",
]);
export interface WebNetworkReport {
  kind: string;
  reason: string;
  origin: string | null;
}
export interface WebNetworkRoutingStatus {
  status: "current" | "missing" | "mismatch";
  tacticalRmmApi: boolean;
  tacticalRmmApiExpected: boolean;
  tacticalRmmApiOrigins: string[];
  fetchInterception: boolean;
  xhrInterception: boolean;
  pageNetworkInterception: boolean;
  quickConnectNavigation: boolean;
  quickConnectDiscovery: boolean;
  quickConnectDiscovered: boolean;
  quickConnectDirectNavigation: boolean;
  quickConnectRegionalNavigation: boolean;
  googleSession?: {
    status: "ready" | "unavailable";
    origins: string[];
    documents: boolean;
    forms: boolean;
    fetch: boolean;
    xhr: boolean;
    resources: boolean;
    nativeCookies: boolean;
    nativeUserAgent: boolean;
    documentCookieBridge: boolean;
  };
}

function emptyRoutingStatus(
  expectedTacticalRmmApi: boolean,
): WebNetworkRoutingStatus {
  return {
    status: "missing",
    tacticalRmmApi: false,
    tacticalRmmApiExpected: expectedTacticalRmmApi,
    tacticalRmmApiOrigins: [],
    fetchInterception: false,
    xhrInterception: false,
    pageNetworkInterception: false,
    quickConnectNavigation: false,
    quickConnectDiscovery: false,
    quickConnectDiscovered: false,
    quickConnectDirectNavigation: false,
    quickConnectRegionalNavigation: false,
  };
}

/** Page code can report only a compact, canonical set of reviewed API origins.
 * The receipt is advisory and never widens the native route. */
function parseTacticalRmmApiOrigins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const origins: string[] = [];
  for (const valueOrigin of value) {
    if (typeof valueOrigin !== "string" || valueOrigin.length > 512)
      return null;
    let url: URL;
    try {
      url = new URL(valueOrigin);
    } catch {
      return null;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.origin !== valueOrigin ||
      !url.hostname.includes(".") ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".") ||
      origins.includes(valueOrigin)
    )
      return null;
    origins.push(valueOrigin);
  }
  return origins;
}

/** Advisory only; invoke after the existing primary-document readiness fence. */
export function webNetworkRoutingStatus(
  value: unknown,
  expectedQuickConnect: boolean,
  expectedAliasRoutes = false,
  expectedTacticalRmmApi = false,
  expectedGoogleOrigins: readonly string[] = [],
): WebNetworkRoutingStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return emptyRoutingStatus(expectedTacticalRmmApi);
  const data = value as Record<string, unknown>;
  const tacticalRmmApiOrigins = parseTacticalRmmApiOrigins(
    data.tacticalRmmApiOrigins,
  );
  if (
    data.version !== 6 ||
    typeof data.tacticalRmmApi !== "boolean" ||
    tacticalRmmApiOrigins === null ||
    typeof data.fetchInterception !== "boolean" ||
    typeof data.xhrInterception !== "boolean" ||
    typeof data.pageNetworkInterception !== "boolean" ||
    typeof data.quickConnectNavigation !== "boolean" ||
    typeof data.quickConnectDiscovery !== "boolean" ||
    typeof data.quickConnectDiscovered !== "boolean" ||
    typeof data.quickConnectDirectNavigation !== "boolean" ||
    typeof data.quickConnectRegionalNavigation !== "boolean"
  )
    return emptyRoutingStatus(expectedTacticalRmmApi);
  const pageNetworkInterceptionReady =
    data.fetchInterception &&
    data.xhrInterception &&
    data.pageNetworkInterception;
  const tacticalRmmApiReady =
    data.tacticalRmmApi &&
    tacticalRmmApiOrigins.length > 0 &&
    pageNetworkInterceptionReady;
  const tacticalRmmApiMatches = expectedTacticalRmmApi
    ? tacticalRmmApiReady
    : !data.tacticalRmmApi && tacticalRmmApiOrigins.length === 0;
  const google =
    data.googleSession && typeof data.googleSession === "object"
      ? (data.googleSession as Record<string, unknown>)
      : {};
  const googleOrigins =
    Array.isArray(google.origins) &&
    google.origins.length === expectedGoogleOrigins.length &&
    new Set(google.origins).size === expectedGoogleOrigins.length &&
    google.origins.every((origin) => expectedGoogleOrigins.includes(origin))
      ? [...expectedGoogleOrigins]
      : [];
  const googleReady =
    pageNetworkInterceptionReady &&
    google.version === 1 &&
    googleOrigins.length > 0 &&
    [
      "documents",
      "forms",
      "fetch",
      "xhr",
      "resources",
      "nativeCookies",
      "nativeUserAgent",
    ].every((key) => google[key] === true) &&
    google.documentCookieBridge === true;
  const googleMatches =
    expectedGoogleOrigins.length > 0
      ? googleReady
      : data.googleSession === undefined;
  return {
    status:
      data.quickConnectNavigation === expectedQuickConnect &&
      pageNetworkInterceptionReady &&
      tacticalRmmApiMatches &&
      googleMatches &&
      data.quickConnectDiscovery === expectedAliasRoutes &&
      data.quickConnectDiscovered === expectedAliasRoutes &&
      data.quickConnectDirectNavigation === expectedAliasRoutes &&
      data.quickConnectRegionalNavigation === expectedAliasRoutes
        ? "current"
        : "mismatch",
    tacticalRmmApi: data.tacticalRmmApi,
    tacticalRmmApiExpected: expectedTacticalRmmApi,
    tacticalRmmApiOrigins,
    fetchInterception: data.fetchInterception,
    xhrInterception: data.xhrInterception,
    pageNetworkInterception: data.pageNetworkInterception,
    quickConnectNavigation: data.quickConnectNavigation,
    quickConnectDiscovery: data.quickConnectDiscovery,
    quickConnectDiscovered: data.quickConnectDiscovered,
    quickConnectDirectNavigation: data.quickConnectDirectNavigation,
    quickConnectRegionalNavigation: data.quickConnectRegionalNavigation,
    ...(expectedGoogleOrigins.length || data.googleSession !== undefined
      ? {
          googleSession: {
            status: googleReady ? ("ready" as const) : ("unavailable" as const),
            origins: googleOrigins,
            documents: google.documents === true,
            forms: google.forms === true,
            fetch: google.fetch === true,
            xhr: google.xhr === true,
            resources: google.resources === true,
            nativeCookies: google.nativeCookies === true,
            nativeUserAgent: google.nativeUserAgent === true,
            documentCookieBridge: google.documentCookieBridge === true,
          },
        }
      : {}),
  };
}
export interface WebNetworkDocument {
  sessionId: string;
  token: string;
  sequence: number;
  navigationToken: string | null;
  url: string;
}
/** Only allow fixed diagnostic categories and exact origins, never page text,
 * paths, query strings, request bodies, headers, or arbitrary error messages. */
export function parseWebNetworkReport(
  value: unknown,
  document: WebNetworkDocument,
): WebNetworkReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== "sorng_web_network_blocked" ||
    data.version !== 1 ||
    data.sessionId !== document.sessionId ||
    data.documentToken !== document.token ||
    data.documentSequence !== document.sequence ||
    data.navigationToken !== document.navigationToken ||
    data.url !== document.url ||
    typeof data.kind !== "string" ||
    !kinds.has(data.kind) ||
    typeof data.reason !== "string" ||
    !reasons.has(data.reason)
  )
    return null;
  let origin: string | null = null;
  if (data.origin !== null) {
    if (typeof data.origin !== "string" || data.origin.length > 2048)
      return null;
    try {
      const url = new URL(data.origin);
      if (
        !/^https?:$/.test(url.protocol) ||
        url.username ||
        url.password ||
        url.origin !== data.origin
      )
        return null;
      origin = url.origin;
    } catch {
      return null;
    }
  }
  return { kind: data.kind, reason: data.reason, origin };
}
export function appendWebNetworkReport(
  rows: readonly WebNetworkReport[],
  next: WebNetworkReport,
): WebNetworkReport[] {
  if (
    rows.length >= 32 ||
    rows.some(
      (row) =>
        row.kind === next.kind &&
        row.reason === next.reason &&
        row.origin === next.origin,
    )
  )
    return rows as WebNetworkReport[];
  return [...rows, next];
}
