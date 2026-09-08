import type { SettingSearchEntry } from "./types";

export const BOTS_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Telegram bots (integration panel) ──────────────────────────
  {
    key: "telegram.bots",
    label: "Telegram bots",
    labelKey: "integrations.telegram.title",
    description:
      "Configure Telegram bots for connection-event notifications, monitoring alerts, digests, and manual messaging. Bot tokens are stored encrypted in the OS credential vault, never in the settings file.",
    descriptionKey: "integrations.telegram.intro",
    tags: [
      "telegram",
      "bot",
      "notification",
      "alert",
      "webhook",
      "monitoring",
      "digest",
      "broadcast",
      "chat",
      "integration",
      "messaging",
    ],
    // The panel is a management console, not a set of persisted settings — the
    // one anchor covers all of it. These are the tab names inside it, so a user
    // searching "webhook" or "broadcast" lands on the right panel.
    values: [
      "Send",
      "Messages",
      "Chats",
      "Files",
      "Webhooks",
      "Notification rules",
      "Monitoring",
      "Templates",
      "Scheduled",
      "Broadcast",
      "Digests",
      "Logs",
    ],
    synonyms: [
      "telegram",
      "bot token",
      "chat id",
      "telegram notifications",
      "bot api",
    ],
    section: "bots",
    sectionLabel: "Bots",
  },
];
