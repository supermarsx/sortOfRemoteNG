/**
 * Orphaned live sessions: backend sessions that no open tab owns and that no
 * other window currently claims. The Session Manager offers Adopt (when a
 * saved connection can be resolved unambiguously) and Close for them.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "../../types/connection/connection";
import {
  reconcileWorkspace,
  type LiveSessionDescriptor,
} from "./reconcileWorkspace";

interface TabLike {
  id: string;
  protocol: string;
  backendSessionId?: string;
}

/** Orphans per `reconcileWorkspace`, minus sessions another window claims. */
export function computeOrphanedLiveSessions(
  sessions: readonly TabLike[],
  live: readonly LiveSessionDescriptor[],
): LiveSessionDescriptor[] {
  const { orphans } = reconcileWorkspace({
    tabs: sessions
      .filter((session) => session.backendSessionId)
      .map((session, order) => ({
        tabId: session.id,
        protocol: session.protocol,
        backendSessionId: session.backendSessionId,
        order,
      })),
    live,
    options: { reconnectOnReload: false },
  });
  return orphans.filter((descriptor) => descriptor.orphan?.claimed !== true);
}

const CLOSE_COMMANDS: Readonly<Record<string, string>> = {
  ssh: "disconnect_ssh",
  rdp: "disconnect_rdp",
  vnc: "disconnect_vnc",
  telnet: "disconnect_telnet",
  serial: "serial_disconnect",
};

/** Close an orphan through its protocol's normal disconnect path. */
export async function closeOrphanedLiveSession(
  descriptor: LiveSessionDescriptor,
): Promise<void> {
  const command = CLOSE_COMMANDS[descriptor.protocol];
  if (!command) {
    throw new Error(`Cannot close a ${descriptor.protocol} session.`);
  }
  await invoke(command, { sessionId: descriptor.backendSessionId });
}

/**
 * The saved connection an orphan can be re-attached to: the connection id the
 * backend recorded (RDP), otherwise a UNIQUE protocol+host(+port) match.
 * Ambiguous or missing matches return null (Adopt is then not offered); a
 * session is never bound to a connection by guesswork.
 */
export function resolveOrphanConnection(
  descriptor: LiveSessionDescriptor,
  connections: readonly Connection[],
): Connection | null {
  if (descriptor.connectionId) {
    const byId = connections.find(
      (connection) =>
        connection.id === descriptor.connectionId &&
        connection.protocol === descriptor.protocol,
    );
    if (byId) return byId;
  }
  if (!descriptor.host) return null;
  const host = descriptor.host.toLocaleLowerCase();
  const matches = connections.filter(
    (connection) =>
      !connection.isGroup &&
      connection.protocol === descriptor.protocol &&
      (connection.hostname ?? "").toLocaleLowerCase() === host &&
      (descriptor.port === undefined ||
        connection.port === undefined ||
        connection.port === descriptor.port),
  );
  return matches.length === 1 ? matches[0] : null;
}
