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
  showShortcutManagerIcon: boolean;
  showWolIcon: boolean;
  showBulkSSHIcon: boolean;
  showScriptManagerIcon: boolean;
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
  encryptionAlgorithm: "AES-256-GCM" | "AES-256-CBC" | "ChaCha20-Poly1305" | "AES-256-GCM-SIV" | "Salsa20" | "XSalsa20-Poly1305" | "Threefish-256" | "Threefish-512" | "Threefish-1024";
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

  // Low-level TCP options
  tcpOptions: {
    tcpNoDelay: true,
    tcpKeepAlive: true,
    soKeepAlive: true,
    ipProtocol: 'auto',
    keepAliveInterval: 60,
    keepAliveProbes: 3,
    connectionTimeout: 30,
  },

  // SSH protocol settings
  sshVersion: 'auto',
  enableCompression: false,
  compressionLevel: 6,

  // Additional SSH options
  preferredCiphers: [
    'chacha20-poly1305@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-gcm@openssh.com',
    'aes256-ctr',
    'aes192-ctr',
    'aes128-ctr',
  ],
  preferredMACs: [
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha2-256-etm@openssh.com',
    'umac-128-etm@openssh.com',
    'hmac-sha2-512',
    'hmac-sha2-256',
  ],
  preferredKeyExchanges: [
    'curve25519-sha256',
    'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp521',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp256',
    'diffie-hellman-group18-sha512',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group14-sha256',
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
