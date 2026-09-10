export const VAULT_PORTABILITY_MESSAGE =
  "Importing or copying selected database-vault credentials is not supported yet. Choose connection-local credentials explicitly in the source connection, or duplicate the entire protected database. No connections or vault credentials were copied.";

export class VaultPortabilityError extends Error {
  constructor() {
    super(VAULT_PORTABILITY_MESSAGE);
    this.name = "VaultPortabilityError";
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A bare vault ID has no portable owner. Never discard it during redaction:
 * that could activate previously ignored local credentials in the destination.
 * This guard runs before stripping, remapping, or any sidecar/database writes.
 */
export function assertPortableCredentialSources(
  connections: readonly unknown[],
): void {
  for (const connection of connections) {
    if (!record(connection) || !("credentialSource" in connection)) continue;
    const source = connection.credentialSource;
    if (source === undefined) continue;
    if (
      !record(source) ||
      !Object.prototype.hasOwnProperty.call(source, "kind") ||
      source.kind !== "local" ||
      Object.keys(source).length !== 1
    )
      throw new VaultPortabilityError();
  }
}

/** Closed native JSON locations; no traversal through unrelated settings. */
export function assertNoVaultImport(payload: unknown): void {
  const checkDatabase = (value: unknown) => {
    if (Array.isArray(value)) {
      assertPortableCredentialSources(value);
      return;
    }
    if (!record(value)) return;
    // Even an empty, null, or malformed declared vault must not be silently lost.
    if ("credentialVault" in value) throw new VaultPortabilityError();
    if (Array.isArray(value.connections))
      assertPortableCredentialSources(value.connections);
    if (record(value.recycleBin) && Array.isArray(value.recycleBin.entries))
      assertPortableCredentialSources(
        value.recycleBin.entries.map((entry) =>
          record(entry) ? entry.connection : undefined,
        ),
      );
  };
  checkDatabase(payload);
  if (record(payload) && Array.isArray(payload.databases))
    payload.databases.forEach(checkDatabase);
}
