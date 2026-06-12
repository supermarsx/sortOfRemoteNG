import { useMemo } from "react";
import { Connection } from "../../types/connection/connection";
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
 * Combines the two siloed session surfaces — the RDP session manager
 * (`useRDPSessionPanel`) and the internal HTTP/HTTPS proxy manager
 * (`useInternalProxyManager`) — into one normalized list of sessions, each
 * tagged with its `kind`. Both source hooks keep their own live-update loops
 * (3s auto-refresh each) and their full action surfaces; this hook only
 * projects their state into a shared row shape and re-exports their handlers so
 * the unified panel can dispatch back to the owning source.
 *
 * It does NOT introduce a second store or re-plumb either protocol — it is a
 * read-mostly aggregator. RDP actions route to the RDP source, proxy actions to
 * the proxy source.
 */

export type SessionKind = "rdp" | "http-proxy";

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
  /** Source-native id (RDP session id | proxy session_id). */
  nativeId: string;
  /** Human label (connection name / target host / target url). */
  title: string;
  /** Secondary target descriptor (host:port / username / url). */
  subtitle: string;
  status: UnifiedSessionStatus;
  /** Optional saved-connection link (RDP only today). */
  connectionId?: string;
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

export function useUnifiedSessionManager({
  isVisible,
  connections,
  activeBackendSessionIds = [],
  thumbnailsEnabled = true,
  thumbnailPolicy = "realtime",
  thumbnailInterval = 5,
}: UseUnifiedSessionManagerParams) {
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

  // ── Project RDP sessions into unified rows ──
  const rdpRows = useMemo<UnifiedSessionRow[]>(() => {
    return rdp.sessions.map((s) => {
      const display = rdp.getSessionDisplayName(s);
      const isDetached = rdp.isSessionDetached(s);
      const status: UnifiedSessionStatus = !s.connected
        ? "disconnected"
        : isDetached
          ? "detached"
          : "connected";
      return {
        uid: `rdp:${s.id}`,
        kind: "rdp" as const,
        nativeId: s.id,
        title: display.name,
        subtitle: display.subtitle,
        status,
        connectionId: s.connection_id,
        rdpStats: rdp.statsMap[s.id],
        detached: isDetached,
        rdpSession: s,
      };
    });
  }, [rdp.sessions, rdp.statsMap, rdp.getSessionDisplayName, rdp.isSessionDetached]);

  // ── Project proxy sessions into unified rows ──
  const proxyRows = useMemo<UnifiedSessionRow[]>(() => {
    return proxy.sessions.map((s) => ({
      uid: `http-proxy:${s.session_id}`,
      kind: "http-proxy" as const,
      nativeId: s.session_id,
      title: s.target_url,
      subtitle: s.username ? `(${s.username})` : s.proxy_url,
      status: proxyStatus(s),
      proxySession: s,
    }));
  }, [proxy.sessions]);

  const allRows = useMemo(
    () => [...rdpRows, ...proxyRows],
    [rdpRows, proxyRows],
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
    isLoading,
    error: combinedError,
    clearError,
    handleRefresh,
    // Live source handles (full action surfaces preserved)
    rdp,
    proxy,
  };
}
