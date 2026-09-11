import type { Connection } from "../connection/connection";
import type { DatabaseCredentialEntry } from "./databaseCredentialVault";

/** Plaintext exists only inside the protected in-memory export/import operation. */
export interface DatabaseVaultArchive {
  format: "sorng-vault-archive";
  version: 1;
  createdAt: string;
  credentials: DatabaseCredentialEntry[];
  connections: Connection[];
}

/** Safe chooser metadata, not credentials or an independently reusable grant. */
export interface VaultArchiveConnection {
  id: string;
  name: string;
  protocol: string;
  hostname: string;
  credentialId: string;
}

export interface VaultArchiveImportResult {
  credentialCount: number;
  connectionCount: number;
  /** Archive is committed; subsequent unrelated pending edits need attention. */
  warning?: string;
}
