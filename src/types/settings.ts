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
  showSyncBackupStatusIcon: boolean;  // Legacy combined icon
  showBackupStatusIcon: boolean;      // Separate backup icon
  showCloudSyncStatusIcon: boolean;   // Separate cloud sync icon
  showErrorLogBar: boolean;

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
  middleClickCloseTab: boolean;

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
}

// Backup scheduling frequency
export const BackupFrequencies = [
  'manual',
  'hourly',
  'daily',
  'weekly',
  'monthly',
] as const;
export type BackupFrequency = (typeof BackupFrequencies)[number];

// Day of week for weekly backups
export const DaysOfWeek = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type DayOfWeek = (typeof DaysOfWeek)[number];

// Backup format options
export const BackupFormats = ['json', 'xml', 'encrypted-json'] as const;
export type BackupFormat = (typeof BackupFormats)[number];

// Backup encryption algorithms
export const BackupEncryptionAlgorithms = [
  'AES-256-GCM',
  'AES-256-CBC',
  'AES-128-GCM',
  'ChaCha20-Poly1305',
  'Serpent-256-GCM',
  'Serpent-256-CBC',
  'Twofish-256-GCM',
  'Twofish-256-CBC',
] as const;
export type BackupEncryptionAlgorithm = (typeof BackupEncryptionAlgorithms)[number];

// Backup location presets
export const BackupLocationPresets = [
  'custom',
  'appData',
  'documents',
  'googleDrive',
  'oneDrive',
  'nextcloud',
  'dropbox',
] as const;
export type BackupLocationPreset = (typeof BackupLocationPresets)[number];

export interface BackupConfig {
  // Enable automatic backups
  enabled: boolean;
  
  // Backup frequency
  frequency: BackupFrequency;
  
  // Time of day for daily/weekly/monthly backups (HH:MM format)
  scheduledTime: string;
  
  // Day of week for weekly backups
  weeklyDay: DayOfWeek;
  
  // Day of month for monthly backups (1-28)
  monthlyDay: number;
  
  // Backup destination folder path
  destinationPath: string;
  
  // Use differential backups (only backup changes)
  differentialEnabled: boolean;
  
  // Keep full backup every N differential backups
  fullBackupInterval: number;
  
  // Maximum number of backups to keep (0 = unlimited)
  maxBackupsToKeep: number;
  
  // Backup format
  format: BackupFormat;
  
  // Include passwords in backup
  includePasswords: boolean;
  
  // Encrypt backups
  encryptBackups: boolean;
  
  // Backup encryption algorithm
  encryptionAlgorithm: BackupEncryptionAlgorithm;
  
  // Backup encryption password (stored securely)
  encryptionPassword?: string;
  
  // Backup location preset
  locationPreset: BackupLocationPreset;
  
  // Custom path for cloud services (e.g., Nextcloud folder path)
  cloudCustomPath?: string;
  
  // Include settings in backup
  includeSettings: boolean;
  
  // Include SSH keys in backup
  includeSSHKeys: boolean;
  
  // Last backup timestamp
  lastBackupTime?: number;
  
  // Last full backup timestamp (for differential)
  lastFullBackupTime?: number;
  
  // Backup on app close
  backupOnClose: boolean;
  
  // Show notification after backup
  notifyOnBackup: boolean;
  
  // Compress backups
  compressBackups: boolean;
}

export const defaultBackupConfig: BackupConfig = {
  enabled: false,
  frequency: 'daily',
  scheduledTime: '03:00',
  weeklyDay: 'sunday',
  monthlyDay: 1,
  destinationPath: '',
  differentialEnabled: true,
  fullBackupInterval: 7,
  maxBackupsToKeep: 30,
  format: 'json',
  includePasswords: false,
  encryptBackups: true,
  encryptionAlgorithm: 'AES-256-GCM',
  locationPreset: 'custom',
  includeSettings: true,
  includeSSHKeys: false,
  backupOnClose: false,
  notifyOnBackup: true,
  compressBackups: true,
};

// Cloud Sync Provider Types
export const CloudSyncProviders = [
  'none',
  'googleDrive',
  'oneDrive',
  'nextcloud',
  'webdav',
  'sftp',
] as const;
export type CloudSyncProvider = (typeof CloudSyncProviders)[number];

// Cloud Sync Frequency
export const CloudSyncFrequencies = [
  'manual',
  'realtime',
  'onSave',
  'every5Minutes',
  'every15Minutes',
  'every30Minutes',
  'hourly',
  'daily',
] as const;
export type CloudSyncFrequency = (typeof CloudSyncFrequencies)[number];

// Conflict Resolution Strategy
export const ConflictResolutionStrategies = [
  'askEveryTime',
  'keepLocal',
  'keepRemote',
  'keepNewer',
  'merge',
] as const;
export type ConflictResolutionStrategy = (typeof ConflictResolutionStrategies)[number];

// Per-provider sync status
export interface ProviderSyncStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'conflict';
  lastSyncError?: string;
}

// Cloud Sync Configuration
export interface CloudSyncConfig {
  // Enable cloud sync (master switch)
  enabled: boolean;
  
  // Legacy: Selected cloud provider (for backward compatibility)
  provider: CloudSyncProvider;
  
  // Multi-target: Enabled providers list
  enabledProviders: CloudSyncProvider[];
  
  // Per-provider sync status
  providerStatus: Partial<Record<CloudSyncProvider, ProviderSyncStatus>>;
  
  // Sync frequency
  frequency: CloudSyncFrequency;
  
  // Google Drive specific
  googleDrive: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
    folderId?: string;
    folderPath: string;
    accountEmail?: string;
  };
  
  // OneDrive specific
  oneDrive: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
    driveId?: string;
    folderPath: string;
    accountEmail?: string;
  };
  
  // Nextcloud specific
  nextcloud: {
    serverUrl: string;
    username: string;
    password?: string;
    appPassword?: string;
    folderPath: string;
    useAppPassword: boolean;
  };
  
  // WebDAV specific
  webdav: {
    serverUrl: string;
    username: string;
    password?: string;
    folderPath: string;
    authMethod: 'basic' | 'digest' | 'bearer';
    bearerToken?: string;
  };
  
  // SFTP specific
  sftp: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    folderPath: string;
    authMethod: 'password' | 'key';
  };
  
  // Sync options
  syncConnections: boolean;
  syncSettings: boolean;
  syncSSHKeys: boolean;
  syncScripts: boolean;
  syncColorTags: boolean;
  syncShortcuts: boolean;
  
  // Encryption options
  encryptBeforeSync: boolean;
  syncEncryptionPassword?: string;
  
  // Conflict resolution
  conflictResolution: ConflictResolutionStrategy;
  
  // Last sync timestamps
  lastSyncTime?: number;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'conflict';
  lastSyncError?: string;
  
  // Sync on startup/shutdown
  syncOnStartup: boolean;
  syncOnShutdown: boolean;
  
  // Notifications
  notifyOnSync: boolean;
  notifyOnConflict: boolean;
  
  // Advanced options
  maxFileSizeMB: number;
  excludePatterns: string[];
  compressionEnabled: boolean;
  
  // Bandwidth limiting (KB/s, 0 = unlimited)
  uploadLimitKBs: number;
  downloadLimitKBs: number;
}

export const defaultCloudSyncConfig: CloudSyncConfig = {
  enabled: false,
  provider: 'none',
  enabledProviders: [],
  providerStatus: {},
  frequency: 'manual',
  googleDrive: {
    folderPath: '/sortOfRemoteNG',
  },
  oneDrive: {
    folderPath: '/sortOfRemoteNG',
  },
  nextcloud: {
    serverUrl: '',
    username: '',
    folderPath: '/sortOfRemoteNG',
    useAppPassword: true,
  },
  webdav: {
    serverUrl: '',
    username: '',
    folderPath: '/sortOfRemoteNG',
    authMethod: 'basic',
  },
  sftp: {
    host: '',
    port: 22,
    username: '',
    folderPath: '/sortOfRemoteNG',
    authMethod: 'password',
  },
  syncConnections: true,
  syncSettings: true,
  syncSSHKeys: false,
  syncScripts: true,
  syncColorTags: true,
  syncShortcuts: true,
  encryptBeforeSync: true,
  conflictResolution: 'askEveryTime',
  syncOnStartup: false,
  syncOnShutdown: false,
  notifyOnSync: true,
  notifyOnConflict: true,
  maxFileSizeMB: 50,
  excludePatterns: [],
  compressionEnabled: true,
  uploadLimitKBs: 0,
  downloadLimitKBs: 0,
};

// Saved Proxy Profile
export interface SavedProxyProfile {
  id: string;
  name: string;
  description?: string;
  config: ProxyConfig;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  isDefault?: boolean;
}

// SSH Chaining Method types (re-exported from connection.ts for convenience)
export type SSHChainingMethod = 
  | 'proxyjump'       // Modern -J / ProxyJump (recommended)
  | 'proxycommand'    // Classic ProxyCommand with nc/ncat/socat
  | 'nested-ssh'      // Nested SSH commands (ssh -t host1 ssh host2)
  | 'local-forward'   // Local port forwarding (-L)
  | 'dynamic-socks'   // Dynamic SOCKS proxy (-D)
  | 'stdio'           // stdio forwarding via ProxyUseFdpass
  | 'agent-forward';  // SSH agent forwarding (-A)

// Dynamic chaining strategy for the entire chain
export type DynamicChainingStrategy =
  | 'strict'          // All hops must succeed in order
  | 'dynamic'         // Try hops dynamically, skip failed ones
  | 'random'          // Randomize hop order (for anonymity)
  | 'round-robin'     // Rotate through available paths
  | 'failover'        // Use backup path on failure
  | 'load-balance';   // Distribute across multiple paths

// Proxy Chain Definition (for saved chains)
export interface SavedProxyChain {
  id: string;
  name: string;
  description?: string;
  layers: SavedChainLayer[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  
  // Chain dynamics configuration
  dynamics?: {
    strategy: DynamicChainingStrategy;
    // For failover: alternative chains to try
    fallbackChainIds?: string[];
    // For random: seed or deterministic randomization
    randomSeed?: number;
    // For round-robin/load-balance: weights per path
    pathWeights?: Record<string, number>;
    // Timeout per hop before trying next (ms)
    hopTimeoutMs?: number;
    // Max retries per hop
    maxRetriesPerHop?: number;
    // Whether to reuse established connections
    reuseConnections?: boolean;
    // Keep-alive settings
    keepAliveIntervalMs?: number;
  };
}

export interface SavedChainLayer {
  position: number;
  proxyProfileId?: string;  // Reference to SavedProxyProfile
  vpnProfileId?: string;    // Reference to saved VPN profile
  type: 'proxy' | 'openvpn' | 'wireguard' | 'ssh-tunnel' | 'ssh-jump' | 'ssh-proxycmd';
  // Inline config (alternative to profile reference)
  inlineConfig?: ProxyConfig | OpenVPNConfig | WireGuardConfig | SSHJumpConfig;
  
  // Per-node SSH chaining method selection
  sshChainingMethod?: SSHChainingMethod;
  
  // Per-node chain dynamics override
  nodeConfig?: {
    // Skip this node if it fails (for dynamic chaining)
    skipOnFailure?: boolean;
    // Retry count for this specific node
    retryCount?: number;
    // Timeout override for this node (ms)
    timeoutMs?: number;
    // Weight for load-balancing
    weight?: number;
    // Whether this is a backup node (only used in failover)
    isBackup?: boolean;
    // Priority (lower = higher priority)
    priority?: number;
  };
}

// SSH Jump host configuration for inline config in chains
export interface SSHJumpConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  connectionId?: string;  // Or reference existing connection
  
  // For ProxyCommand style
  proxyCommand?: string;
  proxyCommandTemplate?: 'nc' | 'ncat' | 'socat' | 'connect' | 'corkscrew';
  
  // For nested SSH style
  allocateTty?: boolean;
  
  // Jump through multiple hosts
  jumpChain?: Array<{
    host: string;
    port?: number;
    username?: string;
    connectionId?: string;
  }>;
}

// Proxy Collection Manager Storage
export interface ProxyCollectionData {
  profiles: SavedProxyProfile[];
  chains: SavedProxyChain[];
  version: number;
}

export const defaultProxyCollectionData: ProxyCollectionData = {
  profiles: [],
  chains: [],
  version: 1,
};

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

export interface OpenVPNConfig {
  enabled: boolean;
  configFile?: string;
  authFile?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  username?: string;
  password?: string;
  remoteHost?: string;
  remotePort?: number;
  protocol?: "udp" | "tcp";
  cipher?: string;
  auth?: string;
  tlsAuth?: boolean;
  tlsCrypt?: boolean;
  compression?: boolean;
  mssFix?: number;
  tunMtu?: number;
  fragment?: number;
  mtuDiscover?: boolean;
  keepAlive?: {
    interval: number;
    timeout: number;
  };
  routeNoPull?: boolean;
  route?: Array<{
    network: string;
    netmask: string;
    gateway?: string;
  }>;
  dns?: Array<{
    server: string;
    domain?: string;
  }>;
  customOptions?: string[];
}

export interface WireGuardConfig {
  enabled: boolean;
  interface: {
    privateKey: string;
    address: string[];
    dns?: string[];
    mtu?: number;
    table?: string | number;
    preUp?: string[];
    postUp?: string[];
    preDown?: string[];
    postDown?: string[];
  };
  peer: {
    publicKey: string;
    presharedKey?: string;
    endpoint?: string;
    allowedIPs: string[];
    persistentKeepalive?: number;
  };
  configFile?: string;
}

export interface IKEv2Config {
  enabled: boolean;
  server: string;
  username: string;
  password?: string;
  certificate?: string;
  privateKey?: string;
  caCertificate?: string;
  eapMethod?: "mschapv2" | "tls" | "peap";
  phase1Algorithms?: string;
  phase2Algorithms?: string;
  ikeVersion?: "ikev1" | "ikev2";
  localId?: string;
  remoteId?: string;
  fragmentation?: boolean;
  mobike?: boolean;
  customOptions?: string[];
}

export interface SSTPConfig {
  enabled: boolean;
  server: string;
  username: string;
  password?: string;
  domain?: string;
  certificate?: string;
  caCertificate?: string;
  ignoreCertificate?: boolean;
  proxy?: ProxyConfig;
  customOptions?: string[];
}

export interface L2TPConfig {
  enabled: boolean;
  server: string;
  username: string;
  password: string;
  pppSettings?: {
    mru?: number;
    mtu?: number;
    lcpEchoInterval?: number;
    lcpEchoFailure?: number;
    requireChap?: boolean;
    refuseChap?: boolean;
    requireMsChap?: boolean;
    refuseMsChap?: boolean;
    requireMsChapV2?: boolean;
    refuseMsChapV2?: boolean;
    requireEap?: boolean;
    refuseEap?: boolean;
    requirePap?: boolean;
    refusePap?: boolean;
  };
  ipsecSettings?: {
    ike?: string;
    esp?: string;
    pfs?: string;
    ikelifetime?: number;
    lifetime?: number;
    phase2alg?: string;
  };
  customOptions?: string[];
}

export interface PPTPConfig {
  enabled: boolean;
  server: string;
  username: string;
  password: string;
  domain?: string;
  requireMppe?: boolean;
  mppeStateful?: boolean;
  refuseEap?: boolean;
  refusePap?: boolean;
  refuseChap?: boolean;
  refuseMsChap?: boolean;
  refuseMsChapV2?: boolean;
  nobsdcomp?: boolean;
  nodeflate?: boolean;
  noVjComp?: boolean;
  customOptions?: string[];
}

export interface SoftEtherConfig {
  enabled: boolean;
  host: string;
  port?: number;
  hub: string;
  username: string;
  password: string;
  certificate?: string;
  privateKey?: string;
  checkCertificate?: boolean;
  protocol?: "tcp" | "udp" | "tcp+udp";
  customOptions?: string[];
}

export interface ZeroTierConfig {
  enabled: boolean;
  networkId: string;
  identity?: {
    public: string;
    secret: string;
  };
  allowManaged?: boolean;
  allowGlobal?: boolean;
  allowDefault?: boolean;
  allowDNS?: boolean;
  customOptions?: string[];
}

export interface TailscaleConfig {
  enabled: boolean;
  authKey?: string;
  loginServer?: string;
  routes?: string[];
  exitNode?: string;
  advertiseRoutes?: string[];
  acceptRoutes?: boolean;
  ssh?: boolean;
  customOptions?: string[];
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

export interface AutoLockConfig {
  enabled: boolean;
  timeoutMinutes: number;
  lockOnIdle: boolean;
  lockOnSuspend: boolean;
  requirePassword: boolean;
}

// SSH Terminal Simulation Configuration Types
export const BellStyles = [
  'none',
  'system',
  'visual',
  'flash-window',
  'pc-speaker',
] as const;
export type BellStyle = (typeof BellStyles)[number];

export const TaskbarFlashModes = [
  'disabled',
  'flashing',
  'steady',
] as const;
export type TaskbarFlashMode = (typeof TaskbarFlashModes)[number];

export const LocalEchoModes = [
  'auto',
  'on',
  'off',
] as const;
export type LocalEchoMode = (typeof LocalEchoModes)[number];

export const LineEditingModes = [
  'auto',
  'on',
  'off',
] as const;
export type LineEditingMode = (typeof LineEditingModes)[number];

export const IPProtocols = [
  'auto',
  'ipv4',
  'ipv6',
] as const;
export type IPProtocol = (typeof IPProtocols)[number];

export const SSHVersions = [
  'auto',
  '1',
  '2',
  '3',
] as const;
export type SSHVersion = (typeof SSHVersions)[number];

export const CharacterSets = [
  'UTF-8',
  'ISO-8859-1',
  'ISO-8859-2',
  'ISO-8859-3',
  'ISO-8859-4',
  'ISO-8859-5',
  'ISO-8859-6',
  'ISO-8859-7',
  'ISO-8859-8',
  'ISO-8859-9',
  'ISO-8859-10',
  'ISO-8859-11',
  'ISO-8859-13',
  'ISO-8859-14',
  'ISO-8859-15',
  'ISO-8859-16',
  'Windows-1250',
  'Windows-1251',
  'Windows-1252',
  'Windows-1253',
  'Windows-1254',
  'Windows-1255',
  'Windows-1256',
  'Windows-1257',
  'Windows-1258',
  'KOI8-R',
  'KOI8-U',
  'GB2312',
  'GBK',
  'GB18030',
  'Big5',
  'Big5-HKSCS',
  'EUC-JP',
  'Shift_JIS',
  'ISO-2022-JP',
  'EUC-KR',
  'ISO-2022-KR',
  'EUC-TW',
  'TIS-620',
  'VISCII',
  'IBM437',
  'IBM850',
  'IBM852',
  'IBM855',
  'IBM857',
  'IBM860',
  'IBM861',
  'IBM862',
  'IBM863',
  'IBM864',
  'IBM865',
  'IBM866',
  'IBM869',
  'CP1006',
  'MacRoman',
  'MacCentralEuropean',
  'MacIceland',
  'MacCroatian',
  'MacTurkish',
  'MacGreek',
  'MacCyrillic',
  'MacUkrainian',
  'MacHebrew',
  'MacArabic',
  'MacThai',
  'MacJapanese',
  'MacChineseSimp',
  'MacChineseTrad',
  'MacKorean',
] as const;
export type CharacterSet = (typeof CharacterSets)[number] | string;

export interface TerminalFontConfig {
  family: string;
  size: number;
  weight: 'normal' | 'bold' | 'lighter' | 'bolder' | number;
  style: 'normal' | 'italic' | 'oblique';
  lineHeight: number;
  letterSpacing: number;
}

export interface BellOveruseProtection {
  enabled: boolean;
  maxBells: number;
  timeWindowSeconds: number;
  silenceDurationSeconds: number;
}

export interface TCPOptions {
  tcpNoDelay: boolean; // Disable Nagle algorithm
  tcpKeepAlive: boolean;
  soKeepAlive: boolean;
  ipProtocol: IPProtocol;
  keepAliveInterval: number; // seconds, if keepalive enabled
  keepAliveProbes: number; // number of probes before timeout
  connectionTimeout: number; // seconds
}

export interface SSHTerminalConfig {
  // Line handling
  implicitCrInLf: boolean;
  implicitLfInCr: boolean;
  autoWrap: boolean;

  // Line discipline
  localEcho: LocalEchoMode;
  localLineEditing: LineEditingMode;

  // Bell settings
  bellStyle: BellStyle;
  bellOveruseProtection: BellOveruseProtection;
  taskbarFlash: TaskbarFlashMode;

  // Keypad mode
  disableKeypadMode: boolean;
  disableApplicationCursorKeys: boolean;

  // Terminal dimensions
  useCustomDimensions: boolean;
  columns: number;
  rows: number;

  // Character set
  characterSet: CharacterSet;
  unicodeAmbiguousWidth: 'narrow' | 'wide';
  
  // Font configuration
  useCustomFont: boolean;
  font: TerminalFontConfig;

  // Color settings
  allowTerminalAnsiColors: boolean;
  allowXterm256Colors: boolean;
  allow24BitColors: boolean;
  customAnsiColors?: string[]; // 16 ANSI colors

  // Low-level TCP options
  tcpOptions: TCPOptions;

  // SSH protocol settings
  sshVersion: SSHVersion;
  enableCompression: boolean;
  compressionLevel: number; // 1-9

  // Additional SSH options
  preferredCiphers: string[];
  preferredMACs: string[];
  preferredKeyExchanges: string[];
  preferredHostKeyAlgorithms: string[];

  // Scrollback
  scrollbackLines: number;
  scrollOnOutput: boolean;
  scrollOnKeystroke: boolean;

  // Selection behavior
  copyOnSelect: boolean;
  pasteOnRightClick: boolean;
  wordSeparators: string;

  // Misc terminal behavior
  answerbackString: string;
  localPrinting: boolean;
  remoteControlledPrinting: boolean;
}

export const defaultSSHTerminalConfig: SSHTerminalConfig = {
  // Line handling
  implicitCrInLf: false,
  implicitLfInCr: false,
  autoWrap: true,

  // Line discipline
  localEcho: 'auto',
  localLineEditing: 'auto',

  // Bell settings
  bellStyle: 'system',
  bellOveruseProtection: {
    enabled: true,
    maxBells: 5,
    timeWindowSeconds: 2,
    silenceDurationSeconds: 5,
  },
  taskbarFlash: 'disabled',

  // Keypad mode
  disableKeypadMode: false,
  disableApplicationCursorKeys: false,

  // Terminal dimensions
  useCustomDimensions: false,
  columns: 80,
  rows: 24,

  // Character set
  characterSet: 'UTF-8',
  unicodeAmbiguousWidth: 'narrow',

  // Font configuration
  useCustomFont: false,
  font: {
    family: 'Consolas, Monaco, "Courier New", monospace',
    size: 14,
    weight: 'normal',
    style: 'normal',
    lineHeight: 1.2,
    letterSpacing: 0,
  },

  // Color settings
  allowTerminalAnsiColors: true,
  allowXterm256Colors: true,
  allow24BitColors: true,

  // Low-level TCP options (optimized for faster connections)
  tcpOptions: {
    tcpNoDelay: true, // Disable Nagle's algorithm for lower latency
    tcpKeepAlive: true,
    soKeepAlive: true,
    ipProtocol: 'auto',
    keepAliveInterval: 30, // Faster keepalive detection (was 60)
    keepAliveProbes: 2, // Fewer probes before disconnect (was 3)
    connectionTimeout: 15, // Faster timeout for unresponsive hosts (was 30)
  },

  // SSH protocol settings
  sshVersion: 'auto',
  enableCompression: false,
  compressionLevel: 6,

  // Additional SSH options (ordered by performance - fastest first)
  preferredCiphers: [
    'aes128-gcm@openssh.com', // Fastest with AES-NI hardware
    'aes256-gcm@openssh.com',
    'chacha20-poly1305@openssh.com', // Fast on systems without AES-NI
    'aes128-ctr', // Good balance of speed and security
    'aes256-ctr',
    'aes192-ctr',
  ],
  preferredMACs: [
    'umac-128-etm@openssh.com', // Fastest MAC
    'umac-64-etm@openssh.com',
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha2-256',
  ],
  preferredKeyExchanges: [
    'curve25519-sha256', // Fastest modern key exchange
    'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp256', // Faster than larger curves
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group14-sha256', // Fastest DH group
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group18-sha512',
  ],
  preferredHostKeyAlgorithms: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp521',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp256',
    'rsa-sha2-512',
    'rsa-sha2-256',
    'ssh-rsa',
  ],

  // Scrollback
  scrollbackLines: 10000,
  scrollOnOutput: false,
  scrollOnKeystroke: true,

  // Selection behavior
  copyOnSelect: false,
  pasteOnRightClick: true,
  wordSeparators: ' !"#$%&\'()*+,-./:;<=>?@[\\]^`{|}~',

  // Misc terminal behavior
  answerbackString: '',
  localPrinting: false,
  remoteControlledPrinting: false,
};

/**
 * SSH Connection Configuration - protocol-level settings for SSH connections.
 * These settings control the SSH transport layer, authentication, and tunneling.
 */
export interface SSHConnectionConfig {
  // Connection behavior
  connectTimeout: number; // seconds
  keepAliveInterval: number; // seconds, 0 to disable
  strictHostKeyChecking: boolean;
  knownHostsPath?: string;
  
  // Authentication preferences
  preferredAuthMethods: SSHAuthMethod[];
  tryPublicKeyFirst: boolean;
  tryAgentFirst: boolean;
  agentForwarding: boolean;
  
  // SSH protocol options
  sshVersion: SSHVersion;
  enableCompression: boolean;
  compressionLevel: number; // 1-9
  
  // Cipher and algorithm preferences
  preferredCiphers: string[];
  preferredMACs: string[];
  preferredKeyExchanges: string[];
  preferredHostKeyAlgorithms: string[];
  
  // TCP/IP settings
  tcpNoDelay: boolean;
  tcpKeepAlive: boolean;
  keepAliveProbes: number;
  ipProtocol: IPProtocol;
  
  // Port forwarding defaults
  enableX11Forwarding: boolean;
  x11DisplayOffset: number;
  enableTcpForwarding: boolean;
  
  // Jump host / ProxyCommand
  enableJumpHost: boolean;
  jumpHostConnectionId?: string;
  proxyCommand?: string;
  
  // Session settings
  requestPty: boolean;
  ptyType: string; // 'xterm', 'xterm-256color', 'vt100', etc.
  environment?: Record<string, string>;
  
  // SFTP/SCP settings
  sftpEnabled: boolean;
  scpEnabled: boolean;
  sftpStartPath?: string;
  
  // Security
  preferSSH2: boolean;
  revokedHostKeys: string[];
  
  // Banner handling
  showBanner: boolean;
  bannerTimeout: number; // seconds to wait for banner
}

export const SSHAuthMethods = ['password', 'publickey', 'keyboard-interactive', 'gssapi-with-mic', 'hostbased', 'none'] as const;
export type SSHAuthMethod = (typeof SSHAuthMethods)[number];

export const defaultSSHConnectionConfig: SSHConnectionConfig = {
  // Connection behavior
  connectTimeout: 30,
  keepAliveInterval: 60,
  strictHostKeyChecking: true,
  knownHostsPath: undefined,
  
  // Authentication preferences
  preferredAuthMethods: ['publickey', 'keyboard-interactive', 'password'],
  tryPublicKeyFirst: true,
  tryAgentFirst: true,
  agentForwarding: false,
  
  // SSH protocol options
  sshVersion: 'auto',
  enableCompression: false,
  compressionLevel: 6,
  
  // Cipher and algorithm preferences
  preferredCiphers: [],
  preferredMACs: [],
  preferredKeyExchanges: [],
  preferredHostKeyAlgorithms: [],
  
  // TCP/IP settings
  tcpNoDelay: true,
  tcpKeepAlive: true,
  keepAliveProbes: 3,
  ipProtocol: 'auto',
  
  // Port forwarding defaults
  enableX11Forwarding: false,
  x11DisplayOffset: 10,
  enableTcpForwarding: true,
  
  // Jump host / ProxyCommand
  enableJumpHost: false,
  jumpHostConnectionId: undefined,
  proxyCommand: undefined,
  
  // Session settings
  requestPty: true,
  ptyType: 'xterm-256color',
  environment: undefined,
  
  // SFTP/SCP settings
  sftpEnabled: true,
  scpEnabled: true,
  sftpStartPath: undefined,
  
  // Security
  preferSSH2: true,
  revokedHostKeys: [],
  
  // Banner handling
  showBanner: true,
  bannerTimeout: 10,
};

/**
 * Merges global SSH connection config with per-connection overrides.
 * Connection overrides take precedence over global settings.
 */
export function mergeSSHConnectionConfig(
  globalConfig: SSHConnectionConfig,
  override?: Partial<SSHConnectionConfig>
): SSHConnectionConfig {
  if (!override) return globalConfig;

  return {
    ...globalConfig,
    ...override,
    // Merge arrays by taking override if provided
    preferredAuthMethods: override.preferredAuthMethods ?? globalConfig.preferredAuthMethods,
    preferredCiphers: override.preferredCiphers ?? globalConfig.preferredCiphers,
    preferredMACs: override.preferredMACs ?? globalConfig.preferredMACs,
    preferredKeyExchanges: override.preferredKeyExchanges ?? globalConfig.preferredKeyExchanges,
    preferredHostKeyAlgorithms: override.preferredHostKeyAlgorithms ?? globalConfig.preferredHostKeyAlgorithms,
    revokedHostKeys: override.revokedHostKeys ?? globalConfig.revokedHostKeys,
    // Merge environment variables
    environment: {
      ...(globalConfig.environment || {}),
      ...(override.environment || {}),
    },
  };
}

/**
 * Merges global SSH terminal config with per-connection overrides.
 * Connection overrides take precedence over global settings.
 * Nested objects (font, tcpOptions, bellOveruseProtection) are deep-merged.
 */
export function mergeSSHTerminalConfig(
  globalConfig: SSHTerminalConfig,
  override?: Partial<SSHTerminalConfig>
): SSHTerminalConfig {
  if (!override) return globalConfig;

  return {
    ...globalConfig,
    ...override,
    // Deep merge nested objects
    font: {
      ...globalConfig.font,
      ...(override.font || {}),
    },
    tcpOptions: {
      ...globalConfig.tcpOptions,
      ...(override.tcpOptions || {}),
    },
    bellOveruseProtection: {
      ...globalConfig.bellOveruseProtection,
      ...(override.bellOveruseProtection || {}),
    },
  };
}
