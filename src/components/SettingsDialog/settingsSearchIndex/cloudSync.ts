import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `cloudSync` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * No control in this tab renders its label through `t()`, so no entry carries a
 * `labelKey`.
 *
 * **Per-target provider credentials are deliberately not indexed as their own
 * entries.** `cloudSync/ProviderConfig.tsx` renders exactly one provider's
 * fields, and only while a target row is expanded, so an entry keyed on
 * `serverUrl` or `bearerToken` would navigate nowhere for most of the app's
 * life. Instead the whole provider vocabulary — WebDAV, Nextcloud, SFTP, the
 * auth methods, app passwords, folder paths — lives in the `values` and
 * `synonyms` of `cloudSync.syncTargets`, which anchors to the always-present
 * "Add target" picker.
 */
export const CLOUD_SYNC_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "cloudSync.autoUnlockOsVaultDatabases",
    label: "Automatically unlock OS-vault databases for sync",
    description:
      "Opt in to unlocking selected protected databases with this device's OS vault before syncing, without switching the active database.",
    tags: ["database", "unlock", "locked", "os vault", "sync", "keychain"],
    synonyms: [
      "automatic unlock",
      "unavailable database",
      "credential manager",
    ],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.remoteDatabases",
    label: "Remote databases",
    description:
      "Browse a sync target and pull protected databases that are not on this device.",
    tags: [
      "database",
      "remote",
      "download",
      "pull",
      "restore",
      "sync",
      "new device",
    ],
    synonyms: ["missing database", "download database", "restore from cloud"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  // ─── Enable / run ───────────────────────────────────────────────
  {
    key: "cloudSync.enabled",
    label: "Enable cloud sync",
    description: "Synchronize your connections and settings across devices",
    tags: ["cloud", "sync", "enable", "synchronize", "devices"],
    synonyms: ["cloud sync", "turn on sync", "sync across devices"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.syncNow",
    label: "Sync All",
    description: "Run a sync immediately against every enabled sync target",
    tags: ["sync now", "sync all", "manual", "on demand", "run"],
    synonyms: ["force sync", "sync immediately"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },

  // ─── Targets & providers ────────────────────────────────────────
  {
    key: "cloudSync.syncTargets",
    label: "Sync targets",
    description:
      "Named sync destinations, each with its own cloud provider, credentials and remote folder. Run several in parallel or mix providers.",
    tags: [
      "target",
      "provider",
      "account",
      "credentials",
      "google drive",
      "onedrive",
      "nextcloud",
      "webdav",
      "sftp",
      "server url",
      "folder path",
      "add target",
    ],
    synonyms: [
      "cloud provider",
      "microsoft onedrive",
      "app password",
      "bearer token",
      "basic auth",
      "digest auth",
      "remote folder",
      "ssh key sync",
      "self hosted",
      "owncloud",
    ],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
    values: [
      "add",
      "Choose a provider…",
      "googleDrive",
      "Google Drive",
      "oneDrive",
      "Microsoft OneDrive",
      "nextcloud",
      "Nextcloud",
      "webdav",
      "WebDAV Server",
      "sftp",
      "SFTP Server",
      // Per-provider credential fields, reachable from this section.
      "basic",
      "Basic Authentication",
      "digest",
      "Digest Authentication",
      "bearer",
      "Bearer Token",
      "password",
      "Password",
      "key",
      "SSH Key",
      "Use App Password (Recommended)",
      "Server URL",
      "WebDAV URL",
      "Folder Path",
      "Remote Folder Path",
      "Passphrase",
      "Private Key",
    ],
  },

  // ─── Frequency ──────────────────────────────────────────────────
  {
    key: "cloudSync.frequency",
    label: "Frequency",
    description:
      "How often the app syncs in the background. Set to manual to only sync on demand.",
    tags: ["frequency", "how often", "interval", "schedule", "sync frequency"],
    synonyms: ["sync interval", "sync schedule", "periodic sync"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
    values: [
      "manual",
      "Manual Only",
      "realtime",
      "Real-time (Instant)",
      "onSave",
      "On Save",
      "every5Minutes",
      "Every 5 Minutes",
      "every15Minutes",
      "Every 15 Minutes",
      "every30Minutes",
      "Every 30 Minutes",
      "hourly",
      "Every Hour",
      "daily",
      "Once Daily",
      "custom",
      "Custom Interval",
    ],
  },
  {
    key: "cloudSync.customIntervalMinutes",
    label: "Custom Interval",
    description: "Choose a whole-number sync interval from 1 minute to 7 days.",
    tags: ["custom", "interval", "schedule", "sync", "frequency"],
    synonyms: ["custom sync interval", "sync every"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.customIntervalUnit",
    label: "Interval Unit",
    description: "Set the custom sync interval in minutes, hours or days.",
    tags: ["custom", "interval", "unit", "sync", "frequency"],
    synonyms: ["sync interval unit", "sync minutes", "sync hours", "sync days"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
    values: ["minutes", "Minutes", "hours", "Hours", "days", "Days"],
  },

  // ─── What to sync ───────────────────────────────────────────────
  {
    key: "cloudSync.selectedItems",
    label: "What to Sync — Stored Files and Libraries",
    description:
      "Select actual database archives, saved scripts, terminal and website macros, and portable appearance preferences. Locked items show why they are unavailable.",
    tags: [
      "connections",
      "documents",
      "vault",
      "trust",
      "inventory",
      "files",
      "databases",
      "scripts",
      "macros",
      "settings",
      "what to sync",
    ],
    synonyms: [
      "sync connections",
      "sync settings",
      "sync scripts",
      "sync ssh keys",
      "refresh inventory",
      "select all available",
      "sync preferences",
    ],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },

  // ─── Encryption ─────────────────────────────────────────────────
  {
    key: "cloudSync.encryptBeforeSync",
    label: "Encrypt Before Sync",
    description: "End-to-end encrypt data before uploading to cloud",
    tags: ["encrypt", "encryption", "e2e", "end-to-end", "zero knowledge"],
    synonyms: ["client side encryption", "encrypt uploads"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.syncEncryptionPassword",
    label: "Encryption password",
    description:
      "The password used to derive the encryption key. The same password is required on every device that participates in the sync.",
    tags: ["password", "passphrase", "encryption", "key", "secret"],
    synonyms: ["sync password", "decryption password"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },

  // ─── Conflicts ──────────────────────────────────────────────────
  {
    key: "cloudSync.conflictResolution",
    label: "Strategy",
    description:
      "How to reconcile when the local copy and the cloud copy have both changed since the last sync.",
    tags: [
      "conflict",
      "resolution",
      "strategy",
      "merge",
      "local",
      "remote",
      "diverged",
    ],
    synonyms: ["conflict resolution", "merge strategy", "who wins"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
    values: [
      "askEveryTime",
      "Ask Every Time",
      "keepLocal",
      "Always Keep Local",
      "keepRemote",
      "Always Keep Remote",
      "keepNewer",
      "Newer when unambiguous",
      "merge",
      "Attempt to Merge",
    ],
  },

  // ─── Startup & shutdown ─────────────────────────────────────────
  {
    key: "cloudSync.syncOnStartup",
    label: "Sync on Startup",
    description: "Pull the latest data from the cloud when the app launches",
    tags: ["startup", "launch", "boot", "sync", "on start"],
    synonyms: ["sync at launch", "pull on startup"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.syncOnShutdown",
    label: "Sync on Shutdown",
    description: "Push pending local changes when the app closes",
    tags: ["shutdown", "exit", "quit", "close", "sync"],
    synonyms: ["sync on exit", "push on close"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },

  // ─── Notifications ──────────────────────────────────────────────
  {
    key: "cloudSync.notifyOnSync",
    label: "Notify on Sync Failure",
    description: "Show an in-app notification when sync does not complete",
    tags: ["notification", "notify", "desktop", "toast", "sync"],
    synonyms: ["sync notification"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.notifyOnSyncSuccess",
    label: "Notify on Sync Success",
    description:
      "Show a toast when cloud sync completes successfully; off by default",
    tags: ["notification", "notify", "success", "completed", "toast", "sync"],
    synonyms: ["sync success notification", "silent sync"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.failureNotificationIntervalMinutes",
    label: "Sync Failure Notification Interval",
    description:
      "Limit repeated sync failure toasts; defaults to once every 30 minutes. 0 shows every failure.",
    tags: [
      "failure",
      "error",
      "notification",
      "toast",
      "interval",
      "cooldown",
      "minutes",
    ],
    synonyms: ["sync notification frequency", "failure reminder"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.notifyOnConflict",
    label: "Notify on Conflict",
    description: "Show a notification when a sync conflict needs attention",
    tags: ["notification", "notify", "conflict", "alert", "warning"],
    synonyms: ["conflict notification"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },

  // ─── Advanced ───────────────────────────────────────────────────
  {
    key: "cloudSync.compressionEnabled",
    label: "Enable Compression",
    description: "Compress payloads before uploading to save bandwidth",
    tags: ["compression", "compress", "gzip", "bandwidth", "size"],
    synonyms: ["compress uploads"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.maxFileSizeMB",
    label: "Maximum Sync Snapshot Size",
    description:
      "Maximum complete sync snapshot size, from 1 to 100 MiB, including encrypted and encoded overhead. Oversized snapshots are rejected.",
    tags: ["max file size", "limit", "snapshot", "megabytes", "mb", "mib"],
    synonyms: ["file size limit", "largest file"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.uploadLimitKBs",
    label: "Upload Limit",
    description:
      "Throttle upload bandwidth in kilobytes per second. 0 means unlimited.",
    tags: ["upload", "limit", "throttle", "bandwidth", "rate limit", "kb/s"],
    synonyms: ["upload speed", "upload throttle", "bandwidth cap"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.downloadLimitKBs",
    label: "Download Limit",
    description:
      "Throttle download bandwidth in kilobytes per second. 0 means unlimited.",
    tags: ["download", "limit", "throttle", "bandwidth", "rate limit", "kb/s"],
    synonyms: ["download speed", "download throttle", "bandwidth cap"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
  {
    key: "cloudSync.excludePatterns",
    label: "Exclude Patterns",
    description:
      "Glob patterns (one per line) for files to skip during sync. Useful for temp files, caches, or local-only data.",
    tags: ["exclude", "ignore", "pattern", "glob", "filter", "skip"],
    synonyms: ["ignore list", "exclusion", "gitignore", "wildcards"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
    values: [
      "Add a preset…",
      "temp",
      "Temp & backup files",
      "os",
      "OS metadata files",
      "logs",
      "Logs",
      "vcs",
      "Version control",
      "build",
      "Build artifacts",
      "secrets",
      "Secrets & env files",
    ],
  },
];
