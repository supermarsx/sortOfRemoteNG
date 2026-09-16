import { formatDurationMs } from "../security/certificateInspectionFailure";

/**
 * Non-secret facts about an upstream response, as the proxy reports them
 * alongside a themed 4xx/5xx page. Declared here rather than in the web-browser
 * hook so this builder and its tests stand on their own; the hook's
 * `ProxyNavigationFailure` carries the same shape structurally.
 */
export interface WebsiteUpstreamResponseFacts {
  method: string;
  /** Canonical reason phrase for the status, not the upstream's own text. */
  reasonPhrase: string;
  server: string | null;
  contentType: string | null;
  bodyBytes: number;
  elapsedMs: number;
}

/** The fields this builder reads; `ProxyNavigationFailure` satisfies it. */
export interface WebsiteFailureDiagnosticsInput {
  kind: string;
  status: number | null;
  title: string;
  url: string;
  upstream?: WebsiteUpstreamResponseFacts;
  timeline?: { failedAfterMs: number };
}

/**
 * Text for the web view's "Copy diagnostics" action.
 *
 * Everything here has to be safe to paste into a ticket or a chat, so the
 * builder works from a closed field list instead of serializing the failure:
 *
 * - the address keeps its origin and path but never its userinfo, and query
 *   **values** are dropped entirely (only the key names survive, because a
 *   session id or token is usually a query value);
 * - the upstream facts are the ones the proxy forwards — method, canonical
 *   reason phrase, `Server`, `Content-Type`, body size, request duration.
 *   Request headers, `Set-Cookie`, `WWW-Authenticate` and the response body
 *   are never included;
 * - the failure's own `detail` (which carries the upstream body snippet) is
 *   deliberately left out; it stays visible on the page instead.
 */
export interface WebsiteFailureDiagnosticsContext {
  connectionId?: string | null;
  connectionName?: string | null;
  appVersion?: string | null;
}

const UNKNOWN = "not reported";
const MAX_QUERY_KEYS = 16;

/** Single-line, control-free text, so no field can forge a line of its own. */
function printable(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  let cleaned = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) cleaned += character;
  }
  cleaned = cleaned.trim();
  return cleaned.length > 0 ? cleaned.slice(0, maxLength) : null;
}

/** Origin + path only, with the query reduced to its key names. */
export function websiteDiagnosticsAddress(value: string): {
  address: string;
  queryKeys: string[];
} | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const queryKeys = Array.from(new Set(url.searchParams.keys()))
    .map((key) => printable(key, 64))
    .filter((key): key is string => key !== null)
    .slice(0, MAX_QUERY_KEYS);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return { address: url.toString(), queryKeys };
}

export function websiteFailureDiagnosticsText(
  failure: WebsiteFailureDiagnosticsInput,
  context: WebsiteFailureDiagnosticsContext = {},
): string {
  const target = websiteDiagnosticsAddress(failure.url);
  const upstream = failure.upstream;
  const status =
    typeof failure.status === "number"
      ? `HTTP ${failure.status}${
          upstream?.reasonPhrase ? ` ${upstream.reasonPhrase}` : ""
        }`
      : "no HTTP response";
  const connectionName = printable(context.connectionName, 80);
  const connectionId = printable(context.connectionId, 64);
  const lines = [
    "Website error diagnostics",
    `Reported as: ${printable(failure.title, 200) ?? UNKNOWN} (${failure.kind})`,
    `Result: ${status}`,
    `Address: ${target?.address ?? UNKNOWN}`,
  ];
  if (target?.queryKeys.length)
    lines.push(`Query keys (values omitted): ${target.queryKeys.join(", ")}`);
  if (upstream) {
    lines.push(
      `Request method: ${upstream.method}`,
      `Upstream server header: ${printable(upstream.server, 128) ?? UNKNOWN}`,
      `Response content type: ${printable(upstream.contentType, 128) ?? UNKNOWN}`,
      `Response body size: ${upstream.bodyBytes} bytes`,
      `Upstream request duration: ${upstream.elapsedMs} ms`,
    );
  } else {
    lines.push(
      "Upstream response: none — the request failed before a response was received",
    );
  }
  if (failure.timeline)
    lines.push(
      `Attempt failed after: ${formatDurationMs(failure.timeline.failedAfterMs)}`,
    );
  lines.push(
    `Connection: ${connectionName ?? "unsaved"}${
      connectionId ? ` (id ${connectionId})` : ""
    }`,
    `App version: ${printable(context.appVersion, 32) ?? UNKNOWN}`,
    "No credentials, cookies, authorization headers, query values or response body are included.",
  );
  return lines.join("\n");
}
