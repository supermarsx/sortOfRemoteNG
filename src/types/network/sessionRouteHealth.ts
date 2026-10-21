export const routeHealthKinds = [
  "ssh",
  "ssh-jump",
  "proxy",
  "proxy-command",
  "vpn",
  "local-forward",
  "rdp",
  "private-relay",
] as const;
export const routeHealthStates = [
  "waiting",
  "connected",
  "failed",
  "disconnected",
  "unknown",
] as const;
export const routeHealthEvidence = [
  "negotiating",
  "negotiated",
  "negotiation-failed",
  "runtime-active",
  "runtime-ended",
  "channel-unavailable",
  "not-observed",
  "forward-active",
  "forward-ended",
] as const;
export const routeHealthStages = [
  "dns",
  "tcp",
  "proxy-negotiation",
  "ssh-handshake",
  "ssh-authentication",
  "channel-open",
  "forward-listener",
  "rdp-handshake",
  "transport",
  "relay",
] as const;
const endpointProtocols = [
  "ssh",
  "socks4",
  "socks5",
  "http-connect",
  "https-connect",
  "rdp",
  "tcp",
  "openvpn",
] as const;
export interface RouteHopEndpoint {
  host: string;
  port: number;
  protocol: (typeof endpointProtocols)[number];
}
function parseEndpoint(value: unknown): RouteHopEndpoint | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (
    typeof row.host !== "string" ||
    !row.host ||
    new TextEncoder().encode(row.host).length > 253 ||
    /[\s/\\@?#"']/u.test(row.host) ||
    Array.from(row.host).some(
      (character) =>
        character.charCodeAt(0) < 32 ||
        (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159),
    ) ||
    typeof row.port !== "number" ||
    !Number.isInteger(row.port) ||
    row.port < 1 ||
    row.port > 65535 ||
    !endpointProtocols.includes(row.protocol as RouteHopEndpoint["protocol"])
  )
    return;
  let host = row.host;
  if (host.startsWith("[") || host.endsWith("]")) {
    if (!host.startsWith("[") || !host.endsWith("]")) return;
    host = host.slice(1, -1);
    if (!host.includes(":")) return;
  }
  if (host.includes(":")) {
    try {
      new URL(`http://[${host}]/`);
    } catch {
      return;
    }
  }
  return {
    host: row.host,
    port: row.port,
    protocol: row.protocol as RouteHopEndpoint["protocol"],
  };
}
export interface SessionRouteHealth {
  sessionId: string;
  observedAtUnixMs: number | null;
  truncated: boolean;
  hops: {
    index: number;
    endpoint?: RouteHopEndpoint;
    kind: (typeof routeHealthKinds)[number];
    state: (typeof routeHealthStates)[number];
    evidence: (typeof routeHealthEvidence)[number];
    stage: (typeof routeHealthStages)[number];
    updatedAtUnixMs: number | null;
  }[];
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Route health is unavailable.");
  return value as Record<string, unknown>;
};
const time = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8_640_000_000_000_000;
/** Project only closed metadata. Unknown native fields never enter UI state. */
export function parseSessionRouteHealth(
  value: unknown,
  expectedSessionId: string,
): SessionRouteHealth {
  const raw = object(value);
  if (
    (raw.truncated !== undefined && typeof raw.truncated !== "boolean") ||
    raw.sessionId !== expectedSessionId ||
    !expectedSessionId ||
    (raw.observedAtUnixMs !== null && !time(raw.observedAtUnixMs)) ||
    !Array.isArray(raw.hops) ||
    raw.hops.length > 64
  )
    throw new Error("Route health is unavailable.");
  const observedAtUnixMs = raw.observedAtUnixMs;
  const seen = new Set<number>();
  const hops = raw.hops.map((item) => {
    const row = object(item);
    if (
      typeof row.index !== "number" ||
      !Number.isSafeInteger(row.index) ||
      row.index < 0 ||
      row.index >= 64 ||
      seen.has(row.index) ||
      !routeHealthKinds.includes(
        row.kind as SessionRouteHealth["hops"][number]["kind"],
      ) ||
      !routeHealthStates.includes(
        row.state as SessionRouteHealth["hops"][number]["state"],
      ) ||
      !routeHealthEvidence.includes(
        row.evidence as SessionRouteHealth["hops"][number]["evidence"],
      ) ||
      !routeHealthStages.includes(
        row.stage as SessionRouteHealth["hops"][number]["stage"],
      ) ||
      (row.updatedAtUnixMs !== null && !time(row.updatedAtUnixMs)) ||
      (typeof row.updatedAtUnixMs === "number" &&
        typeof observedAtUnixMs === "number" &&
        row.updatedAtUnixMs > observedAtUnixMs)
    )
      throw new Error("Route health is unavailable.");
    seen.add(row.index);
    const endpoint = parseEndpoint(row.endpoint);
    return {
      index: row.index,
      ...(endpoint ? { endpoint } : {}),
      kind: row.kind,
      state: row.state,
      evidence: row.evidence,
      stage: row.stage,
      updatedAtUnixMs: row.updatedAtUnixMs,
    } as SessionRouteHealth["hops"][number];
  });
  return {
    truncated: raw.truncated === true,
    sessionId: expectedSessionId,
    observedAtUnixMs,
    hops: hops.sort((a, b) => a.index - b.index),
  };
}

export interface VpnLeaseObservation {
  ownerId: string;
  truncated: boolean;
  leases: {
    vpnType: string;
    connectionId: string;
    leaseOwned: true;
    cleanupPending: boolean;
    providerState: "connected" | "disconnected" | "unknown";
    observedAtUnixMs: number | null;
  }[];
}
export function parseVpnLeaseObservations(
  value: unknown,
  owners: readonly string[],
): VpnLeaseObservation[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new Error("VPN observations are unavailable.");
  const seen = new Set<string>();
  const observations = value.map((item) => {
    const row = object(item);
    if (
      typeof row.ownerId !== "string" ||
      !owners.includes(row.ownerId) ||
      seen.has(row.ownerId) ||
      typeof row.truncated !== "boolean" ||
      !Array.isArray(row.leases) ||
      row.leases.length > 32
    )
      throw new Error("VPN observations are unavailable.");
    seen.add(row.ownerId);
    const leases = row.leases.map((item) => {
      const lease = object(item);
      if (
        typeof lease.vpnType !== "string" ||
        ![
          "openvpn",
          "wireguard",
          "tailscale",
          "zerotier",
          "pptp",
          "l2tp",
          "ikev2",
          "ipsec",
          "sstp",
        ].includes(lease.vpnType) ||
        typeof lease.connectionId !== "string" ||
        lease.leaseOwned !== true ||
        typeof lease.cleanupPending !== "boolean" ||
        !["connected", "disconnected", "unknown"].includes(
          lease.providerState as string,
        ) ||
        (lease.observedAtUnixMs !== null && !time(lease.observedAtUnixMs))
      )
        throw new Error("VPN observations are unavailable.");
      return {
        vpnType: lease.vpnType,
        connectionId: lease.connectionId,
        leaseOwned: true as const,
        cleanupPending: lease.cleanupPending,
        providerState: lease.providerState as
          "connected" | "disconnected" | "unknown",
        observedAtUnixMs: lease.observedAtUnixMs as number | null,
      };
    });
    return { ownerId: row.ownerId, truncated: row.truncated, leases };
  });
  if (observations.length !== owners.length)
    throw new Error("VPN observations are unavailable.");
  return observations;
}
