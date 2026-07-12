// sorng-keepass — shared frontend types (barrel).
//
// camelCase 1:1 mirror of the crate's `types.rs` (serde `rename_all` is NOT set
// on these structs — the Tauri layer camelCases field names at the boundary, so
// the frontend sees camelCase). Source of truth:
//   src-tauri/crates/sorng-keepass/src/keepass/types.rs
//
// This barrel holds the SHARED subset used by the shell + both category slices
// (config, database lifecycle, group/entry model, enums). Category-specific
// types live in `./database.ts` (t42-keepass-c1) and `./tools.ts` (t42-keepass-c2)
// and are re-exported here so `@/types/keepass` is the single import surface.

// ─── Integration config (frontend-only; NO backend struct) ────────────────────

/**
 * Per-instance KeePass config persisted via `useIntegrationConfigStore`. KeePass
 * has NO network host — the "connection" is a local `.kdbx` file plus a composite
 * key. The master password is the secret (stored in the OS vault by reference);
 * `kdbxPath` / `keyFilePath` are non-secret and live in the instance `fields`.
 */
export interface KeepassConfig {
  /** Absolute path to the `.kdbx` database file. */
  kdbxPath: string;
  /** Optional path to a key file component of the composite key. */
  keyFilePath?: string;
  /** Open the database read-only. */
  readOnly?: boolean;
}

// ─── Enums (shared) ───────────────────────────────────────────────────────────

export type KeePassCipher = "Aes256" | "Twofish" | "ChaCha20";

export type KdfAlgorithm = "AesKdf" | "Argon2d" | "Argon2id";

export type KeePassCompression = "None" | "GZip";

// ─── Database lifecycle ───────────────────────────────────────────────────────

export interface KdfSettings {
  algorithm: KdfAlgorithm;
  iterations?: number;
  memory?: number;
  parallelism?: number;
  salt?: string;
}

/** An open KeePass database session (returned by open/create). */
export interface KeePassDatabase {
  id: string;
  filePath: string;
  name: string;
  description: string;
  defaultUsername: string;
  locked: boolean;
  modified: boolean;
  formatVersion: string;
  cipher: KeePassCipher;
  kdf: KdfSettings;
  compression: KeePassCompression;
  rootGroupId: string;
  recycleBinId?: string;
  recycleBinEnabled: boolean;
  color?: string;
  entryCount: number;
  groupCount: number;
  createdAt: string;
  modifiedAt: string;
  lastOpenedAt: string;
  customIconCount: number;
  customData: Record<string, string>;
}

/** Request to open an existing `.kdbx` database. Passed as `req` to
 *  `keepass_open_database`. */
export interface OpenDatabaseRequest {
  filePath: string;
  password?: string;
  keyFilePath?: string;
  readOnly?: boolean;
}

/** Request to create a new `.kdbx` database. Passed as `req` to
 *  `keepass_create_database`. */
export interface CreateDatabaseRequest {
  filePath: string;
  name: string;
  description?: string;
  password?: string;
  keyFilePath?: string;
  cipher?: KeePassCipher;
  kdf?: KdfSettings;
  compression?: KeePassCompression;
  defaultUsername?: string;
  enableRecycleBin?: boolean;
}

export interface SaveDatabaseOptions {
  filePath?: string;
  createBackup?: boolean;
  newCipher?: KeePassCipher;
  newKdf?: KdfSettings;
}

export interface DatabaseFileInfo {
  filePath: string;
  fileSize: number;
  formatVersion?: string;
  cipher?: string;
  kdf?: string;
  created?: string;
  modified?: string;
}

// ─── Timestamps (shared by groups + entries) ──────────────────────────────────

export interface KeePassTimes {
  created: string;
  lastModified: string;
  lastAccessed: string;
  expiryTime?: string;
  expires: boolean;
  usageCount: number;
  locationChanged?: string;
}

// ─── Groups (shared: tree + navigation) ───────────────────────────────────────

export interface KeePassGroup {
  uuid: string;
  name: string;
  notes: string;
  iconId: number;
  customIconUuid?: string;
  parentUuid?: string;
  isExpanded: boolean;
  defaultAutoTypeSequence?: string;
  enableAutoType?: boolean;
  enableSearching?: boolean;
  lastTopVisibleEntry?: string;
  isRecycleBin: boolean;
  entryCount: number;
  childGroupCount: number;
  totalEntryCount: number;
  times: KeePassTimes;
  tags: string[];
  customData: Record<string, string>;
}

export interface GroupTreeNode {
  uuid: string;
  name: string;
  iconId: number;
  customIconUuid?: string;
  isRecycleBin: boolean;
  entryCount: number;
  children: GroupTreeNode[];
  depth: number;
}

// ─── Entries (shared: the entry model + summaries) ────────────────────────────

export interface CustomField {
  value: string;
  isProtected: boolean;
}

export interface EntryAttachmentRef {
  refId: string;
  filename: string;
}

/** Auto-type config embedded on an entry. The full auto-type command surface
 *  (resolve/match/validate) lives in the `tools` slice. */
export interface AutoTypeConfig {
  enabled: boolean;
  obfuscation: number;
  defaultSequence?: string;
  associations: AutoTypeAssociation[];
}

export interface AutoTypeAssociation {
  window: string;
  sequence?: string;
}

/** OTP config embedded on an entry. Current-value computation lives in `tools`. */
export interface OtpConfig {
  otpType: OtpType;
  secret: string;
  issuer?: string;
  account?: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period?: number;
  counter?: number;
}

export type OtpType = "Totp" | "Hotp" | "Steam";

export type OtpAlgorithm = "Sha1" | "Sha256" | "Sha512";

export interface KeePassEntry {
  uuid: string;
  groupUuid: string;
  iconId: number;
  customIconUuid?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  overrideUrl?: string;
  passwordQuality?: number;
  tags: string[];
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  customFields: Record<string, CustomField>;
  attachments: EntryAttachmentRef[];
  autoType?: AutoTypeConfig;
  otp?: OtpConfig;
  times: KeePassTimes;
  historyCount: number;
  isRecycled: boolean;
}

/** Lightweight entry row for list views (no password/secret data). Shared: both
 *  the tree (c1) and search/health (c2) return these. */
export interface EntrySummary {
  uuid: string;
  groupUuid: string;
  title: string;
  username: string;
  url: string;
  iconId: number;
  customIconUuid?: string;
  tags: string[];
  hasPassword: boolean;
  hasOtp: boolean;
  hasAttachments: boolean;
  attachmentCount: number;
  isExpired: boolean;
  createdAt: string;
  modifiedAt: string;
  lastAccessedAt?: string;
  expiryTime?: string;
}

/** Tag usage count — shared by group tags (c1) and search/stats (c2). */
export interface TagCount {
  tag: string;
  count: number;
}

// ─── Category re-exports (populated by c1 / c2) ───────────────────────────────
// Category execs add: `export * from "./database";` (c1) and
// `export * from "./tools";` (c2). Kept as explicit lines the execs own so the
// barrel is the single import surface without the lead pre-creating empty files.
