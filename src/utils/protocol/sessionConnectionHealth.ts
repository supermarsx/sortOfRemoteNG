import type { Connection } from "../../types/connection/connection";
import type {
  RDPLifecycleEvent,
  RDPStatsEvent,
} from "../../types/rdp/rdpEvents";
import {
  configuredOriginRouteHops,
  type OriginConnectionHealth,
} from "./originConnectionHealth";

export interface SessionConnectionHealthInput {
  protocol: "ssh" | "rdp";
  status: string;
  backendSessionId?: string | null;
  connection?: Connection;
  accessible: boolean;
  alive?: boolean | null;
  stats?: RDPStatsEvent | null;
  lifecycle?: RDPLifecycleEvent | null;
}

/** A backend observation is not a remote reachability probe. Never expose raw
 * errors, endpoint identifiers or credential-bearing configuration here. */
export function deriveSessionConnectionHealth(
  input: SessionConnectionHealthInput,
): OriginConnectionHealth {
  const protocol = input.protocol.toUpperCase();
  const result: OriginConnectionHealth = {
    visible: true,
    status: "unknown",
    label: "Connection not confirmed",
    summary:
      "Current backend health is unavailable. No network probe was performed.",
    details: [["Protocol", protocol]],
    hops: configuredOriginRouteHops(input.connection),
  };
  result.details.push([
    "Route",
    result.hops.length ? "Saved connection route" : `Direct ${protocol}`,
  ]);
  if (!input.accessible) return result;
  if (input.status === "connecting" || input.status === "reconnecting") {
    result.status = "connecting";
    result.label =
      input.status === "reconnecting" ? "Reconnecting" : "Connecting";
    result.summary =
      "The session is establishing its connection. Route hops are not independently checked.";
    return result;
  }
  if (["disconnected", "closed"].includes(input.status)) {
    result.status = "disconnected";
    result.label = "Disconnected";
    result.summary =
      "The viewer reports a disconnected session. No remote reachability claim is made.";
    return result;
  }
  if (input.status === "error") {
    result.status = "degraded";
    result.label = "Connection needs attention";
    result.summary =
      "The session reported a connection error. Review its diagnostics before reconnecting.";
    return result;
  }
  if (input.status !== "connected" || !input.backendSessionId) return result;
  if (input.protocol === "ssh") {
    if (input.alive === false) {
      result.status = "disconnected";
      result.label = "Backend session unavailable";
      result.summary =
        "The local SSH backend actor is no longer available. No network probe was performed.";
    } else if (input.alive === true) {
      result.status = "healthy";
      result.label = "Connected (backend actor)";
      result.summary =
        "The most recent local SSH actor and shell check passed. This does not measure remote latency or each route hop.";
    }
    result.details.push([
      "Traffic counters",
      "Not available from this SSH observation",
    ]);
    return result;
  }
  const stats =
    input.stats?.session_id === input.backendSessionId ? input.stats : null;
  const lifecycle =
    input.lifecycle?.sessionId === input.backendSessionId
      ? input.lifecycle
      : stats?.lifecycle?.sessionId === input.backendSessionId
        ? stats.lifecycle
        : null;
  if (!stats && !lifecycle) return result;
  const phases = [lifecycle?.state, stats?.phase].filter(
    (value) => value !== undefined,
  );
  if (
    phases.some((phase) =>
      ["closed", "disconnected", "failed", "terminated"].includes(phase),
    )
  ) {
    result.status = "disconnected";
    result.label = "Backend session unavailable";
    result.summary =
      "The latest matching RDP actor event reports that its connection ended.";
    return result;
  }
  if (phases.includes("error")) {
    result.status = "degraded";
    result.label = "Connection needs attention";
    result.summary =
      "The matching RDP backend reports an error. Review its diagnostics before reconnecting.";
    return result;
  }
  if (
    phases.some((phase) =>
      [
        "initializing",
        "tcp_connect",
        "tls_handshake",
        "credssp",
        "capability_exchange",
        "reactivating",
        "reconnecting",
        "negotiating",
        "connecting",
      ].includes(phase),
    )
  ) {
    result.status = "connecting";
    result.label = phases.includes("reconnecting")
      ? "Reconnecting"
      : "Connecting";
    result.summary =
      "The matching RDP actor reports connection setup in progress.";
    return result;
  }
  if (
    !phases.length ||
    phases.some((phase) => !["active", "connected"].includes(phase))
  )
    return result;
  result.status = "healthy";
  result.label = "Connected (backend actor)";
  result.summary =
    "The connected viewer has matching RDP backend telemetry. Counters describe the last sample, not a live reachability test.";
  const count = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const failed = lifecycle?.channelSummary?.failedCount;
  if (count(failed) && failed > 0) {
    result.status = "degraded";
    result.label = "Connection partly available";
    result.summary =
      "The matching RDP backend reports failed session channels. The transport may still be connected.";
    result.details.push(["Failed channels", String(failed)]);
  }
  if (stats)
    for (const [label, value] of [
      ["Sampled uptime (seconds)", stats.uptime_secs],
      ["Sampled bytes received", stats.bytes_received],
      ["Sampled bytes sent", stats.bytes_sent],
      ["Sampled frames", stats.frame_count],
      ["Historical recovered errors", stats.errors_recovered],
    ] as const)
      if (count(value)) result.details.push([label, String(value)]);
  return result;
}
