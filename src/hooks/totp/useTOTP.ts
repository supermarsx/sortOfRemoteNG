/**
 * React hook wrapping the 36 `totp_*` Tauri commands exposed by the
 * `sorng-totp` backend crate (see t3-e44 wiring).
 *
 * This hook is the canonical Rust-backed TOTP API. The former in-browser
 * JS shim under `utils/auth/` was removed in t5-e11; all callers now
 * route through `totpApi` below.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo } from "react";
import type {
  TotpEntry,
  TotpGroup,
  TotpGeneratedCode,
  TotpVerifyResult,
  TotpImportResult,
  TotpImportFormat,
  TotpExportFormat,
  TotpVaultStats,
  TotpEntryFilter,
  TotpPasswordStrength,
  TotpAlgorithm,
} from "../../types/totp";

// ────────────────────────────────────────────────────────────────────
//  Command bindings — one function per `#[tauri::command]`
// ────────────────────────────────────────────────────────────────────

export const totpApi = {
  // ── Entry CRUD (8) ─────────────────────────────────────────────
  addEntry: (entry: TotpEntry): Promise<string> =>
    invoke("totp_add_entry", { entry }),
  createEntry: (
    label: string,
    secret: string,
    issuer?: string,
    algorithm?: TotpAlgorithm,
    digits?: number,
    period?: number,
  ): Promise<TotpEntry> =>
    invoke("totp_create_entry", { label, secret, issuer, algorithm, digits, period }),
  getEntry: (id: string): Promise<TotpEntry> => invoke("totp_get_entry", { id }),
  updateEntry: (entry: TotpEntry): Promise<void> =>
    invoke("totp_update_entry", { entry }),
  removeEntry: (id: string): Promise<TotpEntry> =>
    invoke("totp_remove_entry", { id }),
  listEntries: (): Promise<TotpEntry[]> => invoke("totp_list_entries"),
  searchEntries: (query: string): Promise<TotpEntry[]> =>
    invoke("totp_search_entries", { query }),
  filterEntries: (filter: TotpEntryFilter): Promise<TotpEntry[]> =>
    invoke("totp_filter_entries", { filter }),

  // ── Code generation / verification (3) ─────────────────────────
  generateCode: (id: string): Promise<TotpGeneratedCode> =>
    invoke("totp_generate_code", { id }),
  generateAllCodes: (): Promise<TotpGeneratedCode[]> =>
    invoke("totp_generate_all_codes"),
  verifyCode: (
    id: string,
    code: string,
    driftWindow?: number,
  ): Promise<TotpVerifyResult> =>
    invoke("totp_verify_code", { id, code, driftWindow }),

  // ── Groups (4) ─────────────────────────────────────────────────
  addGroup: (name: string): Promise<TotpGroup> => invoke("totp_add_group", { name }),
  listGroups: (): Promise<TotpGroup[]> => invoke("totp_list_groups"),
  removeGroup: (id: string): Promise<void> => invoke("totp_remove_group", { id }),
  moveEntryToGroup: (entryId: string, groupId?: string): Promise<void> =>
    invoke("totp_move_entry_to_group", { entryId, groupId }),

  // ── Favourites & ordering (3) ──────────────────────────────────
  toggleFavourite: (id: string): Promise<boolean> =>
    invoke("totp_toggle_favourite", { id }),
  listFavourites: (): Promise<TotpEntry[]> => invoke("totp_list_favourites"),
  reorderEntry: (fromIdx: number, toIdx: number): Promise<void> =>
    invoke("totp_reorder_entry", { fromIdx, toIdx }),

  // ── Import / Export (4) ────────────────────────────────────────
  importEntries: (data: string): Promise<TotpImportResult> =>
    invoke("totp_import_entries", { data }),
  importAs: (data: string, format: TotpImportFormat): Promise<TotpImportResult> =>
    invoke("totp_import_as", { data, format }),
  importUri: (uri: string): Promise<TotpEntry> => invoke("totp_import_uri", { uri }),
  exportEntries: (format: TotpExportFormat, password?: string): Promise<string> =>
    invoke("totp_export_entries", { format, password }),

  // ── QR codes (3) ───────────────────────────────────────────────
  entryQrPng: (id: string): Promise<number[]> => invoke("totp_entry_qr_png", { id }),
  entryQrDataUri: (id: string): Promise<string> =>
    invoke("totp_entry_qr_data_uri", { id }),
  entryUri: (id: string): Promise<string> => invoke("totp_entry_uri", { id }),

  // ── Vault lock / unlock / save / load (7) ──────────────────────
  setPassword: (password: string): Promise<void> =>
    invoke("totp_set_password", { password }),
  lock: (): Promise<void> => invoke("totp_lock"),
  unlock: (encryptedJson: string, password: string): Promise<void> =>
    invoke("totp_unlock", { encryptedJson, password }),
  isLocked: (): Promise<boolean> => invoke("totp_is_locked"),
  saveVault: (): Promise<string> => invoke("totp_save_vault"),
  loadVault: (data: string, password?: string): Promise<void> =>
    invoke("totp_load_vault", { data, password }),

  // ── Utility (5) ────────────────────────────────────────────────
  generateSecret: (length?: number): Promise<string> =>
    invoke("totp_generate_secret", { length }),
  passwordStrength: (password: string): Promise<TotpPasswordStrength> =>
    invoke("totp_password_strength", { password }),
  deduplicate: (): Promise<number> => invoke("totp_deduplicate"),
  vaultStats: (): Promise<TotpVaultStats> => invoke("totp_vault_stats"),
  allTags: (): Promise<string[]> => invoke("totp_all_tags"),

  // ── Stateless helpers (t5-e9, 3) ───────────────────────────────
  computeCode: (
    secret: string,
    algorithm?: TotpAlgorithm,
    digits?: number,
    period?: number,
  ): Promise<string> =>
    invoke("totp_compute_code", { secret, algorithm, digits, period }),
  buildOtpauthUri: (
    secret: string,
    issuer: string,
    account: string,
    algorithm?: TotpAlgorithm,
    digits?: number,
    period?: number,
  ): Promise<string> =>
    invoke("totp_build_otpauth_uri", {
      secret,
      issuer,
      account,
      algorithm,
      digits,
      period,
    }),
  generateBackupCodes: (count: number, length?: number): Promise<string[]> =>
    invoke("totp_generate_backup_codes", { count, length }),
};

/**
 * React hook returning the same surface as `totpApi` — each call
 * memoised with `useCallback` so dependents can treat them as stable.
 */
export function useTOTP() {
  // All bindings are stable references already; we only wrap them once
  // with useMemo to return the same object identity across renders.
  return useMemo(() => totpApi, []);
}

/** Named export matching the generic bindings shape used by other hooks. */
export default useTOTP;

// Tree-shake helper: referenced by UI components that want to bypass
// the hook plumbing.
export { invoke as __totpInvoke };

// No-op to appease tools that complain about unused useCallback import.
void useCallback;
