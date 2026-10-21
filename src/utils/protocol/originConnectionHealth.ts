import type { Connection } from "../../types/connection/connection";
import type { OriginBrowserState } from "../../hooks/protocol/useOriginBrowser";
import type { NativeBrowserSessionDiagnostics } from "../../types/network/nativeBrowserDiagnostics";
import { browserConnectionDiagnosticFacts } from "./browserConnectionDiagnostics";
import { observedSessionRouteHops } from "./sessionRouteHealth";
import type { NetworkPathSummary } from "../network/resolveNetworkPath";

export type OriginConnectionHealthStatus =
  "connecting" | "healthy" | "degraded" | "disconnected" | "unknown";
export interface OriginConnectionHealth {
  visible: boolean;
  status: OriginConnectionHealthStatus;
  label: string;
  summary: string;
  details: [string, string][];
  prerequisites?: OriginConnectionHealth["hops"];
  hops: {
    key: string;
    label: string;
    kind: string;
    stateLabel?:
      | "Setup succeeded"
      | "Active"
      | "Waiting"
      | "Failed"
      | "Disconnected"
      | "Connected"
      | "Owned"
      | "Cleanup pending"
      | "Could not confirm";
    status: OriginConnectionHealthStatus;
    detail: string;
  }[];
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const present = (value: unknown) =>
  value !== undefined && value !== null && value !== "";
const displayName = (value: unknown): string | undefined =>
  typeof value === "string"
    ? Array.from(value)
        .filter(
          (character) =>
            character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127,
        )
        .join("")
        .slice(0, 120)
        .trim() || undefined
    : undefined;
function hopName(
  layer: Record<string, unknown>,
  connections: readonly Connection[],
) {
  const id = object(layer.sshTunnel).connectionId;
  const selected = connections.filter(
    (row) => row.id === id && row.protocol === "ssh" && !row.isGroup,
  );
  return (
    displayName(layer.name) ??
    (selected.length === 1 ? displayName(selected[0].name) : undefined)
  );
}
const kinds: Record<string, string> = {
  "ssh-tunnel": "SSH tunnel",
  "ssh-jump": "SSH jump",
  "local-forward": "Local forward",
  "ssh-proxycmd": "SSH ProxyCommand",
  "ssh-stdio": "SSH stream",
  proxy: "Proxy",
  openvpn: "OpenVPN",
  wireguard: "WireGuard",
  tailscale: "Tailscale",
  zerotier: "ZeroTier",
  tor: "Tor",
  shadowsocks: "Shadowsocks",
  stunnel: "TLS tunnel",
  chisel: "Chisel",
  cloudflared: "Cloudflare tunnel",
  ngrok: "ngrok",
  i2p: "I2P",
  pptp: "PPTP",
  l2tp: "L2TP",
  ikev2: "IKEv2",
  ipsec: "IPsec",
  sstp: "SSTP",
  softether: "SoftEther",
};

/** Configuration describes the intended route, never evidence that a hop ran.
 * Project labels only: addresses, IDs, credentials and arbitrary errors stay out. */
export function configuredOriginRouteHops(
  connection?: Partial<Connection>,
  connections: readonly Connection[] = [],
): OriginConnectionHealth["hops"] {
  const source = object(connection);
  const result: OriginConnectionHealth["hops"] = [];
  const add = (
    key: string,
    label: string,
    detail: string,
    kind = "Configured route",
  ) =>
    result.push({
      key,
      label,
      kind,
      status: "unknown",
      detail,
    });
  const reference = (key: string, label: string) =>
    add(
      key,
      label,
      "Saved reference; its hops are not available in this observation.",
    );
  if (present(source.connectionChainId))
    reference("connectionChainId", "Saved connection chain");
  if (present(source.proxyProfileId))
    reference("proxyProfileId", "Saved proxy profile");
  else if (present(source.proxyChainId))
    reference("proxyChainId", "Saved proxy chain");
  if (present(source.tunnelProfileId))
    reference("tunnelProfileId", "Saved tunnel profile");
  else if (present(source.tunnelChainId))
    reference("tunnelChainId", "Saved tunnel chain");
  const security = object(source.security);
  const layers = Array.isArray(security.tunnelChain)
    ? security.tunnelChain
    : [];
  const inline =
    !present(source.tunnelProfileId) && !present(source.tunnelChainId);
  for (const [index, raw] of (inline ? layers.slice(0, 64) : []).entries()) {
    const layer = object(raw);
    if (layer.enabled !== true) continue;
    const label =
      typeof layer.type === "string"
        ? (kinds[layer.type] ?? "Tunnel")
        : "Tunnel";
    const linked = present(object(layer.sshTunnel).connectionId);
    add(
      `layer-${index}`,
      hopName(layer, connections) ?? label,
      present(layer.tunnelProfileId)
        ? "Saved tunnel profile; its hops and runtime health are not observed."
        : linked
          ? "Saved SSH connection; individual hop health is not observed."
          : "Configured hop; individual hop health is not observed.",
      `Configured ${label}`,
    );
  }
  if (inline && layers.length > 64)
    add(
      "more",
      "Additional saved hops",
      "Only the first 64 saved layers are shown.",
    );
  if (inline && !layers.length && object(security.openvpn).enabled === true)
    add(
      "vpn",
      "OpenVPN",
      "Configured VPN; its current connection is not observed.",
    );
  if (object(security.proxy).enabled === true)
    add(
      "proxy",
      "Proxy",
      "Configured proxy; individual hop health is not observed.",
    );
  if (object(security.sshTunnel).enabled === true)
    add(
      "ssh",
      hopName({ sshTunnel: security.sshTunnel }, connections) ?? "SSH tunnel",
      "Configured local forward; SSH endpoint health is not observed.",
      "Configured SSH tunnel",
    );
  return result;
}

/** Accept only the resolver's UI-safe summary, never its secret-bearing layers. */
export function summarizedOriginRouteHops(
  summary: NetworkPathSummary,
  connections: readonly Connection[] = [],
  target?: Connection,
): OriginConnectionHealth["hops"] {
  const hops: OriginConnectionHealth["hops"] = summary.layers
    .slice(0, 64)
    .map((layer, index) => ({
      key: `resolved-${index}`,
      label:
        hopName(
          object(
            (target?.id === layer.source.ownerConnectionId
              ? target
              : connections.find(
                  (row) => row.id === layer.source.ownerConnectionId,
                )
            )?.security?.tunnelChain?.find(
              (row) => row.id === layer.source.layerId,
            ),
          ),
          connections,
        ) ??
        kinds[layer.transport] ??
        (layer.kind === "ssh"
          ? "SSH connection"
          : layer.kind === "vpn"
            ? "VPN"
            : layer.kind === "proxy"
              ? "Proxy"
              : "Tunnel"),
      kind: `Configured ${kinds[layer.transport] ?? (layer.kind === "ssh" ? "SSH connection" : layer.kind === "proxy" ? "proxy" : layer.kind === "vpn" ? "VPN" : "tunnel")}`,
      status: "unknown",
      detail:
        "Saved route order, outermost to website. Individual hop health is not observed.",
    }));
  if (summary.status === "invalid" || summary.layers.length > 64)
    hops.push({
      key: "unresolved",
      label: "Unresolved route details",
      kind: "Configured route",
      status: "unknown",
      detail:
        "Some saved hops could not be expanded; this is a partial route, not confirmation of execution or complete hop order.",
    });
  return hops;
}

export function deriveOriginConnectionHealth(options: {
  connection?: Partial<Connection>;
  connections?: readonly Connection[];
  state: OriginBrowserState;
  observation?: NativeBrowserSessionDiagnostics | null;
  routeHops?: OriginConnectionHealth["hops"] | null;
  enabled: boolean;
}): OriginConnectionHealth {
  const { connection, state, enabled } = options;
  if (!enabled)
    return {
      visible: false,
      status: "unknown",
      label: "Health unknown",
      summary: "No current runtime health observation is available.",
      details: [["Browser", "Not observed"]],
      hops: [],
    };
  const configured = configuredOriginRouteHops(connection, options.connections);
  const snapshot = state.snapshot;
  const candidate = options.observation;
  const observation =
    enabled &&
    snapshot &&
    candidate &&
    candidate.identity.attemptId === snapshot.identity.attemptId &&
    candidate.identity.connectionId === snapshot.identity.connectionId &&
    candidate.identity.sessionId === snapshot.identity.sessionId
      ? candidate
      : null;
  const proxy = observation?.proxy;
  let status: OriginConnectionHealthStatus = "unknown";
  let label = "Health unknown";
  let summary =
    "No current runtime health observation is available for this route.";
  if (enabled) {
    if (
      ["closed", "closing", "failed"].includes(snapshot?.phase ?? "") ||
      ["closed", "closing", "failed"].includes(observation?.phase ?? "") ||
      ["error", "closed", "closing", "unavailable"].includes(state.phase) ||
      (proxy && proxy.state !== "listening")
    ) {
      status = "disconnected";
      label = "Disconnected";
      summary =
        "The browser attempt or its private proxy is unavailable. Individual tunnel failures may not be identified.";
    } else if (snapshot?.loadFailure || state.operationFailure) {
      status = "degraded";
      label = "Connection problem";
      summary =
        "The current browser attempt reported a failure. This does not identify which route hop failed.";
    } else if (
      state.phase === "starting" ||
      observation?.phase === "starting" ||
      snapshot?.phase === "starting" ||
      snapshot?.loading ||
      state.restart
    ) {
      status = "connecting";
      label = "Connecting";
      summary =
        "Browser setup or navigation is in progress. Saved route settings do not confirm that its hops have connected.";
    } else if (
      state.phase === "attached" &&
      snapshot?.phase === "attached" &&
      snapshot.documentLoaded === true &&
      proxy?.state === "listening" &&
      observation?.phase === "attached"
    ) {
      status = "healthy";
      label = "Last load succeeded";
      summary =
        "The last page load completed and the private proxy is listening. Tunnel reachability is not continuously probed.";
    }
  }
  const relayStatus: OriginConnectionHealthStatus = !proxy
    ? "unknown"
    : proxy.state === "listening"
      ? "healthy"
      : "disconnected";
  const details: [string, string][] = [
    ...browserConnectionDiagnosticFacts(connection).filter(([name]) =>
      [
        "Saved connection type",
        "Browser application",
        "Saved route references",
      ].includes(name),
    ),
    ["Browser", enabled ? state.phase : "Not observed"],
    ["Private proxy", proxy?.state ?? "Not observed"],
    [
      "Last page load",
      enabled && snapshot?.documentLoaded === true
        ? "Completed"
        : "Not confirmed",
    ],
    [
      "Hop health",
      "Individual tunnel and SSH connections are not continuously probed.",
    ],
  ];
  if (proxy)
    details.push(
      ["Upstream failures this attempt", String(proxy.upstreamFailures)],
      ["Destination denials this attempt", String(proxy.destinationDenials)],
    );
  const runtimeHops =
    enabled &&
    observation?.routeHealth &&
    (observation.routeHealth.hops.length || observation.routeHealth.truncated)
      ? observedSessionRouteHops(observation.routeHealth)
      : null;
  const runtimeHasRelay =
    !!runtimeHops &&
    observation?.routeHealth?.hops.some((hop) => hop.kind === "private-relay");
  if (
    runtimeHops?.some(
      (hop) => hop.status === "degraded" || hop.status === "disconnected",
    ) &&
    status === "healthy"
  ) {
    status = "degraded";
    label = "Route component needs attention";
    summary =
      "The last document loaded, but a current route component reports a failure. Review its stage evidence below.";
  }
  return {
    visible: configured.length > 0,
    status,
    label,
    summary,
    details,
    hops: [
      ...(!runtimeHasRelay
        ? [
            {
              key: "private-proxy",
              label: "Private proxy",
              kind: "Runtime observation",
              status: relayStatus,
              detail: proxy
                ? proxy.state === "listening"
                  ? "Listener is running; this alone does not confirm upstream connectivity."
                  : "The proxy listener is unavailable."
                : "No current proxy observation.",
            },
          ]
        : []),
      ...(runtimeHops ??
        (options.routeHops?.length ? options.routeHops : configured)),
      {
        key: "website",
        label: "Website",
        kind: "Last document load",
        status:
          enabled && snapshot?.loadFailure
            ? "degraded"
            : enabled && snapshot?.phase === "attached" && snapshot.loading
              ? "connecting"
              : enabled &&
                  snapshot?.phase === "attached" &&
                  snapshot?.documentLoaded
                ? "healthy"
                : "unknown",
        detail:
          enabled && snapshot?.loadFailure
            ? "The current document request failed."
            : enabled && snapshot?.documentLoaded
              ? "The last main document load completed; login and application readiness are separate."
              : "No completed document load is confirmed.",
      },
    ],
  };
}
