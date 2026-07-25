/**
 * Session-health classification shared by the proxy manager and session list.
 * The categories mirror the Rust proxy error-page themes.
 */
export type ProxySessionStatus =
  | "healthy"
  | "waiting"
  | "refused"
  | "dns"
  | "tls"
  | "timeout"
  | "auth"
  | "forbidden"
  | "notfound"
  | "ratelimited"
  | "servererror"
  | "errors";

const STATUS_META: Record<
  ProxySessionStatus,
  { label: string; tone: "ok" | "warn" | "err" | "muted" }
> = {
  healthy: { label: "Healthy", tone: "ok" },
  waiting: { label: "Waiting", tone: "muted" },
  refused: { label: "Refused", tone: "err" },
  dns: { label: "DNS error", tone: "err" },
  tls: { label: "TLS error", tone: "err" },
  timeout: { label: "Timeout", tone: "warn" },
  auth: { label: "Auth required", tone: "warn" },
  forbidden: { label: "Forbidden", tone: "err" },
  notfound: { label: "Not found", tone: "err" },
  ratelimited: { label: "Rate limited", tone: "warn" },
  servererror: { label: "Server error", tone: "err" },
  errors: { label: "Errors", tone: "err" },
};

export function getProxySessionStatusMeta(status: ProxySessionStatus) {
  return STATUS_META[status];
}

export function classifySession(s: {
  request_count: number;
  error_count: number;
  last_error?: string | null;
}): ProxySessionStatus {
  if (s.error_count === 0 && s.request_count === 0) return "waiting";
  if (s.error_count === 0) return "healthy";

  const message = (s.last_error || "").toLowerCase();
  if (
    message.includes("connection refused") ||
    message.includes("actively refused")
  )
    return "refused";
  if (
    message.includes("dns") ||
    message.includes("name or service not known") ||
    message.includes("failed to lookup") ||
    message.includes("no address associated")
  )
    return "dns";
  if (
    message.includes("certificate") ||
    message.includes("ssl") ||
    message.includes("tls") ||
    message.includes("handshake") ||
    message.includes("self-signed") ||
    message.includes("self signed")
  )
    return "tls";
  if (message.includes("timeout") || message.includes("timed out"))
    return "timeout";
  if (message.includes("http 401") || message.includes("http 407"))
    return "auth";
  if (message.includes("http 403")) return "forbidden";
  if (message.includes("http 404")) return "notfound";
  if (message.includes("http 429")) return "ratelimited";
  if (/http 5\d\d/.test(message)) return "servererror";
  return "errors";
}
