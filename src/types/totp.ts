/**
 * TypeScript types mirroring the Rust `sorng-totp` crate
 * (`src-tauri/crates/sorng-totp/src/totp/types.rs`).
 *
 * Wired to the 36 `totp_*` Tauri commands registered in
 * `sorng-commands-core` (see t3-e44).
 */

// ── Enums ───────────────────────────────────────────────────────────

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type TotpOtpType = "totp" | "hotp";

export type TotpImportFormat =
  | "otp_auth_uri"
  | "google_auth_migration"
  | "aegis_json"
  | "two_fas_json"
  | "and_otp_json"
  | "free_otp_plus_json"
  | "bitwarden_json"
  | "raivo_json"
  | "authy_json"
  | "generic_csv";

export type TotpExportFormat =
  | "json"
  | "csv"
  | "otp_auth_uris"
  | "encrypted_json"
  | "html_qr_codes";

export type TotpErrorKind =
  | "InvalidSecret"
  | "InvalidUri"
  | "InvalidAlgorithm"
  | "InvalidDigits"
  | "InvalidPeriod"
  | "ImportFailed"
  | "ExportFailed"
  | "EncryptionFailed"
  | "DecryptionFailed"
  | "KeyDerivationFailed"
  | "NotFound"
  | "DuplicateEntry"
  | "StorageError"
  | "QrEncodeFailed"
  | "QrDecodeFailed"
  | "ParseError"
  | "IoError"
  | "VaultLocked"
  | "InvalidInput"
  | "Internal";

// ── Core types ──────────────────────────────────────────────────────

export interface TotpEntry {
  id: string;
  issuer?: string | null;
  label: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  otp_type: TotpOtpType;
  period: number;
  counter: number;
  group_id?: string | null;
  icon?: string | null;
  color?: string | null;
  notes?: string | null;
  favourite: boolean;
  sort_order: number;
  created_at: string; // ISO 8601
  updated_at: string;
  last_used_at?: string | null;
  use_count: number;
  tags: string[];
}

export interface TotpGroup {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  sort_order: number;
  created_at: string;
}

export interface TotpGeneratedCode {
  code: string;
  remaining_seconds: number;
  period: number;
  progress: number;
  counter: number;
  entry_id: string;
}

export interface TotpVerifyResult {
  valid: boolean;
  drift: number;
  matched_counter?: number | null;
}

export interface TotpImportResult {
  format: TotpImportFormat;
  total_found: number;
  imported: number;
  skipped_duplicate: number;
  errors: string[];
  entries: TotpEntry[];
}

export interface TotpVaultMeta {
  version: number;
  entry_count: number;
  group_count: number;
  created_at: string;
  updated_at: string;
  last_saved_at: string;
  encrypted: boolean;
}

export interface TotpVaultStats {
  entry_count: number;
  group_count: number;
  favourite_count: number;
  tags: string[];
  has_password: boolean;
}

export interface TotpEntryFilter {
  search?: string | null;
  group_id?: string | null;
  tag?: string | null;
  favourites_only: boolean;
  otp_type?: TotpOtpType | null;
}

/** Tuple returned by `totp_password_strength`: (score 0-100, label). */
export type TotpPasswordStrength = [number, string];

// ────────────────────────────────────────────────────────────────────
//  Stateless TOTP helpers (t5-e9)
// ────────────────────────────────────────────────────────────────────

/** Parameters for the stateless `totp_compute_code` command. */
export interface TotpComputeCodeParams {
  secret: string;
  algorithm?: TotpAlgorithm;
  digits?: number;
  period?: number;
}

/** Parameters for the stateless `totp_build_otpauth_uri` command. */
export interface TotpBuildOtpauthUriParams {
  secret: string;
  issuer: string;
  account: string;
  algorithm?: TotpAlgorithm;
  digits?: number;
  period?: number;
}

/** Parameters for the stateless `totp_generate_backup_codes` command. */
export interface TotpGenerateBackupCodesParams {
  count: number;
  length?: number;
}
