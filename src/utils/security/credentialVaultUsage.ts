import type { Connection } from "../../types/connection/connection";
import { getVaultRuntimeUnsupportedMessage } from "./runtimeCredentialVault";
import { getHttpApplicationProfile } from "../connection/httpApplicationProfiles";
import type { ConnectionCredentialInventoryRow } from "./connectionCredentialInventory";
import { connectionCredentialCategories } from "./credentialVaultCategories";

export interface CredentialAssignment {
  connectionId: string;
  name: string;
  protocol: string;
  application?: string;
  categories: string[];
}
export function credentialConnectionAssignment(
  connection: Connection,
  inventory?: ConnectionCredentialInventoryRow,
): CredentialAssignment {
  const application = connection.httpApplication?.id
    ? getHttpApplicationProfile(connection.httpApplication.id)?.label
    : undefined;
  return {
    connectionId: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    ...(application ? { application } : {}),
    categories: inventory
      ? connectionCredentialCategories(
          inventory,
          connection.httpApplication?.loginMode === "digest"
            ? "digest"
            : connection.authType,
        )
      : ["Other"],
  };
}

/** Guarded owner snapshot only. No endpoints, account names or credential values. */
export function credentialVaultAssignments(
  connections: readonly Connection[],
  inventoryRows: readonly ConnectionCredentialInventoryRow[],
): Map<string, CredentialAssignment[]> {
  const assignments = new Map<string, CredentialAssignment[]>();
  const indexed = new Map(inventoryRows.map((row) => [row.id, row]));
  const seen = new Map<string, Set<string>>();
  for (const connection of connections) {
    const source = connection.credentialSource;
    if (source?.kind !== "vault" || !source.credentialId || !connection.id)
      continue;
    const rows = assignments.get(source.credentialId) ?? [];
    const ids = seen.get(source.credentialId) ?? new Set<string>();
    if (ids.has(connection.id)) continue;
    ids.add(connection.id);
    seen.set(source.credentialId, ids);
    const inventory = indexed.get(connection.id);
    // Local VPN/key fields on a referencing connection are independent secrets,
    // not evidence that the linked vault entry supplies those credential types.
    rows.push(
      credentialConnectionAssignment(
        connection,
        inventory ? { ...inventory, kinds: [] } : undefined,
      ),
    );
    assignments.set(source.credentialId, rows);
  }
  return assignments;
}

/** Count distinct saved connection locations, not facets, sessions or account matches.
 * Call only with the current owner's guarded connection snapshot. */
export function credentialVaultUsage(
  connections: readonly Connection[],
): Map<string, number> {
  const references = new Map<string, Set<string>>();
  for (const connection of connections) {
    const source = connection.credentialSource;
    if (source?.kind !== "vault" || !source.credentialId || !connection.id)
      continue;
    const ids = references.get(source.credentialId) ?? new Set<string>();
    ids.add(connection.id);
    references.set(source.credentialId, ids);
  }
  return new Map(
    [...references].map(([id, connections]) => [id, connections.size]),
  );
}

/** Presence only; the private migration review performs the full conversion validation. */
export function canMigrateConnectionCredential(
  connection: Connection,
): boolean {
  return (
    !connection.isGroup &&
    (!connection.credentialSource ||
      connection.credentialSource.kind === "local") &&
    [
      connection.username,
      connection.password,
      connection.domain,
      connection.privateKey,
      connection.passphrase,
      connection.basicAuthUsername,
      connection.basicAuthPassword,
      connection.totpSecret,
      ...(connection.totpConfigs ?? []).map((item) => item.secret),
    ].some((value) => typeof value === "string" && value.length > 0) &&
    getVaultRuntimeUnsupportedMessage({
      ...connection,
      credentialSource: {
        kind: "vault",
        credentialId: "00000000-0000-4000-8000-000000000000",
      },
    }) === null
  );
}
