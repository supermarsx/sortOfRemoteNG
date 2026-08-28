import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `security` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const SECURITY_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Security ───────────────────────────────────────────────────
  {
    key: "encryptionAlgorithm",
    label: "Encryption Algorithm",
    description: "Encryption algorithm for stored data",
    tags: ["encryption", "aes", "crypto", "cipher"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "blockCipherMode",
    label: "Block Cipher Mode",
    description: "Block cipher mode of operation",
    tags: ["cipher", "gcm", "cbc", "encryption"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "keyDerivationIterations",
    label: "Key Derivation Iterations",
    description: "PBKDF2 iterations for key derivation",
    tags: ["pbkdf2", "iterations", "password", "key"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "exportSecurity",
    label: "Export Security",
    description:
      "Default export encryption, password strength, metadata, and content inclusion settings",
    tags: [
      "export",
      "encryption",
      "password",
      "strength",
      "entropy",
      "pbkdf2",
      "iterations",
      "metadata",
      "settings",
      "folders",
      "protocols",
    ],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "exportSecurity.keyDerivationIterations",
    label: "Export PBKDF2 Iterations",
    description: "PBKDF2 iterations used for password-encrypted export files",
    tags: ["export", "pbkdf2", "iterations", "bruteforce", "password"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "exportSecurity.showPasswordStrength",
    label: "Export Password Strength Meter",
    description: "Show entropy and password quality feedback in the export tab",
    tags: ["export", "password", "entropy", "strength", "common passwords"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "totpEnabled",
    label: "TOTP Enabled",
    description: "Enable TOTP two-factor authentication",
    tags: ["2fa", "totp", "authenticator", "two factor", "mfa"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "totpIssuer",
    label: "TOTP Issuer",
    description: "Default TOTP issuer name",
    tags: ["2fa", "totp", "issuer"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "totpDigits",
    label: "TOTP Digits",
    description: "Number of TOTP digits",
    tags: ["2fa", "totp", "digits", "length"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "totpPeriod",
    label: "TOTP Period",
    description: "TOTP code refresh period in seconds",
    tags: ["2fa", "totp", "period", "interval", "refresh"],
    section: "security",
    sectionLabel: "Security",
  },
  {
    key: "totpAlgorithm",
    label: "TOTP Algorithm",
    description: "TOTP hash algorithm",
    tags: ["2fa", "totp", "algorithm", "sha", "hash"],
    section: "security",
    sectionLabel: "Security",
  },
];
