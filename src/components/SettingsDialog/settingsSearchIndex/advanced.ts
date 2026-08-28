import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `advanced` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const ADVANCED_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Advanced ───────────────────────────────────────────────────
  {
    key: "enableTabDetachment",
    label: "Tab Detachment",
    description: "Allow tabs to be detached to separate windows",
    tags: ["tabs", "detach", "floating", "popup", "window"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "enableZoom",
    label: "Zoom",
    description: "Enable zoom controls",
    tags: ["zoom", "scale", "magnify"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "enableStatusChecking",
    label: "Status Checking",
    description: "Enable connection status checking",
    tags: ["status", "ping", "health", "monitoring"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "statusCheckInterval",
    label: "Status Check Interval",
    description: "Interval for status checks",
    tags: ["status", "interval", "poll"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "networkDiscovery",
    label: "Network Discovery",
    description: "Network discovery settings",
    tags: ["network", "scan", "discover", "subnet"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "enableActionLog",
    label: "Action Log",
    description: "Enable action logging",
    tags: ["log", "audit", "history", "actions"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "logLevel",
    label: "Log Level",
    description: "Logging verbosity level",
    tags: ["log", "debug", "verbose", "level"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "wolEnabled",
    label: "Wake-on-LAN",
    description: "Enable Wake-on-LAN",
    tags: ["wol", "wake", "lan", "power"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "exportEncryption",
    label: "Export Encryption",
    description: "Encrypt exported data",
    tags: ["export", "encryption", "secure", "password"],
    section: "advanced",
    sectionLabel: "Advanced",
  },
  {
    key: "protocolRepair",
    label: "Connection Maintenance",
    description:
      "Review and repair connections that were imported with the wrong protocol, such as HTTPS saved as RDP",
    tags: [
      "repair",
      "fix",
      "protocol",
      "rdp",
      "https",
      "import",
      "maintenance",
      "mremoteng",
    ],
    section: "advanced",
    sectionLabel: "Advanced",
  },
];
