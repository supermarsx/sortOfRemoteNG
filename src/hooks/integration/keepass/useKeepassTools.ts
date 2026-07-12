// useKeepassTools — real Tauri `invoke(...)` wrappers for the sorng-keepass
// `tools` category (t42-keepass-c2): attachments, search, the password toolkit,
// OTP, key files, import/export, auto-type, recent databases, change log,
// settings and service shutdown.
//
// Pairs 1:1 with the `tools` commands in
//   src-tauri/crates/sorng-keepass/src/keepass/commands.rs
// Argument names match the Rust `#[tauri::command]` params exactly (camelCase,
// per Tauri's snake_case↔camelCase arg mapping) so no custom serializer is needed.
// Commands take `dbId` where they operate on an open database; the password
// generator, analyzer, key-file and recent-database commands are stateless.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EntrySummary, TagCount } from "../../../types/keepass";
import type {
  AddAttachmentRequest,
  AutoTypeMatch,
  AutoTypeToken,
  ChangeLogEntry,
  CreateKeyFileRequest,
  ExportConfig,
  ExportResult,
  GeneratedPassword,
  ImportConfig,
  ImportResult,
  KeePassAttachment,
  KeyFileInfo,
  OtpValue,
  PasswordAnalysis,
  PasswordGeneratorRequest,
  PasswordHealthReport,
  PasswordProfile,
  PasswordStrength,
  RecentDatabase,
  SearchQuery,
  SearchResult,
} from "../../../types/keepass/tools";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const keepassToolsApi = {
  // Attachments (10)
  addAttachment: (dbId: string, req: AddAttachmentRequest) =>
    invoke<KeePassAttachment>("keepass_add_attachment", { dbId, req }),
  getEntryAttachments: (dbId: string, entryUuid: string) =>
    invoke<KeePassAttachment[]>("keepass_get_entry_attachments", {
      dbId,
      entryUuid,
    }),
  getAttachmentData: (dbId: string, entryUuid: string, refId: string) =>
    invoke<string>("keepass_get_attachment_data", { dbId, entryUuid, refId }),
  removeAttachment: (dbId: string, entryUuid: string, refId: string) =>
    invoke<void>("keepass_remove_attachment", { dbId, entryUuid, refId }),
  renameAttachment: (
    dbId: string,
    entryUuid: string,
    refId: string,
    newFilename: string,
  ) =>
    invoke<void>("keepass_rename_attachment", {
      dbId,
      entryUuid,
      refId,
      newFilename,
    }),
  saveAttachmentToFile: (
    dbId: string,
    entryUuid: string,
    refId: string,
    outputPath: string,
  ) =>
    invoke<number>("keepass_save_attachment_to_file", {
      dbId,
      entryUuid,
      refId,
      outputPath,
    }),
  importAttachmentFromFile: (
    dbId: string,
    entryUuid: string,
    filePath: string,
  ) =>
    invoke<KeePassAttachment>("keepass_import_attachment_from_file", {
      dbId,
      entryUuid,
      filePath,
    }),
  getAttachmentPoolSize: (dbId: string) =>
    invoke<[number, number]>("keepass_get_attachment_pool_size", { dbId }),
  compactAttachmentPool: (dbId: string) =>
    invoke<number>("keepass_compact_attachment_pool", { dbId }),
  verifyAttachmentIntegrity: (dbId: string) =>
    invoke<string[]>("keepass_verify_attachment_integrity", { dbId }),

  // Search (9)
  searchEntries: (dbId: string | undefined, query: SearchQuery) =>
    invoke<SearchResult>("keepass_search_entries", { dbId, query }),
  quickSearch: (dbId: string, term: string) =>
    invoke<EntrySummary[]>("keepass_quick_search", { dbId, term }),
  findEntriesForUrl: (dbId: string, url: string) =>
    invoke<EntrySummary[]>("keepass_find_entries_for_url", { dbId, url }),
  findDuplicates: (dbId: string) =>
    invoke<EntrySummary[][]>("keepass_find_duplicates", { dbId }),
  findExpiringEntries: (dbId: string, days: number) =>
    invoke<EntrySummary[]>("keepass_find_expiring_entries", { dbId, days }),
  findWeakPasswords: (dbId: string, maxStrength: PasswordStrength) =>
    invoke<EntrySummary[]>("keepass_find_weak_passwords", { dbId, maxStrength }),
  findEntriesWithoutPassword: (dbId: string) =>
    invoke<EntrySummary[]>("keepass_find_entries_without_password", { dbId }),
  getAllTags: (dbId: string) =>
    invoke<TagCount[]>("keepass_get_all_tags", { dbId }),
  findEntriesByTag: (dbId: string, tag: string) =>
    invoke<EntrySummary[]>("keepass_find_entries_by_tag", { dbId, tag }),

  // OTP (1)
  getEntryOtp: (dbId: string, entryUuid: string) =>
    invoke<OtpValue>("keepass_get_entry_otp", { dbId, entryUuid }),

  // Password health (1)
  passwordHealthReport: (dbId: string) =>
    invoke<PasswordHealthReport>("keepass_password_health_report", { dbId }),

  // Password generation & analysis (3)
  generatePassword: (req: PasswordGeneratorRequest) =>
    invoke<GeneratedPassword>("keepass_generate_password", { req }),
  generatePasswords: (req: PasswordGeneratorRequest) =>
    invoke<GeneratedPassword[]>("keepass_generate_passwords", { req }),
  analyzePassword: (password: string) =>
    invoke<PasswordAnalysis>("keepass_analyze_password", { password }),

  // Password profiles (3)
  listPasswordProfiles: () =>
    invoke<PasswordProfile[]>("keepass_list_password_profiles"),
  addPasswordProfile: (profile: PasswordProfile) =>
    invoke<void>("keepass_add_password_profile", { profile }),
  removePasswordProfile: (name: string) =>
    invoke<void>("keepass_remove_password_profile", { name }),

  // Key file (2)
  createKeyFile: (req: CreateKeyFileRequest) =>
    invoke<KeyFileInfo>("keepass_create_key_file", { req }),
  verifyKeyFile: (filePath: string) =>
    invoke<KeyFileInfo>("keepass_verify_key_file", { filePath }),

  // Import / export (2)
  importEntries: (dbId: string, config: ImportConfig) =>
    invoke<ImportResult>("keepass_import_entries", { dbId, config }),
  exportEntries: (dbId: string, config: ExportConfig) =>
    invoke<ExportResult>("keepass_export_entries", { dbId, config }),

  // Auto-type (6)
  parseAutotypeSequence: (sequence: string) =>
    invoke<AutoTypeToken[]>("keepass_parse_autotype_sequence", { sequence }),
  resolveAutotypeSequence: (
    dbId: string,
    entryUuid: string,
    sequence?: string,
  ) =>
    invoke<AutoTypeToken[]>("keepass_resolve_autotype_sequence", {
      dbId,
      entryUuid,
      sequence,
    }),
  findAutotypeMatches: (dbId: string, windowTitle: string) =>
    invoke<AutoTypeMatch[]>("keepass_find_autotype_matches", {
      dbId,
      windowTitle,
    }),
  listAutotypeAssociations: (dbId: string) =>
    invoke<AutoTypeMatch[]>("keepass_list_autotype_associations", { dbId }),
  validateAutotypeSequence: (sequence: string) =>
    invoke<string[]>("keepass_validate_autotype_sequence", { sequence }),
  getDefaultAutotypeSequence: () =>
    invoke<string>("keepass_get_default_autotype_sequence"),

  // Recent databases (4)
  listRecentDatabases: () =>
    invoke<RecentDatabase[]>("keepass_list_recent_databases"),
  addRecentDatabase: (filePath: string, name: string) =>
    invoke<void>("keepass_add_recent_database", { filePath, name }),
  removeRecentDatabase: (filePath: string) =>
    invoke<void>("keepass_remove_recent_database", { filePath }),
  clearRecentDatabases: () =>
    invoke<void>("keepass_clear_recent_databases"),

  // Change log (1)
  getChangeLog: (dbId?: string, limit?: number) =>
    invoke<ChangeLogEntry[]>("keepass_get_change_log", { dbId, limit }),

  // Settings (2)
  getSettings: () => invoke<unknown>("keepass_get_settings"),
  updateSettings: (settingsJson: unknown) =>
    invoke<void>("keepass_update_settings", { settingsJson }),

  // Service (1)
  shutdown: () => invoke<void>("keepass_shutdown"),
};

export type KeepassToolsApi = typeof keepassToolsApi;

// ─── React hook ─────────────────────────────────────────────────────────────--

/**
 * Loading/error lifecycle for the KeePass tools tab. `run` wraps any
 * `keepassToolsApi` call, tracking `isLoading` and surfacing errors with the
 * shared error idiom; it resolves to the value, or `undefined` on failure.
 */
export function useKeepassTools() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(fn: (api: KeepassToolsApi) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(keepassToolsApi);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { api: keepassToolsApi, run, isLoading, error, clearError };
}
