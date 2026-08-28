import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `trust` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */

/** `POLICY_OPTIONS` in `sections/TrustVerificationSettings.tsx`. */
const CONCRETE_POLICY_VALUES = [
  "tofu",
  "Trust On First Use (TOFU)",
  "always-ask",
  "Always Ask",
  "always-trust",
  "Always Trust",
  "strict",
  "Strict",
] as const;

/** The same list plus the `inherit` sentinel used by the per-protocol rows. */
const INHERITABLE_POLICY_VALUES = [
  "inherit",
  "Inherit Default Policy",
  ...CONCRETE_POLICY_VALUES,
] as const;

/** Terms shared by every policy row, so `tofu` / `pin` reach all of them. */
const POLICY_TAGS = [
  "trust",
  "policy",
  "tofu",
  "trust on first use",
  "fingerprint",
  "pinning",
  "verification",
] as const;

export const TRUST_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Trust policies ─────────────────────────────────────────────
  {
    key: "trustPolicy",
    label: "Default Trust Policy",
    description:
      "Default trust policy inherited by every protocol and certificate policy that is set to Inherit.",
    tags: [...POLICY_TAGS, "default", "global", "inherit", "root"],
    synonyms: ["global trust policy", "fallback policy"],
    values: [...CONCRETE_POLICY_VALUES],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "certificateTrustPolicy",
    label: "General Certificate Policy",
    description:
      "Trust policy for non-HTTPS, non-RDP TLS certificates such as management and API endpoints.",
    tags: [
      ...POLICY_TAGS,
      "general certificate",
      "certificate",
      "tls",
      "ssl",
      "x509",
      "inherit",
    ],
    synonyms: ["cert policy", "x.509"],
    values: [...INHERITABLE_POLICY_VALUES],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "httpsTrustPolicy",
    label: "HTTPS Certificate Policy",
    description:
      "Trust policy applied to HTTPS server certificates in web browser sessions.",
    tags: [
      ...POLICY_TAGS,
      "https",
      "tls",
      "ssl",
      "certificate",
      "browser",
      "web",
      "inherit",
    ],
    synonyms: ["web certificate", "ssl policy"],
    values: [...INHERITABLE_POLICY_VALUES],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "sshTrustPolicy",
    label: "SSH Host Key Policy",
    description:
      "Trust policy applied to SSH host keys when connecting to a server for the first time or after a key change.",
    tags: [
      ...POLICY_TAGS,
      "ssh",
      "host key",
      "known_hosts",
      "openssh",
      "sftp",
      "inherit",
    ],
    synonyms: ["hostkey", "host key checking", "known hosts"],
    values: [...INHERITABLE_POLICY_VALUES],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "rdpTrustPolicy",
    label: "RDP Certificate Policy",
    description:
      "Trust policy applied to RDP server certificates presented during TLS/CredSSP negotiation.",
    tags: [
      ...POLICY_TAGS,
      "rdp",
      "remote desktop",
      "certificate",
      "credssp",
      "nla",
      "inherit",
    ],
    synonyms: ["terminal server certificate", "mstsc"],
    values: [...INHERITABLE_POLICY_VALUES],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustPolicyGuide",
    label: "Policy Guide",
    description:
      "Explains what each trust policy does — TOFU pins on first use, Always Ask prompts every time, Always Trust skips verification, Strict rejects anything not pre-approved.",
    tags: [
      ...POLICY_TAGS,
      "guide",
      "help",
      "explanation",
      "reference",
      "documentation",
    ],
    synonyms: ["policy help", "what does tofu mean"],
    values: [...CONCRETE_POLICY_VALUES],
    section: "trust",
    sectionLabel: "Trust Center",
  },

  // ─── Verification options ───────────────────────────────────────
  {
    key: "showTrustIdentityInfo",
    label: "Show certificate / host key info",
    description:
      "Reveal the resolved identity in the URL bar (web sessions) and the terminal toolbar (SSH sessions).",
    tags: [
      "trust",
      "identity",
      "info",
      "certificate",
      "host key",
      "url bar",
      "toolbar",
      "fingerprint",
    ],
    synonyms: ["show fingerprint", "identity badge"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "certExpiryWarningDays",
    label: "Warn when certificates expire",
    description:
      "Show an inline warning this many days before a stored certificate expires. Set to 0 to disable expiry warnings entirely.",
    tags: [
      "certificate",
      "expiry",
      "expiration",
      "warning",
      "days",
      "ssl",
      "tls",
      "renewal",
    ],
    synonyms: ["cert expiry", "expiring certificate", "renew warning"],
    values: ["0", "365", "days"],
    section: "trust",
    sectionLabel: "Trust Center",
  },

  // ─── Trust database, portability, legacy cleanup ────────────────
  {
    key: "trustDatabase",
    label: "Trust Database",
    labelKey: "trustCenter.database.title",
    description:
      "Which database stores the trusted hosts and certificates, and whether that file is encrypted or plaintext.",
    tags: [
      "database",
      "collection",
      "scope",
      "encrypted",
      "plaintext",
      "per-database",
      "trust",
      "storage",
    ],
    synonyms: ["trust store", "where are trust records stored"],
    values: ["Encrypted", "Plaintext"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustExportJson",
    label: "Export JSON",
    labelKey: "trustCenter.actions.exportJson",
    description:
      "Save this database's trusted hosts and certificates to a JSON file. Public key material only — no secrets.",
    descriptionKey: "trustCenter.actions.exportJsonHint",
    tags: [
      "export",
      "json",
      "backup",
      "trust",
      "certificate",
      "host key",
      "portable",
    ],
    synonyms: ["dump trust records", "save trust store"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustImportJson",
    label: "Import JSON",
    labelKey: "trustCenter.actions.importJson",
    description:
      "Merge trusted hosts and certificates from a JSON file. Revoked entries are never re-trusted.",
    descriptionKey: "trustCenter.actions.importJsonHint",
    tags: ["import", "json", "restore", "merge", "trust", "certificate"],
    synonyms: ["load trust records", "restore trust store"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustImportKnownHosts",
    label: "Import from known_hosts",
    labelKey: "trustCenter.actions.importKnownHosts",
    description:
      "Read OpenSSH's ~/.ssh/known_hosts and add every host key it contains to this database.",
    descriptionKey: "trustCenter.actions.importKnownHostsHint",
    tags: [
      "known_hosts",
      "ssh",
      "openssh",
      "host key",
      "import",
      "migrate",
      "putty",
    ],
    synonyms: ["known hosts", "ssh migration", "import host keys"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustLegacyStores",
    label: "Legacy trust files",
    labelKey: "trustCenter.legacy.title",
    description:
      "Review and delete the pre-per-database trust_store.json and rdp-cert-trust.json sidecars.",
    descriptionKey: "trustCenter.legacy.description",
    tags: [
      "legacy",
      "migration",
      "cleanup",
      "delete",
      "trust",
      "rdp",
      "sidecar",
    ],
    synonyms: ["trust_store.json", "rdp-cert-trust.json", "old trust files"],
    section: "trust",
    sectionLabel: "Trust Center",
  },

  // ─── Stored identities ──────────────────────────────────────────
  {
    key: "trustStoredIdentities",
    label: "Stored Identities",
    description:
      "Every memorized HTTPS certificate, general certificate, RDP certificate, SSH host key and legacy TLS identity — review, rename, re-scope, revoke or remove them.",
    tags: [
      "stored",
      "identities",
      "records",
      "revoke",
      "remove",
      "clear",
      "fingerprint",
      "https",
      "certificate",
      "rdp",
      "ssh",
      "host key",
      "legacy tls",
      "nickname",
    ],
    synonyms: [
      "pinned certificates",
      "trusted hosts",
      "forget host key",
      "clear all identities",
      "supermicro",
      "warpgate",
      "winrm",
      "bmc",
    ],
    values: [...INHERITABLE_POLICY_VALUES, "Inherit", "TOFU"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
];
