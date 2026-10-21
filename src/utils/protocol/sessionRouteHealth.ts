import type { SessionRouteHealth } from "../../types/network/sessionRouteHealth";
import type { OriginConnectionHealth } from "./originConnectionHealth";
const names = {
  ssh: "SSH transport",
  "ssh-jump": "SSH jump",
  proxy: "Proxy",
  "proxy-command": "SSH ProxyCommand",
  vpn: "VPN",
  "local-forward": "Local forward",
  rdp: "RDP transport",
  "private-relay": "Private proxy",
};
const stages = {
  dns: "DNS lookup",
  tcp: "TCP connection",
  "proxy-negotiation": "Proxy negotiation",
  "ssh-handshake": "SSH handshake",
  "ssh-authentication": "SSH authentication",
  "channel-open": "SSH channel",
  "forward-listener": "Forward listener",
  "rdp-handshake": "RDP handshake",
  transport: "Transport",
  relay: "Private relay",
};
const evidence = {
  negotiating: "Negotiation in progress",
  negotiated:
    "Negotiation succeeded during setup; current reachability is not checked",
  "negotiation-failed": "Negotiation failed",
  "runtime-active": "Native component is active",
  "runtime-ended": "Native component ended",
  "channel-unavailable": "Native channel is unavailable",
  "not-observed": "No component observation is available",
  "forward-active": "Forward listener is active",
  "forward-ended": "Forward listener ended",
};
export function observedSessionRouteHops(
  report: SessionRouteHealth,
  metadata: {
    sourceProtocol?: string;
    sourceName?: string;
  } = {},
): OriginConnectionHealth["hops"] {
  const stamp = (value: number | null) =>
    value !== null && value > 0
      ? new Date(value).toISOString()
      : "Not available";
  const safeName = (value: string | undefined) =>
    value
      ?.split("")
      .filter(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      )
      .join("")
      .trim()
      .slice(0, 120);
  const labels = new Map<number, string>();
  const finalKind =
    metadata.sourceProtocol === "ssh"
      ? "ssh"
      : metadata.sourceProtocol === "rdp"
        ? "rdp"
        : null;
  const finals = report.hops.filter((hop) => hop.kind === finalKind);
  const sourceName = safeName(metadata.sourceName);
  if (finals.length === 1 && sourceName)
    labels.set(finals[0].index, sourceName);
  // Native ordinals do not attest saved component IDs. Current saved names may
  // have changed since actor creation, so only the caller's actor-bound own
  // transport name can be displayed; upstream components keep native ordinals.
  const endpointLabel = (hop: SessionRouteHealth["hops"][number]) => {
    if (!hop.endpoint) return "";
    const { host, port } = hop.endpoint;
    return ` · ${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
  };
  const hops: OriginConnectionHealth["hops"] = report.hops.map((hop) => ({
    key: `runtime-${hop.index}`,
    label: labels.has(hop.index)
      ? `${labels.get(hop.index)} · ${names[hop.kind]}${endpointLabel(hop)}`
      : `${names[hop.kind]} · component ${hop.index + 1}${endpointLabel(hop)}`,
    kind: "Runtime route component",
    stateLabel:
      hop.state === "waiting"
        ? "Waiting"
        : hop.state === "failed"
          ? "Failed"
          : hop.state === "disconnected"
            ? "Disconnected"
            : hop.evidence === "negotiated"
              ? "Setup succeeded"
              : hop.state === "connected" &&
                  ["runtime-active", "forward-active"].includes(hop.evidence)
                ? "Active"
                : undefined,
    status:
      hop.state === "waiting"
        ? "connecting"
        : hop.state === "failed"
          ? "degraded"
          : hop.state === "disconnected"
            ? "disconnected"
            : hop.state === "connected" &&
                ["runtime-active", "forward-active"].includes(hop.evidence)
              ? "healthy"
              : "unknown",
    detail: `${hop.endpoint ? `${hop.endpoint.protocol.toUpperCase()} endpoint${endpointLabel(hop)}. ` : ""}${stages[hop.stage]}: ${evidence[hop.evidence]}. Stage updated ${stamp(hop.updatedAtUnixMs)}; snapshot ${stamp(report.observedAtUnixMs)}.`,
  }));
  if (report.truncated)
    hops.push({
      key: "runtime-telemetry-limit",
      label: "Additional route components",
      kind: "Telemetry limit",
      status: "unknown",
      detail:
        "The runtime telemetry limit was reached. Some route components are omitted; this is not a complete chain observation.",
    });
  return hops;
}
