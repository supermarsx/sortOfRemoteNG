import type { Connection } from "../../types/connection/connection";
import { getVaultRuntimeUnsupportedMessage } from "./runtimeCredentialVault";

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
