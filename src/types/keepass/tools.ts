// sorng-keepass — `tools` category frontend types (t42-keepass-c2).
//
// The utility half of the KeePass surface: attachments, search/filter, the
// password toolkit (generate/analyze/profiles/health), OTP, key files,
// import/export, auto-type, recent databases, change log, settings, service.
// None of these types describe the group/entry tree structure itself (that is
// the `database` slice, c1) — they are the tools operating over it.
//
// camelCase 1:1 mirror of the crate's `types.rs` (Tauri camelCases field names
// at the boundary). Source of truth:
//   src-tauri/crates/sorng-keepass/src/keepass/types.rs
//
// `EntrySummary`, `TagCount`, `OtpType` and `OtpAlgorithm` are SHARED and live in
// the barrel (`./index`) — imported here, never redeclared, so the barrel's
// `export * from "./tools"` never collides.

import type { EntrySummary, OtpAlgorithm } from "./index";

// ─── Attachments ──────────────────────────────────────────────────────────────

/** A binary attachment stored in the database's binary pool. */
export interface KeePassAttachment {
  refId: string;
  filename: string;
  mimeType: string;
  size: number;
  hash: string;
}

/** Request to add an attachment to an entry. Passed as `req`. */
export interface AddAttachmentRequest {
  entryUuid: string;
  filename: string;
  /** Base64-encoded file content. */
  dataBase64: string;
  mimeType?: string;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export type SearchField =
  | "Title"
  | "Username"
  | "Password"
  | "Url"
  | "Notes"
  | "Tags"
  | "CustomFields"
  | "Uuid"
  | "Attachments";

export type SearchSortField =
  | "Title"
  | "Username"
  | "Url"
  | "Created"
  | "Modified"
  | "Accessed"
  | "ExpiryTime";

/** Advanced search query. Passed as `query` to `keepass_search_entries`. */
export interface SearchQuery {
  text?: string;
  isRegex: boolean;
  caseSensitive: boolean;
  fields?: SearchField[];
  tags?: string[];
  groupUuid?: string;
  includeSubgroups: boolean;
  excludeExpired: boolean;
  onlyExpired: boolean;
  expiresWithinDays?: number;
  hasAttachments?: boolean;
  hasOtp?: boolean;
  hasUrl?: boolean;
  passwordStrengthMax?: PasswordStrength;
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  sortBy?: SearchSortField;
  sortAscending?: boolean;
  offset?: number;
  limit?: number;
}

export interface SearchResult {
  entries: EntrySummary[];
  totalMatches: number;
  searchTimeMs: number;
  hasMore: boolean;
}

// ─── OTP ──────────────────────────────────────────────────────────────────────

/** Current OTP value with time info (returned by `keepass_get_entry_otp`). */
export interface OtpValue {
  code: string;
  remainingSeconds?: number;
  period?: number;
  algorithm: OtpAlgorithm;
}

// ─── Password strength / generation / analysis ────────────────────────────────

export type PasswordStrength =
  | "VeryWeak"
  | "Weak"
  | "Fair"
  | "Strong"
  | "VeryStrong";

export type PasswordGenMode = "CharacterSet" | "Pattern" | "Passphrase";

export type CharacterSet =
  | "UpperCase"
  | "LowerCase"
  | "Digits"
  | "Special"
  | "Space"
  | "Brackets"
  | "HighAnsi"
  | "Minus"
  | "Underline";

export interface PassphraseOptions {
  wordCount: number;
  separator: string;
  capitalize: boolean;
  includeNumbers: boolean;
}

/** Password generation request. Passed as `req`. */
export interface PasswordGeneratorRequest {
  mode: PasswordGenMode;
  length: number;
  characterSets?: CharacterSet[];
  customCharacters?: string;
  excludeCharacters?: string;
  excludeLookalikes: boolean;
  ensureEachSet: boolean;
  pattern?: string;
  count?: number;
}

export interface GeneratedPassword {
  password: string;
  entropyBits: number;
  strength: PasswordStrength;
  characterCount: number;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigits: boolean;
  hasSpecial: boolean;
}

export interface PasswordAnalysis {
  entropyBits: number;
  strength: PasswordStrength;
  length: number;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigits: boolean;
  hasSpecial: boolean;
  hasUnicode: boolean;
  repeatedChars: number;
  sequentialChars: number;
  commonPatterns: string[];
  suggestions: string[];
  estimatedCrackTime: string;
}

/** Saved password generator profile. */
export interface PasswordProfile {
  id: string;
  name: string;
  description: string;
  config: PasswordGeneratorRequest;
  isBuiltin: boolean;
  createdAt: string;
  modifiedAt: string;
}

// ─── Password health ──────────────────────────────────────────────────────────

export interface OldPasswordInfo {
  entryUuid: string;
  entryTitle: string;
  lastChanged: string;
  ageDays: number;
}

export interface ReusedPassword {
  /** Hash of the password (for comparison, never the actual password). */
  passwordHash: string;
  entryUuids: string[];
  entryTitles: string[];
  count: number;
}

export interface WeakPasswordEntry {
  entryUuid: string;
  entryTitle: string;
  strength: PasswordStrength;
  entropyBits: number;
  issues: string[];
}

export interface PasswordHealthReport {
  totalEntries: number;
  analyzed: number;
  strong: number;
  fair: number;
  weak: number;
  veryWeak: number;
  empty: number;
  reusedPasswords: ReusedPassword[];
  expiredEntries: EntrySummary[];
  oldPasswords: OldPasswordInfo[];
  weakEntries: WeakPasswordEntry[];
  averageEntropy: number;
  averageLength: number;
}

// ─── Key files ────────────────────────────────────────────────────────────────

export type KeyFileFormat = "Xml" | "Binary32" | "Hex64" | "Random";

/** Key file creation request. Passed as `req` to `keepass_create_key_file`. */
export interface CreateKeyFileRequest {
  filePath: string;
  format: KeyFileFormat;
  /** Optional custom key material (base64-encoded). */
  customData?: string;
}

export interface KeyFileInfo {
  filePath: string;
  format: KeyFileFormat;
  hash: string;
  fileSize: number;
  createdAt?: string;
}

// ─── Import / export ──────────────────────────────────────────────────────────

export type ImportFormat =
  | "KeePassXml"
  | "KeePassCsv"
  | "GenericCsv"
  | "LastPassCsv"
  | "BitwardenJson"
  | "BitwardenCsv"
  | "OnePasswordCsv"
  | "ChromeCsv"
  | "FirefoxCsv"
  | "KeePassXmlV1"
  | "Kdbx";

export type ExportFormat =
  | "KeePassXml"
  | "KeePassCsv"
  | "GenericCsv"
  | "Csv"
  | "Json"
  | "Html"
  | "PlainText";

export type DuplicateHandling =
  | "ImportAll"
  | "Skip"
  | "Replace"
  | "KeepBoth"
  | "Merge";

/** CSV header → target field mapping entry. */
export interface FieldMapping {
  key: string;
  value: string;
}

/** Import configuration. Passed as `config` to `keepass_import_entries`. */
export interface ImportConfig {
  format: ImportFormat;
  filePath: string;
  targetGroupUuid?: string;
  duplicateHandling: DuplicateHandling;
  fieldMapping?: FieldMapping[];
  /** Single-character CSV delimiter. */
  csvDelimiter?: string;
  csvHasHeader?: boolean;
  sourcePassword?: string;
  sourceKeyFile?: string;
}

/** Export configuration. Passed as `config` to `keepass_export_entries`. */
export interface ExportConfig {
  format: ExportFormat;
  filePath: string;
  groupUuid?: string;
  includeRecycled: boolean;
  includeAttachments: boolean;
  includeHistory: boolean;
  redactPasswords: boolean;
}

export interface ImportError {
  lineOrIndex: number;
  field?: string;
  message: string;
}

export interface ImportResult {
  entriesImported: number;
  entriesSkipped: number;
  entriesMerged: number;
  groupsCreated: number;
  errors: ImportError[];
  warnings: string[];
}

export interface ExportResult {
  entriesExported: number;
  filePath: string;
  fileSize: number;
  format: ExportFormat;
}

// ─── Auto-type ────────────────────────────────────────────────────────────────

/** A parsed auto-type sequence token. Rust `AutoTypeToken` is an externally-tagged
 *  enum, so each variant serializes as a single-key object. */
export type AutoTypeToken =
  | { Literal: string }
  | { Key: string }
  | { FieldRef: string }
  | { Modifier: string }
  | { Delay: number }
  | { Command: string }
  | { Repeat: [AutoTypeToken, number] };

export interface AutoTypeMatch {
  entryUuid: string;
  entryTitle: string;
  sequence: string;
  windowMatch: string;
}

// ─── Recent databases ─────────────────────────────────────────────────────────

export interface RecentDatabase {
  filePath: string;
  name: string;
  lastOpened: string;
  fileExists: boolean;
  fileSize?: number;
  isFavorite: boolean;
}

// ─── Change log ───────────────────────────────────────────────────────────────

export type ChangeAction =
  | "Create"
  | "Update"
  | "Delete"
  | "Move"
  | "Restore"
  | "Import"
  | "Merge";

export type ChangeTargetType = "Entry" | "Group" | "Attachment" | "Database";

export interface ChangeLogEntry {
  id: string;
  timestamp: string;
  action: ChangeAction;
  targetType: ChangeTargetType;
  targetUuid: string;
  targetName: string;
  description: string;
  reversible: boolean;
}
