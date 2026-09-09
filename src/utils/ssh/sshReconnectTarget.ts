import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

export interface SSHReconnectReference {
  connectionId?: string;
  sessionId: string;
  hostname: string;
}

export type SSHReconnectTarget =
  | { connection: Connection; reason?: never }
  | { connection?: never; reason: string };

/** IDs are identity evidence, not display strings: never trim or truncate them. */
export function isSSHReconnectConnectionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  );
}

const hostKey = (hostname: string) => hostname.trim().toLowerCase();

/** Build once per saved-connection/session change, not once per history row. */
export function createSSHReconnectResolver(
  connections: readonly Connection[],
  sessions: readonly ConnectionSession[],
): (reference: SSHReconnectReference) => SSHReconnectTarget {
  const byId = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const byHost = new Map<string, Connection[]>();
  for (const connection of connections) {
    if (connection.protocol !== "ssh" || connection.isGroup) continue;
    const host = hostKey(connection.hostname);
    if (!host) continue;
    const candidates = byHost.get(host) ?? [];
    candidates.push(connection);
    byHost.set(host, candidates);
  }
  const bySession = new Map<string, Set<string>>();
  for (const session of sessions) {
    if (session.protocol !== "ssh") continue;
    for (const id of [session.id, session.backendSessionId]) {
      if (!id) continue;
      const targets = bySession.get(id) ?? new Set<string>();
      targets.add(session.connectionId);
      bySession.set(id, targets);
    }
  }
  const savedTarget = (id: string): SSHReconnectTarget => {
    const connection = byId.get(id);
    return connection?.protocol === "ssh" && !connection.isGroup
      ? { connection }
      : {
          reason:
            "The original saved SSH connection is unavailable or was deleted.",
        };
  };
  return (reference) => {
    if (reference.connectionId !== undefined) {
      return isSSHReconnectConnectionId(reference.connectionId)
        ? savedTarget(reference.connectionId)
        : { reason: "This record has an invalid saved connection identity." };
    }
    const targets = bySession.get(reference.sessionId);
    if (targets) {
      if (targets.size !== 1)
        return {
          reason: "This session maps to more than one saved connection.",
        };
      return savedTarget([...targets][0]);
    }
    const candidates = byHost.get(hostKey(reference.hostname)) ?? [];
    if (candidates.length === 1) return { connection: candidates[0] };
    return {
      reason:
        candidates.length > 1
          ? "Multiple saved SSH connections use this host. Choose the intended connection from the connection tree."
          : "No saved SSH connection matches this historical host.",
    };
  };
}
