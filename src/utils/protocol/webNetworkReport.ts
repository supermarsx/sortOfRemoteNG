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
  quickConnectNavigation: boolean;
  quickConnectDiscovery: boolean;
  quickConnectDiscovered: boolean;
  quickConnectDirectNavigation: boolean;
}
/** Advisory only; invoke after the existing primary-document readiness fence. */
export function webNetworkRoutingStatus(
  value: unknown,
  expectedQuickConnect: boolean,
  expectedAliasRoutes = false,
): WebNetworkRoutingStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      status: "missing",
      quickConnectNavigation: false,
      quickConnectDiscovery: false,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
    };
  const data = value as Record<string, unknown>;
  if (
    data.version !== 3 ||
    typeof data.quickConnectNavigation !== "boolean" ||
    typeof data.quickConnectDiscovery !== "boolean" ||
    typeof data.quickConnectDiscovered !== "boolean" ||
    typeof data.quickConnectDirectNavigation !== "boolean"
  )
    return {
      status: "missing",
      quickConnectNavigation: false,
      quickConnectDiscovery: false,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
    };
  return {
    status:
      data.quickConnectNavigation === expectedQuickConnect &&
      data.quickConnectDiscovery === expectedAliasRoutes &&
      data.quickConnectDiscovered === expectedAliasRoutes &&
      data.quickConnectDirectNavigation === expectedAliasRoutes
        ? "current"
        : "mismatch",
    quickConnectNavigation: data.quickConnectNavigation,
    quickConnectDiscovery: data.quickConnectDiscovery,
    quickConnectDiscovered: data.quickConnectDiscovered,
    quickConnectDirectNavigation: data.quickConnectDirectNavigation,
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
