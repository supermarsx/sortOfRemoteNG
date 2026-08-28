import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `performance` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const PERFORMANCE_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Connection Retry ───────────────────────────────────────────
  {
    key: "retryAttempts",
    label: "Retry attempts",
    description:
      "Number of times to retry a failed connection before giving up. Set to 0 to disable retries.",
    tags: ["retry", "reconnect", "attempts", "failed", "connection", "give up"],
    synonyms: ["retries", "auto reconnect", "reconnect attempts"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "retryDelay",
    label: "Retry delay",
    description:
      "Time in milliseconds to wait between connection retry attempts.",
    tags: ["retry", "delay", "wait", "milliseconds", "ms", "backoff"],
    synonyms: ["reconnect delay", "retry interval"],
    section: "performance",
    sectionLabel: "Performance",
  },

  // ─── Performance Monitoring ─────────────────────────────────────
  {
    key: "enablePerformanceTracking",
    label: "Enable performance tracking",
    description:
      "Collect CPU, memory, and network latency metrics at regular intervals for monitoring dashboard display.",
    tags: [
      "performance",
      "tracking",
      "metrics",
      "cpu",
      "memory",
      "latency",
      "monitoring",
      "dashboard",
      "telemetry",
    ],
    synonyms: ["perf monitoring", "resource usage", "stats"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "performancePollIntervalMs",
    label: "Poll interval",
    description:
      "How often performance metrics are sampled. Lower values give more detail but use more resources.",
    tags: [
      "performance",
      "poll",
      "interval",
      "sample",
      "seconds",
      "metrics",
      "frequency",
    ],
    synonyms: ["sampling interval", "metrics interval"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "performanceLatencyTarget",
    label: "Latency target host",
    description:
      "IP address or hostname used to measure network latency via ping or HTTP request.",
    tags: [
      "latency",
      "target",
      "host",
      "ping",
      "hostname",
      "ip",
      "network",
      "probe",
    ],
    // The placeholder / fallback the field ships with — searchable verbatim.
    values: ["1.1.1.1"],
    synonyms: ["ping target", "latency host", "8.8.8.8", "cloudflare dns"],
    section: "performance",
    sectionLabel: "Performance",
  },

  // ─── Status Checking ────────────────────────────────────────────
  {
    key: "enableStatusChecking",
    label: "Enable status checking",
    description:
      "Periodically probe connections to determine if remote hosts are reachable and update their status indicators.",
    tags: [
      "status",
      "checking",
      "probe",
      "reachable",
      "health",
      "online",
      "offline",
      "indicator",
    ],
    synonyms: ["health check", "uptime check", "availability"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "statusCheckInterval",
    label: "Check interval",
    description:
      "Time in seconds between status check probes sent to each connection's host.",
    tags: ["status", "interval", "poll", "seconds", "check", "frequency"],
    synonyms: ["status poll", "health check interval"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "statusCheckMethod",
    label: "Check method",
    description:
      "Protocol used to check if a remote host is reachable. Socket is fastest; HTTP validates web services; Ping uses ICMP.",
    tags: [
      "status",
      "method",
      "protocol",
      "socket",
      "http",
      "ping",
      "icmp",
      "tcp",
      "probe",
    ],
    // `STATUS_CHECK_OPTIONS` in PerformanceSettings.tsx — both halves.
    values: [
      "socket",
      "Socket — direct TCP connection check",
      "http",
      "HTTP — HTTP request check",
      "ping",
      "Ping — ICMP echo check",
    ],
    synonyms: ["probe method", "reachability method"],
    section: "performance",
    sectionLabel: "Performance",
  },

  // ─── Action Logging ─────────────────────────────────────────────
  {
    key: "enableActionLog",
    label: "Enable action logging",
    description:
      "Record user actions like connections, disconnections, and setting changes in an internal log.",
    tags: ["log", "logging", "audit", "history", "actions", "trail", "record"],
    synonyms: ["audit log", "action history", "activity log"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "maxLogEntries",
    label: "Max log entries",
    description:
      "Maximum number of log entries to keep in memory. Oldest entries are discarded when the limit is reached.",
    tags: ["log", "entries", "limit", "max", "retention", "memory", "history"],
    synonyms: ["log size", "log retention", "log limit"],
    section: "performance",
    sectionLabel: "Performance",
  },
];
