export interface WebNetworkGuardStatus {
  platform: string;
  frameNavigation: "enforced" | "initializing" | "failed" | "unsupported";
  /** Windows native HTTP(S) WebView request enforcement only. Portable page
   * mediation is reported separately by the page routing receipt. */
  allNetworkRequestsMediated: boolean;
  httpObservations?: NativeHttpObservationsSnapshot;
}

const methods = [
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
] as const;
const resources = [
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "xhr",
  "fetch",
  "text-track",
  "event-source",
  "websocket",
  "manifest",
  "signed-exchange",
  "ping",
  "csp-report",
  "other",
] as const;
const sources = [
  "document",
  "shared-worker",
  "service-worker",
  "unknown",
] as const;
export interface NativeHttpObservation {
  sequence: number;
  method: (typeof methods)[number];
  origin: string;
  resourceKind: (typeof resources)[number];
  sourceKind: (typeof sources)[number];
  documentBlocked: boolean;
}
export interface NativeHttpObservationsSnapshot {
  scope: "application";
  total: number;
  documentBlocked: number;
  recent: NativeHttpObservation[];
}

export function parseNativeHttpObservations(
  value: unknown,
): NativeHttpObservationsSnapshot {
  const fail = () => {
    throw new Error("Native HTTP observations are unavailable.");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.scope !== "application" ||
    !Number.isSafeInteger(snapshot.total) ||
    (snapshot.total as number) < 0 ||
    !Number.isSafeInteger(snapshot.documentBlocked) ||
    (snapshot.documentBlocked as number) < 0 ||
    (snapshot.documentBlocked as number) > (snapshot.total as number) ||
    !Array.isArray(snapshot.recent) ||
    snapshot.recent.length > 64 ||
    snapshot.recent.length > (snapshot.total as number)
  )
    return fail();
  let previous = 0;
  const recent = snapshot.recent.map((value): NativeHttpObservation => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail();
    const row = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.sequence) ||
      (row.sequence as number) < 1 ||
      (row.sequence as number) < previous ||
      (row.sequence as number) > (snapshot.total as number) ||
      !methods.includes(row.method as (typeof methods)[number]) ||
      !resources.includes(row.resourceKind as (typeof resources)[number]) ||
      !sources.includes(row.sourceKind as (typeof sources)[number]) ||
      typeof row.documentBlocked !== "boolean" ||
      (row.documentBlocked && row.resourceKind !== "document") ||
      typeof row.origin !== "string" ||
      row.origin.length > 512
    )
      return fail();
    let origin: URL;
    try {
      origin = new URL(row.origin);
    } catch {
      return fail();
    }
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== row.origin ||
      origin.username ||
      origin.password
    )
      return fail();
    previous = row.sequence as number;
    // Construct a fresh closed object: unrecognized secret-bearing fields never
    // reach UI state even when the diagnostic source returns extra properties.
    return {
      sequence: previous,
      method: row.method as NativeHttpObservation["method"],
      origin: row.origin,
      resourceKind: row.resourceKind as NativeHttpObservation["resourceKind"],
      sourceKind: row.sourceKind as NativeHttpObservation["sourceKind"],
      documentBlocked: row.documentBlocked,
    };
  });
  return {
    scope: "application",
    total: snapshot.total as number,
    documentBlocked: snapshot.documentBlocked as number,
    recent,
  };
}
export function parseWebNetworkGuardStatus(
  value: unknown,
): WebNetworkGuardStatus {
  if (!value || typeof value !== "object")
    throw new Error(
      "Website navigation protection status is unavailable. Reload after the desktop application is ready.",
    );
  const status = value as Record<string, unknown>;
  if (
    typeof status.platform !== "string" ||
    !/^[a-z0-9_-]{1,32}$/.test(status.platform) ||
    !["enforced", "initializing", "failed", "unsupported"].includes(
      String(status.frameNavigation),
    ) ||
    typeof status.allNetworkRequestsMediated !== "boolean" ||
    (status.allNetworkRequestsMediated &&
      (status.platform !== "windows" ||
        status.frameNavigation !== "enforced")) ||
    (status.platform === "windows" && status.frameNavigation === "unsupported")
  )
    throw new Error(
      "Website navigation protection status is invalid. Update or restart the desktop application before retrying.",
    );
  const result: WebNetworkGuardStatus = {
    platform: status.platform,
    frameNavigation:
      status.frameNavigation as WebNetworkGuardStatus["frameNavigation"],
    allNetworkRequestsMediated: status.allNetworkRequestsMediated,
  };
  // Optional diagnostics must not break the independently validated navigation
  // guard. Invalid snapshots are omitted, not shown or treated as authority.
  if (
    status.platform === "windows" &&
    status.frameNavigation === "enforced" &&
    status.httpObservations !== undefined
  ) {
    try {
      result.httpObservations = parseNativeHttpObservations(
        status.httpObservations,
      );
    } catch {
      /* no usable diagnostic */
    }
  }
  return result;
}
