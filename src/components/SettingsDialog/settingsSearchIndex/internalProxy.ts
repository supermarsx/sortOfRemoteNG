import type { SettingSearchEntry } from "./types";

export const INTERNAL_PROXY_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "internalProxy.connectTimeoutSeconds",
    label: "Connect timeout",
    description:
      "Establish an upstream connection in 1 to 120 seconds (default 15). New sessions only.",
    tags: ["connect", "timeout", "transport", "seconds"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  {
    key: "internalProxy.requestTimeoutSeconds",
    label: "Request timeout",
    description:
      "Complete requests in 5 to 600 seconds (default 120); must be at least connect timeout.",
    tags: ["request", "timeout", "transport", "seconds"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  {
    key: "internalProxy.poolIdleTimeoutSeconds",
    label: "Pool idle timeout",
    description:
      "Retain idle pooled connections for 0 to 300 seconds (default 20).",
    tags: ["pool", "idle", "reuse", "transport"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  {
    key: "internalProxy.maxIdleConnectionsPerHost",
    label: "Maximum idle connections per host",
    description: "Retain 0 to 32 idle connections per host (default 4).",
    tags: ["pool", "idle", "connections", "host", "transport"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  {
    key: "internalProxy.tcpKeepaliveSeconds",
    label: "TCP keepalive interval",
    description:
      "Socket keepalive in 0 to 300 seconds (default 30); zero disables it. Separate from health checks.",
    tags: ["tcp", "socket", "keepalive", "transport", "disable"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  // ─── Internal Proxy Keepalive ───────────────────────────────────
  {
    key: "proxyKeepaliveEnabled",
    label: "Enable proxy health checks",
    description:
      "Periodically verify the local authentication proxy is still alive and responsive.",
    tags: [
      "proxy",
      "keepalive",
      "health",
      "check",
      "browser",
      "authentication",
      "alive",
      "probe",
    ],
    synonyms: [
      "keep alive",
      "health check",
      "dead proxy",
      "auth proxy",
      "internal proxy",
    ],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  {
    key: "proxyKeepaliveIntervalSeconds",
    label: "Health-check interval",
    description:
      "How often, in seconds, the proxy port is probed to verify it is still responding.",
    tags: [
      "proxy",
      "keepalive",
      "interval",
      "seconds",
      "timer",
      "probe",
      "port",
      "health",
    ],
    synonyms: ["keep alive interval", "probe interval", "proxy port"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  {
    key: "proxyAutoRestart",
    label: "Auto-restart dead proxies",
    description:
      "Automatically restart the local proxy process when a health check detects it has stopped responding.",
    tags: [
      "proxy",
      "restart",
      "auto",
      "recover",
      "dead",
      "health",
      "browser",
      "process",
    ],
    synonyms: ["auto restart", "self healing", "restart proxy", "recovery"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
  {
    key: "proxyMaxAutoRestarts",
    label: "Max consecutive auto-restarts",
    description:
      "Stop auto-restarting the proxy after this many consecutive failed attempts. Set to 0 for unlimited retries.",
    tags: [
      "proxy",
      "restart",
      "max",
      "limit",
      "attempts",
      "consecutive",
      "unlimited",
      "retries",
    ],
    synonyms: ["restart limit", "give up", "0 = unlimited"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },

  {
    key: "proxyRequestLogLimit",
    label: "Proxy request log limit",
    description:
      "Retain the newest diagnostic requests. Apply zero to clear and disable this log; HAR recordings are unaffected.",
    tags: ["proxy", "requests", "log", "limit", "retention", "capacity"],
    synonyms: ["10000", "newest first", "request history", "disable proxy log"],
    section: "internalProxy",
    sectionLabel: "Internal Proxy",
  },
];
