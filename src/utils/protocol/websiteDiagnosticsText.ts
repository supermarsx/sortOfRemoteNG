import {
  parseWebNetworkReport,
  type WebNetworkReport,
  type WebNetworkRoutingStatus,
} from "./webNetworkReport";
import {
  parseNativeHttpObservations,
  type NativeHttpObservationsSnapshot,
  type WebNetworkGuardStatus,
} from "./webNetworkGuard";

/** The existing report parser also supplies the closed category/origin schema.
 * This synthetic envelope is only formatting validation, never a runtime grant. */
const copyDocument = {
  sessionId: "copy",
  token: "copy",
  sequence: 1,
  navigationToken: null,
  url: "http://localhost/",
};
export function websiteDiagnosticsText(
  reports: readonly WebNetworkReport[],
  guard: WebNetworkGuardStatus | null,
  routing: WebNetworkRoutingStatus | null | undefined,
  quickConnectRelevant: boolean,
): string {
  const lines = [
    "Website routing diagnostics",
    "Coverage: partial browser enforcement; not every network channel is intercepted.",
  ];
  const frame = guard?.frameNavigation;
  lines.push(
    `Native document navigation: ${frame && ["enforced", "failed", "initializing", "unsupported"].includes(frame) ? frame : "unavailable"}`,
  );
  const status = routing?.status;
  lines.push(
    `Page routing module: ${status && ["current", "missing", "mismatch"].includes(status) ? status : "not reported"}`,
  );
  if (routing) {
    const tacticalStatus =
      routing.status === "missing"
        ? routing.tacticalRmmApiExpected
          ? "expected; page module not reported"
          : "not reported"
        : routing.tacticalRmmApi === routing.tacticalRmmApiExpected
          ? routing.tacticalRmmApi
            ? "available (native validation required)"
            : "off"
          : routing.tacticalRmmApiExpected
            ? "expected but unavailable"
            : "unexpectedly available";
    lines.push(`Tactical RMM API route: ${tacticalStatus}`);
  }
  if (routing && quickConnectRelevant) {
    for (const [label, value] of [
      ["QuickConnect navigation", routing.quickConnectNavigation],
      ["QuickConnect discovery", routing.quickConnectDiscovery],
      ["Same-NAS probes", routing.quickConnectDiscovered],
      ["Direct navigation", routing.quickConnectDirectNavigation],
      ["Regional navigation", routing.quickConnectRegionalNavigation],
    ] as const)
      lines.push(
        `${label}: ${value === true ? "available (native validation required)" : "off or unavailable"}`,
      );
  }
  for (const report of reports.slice(0, 32)) {
    const safe = parseWebNetworkReport(
      {
        type: "sorng_web_network_blocked",
        version: 1,
        sessionId: copyDocument.sessionId,
        documentToken: copyDocument.token,
        documentSequence: copyDocument.sequence,
        navigationToken: null,
        url: copyDocument.url,
        kind: report.kind,
        reason: report.reason,
        origin: report.origin,
      },
      copyDocument,
    );
    if (safe)
      lines.push(
        `${safe.origin ?? "This page"} | ${safe.kind} | ${safe.reason}`,
      );
  }
  lines.push(
    "Redirect approval is separate from background routing. No paths, queries, headers, bodies or credentials included.",
  );
  return lines.join("\n");
}

export function nativeObservationsText(
  snapshot: NativeHttpObservationsSnapshot | null,
  filter: "current" | "web" | "all" = "all",
  origin?: string,
): string {
  if (!snapshot) return "No native HTTP observation snapshot is loaded.";
  let safe: NativeHttpObservationsSnapshot;
  try {
    safe = parseNativeHttpObservations(snapshot);
  } catch {
    return "Native HTTP observation snapshot is unavailable.";
  }
  let currentOrigin: string | undefined;
  try {
    const url = new URL(origin ?? "");
    if (["http:", "https:"].includes(url.protocol) && url.origin === origin)
      currentOrigin = origin;
  } catch {
    /* No origin is copied unless canonical. */
  }
  const matches = (row: NativeHttpObservationsSnapshot["recent"][number]) =>
    filter === "all" ||
    (filter === "current"
      ? row.origin === currentOrigin
      : new URL(row.origin).hostname !== "ipc.localhost" &&
        row.origin !== currentOrigin);
  const newest = safe.recent.slice().reverse();
  const rowText = (row: NativeHttpObservationsSnapshot["recent"][number]) =>
    `${row.sequence} | ${row.method} ${row.origin} | ${row.resourceKind} / ${row.sourceKind} | ${row.documentBlocked ? "document blocked" : "response outcome unknown"}`;
  const blocked = newest.filter((row) => row.documentBlocked && !matches(row));
  return [
    "Application-wide native HTTP observations (not attributed to this tab)",
    `Observed: ${safe.total}; document requests blocked: ${safe.documentBlocked}; retained: ${safe.recent.length}`,
    "Request observation only; response outcome unknown. Not proof of routing. WebSocket/WebRTC/native upstream traffic excluded.",
    `Displayed filter: ${filter === "current" ? "current proxy origin" : filter === "web" ? "other website traffic (excluding app IPC)" : "all, including app IPC"}`,
    ...(currentOrigin ? [`Current proxy origin: ${currentOrigin}`] : []),
    ...newest.filter(matches).map(rowText),
    ...(blocked.length
      ? [
          "Blocked document requests outside this filter:",
          ...blocked.map(rowText),
        ]
      : []),
    "No paths, queries, headers, bodies or credentials included.",
  ].join("\n");
}
