import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `trust` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const TRUST_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Trust ──────────────────────────────────────────────────────
  {
    key: "trustPolicy",
    label: "Default Trust Policy",
    description:
      "Default trust policy inherited by protocol and certificate policies",
    tags: ["default", "global", "inherit", "trust", "tofu", "fingerprint"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "httpsTrustPolicy",
    label: "HTTPS Certificate Policy",
    description: "HTTPS certificate trust policy",
    tags: [
      "https",
      "tls",
      "ssl",
      "certificate",
      "trust",
      "inherit",
      "tofu",
      "fingerprint",
    ],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "certificateTrustPolicy",
    label: "General Certificate Policy",
    description: "General non-HTTPS/RDP certificate trust policy",
    tags: [
      "general certificate",
      "certificate",
      "tls",
      "ssl",
      "trust",
      "inherit",
      "tofu",
      "fingerprint",
    ],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "sshTrustPolicy",
    label: "SSH Host Key Policy",
    description: "SSH host key trust policy",
    tags: ["ssh", "host key", "trust", "tofu", "fingerprint"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "rdpTrustPolicy",
    label: "RDP Certificate Policy",
    description: "RDP server certificate trust policy",
    tags: [
      "rdp",
      "remote desktop",
      "certificate",
      "trust",
      "tofu",
      "fingerprint",
    ],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "tlsTrustPolicy",
    label: "Legacy TLS Trust Policy",
    description:
      "Deprecated fallback for legacy unclassified TLS certificate trust settings",
    tags: ["legacy tls", "tls", "ssl", "certificate", "trust", "deprecated"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "showTrustIdentityInfo",
    label: "Show Trust Info",
    description: "Show trust identity information",
    tags: ["trust", "identity", "info"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "certExpiryWarningDays",
    label: "Certificate Expiry Warning",
    description: "Days before certificate expiry to warn",
    tags: ["certificate", "expiry", "warning", "ssl"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustDatabase",
    label: "Trust Database",
    description:
      "Which database stores the trusted hosts and certificates, and whether that file is encrypted",
    tags: [
      "database",
      "collection",
      "scope",
      "encrypted",
      "plaintext",
      "per-database",
      "trust",
    ],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustExportJson",
    label: "Export Trust Records",
    description:
      "Save this database's trusted hosts and certificates to a JSON file",
    tags: ["export", "json", "backup", "trust", "certificate", "host key"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustImportJson",
    label: "Import Trust Records",
    description:
      "Merge trusted hosts and certificates from a JSON file into this database",
    tags: ["import", "json", "restore", "merge", "trust", "certificate"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustImportKnownHosts",
    label: "Import known_hosts",
    description:
      "Import SSH host keys from OpenSSH's ~/.ssh/known_hosts into the Trust Center",
    tags: ["known_hosts", "ssh", "openssh", "host key", "import", "migrate"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
  {
    key: "trustLegacyStores",
    label: "Legacy Trust Files",
    description:
      "Review and delete the pre-per-database trust_store.json and rdp-cert-trust.json sidecars",
    tags: ["legacy", "migration", "cleanup", "delete", "trust", "rdp"],
    section: "trust",
    sectionLabel: "Trust Center",
  },
];
