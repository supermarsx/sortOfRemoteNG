import type { ProxyRequestLogEntry } from "../../hooks/network/useInternalProxyManager";
import {
  parseProxyLogDiagnostic,
  proxyDiagnosticLabels,
  PROXY_DIAGNOSTIC_EXPLANATIONS,
} from "./proxyLogDiagnostic";

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
const CODES = new Set(Object.keys(PROXY_DIAGNOSTIC_EXPLANATIONS));
const ROUTES: Readonly<Record<string, string>> = {
  "/__sortofremoteng_quickconnect_control_v1": "QuickConnect discovery",
  "/__sortofremoteng_quickconnect_discovered_v1":
    "QuickConnect control/probe endpoint (operation unknown)",
  "/__sortofremoteng_quickconnect_redirect_v1": "QuickConnect redirect",
};

export function proxyLogDestination(value: string): {
  origin: string;
  category: string;
} {
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
  const attempts = new Map<string, number>();
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
    const route = proxyLogDestination(entry.url);
    const detail = parseProxyLogDiagnostic(entry.diagnostic);
    const metadata: string[] = [];
    if (detail) {
      const labels = proxyDiagnosticLabels(detail);
      metadata.push(
        `phase=${labels.phase}`,
        `stage=${labels.stage}`,
        `outcome=${labels.outcome}`,
        `durationMs=${detail.durationMs}`,
        `[${detail.code}]`,
      );
      if (detail.lane) metadata.push(`lane=${detail.lane}`);
      if (detail.queueMs !== undefined)
        metadata.push(`queueMs=${detail.queueMs}`);
      if (detail.activeMs !== undefined)
        metadata.push(`activeMs=${detail.activeMs}`);
      if (detail.upstreamStatus !== undefined)
        metadata.push(`upstreamHTTP=${detail.upstreamStatus}`);
      if (detail.attemptId) {
        if (!attempts.has(detail.attemptId))
          attempts.set(detail.attemptId, attempts.size + 1);
        metadata.push(`attempt-${attempts.get(detail.attemptId)}`);
      }
      if (detail.hop !== undefined) metadata.push(`hop=${detail.hop}`);
      if (detail.redirectTargetOrigin !== undefined) {
        metadata.push(`redirectSourceOrigin=${route.origin}`);
        metadata.push(`redirectTargetOrigin=${detail.redirectTargetOrigin}`);
      }
      if (detail.redirectSourcePath !== undefined)
        metadata.push(`redirectSourcePath=${detail.redirectSourcePath}`);
      if (detail.redirectTargetPath !== undefined)
        metadata.push(`redirectTargetPath=${detail.redirectTargetPath}`);
      if (detail.redirectQueryRemoved !== undefined)
        metadata.push(`redirectQueryRemoved=${detail.redirectQueryRemoved}`);
      if (detail.sameOriginRedirects !== undefined)
        metadata.push(`sameOriginRedirects=${detail.sameOriginRedirects}`);
      if (labels.candidate)
        metadata.push("candidate result only; not the final connection result");
    }
    return `${index + 1}. sequence=${sequence} | ${timestamp} | session-${sessions.get(entry.session_id)} | ${METHODS.has(entry.method) ? entry.method : "OTHER"} | HTTP ${status} | ${route.origin} | ${route.category}${!detail && diagnostic && CODES.has(diagnostic) ? ` | [${diagnostic}]` : ""}${metadata.length ? ` | ${metadata.join(" | ")}` : ""}`;
  });
  return {
    count: selected.length,
    text: [
      `Internal proxy log — latest ${selected.length} of ${entries.length} retained entries (maximum ${PROXY_LOG_COPY_LIMIT}).`,
      "Order: oldest to newest within this snapshot; all retained sessions, independent of the visible page.",
      "Privacy: URL paths, queries, fragments, userinfo, headers, bodies and free-form errors omitted. Only known diagnostic codes and route categories retained; unknown is not classified as a document.",
      "Redirect diagnostics retain origins and root/DSM/other path categories only. upstreamHTTP is the server response before any local handoff response; sameOriginRedirects counts internal follows. Query-removal records sanitization, not the removed values. A successful relay candidate is not a successful document load.",
      "Session and attempt labels are local to this copy. Matching attempt labels identify native-correlated operations across proxy handoffs; they are not inferred from origins or times. Request duration is unavailable for entries without structured diagnostics. Durations cover the logged operation through its stage, not full page readiness. HTTP status records the proxy response, not proof of successful website sign-in.",
      "",
      ...lines,
    ].join("\n"),
  };
}
