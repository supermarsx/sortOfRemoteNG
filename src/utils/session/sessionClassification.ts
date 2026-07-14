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
