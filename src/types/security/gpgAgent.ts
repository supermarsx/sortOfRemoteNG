// ── GPG Agent Types ──────────────────────────────────────────────────

export type GpgKeyAlgorithm =
  | "Rsa1024"
  | "Rsa2048"
  | "Rsa3072"
  | "Rsa4096"
  | "Dsa"
  | "Ed25519"
  | "Cv25519"
  | "EcdsaP256"
  | "EcdsaP384"
  | "EcdsaP521"
  | "ElGamal";

export type KeyCapability = "Certify" | "Sign" | "Encrypt" | "Authenticate";
export type KeyValidity =
  | "Unknown"
  | "Invalid"
  | "Disabled"
  | "Revoked"
  | "Expired"
  | "Undefined"
  | "NeverValid"
  | "Marginal"
  | "Full"
  | "Ultimate";
export type KeyOwnerTrust =
  | "Unknown"
  | "Untrusted"
  | "Marginal"
  | "Full"
  | "Ultimate";
export type PinentryMode =
  | "Default"
  | "Ask"
  | "Cancel"
  | "Error"
  | "Loopback";
export type SigStatus =
  | "Good"
  | "Bad"
  | "ExpiredKey"
  | "ExpiredSig"
  | "RevokedKey"
  | "MissingSigner"
  | "Error";
export type CardSlot = "Signature" | "Encryption" | "Authentication";
export type GpgAuditAction =
  | "Sign"
  | "Verify"
  | "Encrypt"
  | "Decrypt"
  | "KeyGenerate"
  | "KeyImport"
  | "KeyExport"
  | "KeyDelete"
  | "KeySign"
  | "KeyTrust"
  | "KeyRevoke"
  | "CardOperation"
  | "AgentStart"
  | "AgentStop"
  | "KeyserverFetch"
  | "KeyserverSend"
  | "PinChange"
  | "PinReset";

export interface GpgUid {
  uid: string;
  name: string;
  email: string;
  comment: string;
  creation_date: string;
  validity: KeyValidity;
  is_primary: boolean;
  is_revoked: boolean;
  signatures: UidSignature[];
}

export interface UidSignature {
  signer_key_id: string;
  signer_uid: string;
  creation_date: string;
  expiration_date: string | null;
  signature_class: string;
  is_exportable: boolean;
  trust_level: number;
  trust_amount: number;
}

export interface GpgSubkey {
  key_id: string;
  fingerprint: string;
  algorithm: GpgKeyAlgorithm;
  bits: number;
  creation_date: string;
  expiration_date: string | null;
  capabilities: KeyCapability[];
  is_revoked: boolean;
  is_expired: boolean;
  card_serial: string | null;
  keygrip: string;
}

export interface GpgKey {
  key_id: string;
  fingerprint: string;
  algorithm: GpgKeyAlgorithm;
  bits: number;
  creation_date: string;
  expiration_date: string | null;
  capabilities: KeyCapability[];
  owner_trust: KeyOwnerTrust;
  validity: KeyValidity;
  uid_list: GpgUid[];
  subkeys: GpgSubkey[];
  is_secret: boolean;
  is_revoked: boolean;
  is_expired: boolean;
  is_disabled: boolean;
  card_serial: string | null;
  keygrip: string;
  compliance: string;
}

export interface CardKeyAttribute {
  slot: CardSlot;
  algorithm: string;
  bits: number;
  curve: string | null;
}

export interface SmartCardInfo {
  reader: string;
  serial: string;
  manufacturer: string;
  application_version: string;
  pin_retry_count: [number, number, number];
  signature_count: number;
  signature_key_fingerprint: string | null;
  encryption_key_fingerprint: string | null;
  authentication_key_fingerprint: string | null;
  card_holder: string;
  language: string;
  sex: string | null;
  public_key_url: string;
  login_data: string;
  ca_fingerprints: string[];
  key_attributes: CardKeyAttribute[];
  extended_capabilities: string[];
}

export interface GpgAgentStatus {
  running: boolean;
  version: string;
  socket_path: string;
  extra_socket_path: string;
  ssh_socket_path: string;
  scdaemon_running: boolean;
  scdaemon_socket: string;
  card_present: boolean;
  card_serial: string | null;
  keys_cached: number;
  pinentry_program: string;
  allow_loopback_pinentry: boolean;
  max_cache_ttl: number;
  default_cache_ttl: number;
  enable_ssh_support: boolean;
  total_operations: number;
}

export interface GpgAgentConfig {
  home_dir: string;
  gpg_binary: string;
  gpg_agent_binary: string;
  scdaemon_binary: string;
  default_key: string;
  auto_key_locate: string[];
  keyserver: string;
  keyserver_options: string[];
  pinentry_mode: PinentryMode;
  pinentry_program: string;
  max_cache_ttl: number;
  default_cache_ttl: number;
  enable_ssh_support: boolean;
  extra_socket: string;
  allow_loopback_pinentry: boolean;
  auto_expand_secmem: boolean;
  s2k_digest_algo: string;
  s2k_cipher_algo: string;
  personal_cipher_preferences: string;
  personal_digest_preferences: string;
  personal_compress_preferences: string;
  default_preference_list: string;
  agent_socket: string;
  scdaemon_options: string[];
  auto_start_agent: boolean;
  auto_start_scdaemon: boolean;
}

export interface KeyGenParams {
  key_type: GpgKeyAlgorithm;
  key_length: number;
  subkey_type: GpgKeyAlgorithm | null;
  subkey_length: number | null;
  name: string;
  email: string;
  comment: string;
  expiration: string | null;
  passphrase: string | null;
  capabilities: KeyCapability[];
}

export interface KeyServerResult {
  key_id: string;
  uid: string;
  creation_date: string;
  algorithm: string;
  bits: number;
  flags: string;
}

export interface SignatureResult {
  success: boolean;
  signature_data: number[];
  signature_armor: string;
  hash_algo: string;
  sig_class: string;
  signer_key_id: string;
  signer_fingerprint: string;
  created_at: string;
  expires_at: string | null;
}

export interface VerificationResult {
  valid: boolean;
  signature_status: SigStatus;
  signer_key_id: string;
  signer_fingerprint: string;
  signer_uid: string;
  creation_date: string;
  expiration_date: string | null;
  hash_algo: string;
  key_validity: KeyValidity;
  trust_level: string;
  notations: Notation[];
  policy_url: string | null;
}

export interface Notation {
  name: string;
  value: string;
  is_human_readable: boolean;
  is_critical: boolean;
}

export interface EncryptionResult {
  success: boolean;
  ciphertext: number[];
  armor: string;
  recipients: string[];
  session_key_algo: string;
  is_symmetric: boolean;
}

export interface DecryptionResult {
  success: boolean;
  plaintext: number[];
  session_key_algo: string;
  recipients: DecryptionRecipient[];
  signature_info: VerificationResult | null;
  filename: string | null;
}

export interface DecryptionRecipient {
  key_id: string;
  fingerprint: string;
  algorithm: string;
  status: string;
}

export interface TrustDbStats {
  total_keys: number;
  trusted_keys: number;
  marginal_trust: number;
  full_trust: number;
  ultimate_trust: number;
  revoked_keys: number;
  expired_keys: number;
  unknown_trust: number;
}

export interface KeyExportOptions {
  armor: boolean;
  include_secret: boolean;
  include_attributes: boolean;
  include_local_sigs: boolean;
  minimal: boolean;
  clean: boolean;
}

export interface KeyImportResult {
  total: number;
  imported: number;
  unchanged: number;
  no_user_id: number;
  new_keys: number;
  new_subkeys: number;
  new_signatures: number;
  new_revocations: number;
  secrets_read: number;
  secrets_imported: number;
  secrets_unchanged: number;
  not_imported: number;
}

export interface GpgAuditEntry {
  id: string;
  timestamp: string;
  action: GpgAuditAction;
  key_id: string | null;
  uid: string | null;
  details: string;
  success: boolean;
  error: string | null;
}
