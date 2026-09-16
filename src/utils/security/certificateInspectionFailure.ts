import type {
  CertificateInspectionFailureKind,
  CertificateInspectionRoute,
  CertificateInspectionStage,
  CertificateTlsFailureReason,
  NativeCertificateInspectionError,
  WebNavigationTimeline,
  WebNavigationTimelineStep,
  WebNavigationTimelineStepId,
} from "../../types/security/certificateInspection";
import type {
  LocalNavigationFailureKind,
  ProxyNavigationFailure,
} from "../../hooks/protocol/useWebBrowser";

/** Every certificate inspection failure page ends with this invariant. */
export const CERTIFICATE_TRUST_CHECK_NOT_RUN =
  "The certificate trust check could not run, so no connection was opened and nothing was sent.";

/** The configured outbound route changed while HTTPS trust was being checked. */
export class HttpsRouteChangedError extends Error {
  constructor() {
    super(
      "The configured route changed. Reload to verify HTTPS trust on the current route.",
    );
    this.name = "HttpsRouteChangedError";
  }
}

/**
 * Display duration. Tenths round half-up with integer arithmetic so the text
 * agrees with the native inspection messages: `< 1000 ms` → "N ms", then
 * "N.N s", and from one minute "M min S s".
 */
export function formatDurationMs(ms: number): string {
  const value = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) {
    const tenths = Math.floor((value + 50) / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10} s`;
  }
  const seconds = Math.floor((value + 500) / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** `host:port`, bracketing a bare IPv6 literal. */
export function displayAuthority(host: string, port: number): string {
  return `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}

const KINDS: Record<CertificateInspectionFailureKind, true> = {
  invalid_target: true,
  dns_failure: true,
  connect_timeout: true,
  connection_refused: true,
  host_unreachable: true,
  connect_failed: true,
  proxy_invalid: true,
  proxy_unreachable: true,
  proxy_tls_failed: true,
  proxy_auth_rejected: true,
  proxy_tunnel_rejected: true,
  proxy_tunnel_timeout: true,
  proxy_protocol_error: true,
  tls_handshake_timeout: true,
  tls_handshake_failed: true,
  certificate_unreadable: true,
  inspection_unavailable: true,
  deadline_exceeded: true,
};
const TLS_REASONS: Record<CertificateTlsFailureReason, true> = {
  not_tls: true,
  peer_closed: true,
  alert: true,
  certificate: true,
  other: true,
};
/** Canonical native stage order per route; completed stages precede the failure. */
const ROUTE_STAGES: Record<
  CertificateInspectionRoute,
  readonly CertificateInspectionStage[]
> = {
  direct: [
    "target",
    "resolve",
    "connect",
    "tls_handshake",
    "certificate",
    "verifier",
  ],
  proxy: [
    "target",
    "proxy_connect",
    "proxy_tls",
    "proxy_tunnel",
    "tls_handshake",
    "certificate",
    "verifier",
  ],
};
const PROXY_ONLY_KINDS = new Set<CertificateInspectionFailureKind>([
  "proxy_invalid",
  "proxy_unreachable",
  "proxy_tls_failed",
  "proxy_auth_rejected",
  "proxy_tunnel_rejected",
  "proxy_tunnel_timeout",
  "proxy_protocol_error",
]);
const DIRECT_ONLY_KINDS = new Set<CertificateInspectionFailureKind>([
  "dns_failure",
  "connect_timeout",
  "connection_refused",
  "host_unreachable",
  "connect_failed",
]);
const WIRE_KEYS = [
  "kind",
  "stage",
  "route",
  "target",
  "address",
  "addresses_tried",
  "elapsed_ms",
  "stage_elapsed_ms",
  "timeout_ms",
  "proxy_status",
  "tls_reason",
  "completed",
  "message",
] as const;
const ADDRESS_RE = /^(\[[0-9a-fA-F:.]+\]|[0-9.]+):(\d{1,5})$/;
const MAX_ELAPSED_MS = 600_000;

const hasOwn = (value: object, key: unknown): boolean =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(value, key);
const utf8Length = (value: string) => new TextEncoder().encode(value).length;
const record = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null;
};
const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => hasOwn(value, key));
const count = (value: unknown, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= max;

/**
 * Strict, bounded parse of the structured native inspection rejection.
 * Anything unknown or inconsistent returns `null` so the caller shows the
 * generic inspection failure; the connection stays blocked either way.
 */
export function parseNativeCertificateInspectionError(
  value: unknown,
): NativeCertificateInspectionError | null {
  const wire = record(value);
  if (!wire || !exactKeys(wire, WIRE_KEYS)) return null;
  const { kind, stage, route, target, address, message, completed } = wire;
  if (!hasOwn(KINDS, kind) || !hasOwn(ROUTE_STAGES, route)) return null;
  const knownKind = kind as CertificateInspectionFailureKind;
  const knownRoute = route as CertificateInspectionRoute;
  const stages = ROUTE_STAGES[knownRoute];
  const failingIndex = stages.indexOf(stage as CertificateInspectionStage);
  if (
    typeof stage !== "string" ||
    failingIndex < 0 ||
    (PROXY_ONLY_KINDS.has(knownKind) && knownRoute !== "proxy") ||
    (DIRECT_ONLY_KINDS.has(knownKind) && knownRoute !== "direct")
  )
    return null;
  if (typeof target !== "string" || utf8Length(target) > 300) return null;
  if (address !== null) {
    const match =
      typeof address === "string" && address.length <= 64
        ? ADDRESS_RE.exec(address)
        : null;
    if (!match || Number(match[2]) > 65_535 || knownRoute !== "direct")
      return null;
  }
  if (
    !count(wire.addresses_tried, 64) ||
    !count(wire.elapsed_ms, MAX_ELAPSED_MS) ||
    !count(wire.stage_elapsed_ms, MAX_ELAPSED_MS) ||
    (wire.timeout_ms !== null && !count(wire.timeout_ms, MAX_ELAPSED_MS))
  )
    return null;
  const proxyStatus = wire.proxy_status;
  if (
    proxyStatus !== null &&
    (!count(proxyStatus, 599) ||
      proxyStatus < 100 ||
      (knownKind !== "proxy_auth_rejected" &&
        knownKind !== "proxy_tunnel_rejected"))
  )
    return null;
  const tlsReason = wire.tls_reason;
  if (
    tlsReason !== null &&
    (!hasOwn(TLS_REASONS, tlsReason) || knownKind !== "tls_handshake_failed")
  )
    return null;
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    utf8Length(message) > 1024
  )
    return null;
  if (!Array.isArray(completed) || completed.length > 9) return null;
  const steps: NativeCertificateInspectionError["completed"] = [];
  let previousIndex = -1;
  for (const entry of completed) {
    const step = record(entry);
    if (
      !step ||
      !exactKeys(step, ["stage", "elapsed_ms"]) ||
      !count(step.elapsed_ms, MAX_ELAPSED_MS)
    )
      return null;
    const index = stages.indexOf(step.stage as CertificateInspectionStage);
    if (
      typeof step.stage !== "string" ||
      index < 0 ||
      index <= previousIndex ||
      index >= failingIndex
    )
      return null;
    previousIndex = index;
    steps.push({
      stage: step.stage as CertificateInspectionStage,
      elapsed_ms: step.elapsed_ms,
    });
  }
  return {
    kind: knownKind,
    stage: stage as CertificateInspectionStage,
    route: knownRoute,
    target,
    address: address as string | null,
    addresses_tried: wire.addresses_tried,
    elapsed_ms: wire.elapsed_ms,
    stage_elapsed_ms: wire.stage_elapsed_ms,
    timeout_ms: wire.timeout_ms as number | null,
    proxy_status: proxyStatus as number | null,
    tls_reason: tlsReason as CertificateTlsFailureReason | null,
    completed: steps,
    message,
  };
}

const STEP_LABELS: Record<WebNavigationTimelineStepId, string> = {
  resolve: "Resolve address",
  connect: "TCP connect",
  proxy_connect: "Connect to proxy",
  proxy_tls: "Proxy TLS",
  proxy_tunnel: "Proxy tunnel",
  tls_handshake: "TLS handshake",
  certificate: "Read certificate",
  trust: "Certificate trust check",
  page: "Open page",
};
const STAGE_TEXT: Record<CertificateInspectionStage, string> = {
  target: "target check",
  resolve: "name resolution",
  connect: "TCP connect",
  proxy_connect: "proxy connect",
  proxy_tls: "proxy TLS",
  proxy_tunnel: "proxy tunnel",
  tls_handshake: "TLS handshake",
  certificate: "certificate read",
  verifier: "certificate verifier",
};

function stepOrder(
  route: CertificateInspectionRoute,
  proxyTls: boolean,
): WebNavigationTimelineStepId[] {
  return route === "direct"
    ? ["resolve", "connect", "tls_handshake", "certificate", "trust", "page"]
    : [
        "proxy_connect",
        ...(proxyTls ? (["proxy_tls"] as const) : []),
        "proxy_tunnel",
        "tls_handshake",
        "certificate",
        "trust",
        "page",
      ];
}

/** Short failing-step text. Proxy-route text names neither proxy nor target. */
function failingStepDetail(error: NativeCertificateInspectionError): string {
  const after = formatDurationMs(error.stage_elapsed_ms);
  const within =
    error.timeout_ms === null ? null : formatDurationMs(error.timeout_ms);
  const peer = error.address ?? error.target;
  const attempts =
    error.addresses_tried > 1
      ? ` (${error.addresses_tried} addresses tried)`
      : "";
  switch (error.kind) {
    case "invalid_target":
      return "the saved address is not a valid certificate target";
    case "dns_failure":
      return `the name could not be resolved after ${after}`;
    case "connect_timeout":
      return `no response from ${peer} after ${after}${attempts}`;
    case "host_unreachable":
      return `the network reported ${peer} unreachable after ${after}${attempts}`;
    case "connection_refused":
      return `${peer} refused the connection after ${after}${attempts}`;
    case "connect_failed":
      return `the TCP connection failed after ${after}${attempts}`;
    case "proxy_invalid":
      return "the configured proxy is not a valid route";
    case "proxy_unreachable":
      return within
        ? `the proxy did not accept a connection within ${within}`
        : `the proxy did not accept a connection after ${after}`;
    case "proxy_tls_failed":
      return within
        ? `no proxy TLS handshake within ${within}`
        : "the proxy's HTTPS certificate was not verified";
    case "proxy_auth_rejected":
      return `the proxy rejected authentication (HTTP ${error.proxy_status ?? 407})`;
    case "proxy_tunnel_rejected":
      return error.proxy_status === null
        ? "the proxy refused the tunnel"
        : `the proxy refused the tunnel (HTTP ${error.proxy_status})`;
    case "proxy_tunnel_timeout":
      return `no tunnel within ${within ?? after}`;
    case "proxy_protocol_error":
      return "the proxy's CONNECT response was invalid";
    case "tls_handshake_timeout":
      return `no TLS handshake within ${within ?? after}`;
    case "tls_handshake_failed":
      switch (error.tls_reason ?? "other") {
        case "not_tls":
          return "the server answered with data that is not TLS";
        case "peer_closed":
          return "the server closed the connection during the handshake";
        case "alert":
          return "the server sent a TLS alert";
        case "certificate":
          return "the server certificate was rejected during the handshake";
        default:
          return `the handshake failed after ${after}`;
      }
    case "certificate_unreadable":
      return "the server certificate could not be read";
    case "inspection_unavailable":
      return "the local certificate verifier is unavailable";
    case "deadline_exceeded":
      return `did not finish within ${formatDurationMs(error.timeout_ms ?? error.elapsed_ms)}`;
    default: {
      const unreachable: never = error.kind;
      return unreachable;
    }
  }
}

export type CertificateInspectionHookStage =
  /** Native `get_tls_certificate_info` rejected. */
  | "inspection"
  /** Native inspection resolved, but the response failed validation. */
  | "inspection_response"
  /** The inspected certificate's identity details were invalid. */
  | "identity";

export interface CertificateInspectionTimelineInput {
  error: NativeCertificateInspectionError | null;
  hookStage: CertificateInspectionHookStage;
  route: CertificateInspectionRoute;
  /** An HTTPS proxy adds a proxy TLS step to the proxy route. */
  proxyTls: boolean;
  startedAt: number;
  failedAfterMs: number;
}

/**
 * Measured attempt timeline: native completed stages pass with their
 * durations, the failing stage fails, and the rest are not started.
 */
export function buildCertificateInspectionTimeline({
  error,
  hookStage,
  route,
  proxyTls,
  startedAt,
  failedAfterMs,
}: CertificateInspectionTimelineInput): WebNavigationTimeline {
  const failedAfter = Math.max(0, Math.round(failedAfterMs));
  const step = (
    id: WebNavigationTimelineStepId,
    status: WebNavigationTimelineStep["status"],
    durationMs: number | null = null,
    detail: string | null = null,
  ): WebNavigationTimelineStep => ({
    id,
    label: STEP_LABELS[id],
    status,
    durationMs,
    detail,
  });
  if (hookStage !== "inspection") {
    // Native inspection finished, so every network step passed unmeasured.
    const order = stepOrder(route, proxyTls);
    const certificate = order.indexOf("certificate");
    return {
      startedAt,
      failedAfterMs: failedAfter,
      route,
      steps: order.map((id, index) =>
        index < certificate
          ? step(id, "pass")
          : index === certificate
            ? step(
                id,
                "fail",
                null,
                hookStage === "identity"
                  ? "the certificate identity details are invalid"
                  : "the inspection response was malformed",
              )
            : step(id, "not_started"),
      ),
    };
  }
  if (!error)
    return { startedAt, failedAfterMs: failedAfter, route, steps: [] };
  const usesProxyTls =
    proxyTls ||
    error.stage === "proxy_tls" ||
    error.completed.some((entry) => entry.stage === "proxy_tls");
  const order = stepOrder(error.route, usesProxyTls);
  const failing: WebNavigationTimelineStepId =
    error.stage === "target"
      ? order[0]
      : error.stage === "verifier"
        ? "trust"
        : error.stage;
  const completed = new Map<WebNavigationTimelineStepId, number>();
  for (const entry of error.completed)
    if (entry.stage !== "target" && entry.stage !== "verifier")
      completed.set(entry.stage, entry.elapsed_ms);
  return {
    startedAt,
    failedAfterMs: failedAfter,
    route: error.route,
    steps: order.map((id) =>
      id === failing
        ? step(id, "fail", error.stage_elapsed_ms, failingStepDetail(error))
        : completed.has(id)
          ? step(id, "pass", completed.get(id)!)
          : step(id, "not_started"),
    ),
  };
}

interface Classification {
  kind: LocalNavigationFailureKind;
  title: string;
  reason: string;
}

function classifyNativeFailure(
  error: NativeCertificateInspectionError,
  host: string,
  port: number,
): Classification {
  const authority = displayAuthority(host, port);
  const stageElapsed = formatDurationMs(error.stage_elapsed_ms);
  const within =
    error.timeout_ms === null ? null : formatDurationMs(error.timeout_ms);
  switch (error.kind) {
    case "connect_timeout":
      return {
        kind: "host_unreachable",
        title: `Can't reach ${authority}`,
        reason: within
          ? `No response from ${authority} within ${within} (TCP connect).`
          : `No response from ${authority} after ${stageElapsed} (TCP connect).`,
      };
    case "host_unreachable":
      return {
        kind: "host_unreachable",
        title: `Can't reach ${authority}`,
        reason: `The network reported ${host} as unreachable after ${stageElapsed}.`,
      };
    case "connection_refused":
      return {
        kind: "connection_refused",
        title: `${authority} refused the connection`,
        reason: `The host answered, but nothing accepted connections on port ${port}.`,
      };
    case "dns_failure":
      return {
        kind: "dns_failure",
        title: `Can't find ${host}`,
        reason: `The name ${host} could not be resolved.`,
      };
    case "connect_failed":
      return {
        kind: "connection_failed",
        title: `Can't connect to ${authority}`,
        reason: `The TCP connection failed after ${stageElapsed}.`,
      };
    case "proxy_invalid":
      return {
        kind: "invalid_navigation",
        title: "Proxy settings are invalid",
        reason:
          "The global HTTP(S) proxy is not a valid route; it will not be bypassed.",
      };
    case "proxy_unreachable":
      return {
        kind: "proxy_route_failure",
        title: "Can't reach the configured proxy",
        reason: `The configured HTTP(S) proxy did not accept a connection${within ? ` within ${within}` : ""}.`,
      };
    case "proxy_tls_failed":
      // A timed-out proxy handshake is reachability, not verification.
      return within
        ? {
            kind: "proxy_route_failure",
            title: "Can't reach the configured proxy",
            reason: `The configured HTTPS proxy did not complete TLS within ${within}; the target was not contacted.`,
          }
        : {
            kind: "proxy_route_failure",
            title: "The proxy's HTTPS certificate was not verified",
            reason:
              "The configured HTTPS proxy failed verification; the target was not contacted.",
          };
    case "proxy_auth_rejected":
      return {
        kind: "proxy_route_failure",
        title: `The proxy rejected its credentials (HTTP ${error.proxy_status ?? 407})`,
        reason: "Check the proxy username and password.",
      };
    case "proxy_tunnel_rejected":
      return {
        kind: "proxy_route_failure",
        title: `The proxy could not reach ${authority}${error.proxy_status === null ? "" : ` (HTTP ${error.proxy_status})`}`,
        reason: "The proxy refused or failed to open a tunnel to the website.",
      };
    case "proxy_tunnel_timeout":
      return {
        kind: "proxy_route_failure",
        title: `The proxy did not answer within ${within ?? stageElapsed}`,
        reason:
          "The proxy accepted the connection but did not open the tunnel.",
      };
    case "proxy_protocol_error":
      return {
        kind: "proxy_route_failure",
        title: "The proxy returned an invalid response",
        reason: "The proxy's CONNECT response was malformed or too large.",
      };
    case "tls_handshake_timeout":
      return {
        kind: "tls_handshake_failure",
        title: `TLS handshake with ${authority} timed out`,
        reason: `${authority} accepted TCP but did not complete TLS within ${within ?? stageElapsed}.`,
      };
    case "tls_handshake_failed": {
      const reason = error.tls_reason ?? "other";
      if (reason === "certificate")
        return {
          kind: "tls_failure",
          title: "Unable to verify the server's TLS handshake",
          reason:
            "The server's certificate was rejected during the TLS handshake.",
        };
      return {
        kind: "tls_handshake_failure",
        title: `TLS handshake with ${authority} failed`,
        reason:
          reason === "not_tls"
            ? `${authority} answered with data that is not TLS; the port may serve plain HTTP.`
            : reason === "peer_closed"
              ? `${authority} closed the connection during the handshake.`
              : reason === "alert"
                ? `${authority} rejected the handshake with a TLS alert.`
                : `${authority} could not complete a TLS handshake.`,
      };
    }
    case "certificate_unreadable":
      return {
        kind: "tls_failure",
        title: "Unable to read the HTTPS certificate",
        reason:
          "The server completed TLS but its certificate could not be read.",
      };
    case "inspection_unavailable":
      return {
        kind: "inspection_unavailable",
        title: "HTTPS certificate check unavailable",
        reason:
          "The local certificate verifier could not start. TLS verification was not bypassed.",
      };
    case "invalid_target":
      return {
        kind: "invalid_navigation",
        title: "Invalid web address",
        reason: "The saved address cannot be used for a certificate check.",
      };
    case "deadline_exceeded": {
      const budget = formatDurationMs(error.timeout_ms ?? error.elapsed_ms);
      const reason = `The certificate check did not finish within ${budget} (${STAGE_TEXT[error.stage]}).`;
      switch (error.stage) {
        case "resolve":
          return { kind: "dns_failure", title: `Can't find ${host}`, reason };
        case "connect":
          return {
            kind: "host_unreachable",
            title: `Can't reach ${authority}`,
            reason,
          };
        case "proxy_connect":
        case "proxy_tls":
          return {
            kind: "proxy_route_failure",
            title: "Can't reach the configured proxy",
            reason,
          };
        case "proxy_tunnel":
          return {
            kind: "proxy_route_failure",
            title: `The proxy did not answer within ${budget}`,
            reason,
          };
        case "tls_handshake":
          return {
            kind: "tls_handshake_failure",
            title: `TLS handshake with ${authority} timed out`,
            reason,
          };
        default:
          return {
            kind: "inspection_unavailable",
            title: "HTTPS certificate check unavailable",
            reason,
          };
      }
    }
    default: {
      const unreachable: never = error.kind;
      return unreachable;
    }
  }
}

const DETAIL_MAX_BYTES = 2048;

function boundedDetail(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!text)
    return "The native certificate inspection returned an unrecognized error.";
  if (utf8Length(text) <= DETAIL_MAX_BYTES) return text;
  const encoder = new TextEncoder();
  let bytes = 0;
  let bounded = "";
  for (const character of text) {
    bytes += encoder.encode(character).length;
    if (bytes > DETAIL_MAX_BYTES - 3) break;
    bounded += character;
  }
  return `${bounded}…`;
}

export interface CertificateInspectionFailureInput extends Omit<
  CertificateInspectionTimelineInput,
  "error"
> {
  /** Native rejection or thrown value; parsed only for the inspection stage. */
  error: unknown;
  /** The hook's own canonical target; titles never use the wire `target`. */
  host: string;
  port: number;
  url: string;
}

/** Local failure page for a certificate check that stopped before trust. */
export function describeCertificateInspectionFailure(
  input: CertificateInspectionFailureInput,
): ProxyNavigationFailure {
  const parsed =
    input.hookStage === "inspection"
      ? parseNativeCertificateInspectionError(input.error)
      : null;
  const classification: Classification = parsed
    ? classifyNativeFailure(parsed, input.host, input.port)
    : input.hookStage === "identity"
      ? {
          kind: "tls_failure",
          title: "Invalid HTTPS certificate identity",
          reason:
            "The server presented a certificate, but its identity details are invalid.",
        }
      : input.hookStage === "inspection_response"
        ? {
            kind: "tls_failure",
            title: "Unable to inspect the HTTPS certificate",
            reason:
              "The native certificate inspection returned malformed data.",
          }
        : {
            kind: "tls_failure",
            title: "Unable to inspect the HTTPS certificate",
            reason: "The HTTPS certificate could not be inspected.",
          };
  return {
    version: 1,
    sessionId: "local",
    kind: classification.kind,
    status: null,
    title: classification.title,
    url: input.url,
    reason: `${classification.reason} ${CERTIFICATE_TRUST_CHECK_NOT_RUN}`,
    detail: parsed ? parsed.message : boundedDetail(input.error),
    timeline: buildCertificateInspectionTimeline({
      error: parsed,
      hookStage: input.hookStage,
      route: input.route,
      proxyTls: input.proxyTls,
      startedAt: input.startedAt,
      failedAfterMs: input.failedAfterMs,
    }),
  };
}
