// Re-export all types from split files so existing imports continue to work
export * from './backupSettings';
export * from './cloudSyncSettings';
export * from './vpnSettings';
export * from './sshSettings';

// Imports needed for GlobalSettings interface
import type { BackupConfig } from './backupSettings';
import type { CloudSyncConfig } from './cloudSyncSettings';
import type { OpenVPNConfig } from './vpnSettings';
import type { SSHTerminalConfig } from './sshSettings';
import type { RdpRecordingConfig, WebRecordingConfig } from './macroTypes';

export const Themes = [
  "dark",
  "light",
  "auto",
  "darkest",
  "oled",
  "semilight",
] as const;
// Allow custom theme names beyond the predefined list
export type Theme = (typeof Themes)[number] | string;

export const ColorSchemes = [
  // Reds
  "red",
  "rose",
  "pink",
  // Oranges
  "orange",
  "amber",
  // Yellows
  "yellow",
  "lime",
  // Greens
  "green",
  "emerald",
  "teal",
  // Blues
  "cyan",
  "sky",
  "blue",
  "indigo",
  // Purples
  "violet",
  "purple",
  "fuchsia",
  // Neutrals
  "slate",
  "grey",
] as const;
// Allow custom color scheme names beyond the predefined list
export type ColorScheme = (typeof ColorSchemes)[number] | string;

export const StatusCheckMethods = ["ping", "socket", "http"] as const;
export type StatusCheckMethod = (typeof StatusCheckMethods)[number];

export interface QuickConnectHistoryEntry {
  hostname: string;
  protocol: string;
  username?: string;
  authType?: "password" | "key";
}

export interface GlobalSettings {
  // General Settings
  language: string;
  theme: Theme;
  colorScheme: ColorScheme;
  primaryAccentColor?: string;
  customCss?: string;
  autoSaveEnabled: boolean;
  autoSaveIntervalMinutes: number;
  singleWindowMode: boolean;
  singleConnectionMode: boolean;
  reconnectOnReload: boolean;
  /** Allow browser autocomplete on input fields (default: false) */
  enableAutocomplete: boolean;
  warnOnClose: boolean;
  warnOnExit: boolean;
  warnOnDetachClose: boolean;
  quickConnectHistoryEnabled: boolean;
  quickConnectHistory: QuickConnectHistoryEntry[];
  detectUnexpectedClose: boolean;
  confirmMainAppClose: boolean;
  hideQuickStartMessage: boolean;
  hideQuickStartButtons: boolean;
  welcomeScreenTitle?: string;
  welcomeScreenMessage?: string;

  // Startup Settings
  startMinimized: boolean;
  startMaximized: boolean;
  startWithSystem: boolean;
  reconnectPreviousSessions: boolean;
  autoOpenLastCollection: boolean;
  lastOpenedCollectionId?: string;

  // Tray Settings
  minimizeToTray: boolean;
  closeToTray: boolean;
  showTrayIcon: boolean;

  // Click Action Settings
  singleClickConnect: boolean;
  singleClickDisconnect: boolean;
  doubleClickRename: boolean;
  doubleClickConnect: boolean;
  middleClickCloseTab: boolean;

  // ─── Tab Behavior ───────────────────────────────────────────
  /** Open new connections in a background tab (don't auto-switch) */
  openConnectionInBackground: boolean;
  /** Switch to a tab when it receives new output/activity */
  switchTabOnActivity: boolean;
  /** Close the tab automatically when the session disconnects */
  closeTabOnDisconnect: boolean;
  /** Confirm before closing a tab with an active session */
  confirmCloseActiveTab: boolean;
  /** Show a "recently closed" list to reopen tabs */
  enableRecentlyClosedTabs: boolean;
  /** Max items in the recently-closed tab list */
  recentlyClosedTabsMax: number;

  // ─── Focus & Navigation ─────────────────────────────────────
  /** Auto-focus the terminal/canvas when switching to a connection tab */
  focusTerminalOnTabSwitch: boolean;
  /** Scroll the sidebar tree to reveal the active connection */
  scrollTreeToActiveConnection: boolean;
  /** Restore the last active tab on startup */
  restoreLastActiveTab: boolean;
  /** Cycle tabs with Ctrl+Tab in most-recently-used order */
  tabCycleMru: boolean;

  // ─── Clipboard Behavior ─────────────────────────────────────
  /** Copy terminal selection to clipboard automatically */
  copyOnSelect: boolean;
  /** Paste clipboard on right-click in terminal */
  pasteOnRightClick: boolean;
  /** Clear clipboard N seconds after a password paste (0 = off) */
  clearClipboardAfterSeconds: number;
  /** Trim whitespace from pasted text */
  trimPastedWhitespace: boolean;
  /** Warn before pasting multi-line text into terminal */
  warnOnMultiLinePaste: boolean;
  /** Maximum paste size in characters before prompting (0 = no limit) */
  maxPasteLengthChars: number;

  // ─── Idle & Timeout ─────────────────────────────────────────
  /** Disconnect sessions after N minutes of idle (0 = never) */
  idleDisconnectMinutes: number;
  /** Send keepalive packets to prevent idle disconnect */
  sendKeepaliveOnIdle: boolean;
  /** Keepalive interval in seconds */
  keepaliveIntervalSeconds: number;
  /** Dim inactive/unfocused tabs to indicate they're not focused */
  dimInactiveTabs: boolean;
  /** Show idle duration badge on tabs */
  showIdleDuration: boolean;

  // ─── Reconnection Behavior ──────────────────────────────────
  /** Auto-reconnect when a session is unexpectedly disconnected */
  autoReconnectOnDisconnect: boolean;
  /** Max auto-reconnect attempts (0 = unlimited) */
  autoReconnectMaxAttempts: number;
  /** Base delay between reconnect attempts in seconds */
  autoReconnectDelaySecs: number;
  /** Show a notification when a session reconnects */
  notifyOnReconnect: boolean;

  // ─── Notification Behavior ──────────────────────────────────
  /** Show OS notification on connect */
  notifyOnConnect: boolean;
  /** Show OS notification on disconnect */
  notifyOnDisconnect: boolean;
  /** Show OS notification on error */
  notifyOnError: boolean;
  /** Play sound with notifications */
  notificationSound: boolean;
  /** Flash taskbar on background activity */
  flashTaskbarOnActivity: boolean;

  // ─── Confirmation Dialogs ───────────────────────────────────
  /** Confirm before disconnecting a session */
  confirmDisconnect: boolean;
  /** Confirm before deleting a connection */
  confirmDeleteConnection: boolean;
  /** Confirm before bulk operations (multi-select actions) */
  confirmBulkOperations: boolean;
  /** Confirm before importing connections */
  confirmImport: boolean;

  // ─── Drag & Drop ────────────────────────────────────────────
  /** Enable drag-and-drop file transfer to terminals */
  enableFileDragDropToTerminal: boolean;
  /** Drag start sensitivity in pixels */
  dragSensitivityPx: number;
  /** Show drop preview overlay when dragging connections */
  showDropPreview: boolean;

  // ─── Scroll & Input ─────────────────────────────────────────
  /** Scroll speed multiplier for terminal (1.0 = default) */
  terminalScrollSpeed: number;
  /** Enable smooth scrolling in terminal */
  terminalSmoothScroll: boolean;
  /** Right-click action in connection tree: 'contextMenu' or 'quickConnect' */
  treeRightClickAction: 'contextMenu' | 'quickConnect';
  /** Mouse-back button action: 'none', 'previousTab', 'disconnect' */
  mouseBackAction: 'none' | 'previousTab' | 'disconnect';
  /** Mouse-forward button action: 'none', 'nextTab', 'reconnect' */
  mouseForwardAction: 'none' | 'nextTab' | 'reconnect';

  // Animation Settings
  animationsEnabled: boolean;
  animationDuration: number; // milliseconds
  reduceMotion: boolean;

  // Theme Effects
  backgroundGlowEnabled: boolean;
  backgroundGlowFollowsColorScheme: boolean;
  backgroundGlowColor: string;
  backgroundGlowOpacity: number;
  backgroundGlowRadius: number;
  backgroundGlowBlur: number;

  // Window Effects
  windowTransparencyEnabled: boolean;
  windowTransparencyOpacity: number;
  showTransparencyToggle: boolean;

  // Secondary Bar Toggles
  showQuickConnectIcon: boolean;
  showCollectionSwitcherIcon: boolean;
  showImportExportIcon: boolean;
  showSettingsIcon: boolean;
  showPerformanceMonitorIcon: boolean;
  showActionLogIcon: boolean;
  showDevtoolsIcon: boolean;
  showSecurityIcon: boolean;
  showProxyMenuIcon: boolean;
  showInternalProxyIcon: boolean;
  showShortcutManagerIcon: boolean;
  showWolIcon: boolean;
  showBulkSSHIcon: boolean;
  showScriptManagerIcon: boolean;
  showMacroManagerIcon: boolean;
  showSyncBackupStatusIcon: boolean;  // Legacy combined icon
  showBackupStatusIcon: boolean;      // Separate backup icon
  showCloudSyncStatusIcon: boolean;   // Separate cloud sync icon
  showErrorLogBar: boolean;
  showRdpSessionsIcon: boolean;

  // Recording & Macros
  recording: RecordingConfig;
  rdpRecording: RdpRecordingConfig;
  webRecording: WebRecordingConfig;
  macros: MacroConfig;
  /** Show Recording Manager icon in secondary bar */
  showRecordingManagerIcon: boolean;

  // Auto Lock
  autoLock: AutoLockConfig;

  // Performance Settings
  maxConcurrentConnections: number;
  connectionTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  enablePerformanceTracking: boolean;
  performancePollIntervalMs: number;
  performanceLatencyTarget: string;

  // Security Settings
  encryptionAlgorithm: "AES-256-GCM" | "AES-256-CBC" | "ChaCha20-Poly1305" | "AES-256-GCM-SIV" | "Salsa20" | "XSalsa20-Poly1305" | "Threefish-256" | "Threefish-512" | "Threefish-1024" | "Serpent-256-GCM" | "Serpent-256-CBC" | "Twofish-256-GCM" | "Twofish-256-CBC";
  blockCipherMode: "GCM" | "CBC" | "CTR" | "OFB" | "CFB" | "GCM-SIV" | "SIV";
  keyDerivationIterations: number;
  autoBenchmarkIterations: boolean;
  benchmarkTimeSeconds: number;

  // TOTP Settings
  totpEnabled: boolean;
  totpIssuer: string;
  totpDigits: number;
  totpPeriod: number;
  totpAlgorithm: 'sha1' | 'sha256' | 'sha512';

  // Proxy Settings
  globalProxy?: ProxyConfig;

  // OpenVPN Settings
  openvpn?: OpenVPNConfig;

  // Tab Settings
  tabGrouping: "none" | "protocol" | "status" | "hostname" | "colorTag";
  hostnameOverride: boolean;
  defaultTabLayout: "tabs" | "sideBySide" | "mosaic" | "miniMosaic";
  enableTabDetachment: boolean;
  enableTabResize: boolean;
  enableZoom: boolean;
  enableTabReorder: boolean;
  enableConnectionReorder: boolean;

  // Color Tags
  colorTags: {
    [key: string]: {
      name: string;
      color: string;
      global: boolean;
    };
  };

  // Status Checking
  enableStatusChecking: boolean;
  statusCheckInterval: number;
  statusCheckMethod: StatusCheckMethod;

  // Layout Persistence
  persistWindowSize: boolean;
  persistWindowPosition: boolean;
  persistSidebarWidth: boolean;
  persistSidebarPosition: boolean;
  persistSidebarCollapsed: boolean;
  windowSize?: { width: number; height: number };
  windowPosition?: { x: number; y: number };
  sidebarWidth?: number;
  sidebarPosition?: "left" | "right";
  sidebarCollapsed?: boolean;

  // Window Repatriation (bring window back to visible screen area)
  autoRepatriateWindow: boolean;

  // Network Discovery
  networkDiscovery: NetworkDiscoveryConfig;

  // REST API / Internal Server
  restApi: {
    enabled: boolean;
    port: number;
    useRandomPort: boolean;
    authentication: boolean;
    apiKey?: string;
    corsEnabled: boolean;
    rateLimiting: boolean;
    startOnLaunch: boolean;
    allowRemoteConnections: boolean;
    sslEnabled: boolean;
    sslMode: 'manual' | 'self-signed' | 'letsencrypt';
    sslCertPath?: string;
    sslKeyPath?: string;
    sslDomain?: string;
    sslEmail?: string;
    maxRequestsPerMinute: number;
    maxThreads: number;
    requestTimeout: number;
  };

  // Wake on LAN
  wolEnabled: boolean;
  wolPort: number;
  wolBroadcastAddress: string;

  // Logging
  enableActionLog: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  maxLogEntries: number;

  // Export Settings
  exportEncryption: boolean;
  exportPassword?: string;

  // SSH Terminal Settings
  sshTerminal: SSHTerminalConfig;

  // Backup Settings
  backup: BackupConfig;

  // Cloud Sync Settings
  cloudSync: CloudSyncConfig;

  // Trust & Verification
  /** Default TLS certificate trust policy */
  tlsTrustPolicy: 'tofu' | 'always-ask' | 'always-trust' | 'strict';
  /** Default SSH host key trust policy */
  sshTrustPolicy: 'tofu' | 'always-ask' | 'always-trust' | 'strict';
  /** Show certificate / host-key info in the URL bar / terminal toolbar */
  showTrustIdentityInfo: boolean;
  /** Warn on TLS certificate expiry within N days (0 = disabled) */
  certExpiryWarningDays: number;

  // ── Web Browser / HTTP proxy settings ──

  /** Enable automatic proxy keepalive health checks */
  proxyKeepaliveEnabled: boolean;
  /** Proxy health-check polling interval in seconds */
  proxyKeepaliveIntervalSeconds: number;
  /** Automatically restart a dead proxy without user intervention */
  proxyAutoRestart: boolean;
  /** Maximum consecutive auto-restart attempts before stopping (0 = unlimited) */
  proxyMaxAutoRestarts: number;

  /** Ask for confirmation before deleting all bookmarks */
  confirmDeleteAllBookmarks: boolean;

  // ─── CredSSP Remediation Defaults ──────────────────────────────
  /**
   * Global default CredSSP / NLA security policy applied to new connections
   * and connections that don't override these per-connection.
   */
  credsspDefaults: CredsspDefaultsConfig;

  // ─── Password Reveal ──────────────────────────────────────────
  /**
   * Controls the show/hide password eye icon on all password fields.
   */
  passwordReveal: PasswordRevealConfig;

  // ─── RDP Global Defaults ──────────────────────────────────────
  /**
   * Global default RDP configuration applied to new connections.
   * Per-connection settings override these.
   */
  rdpDefaults: RdpGlobalDefaultsConfig;

  // ─── RDP Session Panel Settings ─────────────────────────────
  /** Display mode for the RDP session manager: 'panel' (right sidebar) or 'popup' (modal overlay) */
  rdpSessionDisplayMode: 'panel' | 'popup';
  /** Whether to show live thumbnails in the RDP session list */
  rdpSessionThumbnailsEnabled: boolean;
  /**
   * When to capture thumbnails:
   * - 'realtime': Periodically update while session is active (every 5s)
   * - 'on-blur': Capture when the session tab loses focus / is switched away
   * - 'on-detach': Capture only when the viewer is detached
   * - 'manual': Only capture when the user explicitly requests
   */
  rdpSessionThumbnailPolicy: 'realtime' | 'on-blur' | 'on-detach' | 'manual';
  /** Thumbnail refresh interval in seconds (only for 'realtime' policy) */
  rdpSessionThumbnailInterval: number;
  /** What happens when an RDP tab is closed: 'disconnect' fully ends the session, 'detach' keeps it running in background */
  rdpSessionClosePolicy: 'disconnect' | 'detach' | 'ask';

  // ─── Backend / Tauri Runtime Settings ────────────────────────
  backendConfig: BackendConfig;
}

/** Global default CredSSP remediation configuration */
export interface CredsspDefaultsConfig {
  /** Encryption Oracle Remediation policy */
  oracleRemediation: 'force-updated' | 'mitigated' | 'vulnerable';
  /** Allow HYBRID_EX protocol (Early User Auth Result) */
  allowHybridEx: boolean;
  /** Allow fallback from NLA to TLS when NLA negotiation fails */
  nlaFallbackToTls: boolean;
  /** Minimum TLS version for RDP connections */
  tlsMinVersion: '1.0' | '1.1' | '1.2' | '1.3';
  /** Enable NTLM authentication */
  ntlmEnabled: boolean;
  /** Enable Kerberos authentication */
  kerberosEnabled: boolean;
  /** Enable PKU2U authentication */
  pku2uEnabled: boolean;
  /** Restricted Admin mode (no credential delegation) */
  restrictedAdmin: boolean;
  /** Remote Credential Guard */
  remoteCredentialGuard: boolean;
  /** Enforce server public key validation during CredSSP */
  enforceServerPublicKeyValidation: boolean;
  /** CredSSP TSRequest version to advertise */
  credsspVersion: 2 | 3 | 6;
  /** Custom SSPI package list override (e.g. "!kerberos,!pku2u") */
  sspiPackageList: string;
  /** Default NLA mode for new connections */
  nlaMode: 'required' | 'preferred' | 'disabled';
  /** Default server cert validation mode */
  serverCertValidation: 'validate' | 'warn' | 'ignore';
}

/** Password reveal (show/hide eye icon) configuration */
export interface PasswordRevealConfig {
  /** Whether the eye icon is shown on password fields at all */
  enabled: boolean;
  /** Interaction mode: 'toggle' = click to toggle, 'hold' = hold to reveal */
  mode: 'toggle' | 'hold';
  /** Auto-hide password after this many seconds (0 = never auto-hide) */
  autoHideSeconds: number;
  /** Show passwords by default when a password field is rendered */
  showByDefault: boolean;
  /** Whether to mask the password icon itself when hidden */
  maskIcon: boolean;
}

/** Global default RDP configuration applied to new connections */
export interface RdpGlobalDefaultsConfig {
  // ─── Security defaults ─────────────────────────────────────
  /** Master CredSSP toggle: enable/disable CredSSP globally */
  useCredSsp: boolean;
  /** Enable TLS for RDP connections */
  enableTls: boolean;
  /** Enable NLA (Network Level Authentication) */
  enableNla: boolean;
  /** Auto logon (send credentials in INFO packet) */
  autoLogon: boolean;

  // ─── Gateway defaults ──────────────────────────────────────
  /** Enable RDP Gateway by default */
  gatewayEnabled: boolean;
  /** Default gateway hostname */
  gatewayHostname: string;
  /** Default gateway port */
  gatewayPort: number;
  /** Default gateway auth method */
  gatewayAuthMethod: 'ntlm' | 'basic' | 'digest' | 'negotiate' | 'smartcard';
  /** Default gateway transport */
  gatewayTransportMode: 'auto' | 'http' | 'udp';
  /** Bypass gateway for local addresses */
  gatewayBypassLocal: boolean;

  // ─── Hyper-V defaults ──────────────────────────────────────
  /** Default to Hyper-V Enhanced Session Mode */
  enhancedSessionMode: boolean;

  // ─── Negotiation defaults ──────────────────────────────────
  /** Enable auto-detect negotiation by default */
  autoDetect: boolean;
  /** Default negotiation strategy */
  negotiationStrategy: 'auto' | 'nla-first' | 'tls-first' | 'nla-only' | 'tls-only' | 'plain-only';
  /** Max auto-detect retries */
  maxRetries: number;
  /** Delay between retries in ms */
  retryDelayMs: number;

  // ─── Display defaults ──────────────────────────────────────
  /** Default resolution width */
  defaultWidth: number;
  /** Default resolution height */
  defaultHeight: number;
  /** Default color depth */
  defaultColorDepth: 16 | 24 | 32;
  /** Default smart sizing */
  smartSizing: boolean;

  // ─── TCP / Socket defaults ─────────────────────────────────
  /** TCP connect timeout in seconds */
  tcpConnectTimeoutSecs: number;
  /** Enable TCP_NODELAY (disable Nagle) */
  tcpNodelay: boolean;
  /** Enable TCP keep-alive */
  tcpKeepAlive: boolean;
  /** TCP keep-alive interval in seconds */
  tcpKeepAliveIntervalSecs: number;
  /** Socket receive buffer size in bytes */
  tcpRecvBufferSize: number;
  /** Socket send buffer size in bytes */
  tcpSendBufferSize: number;

  // ─── Performance / Frame Delivery defaults ─────────────────
  /** Target frame rate limit (0 = unlimited) */
  targetFps: number;
  /** Frame batching: accumulate dirty regions and emit combined updates */
  frameBatching: boolean;
  /** Frame batch interval in ms (16 = ~60fps, 33 = ~30fps) */
  frameBatchIntervalMs: number;
  /** Full-frame sync interval (emit complete framebuffer every N frames) */
  fullFrameSyncInterval: number;
  /** Read timeout in ms for the PDU read loop */
  readTimeoutMs: number;

  // ─── Bitmap Codec defaults ─────────────────────────────────
  /** Enable bitmap codec negotiation (when false, only raw/RLE bitmaps) */
  codecsEnabled: boolean;
  /** Enable RemoteFX (RFX) codec */
  remoteFxEnabled: boolean;
  /** RemoteFX entropy algorithm */
  remoteFxEntropy: 'rlgr1' | 'rlgr3';
  /** Enable RDPGFX (H.264 hardware decode) via Dynamic Virtual Channel */
  gfxEnabled: boolean;
  /** H.264 decoder preference */
  h264Decoder: 'auto' | 'media-foundation' | 'openh264';

  // ─── Server-side Compositor default ────────────────────────
  /**
   * Default server-side compositor for RDP frame accumulation.
   * - `webview` — no compositor, direct per-region streaming
   * - `softbuffer` — CPU shadow buffer compositor
   * - `wgpu` — GPU compositor (CPU fallback currently)
   * - `auto` — try wgpu → softbuffer → webview
   */
  renderBackend: 'auto' | 'softbuffer' | 'wgpu' | 'webview';

  // ─── Client-side Renderer default ──────────────────────────
  /**
   * Default frontend canvas renderer for painting received frames.
   * - `auto` — best available (WebGPU → WebGL → Canvas 2D)
   * - `canvas2d` — Canvas 2D putImageData (baseline)
   * - `webgl` — WebGL texSubImage2D (GPU texture upload)
   * - `webgpu` — WebGPU writeTexture (latest GPU API)
   * - `offscreen-worker` — OffscreenCanvas in a Worker
   */
  frontendRenderer: 'auto' | 'canvas2d' | 'webgl' | 'webgpu' | 'offscreen-worker';

  // ─── Reconnection defaults ─────────────────────────────────
  /** Base delay in seconds between reconnection attempts */
  reconnectBaseDelaySecs: number;
  /** Maximum delay in seconds between reconnection attempts */
  reconnectMaxDelaySecs: number;
  /** Automatically reconnect on network loss */
  reconnectOnNetworkLoss: boolean;
}

export interface ProxyConfig {
  type: "http" | "https" | "socks4" | "socks5" | "ssh" | "dns-tunnel" | "icmp-tunnel" | "websocket" | "quic" | "tcp-over-dns" | "http-connect" | "shadowsocks";
  host: string;
  port: number;
  username?: string;
  password?: string;
  enabled: boolean;

  // SSH-specific options
  sshKeyFile?: string;
  sshKeyPassphrase?: string;
  sshHostKeyVerification?: boolean;
  sshKnownHostsFile?: string;

  // Advanced tunneling options
  tunnelDomain?: string; // For DNS tunneling
  tunnelKey?: string; // Encryption key for tunneling
  tunnelMethod?: "direct" | "fragmented" | "obfuscated"; // Tunneling method
  customHeaders?: Record<string, string>; // For HTTP-based tunneling
  websocketPath?: string; // For WebSocket tunneling
  quicCertFile?: string; // For QUIC tunneling
  shadowsocksMethod?: string; // Shadowsocks encryption method
  shadowsocksPlugin?: string; // Shadowsocks plugin
}

export interface SecurityConfig {
  encryptionAlgorithm: string;
  blockCipherMode: string;
  keyDerivationIterations: number;
  enableSSHTunneling: boolean;
  sshTunnelConnection?: string;
}

export interface PerformanceMetrics {
  connectionTime: number;
  dataTransferred: number;
  latency: number;
  throughput: number;
  cpuUsage: number;
  memoryUsage: number;
  packetLoss?: number;
  jitter?: number;
  timestamp: number;
}

export interface ActionLogEntry {
  id: string;
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  action: string;
  connectionId?: string;
  connectionName?: string;
  details: string;
  duration?: number;
}

export interface CustomScript {
  id: string;
  name: string;
  type: "javascript" | "typescript";
  content: string;
  trigger: "onConnect" | "onDisconnect" | "manual";
  protocol?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NetworkDiscoveryConfig {
  enabled: boolean;
  ipRange: string;
  portRanges: string[];
  protocols: string[];
  timeout: number;
  maxConcurrent: number;
  maxPortConcurrent: number;
  customPorts: Record<string, number[]>;
  probeStrategies: Record<string, ("websocket" | "http")[]>;
  cacheTTL: number;
  hostnameTtl: number;
  macTtl: number;
}

export interface TOTPConfig {
  secret: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
  algorithm: "sha1" | "sha256" | "sha512";
  backupCodes?: string[];
  createdAt?: string;
}

export interface BackendConfig {
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  maxConcurrentRdpSessions: number;
  rdpServerRenderer: 'auto' | 'softbuffer' | 'wgpu' | 'webview';
  rdpCodecPreference: 'auto' | 'remotefx' | 'gfx' | 'h264' | 'bitmap';
  tcpDefaultBufferSize: number;
  tcpKeepAliveSeconds: number;
  connectionTimeoutSeconds: number;
  tempFileCleanupEnabled: boolean;
  tempFileCleanupIntervalMinutes: number;
  cacheSizeMb: number;
  tlsMinVersion: '1.2' | '1.3';
  certValidationMode: 'strict' | 'tofu' | 'permissive';
  allowedCipherSuites: string[];
  enableInternalApi: boolean;
  internalApiPort: number;
  internalApiAuth: boolean;
  internalApiCors: boolean;
  internalApiRateLimit: number;
  internalApiSsl: boolean;
}

export interface ThemeConfig {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    success: string;
    warning: string;
    error: string;
  };
}

export interface RecordingConfig {
  autoRecordSessions: boolean;
  recordInput: boolean;
  maxRecordingDurationMinutes: number;
  maxStoredRecordings: number;
  defaultExportFormat: 'json' | 'asciicast' | 'script' | 'gif';
}

export interface MacroConfig {
  defaultStepDelayMs: number;
  confirmBeforeReplay: boolean;
  maxMacroSteps: number;
}

export interface AutoLockConfig {
  enabled: boolean;
  timeoutMinutes: number;
  lockOnIdle: boolean;
  lockOnSuspend: boolean;
  requirePassword: boolean;
}
