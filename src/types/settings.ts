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
  "blue",
  "green",
  "purple",
  "red",
  "orange",
  "teal",
  "grey",
  "other",
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

  // Theme Effects
  backgroundGlowEnabled: boolean;
  backgroundGlowColor: string;
  backgroundGlowOpacity: number;
  backgroundGlowRadius: number;
  backgroundGlowBlur: number;

  // Window Effects
  windowTransparencyEnabled: boolean;
  windowTransparencyOpacity: number;

  // Secondary Bar Toggles
  showQuickConnectIcon: boolean;
  showCollectionSwitcherIcon: boolean;
  showImportExportIcon: boolean;
  showSettingsIcon: boolean;
  showPerformanceMonitorIcon: boolean;
  showActionLogIcon: boolean;
  showDevtoolsIcon: boolean;
  showSecurityIcon: boolean;
  showLanguageSelectorIcon: boolean;
  showProxyMenuIcon: boolean;
  showShortcutManagerIcon: boolean;

  // Auto Lock
  autoLock: AutoLockConfig;

  // Performance Settings
  maxConcurrentConnections: number;
  connectionTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  enablePerformanceTracking: boolean;
  performancePollIntervalMs: number;

  // Security Settings
  encryptionAlgorithm: "AES-256-GCM" | "AES-256-CBC" | "ChaCha20-Poly1305";
  blockCipherMode: "GCM" | "CBC" | "CTR" | "OFB" | "CFB";
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

  // Network Discovery
  networkDiscovery: NetworkDiscoveryConfig;

  // REST API
  restApi: {
    enabled: boolean;
    port: number;
    authentication: boolean;
    apiKey?: string;
    corsEnabled: boolean;
    rateLimiting: boolean;
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
