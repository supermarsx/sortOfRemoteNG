import { useMemo } from "react";
import {
  Connection,
  ConnectionSession,
  INTEGRATION_PROTOCOL_PREFIX,
  isIntegrationConnectionProtocol,
} from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import {
  partitionSessions,
  type TabKind,
} from "../../utils/session/sessionClassification";
import {
  useRDPSessionPanel,
  RDPSessionInfo,
  RDPStats,
} from "../rdp/useRdpSessionPanel";
import {
  useInternalProxyManager,
  ProxySessionDetail,
} from "../network/useInternalProxyManager";

/**
 * Unified Session Manager aggregation hook.
 *
 * Combines the session surfaces into one normalized list of sessions, each
 * tagged with its `kind`. Backend-owned RDP and internal HTTP/HTTPS proxy
 * rows keep their source hooks and action surfaces. Frontend tab sessions are
 * projected from ConnectionContext state.sessions so the manager can also see
 * SSH, web, VNC, SFTP, WinRM, remote-control, tool, and winmgmt tabs.
 *
 * It does NOT introduce a second store or re-plumb either protocol — it is a
 * read-mostly aggregator. RDP actions route to the RDP source, proxy actions to
 * the proxy source, and frontend rows carry their ConnectionSession for callers
 * that own generic tab actions.
 */

export type SourceSessionKind = "rdp" | "http-proxy";

export type FrontendSessionKind =
  | "ssh"
  | "http"
  | "https"
  | "vnc"
  | "anydesk"
  | "rustdesk"
  | "sftp"
  | "telnet"
  | "rlogin"
  | "winrm"
  | "tool"
  | "winmgmt"
  | "integration"
  | (string & {});

export type SessionKind = SourceSessionKind | (string & {});

export type UnifiedSessionSource = "rdp" | "http-proxy" | "frontend";

export type UnifiedSessionBucket = "rdp" | "proxy" | TabKind;

/** Normalized status across both sources. */
export type UnifiedSessionStatus =
  | "connected"
  | "disconnected"
  | "detached"
  | "error"
  | "waiting";

export interface UnifiedSessionRow {
  /** Stable cross-source id: `${kind}:${nativeId}`. */
  uid: string;
  kind: SessionKind;
  /** Owning data source for actions and refresh behavior. */
  source: UnifiedSessionSource;
  /** Coarse bucket for grouping: backend RDP/proxy or frontend tab kind. */
  bucket: UnifiedSessionBucket;
  /** Display label for the kind/group (for example SSH, HTTPS, Tools). */
  kindLabel: string;
  /** Stable group key for consumers that render protocol buckets. */
  groupKey: string;
  /** Human group label matching groupKey. */
  groupLabel: string;
  /** Source-native id (RDP session id | proxy session_id). */
  nativeId: string;
  /** Human label (connection name / target host / target url). */
  title: string;
  /** Secondary target descriptor (host:port / username / url). */
  subtitle: string;
  status: UnifiedSessionStatus;
  /** Optional saved-connection link. */
  connectionId?: string;
  /** Frontend protocol string, including tool:/winmgmt: prefixes when present. */
  protocol?: string;
  hostname?: string;
  username?: string;
  startedAt?: Date;
  lastActivity?: Date;
  errorMessage?: string;
  metrics?: ConnectionSession["metrics"];
  /** Frontend ConnectionContext tab/session row. */
  frontendSession?: ConnectionSession;
  /** RDP-only: live stats for the session. */
  rdpStats?: RDPStats;
  /** RDP-only: whether the viewer is detached. */
  detached?: boolean;
  /** RDP-only: raw session info (for detach / reattach call paths). */
  rdpSession?: RDPSessionInfo;
  /** Proxy-only: raw proxy session detail. */
  proxySession?: ProxySessionDetail;
}

export interface UseUnifiedSessionManagerParams {
  isVisible: boolean;
  connections: Connection[];
  /** Active RDP backend session ids that still own a frontend viewer. */
  activeBackendSessionIds?: string[];
  thumbnailsEnabled?: boolean;
  thumbnailPolicy?: "realtime" | "on-blur" | "on-detach" | "manual";
  thumbnailInterval?: number;
}

/** Classify a proxy session's normalized status. */
function proxyStatus(s: ProxySessionDetail): UnifiedSessionStatus {
  if (s.error_count > 0) return "error";
  if (s.request_count === 0) return "waiting";
  return "connected";
}

const PROTOCOL_LABELS: Record<string, string> = {
  anydesk: "AnyDesk",
  http: "HTTP",
  https: "HTTPS",
  rdp: "RDP",
  rlogin: "RLogin",
  rustdesk: "RustDesk",
  sftp: "SFTP",
  ssh: "SSH",
  telnet: "Telnet",
  vnc: "VNC",
  winrm: "WinRM",
};

function humanizeIntegrationKey(key: string): string {
  return key
    .split(/[-_:]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function protocolLabel(protocol: string): string {
  const normalized = protocol.toLowerCase();
  if (isIntegrationConnectionProtocol(normalized)) {
    return humanizeIntegrationKey(
      normalized.slice(INTEGRATION_PROTOCOL_PREFIX.length),
    );
  }
  return PROTOCOL_LABELS[normalized] ?? normalized.toUpperCase();
}

function frontendStatus(session: ConnectionSession): UnifiedSessionStatus {
  if (session.status === "error") return "error";
  if (session.status === "disconnected") return "disconnected";
  if (session.layout?.isDetached && session.status === "connected") {
    return "detached";
  }
  if (session.status === "connected") return "connected";
  return "waiting";
}

function frontendKind(
  session: ConnectionSession,
  tabKind: TabKind,
): SessionKind {
  if (tabKind === "tool") return "tool";
  if (tabKind === "winmgmt") return "winmgmt";
  if (tabKind === "integration") return session.protocol.toLowerCase();
  return (session.protocol || "connection").toLowerCase();
}

function frontendKindLabel(
  session: ConnectionSession,
  tabKind: TabKind,
  connection?: Connection,
): string {
  if (tabKind === "tool") return "Tools";
  if (tabKind === "winmgmt") return "Windows Management";
  if (tabKind === "integration") {
    return (
      connection?.integration?.descriptorLabel ||
      connection?.integration?.instanceName ||
      protocolLabel(session.protocol || "integration")
    );
  }
  return protocolLabel(session.protocol || "connection");
}

function frontendSubtitle(
  session: ConnectionSession,
  connection?: Connection,
): string {
  const host = session.hostname || connection?.hostname || "";
  const port = connection?.port;
  const username =
    connection?.username || connection?.basicAuthUsername || connection?.domain;

  const target = host && port ? `${host}:${port}` : host;
  if (username && target) return `${username}@${target}`;
  if (target) return target;
  if (connection?.name && connection.name !== session.name) {
    return connection.name;
  }
  return session.protocol;
}

function projectFrontendSession(
  session: ConnectionSession,
  tabKind: TabKind,
  connection?: Connection,
): UnifiedSessionRow {
  const kind = frontendKind(session, tabKind);
  const groupLabel = frontendKindLabel(session, tabKind, connection);
  return {
    uid: `${kind}:${session.id}`,
    kind,
    source: "frontend",
    bucket: tabKind,
    kindLabel: groupLabel,
    groupKey: String(kind),
    groupLabel,
    nativeId: session.id,
    title: session.name || connection?.name || groupLabel,
    subtitle: frontendSubtitle(session, connection),
    status: frontendStatus(session),
    connectionId: session.connectionId,
    protocol: session.protocol,
    hostname: session.hostname || connection?.hostname,
    username: connection?.username || connection?.basicAuthUsername,
    startedAt: session.startTime,
    lastActivity: session.lastActivity,
    errorMessage: session.errorMessage,
    metrics: session.metrics,
    detached: session.layout?.isDetached,
    frontendSession: session,
  };
}

export function useUnifiedSessionManager({
  isVisible,
  connections,
  activeBackendSessionIds = [],
  thumbnailsEnabled = true,
  thumbnailPolicy = "realtime",
  thumbnailInterval = 5,
}: UseUnifiedSessionManagerParams) {
  const { state } = useConnections();

  // ── Source 1: RDP sessions (rich panel hook — keeps all RDP actions) ──
  const rdp = useRDPSessionPanel({
    isVisible,
    connections,
    activeBackendSessionIds,
    thumbnailsEnabled,
    thumbnailPolicy,
    thumbnailInterval,
  });

  // ── Source 2: internal HTTP/HTTPS proxy sessions ──
  const proxy = useInternalProxyManager(isVisible);
  const {
    sessions: rdpSessions,
    statsMap: rdpStatsMap,
    getSessionDisplayName,
    isSessionDetached,
  } = rdp;

  const connectionsById = useMemo(() => {
    return new Map(
      connections.map((connection) => [connection.id, connection]),
    );
  }, [connections]);

  const sessionPartition = useMemo(
    () => partitionSessions(state.sessions),
    [state.sessions],
  );

  // ── Project RDP sessions into unified rows ──
  const rdpRows = useMemo<UnifiedSessionRow[]>(() => {
    return rdpSessions.map((s) => {
      const display = getSessionDisplayName(s);
      const isDetached = isSessionDetached(s);
      const status: UnifiedSessionStatus = !s.connected
        ? "disconnected"
        : isDetached
          ? "detached"
          : "connected";
      return {
        uid: `rdp:${s.id}`,
        kind: "rdp" as const,
        source: "rdp" as const,
        bucket: "rdp" as const,
        kindLabel: "RDP",
        groupKey: "rdp",
        groupLabel: "RDP",
        nativeId: s.id,
        title: display.name,
        subtitle: display.subtitle,
        status,
        connectionId: s.connection_id,
        protocol: "rdp",
        hostname: s.host,
        username: s.username,
        rdpStats: rdpStatsMap[s.id],
        detached: isDetached,
        rdpSession: s,
      };
    });
  }, [rdpSessions, rdpStatsMap, getSessionDisplayName, isSessionDetached]);

  // ── Project proxy sessions into unified rows ──
  const proxyRows = useMemo<UnifiedSessionRow[]>(() => {
    return proxy.sessions.map((s) => ({
      uid: `http-proxy:${s.session_id}`,
      kind: "http-proxy" as const,
      source: "http-proxy" as const,
      bucket: "proxy" as const,
      kindLabel: "HTTP / HTTPS Proxy",
      groupKey: "http-proxy",
      groupLabel: "HTTP / HTTPS Proxy",
      nativeId: s.session_id,
      title: s.target_url,
      subtitle: s.username ? `(${s.username})` : s.proxy_url,
      status: proxyStatus(s),
      protocol: "http-proxy",
      username: s.username,
      proxySession: s,
    }));
  }, [proxy.sessions]);

  // ── Project frontend ConnectionContext sessions into unified rows ──
  const frontendConnectionRows = useMemo<UnifiedSessionRow[]>(() => {
    return sessionPartition.connections
      .filter((session) => session.protocol !== "rdp")
      .map((session) =>
        projectFrontendSession(
          session,
          "connection",
          connectionsById.get(session.connectionId),
        ),
      );
  }, [sessionPartition.connections, connectionsById]);

  const toolRows = useMemo<UnifiedSessionRow[]>(() => {
    return sessionPartition.tools.map((session) =>
      projectFrontendSession(
        session,
        "tool",
        connectionsById.get(session.connectionId),
      ),
    );
  }, [sessionPartition.tools, connectionsById]);

  const winmgmtRows = useMemo<UnifiedSessionRow[]>(() => {
    return sessionPartition.winmgmt.map((session) =>
      projectFrontendSession(
        session,
        "winmgmt",
        connectionsById.get(session.connectionId),
      ),
    );
  }, [sessionPartition.winmgmt, connectionsById]);

  const integrationRows = useMemo<UnifiedSessionRow[]>(() => {
    return sessionPartition.integrations.map((session) =>
      projectFrontendSession(
        session,
        "integration",
        connectionsById.get(session.connectionId),
      ),
    );
  }, [sessionPartition.integrations, connectionsById]);

  const frontendRows = useMemo(
    () => [
      ...frontendConnectionRows,
      ...toolRows,
      ...winmgmtRows,
      ...integrationRows,
    ],
    [frontendConnectionRows, toolRows, winmgmtRows, integrationRows],
  );

  const allRows = useMemo(
    () => [...rdpRows, ...proxyRows, ...frontendRows],
    [rdpRows, proxyRows, frontendRows],
  );

  const isLoading = rdp.isLoading || proxy.isLoading;
  const combinedError = rdp.error || proxy.error;

  /** Refresh both sources. */
  const handleRefresh = () => {
    rdp.handleRefresh();
    proxy.handleRefresh();
  };

  /** Clear errors on both sources. */
  const clearError = () => {
    rdp.setError("");
    proxy.setError("");
  };

  return {
    // Aggregated view
    rows: allRows,
    rdpRows,
    proxyRows,
    frontendRows,
    frontendConnectionRows,
    toolRows,
    winmgmtRows,
    integrationRows,
    isLoading,
    error: combinedError,
    clearError,
    handleRefresh,
    // Live source handles (full action surfaces preserved)
    rdp,
    proxy,
  };
}
