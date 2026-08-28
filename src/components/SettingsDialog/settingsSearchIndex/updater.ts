import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `updater` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const UPDATER_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "updater.status",
    label: "Update status",
    labelKey: "updater.updateStatus",
    description:
      "Current version, last check time, endpoint mode, download progress, and the check / install / restart actions.",
    tags: [
      "update",
      "updater",
      "status",
      "version",
      "release",
      "download",
      "install",
      "restart",
      "relaunch",
      "msi",
      "github",
    ],
    // Status and endpoint-mode labels rendered in this card.
    values: [
      "Idle",
      "Checking",
      "Up to date",
      "Update available",
      "Downloading",
      "Installing",
      "Restart required",
      "Error",
      "Public only",
      "Private then public",
    ],
    synonyms: [
      "check for updates",
      "new version",
      "upgrade",
      "current version",
      "last checked",
    ],
    section: "updater",
    sectionLabel: "Updater",
  },
  {
    key: "updater.autoCheckEnabled",
    label: "Auto-check for updates",
    labelKey: "updater.autoCheck",
    description:
      "Check in the background without installing updates automatically. Checks never install updates without confirmation.",
    descriptionKey: "updater.autoCheckDescription",
    tags: [
      "update",
      "automatic",
      "auto",
      "check",
      "background",
      "cadence",
      "updater",
    ],
    synonyms: ["autoupdate", "automatic updates", "background check"],
    section: "updater",
    sectionLabel: "Updater",
  },
  {
    key: "updater.checkIntervalHours",
    label: "Check interval (hours)",
    labelKey: "updater.checkIntervalHours",
    description:
      "How often the app checks for signed updates while automatic checks are enabled. Valid range: 1 to 720 hours.",
    descriptionKey: "updater.checkIntervalDescription",
    tags: [
      "update",
      "interval",
      "hours",
      "schedule",
      "cadence",
      "frequency",
      "updater",
    ],
    synonyms: ["update frequency", "how often", "24 hours", "daily"],
    section: "updater",
    sectionLabel: "Updater",
  },
  {
    key: "updater.privateEndpointEnabled",
    label: "Use a private update feed first",
    labelKey: "updater.privateEndpointEnabled",
    description:
      "Try the configured private update feed before falling back to the public endpoint. Useful for staged releases, internal builds, or controlled update feeds.",
    descriptionKey: "updater.privateEndpointDescription",
    tags: [
      "update",
      "private",
      "feed",
      "endpoint",
      "enterprise",
      "internal",
      "staged",
      "channel",
    ],
    synonyms: [
      "private endpoint",
      "internal feed",
      "custom update server",
      "staged rollout",
    ],
    section: "updater",
    sectionLabel: "Updater",
  },
  {
    key: "updater.privateEndpointUrl",
    label: "Private endpoint URL",
    labelKey: "updater.privateEndpointUrl",
    description: "HTTPS URL for a Tauri-compatible update manifest.",
    descriptionKey: "updater.privateEndpointUrlTooltip",
    tags: [
      "update",
      "private",
      "endpoint",
      "url",
      "https",
      "manifest",
      "feed",
      "tauri",
      "json",
    ],
    values: ["https://updates.example.com/latest.json"],
    synonyms: ["update server url", "latest.json", "update manifest"],
    section: "updater",
    sectionLabel: "Updater",
  },
];
