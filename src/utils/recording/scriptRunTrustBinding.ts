import type { DatabaseAvailability } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import {
  digestConnectionEndpoint,
  isScriptTrustId,
  type ScriptTrustConnectionBinding,
} from "./scriptRunTrust";

/**
 * What "on this connection" means for a trusted script: the saved row the
 * session was opened from, in the database that is open and readable in this
 * window, as that row is now. When any part of that cannot be shown the
 * binding is null: the connection choice is not offered and connection trust
 * is not applied.
 */

/** The parts of the connection context the binding reads. The context itself fits. */
export interface ScriptTrustBindingContext {
  state: { connections: readonly Connection[] };
  databaseAvailability?: DatabaseAvailability;
  getCurrentConnections?: (scope: {
    databaseId: string;
    generation: number;
  }) => readonly Connection[];
}

/** The parts of a session the binding reads. A `ConnectionSession` fits. */
export interface ScriptTrustBindingSession {
  connectionId: string;
  protocol: string;
  hostname: string;
  ownerDatabaseId?: string;
}

/** The host a session is opened to, as the session manager derives it. */
const hostOf = (row: Connection): string =>
  row.integration?.host || row.hostname;

/**
 * The one saved SSH row with this id in the ready database, or null. Only
 * saved rows count: the registry of unsaved runtime connections is never read.
 */
const savedRow = (
  context: ScriptTrustBindingContext,
  databaseId: string,
  connectionId: string,
): Connection | null => {
  const available = context.databaseAvailability;
  if (
    !available ||
    available.status !== "ready" ||
    !isScriptTrustId(databaseId) ||
    available.databaseId !== databaseId ||
    !isScriptTrustId(connectionId)
  )
    return null;
  const rows = context.getCurrentConnections
    ? context.getCurrentConnections({
        databaseId,
        generation: available.generation,
      })
    : context.state.connections;
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter((row) => row?.id === connectionId);
  if (matches.length !== 1) return null;
  const row = matches[0];
  return row.isGroup || row.protocol !== "ssh" ? null : row;
};

const bind = async (
  databaseId: string,
  row: Connection,
): Promise<ScriptTrustConnectionBinding | null> => {
  const host = hostOf(row);
  if (
    typeof host !== "string" ||
    !host ||
    typeof row.port !== "number" ||
    !Number.isFinite(row.port)
  )
    return null;
  const credential = row.credentialSource;
  return {
    databaseId,
    connectionId: row.id,
    endpointDigest: await digestConnectionEndpoint({
      databaseId,
      connectionId: row.id,
      protocol: row.protocol,
      host,
      port: row.port,
      username: row.username,
      domain: row.domain,
      credentialKind: credential?.kind,
      credentialId:
        credential?.kind === "vault" ? credential.credentialId : null,
    }),
  };
};

/**
 * The binding of a saved connection as it is now, for lists that compare it
 * with a recorded one. Null when the row cannot be verified in this window.
 */
export async function resolveSavedConnectionTrustBinding(
  context: ScriptTrustBindingContext,
  reference: { databaseId: string; connectionId: string },
): Promise<ScriptTrustConnectionBinding | null> {
  try {
    const row = savedRow(context, reference.databaseId, reference.connectionId);
    return row ? await bind(reference.databaseId, row) : null;
  } catch {
    return null;
  }
}

/**
 * The binding for a run in `session`, or null. It exists only when the
 * session is SSH and has an owning database, that database is the ready one
 * here, the saved row is in it, and the session was opened to the host the
 * row names now. A renamed, moved or recoloured row gives the same binding;
 * another host, port, user, domain or credential reference gives another.
 */
export async function resolveScriptTrustBinding(
  context: ScriptTrustBindingContext,
  session: ScriptTrustBindingSession,
): Promise<ScriptTrustConnectionBinding | null> {
  try {
    if (session.protocol !== "ssh" || !session.ownerDatabaseId) return null;
    const row = savedRow(
      context,
      session.ownerDatabaseId,
      session.connectionId,
    );
    if (!row || session.hostname !== hostOf(row)) return null;
    return await bind(session.ownerDatabaseId, row);
  } catch {
    return null;
  }
}
