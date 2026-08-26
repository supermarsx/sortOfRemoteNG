/**
 * sessionClassification — single source of truth for the question
 * "is this tab a real remote session, an internal tool, or a
 * Windows management panel?".
 *
 * `ConnectionSession` is a misnomer in the codebase: the same type
 * represents three semantically different things, distinguished
 * only by the protocol prefix:
 *
 *   - real connections        — protocol is "ssh" / "rdp" / "vnc"
 *                               / "http" / "https" / "telnet" /
 *                               "rlogin" / "winrm" / etc.
 *   - tool tabs               — protocol starts with "tool:"
 *                               (e.g. "tool:settings", "tool:wol")
 *   - Windows management tabs — protocol starts with "winmgmt:"
 *                               (e.g. "winmgmt:services")
 *   - integration panels      — protocol starts with "integration:"
 *                               (e.g. "integration:netbox")
 *
 * Tools and winmgmt panels live in the same tab strip and the same
 * tiling grid as real sessions — they're legitimate first-class
 * tabs — but they should not be counted toward "active sessions"
 * for purposes of the toolbar counter, `maxConcurrentConnections`,
 * `singleConnectionMode`, reconnect-on-reload, or the
 * warn-on-close prompt. Those settings all talk about *real
 * connections*; bundling tools into the count both inflates the
 * number and confuses the limits ("you've hit 10 concurrent
 * connections" when actually 7 of them are the Settings tab and
 * a few wizard editors).
 *
 * Centralising the classification here means future tabs (audit
 * panels, log viewers, dashboards) only need to register their
 * protocol prefix once.
 */

import type { ConnectionSession } from "../../types/connection/connection";
import { INTEGRATION_PROTOCOL_PREFIX } from "../../types/connection/connection";
import { TOOL_PROTOCOL_PREFIX } from "../../components/app/toolSession";
import { WINMGMT_PROTOCOL_PREFIX } from "../../components/windows/WindowsToolPanel.helpers";

export type TabKind = "connection" | "tool" | "winmgmt" | "integration";

/**
 * Classify a single session by its protocol prefix. Unknown
 * protocols and empty strings default to `'connection'` — the
 * caller almost always wants those treated as a real connection
 * (an unknown protocol is more likely a custom remote handler than
 * an internal tool).
 */
export function classifyTabKind(session: { protocol?: string }): TabKind {
  const protocol = session.protocol ?? "";
  if (protocol.startsWith(TOOL_PROTOCOL_PREFIX)) return "tool";
  if (protocol.startsWith(WINMGMT_PROTOCOL_PREFIX)) return "winmgmt";
  if (protocol.startsWith(INTEGRATION_PROTOCOL_PREFIX)) return "integration";
  return "connection";
}

/**
 * True iff the session represents a real remote connection
 * (i.e. neither a tool tab nor a Windows management panel).
 *
 * This is the common predicate — most callers just need the
 * yes/no, not the full classification.
 */
export function isRealConnectionSession(session: {
  protocol?: string;
}): boolean {
  return classifyTabKind(session) === "connection";
}

export function isToolTabSession(session: { protocol?: string }): boolean {
  return classifyTabKind(session) === "tool";
}

export function isWinmgmtTabSession(session: { protocol?: string }): boolean {
  return classifyTabKind(session) === "winmgmt";
}

export function isIntegrationTabSession(session: {
  protocol?: string;
}): boolean {
  return classifyTabKind(session) === "integration";
}

/**
 * Minimal shape needed to decide whether a session ever reached a live
 * transport. Kept structural so tests and persistence helpers can pass
 * partial rows.
 */
export interface LiveTransportProbe {
  status?: ConnectionSession["status"];
  vpnLeaseBindings?: ReadonlyArray<{ status?: string }>;
}

/**
 * True iff the session has no live remote transport: it is still
 * `connecting` (the attempt never completed) or ended in `error`, AND
 * none of its VPN lease bindings is `active`.
 *
 * Closing such a tab must always succeed — there is nothing to lose, so
 * no "close?" confirmation, no RDP detach-into-background and no
 * fail-closed backend cleanup applies. The single exception is an
 * *active* VPN binding: that means a route is up, and the normal
 * fail-closed cleanup rule must still apply (see `handleSessionClose`).
 *
 * `connected`, `reconnecting` and `disconnected` (i.e. was live once)
 * sessions are never "no live transport" here.
 */
export function hasNoLiveTransport(session: LiveTransportProbe): boolean {
  const status = session.status;
  if (status !== "error" && status !== "connecting") return false;
  const bindings = session.vpnLeaseBindings ?? [];
  return !bindings.some((binding) => binding.status === "active");
}

/**
 * Minimal shape `isRestorableConnectionSession` inspects. Protocol is the
 * classifier; the remaining fields decide whether an `error` row still
 * carries VPN-cleanup evidence that must survive a reload.
 */
export interface RestorableSessionProbe extends LiveTransportProbe {
  protocol?: string;
  layout?: { isDetached?: boolean };
  vpnLeaseOwnerIds?: ReadonlyArray<string>;
  vpnLeaseReleaseTombstones?: ReadonlyArray<unknown>;
  vpnLeaseCleanupQuarantine?: {
    proofs?: ReadonlyArray<unknown>;
    proofIncomplete?: boolean;
  };
}

function hasVpnRecoveryEvidence(session: RestorableSessionProbe): boolean {
  return (
    (session.vpnLeaseBindings?.length ?? 0) > 0 ||
    (session.vpnLeaseOwnerIds?.length ?? 0) > 0 ||
    (session.vpnLeaseReleaseTombstones?.length ?? 0) > 0 ||
    (session.vpnLeaseCleanupQuarantine?.proofs?.length ?? 0) > 0 ||
    session.vpnLeaseCleanupQuarantine?.proofIncomplete === true
  );
}

/**
 * Sessions worth reconstructing after an application reload. Integration tabs
 * are not counted as live remote transports, but their selected instance and
 * panel state must be restored so the user can explicitly reconnect.
 *
 * Excluded even when the protocol qualifies:
 *   - detached "ghost" rows that never had a live transport (a failed RDP
 *     attempt that an older build detached instead of closing) — restoring
 *     them resurrects a failed tab the user already closed;
 *   - `error` rows with no VPN-cleanup evidence (no bindings, owners,
 *     tombstones or quarantine) — a plain failed attempt has nothing to
 *     recover. Rows that *do* carry evidence keep persisting so the
 *     fail-closed cleanup can be retried after reload.
 */
export function isRestorableConnectionSession(
  session: RestorableSessionProbe,
): boolean {
  const kind = classifyTabKind(session);
  if (kind !== "connection" && kind !== "integration") return false;
  if (session.layout?.isDetached && hasNoLiveTransport(session)) return false;
  if (session.status === "error" && !hasVpnRecoveryEvidence(session)) {
    return false;
  }
  return true;
}

export interface PartitionedSessions<
  S extends { protocol?: string } = ConnectionSession,
> {
  /** Real remote connections (ssh, rdp, http, ...). */
  connections: S[];
  /** Internal tool tabs (`tool:*`). */
  tools: S[];
  /** Windows management panels (`winmgmt:*`). */
  winmgmt: S[];
  /** Integration panels (`integration:*`). */
  integrations: S[];
}

/**
 * Bucket a list of sessions by classification. Iterates once;
 * preserves relative order within each bucket so callers can use
 * the partition for both counts and ordered rendering.
 */
export function partitionSessions<S extends { protocol?: string }>(
  sessions: S[],
): PartitionedSessions<S> {
  const connections: S[] = [];
  const tools: S[] = [];
  const winmgmt: S[] = [];
  const integrations: S[] = [];
  for (const s of sessions) {
    switch (classifyTabKind(s)) {
      case "connection":
        connections.push(s);
        break;
      case "tool":
        tools.push(s);
        break;
      case "winmgmt":
        winmgmt.push(s);
        break;
      case "integration":
        integrations.push(s);
        break;
    }
  }
  return { connections, tools, winmgmt, integrations };
}

/**
 * Count real connections in a list of sessions. Convenience
 * around `partitionSessions` for the common case where you only
 * need the number, not the partition.
 */
export function realConnectionCount(
  sessions: Array<{ protocol?: string }>,
): number {
  let n = 0;
  for (const s of sessions) {
    if (isRealConnectionSession(s)) n++;
  }
  return n;
}
