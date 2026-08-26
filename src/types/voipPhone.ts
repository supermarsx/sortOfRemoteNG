// ── TypeScript types for the sorng-voip-phone crate ─────────────────────────
//
// Mirrors `src-tauri/crates/sorng-voip-phone/src/types.rs`. Rust serializes
// these with `rename_all = "camelCase"` for structs and `kebab-case` for the
// enums below, so the wire shape and the editor shape agree field-for-field.
// The `voipPhoneSettings` block on `Connection` is the persisted, non-secret
// subset of {@link VoipPhoneConnectionConfig}; credentials stay on the parent
// connection's `username`/`password` and are only joined at invoke time.

/** Vendor drivers. `yealink` is the first (and currently only) driver. */
export type VoipPhoneVendor = "yealink";

export const VOIP_PHONE_VENDORS = [
  "yealink",
] as const satisfies readonly VoipPhoneVendor[];

/** How the driver should authenticate. `auto` probes the phone first. */
export type VoipPhoneAuthMode = "auto" | "basic" | "form";

export const VOIP_PHONE_AUTH_MODES = [
  "auto",
  "basic",
  "form",
] as const satisfies readonly VoipPhoneAuthMode[];

/** Web-admin firmware generation detected by the driver. */
export type VoipPhoneGeneration = "legacy" | "servlet";

/** Login shape the driver ended up using (reported in status and errors). */
export type VoipPhoneAuthShape = "basic" | "form-plain" | "form-rsa";

/** Persisted per-connection editor settings (no secrets). */
export interface VoipPhoneSettings {
  vendor: VoipPhoneVendor;
  useSsl?: boolean;
  verifyCert?: boolean;
  authMode?: VoipPhoneAuthMode;
  actionUriEnabled?: boolean;
  timeoutSecs?: number;
}

export const VOIP_PHONE_DEFAULT_PORT = 80;
export const VOIP_PHONE_DEFAULT_TIMEOUT_SECS = 15;

/** Full connect payload (mirrors Rust `VoipPhoneConnectionConfig`). */
export interface VoipPhoneConnectionConfig {
  host: string;
  port: number;
  useSsl: boolean;
  verifyCert: boolean;
  vendor: VoipPhoneVendor;
  username: string;
  password: string;
  timeoutSecs: number;
  authMode: VoipPhoneAuthMode;
  actionUriEnabled: boolean;
}

/** Config without secrets, safe to display (mirrors Rust `VoipPhoneConfigSafe`). */
export type VoipPhoneConfigSafe = Omit<VoipPhoneConnectionConfig, "password">;

export interface VoipAccountStatus {
  index: number;
  label?: string;
  user?: string;
  server?: string;
  registered: boolean;
  rawState?: string;
}

export interface VoipPhoneStatus {
  vendor: VoipPhoneVendor;
  model?: string;
  firmware?: string;
  hardware?: string;
  mac?: string;
  ip?: string;
  uptime?: string;
  generation: VoipPhoneGeneration;
  authShape: VoipPhoneAuthShape;
  accounts: VoipAccountStatus[];
  rawFields: Record<string, string>;
}

export interface VoipPhoneSessionSummary {
  id: string;
  host: string;
  generation: VoipPhoneGeneration;
  authShape: VoipPhoneAuthShape;
  webUiUrl: string;
}

export type VoipRebootMethod = "action-uri" | "web-form";

export interface VoipRebootResult {
  method: VoipRebootMethod;
  accepted: boolean;
}

/**
 * Selectors handed to the embedded browser's auto-login. `formLogin=false`
 * means the phone uses HTTP Basic and the proxy injects the header itself.
 */
export interface VoipPhoneWebLoginHint {
  formLogin: boolean;
  selectors?: {
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
  };
}

export type VoipPhoneErrorKind =
  | "connection"
  | "auth"
  | "unsupported"
  | "parse"
  | "not-connected"
  | "forbidden";

export interface VoipPhoneError {
  kind: VoipPhoneErrorKind;
  message: string;
  authShape?: VoipPhoneAuthShape;
}

/** Build the persisted settings block with defaults applied. */
export function normalizeVoipPhoneSettings(
  settings: Partial<VoipPhoneSettings> | undefined,
): Required<VoipPhoneSettings> {
  return {
    vendor: settings?.vendor ?? "yealink",
    useSsl: settings?.useSsl ?? false,
    verifyCert: settings?.verifyCert ?? true,
    authMode: settings?.authMode ?? "auto",
    actionUriEnabled: settings?.actionUriEnabled ?? false,
    timeoutSecs: settings?.timeoutSecs ?? VOIP_PHONE_DEFAULT_TIMEOUT_SECS,
  };
}
