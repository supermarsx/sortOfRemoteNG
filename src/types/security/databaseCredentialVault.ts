import type {
  DatabaseVaultArchive,
  VaultArchiveImportResult,
} from "./vaultArchive";

/** Absence means legacy connection-local credentials, never a global vault. */
export type ConnectionCredentialSource =
  { kind: "local" } | { kind: "vault"; credentialId: string; totpId?: string };

export interface VaultTotpFacet {
  id: string;
  label: string;
  secret: string;
  digits: 6 | 8;
  period: number;
  algorithm: "sha1" | "sha256" | "sha512";
}

/** Descriptive bindings only, not portable OAuth sessions or authenticator keys. */
export interface VaultSocialBinding {
  id: string;
  provider: string;
  origin: string;
  accountHint?: string;
  portable: false;
}

export interface VaultPasskeyBinding {
  id: string;
  provider: string;
  rpId: string;
  accountHint?: string;
  portable: false;
}

export interface DatabaseCredentialFacets {
  username?: string;
  password?: string;
  domain?: string;
  privateKey?: string;
  passphrase?: string;
  totp?: VaultTotpFacet[];
  social?: VaultSocialBinding[];
  passkey?: VaultPasskeyBinding[];
}

export type DatabaseCredentialFacet = keyof DatabaseCredentialFacets;

export interface DatabaseCredentialEntry {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  facets: DatabaseCredentialFacets;
}

export interface DatabaseCredentialVault {
  version: 1;
  revision: number;
  entries: DatabaseCredentialEntry[];
}

export interface DatabaseCredentialScope {
  databaseId: string;
  generation: number;
}

/** Safe picker rows: no account names, keys, seeds, passwords or provider bindings. */
export interface DatabaseCredentialMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  availableFacets: DatabaseCredentialFacet[];
}

export interface DatabaseCredentialSnapshot {
  scope: DatabaseCredentialScope;
  revision: number;
  receipt: string;
  entries: DatabaseCredentialMetadata[];
}

export type DatabaseCredentialChange =
  | { operation: "put"; entry: DatabaseCredentialEntry }
  | { operation: "delete"; id: string };

/** An unlocked owning database with verified encrypted storage is mandatory. */
export interface DatabaseCredentialVaultApi {
  scope: DatabaseCredentialScope | null;
  changeRevision: number;
  list(scope: DatabaseCredentialScope): Promise<DatabaseCredentialSnapshot>;
  /** Explicit ephemeral disclosure. Callers must not persist this on Connection. */
  resolve(
    snapshot: DatabaseCredentialSnapshot,
    id: string,
    facets: readonly DatabaseCredentialFacet[],
  ): Promise<DatabaseCredentialFacets>;
  /** Whole-vault CAS, one durable save; all review receipts expire on success. */
  compareAndSwap(
    snapshot: DatabaseCredentialSnapshot,
    changes: readonly DatabaseCredentialChange[],
  ): Promise<void>;
  /** Explicit private export; callers must encrypt before writing a file. */
  exportArchive?(
    snapshot: DatabaseCredentialSnapshot,
    credentialIds: readonly string[],
    connectionIds: readonly string[],
  ): Promise<DatabaseVaultArchive>;
  archiveConnections?(snapshot: DatabaseCredentialSnapshot): Promise<
    {
      id: string;
      name: string;
      protocol: string;
      hostname: string;
      credentialId: string;
    }[]
  >;
  /** Append remapped credentials and links together in one durable transaction. */
  importArchive?(
    snapshot: DatabaseCredentialSnapshot,
    archive: DatabaseVaultArchive,
  ): Promise<VaultArchiveImportResult>;
}
