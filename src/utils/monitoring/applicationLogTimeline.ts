import type {
  ApplicationLogFile,
  ApplicationLogSource,
} from "../../types/monitoring/applicationLogs";

export const logCategories = {
  application: "Application",
  network: "Application network",
  security: "Application security",
  sessions: "Application sessions",
  startup: "Browser startup",
  navigation: "Browser navigation",
  tls: "Browser TLS",
  proxy: "Browser proxy",
  renderer: "Browser renderer and login",
  session: "Browser session",
  timing: "Browser timing",
} as const;
export type LogCategory = keyof typeof logCategories;
export interface LogTimelineRow {
  id: string;
  source: ApplicationLogSource;
  file: string;
  category: LogCategory;
  timestampMs: number | null;
  orderMs: number;
  sequence: number;
  level: string;
  message: string;
  details: string;
}

const stages = [
  "Command entered",
  "Command validated",
  "Owner authorized",
  "Runtime requested",
  "Preflight entered",
  "Data prepared",
  "Engine UI queued",
  "Engine UI entered",
  "Native initialization entered",
  "Native initialization returned",
  "Runtime installed",
  "Runtime ready",
  "Initial owner checked",
  "Retention prepared",
  "Cookies loaded",
  "Login prepared",
  "Owner checked before proxy",
  "Proxy ready",
  "Owner checked before context",
  "View UI queued",
  "UI entered",
  "Context created",
  "Context ready",
  "Browser attached",
  "Renderer ready",
  "Final owner checked",
  "Initial navigation queued",
  "Initial navigation entered",
  "Navigation submitted",
  "Command completed",
  "First document complete",
];
const ownerStartupStages = [
  "Owner authorized",
  "Runtime ready",
  "Initial owner checked",
  "Retention prepared",
  "Cookies loaded",
  "Login prepared",
  "Owner checked before proxy",
  "Proxy ready",
  "Owner checked before context",
  "UI entered",
  "Context created",
  "Context ready",
  "Browser attached",
  "Final owner checked",
  "Navigation submitted",
  "First document complete",
];
const ownerRecheckStages = [
  "Memory checks",
  "Database guard acquired",
  "Snapshot read",
  "Session key obtained",
  "Decrypt and parse",
  "Final dependency and window checks",
  ...Array.from({ length: 10 }, (_, i) => `Reserved phase ${i + 6}`),
];
const lifecycle: Record<string, string> = {
  preparing: "Preparing native browser",
  initializing: "Initializing native browser",
  ready: "Native browser ready",
  failed: "Native browser startup failed",
  "view-failed": "Native browser view failed",
  "runtime-fault": "Native browser runtime fault",
  closing: "Closing native browser",
  closed: "Native browser closed",
};
const failures = [
  "data-directory",
  "package",
  "initialization",
  "policy",
  "timeout",
  "shutdown",
  "private-proxy",
  "private-context",
  "cookie-restore",
  "native-surface",
  "renderer-setup",
  "renderer-fault",
  "initial-zoom",
  "initial-navigation",
  "context-creation",
  "invalid-evidence",
  "invalid-state",
  "owner-unavailable",
  "callback",
  "complete-rejected",
  "revoke-rejected",
  "engine-revoked",
  "engine-failure",
  "poisoned-state",
  "wrong-thread",
  "database-owner",
  "watchdog",
  "native-state",
  "certificate-bridge",
  "redirect-denied",
  "runtime-unavailable",
  "owner-window",
  "source-changed",
];
const checkpoints = [
  "renderer-installed",
  "renderer-installation-failed",
  "login-form-detected",
  "login-adapter-completed",
  "login-adapter-rejected",
  "native-not-delivered",
  "native-rejected-current",
  "native-rejected-navigation",
  "native-rejected-grant",
  "native-message-failed",
  "native-sent",
  "renderer-received",
  "renderer-rejected-frame",
  "renderer-rejected-payload",
  "renderer-rejected-document",
  "renderer-rejected-context",
  "renderer-executing",
  "renderer-accepted",
  "renderer-rejected",
  "renderer-missing-document",
  "renderer-nonce-mismatch",
  "renderer-origin-mismatch",
  "renderer-stage-not-requested",
  "renderer-stage-not-allowed",
  "renderer-replay",
  "login-challenge-waiting",
  "login-challenge-reloading",
  "login-challenge-timed-out",
];
const events: Record<string, [LogCategory, string]> = {
  requested: ["navigation", "Navigation requested"],
  browse: ["navigation", "Navigation admission checked"],
  "proxy-auth": ["proxy", "Proxy authentication callback"],
  "auth-completed": ["proxy", "Proxy authentication completed"],
  "load-error": ["navigation", "Document load error"],
  "private-relay": ["proxy", "Private relay failure evidence"],
  "tls-evidence": ["tls", "TLS evidence received"],
  "tls-review": ["tls", "TLS review requested"],
  "tls-allow": ["tls", "TLS connection permitted"],
  "tls-timing": ["tls", "TLS verification timing"],
  "tls-denied": ["tls", "TLS connection denied"],
  "tls-failed": ["tls", "TLS verification failed"],
  "tls-bridge-failed": ["tls", "TLS bridge failed"],
  "session-failed": ["session", "Browser session ended"],
  "renderer-feature": ["renderer", "Renderer checkpoint"],
  "resource-admission": ["navigation", "Resource admission checked"],
};
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const human = (value: string) => value.replace(/-/g, " ");
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const duration = (us: number) => `${(us / 1000).toFixed(2)} ms`;

function timingDetails(raw: Record<string, unknown>, labels = stages): string {
  if (
    !number(raw.reached) ||
    raw.reached >= 2 ** labels.length ||
    !Array.isArray(raw.elapsed_us) ||
    raw.elapsed_us.length !== labels.length ||
    !raw.elapsed_us.every(number)
  )
    return "Timing fields were not recognized.";
  let previous: number | null = null;
  return labels
    .flatMap((label, index) => {
      if (!((raw.reached as number) & (2 ** index))) return [];
      const elapsed = (raw.elapsed_us as number[])[index];
      const phase =
        previous !== null && elapsed >= previous
          ? ` (+${duration(elapsed - previous)})`
          : "";
      previous = elapsed;
      return [`${label}: ${duration(elapsed)} from start${phase}`];
    })
    .join(" · ");
}

/** Browser payload strings are never echoed: only fixed enums and numeric fields. */
function journal(
  raw: unknown,
): Pick<
  LogTimelineRow,
  "category" | "message" | "details" | "timestampMs" | "level"
> {
  const value = object(raw);
  const timestampMs =
    number(value?.timestampUnixMs) && value.timestampUnixMs <= 8.64e15
      ? value.timestampUnixMs
      : null;
  const unknown = {
    category: "startup" as const,
    message: "Unrecognized browser journal record",
    details: "Unsupported or incomplete record; raw fields are not displayed.",
    timestampMs,
    level: "LOG",
  };
  if (!value) return unknown;
  if (value.timing_version === 1) {
    const kind =
      value.kind === 1
        ? "Startup"
        : value.kind === 2
          ? "Prewarm"
          : "Native browser";
    const outcome =
      value.outcome === 255
        ? "checkpoint"
        : value.outcome === 0
          ? "failed or cancelled"
          : value.outcome === 1
            ? "prewarm completed"
            : value.outcome === 2
              ? "first document completed"
              : "unrecognized outcome";
    return {
      category: "timing",
      message: `${kind} timing: ${outcome}`,
      details: `${number(value.total_us) ? `Total ${duration(value.total_us)}. ` : ""}${timingDetails(value)}`,
      timestampMs,
      level: value.outcome === 0 ? "WARN" : "INFO",
    };
  }
  if (value.version !== 1) return unknown;
  if (
    typeof value.stage === "string" &&
    Object.prototype.hasOwnProperty.call(lifecycle, value.stage)
  ) {
    return {
      category: "startup",
      message: lifecycle[value.stage],
      details:
        typeof value.failure === "string" && failures.includes(value.failure)
          ? `Reason: ${human(value.failure)}`
          : "",
      timestampMs,
      level: ["failed", "view-failed", "runtime-fault"].includes(value.stage)
        ? "ERROR"
        : "INFO",
    };
  }
  const nav = object(value.navigation);
  if (
    !nav ||
    typeof nav.event !== "string" ||
    !Object.prototype.hasOwnProperty.call(events, nav.event)
  )
    return unknown;
  const [category, message] = events[nav.event];
  if (nav.event === "tls-timing") {
    if (
      !number(nav.outcome) ||
      nav.outcome > 4 ||
      !number(nav.last_phase) ||
      nav.last_phase > 6 ||
      !Array.isArray(nav.phase_ms) ||
      nav.phase_ms.length !== 7 ||
      !nav.phase_ms.every((ms) => number(ms) && ms <= 86_400_000)
    )
      return unknown;
    const phases = nav.phase_ms;
    const keys = [
      "worker_queue_ms",
      "owner_before_ms",
      "certificate_ms",
      "review_ms",
      "owner_after_ms",
      "ui_queue_ms",
      "ui_completion_ms",
    ];
    const timing = nativeTiming(
      `Native browser TLS timing: outcome=${nav.outcome} last_phase=${nav.last_phase} ${keys.map((key, i) => `${key}=${phases[i]}`).join(" ")}`,
    );
    return timing
      ? { ...timing, timestampMs, level: nav.outcome === 3 ? "INFO" : "WARN" }
      : unknown;
  }
  const details: string[] = [];
  for (const [key, label] of [
    ["allowed", "Allowed"],
    ["main_frame", "Main frame"],
    ["fatal", "Fatal"],
    ["handled", "Handled"],
    ["callback_present", "Callback present"],
    ["default_disabled", "Default handler disabled"],
  ]) {
    if (typeof nav[key] === "boolean")
      details.push(`${label}: ${nav[key] ? "yes" : "no"}`);
  }
  if (
    typeof nav.code === "number" &&
    Number.isSafeInteger(nav.code) &&
    nav.code >= -2147483648 &&
    nav.code <= 2147483647
  )
    details.push(`Native code: ${nav.code}`);
  if (typeof nav.reason === "string" && failures.includes(nav.reason))
    details.push(`Reason: ${human(nav.reason)}`);
  if (
    typeof nav.checkpoint === "string" &&
    checkpoints.includes(nav.checkpoint)
  )
    details.push(human(nav.checkpoint));
  if (number(nav.resource_type))
    details.push(`Resource type: ${nav.resource_type}`);
  const relay = object(nav.snapshot);
  if (
    relay &&
    typeof relay.state === "string" &&
    [
      "listening",
      "revoking",
      "stopped",
      "listener-failed",
      "task-ended",
    ].includes(relay.state)
  )
    details.push(`Relay: ${human(relay.state)}`);
  if (relay)
    for (const [key, label] of [
      ["acceptedConnections", "Connections"],
      ["authenticationChallenges", "Authentication challenges"],
      ["authenticatedRequests", "Authenticated requests"],
      ["destinationDenials", "Destination denials"],
      ["upstreamFailures", "Upstream failures"],
      ["requestRejections", "Request rejections"],
      ["capacityRefusals", "Capacity refusals"],
    ]) {
      if (number(relay[key])) details.push(`${label}: ${relay[key]}`);
    }
  return {
    category,
    message,
    details: details.join(" · "),
    timestampMs,
    level: /(?:error|failed|denied)$/.test(nav.event) ? "WARN" : "INFO",
  };
}

function nativeTiming(
  message: string,
): { category: LogCategory; message: string; details: string } | null {
  if (message.startsWith("Native browser TLS timing:")) {
    const match =
      /^Native browser TLS timing: outcome=(\d+) last_phase=(\d+) worker_queue_ms=(\d+) owner_before_ms=(\d+) certificate_ms=(\d+) review_ms=(\d+) owner_after_ms=(\d+) ui_queue_ms=(\d+) ui_completion_ms=(\d+)$/.exec(
        message,
      );
    if (!match || !match.slice(1).map(Number).every(number))
      return {
        category: "tls",
        message: "Unrecognized native TLS timing record",
        details: "Raw fields are not displayed.",
      };
    const values = match.slice(1).map(Number);
    const outcomes = [
      "cancelled",
      "owner denied",
      "policy denied",
      "admitted",
      "UI pump failed",
    ];
    const labels = [
      "Worker queue",
      "Owner check before",
      "Certificate verification",
      "Certificate review",
      "Owner check after",
      "UI queue",
      "UI completion",
    ];
    return {
      category: "tls",
      message: `TLS timing: ${outcomes[values[0]] ?? "unrecognized outcome"}`,
      details: labels
        .map((label, i) => `${label}: ${values[i + 2]} ms`)
        .join(" · "),
    };
  }
  if (message.startsWith("Native browser timing:")) {
    const match =
      /^Native browser timing: kind=(\d+) outcome=(\d+) total_us=(\d+) reached=(\d+) us=(\[[\d, ]*\])$/.exec(
        message,
      );
    if (!match || !match.slice(1, 5).map(Number).every(number))
      return {
        category: "timing",
        message: "Unrecognized native browser timing record",
        details: "Raw fields are not displayed.",
      };
    let elapsed: unknown;
    try {
      elapsed = JSON.parse(match[5]);
    } catch {
      return {
        category: "timing",
        message: "Unrecognized native browser timing record",
        details: "Raw fields are not displayed.",
      };
    }
    const kind = Number(match[1]);
    const total = Number(match[3]);
    const label =
      kind === 1
        ? "Owner startup"
        : kind === 2
          ? "Owner recheck"
          : "Owner operation";
    return {
      category: "timing",
      message: `${label} timing (outcome code ${Number(match[2])})`,
      details: `${number(total) ? `Total ${duration(total)}. ` : ""}${timingDetails({ reached: Number(match[4]), elapsed_us: elapsed }, kind === 2 ? ownerRecheckStages : ownerStartupStages)}`,
    };
  }
  return null;
}

const wallTimestamp =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/;
const ansiStyle = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:]*m`, "g");
// Known connection spans omit fields. Other bare tokens stay targets so
// module-looking message text cannot select its own category.
const connectionSpans = new Set(["connect_begin", "connect_finalize"]);

/** Tracing's span fields may contain quoted colons, URLs and nested braces. */
function tracingMessage(body: string): {
  message: string;
  target?: string;
  scope?: string;
} {
  let offset = 0;
  while (offset < body.length) {
    const start = offset;
    const name = /^[a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z_][a-zA-Z0-9_]*)*/.exec(
      body.slice(offset),
    )?.[0];
    if (!name) break;
    offset += name.length;
    const fields = body[offset] === "{";
    if (fields) {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      do {
        const character = body[offset++];
        if (escaped) escaped = false;
        else if (quoted && character === "\\") escaped = true;
        else if (character === '"') quoted = !quoted;
        else if (!quoted && character === "{") depth++;
        else if (!quoted && character === "}") depth--;
      } while (offset < body.length && (depth > 0 || quoted));
      if (depth !== 0 || quoted) break;
    }
    if (body[offset] !== ":") break;
    offset++;
    const nestedSpan = body[offset] !== " ";
    while (body[offset] === " ") offset++;
    if (!fields && !nestedSpan && !connectionSpans.has(name))
      return {
        target: name,
        message: body.slice(offset),
        scope: body.slice(0, start).replace(/:\s*$/, ""),
      };
  }
  return { message: body };
}

export function parseLogTimeline(
  text: string,
  source: ApplicationLogSource,
  file: ApplicationLogFile,
): LogTimelineRow[] {
  // The reader already bounds files; retain a separate presentation bound.
  const lines = text.slice(-262144).split(/\r?\n/).slice(-2000);
  const result: LogTimelineRow[] = [];
  lines.forEach((rawLine, sequence) => {
    const line =
      source === "application" ? rawLine.replace(ansiStyle, "") : rawLine;
    if (!line.trim()) return;
    const base = {
      id: `${source}:${file.id}:${sequence}`,
      source,
      file: file.name,
      orderMs: file.modifiedUnixMs,
      sequence,
    };
    if (source === "browser") {
      let raw: unknown = null;
      try {
        raw = JSON.parse(line);
      } catch {
        /* fixed fallback, never raw text */
      }
      const row = journal(raw);
      result.push({
        ...base,
        ...row,
        orderMs: row.timestampMs ?? base.orderMs,
      });
      return;
    }
    const structured =
      /^\[([^\]]+)\]\[(ERROR|WARN|INFO|DEBUG|TRACE)\]\[([^\]]*)\] (.*)$/.exec(
        line,
      );
    const simple = /^(ERROR|WARN|INFO|DEBUG|TRACE)\s+(.*)$/.exec(line);
    const traced =
      /^(\d{4}-\d\d-\d\dT\S+)\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+(.*)$/.exec(
        line,
      );
    if (!structured && !simple && !traced && result.length) {
      result[result.length - 1].details +=
        `${result[result.length - 1].details ? "\n" : ""}${line}`;
      return;
    }
    const time = structured?.[1] ?? traced?.[1];
    const parsedTime =
      time && wallTimestamp.test(time) ? Date.parse(time) : NaN;
    const timestampMs =
      Number.isSafeInteger(parsedTime) && Math.abs(parsedTime) <= 8.64e15
        ? parsedTime
        : null;
    const tracing = traced ? tracingMessage(traced[3]) : null;
    const message = structured?.[4] ?? simple?.[2] ?? tracing?.message ?? line;
    const failureTime =
      /^Native browser (?:client )?failure: timestampUnixMs=(\d{1,16}) /.exec(
        message,
      );
    const observedTime = failureTime ? Number(failureTime[1]) : NaN;
    const pretty = nativeTiming(message);
    const target = structured?.[3] ?? tracing?.target;
    const moduleName =
      target && /^[a-zA-Z_][a-zA-Z0-9_:]{0,160}$/.test(target) ? target : null;
    const inModule = (names: string[]) =>
      moduleName &&
      names.some(
        (name) => moduleName === name || moduleName.startsWith(`${name}::`),
      );
    const browserCategory = (
      ["startup", "navigation", "tls", "proxy", "session"] as const
    ).find((category) => inModule([`native_browser::${category}`]));
    const eventTimestamp =
      browserCategory &&
      Number.isSafeInteger(observedTime) &&
      observedTime > 0 &&
      observedTime <= 8_640_000_000_000_000
        ? observedTime
        : timestampMs;
    const category: LogCategory =
      browserCategory ??
      (inModule([
        "sorng_ssh",
        "sorng_socket_transport",
        "sorng_protocols::private_forward_proxy",
      ])
        ? "network"
        : inModule(["sorng_encryption", "sorng_tls_trust", "sspi"])
          ? "security"
          : inModule(["sorng_rdp", "sorng_serial", "ironrdp"]) ||
              (moduleName !== null && moduleName.startsWith("ironrdp_"))
            ? "sessions"
            : "application");
    result.push({
      ...base,
      category,
      timestampMs: eventTimestamp,
      orderMs: eventTimestamp ?? base.orderMs,
      level: structured?.[2] ?? simple?.[1] ?? traced?.[2] ?? "LOG",
      message,
      details: "",
      ...pretty,
      ...(moduleName
        ? {
            details: `${pretty?.details ? `${pretty.details}\n` : ""}Module: ${moduleName}${tracing?.scope ? `\nSpan: ${tracing.scope}` : ""}`,
          }
        : {}),
    });
  });
  return result;
}

export function newestLogRows(rows: LogTimelineRow[]): LogTimelineRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.orderMs - a.orderMs ||
        b.file.localeCompare(a.file) ||
        b.sequence - a.sequence ||
        a.source.localeCompare(b.source),
    )
    .slice(0, 4000);
}

export function logRowsText(rows: LogTimelineRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.timestampMs === null ? `Recorded order ${row.sequence + 1}` : new Date(row.timestampMs).toISOString()} [${logCategories[row.category]}] [${row.level}] ${row.message}${row.details ? `\n${row.details}` : ""}\nSource: ${row.source} · ${row.file}`,
    )
    .join("\n\n");
}
