import {
  GlobalSettings,
  ToolDisplayModes,
  ActionLogEntry,
  PerformanceMetrics,
  CustomScript,
  defaultBackupConfig,
  migrateBackupConfig,
  migrateCloudSyncConfig,
  defaultSSHTerminalConfig,
  defaultSSHConnectionConfig,
  mergeSSHTerminalConfig,
  mergeSSHConnectionConfig,
  defaultCloudSyncConfig,
  defaultDiagnosticsConfig,
  defaultMemoryWatchdogSettings,
  defaultExportSecuritySettings,
} from "../../types/settings/settings";
import { DEFAULT_LOADING_ELEMENT_SETTINGS } from "../../components/ui/display/loadingElement/defaults";
import { DEFAULT_MCP_CONFIG } from "../../types/mcp/mcpServer";
import { SecureStorage } from "../storage/storage";
import { IndexedDbService } from "../storage/indexedDbService";
import { generateId } from "../core/id";
import { getInvoke as tauriInvoke } from "../tauri/invoke";
import { normalizeSshReconnectSettings } from "../ssh/sshReconnectPolicy";

/** Cached window label used as diagnostic metadata in sync envelopes. */
let _windowLabel: string | null = null;
async function getWindowLabel(): Promise<string> {
  if (_windowLabel) return _windowLabel;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    _windowLabel = getCurrentWindow().label;
  } catch {
    _windowLabel = "main";
  }
  return _windowLabel;
}

export const SETTINGS_SYNC_EVENT = "settings-sync";
export const SETTINGS_SYNC_VERSION = 1 as const;

export interface SettingsSyncPayload {
  version: typeof SETTINGS_SYNC_VERSION;
  source: string;
  writerId: string;
  revision: number;
  /** Process-wide native commit order when supplied by write_app_settings. */
  commitGeneration?: number;
  settings: GlobalSettings;
}

export interface SettingsSyncRuntime {
  getSource: () => Promise<string>;
  emit: (payload: SettingsSyncPayload) => Promise<void>;
  listen: (handler: (payload: unknown) => Promise<void>) => Promise<() => void>;
}

export interface SettingsManagerOptions {
  settingsSyncRuntime?: SettingsSyncRuntime;
  settingsSyncWriterId?: string;
  now?: () => number;
}

type SettingsSyncStamp = Pick<
  SettingsSyncPayload,
  "revision" | "writerId" | "commitGeneration"
>;

export type SettingsSyncDecision<T> =
  | { kind: "accepted"; payload: SettingsSyncPayload; settings: T }
  | { kind: "self" | "stale" | "malformed" };

const createSettingsSyncWriterId = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to the repository ID helper.
  }
  return generateId();
};

const parseSettingsSyncPayload = (
  candidate: unknown,
): SettingsSyncPayload | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const value = candidate as Record<string, unknown>;
  if (
    value.version !== SETTINGS_SYNC_VERSION ||
    typeof value.source !== "string" ||
    value.source.length === 0 ||
    typeof value.writerId !== "string" ||
    value.writerId.length === 0 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) <= 0 ||
    (value.commitGeneration !== undefined &&
      (!Number.isSafeInteger(value.commitGeneration) ||
        (value.commitGeneration as number) <= 0)) ||
    !value.settings ||
    typeof value.settings !== "object" ||
    Array.isArray(value.settings)
  ) {
    return null;
  }
  return value as unknown as SettingsSyncPayload;
};

/**
 * A deterministic hybrid logical clock for full settings snapshots.
 * Revisions are time-seeded so a newly opened window can supersede an older
 * writer, then increment monotonically for multiple saves in the same
 * millisecond. Writer IDs break otherwise-equal revisions consistently.
 */
export class SettingsSyncRevisionTracker {
  private logicalRevision = 0;
  private current: SettingsSyncStamp = { revision: 0, writerId: "" };

  constructor(
    readonly writerId: string = createSettingsSyncWriterId(),
    private readonly now: () => number = Date.now,
  ) {}

  private stamp(payload: SettingsSyncStamp): SettingsSyncStamp {
    return {
      revision: payload.revision,
      writerId: payload.writerId,
      ...(payload.commitGeneration === undefined
        ? {}
        : { commitGeneration: payload.commitGeneration }),
    };
  }

  private compare(left: SettingsSyncStamp, right: SettingsSyncStamp): number {
    if (
      left.commitGeneration !== undefined ||
      right.commitGeneration !== undefined
    ) {
      if (left.commitGeneration === undefined) return -1;
      if (right.commitGeneration === undefined) return 1;
      if (left.commitGeneration !== right.commitGeneration) {
        return left.commitGeneration - right.commitGeneration;
      }
    }
    if (left.revision !== right.revision) {
      return left.revision - right.revision;
    }
    return left.writerId.localeCompare(right.writerId);
  }

  next(
    source: string,
    settings: GlobalSettings,
    commitGeneration?: number,
  ): SettingsSyncPayload {
    const wallClockRevision = Math.max(1, Math.floor(this.now()));
    this.logicalRevision = Math.max(
      wallClockRevision,
      this.logicalRevision + 1,
      this.current.revision + 1,
    );
    const payload: SettingsSyncPayload = {
      version: SETTINGS_SYNC_VERSION,
      source,
      writerId: this.writerId,
      revision: this.logicalRevision,
      ...(commitGeneration === undefined ? {} : { commitGeneration }),
      settings,
    };
    if (this.compare(payload, this.current) > 0) {
      this.current = this.stamp(payload);
    }
    return payload;
  }

  accept<T>(
    candidate: unknown,
    validateSettings: (settings: unknown) => T | null,
  ): SettingsSyncDecision<T> {
    const payload = parseSettingsSyncPayload(candidate);
    if (!payload) return { kind: "malformed" };
    if (payload.writerId === this.writerId) return { kind: "self" };
    if (this.compare(payload, this.current) <= 0) return { kind: "stale" };

    const settings = validateSettings(payload.settings);
    if (!settings) return { kind: "malformed" };

    this.logicalRevision = Math.max(this.logicalRevision, payload.revision);
    this.current = this.stamp(payload);
    return { kind: "accepted", payload, settings };
  }

  isCurrent(payload: SettingsSyncPayload): boolean {
    return (
      payload.revision === this.current.revision &&
      payload.writerId === this.current.writerId &&
      payload.commitGeneration === this.current.commitGeneration
    );
  }
}

const defaultSettingsSyncRuntime: SettingsSyncRuntime = {
  getSource: getWindowLabel,
  async emit(payload) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(SETTINGS_SYNC_EVENT, payload);
  },
  async listen(handler) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>(SETTINGS_SYNC_EVENT, (event) => {
      void handler(event.payload).catch((error) => {
        console.error("Failed to apply synchronized settings:", error);
      });
    });
  },
};

/**
 * Module-level in-memory settings store for non-Tauri runtimes (jsdom
 * tests, plain-browser dev server). The desktop shell persists to
 * `<app_data_dir>/settings.json` via the backend, which is the
 * authoritative store. When there is no Tauri `invoke` there is no disk
 * to write to, so we keep the last-written blob here so reads round-trip
 * within a session. This is deliberately *not* IndexedDB — all IndexedDB
 * settings persistence (and its read/write fallbacks) was removed; the
 * Tauri disk file is the single source of truth.
 *
 * NOTE: this store is module-scoped (survives `SettingsManager.resetInstance()`
 * the same way IndexedDB did) but does NOT persist across reloads/processes.
 * Browser/test runs were never the shipped persistence path — the desktop
 * shell always has a Tauri invoke — so no real user data lives here.
 */
let _inMemorySettingsStore: Partial<GlobalSettings> | null = null;

/**
 * Test-only escape hatch to reset the in-memory non-Tauri settings store.
 * Production code never calls this.
 */
export function _resetInMemorySettingsStore(): void {
  _inMemorySettingsStore = null;
}

/** Number of disk-write attempts (1 initial + retries) before giving up. */
const SETTINGS_WRITE_MAX_ATTEMPTS = 3;
/** Base backoff in ms between disk-write attempts (grows linearly per attempt). */
const SETTINGS_WRITE_RETRY_BASE_MS = 150;

/**
 * Dispatch a `window` CustomEvent describing a settings-write failure so a
 * mounted React hook can surface a toast. Mirrors the existing
 * `settings-updated` dispatch pattern — this class never imports React/Toast.
 */
function dispatchWriteFailed(
  error: string,
  attempt: number,
  maxAttempts: number,
  willRetry: boolean,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("settings-write-failed", {
      detail: { error, attempt, maxAttempts, willRetry },
    }),
  );
}

/**
 * Dispatch a `window` CustomEvent signalling that a settings write
 * succeeded after one or more prior failed attempts, so the toast hook can
 * clear/replace any failure notice.
 */
function dispatchWriteRecovered(attempt: number, maxAttempts: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("settings-write-recovered", {
      detail: { attempt, maxAttempts },
    }),
  );
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Default global application settings. These values are used when no user
 * settings have been persisted. Any settings not provided by the user will
 * fall back to these defaults.
 */
const DEFAULT_SETTINGS: GlobalSettings = {
  language: "en-US",
  autoDetectOsLanguage: true,
  region: "auto",
  timeFormat: "auto",
  dateFormat: "auto",
  timeZone: "auto",
  calendarSystem: "auto",
  numberingSystem: "auto",
  rtlLayout: false,
  theme: "dark",
  colorScheme: "blue",
  primaryAccentColor: "#3b82f6",
  useCustomAccent: false,
  customCss: "",
  autoSaveEnabled: false,
  autoSaveIntervalMinutes: 5,
  singleWindowMode: false,
  singleConnectionMode: false,
  reconnectOnReload: true,
  warnOnClose: true,
  warnOnExit: true,
  warnOnDetachClose: true,
  quickConnectHistoryEnabled: true,
  quickConnectHistory: [],
  detectUnexpectedClose: true,
  confirmMainAppClose: false,
  hideQuickStartMessage: false,
  hideQuickStartButtons: false,
  welcomeScreenTitle: undefined,
  welcomeScreenMessage: undefined,

  // Startup Settings
  startMinimized: false,
  startMaximized: false,
  startWithSystem: false,
  reconnectPreviousSessions: false,
  autoOpenLastCollection: true,
  lastOpenedCollectionId: undefined,

  // Tray Settings
  minimizeToTray: false,
  closeToTray: false,
  showTrayIcon: true,

  // Click Action Settings
  singleClickConnect: false,
  singleClickDisconnect: false,
  doubleClickRename: false,
  doubleClickConnect: true,
  middleClickCloseTab: true,
  folderSingleClickToggle: true,
  folderDoubleClickToggle: true,

  // Tab Behavior
  openConnectionInBackground: false,
  openWinmgmtToolInBackground: false,
  switchTabOnActivity: false,
  closeTabOnDisconnect: false,
  confirmCloseActiveTab: true,
  enableRecentlyClosedTabs: true,
  recentlyClosedTabsMax: 10,

  // Focus & Navigation
  focusTerminalOnTabSwitch: true,
  scrollTreeToActiveConnection: true,
  restoreLastActiveTab: true,
  tabCycleMru: false,

  // Clipboard Behavior
  copyOnSelect: false,
  pasteOnRightClick: true,
  clearClipboardAfterSeconds: 0,
  trimPastedWhitespace: false,
  warnOnMultiLinePaste: true,
  maxPasteLengthChars: 0,

  // Idle & Timeout
  idleDisconnectMinutes: 0,
  sendKeepaliveOnIdle: true,
  keepaliveIntervalSeconds: 60,
  dimInactiveTabs: false,
  showIdleDuration: false,

  // Reconnection Behavior
  autoReconnectOnDisconnect: true,
  autoReconnectMaxAttempts: 20,
  autoReconnectDelaySecs: 2,
  autoReconnectBackoff: "exponential",
  autoReconnectMaxDelaySecs: 30,
  notifyOnReconnect: true,

  // Notification Behavior
  notifyOnConnect: false,
  notifyOnDisconnect: false,
  notifyOnError: true,
  notificationSound: false,
  flashTaskbarOnActivity: false,

  // Confirmation Dialogs
  confirmDisconnect: false,
  confirmDeleteConnection: true,
  confirmDeleteTabGroup: true,
  enableTabGroupAnimations: true,
  confirmBulkOperations: true,
  confirmImport: true,

  // Drag & Drop
  enableFileDragDropToTerminal: true,
  enableFileDragDropToRdp: true,
  dragSensitivityPx: 5,
  showDropPreview: true,

  // Scroll & Input
  terminalScrollSpeed: 1.0,
  terminalSmoothScroll: true,
  treeRightClickAction: "contextMenu" as const,
  mouseBackAction: "previousTab" as const,
  mouseForwardAction: "nextTab" as const,

  // Animation Settings
  animationsEnabled: true,
  animationDuration: 550,
  reduceMotion: false,

  backgroundGlowEnabled: true,
  backgroundGlowFollowsColorScheme: true,
  backgroundGlowColor: "#2563eb",
  backgroundGlowOpacity: 0.25,
  backgroundGlowRadius: 520,
  backgroundGlowBlur: 140,

  windowTransparencyEnabled: false,
  windowTransparencyOpacity: 0.94,
  showTransparencyToggle: false,

  loadingElement: DEFAULT_LOADING_ELEMENT_SETTINGS,

  showQuickConnectIcon: true,
  showCollectionSwitcherIcon: true,
  showImportExportIcon: true,
  showSettingsIcon: true,
  showPerformanceMonitorIcon: true,
  showActionLogIcon: true,
  showDevtoolsIcon: true,
  showDebugPanelIcon: false,
  showSecurityIcon: true,
  showProxyMenuIcon: true,
  showInternalProxyIcon: false,
  showShortcutManagerIcon: true,
  showWolIcon: true,
  showBulkSSHIcon: true,
  showServerStatsIcon: true,
  showOpksshIcon: true,
  showMcpServerIcon: false,
  showScriptManagerIcon: true,
  showMacroManagerIcon: true,
  showSyncBackupStatusIcon: false, // Legacy combined - disabled by default
  showBackupStatusIcon: true, // Separate backup icon
  showCloudSyncStatusIcon: true, // Separate cloud sync icon
  showErrorLogBar: false,
  showRdpSessionsIcon: true,

  recording: {
    enabled: true,
    autoRecordSessions: false,
    recordInput: false,
    maxRecordingDurationMinutes: 0,
    maxStoredRecordings: 50,
    defaultExportFormat: "asciicast" as const,
  },
  rdpRecording: {
    enabled: true,
    autoRecordRdpSessions: false,
    defaultVideoFormat: "webm" as const,
    recordingFps: 30,
    videoBitrateMbps: 5,
    maxRdpRecordingDurationMinutes: 0,
    maxStoredRdpRecordings: 20,
    autoSaveToLibrary: false,
  },
  mcpServer: DEFAULT_MCP_CONFIG,
  webRecording: {
    enabled: true,
    autoRecordWebSessions: false,
    recordHeaders: false,
    maxWebRecordingDurationMinutes: 0,
    maxStoredWebRecordings: 50,
    defaultExportFormat: "har" as const,
  },
  showRecordingManagerIcon: true,
  macros: {
    defaultStepDelayMs: 200,
    confirmBeforeReplay: true,
    maxMacroSteps: 100,
  },
  settingsDialog: {
    showSaveButton: false,
    confirmBeforeReset: true,
    autoSave: true,
  },

  autoLock: {
    enabled: false,
    timeoutMinutes: 15,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: true,
    lockOnMinimize: false,
    lockOnBlur: false,
    lockOnVisibilityHidden: false,
  },

  maxConcurrentConnections: 10,
  connectionTimeout: 30,
  retryAttempts: 3,
  retryDelay: 5000,
  enablePerformanceTracking: true,
  performancePollIntervalMs: 20000,
  performanceLatencyTarget: "1.1.1.1",

  encryptionAlgorithm: "AES-256-GCM",
  blockCipherMode: "GCM",
  keyDerivationIterations: 100000,
  autoBenchmarkIterations: false,
  benchmarkTimeSeconds: 1,

  totpEnabled: false,
  totpIssuer: "sortOfRemoteNG",
  totpDigits: 6,
  totpPeriod: 30,
  totpAlgorithm: "sha1" as const,

  globalProxy: {
    type: "http",
    host: "",
    port: 8080,
    enabled: false,
  },
  globalProxyPresets: [],
  openvpn: undefined,
  vpnSettings: {
    openvpnBinaryPath: "",
    wireguardBinaryPath: "",
    autoConnectOnStartup: [],
    statusPollingIntervalMs: 5000,
    defaultVpnType: "openvpn",
    dnsHandling: "vpn-dns",
  },

  tabGrouping: "none",
  hostnameOverride: false,
  defaultTabLayout: "tabs",
  tabLayoutState: undefined,
  enableTabDetachment: false,
  enableTabResize: true,
  enableZoom: true,
  enableTabReorder: true,
  enableConnectionReorder: true,
  colorTags: {},
  defaultTabColor: undefined,
  tabColorPresets: [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#6b7280",
    "#a855f7",
  ],

  enableStatusChecking: true,
  statusCheckInterval: 30,
  statusCheckMethod: "socket",

  persistWindowSize: true,
  persistWindowPosition: true,
  persistSidebarWidth: true,
  persistSidebarPosition: true,
  persistSidebarCollapsed: true,
  windowSize: { width: 1280, height: 720 },
  windowPosition: { x: 120, y: 80 },
  sidebarWidth: 320,
  sidebarPosition: "left",
  sidebarCollapsed: false,

  autoRepatriateWindow: true,

  networkDiscovery: {
    enabled: false,
    ipRange: "192.168.1.0/24",
    portRanges: ["22", "80", "443", "3389", "5900"],
    protocols: ["ssh", "http", "https", "rdp", "vnc"],
    timeout: 5000,
    maxConcurrent: 50,
    maxPortConcurrent: 100,
    customPorts: {
      ssh: [22],
      http: [80, 8080, 8000],
      https: [443, 8443],
      rdp: [3389],
      vnc: [5900, 5901, 5902],
      mysql: [3306],
      ftp: [21],
      telnet: [23],
    },
    probeStrategies: {
      ssh: ["websocket"],
      http: ["http"],
      https: ["http"],
      rdp: ["websocket"],
      vnc: ["websocket"],
      mysql: ["websocket"],
      ftp: ["websocket"],
      telnet: ["websocket"],
    },
    cacheTTL: 300000,
    hostnameTtl: 300000,
    macTtl: 300000,
  },

  restApi: {
    enabled: false,
    port: 8080,
    useRandomPort: false,
    authentication: false,
    corsEnabled: true,
    rateLimiting: true,
    startOnLaunch: false,
    allowRemoteConnections: false,
    sslEnabled: false,
    sslMode: "manual" as const,
    sslCertPath: "",
    sslKeyPath: "",
    maxRequestsPerMinute: 60,
    maxThreads: 4,
    requestTimeout: 30,
  },

  wolEnabled: false,
  wolPort: 9,
  wolBroadcastAddress: "255.255.255.255",

  enableActionLog: true,
  logLevel: "info",
  maxLogEntries: 1000,

  exportEncryption: false,
  exportPassword: undefined,
  exportSecurity: defaultExportSecuritySettings,

  sshTerminal: defaultSSHTerminalConfig,
  sshConnection: defaultSSHConnectionConfig,
  backup: defaultBackupConfig,
  cloudSync: defaultCloudSyncConfig,

  // Trust & Verification
  enableAutocomplete: false,
  trustPolicy: "tofu",
  httpsTrustPolicy: "inherit",
  certificateTrustPolicy: "inherit",
  tlsTrustPolicy: "tofu",
  sshTrustPolicy: "always-ask",
  rdpTrustPolicy: "inherit",
  showTrustIdentityInfo: true,
  certExpiryWarningDays: 5,

  // Web Browser / HTTP proxy
  proxyKeepaliveEnabled: true,
  proxyKeepaliveIntervalSeconds: 10,
  proxyAutoRestart: true,
  proxyMaxAutoRestarts: 5,
  confirmDeleteAllBookmarks: true,

  // Windows Remote Management Tools
  enableWinrmTools: true,

  // CredSSP Remediation Defaults
  credsspDefaults: {
    oracleRemediation: "mitigated",
    allowHybridEx: false,
    nlaFallbackToTls: true,
    tlsMinVersion: "1.2",
    ntlmEnabled: true,
    kerberosEnabled: false,
    pku2uEnabled: false,
    restrictedAdmin: false,
    remoteCredentialGuard: false,
    enforceServerPublicKeyValidation: true,
    credsspVersion: 6,
    sspiPackageList: "",
    nlaMode: "required",
    serverCertValidation: "validate",
  },

  // Password Reveal
  passwordReveal: {
    enabled: true,
    mode: "toggle",
    autoHideSeconds: 0,
    showByDefault: false,
    maskIcon: false,
    maskCharacter: "",
    lockSavedPasswords: false,
  },

  // WinRM Global Defaults
  winrmDefaults: {
    httpPort: 5985,
    httpsPort: 5986,
    preferSsl: false,
    authMethod: "negotiate" as const,
    skipCaCheck: false,
    skipCnCheck: false,
    autoFallback: true,
    namespace: "root\\cimv2",
    timeoutSec: 30,
  },

  // RDP Global Defaults
  rdpDefaults: {
    useCredSsp: true,
    enableTls: true,
    enableNla: true,
    autoLogon: false,
    credsspOracleRemediation: "mitigated",
    allowHybridEx: false,
    nlaFallbackToTls: true,
    tlsMinVersion: "1.2",
    ntlmEnabled: true,
    kerberosEnabled: false,
    pku2uEnabled: false,
    restrictedAdmin: false,
    remoteCredentialGuard: false,
    enforceServerPublicKeyValidation: true,
    credsspVersion: 6,
    serverCertValidation: "warn",
    enableServerPointer: true,
    pointerSoftwareRendering: true,
    sspiPackageList: "",
    gatewayEnabled: false,
    gatewayHostname: "",
    gatewayPort: 443,
    gatewayAuthMethod: "ntlm",
    gatewayTransportMode: "auto",
    gatewayBypassLocal: true,
    enhancedSessionMode: false,
    autoDetect: false,
    negotiationStrategy: "nla-first",
    maxRetries: 3,
    retryDelayMs: 1000,
    defaultWidth: 1920,
    defaultHeight: 1080,
    defaultColorDepth: 32,
    smartSizing: true,
    tcpConnectTimeoutSecs: 10,
    tcpNodelay: true,
    tcpKeepAlive: true,
    tcpKeepAliveIntervalSecs: 60,
    tcpRecvBufferSize: 262144,
    tcpSendBufferSize: 262144,
    // Display extras
    resizeToWindow: true,
    desktopScaleFactor: 100,
    lossyCompression: true,
    // Audio
    audioPlaybackMode: "local" as const,
    audioRecordingMode: "disabled" as const,
    audioQuality: "dynamic" as const,
    // Input
    mouseMode: "absolute" as const,
    enableUnicodeInput: true,
    autoDetectKeyboardLayout: true,
    inputPriority: "realtime" as const,
    batchIntervalMs: 16,
    keyboardLayout: 0x0409,
    keyboardType: "ibm-enhanced",
    keyboardFunctionKeys: 12,
    // Scroll / Mouse Wheel
    scrollSpeed: 1.0,
    smoothScroll: true,
    // Cursor
    localCursor: "local" as const,
    // Device redirection
    clipboardRedirection: true,
    clipboardDirection: "bidirectional",
    printerRedirection: false,
    printerOutputMode: "spool-file",
    portRedirection: false,
    smartCardRedirection: false,
    webAuthnRedirection: false,
    videoCaptureRedirection: false,
    usbRedirection: false,
    audioInputRedirection: false,
    driveRedirection: false,
    driveRedirections: [],
    // Performance visual
    connectionSpeed: "broadband-high" as const,
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    disableCursorSettings: false,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
    persistentBitmapCaching: false,
    // Render
    renderBackend: "webview",
    frontendRenderer: "auto",
    frameScheduling: "adaptive",
    tripleBuffering: true,
    targetFps: 30,
    frameBatching: false,
    frameBatchIntervalMs: 33,
    fullFrameSyncInterval: 300,
    readTimeoutMs: 16,
    // Advanced
    sessionClosePolicy: "detach" as const,
    clientName: "",
    clientBuild: 0,
    maxConsecutiveErrors: 50,
    statsIntervalSecs: 1,
    codecsEnabled: true,
    remoteFxEnabled: true,
    remoteFxEntropy: "rlgr3" as const,
    gfxEnabled: false,
    h264Decoder: "auto" as const,
    nalPassthrough: false,
    reconnectBaseDelaySecs: 3,
    reconnectMaxDelaySecs: 30,
    reconnectOnNetworkLoss: true,
  },

  // RDP Session Panel Settings
  rdpSessionDisplayMode: "popup" as const,
  rdpSessionThumbnailsEnabled: true,
  rdpSessionThumbnailPolicy: "realtime" as const,
  rdpSessionThumbnailInterval: 5,
  rdpSessionClosePolicy: "detach" as const,
  rdpSessionHistoryMax: 1000,
  toolDisplayModes: {
    recordingManager: "tab" as const,
    importExport: "tab" as const,
    macroManager: "tab" as const,
    scriptManager: "tab" as const,
    performanceMonitor: "tab" as const,
    actionLog: "tab" as const,
    shortcutManager: "tab" as const,
    bulkSsh: "tab" as const,
    serverStats: "tab" as const,
    opkssh: "tab" as const,
    mcpServer: "tab" as const,
    internalProxy: "tab" as const,
    proxyChain: "tab" as const,
    wol: "tab" as const,
    windowsBackup: "tab" as const,
    diagnostics: "tab" as const,
    settings: "tab" as const,
    rdpSessions: "tab" as const,
    tagManager: "tab" as const,
    tabGroupManager: "tab" as const,
    connectionEditor: "tab" as const,
    bulkEditor: "tab" as const,
    proxyProfileEditor: "tab" as const,
    proxyChainEditor: "tab" as const,
    sshTunnelEditor: "tab" as const,
    vpnEditor: "tab" as const,
    shortcutCreator: "tab" as const,
    tunnelChainEditor: "tab" as const,
    tunnelProfileEditor: "tab" as const,
    database: "tab" as const,
  },
  diagnostics: defaultDiagnosticsConfig,
  memoryWatchdog: defaultMemoryWatchdogSettings,
  backendConfig: {
    logLevel: "info" as const,
    maxConcurrentRdpSessions: 10,
    rdpServerRenderer: "auto" as const,
    rdpCodecPreference: "auto" as const,
    tcpDefaultBufferSize: 65536,
    tcpKeepAliveSeconds: 30,
    connectionTimeoutSeconds: 15,
    tempFileCleanupEnabled: true,
    tempFileCleanupIntervalMinutes: 60,
    cacheSizeMb: 256,
    allowedCipherSuites: [],
  },
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const isJsonCompatible = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(isJsonCompatible);
};

const matchesSettingsTemplate = (
  value: unknown,
  template: unknown,
): boolean => {
  if (template === undefined) return isJsonCompatible(value);
  if (template === null) return value === null;
  if (Array.isArray(template)) {
    return Array.isArray(value) && value.every(isJsonCompatible);
  }
  if (isPlainRecord(template)) {
    if (!isPlainRecord(value)) return false;
    for (const [key, expected] of Object.entries(template)) {
      if (expected === undefined) continue;
      if (!(key in value) || !matchesSettingsTemplate(value[key], expected)) {
        return false;
      }
    }
    return Object.values(value).every(isJsonCompatible);
  }
  if (typeof template === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === typeof template;
};

const isCompleteSettingsSnapshot = (
  candidate: unknown,
): candidate is GlobalSettings =>
  isPlainRecord(candidate) &&
  matchesSettingsTemplate(candidate, DEFAULT_SETTINGS);

function mergeToolDisplayModes(
  stored?: Partial<ToolDisplayModes>,
): ToolDisplayModes {
  const merged = { ...DEFAULT_SETTINGS.toolDisplayModes };
  if (!stored) {
    return merged;
  }

  for (const key of Object.keys(merged) as Array<keyof ToolDisplayModes>) {
    if (stored[key] === "tab") {
      merged[key] = "tab";
    }
  }
  return merged;
}

/**
 * Handles persistence and retrieval of application settings, action logs,
 * performance metrics and custom scripts. Implemented as a singleton so that
 * state is shared across the application.
 */
export class SettingsManager {
  private static instance: SettingsManager | null = null;
  private settings: GlobalSettings = DEFAULT_SETTINGS;
  private actionLog: ActionLogEntry[] = [];
  private performanceMetrics: PerformanceMetrics[] = [];
  private customScripts: CustomScript[] = [];
  private readonly settingsSyncRuntime: SettingsSyncRuntime;
  private readonly settingsSyncRevisions: SettingsSyncRevisionTracker;
  private settingsSyncApplyChain: Promise<unknown> = Promise.resolve();
  private settingsSyncEmitChain: Promise<unknown> = Promise.resolve();

  constructor(options: SettingsManagerOptions = {}) {
    this.settingsSyncRuntime =
      options.settingsSyncRuntime ?? defaultSettingsSyncRuntime;
    this.settingsSyncRevisions = new SettingsSyncRevisionTracker(
      options.settingsSyncWriterId,
      options.now,
    );
  }

  /**
   * Whether the initial load from persistent storage has completed.
   * Until this is true, `this.settings` still holds DEFAULT_SETTINGS, so
   * any save would persist defaults and clobber the user's stored config.
   */
  private loaded = false;
  /** The in-flight (or last) load promise, awaited by `ensureLoaded()`. */
  private loadPromise: Promise<GlobalSettings> | null = null;

  /**
   * Retrieves the singleton instance of the manager.
   * @returns {SettingsManager} The shared instance.
   */
  static getInstance(): SettingsManager {
    if (SettingsManager.instance === null) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * Resets the singleton instance. Primarily used for testing to create a new
   * instance with a clean state.
   */
  static resetInstance(): void {
    SettingsManager.instance = null;
  }

  /**
   * Loads settings from persistent storage.
   * @returns {Promise<GlobalSettings>} Resolves with the merged settings; returns defaults if retrieval fails.
   */
  async loadSettings(): Promise<GlobalSettings> {
    const promise = this.doLoadSettings();
    this.loadPromise = promise;
    return promise;
  }

  /**
   * Ensures the initial load from storage has happened before a save, so
   * that partial saves merge onto the user's stored config instead of
   * clobbering it with defaults during the startup window.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await (this.loadPromise ?? this.loadSettings());
    } catch {
      // Load genuinely failed (e.g. storage unavailable) — allow the save
      // to proceed rather than hang forever.
    }
  }

  /**
   * Narrow a raw `settings.json` object to just the keys the frontend
   * owns (everything in DEFAULT_SETTINGS). Drops sibling keys managed by
   * the backend — notably `updater` — so they never leak into the
   * in-memory blob and get written back over the Rust-managed values.
   */
  private sliceKnownSettings(
    raw: Record<string, unknown> | null | undefined,
    options: { stripRestApiSecrets?: boolean } = {
      stripRestApiSecrets: true,
    },
  ): Partial<GlobalSettings> | null {
    if (!raw || typeof raw !== "object") return null;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in raw) out[key] = (raw as Record<string, unknown>)[key];
    }
    const restApi = out.restApi;
    if (
      options.stripRestApiSecrets !== false &&
      restApi &&
      typeof restApi === "object" &&
      !Array.isArray(restApi)
    ) {
      const safeRestApi = { ...(restApi as Record<string, unknown>) };
      delete safeRestApi.apiKey;
      delete safeRestApi.jwtSecret;
      out.restApi = safeRestApi;
    }
    return out as Partial<GlobalSettings>;
  }

  private normalizeSettingsSnapshot(
    storedSettings: Partial<GlobalSettings>,
  ): GlobalSettings {
    const normalizedStored = { ...storedSettings };
    const sshReconnectSettings =
      normalizeSshReconnectSettings(normalizedStored);
    const validColorSchemes = [
      "red",
      "rose",
      "pink",
      "orange",
      "amber",
      "yellow",
      "lime",
      "green",
      "emerald",
      "teal",
      "cyan",
      "sky",
      "blue",
      "indigo",
      "violet",
      "purple",
      "fuchsia",
      "slate",
      "grey",
    ];
    if (
      normalizedStored.colorScheme &&
      !validColorSchemes.includes(normalizedStored.colorScheme)
    ) {
      console.warn(
        `Invalid colorScheme "${normalizedStored.colorScheme}" found in settings, resetting to "blue"`,
      );
      normalizedStored.colorScheme = "blue";
    }

    return {
      ...DEFAULT_SETTINGS,
      ...normalizedStored,
      ...sshReconnectSettings,
      sshTerminal: mergeSSHTerminalConfig(
        DEFAULT_SETTINGS.sshTerminal,
        normalizedStored.sshTerminal,
      ),
      sshConnection: mergeSSHConnectionConfig(
        DEFAULT_SETTINGS.sshConnection,
        normalizedStored.sshConnection,
      ),
      httpsTrustPolicy:
        normalizedStored.httpsTrustPolicy ??
        normalizedStored.tlsTrustPolicy ??
        DEFAULT_SETTINGS.httpsTrustPolicy,
      certificateTrustPolicy:
        normalizedStored.certificateTrustPolicy ??
        DEFAULT_SETTINGS.certificateTrustPolicy,
      networkDiscovery: {
        ...DEFAULT_SETTINGS.networkDiscovery,
        ...(normalizedStored.networkDiscovery ?? {}),
      },
      toolDisplayModes: mergeToolDisplayModes(
        normalizedStored.toolDisplayModes,
      ),
      rdpDefaults: {
        ...DEFAULT_SETTINGS.rdpDefaults,
        ...(normalizedStored.rdpDefaults ?? {}),
      },
      mcpServer: {
        ...DEFAULT_SETTINGS.mcpServer,
        ...(normalizedStored.mcpServer ?? {}),
      },
      exportSecurity: {
        ...DEFAULT_SETTINGS.exportSecurity,
        ...(normalizedStored.exportSecurity ?? {}),
        encryptByDefault:
          normalizedStored.exportSecurity?.encryptByDefault ??
          normalizedStored.exportEncryption ??
          DEFAULT_SETTINGS.exportSecurity.encryptByDefault,
      },
      backup: migrateBackupConfig({
        ...DEFAULT_SETTINGS.backup,
        ...(normalizedStored.backup ?? {}),
      }),
      cloudSync: migrateCloudSyncConfig({
        ...DEFAULT_SETTINGS.cloudSync,
        ...(normalizedStored.cloudSync ?? {}),
      }),
    };
  }

  private validateCompleteSettingsSnapshot(
    candidate: unknown,
  ): GlobalSettings | null {
    if (!isCompleteSettingsSnapshot(candidate)) return null;
    const known = this.sliceKnownSettings(
      candidate as unknown as Record<string, unknown>,
    );
    if (!known) return null;
    return this.normalizeSettingsSnapshot(known);
  }

  /**
   * Read persisted settings. In the desktop shell this reads
   * `<app_data_dir>/settings.json` via the backend — the authoritative
   * store. Outside Tauri (browser, tests) it returns the module-level
   * in-memory store.
   *
   * There is NO IndexedDB fallback. If the backend read fails, the error
   * propagates to `doLoadSettings`, which degrades to `DEFAULT_SETTINGS`
   * (it never serves a stale IndexedDB copy). The previous one-time
   * IndexedDB→disk migration was removed alongside all IndexedDB settings
   * code; any user whose settings lived *only* in IndexedDB is not
   * migrated forward (an accepted tradeoff of full IndexedDB removal).
   */
  private async readPersistedSettings(): Promise<Partial<GlobalSettings> | null> {
    const invoke = await tauriInvoke();
    if (!invoke) {
      // No Tauri disk in this runtime — serve the in-memory blob written
      // earlier this session (or null on a cold start).
      return _inMemorySettingsStore;
    }
    const fileValue = await invoke<Record<string, unknown> | null>(
      "read_app_settings",
    );
    const fromFile = this.sliceKnownSettings(fileValue);
    if (fromFile && Object.keys(fromFile).length > 0) {
      return fromFile;
    }
    return null;
  }

  private sanitizeSettingsPatch(
    patch: Partial<GlobalSettings>,
  ): Partial<GlobalSettings> {
    const safePatch = { ...patch } as Partial<GlobalSettings> & {
      restApi?: GlobalSettings["restApi"] & Record<string, unknown>;
    };
    if (safePatch.restApi) {
      const restApi = { ...safePatch.restApi } as Record<string, unknown>;
      delete restApi.apiKey;
      delete restApi.jwtSecret;
      safePatch.restApi = restApi as GlobalSettings["restApi"];
    }
    return safePatch;
  }

  /**
   * Persist a settings change. In the desktop shell the patch is
   * shallow-merged into `settings.json` by the backend (so partial saves
   * never drop sibling keys); outside Tauri the full in-memory blob is
   * kept in the module-level in-memory store.
   *
   * There is NO IndexedDB fallback. A failed `write_app_settings` is
   * retried a small bounded number of times with backoff (riding out
   * transient conditions such as a momentarily-missing app-data dir, and
   * complementing the backend's own retry). On each failed attempt and on
   * final failure a `settings-write-failed` window CustomEvent is
   * dispatched (so a mounted hook can toast); if a retry eventually
   * succeeds after a prior failure a `settings-write-recovered` event is
   * dispatched. The just-changed in-memory settings are NOT rolled back on
   * failure — `saveSettings` has already merged them into `this.settings`,
   * so the user's change survives the session even if the disk write fails.
   *
   * On final failure this rethrows so callers (which already wrap
   * `saveSettings` in try/catch — e.g. the debounced settings save and
   * window-geometry save) can react. It never throws on the no-Tauri path.
   */
  private async persistSettings(
    patch: Partial<GlobalSettings>,
  ): Promise<number | undefined> {
    const safePatch = this.sanitizeSettingsPatch(patch);
    const invoke = await tauriInvoke();
    if (!invoke) {
      // No Tauri disk — retain the full blob in the module-level store so
      // a subsequent read in the same session round-trips.
      _inMemorySettingsStore = {
        ...this.settings,
        ...(safePatch as Partial<GlobalSettings>),
      };
      return undefined;
    }

    let sawFailure = false;
    for (let attempt = 1; attempt <= SETTINGS_WRITE_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await invoke<unknown>("write_app_settings", {
          patch: safePatch,
        });
        if (sawFailure) {
          // Recovered after one or more failed attempts.
          dispatchWriteRecovered(attempt, SETTINGS_WRITE_MAX_ATTEMPTS);
        }
        if (typeof result === "number" && Number.isSafeInteger(result)) {
          return result > 0 ? result : undefined;
        }
        if (
          isPlainRecord(result) &&
          typeof result.generation === "number" &&
          Number.isSafeInteger(result.generation) &&
          result.generation > 0
        ) {
          return result.generation;
        }
        return undefined;
      } catch (error) {
        sawFailure = true;
        const message = error instanceof Error ? error.message : String(error);
        const willRetry = attempt < SETTINGS_WRITE_MAX_ATTEMPTS;
        console.error(
          `write_app_settings failed (attempt ${attempt}/${SETTINGS_WRITE_MAX_ATTEMPTS}):`,
          error,
        );
        dispatchWriteFailed(
          message,
          attempt,
          SETTINGS_WRITE_MAX_ATTEMPTS,
          willRetry,
        );
        if (!willRetry) {
          // Exhausted retries — surface to the caller. The in-memory
          // settings keep the user's change (no rollback).
          throw error;
        }
        // Linear backoff before the next attempt.
        await delay(SETTINGS_WRITE_RETRY_BASE_MS * attempt);
      }
    }
    return undefined;
  }

  /**
   * Reset persisted settings back to defaults. Overwrites the
   * frontend-owned keys in `settings.json` with DEFAULT_SETTINGS (leaving
   * backend-managed keys like `updater` untouched). Callers typically
   * reload the app after. No IndexedDB copy is cleared — settings no
   * longer use IndexedDB.
   */
  async resetStoredSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS };
    this.loaded = true;
    await this.persistSettings(DEFAULT_SETTINGS);
  }

  private async doLoadSettings(): Promise<GlobalSettings> {
    try {
      const stored = await this.readPersistedSettings();
      if (stored) {
        this.settings = this.normalizeSettingsSnapshot(stored);
      }
      this.loaded = true;
      return this.settings;
    } catch (error) {
      console.error("Failed to load settings:", error);
      this.loaded = true;
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Persists new settings to storage, merging with existing ones.
   * @param {Partial<GlobalSettings>} settings - Settings to merge and save.
   * @returns {Promise<void>} Resolves when saving succeeds.
   * @throws {Error} If the settings could not be persisted.
   */
  async saveSettings(
    settings: Partial<GlobalSettings>,
    options?: { silent?: boolean },
  ): Promise<void> {
    try {
      // Guard against the startup race: if a caller (e.g. window-geometry
      // persistence) saves before the initial load has finished,
      // `this.settings` is still DEFAULT_SETTINGS and merging a partial
      // here would persist defaults over the user's stored config. Wait
      // for the load to complete first.
      await this.ensureLoaded();
      const safeSettings = this.sanitizeSettingsPatch(settings);
      this.settings = { ...this.settings, ...safeSettings };
      // Write only the patch: the backend shallow-merges it into
      // settings.json, so partial saves never drop sibling keys.
      const commitGeneration = await this.persistSettings(safeSettings);
      // Only log explicit user-initiated saves, not auto-saves or intermediate changes
      if (!options?.silent) {
        this.logAction(
          "info",
          "Settings saved",
          undefined,
          "User settings updated",
        );
      }
      // Generate and broadcast the sortable revision only after persistence
      // has committed. Sync transport failures never roll back the local save.
      await this.broadcastSettingsSync(safeSettings, commitGeneration);
    } catch (error) {
      console.error("Failed to save settings:", error);
      throw error;
    }
  }

  /**
   * Update the in-memory settings without persisting to disk.
   * Used by the Settings dialog so that `getSettings()` always reflects
   * the latest toggle state even before the debounced save fires.
   */
  applyInMemory(settings: Partial<GlobalSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Apply a validated full snapshot from the same-window DOM fallback.
   * This is strictly in-memory: no persistence and no Tauri emission.
   */
  applySettingsSnapshot(settings: unknown): GlobalSettings | null {
    const validated = this.validateCompleteSettingsSnapshot(settings);
    if (!validated) return null;
    this.settings = validated;
    this.loaded = true;
    return validated;
  }

  /**
   * Accept a cross-window envelope when it is valid, non-self, and newer than
   * the current logical stamp. Accepted snapshots are applied in memory only.
   */
  async applySyncedSettings(payload: unknown): Promise<GlobalSettings | null> {
    const decision = this.settingsSyncRevisions.accept(payload, (settings) =>
      this.validateCompleteSettingsSnapshot(settings),
    );
    if (decision.kind !== "accepted") return null;

    const apply = this.settingsSyncApplyChain.then(async () => {
      await this.ensureLoaded();
      if (!this.settingsSyncRevisions.isCurrent(decision.payload)) return null;
      this.settings = decision.settings;
      this.loaded = true;
      return this.settings;
    });
    this.settingsSyncApplyChain = apply.catch(() => undefined);
    return apply;
  }

  async listenForSettingsSync(
    onSettings: (settings: GlobalSettings) => void | Promise<void>,
  ): Promise<() => void> {
    return this.settingsSyncRuntime.listen(async (payload) => {
      const settings = await this.applySyncedSettings(payload);
      if (settings) await onSettings(settings);
    });
  }

  private async broadcastSettingsSync(
    patch: Partial<GlobalSettings>,
    commitGeneration?: number,
  ): Promise<void> {
    const broadcast = this.settingsSyncEmitChain.then(async () => {
      let source = "unknown";
      try {
        source = await this.settingsSyncRuntime.getSource();
      } catch {
        // The writer token, not the diagnostic label, suppresses self-echoes.
      }

      const safePatch = this.sanitizeSettingsPatch(patch);
      const safeKnownSettings = this.sliceKnownSettings({
        ...(this.settings as unknown as Record<string, unknown>),
        ...(safePatch as unknown as Record<string, unknown>),
      });
      if (!safeKnownSettings) return;
      const safeSettings = this.normalizeSettingsSnapshot(safeKnownSettings);
      const payload = this.settingsSyncRevisions.next(
        source,
        safeSettings,
        commitGeneration,
      );
      // A newer native commit may have arrived while this save was awaiting
      // persistence. Never emit or reinstate the older completed write.
      if (!this.settingsSyncRevisions.isCurrent(payload)) return;

      this.settings = safeSettings;
      this.loaded = true;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("settings-updated", { detail: safeSettings }),
        );
      }

      try {
        await this.settingsSyncRuntime.emit(payload);
      } catch {
        // Browser/single-window runtimes do not provide a Tauri event bus.
      }
    });
    this.settingsSyncEmitChain = broadcast.catch(() => undefined);
    await broadcast;
  }

  /** Returns the current runtime label for diagnostics and compatibility. */
  async getWindowLabel(): Promise<string> {
    return this.settingsSyncRuntime.getSource();
  }

  /**
   * Provides access to the currently loaded settings.
   * @returns {GlobalSettings} The in-memory settings object.
   */
  getSettings(): GlobalSettings {
    return this.settings;
  }

  // Action Logging
  /**
   * Adds an entry to the action log and persists the log. Older entries are
   * discarded when the log exceeds the configured maximum.
   * @param {'debug' | 'info' | 'warn' | 'error'} level - Severity level.
   * @param {string} action - Description of the action performed.
   * @param {string} [connectionId] - Optional connection identifier.
   * @param {string} [details=''] - Additional details about the action.
   * @param {number} [duration] - Optional duration associated with the action.
   */
  logAction(
    level: "debug" | "info" | "warn" | "error",
    action: string,
    connectionId?: string,
    details: string = "",
    duration?: number,
    connectionName?: string,
  ): void {
    if (!this.settings.enableActionLog) return;

    const entry: ActionLogEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      level,
      action,
      connectionId,
      connectionName:
        connectionName ?? (connectionId ? connectionId : undefined),
      details,
      duration,
    };

    this.actionLog.unshift(entry); // Add newest entry to the front

    // Limit log size to avoid unbounded memory growth
    if (this.actionLog.length > this.settings.maxLogEntries) {
      // Keep only the most recent maxLogEntries entries
      this.actionLog = this.actionLog.slice(0, this.settings.maxLogEntries);
    }

    // Persist asynchronously so logs survive page reloads
    this.saveActionLog();
  }

  /**
   * Returns the current action log.
   * @returns {ActionLogEntry[]} Array of action log entries.
   */
  getActionLog(): ActionLogEntry[] {
    return this.actionLog;
  }

  /**
   * Removes all log entries and persists the empty log.
   */
  clearActionLog(): void {
    this.actionLog = [];
    this.saveActionLog();
  }

  private async saveActionLog(): Promise<void> {
    try {
      await IndexedDbService.setItem("mremote-action-log", this.actionLog);
    } catch (error) {
      console.error("Failed to save action log:", error);
    }
  }

  private async loadActionLog(): Promise<void> {
    try {
      const stored =
        await IndexedDbService.getItem<any[]>("mremote-action-log");
      if (stored) {
        this.actionLog = stored.map((entry: any) => ({
          ...entry,
          timestamp:
            typeof entry.timestamp === "string"
              ? entry.timestamp
              : new Date(entry.timestamp).toISOString(),
        }));
      }
    } catch (error) {
      console.error("Failed to load action log:", error);
    }
  }

  // Performance Metrics
  /**
   * Records a performance metric and persists it. Only the most recent 1000
   * metrics are retained to limit storage usage.
   * @param {PerformanceMetrics} metric - Metric data to record.
   */
  recordPerformanceMetric(metric: PerformanceMetrics): void {
    if (!this.settings.enablePerformanceTracking) return;

    this.performanceMetrics.unshift(metric); // Store newest first

    // Keep only last 1000 metrics to control data size
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(0, 1000);
    }

    // Persist asynchronously; errors are logged inside savePerformanceMetrics
    void this.savePerformanceMetrics();
  }

  /**
   * Retrieves recorded performance metrics.
   * @returns {PerformanceMetrics[]} Array of metrics.
   */
  getPerformanceMetrics(): PerformanceMetrics[] {
    return this.performanceMetrics;
  }

  clearPerformanceMetrics(): void {
    this.performanceMetrics = [];
    void this.savePerformanceMetrics();
  }

  private async savePerformanceMetrics(): Promise<void> {
    try {
      await IndexedDbService.setItem(
        "mremote-performance-metrics",
        this.performanceMetrics,
      );
    } catch (error) {
      console.error("Failed to save performance metrics:", error);
    }
  }

  private async loadPerformanceMetrics(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<PerformanceMetrics[]>(
        "mremote-performance-metrics",
      );
      if (stored) {
        this.performanceMetrics = stored;
      }
    } catch (error) {
      console.error("Failed to load performance metrics:", error);
    }
  }

  // Custom Scripts
  /**
   * Adds a new custom script and persists it.
   * @param {Omit<CustomScript, 'id' | 'createdAt' | 'updatedAt'>} script - Script details without id and timestamps.
   * @returns {CustomScript} The newly created script with id and timestamps.
   */
  addCustomScript(
    script: Omit<CustomScript, "id" | "createdAt" | "updatedAt">,
  ): CustomScript {
    const newScript: CustomScript = {
      ...script,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.customScripts.push(newScript);
    void this.saveCustomScripts();
    this.logAction(
      "info",
      "Custom script added",
      undefined,
      `Script "${script.name}" created`,
    );

    return newScript;
  }

  /**
   * Updates an existing custom script if it exists.
   * @param {string} id - Identifier of the script to update.
   * @param {Partial<CustomScript>} updates - Fields to update.
   */
  updateCustomScript(id: string, updates: Partial<CustomScript>): void {
    const index = this.customScripts.findIndex((script) => script.id === id);
    if (index !== -1) {
      this.customScripts[index] = {
        ...this.customScripts[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      void this.saveCustomScripts();
      this.logAction(
        "info",
        "Custom script updated",
        undefined,
        `Script "${this.customScripts[index].name}" updated`,
      );
    }
  }

  /**
   * Deletes a custom script.
   * @param {string} id - Identifier of the script to remove.
   */
  deleteCustomScript(id: string): void {
    const script = this.customScripts.find((s) => s.id === id);
    this.customScripts = this.customScripts.filter(
      (script) => script.id !== id,
    );
    void this.saveCustomScripts();
    this.logAction(
      "info",
      "Custom script deleted",
      undefined,
      `Script "${script?.name}" deleted`,
    );
  }

  /**
   * Lists all stored custom scripts.
   * @returns {CustomScript[]} Array of scripts.
   */
  getCustomScripts(): CustomScript[] {
    return this.customScripts;
  }

  private async saveCustomScripts(): Promise<void> {
    try {
      await IndexedDbService.setItem(
        "mremote-custom-scripts",
        this.customScripts,
      );
    } catch (error) {
      console.error("Failed to save custom scripts:", error);
    }
  }

  private async loadCustomScripts(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<any[]>(
        "mremote-custom-scripts",
      );
      if (stored) {
        this.customScripts = stored.map((script: any) => ({
          ...script,
          createdAt:
            typeof script.createdAt === "string"
              ? script.createdAt
              : new Date(script.createdAt).toISOString(),
          updatedAt:
            typeof script.updatedAt === "string"
              ? script.updatedAt
              : new Date(script.updatedAt).toISOString(),
        }));
      }
    } catch (error) {
      console.error("Failed to load custom scripts:", error);
    }
  }

  // Key Derivation Benchmarking
  /**
   * Estimates the optimal number of key derivation iterations using a binary
   * search approach to reach a target duration.
   * @param {number} [targetTimeSeconds=1] - Desired time for a derivation run.
   * @param {number} [maxTimeSeconds=30] - Maximum total time to spend benchmarking.
   * @param {number} [maxIterations=20] - Maximum iterations of the search loop.
   * @returns {Promise<number>} Estimated iteration count.
   * @throws {Error} If required Web APIs (performance or crypto.subtle) are unavailable.
   */
  async benchmarkKeyDerivation(
    targetTimeSeconds: number = 1,
    maxTimeSeconds: number = 30,
    maxIterations: number = 20,
  ): Promise<number> {
    if (
      typeof globalThis.performance?.now !== "function" ||
      typeof globalThis.crypto?.subtle === "undefined"
    ) {
      throw new Error("Required Web APIs not available");
    }

    const testPassword = "benchmark-test-password";
    const testSalt = "benchmark-test-salt";
    let iterations = 10000;
    let lastTime = 0;
    let iterationCount = 0;
    let elapsedTime = 0;
    const maxElapsedMs = maxTimeSeconds * 1000;
    const benchmarkStart = globalThis.performance.now();

    this.logAction(
      "info",
      "Key derivation benchmark started",
      undefined,
      `Target time: ${targetTimeSeconds}s`,
    );

    // Binary search for optimal iterations
    while (iterationCount < maxIterations && elapsedTime < maxElapsedMs) {
      const startTime = globalThis.performance.now();
      iterationCount++;

      // Simulate key derivation (simplified)
      for (let i = 0; i < iterations; i++) {
        // Simple hash operation to simulate work
        await globalThis.crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(testPassword + testSalt + i),
        );

        // Track elapsed time inside the loop and break if exceeded
        elapsedTime = globalThis.performance.now() - benchmarkStart;
        if (elapsedTime >= maxElapsedMs) {
          break;
        }
      }

      const endTime = globalThis.performance.now();
      const duration = (endTime - startTime) / 1000;
      elapsedTime = endTime - benchmarkStart;

      if (elapsedTime >= maxElapsedMs || iterationCount >= maxIterations) {
        break;
      }

      if (Math.abs(duration - targetTimeSeconds) < 0.1) {
        break;
      }

      iterations = Math.floor(iterations * (targetTimeSeconds / duration));

      // Prevent infinite loop
      if (Math.abs(duration - lastTime) < 0.01) {
        break;
      }
      lastTime = duration;
    }

    this.logAction(
      "info",
      "Key derivation benchmark completed",
      undefined,
      `Optimal iterations: ${iterations}`,
    );
    return iterations;
  }

  // Single Window Management
  /**
   * Ensures only one application window is active when singleWindowMode is
   * enabled.
   * @returns {Promise<boolean>} Resolves false if another window is active.
   */
  async checkSingleWindow(): Promise<boolean> {
    if (!this.settings.singleWindowMode) return true;

    const windowId = sessionStorage.getItem("mremote-window-id");
    const activeWindowId = await IndexedDbService.getItem<string>(
      "mremote-active-window",
    );

    if (!windowId) {
      const newWindowId = generateId();
      sessionStorage.setItem("mremote-window-id", newWindowId);
      await IndexedDbService.setItem("mremote-active-window", newWindowId);
      return true;
    }

    if (activeWindowId && activeWindowId !== windowId) {
      return false; // Another window is active
    }

    await IndexedDbService.setItem("mremote-active-window", windowId);
    return true;
  }

  // Initialize all data
  /**
   * Loads all persisted data and performs optional auto-benchmarking.
   * Should be called during application start up.
   */
  async initialize(): Promise<void> {
    await this.loadSettings();
    await this.loadActionLog();
    await this.loadPerformanceMetrics();
    await this.loadCustomScripts();

    // Auto-benchmark if enabled
    if (this.settings.autoBenchmarkIterations) {
      try {
        const optimalIterations = await this.benchmarkKeyDerivation(
          this.settings.benchmarkTimeSeconds,
        );
        await this.saveSettings({ keyDerivationIterations: optimalIterations });
      } catch (error) {
        console.error("Auto-benchmark failed:", error);
      }
    }
  }
}
