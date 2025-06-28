export interface GlobalSettings {
  // General Settings
  language: string;
  theme: 'dark' | 'light' | 'auto' | 'darkest' | 'oled';
  colorScheme: 'blue' | 'green' | 'purple' | 'red' | 'orange' | 'teal';
  singleWindowMode: boolean;
  singleConnectionMode: boolean;
  reconnectOnReload: boolean;
  warnOnClose: boolean;
  warnOnExit: boolean;
  
  // Auto Lock
  autoLock: AutoLockConfig;
  
  // Performance Settings
  maxConcurrentConnections: number;
  connectionTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  enablePerformanceTracking: boolean;
  
  // Security Settings
  encryptionAlgorithm: 'AES-256-GCM' | 'AES-256-CBC' | 'ChaCha20-Poly1305';
  blockCipherMode: 'GCM' | 'CBC' | 'CTR' | 'OFB' | 'CFB';
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
  
  // Tab Settings
  tabGrouping: 'none' | 'protocol' | 'status' | 'hostname' | 'colorTag';
  hostnameOverride: boolean;
  defaultTabLayout: 'tabs' | 'sideBySide' | 'mosaic' | 'miniMosaic';
  enableTabDetachment: boolean;
  enableTabResize: boolean;
  enableZoom: boolean;
  
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
  statusCheckMethod: 'ping' | 'socket' | 'http';
  
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
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxLogEntries: number;
  
  // Export Settings
  exportEncryption: boolean;
  exportPassword?: string;
}

export interface ProxyConfig {
  type: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  enabled: boolean;
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
  level: 'debug' | 'info' | 'warn' | 'error';
  action: string;
  connectionId?: string;
  connectionName?: string;
  details: string;
  duration?: number;
}

export interface CustomScript {
  id: string;
  name: string;
  type: 'javascript' | 'typescript';
  content: string;
  trigger: 'onConnect' | 'onDisconnect' | 'manual';
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
  customPorts: Record<string, number[]>;
}

export interface TOTPConfig {
  secret: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
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