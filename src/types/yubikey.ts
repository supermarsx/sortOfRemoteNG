// ── YubiKey Types ────────────────────────────────────────────────────

export type FormFactor =
  | "Unknown"
  | "UsbAKeychain"
  | "UsbANano"
  | "UsbCKeychain"
  | "UsbCNano"
  | "UsbCLightning"
  | "UsbABio"
  | "UsbCBio";

export type YubiKeyInterface = "Otp" | "Fido" | "Ccid";

export type PivSlot =
  | "Authentication"
  | "Signature"
  | "KeyManagement"
  | "CardAuthentication"
  | "Attestation"
  | string; // Retired1-20

export type PivAlgorithm =
  | "Rsa1024"
  | "Rsa2048"
  | "Rsa3072"
  | "Rsa4096"
  | "EcP256"
  | "EcP384"
  | "Ed25519"
  | "X25519";

export type PinPolicy =
  | "Default"
  | "Never"
  | "Once"
  | "Always"
  | "MatchOnce"
  | "MatchAlways";

export type TouchPolicy = "Default" | "Never" | "Always" | "Cached";

export type KeyOrigin = "Generated" | "Imported" | "Unknown";

export type ManagementKeyType =
  | "TripleDes"
  | "Aes128"
  | "Aes192"
  | "Aes256";

export type CredProtect =
  | "None"
  | "Optional"
  | "OptionalWithList"
  | "Required";

export type OathType = "Totp" | "Hotp";

export type OathAlgorithm = "Sha1" | "Sha256" | "Sha512";

export type OtpSlot = "Short" | "Long";

export type OtpSlotType =
  | "YubicoOtp"
  | "ChallengeResponse"
  | "StaticPassword"
  | "HotpOath";

export type YubiKeyAuditAction =
  | "DeviceDetected"
  | "DeviceRemoved"
  | "PivGenerate"
  | "PivImport"
  | "PivSign"
  | "PivDecrypt"
  | "PivChangePIN"
  | "PivChangePUK"
  | "PivResetPIV"
  | "FidoRegister"
  | "FidoAuthenticate"
  | "FidoDeleteCredential"
  | "FidoSetPIN"
  | "FidoResetFIDO"
  | "OathAdd"
  | "OathDelete"
  | "OathCalculate"
  | "OathSetPassword"
  | "OathResetOATH"
  | "OtpConfigure"
  | "OtpSwap"
  | "OtpDelete"
  | "ConfigUpdate"
  | "FactoryReset";

// ── Device ───────────────────────────────────────────────────────────

export interface YubiKeyDevice {
  serial: number;
  firmware_version: string;
  form_factor: FormFactor;
  has_nfc: boolean;
  usb_interfaces_enabled: YubiKeyInterface[];
  nfc_interfaces_enabled: YubiKeyInterface[];
  serial_visible: boolean;
  device_name: string;
  is_fips: boolean;
  is_sky: boolean;
  pin_complexity: boolean;
  auto_eject_timeout: number;
  challenge_response_timeout: number;
  device_flags: string[];
  config_locked: boolean;
}

// ── PIV ──────────────────────────────────────────────────────────────

export interface PivCertificate {
  subject: string;
  issuer: string;
  serial: string;
  not_before: string;
  not_after: string;
  fingerprint_sha256: string;
  algorithm: string;
  is_self_signed: boolean;
  key_usage: string[];
  extended_key_usage: string[];
  san: string[];
  pem: string;
  der_base64: string;
}

export interface PivSlotInfo {
  slot: PivSlot;
  algorithm: PivAlgorithm | null;
  has_key: boolean;
  has_certificate: boolean;
  certificate: PivCertificate | null;
  pin_policy: PinPolicy;
  touch_policy: TouchPolicy;
  origin: KeyOrigin;
}

export interface PivPinStatus {
  pin_attempts_remaining: number;
  puk_attempts_remaining: number;
  pin_is_default: boolean;
  puk_is_default: boolean;
  management_key_is_default: boolean;
  management_key_type: ManagementKeyType;
}

// ── FIDO2 ────────────────────────────────────────────────────────────

export interface Fido2Credential {
  credential_id: string;
  rp_id: string;
  rp_name: string;
  user_name: string;
  user_display_name: string;
  user_id_base64: string;
  creation_time: string | null;
  large_blob_key: boolean;
  hmac_secret: boolean;
  cred_protect: CredProtect;
  discoverable: boolean;
}

export interface Fido2DeviceInfo {
  versions: string[];
  extensions: string[];
  aaguid: string;
  options: Record<string, boolean>;
  max_msg_size: number;
  pin_uv_auth_protocols: number[];
  max_credential_count_in_list: number;
  max_credential_id_length: number;
  firmware_version: string;
  remaining_discoverable_credentials: number;
  force_pin_change: boolean;
  min_pin_length: number;
  certifications: string[];
  algorithms: Fido2Algorithm[];
}

export interface Fido2Algorithm {
  alg_type: string;
  alg_id: number;
}

export interface Fido2PinStatus {
  pin_set: boolean;
  pin_retries: number;
  uv_retries: number | null;
  force_change: boolean;
  min_length: number;
}

// ── OATH ─────────────────────────────────────────────────────────────

export interface OathAccount {
  issuer: string;
  name: string;
  oath_type: OathType;
  algorithm: OathAlgorithm;
  digits: number;
  period: number;
  touch_required: boolean;
  credential_id: string;
}

export interface OathCode {
  code: string;
  valid_from: number;
  valid_to: number;
  touch_required: boolean;
}

// ── OTP ──────────────────────────────────────────────────────────────

export interface OtpSlotConfig {
  slot: OtpSlot;
  configured: boolean;
  slot_type: OtpSlotType | null;
  require_touch: boolean;
}

// ── Attestation ──────────────────────────────────────────────────────

export interface AttestationResult {
  slot: PivSlot;
  device_certificate_pem: string;
  attestation_certificate_pem: string;
  serial: number;
  firmware_version: string;
  pin_policy: PinPolicy;
  touch_policy: TouchPolicy;
  form_factor: FormFactor;
  is_fips: boolean;
  generated_on_device: boolean;
}

// ── CSR ──────────────────────────────────────────────────────────────

export interface CsrParams {
  common_name: string;
  organization: string;
  organizational_unit: string;
  locality: string;
  state: string;
  country: string;
  email: string;
  san: string[];
}

// ── Audit ────────────────────────────────────────────────────────────

export interface YubiKeyAuditEntry {
  id: string;
  timestamp: string;
  action: YubiKeyAuditAction;
  serial: number | null;
  details: string;
  success: boolean;
  error: string | null;
}

// ── Config ───────────────────────────────────────────────────────────

export interface YubiKeyConfig {
  auto_detect: boolean;
  poll_interval_ms: number;
  ykman_path: string | null;
  piv_default_algorithm: PivAlgorithm;
  piv_default_pin_policy: PinPolicy;
  piv_default_touch_policy: TouchPolicy;
  oath_default_algorithm: OathAlgorithm;
  oath_default_digits: number;
  oath_default_period: number;
  fido2_uv_preferred: boolean;
  auto_generate_attestation: boolean;
  require_touch_for_crypto: boolean;
}
