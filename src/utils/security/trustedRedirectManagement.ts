import type { Connection } from "../../types/connection/connection";
import type { HttpTrustedRedirectDestinations } from "../../types/connection/httpTrustedRedirectDestinations";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { httpRedirectTrustIdentity } from "../protocol/httpRedirectTrustIdentity";
import { normalizeHttpTrustedRedirectDestinations } from "../protocol/httpTrustedRedirectDestinations";

export const MAX_TRUSTED_REDIRECT_BATCH_CONNECTIONS = 128;
export const TRUSTED_REDIRECT_STALE =
  "Saved redirect preferences changed. Refresh this list and review the selection again.";
export interface TrustedRedirectChange {
  /** Renderer-local expected source. Never exported or sent to native IPC. */
  expected: Connection;
  destinations: HttpTrustedRedirectDestinations;
}
export function isRedirectConnection(connection: Connection): boolean {
  return (
    !connection.isGroup &&
    (connection.protocol === "http" || connection.protocol === "https")
  );
}
/** Private identity contains credentials; never log it or expose as a row key. */
export function trustedRedirectSourceIdentity(connection: Connection): string {
  if (!isRedirectConnection(connection))
    throw new Error(TRUSTED_REDIRECT_STALE);
  return stableJsonStringify([
    httpRedirectTrustIdentity(connection),
    normalizeHttpTrustedRedirectDestinations(
      connection.httpTrustedRedirectDestinations,
    ),
  ]);
}

/** Validate every target before changing any field. Merge into latest rows,
 * never replace the full connection collection or unrelated source fields. */
export function applyTrustedRedirectChanges(
  connections: readonly Connection[],
  changes: readonly TrustedRedirectChange[],
): Connection[] {
  if (
    !changes.length ||
    changes.length > MAX_TRUSTED_REDIRECT_BATCH_CONNECTIONS
  )
    throw new Error(
      "Select between 1 and 128 saved connections per redirect update.",
    );
  const current = new Map<string, Connection | null>();
  for (const connection of connections)
    current.set(connection.id, current.has(connection.id) ? null : connection);
  const updates = new Map<string, HttpTrustedRedirectDestinations>();
  for (const change of changes) {
    const id = change.expected.id;
    const matched = current.get(id);
    if (
      updates.has(id) ||
      !matched ||
      trustedRedirectSourceIdentity(matched) !==
        trustedRedirectSourceIdentity(change.expected)
    )
      throw new Error(TRUSTED_REDIRECT_STALE);
    updates.set(
      id,
      normalizeHttpTrustedRedirectDestinations(change.destinations),
    );
  }
  return connections.map((connection) => {
    const destinations = updates.get(connection.id);
    return destinations
      ? { ...connection, httpTrustedRedirectDestinations: destinations }
      : connection;
  });
}
