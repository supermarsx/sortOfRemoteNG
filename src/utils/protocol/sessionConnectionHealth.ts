import { VPN_PROVIDER_CATALOG } from "../network/vpnProviderCatalog";
import type { Connection } from "../../types/connection/connection";
import type {
  SessionRouteHealth,
  VpnLeaseObservation,
} from "../../types/network/sessionRouteHealth";
import { observedSessionRouteHops } from "./sessionRouteHealth";
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
  sourceName?: string;
  backendSessionId?: string | null;
  connection?: Connection;
  accessible: boolean;
  alive?: boolean | null;
  stats?: RDPStatsEvent | null;
  lifecycle?: RDPLifecycleEvent | null;
  routeHealth?: SessionRouteHealth | null;
  vpnLeases?: VpnLeaseObservation[] | null;
}

/** A backend observation is not a remote reachability probe. Never expose raw
 * errors, full URLs or credential-bearing configuration here. */
export function deriveSessionConnectionHealth(
  input: SessionConnectionHealthInput,
): OriginConnectionHealth {
  const protocol = input.protocol.toUpperCase();
  const suppliedRoute = input.routeHealth;
  const runtimeRoute =
    input.accessible &&
    suppliedRoute &&
    suppliedRoute.sessionId === input.backendSessionId &&
    (suppliedRoute.hops.length > 0 || suppliedRoute.truncated)
      ? suppliedRoute
      : null;
  const result: OriginConnectionHealth = {
    visible: true,
    status: "unknown",
    label: "Connection not confirmed",
    summary:
      "Current backend health is unavailable. No network probe was performed.",
    details: [["Protocol", protocol]],
    hops: !input.accessible
      ? []
      : runtimeRoute
        ? observedSessionRouteHops(runtimeRoute, {
            sourceProtocol: input.protocol,
            sourceName: input.sourceName,
          })
        : configuredOriginRouteHops(input.connection),
  };
  if (input.accessible && input.vpnLeases) {
    const leaseHops: OriginConnectionHealth["hops"] = [];
    input.vpnLeases.forEach((owner, ownerIndex) => {
      owner.leases.forEach((lease, leaseIndex) =>
        leaseHops.push({
          key: `vpn-lease-${ownerIndex}-${leaseIndex}`,
          label: `${VPN_PROVIDER_CATALOG.find((provider) => provider.type === lease.vpnType)?.label ?? "VPN"} · owned lease ${leaseHops.length + 1}`,
          kind: "Owned VPN prerequisite; route position is not attested",
          stateLabel: lease.cleanupPending
            ? "Cleanup pending"
            : lease.observedAtUnixMs !== null &&
                lease.providerState === "connected"
              ? "Connected"
              : lease.observedAtUnixMs !== null &&
                  lease.providerState === "disconnected"
                ? "Disconnected"
                : lease.observedAtUnixMs !== null
                  ? "Could not confirm"
                  : "Owned",
          status:
            !lease.cleanupPending &&
            lease.observedAtUnixMs !== null &&
            lease.providerState === "connected"
              ? "healthy"
              : !lease.cleanupPending &&
                  lease.observedAtUnixMs !== null &&
                  lease.providerState === "disconnected"
                ? "degraded"
                : "unknown",
          detail: lease.cleanupPending
            ? "The session owns this VPN lease, but cleanup is pending. Provider connectivity is not confirmed."
            : lease.observedAtUnixMs !== null &&
                lease.providerState !== "unknown"
              ? `The session owns this VPN lease. Provider status was ${lease.providerState} at ${new Date(lease.observedAtUnixMs).toISOString()}; this is a sampled provider observation, not a reachability probe.`
              : lease.observedAtUnixMs !== null
                ? `The session owns this VPN lease, but provider connectivity could not be confirmed at ${new Date(lease.observedAtUnixMs).toISOString()}.`
                : "The session owns this VPN lease. This confirms logical ownership only; provider connectivity has not been checked.",
        }),
      );
      if (!owner.leases.length)
        leaseHops.push({
          key: `vpn-lease-${ownerIndex}`,
          label: "VPN lease unavailable",
          kind: "Owned VPN prerequisite; route position is not attested",
          stateLabel: "Could not confirm",
          status: "unknown",
          detail:
            "No owned lease was found for the current session binding. Provider connectivity has not been checked.",
        });
      if (owner.truncated)
        leaseHops.push({
          key: `vpn-lease-limit-${ownerIndex}`,
          label: "Additional VPN leases",
          kind: "Telemetry limit",
          status: "unknown",
          detail: "Some VPN leases were omitted by the telemetry limit.",
        });
    });
    result.prerequisites = leaseHops;
  }
  result.details.push([
    "Route",
    runtimeRoute
      ? "Observed runtime route"
      : result.hops.length
        ? "Saved connection route"
        : `Direct ${protocol}`,
  ]);
  const routeFailed = [...result.hops, ...(result.prerequisites ?? [])].some(
    (hop) => hop.status === "degraded" || hop.status === "disconnected",
  );
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
    if (result.status === "healthy" && routeFailed) {
      result.status = "degraded";
      result.label = "Route component needs attention";
      result.summary =
        "The backend actor is available, but a current route component reports a failure. Review the component evidence below.";
    }
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
  if (result.status === "healthy" && routeFailed) {
    result.status = "degraded";
    result.label = "Route component needs attention";
    result.summary =
      "The backend actor is available, but a current route component reports a failure. Review the component evidence below.";
  }
  return result;
}
