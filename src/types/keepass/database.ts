// sorng-keepass — "database" category types (t42-keepass-c1).
//
// The c1-owned subset of the KDBX data model: group/entry create-update
// requests, entry history + diff, database statistics, and database merge. These
// are the types referenced by the `database` command category that are NOT in the
// shared barrel (`./index.ts`). camelCase 1:1 mirror of the crate's `types.rs`:
//   src-tauri/crates/sorng-keepass/src/keepass/types.rs
//
// The barrel re-exports this file via `export * from "./database"` (appended by
// the per-crate integrator), so `@/types/keepass` remains the single import
// surface. Shared types used below (KeePassEntry, EntrySummary, TagCount, enums)
// come from `./index`.

import type {
  KeePassCipher,
  KdfAlgorithm,
  KeePassEntry,
  EntrySummary,
  TagCount,
} from "./index";

// ─── Group create / update ────────────────────────────────────────────────────

/** Request to create or update a group. Passed as `req` to
 *  `keepass_create_group` / `keepass_update_group`. */
export interface GroupRequest {
  name: string;
  parentUuid?: string;
  iconId?: number;
  customIconUuid?: string;
  notes?: string;
  defaultAutoTypeSequence?: string;
  enableAutoType?: boolean;
  enableSearching?: boolean;
  tags?: string[];
}

// ─── Entry create / update ────────────────────────────────────────────────────

// The auto-type/OTP config shapes referenced here (`AutoTypeConfig`, `OtpConfig`)
// live in the shared barrel and are embedded on `KeePassEntry`.
import type { AutoTypeConfig, OtpConfig, CustomField } from "./index";

/** Request to create or update an entry. Passed as `req` to
 *  `keepass_create_entry` / `keepass_update_entry`. */
export interface EntryRequest {
  groupUuid: string;
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  customFields?: Record<string, CustomField>;
  iconId?: number;
  customIconUuid?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  overrideUrl?: string;
  tags?: string[];
  autoType?: AutoTypeConfig;
  otp?: OtpConfig;
  expiryTime?: string;
  expires?: boolean;
}

// ─── Entry history + diff ─────────────────────────────────────────────────────

/** A point-in-time snapshot of an entry (returned by `keepass_get_entry_history`
 *  / `keepass_get_entry_history_item`). */
export interface EntryHistoryItem {
  /** Index in history (0 = oldest). */
  index: number;
  /** Full entry state at this snapshot. */
  entry: KeePassEntry;
  modifiedAt: string;
}

/** A single field-level change (part of `EntryDiff`). */
export interface FieldChange {
  fieldName: string;
  oldValue?: string;
  newValue?: string;
}

/** Diff between the current entry and a history snapshot (returned by
 *  `keepass_diff_entry_with_history`). */
export interface EntryDiff {
  uuid: string;
  changedFields: FieldChange[];
  addedCustomFields: string[];
  removedCustomFields: string[];
  addedAttachments: string[];
  removedAttachments: string[];
}

// ─── Database statistics ──────────────────────────────────────────────────────

/** Per-group entry count for the statistics distribution view. */
export interface GroupEntryCount {
  groupUuid: string;
  groupName: string;
  count: number;
}

/** Info about the oldest-unchanged password.
 *
 *  NOTE: also referenced by the `tools` slice's `PasswordHealthReport`. To keep
 *  the barrel's `export *` unambiguous, the `tools` slice (c2) should import this
 *  type from `@/types/keepass` rather than redefining it. */
export interface OldPasswordInfo {
  entryUuid: string;
  entryTitle: string;
  lastChanged: string;
  ageDays: number;
}

/** Aggregate database statistics (returned by
 *  `keepass_get_database_statistics`). */
export interface DatabaseStatistics {
  totalEntries: number;
  totalGroups: number;
  totalAttachments: number;
  totalAttachmentSize: number;
  totalCustomIcons: number;
  totalHistoryItems: number;
  expiredEntries: number;
  entriesExpiringSoon: number;
  entriesWithoutPassword: number;
  entriesWithWeakPassword: number;
  entriesWithDuplicatePassword: number;
  entriesWithOtp: number;
  entriesWithAttachments: number;
  mostUsedTags: TagCount[];
  groupDistribution: GroupEntryCount[];
  oldestPassword?: OldPasswordInfo;
  databaseSizeBytes: number;
  formatVersion: string;
  cipher: KeePassCipher;
  kdfAlgorithm: KdfAlgorithm;
}

// ─── Database merge / sync ────────────────────────────────────────────────────

/** How to resolve conflicts during a merge. */
export type ConflictResolution =
  | "KeepLocal"
  | "KeepRemote"
  | "PreferNewer"
  | "KeepBoth"
  | "Manual";

/** Merge/sync configuration. Passed as `config` to `keepass_merge_database`. */
export interface MergeConfig {
  remotePath: string;
  remotePassword?: string;
  remoteKeyFile?: string;
  conflictResolution: ConflictResolution;
  syncDeletions: boolean;
  mergeCustomIcons: boolean;
}

/** A single merge conflict requiring resolution. */
export interface MergeConflict {
  entryUuid: string;
  entryTitle: string;
  localModified: string;
  remoteModified: string;
  changedFields: string[];
}

/** Merge result summary (returned by `keepass_merge_database`). */
export interface MergeResult {
  entriesAdded: number;
  entriesUpdated: number;
  entriesDeleted: number;
  groupsAdded: number;
  groupsUpdated: number;
  groupsDeleted: number;
  conflicts: MergeConflict[];
  durationMs: number;
}

// Re-export the summary type used pervasively by the database views so consumers
// can pull both shared + c1 types from `@/types/keepass/database` if preferred.
export type { EntrySummary };
