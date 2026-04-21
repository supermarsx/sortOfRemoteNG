import type { ProxyConfig } from './index';

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
  type: 'proxy' | 'openvpn' | 'wireguard' | 'pptp' | 'l2tp' | 'ikev2' | 'ipsec' | 'sstp' | 'ssh-tunnel' | 'ssh-jump' | 'ssh-proxycmd';
  // Inline config (alternative to profile reference)
  inlineConfig?: ProxyConfig | OpenVPNConfig | WireGuardConfig | PPTPConfig | L2TPConfig | IKEv2Config | IPsecConfig | SSTPConfig | SSHJumpConfig;

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
  tunnelChains: SavedTunnelChain[];
  tunnelProfiles: SavedTunnelProfile[];
  version: number;
}

export const defaultProxyCollectionData: ProxyCollectionData = {
  profiles: [],
  chains: [],
  tunnelChains: [],
  tunnelProfiles: [],
  version: 1,
};

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

export interface IPsecConfig {
  enabled: boolean;
  server: string;
  authMethod?: "psk" | "certificate" | "eap";
  psk?: string;
  certificate?: string;
  privateKey?: string;
  caCertificate?: string;
  phase1Proposals?: string;
  phase2Proposals?: string;
  saLifetime?: number;
  dpdDelay?: number;
  dpdTimeout?: number;
  tunnelMode?: boolean;
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

// ── VPN Lifecycle Types ───────────────────────────────────────────

export interface EnsureVpnResult {
  wasAlreadyConnected: boolean;
  isNowConnected: boolean;
  vpnType: string;
  connectionId: string;
  error?: string;
}

export interface VpnStatusEvent {
  connectionId: string;
  vpnType: 'openvpn' | 'wireguard' | 'tailscale' | 'zerotier' | 'pptp' | 'l2tp' | 'ikev2' | 'ipsec' | 'sstp';
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  error?: string;
  localIp?: string;
  remoteIp?: string;
}

export interface SavedTunnelChain {
  id: string;
  name: string;
  description?: string;
  layers: import('../connection/connection').TunnelChainLayer[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface SavedTunnelProfile {
  id: string;
  name: string;
  description?: string;
  type: import('../connection/connection').TunnelType;
  config: import('../connection/connection').TunnelChainLayer;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}
