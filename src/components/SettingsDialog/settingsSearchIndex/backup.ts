import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `backup` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * No control in this tab renders its label through `t()`, so no entry carries a
 * `labelKey`. Option lists are all built with `.map()` over the `as const`
 * tables in `types/settings/backupSettings.ts` and the label records in
 * `hooks/settings/useBackupSettings.ts`, so the guard cannot read them — the
 * `values` below are transcribed from those tables by hand and must be kept in
 * step with them.
 */
export const BACKUP_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Enable / run ───────────────────────────────────────────────
  {
    key: "backup.enabled",
    label: "Enable automatic backups",
    description:
      "Automatically back up your connections and settings on a schedule",
    tags: ["backup", "automatic", "enable", "schedule", "auto backup"],
    synonyms: ["autobackup", "scheduled backup", "turn on backups"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.runNow",
    label: "Backup Now",
    description:
      "Run a one-off backup immediately to every enabled destination",
    tags: ["backup now", "run", "manual", "on demand", "immediate"],
    synonyms: ["run backup", "backup immediately", "force backup"],
    section: "backup",
    sectionLabel: "Backup",
  },

  // ─── Destinations ───────────────────────────────────────────────
  {
    key: "backup.destinations",
    label: "Backup destinations",
    description:
      "Where backups are written. The scheduled backup writes the same payload to every enabled destination — local folders and cloud sync folders alike.",
    tags: [
      "destination",
      "location",
      "folder",
      "path",
      "target",
      "where",
      "cloud",
      "add destination",
      "retention override",
    ],
    synonyms: [
      "backup folder",
      "backup path",
      "backup location",
      "save location",
    ],
    section: "backup",
    sectionLabel: "Backup",
    values: [
      "add",
      "Choose a preset…",
      "custom",
      "Custom Location",
      "appData",
      "App Data Folder",
      "documents",
      "Documents Folder",
      "googleDrive",
      "Google Drive",
      "oneDrive",
      "OneDrive",
      "nextcloud",
      "Nextcloud",
      "dropbox",
      "Dropbox",
    ],
  },

  // ─── Schedule ───────────────────────────────────────────────────
  {
    key: "backup.frequency",
    label: "Frequency",
    description:
      "How often automatic backups are created. Choose manual to only back up on demand.",
    tags: ["frequency", "schedule", "how often", "interval", "backup schedule"],
    synonyms: ["cron", "recurrence", "periodic", "how often to back up"],
    section: "backup",
    sectionLabel: "Backup",
    values: [
      "manual",
      "Manual Only",
      "hourly",
      "Every Hour",
      "daily",
      "Daily",
      "weekly",
      "Weekly",
      "monthly",
      "Monthly",
    ],
  },
  {
    key: "backup.scheduledTime",
    label: "Time",
    description:
      "The time of day when the scheduled backup will run (local time).",
    tags: ["time", "time of day", "schedule", "clock", "when", "hour"],
    synonyms: ["backup time", "run at", "time of day"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.weeklyDay",
    label: "Day of Week",
    description: "The day of the week on which the weekly backup will run.",
    tags: ["day of week", "weekly", "schedule", "weekday"],
    synonyms: ["weekly backup day"],
    section: "backup",
    sectionLabel: "Backup",
    values: [
      "sunday",
      "Sunday",
      "monday",
      "Monday",
      "tuesday",
      "Tuesday",
      "wednesday",
      "Wednesday",
      "thursday",
      "Thursday",
      "friday",
      "Friday",
      "saturday",
      "Saturday",
    ],
  },
  {
    key: "backup.monthlyDay",
    label: "Day of Month",
    description:
      "The day of the month on which the monthly backup will run. Capped at 28 to avoid skipped months.",
    tags: ["day of month", "monthly", "schedule", "date"],
    synonyms: ["monthly backup day"],
    section: "backup",
    sectionLabel: "Backup",
    values: Array.from({ length: 28 }, (_, i) => String(i + 1)),
  },

  // ─── Delta verification ─────────────────────────────────────────
  {
    key: "backup.deltaSkipEnabled",
    label: "Skip emitting unchanged backups",
    description:
      "Compares a SHA-256 hash of the pre-encryption payload to the previous successful run's hash, per destination.",
    tags: [
      "delta",
      "skip",
      "unchanged",
      "hash",
      "sha256",
      "deduplicate",
      "delta verification",
    ],
    synonyms: ["dedupe", "sha-256", "identical payload", "no-op backup"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.forceEmitEveryNSkippedTicks",
    label: "Force backup after N skips",
    description:
      "Safety valve so a long stretch of unchanged ticks doesn't void the retention rotation. 0 disables forcing — skip indefinitely.",
    tags: ["force", "skips", "ticks", "delta", "safety valve", "retention"],
    synonyms: ["force emit", "guaranteed backup"],
    section: "backup",
    sectionLabel: "Backup",
  },

  // ─── Differential ───────────────────────────────────────────────
  {
    key: "backup.differentialEnabled",
    label: "Enable Differential Backups",
    description: "Only backup changes since the last full backup (saves space)",
    tags: ["differential", "incremental", "diff", "changes only", "space"],
    synonyms: ["incremental backup", "delta backup"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.fullBackupInterval",
    label: "Full backup interval",
    description:
      "A full backup is created every N differential backups so restores never need to replay too many diffs.",
    tags: ["full backup", "interval", "differential", "anchor", "restore"],
    synonyms: ["full backup every"],
    section: "backup",
    sectionLabel: "Backup",
  },

  // ─── Format & content ───────────────────────────────────────────
  {
    key: "backup.format",
    label: "Backup Format",
    description:
      "The file format used for backup archives. JSON is human-readable; binary formats are more compact.",
    tags: ["format", "file format", "json", "xml", "archive", "export"],
    synonyms: ["mremoteng", "file type", "extension"],
    section: "backup",
    sectionLabel: "Backup",
    values: [
      "json",
      "JSON (Human-readable)",
      "xml",
      "XML (mRemoteNG compatible)",
      "encrypted-json",
      "Encrypted JSON",
    ],
  },
  {
    key: "backup.maxBackupsToKeep",
    label: "Keep Last X Backups",
    description:
      "Maximum number of backup files to retain. Older backups are automatically deleted. Set to 0 to keep all.",
    tags: ["retention", "keep", "rotate", "prune", "max backups", "history"],
    synonyms: ["retention policy", "how many backups", "keep last"],
    section: "backup",
    sectionLabel: "Backup",
    values: ["5", "10", "30", "60", "0", "∞"],
  },
  {
    key: "backup.includePasswords",
    label: "Include Passwords",
    description: "Include saved connection passwords in backups (encrypted)",
    tags: ["passwords", "credentials", "include", "secrets"],
    synonyms: ["save passwords", "back up credentials"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.includeSettings",
    label: "Include Settings",
    description: "Include application preferences and global settings",
    tags: ["settings", "preferences", "include", "config"],
    synonyms: ["back up settings", "back up preferences"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.includeSSHKeys",
    label: "Include SSH Keys",
    description:
      "Include SSH private keys (handle with care — grants server access)",
    tags: ["ssh", "keys", "private key", "include", "identity"],
    synonyms: ["ssh key", "id_rsa", "private keys"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.compressBackups",
    label: "Compress Backups",
    description: "Compress backup files to reduce disk space usage",
    tags: ["compress", "compression", "zip", "gzip", "disk space", "size"],
    synonyms: ["archive compression", "shrink"],
    section: "backup",
    sectionLabel: "Backup",
  },

  // ─── Encryption ─────────────────────────────────────────────────
  {
    key: "backup.encryptBackups",
    label: "Encrypt Backups",
    description: "Password-protect backup files",
    tags: ["encrypt", "encryption", "password", "protect", "cipher"],
    synonyms: ["encrypted backup", "password protect"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.encryptionAlgorithm",
    label: "Encryption Algorithm",
    description:
      "The cipher used to encrypt backup files. AES-256-GCM is recommended for strong authenticated encryption.",
    tags: ["algorithm", "cipher", "encryption", "aes", "chacha", "gcm", "cbc"],
    synonyms: [
      "aes256",
      "chacha20",
      "poly1305",
      "serpent",
      "twofish",
      "authenticated encryption",
    ],
    section: "backup",
    sectionLabel: "Backup",
    values: [
      "AES-256-GCM",
      "AES-256-GCM (Recommended)",
      "AES-256-CBC",
      "AES-128-GCM",
      "AES-128-GCM (Faster)",
      "ChaCha20-Poly1305",
      "ChaCha20-Poly1305 (Modern)",
      "Serpent-256-GCM",
      "Serpent-256-GCM (High Security)",
      "Serpent-256-CBC",
      "Twofish-256-GCM",
      "Twofish-256-GCM (Fast & Secure)",
      "Twofish-256-CBC",
    ],
  },
  {
    key: "backup.encryptionPassword",
    label: "Encryption password",
    description:
      "The password used to derive the encryption key. Keep this safe — backups cannot be restored without it.",
    tags: ["password", "passphrase", "encryption", "key", "secret"],
    synonyms: ["backup password", "decryption password"],
    section: "backup",
    sectionLabel: "Backup",
  },

  // ─── Advanced ───────────────────────────────────────────────────
  {
    key: "backup.backupOnClose",
    label: "Backup on App Close",
    description: "Create a backup when closing the application",
    tags: ["on close", "shutdown", "exit", "quit", "backup on exit"],
    synonyms: ["backup on shutdown", "backup on quit"],
    section: "backup",
    sectionLabel: "Backup",
  },
  {
    key: "backup.notifyOnBackup",
    label: "Show Notifications",
    description: "Display a notification after successful backup",
    tags: ["notification", "notify", "toast", "alert", "desktop notification"],
    synonyms: ["backup notification", "silent backup"],
    section: "backup",
    sectionLabel: "Backup",
  },
];
