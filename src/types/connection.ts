import { ProxyConfig, SSHTerminalConfig, SSHConnectionConfig } from "./settings";
import type { TrustPolicy } from "../utils/trustStore";
export interface Connection {
  id: string;
  name: string;
  protocol: 'rdp' | 'ssh' | 'vnc' | 'anydesk' | 'http' | 'https' | 'telnet' | 'rlogin' | 'mysql' | 'ftp' | 'sftp' | 'scp' | 'winrm' | 'rustdesk' | 'smb' | 'gcp' | 'azure' | 'ibm-csp' | 'digital-ocean' | 'heroku' | 'scaleway' | 'linode' | 'ovhcloud';
  hostname: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  description?: string;
  parentId?: string;
  isGroup: boolean;
  expanded?: boolean;
  lastConnected?: Date;
  connectionCount?: number;
  icon?: string;
  tags?: string[];
  colorTag?: string; // Color classification
  favorite?: boolean;
  order?: number;
  createdAt: Date;
  updatedAt: Date;
  
  // Advanced Connection Settings
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  warnOnClose?: boolean;
  hostnameOverride?: boolean;
  
  // Authentication
  authType?: 'password' | 'key' | 'totp' | 'basic' | 'header';
  privateKey?: string;
  passphrase?: string;
  totpSecret?: string;
  ignoreSshSecurityErrors?: boolean;
  sshConnectTimeout?: number;
  sshKeepAliveInterval?: number;
  sshKnownHostsPath?: string;
  httpHeaders?: Record<string, string>;
  basicAuthRealm?: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  httpVerifySsl?: boolean;
  
  // Database specific
  database?: string;
  
  // File transfer specific
  localPath?: string;
  remotePath?: string;
  
  // Wake on LAN
  macAddress?: string;
  wolPort?: number;
  
  // RustDesk specific
  rustdeskId?: string;
  rustdeskPassword?: string;
  
  // SMB specific
  shareName?: string;
  workgroup?: string;
  
  // Cloud Provider specific
  cloudProvider?: {
    provider: 'gcp' | 'azure' | 'ibm-csp' | 'digital-ocean' | 'heroku' | 'scaleway' | 'linode' | 'ovhcloud';
    projectId?: string; // GCP, Azure resource group
    subscriptionId?: string; // Azure
    region?: string;
    zone?: string; // GCP
    resourceGroup?: string; // Azure
    instanceId?: string;
    instanceName?: string;
    apiKey?: string;
    accessToken?: string;
    clientId?: string; // Azure
    clientSecret?: string; // Azure
    tenantId?: string; // Azure
    serviceAccountKey?: string; // GCP
    vpcId?: string; // AWS, but can be used for others
    subnetId?: string;
    securityGroup?: string;
    appName?: string; // Heroku
    dynoName?: string; // Heroku
    organizationId?: string; // Scaleway
    projectName?: string; // Scaleway, OVH
    serviceId?: string; // OVH
  };
  
  // Status Checking
  statusCheck?: {
    enabled: boolean;
    method: 'ping' | 'socket' | 'http';
    interval: number;
    timeout: number;
  };
  
  // Performance Monitoring
  performanceMonitoring?: {
    enabled: boolean;
    pingInterval: number;
    trackLatency: boolean;
    trackThroughput: boolean;
    alertThresholds: {
      latency: number;
      packetLoss: number;
    };
  };
  
  // Security Settings
  security?: {
    encryptionAlgorithm?: string;
    blockCipherMode?: string;
    keyDerivationIterations?: number;
    // Legacy single proxy (deprecated, use tunnelChain instead)
    proxy?: ProxyConfig;
    // Legacy single OpenVPN (deprecated, use tunnelChain instead)
    openvpn?: {
      enabled: boolean;
      configId?: string;
      chainPosition?: number;
    };
    // Legacy single SSH tunnel (deprecated, use tunnelChain instead)
    sshTunnel?: {
      enabled: boolean;
      connectionId: string;
      localPort: number;
      remoteHost: string;
      remotePort: number;
    };
    // Chained tunnels/proxies - executed in order (first = outermost)
    tunnelChain?: TunnelChainLayer[];
  };
  
  // Custom Scripts
  scripts?: {
    onConnect?: string[];
    onDisconnect?: string[];
  };

  // Proxy/VPN chaining
  proxyChainId?: string;
  connectionChainId?: string;

  // SSH Terminal Config Override (inherits from global settings)
  sshTerminalConfigOverride?: Partial<SSHTerminalConfig>;
  
  // SSH Connection Config Override (protocol-level settings)
  sshConnectionConfigOverride?: Partial<SSHConnectionConfig>;

  // Trust & Verification (per-connection override — falls back to global)
  /** TLS certificate trust policy override */
  tlsTrustPolicy?: TrustPolicy;
  /** SSH host key trust policy override */
  sshTrustPolicy?: TrustPolicy;
}

/**
 * Types of tunnel/proxy layers that can be chained
 */
export type TunnelType = 
  | 'proxy'           // HTTP/HTTPS/SOCKS proxy
  | 'ssh-tunnel'      // SSH port forwarding
  | 'ssh-jump'        // SSH jump host (ProxyJump - modern method)
  | 'ssh-proxycmd'    // SSH ProxyCommand (nc/ncat/socat style)
  | 'ssh-stdio'       // SSH ProxyUseFdpass/stdio forwarding
  | 'openvpn'         // OpenVPN tunnel
  | 'wireguard'       // WireGuard tunnel
  | 'shadowsocks'     // Shadowsocks proxy
  | 'tor'             // Tor network
  | 'i2p'             // I2P network
  | 'stunnel'         // SSL/TLS tunnel
  | 'chisel'          // Chisel HTTP tunnel
  | 'ngrok'           // ngrok tunnel
  | 'cloudflared'     // Cloudflare tunnel
  | 'tailscale'       // Tailscale mesh
  | 'zerotier';       // ZeroTier network

/**
 * SSH chaining method - how this node connects through the chain
 */
export type SSHChainingMethod = 
  | 'proxyjump'       // Modern -J / ProxyJump (recommended)
  | 'proxycommand'    // Classic ProxyCommand with nc/ncat/socat
  | 'nested-ssh'      // Nested SSH commands (ssh -t host1 ssh host2)
  | 'local-forward'   // Local port forwarding (-L)
  | 'dynamic-socks'   // Dynamic SOCKS proxy (-D)
  | 'stdio'           // stdio forwarding via ProxyUseFdpass
  | 'agent-forward';  // SSH agent forwarding (-A)

/**
 * Dynamic chaining strategy for the entire chain
 */
export type DynamicChainingStrategy =
  | 'strict'          // All hops must succeed in order
  | 'dynamic'         // Try hops dynamically, skip failed ones
  | 'random'          // Randomize hop order (for anonymity)
  | 'round-robin'     // Rotate through available paths
  | 'failover'        // Use backup path on failure
  | 'load-balance';   // Distribute across multiple paths

/**
 * Configuration for dynamic/mixed chaining at the chain level
 */
export interface ChainDynamicsConfig {
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
}

/**
 * A single layer in a tunnel chain.
 * Layers are processed in order - first layer is the outermost (connects first).
 */
export interface TunnelChainLayer {
  id: string;
  type: TunnelType;
  enabled: boolean;
  name?: string;          // Descriptive name for this layer
  
  // Common settings
  localBindHost?: string; // Local address to bind (default: 127.0.0.1)
  localBindPort?: number; // Local port to bind (0 = auto-assign)
  
  // Per-node chaining method selection (for SSH-based layers)
  sshChainingMethod?: SSHChainingMethod;
  
  // Per-node chain dynamics override
  nodeChainConfig?: {
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
  
  // Proxy settings (type: 'proxy' | 'shadowsocks')
  proxy?: {
    proxyType: 'http' | 'https' | 'socks4' | 'socks5' | 'http-connect';
    host: string;
    port: number;
    username?: string;
    password?: string;
    // Shadowsocks-specific
    method?: string;      // Encryption method
    plugin?: string;      // Plugin name
    pluginOpts?: string;  // Plugin options
  };
  
  // SSH tunnel settings (type: 'ssh-tunnel' | 'ssh-jump' | 'ssh-proxycmd' | 'ssh-stdio')
  sshTunnel?: {
    // Reference to an existing SSH connection, or inline config
    connectionId?: string;
    // Inline SSH config (used if connectionId not set)
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    // Forwarding config
    forwardType: 'local' | 'remote' | 'dynamic';
    remoteHost?: string;  // Target host (from SSH server's perspective)
    remotePort?: number;  // Target port
    // Jump host specific (ProxyJump -J)
    jumpTargetHost?: string;
    jumpTargetPort?: number;
    // Multiple jump hosts in sequence (host1,host2,host3)
    jumpHosts?: Array<{
      host: string;
      port?: number;
      username?: string;
      connectionId?: string;
    }>;
    // ProxyCommand configuration (old-school chaining)
    proxyCommand?: {
      // Full command template (%h = host, %p = port, %r = user)
      command?: string;
      // Or use built-in templates
      template?: 'nc' | 'ncat' | 'socat' | 'connect' | 'corkscrew' | 'custom';
      // Proxy host for templates
      proxyHost?: string;
      proxyPort?: number;
      proxyUsername?: string;
      proxyPassword?: string;
      proxyType?: 'http' | 'socks4' | 'socks5';
    };
    // Nested SSH command (ssh -t host1 ssh host2)
    nestedSsh?: {
      intermediateHosts: Array<{
        host: string;
        port?: number;
        username?: string;
        connectionId?: string;
        // Whether to allocate TTY (-t)
        allocateTty?: boolean;
      }>;
    };
    // Agent forwarding
    agentForwarding?: boolean;
    // Compression
    compression?: boolean;
    // Keep-alive
    serverAliveInterval?: number;
    serverAliveCountMax?: number;
    // Strict host key checking
    strictHostKeyChecking?: 'yes' | 'no' | 'ask' | 'accept-new';
  };
  
  // VPN settings (type: 'openvpn' | 'wireguard')
  vpn?: {
    configId?: string;    // Reference to saved VPN config
    configFile?: string;  // Path to config file
    // Inline config options
    serverHost?: string;
    serverPort?: number;
    protocol?: 'udp' | 'tcp';
    // WireGuard-specific
    privateKey?: string;
    publicKey?: string;
    presharedKey?: string;
    allowedIPs?: string[];
    endpoint?: string;
    persistentKeepalive?: number;
  };
  
  // Generic tunnel settings (tor, i2p, stunnel, chisel, ngrok, cloudflared)
  tunnel?: {
    configPath?: string;
    serverUrl?: string;
    authToken?: string;
    subdomain?: string;
    region?: string;
    extraArgs?: string[];
  };
  
  // Mesh network settings (type: 'tailscale' | 'zerotier')
  mesh?: {
    networkId?: string;
    authKey?: string;
    targetNodeId?: string;
    targetIP?: string;
    targetPort?: number;
  };
  
  // Runtime state (not persisted)
  status?: 'disconnected' | 'connecting' | 'connected' | 'error';
  actualLocalPort?: number; // Actual bound port if auto-assigned
  error?: string;
}

/**
 * Helper to create a simple SSH tunnel chain layer
 */
export function createSSHTunnelLayer(
  connectionId: string,
  remoteHost: string,
  remotePort: number,
  localPort?: number
): TunnelChainLayer {
  return {
    id: crypto.randomUUID(),
    type: 'ssh-tunnel',
    enabled: true,
    localBindPort: localPort,
    sshTunnel: {
      connectionId,
      forwardType: 'local',
      remoteHost,
      remotePort,
    },
  };
}

/**
 * Helper to create a proxy chain layer
 */
export function createProxyLayer(
  proxyType: 'http' | 'https' | 'socks4' | 'socks5',
  host: string,
  port: number,
  username?: string,
  password?: string
): TunnelChainLayer {
  return {
    id: crypto.randomUUID(),
    type: 'proxy',
    enabled: true,
    proxy: {
      proxyType,
      host,
      port,
      username,
      password,
    },
  };
}

/**
 * Helper to create an SSH jump host layer
 */
export function createSSHJumpLayer(
  connectionId: string,
  targetHost: string,
  targetPort: number
): TunnelChainLayer {
  return {
    id: crypto.randomUUID(),
    type: 'ssh-jump',
    enabled: true,
    sshTunnel: {
      connectionId,
      forwardType: 'local',
      jumpTargetHost: targetHost,
      jumpTargetPort: targetPort,
    },
  };
}

export interface ConnectionSession {
  id: string;
  connectionId: string;
  name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';
  startTime: Date;
  lastActivity?: Date;
  protocol: string;
  hostname: string;
  
  // Tab Layout
  layout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    isDetached: boolean;
    windowId?: string;
  };

  // Backend session handles
  backendSessionId?: string;
  shellId?: string;
  
  // Zoom level
  zoomLevel?: number;
  
  // Terminal buffer for detach/reattach preservation
  terminalBuffer?: string;
  
  // Performance Metrics
  metrics?: {
    connectionTime: number;
    dataTransferred: number;
    latency: number;
    throughput: number;
    packetLoss?: number;
    jitter?: number;
  };
  
  // Tab Grouping
  group?: string;
  
  // Reconnection
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
}

export interface TabLayout {
  mode:
    | 'tabs'
    | 'sideBySide'
    | 'mosaic'
    | 'miniMosaic'
    | 'splitVertical'
    | 'splitHorizontal'
    | 'grid2'
    | 'grid4'
    | 'grid6';
  sessions: {
    sessionId: string;
    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[];
}


export interface ConnectionFilter {
  searchTerm: string;
  protocols: string[];
  tags: string[];
  colorTags: string[];
  showRecent: boolean;
  showFavorites: boolean;
  status?: 'online' | 'offline' | 'unknown';
  groupBy?: 'none' | 'protocol' | 'status' | 'hostname' | 'colorTag';
  sortBy?: 'name' | 'protocol' | 'hostname' | 'createdAt' | 'updatedAt' | 'recentlyUsed' | 'custom';
  sortDirection?: 'asc' | 'desc';
}

export interface StorageSettings {
  isEncrypted: boolean;
  hasPassword: boolean;
}

export interface ConnectionStatus {
  connectionId: string;
  status: 'online' | 'offline' | 'checking' | 'unknown' | 'timeout' | 'error';
  lastChecked: Date;
  responseTime?: number;
  error?: string;
}


export interface DiscoveredHost {
  ip: string;
  hostname?: string;
  openPorts: number[];
  services: DiscoveredService[];
  responseTime: number;
  macAddress?: string;
}

export interface DiscoveredService {
  port: number;
  protocol: string;
  service: string;
  version?: string;
  banner?: string;
}

export interface FileTransferSession {
  id: string;
  connectionId: string;
  type: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  progress: number;
  status: 'pending' | 'active' | 'completed' | 'error' | 'cancelled';
  error?: string;
  startTime: Date;
  endTime?: Date;
  totalSize: number;
  transferredSize: number;
}

export interface ConnectionCollection {
  id: string;
  name: string;
  description?: string;
  isEncrypted: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastAccessed: Date;
}

