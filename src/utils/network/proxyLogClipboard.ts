import type { ProxyRequestLogEntry } from "../../hooks/network/useInternalProxyManager";

export const PROXY_LOG_COPY_LIMIT = 1000;
const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
  "OTHER",
]);
const CODES = new Set([
  "quickconnect_request_authority",
  "quickconnect_unsupported_request",
  "quickconnect_defaults_disabled",
  "quickconnect_source_scope",
  "quickconnect_verified_route_unavailable",
  "quickconnect_request_limit",
  "quickconnect_body_limit",
  "quickconnect_unsupported_body",
  "quickconnect_stale_document",
  "quickconnect_verified_exchange_failed",
  "quickconnect_timeout",
  "quickconnect_upstream_status",
  // Retained entries may come from an older native module.
  "quickconnect_destination_not_discovered",
  "websocket_handshake",
]);
const ROUTES: Readonly<Record<string, string>> = {
  "/__sortofremoteng_quickconnect_control_v1": "QuickConnect discovery",
  "/__sortofremoteng_quickconnect_discovered_v1":
    "QuickConnect control/probe endpoint (operation unknown)",
  "/__sortofremoteng_quickconnect_redirect_v1": "QuickConnect redirect",
};

function destination(value: string): { origin: string; category: string } {
  if (value === "WebSocket handshake")
    return { origin: "unavailable", category: "WebSocket handshake" };
  if (typeof value !== "string" || value.length > 16_384)
    return { origin: "unavailable", category: "unknown" };
  const described =
    /^(Attempted )?(QuickConnect tunnel setup|QuickConnect regional discovery|QuickConnect NAS probe): (.+)$/.exec(
      value,
    );
  try {
    const url = new URL(described?.[3] ?? value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol))
      throw new Error();
    const category = described
      ? `${described[1] ?? ""}${described[2]}`
      : (ROUTES[url.pathname] ??
        (url.pathname.startsWith("/__sortofremoteng_assets_v1/synology-inter/")
          ? "Synology font asset"
          : "unknown"));
    return { origin: url.origin, category };
  } catch {
    return { origin: "unavailable", category: "unknown" };
  }
}

/** The manager supplies newest-first retained entries, not the visible page.
 * Never serialize arbitrary DTO properties, request URLs or native error text.
 */
export function proxyLogClipboard(entries: readonly ProxyRequestLogEntry[]): {
  count: number;
  text: string;
} {
  const selected = entries.slice(0, PROXY_LOG_COPY_LIMIT).reverse();
  const sessions = new Map<string, number>();
  const lines = selected.map((entry, index) => {
    if (!sessions.has(entry.session_id))
      sessions.set(entry.session_id, sessions.size + 1);
    const sequence =
      typeof entry.id === "string" && /^\d{1,20}$/.test(entry.id)
        ? entry.id
        : "unavailable";
    const time =
      typeof entry.timestamp === "string" &&
      /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(entry.timestamp)
        ? new Date(entry.timestamp)
        : null;
    const timestamp =
      time && Number.isFinite(time.getTime())
        ? time.toISOString()
        : "unavailable";
    const status =
      Number.isInteger(entry.status) &&
      entry.status >= 100 &&
      entry.status <= 599
        ? String(entry.status)
        : "unknown";
    const diagnostic =
      typeof entry.error === "string"
        ? /^HTTP \d{3} \[([a-z_]+)\]$/.exec(entry.error)?.[1]
        : undefined;
    const route = destination(entry.url);
    return `${index + 1}. sequence=${sequence} | ${timestamp} | session-${sessions.get(entry.session_id)} | ${METHODS.has(entry.method) ? entry.method : "OTHER"} | HTTP ${status} | ${route.origin} | ${route.category}${diagnostic && CODES.has(diagnostic) ? ` | [${diagnostic}]` : ""}`;
  });
  return {
    count: selected.length,
    text: [
      `Internal proxy log — latest ${selected.length} of ${entries.length} retained entries (maximum ${PROXY_LOG_COPY_LIMIT}).`,
      "Order: oldest to newest within this snapshot; all retained sessions, independent of the visible page.",
      "Privacy: URL paths, queries, fragments, userinfo, headers, bodies and free-form errors omitted. Only known diagnostic codes and route categories retained; unknown is not classified as a document.",
      "Session labels are local to this copy. Request duration is unavailable in this log. HTTP status records the proxy response, not proof of successful website sign-in.",
      "",
      ...lines,
    ].join("\n"),
  };
}
