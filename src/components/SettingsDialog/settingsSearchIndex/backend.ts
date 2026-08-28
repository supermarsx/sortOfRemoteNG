import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `backend` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * `BackendSettings.tsx` writes its `options` arrays inline, so the guard reads
 * them from the AST and **fails** if a `value` or `label` below drifts from the
 * component. No label here comes from `t()`, so no entry carries a `labelKey`.
 */
export const BACKEND_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Runtime ────────────────────────────────────────────────────
  {
    key: "backendConfig.logLevel",
    label: "Log Level",
    description: "Verbosity of backend log output",
    tags: ["log", "logging", "verbosity", "level", "debug", "trace"],
    synonyms: ["log verbosity", "backend logs", "diagnostic level"],
    section: "backend",
    sectionLabel: "Backend",
    values: [
      "trace",
      "Trace",
      "debug",
      "Debug",
      "info",
      "Info",
      "warn",
      "Warn",
      "error",
      "Error",
    ],
  },
  {
    key: "backendConfig.maxConcurrentRdpSessions",
    label: "Max Concurrent RDP Sessions",
    description:
      "Hard ceiling on how many RDP sessions can be live at once. Beyond this, new connections wait until a slot frees up.",
    tags: ["rdp", "concurrent", "sessions", "limit", "max", "ceiling"],
    synonyms: ["session limit", "parallel sessions", "simultaneous rdp"],
    section: "backend",
    sectionLabel: "Backend",
  },

  // ─── RDP engine ─────────────────────────────────────────────────
  {
    key: "backendConfig.rdpServerRenderer",
    label: "Server-Side Renderer",
    description: "Rendering backend for server-side frame compositing",
    tags: ["renderer", "rendering", "gpu", "cpu", "compositing", "rdp"],
    synonyms: ["graphics backend", "render engine", "hardware acceleration"],
    section: "backend",
    sectionLabel: "Backend",
    values: [
      "auto",
      "Auto-detect",
      "softbuffer",
      "Softbuffer (CPU)",
      "wgpu",
      "wgpu (GPU)",
      "webview",
      "WebView (default)",
    ],
  },
  {
    key: "backendConfig.rdpCodecPreference",
    label: "Codec Preference",
    description: "Preferred codec for RDP frame encoding",
    tags: ["codec", "encoding", "h264", "remotefx", "gfx", "bitmap", "rdp"],
    synonyms: ["video codec", "rdpgfx", "frame encoding", "compression codec"],
    section: "backend",
    sectionLabel: "Backend",
    values: [
      "auto",
      "Auto-negotiate",
      "remotefx",
      "RemoteFX",
      "gfx",
      "RDPGFX",
      "h264",
      "H.264",
      "bitmap",
      "Bitmap (legacy)",
    ],
  },

  // ─── Network ────────────────────────────────────────────────────
  {
    key: "backendConfig.tcpDefaultBufferSize",
    label: "TCP Buffer Size",
    description:
      "Default send/receive buffer size for new TCP sockets. Larger buffers help on high-latency links; smaller buffers reduce memory.",
    tags: ["tcp", "buffer", "socket", "bytes", "network", "latency"],
    synonyms: ["socket buffer", "send buffer", "receive buffer"],
    section: "backend",
    sectionLabel: "Backend",
  },
  {
    key: "backendConfig.tcpKeepAliveSeconds",
    label: "Keep-Alive",
    description:
      "Interval for TCP keepalive probes. Lower values detect dead peers faster but generate more idle traffic.",
    tags: ["keepalive", "keep-alive", "tcp", "probe", "idle", "heartbeat"],
    synonyms: ["keep alive interval", "dead peer detection"],
    section: "backend",
    sectionLabel: "Backend",
  },
  {
    key: "backendConfig.connectionTimeoutSeconds",
    label: "Connection Timeout",
    description:
      "Maximum time to wait for a TCP connection to establish before giving up. Increase on slow or jittery networks.",
    tags: ["timeout", "connection", "tcp", "connect", "wait", "seconds"],
    synonyms: ["connect timeout", "dial timeout"],
    section: "backend",
    sectionLabel: "Backend",
  },

  // ─── Storage ────────────────────────────────────────────────────
  {
    key: "backendConfig.cacheSizeMb",
    label: "Cache Size",
    description: "Maximum memory for frame and bitmap caching",
    tags: ["cache", "memory", "ram", "bitmap", "frame", "mb"],
    synonyms: ["cache memory", "bitmap cache"],
    section: "backend",
    sectionLabel: "Backend",
  },
  {
    key: "backendConfig.tempFileCleanupEnabled",
    label: "Temp File Cleanup",
    description: "Auto-delete temporary files (screenshots, recordings)",
    tags: ["temp", "temporary", "cleanup", "delete", "disk", "housekeeping"],
    synonyms: ["tmp files", "clean temp directory", "purge temp"],
    section: "backend",
    sectionLabel: "Backend",
  },
  {
    key: "backendConfig.tempFileCleanupIntervalMinutes",
    label: "Cleanup Interval",
    description:
      "How often the temp directory is scanned for stale files when cleanup is enabled.",
    tags: ["cleanup", "interval", "temp", "schedule", "minutes"],
    synonyms: ["cleanup frequency", "temp scan interval"],
    section: "backend",
    sectionLabel: "Backend",
  },
];
