const PHASES = {
  http: "HTTP request",
  font: "Font asset",
  websocket: "WebSocket handshake",
  quickconnect_request: "QuickConnect request",
  quickconnect_discovery: "QuickConnect discovery",
  quickconnect_tunnel: "QuickConnect tunnel setup",
  quickconnect_direct_probe: "Direct NAS candidate",
  quickconnect_relay_probe: "Relay candidate",
  quickconnect_redirect: "QuickConnect handoff",
} as const;
const STAGES = {
  validation: "Checking request",
  document_wait: "Waiting for the current page",
  request_body: "Reading request",
  queue: "Waiting for capacity",
  connect_tls: "Connecting / TLS",
  response_headers: "Reading response headers",
  response_body: "Reading response body",
  response_validation: "Checking response",
  complete: "Complete",
  handoff: "Destination handoff",
} as const;
const OUTCOMES = {
  refused: "Request refused",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  failed: "Request failed",
  http_error: "HTTP error",
  succeeded: "Request completed",
  review_required: "Review required",
  continuing: "Continuing",
} as const;
const LANES = {
  control: "Control",
  direct_probe: "Direct probe",
  relay_probe: "Relay probe",
} as const;
const REDIRECT_PATHS = { root: "Root", dsm: "DSM", other: "Other" } as const;

/** Fixed application copy only. Never display an arbitrary native error chain. */
export const PROXY_DIAGNOSTIC_EXPLANATIONS = {
  http_response:
    "The HTTP response was received. Its status does not confirm website sign-in.",
  http_transport_failed:
    "The upstream HTTP exchange failed before it completed.",
  http_timeout: "The HTTP exchange exceeded its time limit.",
  http_redirect_loop:
    "The HTTP redirect limit or loop guard stopped this request.",
  http_redirect_review:
    "The destination requires the website's redirect review.",
  http_policy_refused: "The request is outside the current proxy policy.",
  http_response_invalid: "The upstream response could not be accepted.",
  font_response: "The font asset route returned this response.",
  websocket_handshake:
    "This is the WebSocket opening handshake, not a record of socket messages.",
  quickconnect_redirect_pending:
    "The app is preparing a reviewed destination handoff; this is not a sign-in result.",
  quickconnect_redirect_loop:
    "QuickConnect returned a repeated HTTP redirect cycle or reached its redirect limit. The proxy stopped the handoff; this does not mean the server was unreachable.",
  quickconnect_connector_restart:
    "The QuickConnect connector was encountered again during the handoff.",
  quickconnect_request_authority:
    "The request did not match the protected proxy's browser authority.",
  quickconnect_unsupported_request:
    "This request is outside the supported QuickConnect routes.",
  quickconnect_defaults_disabled:
    "The original website's QuickConnect defaults are disabled.",
  quickconnect_source_scope:
    "The request no longer matches the original website scope.",
  quickconnect_verified_route_unavailable:
    "The verified QuickConnect transport is unavailable.",
  quickconnect_request_limit:
    "The QuickConnect request capacity limit was reached.",
  quickconnect_body_limit: "The request body exceeded the permitted size.",
  quickconnect_unsupported_body:
    "The request body is not a supported QuickConnect operation.",
  quickconnect_stale_document:
    "The originating page changed or is no longer active.",
  quickconnect_verified_exchange_failed:
    "The verified exchange failed; no more specific transport cause is available.",
  quickconnect_timeout: "The QuickConnect request exceeded its time limit.",
  quickconnect_upstream_status:
    "The upstream HTTP response was recorded. Read its status and outcome; receiving a response alone does not confirm sign-in.",
  quickconnect_destination_not_discovered:
    "This older route required a destination that had not been discovered.",
  quickconnect_connect_failed:
    "The upstream connection could not be established.",
  quickconnect_tls_failed:
    "The verified TLS connection could not be established.",
  quickconnect_queue_timeout:
    "The request timed out waiting for transport capacity.",
  quickconnect_exchange_timeout:
    "The upstream exchange exceeded its time limit.",
  quickconnect_response_read_failed:
    "The upstream response could not be completely read.",
  quickconnect_upstream_redirect:
    "The control or probe endpoint returned a redirect that this route does not follow.",
  quickconnect_cors_rejected:
    "The response did not satisfy the required cross-origin checks.",
  quickconnect_response_encoding: "The response used an unsupported encoding.",
  quickconnect_response_size: "The response exceeded the permitted size.",
  quickconnect_response_utf8: "The response was not valid UTF-8 text.",
  quickconnect_response_json: "The response was not valid expected JSON.",
  quickconnect_probe_identity_mismatch:
    "The candidate response did not match the selected NAS identity.",
} as const;

export interface ProxyLogDiagnostic {
  lane?: keyof typeof LANES;
  phase: keyof typeof PHASES;
  stage: keyof typeof STAGES;
  code: keyof typeof PROXY_DIAGNOSTIC_EXPLANATIONS;
  outcome: keyof typeof OUTCOMES;
  durationMs: number;
  queueMs?: number;
  activeMs?: number;
  upstreamStatus?: number;
  attemptId?: string;
  hop?: number;
  redirectSourcePath?: keyof typeof REDIRECT_PATHS;
  redirectTargetPath?: keyof typeof REDIRECT_PATHS;
  redirectTargetOrigin?: string;
  redirectQueryRemoved?: boolean;
  sameOriginRedirects?: number;
}
const fields = new Set([
  "lane",
  "phase",
  "stage",
  "code",
  "outcome",
  "durationMs",
  "queueMs",
  "activeMs",
  "upstreamStatus",
  "attemptId",
  "hop",
  "redirectSourcePath",
  "redirectTargetPath",
  "redirectTargetOrigin",
  "redirectQueryRemoved",
  "sameOriginRedirects",
]);
const owns = (object: object, key: unknown): key is string =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;

function isCanonicalHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.port !== "0" &&
      !url.hostname.endsWith(".")
    );
  } catch {
    return false;
  }
}

export function parseProxyLogDiagnostic(
  value: unknown,
): ProxyLogDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some((key) => !fields.has(key)) ||
    !owns(PHASES, data.phase) ||
    !owns(STAGES, data.stage) ||
    !owns(PROXY_DIAGNOSTIC_EXPLANATIONS, data.code) ||
    !owns(OUTCOMES, data.outcome) ||
    !integer(data.durationMs, 0, 86_400_000)
  )
    return null;
  for (const key of ["queueMs", "activeMs"])
    if (data[key] !== undefined && !integer(data[key], 0, 86_400_000))
      return null;
  if (data.lane !== undefined && !owns(LANES, data.lane)) return null;
  if (data.hop !== undefined && !integer(data.hop, 0, 20)) return null;
  for (const key of ["redirectSourcePath", "redirectTargetPath"])
    if (data[key] !== undefined && !owns(REDIRECT_PATHS, data[key]))
      return null;
  if (
    data.redirectTargetOrigin !== undefined &&
    !isCanonicalHttpOrigin(data.redirectTargetOrigin)
  )
    return null;
  if (
    data.redirectQueryRemoved !== undefined &&
    typeof data.redirectQueryRemoved !== "boolean"
  )
    return null;
  if (
    data.sameOriginRedirects !== undefined &&
    !integer(data.sameOriginRedirects, 0, 20)
  )
    return null;
  if (
    data.upstreamStatus !== undefined &&
    !integer(data.upstreamStatus, 100, 599)
  )
    return null;
  if (
    data.attemptId !== undefined &&
    (typeof data.attemptId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        data.attemptId,
      ))
  )
    return null;
  // Copy only the closed, validated schema; unknown metadata never enters UI/copy.
  return {
    ...(data.lane === undefined
      ? {}
      : { lane: data.lane as ProxyLogDiagnostic["lane"] }),
    phase: data.phase as ProxyLogDiagnostic["phase"],
    stage: data.stage as ProxyLogDiagnostic["stage"],
    code: data.code as ProxyLogDiagnostic["code"],
    outcome: data.outcome as ProxyLogDiagnostic["outcome"],
    durationMs: data.durationMs,
    ...(data.queueMs === undefined ? {} : { queueMs: data.queueMs as number }),
    ...(data.activeMs === undefined
      ? {}
      : { activeMs: data.activeMs as number }),
    ...(data.upstreamStatus === undefined
      ? {}
      : { upstreamStatus: data.upstreamStatus as number }),
    ...(data.attemptId === undefined
      ? {}
      : { attemptId: (data.attemptId as string).toLowerCase() }),
    ...(data.hop === undefined ? {} : { hop: data.hop as number }),
    ...(data.redirectSourcePath === undefined
      ? {}
      : {
          redirectSourcePath:
            data.redirectSourcePath as ProxyLogDiagnostic["redirectSourcePath"],
        }),
    ...(data.redirectTargetPath === undefined
      ? {}
      : {
          redirectTargetPath:
            data.redirectTargetPath as ProxyLogDiagnostic["redirectTargetPath"],
        }),
    ...(data.redirectTargetOrigin === undefined
      ? {}
      : { redirectTargetOrigin: data.redirectTargetOrigin as string }),
    ...(data.redirectQueryRemoved === undefined
      ? {}
      : { redirectQueryRemoved: data.redirectQueryRemoved as boolean }),
    ...(data.sameOriginRedirects === undefined
      ? {}
      : { sameOriginRedirects: data.sameOriginRedirects as number }),
  };
}

export function proxyDiagnosticLabels(data: ProxyLogDiagnostic) {
  return {
    lane: data.lane === undefined ? undefined : LANES[data.lane],
    phase: PHASES[data.phase],
    stage: STAGES[data.stage],
    outcome: OUTCOMES[data.outcome],
    explanation: PROXY_DIAGNOSTIC_EXPLANATIONS[data.code],
    redirectSourcePath:
      data.redirectSourcePath === undefined
        ? undefined
        : REDIRECT_PATHS[data.redirectSourcePath],
    redirectTargetPath:
      data.redirectTargetPath === undefined
        ? undefined
        : REDIRECT_PATHS[data.redirectTargetPath],
    candidate:
      data.phase === "quickconnect_direct_probe" ||
      data.phase === "quickconnect_relay_probe",
  };
}
