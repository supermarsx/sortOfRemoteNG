import { ProxyConfig, SSHTerminalConfig, SSHConnectionConfig, TOTPConfig } from "./settings";
import type { TrustPolicy } from "../utils/trustStore";

/** A single bookmark or a folder containing bookmarks. */
export type HttpBookmarkItem =
  | { name: string; path: string; isFolder?: false }
  | { name: string; isFolder: true; children: HttpBookmarkItem[] };

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
  totpConfigs?: TOTPConfig[];  // Multiple TOTP configs per connection

  // Security Questions & Recovery Info
  securityQuestions?: SecurityQuestion[];
  recoveryInfo?: RecoveryInfo;

  ignoreSshSecurityErrors?: boolean;
  sshConnectTimeout?: number;
  sshKeepAliveInterval?: number;
  sshKnownHostsPath?: string;
  httpHeaders?: Record<string, string>;
  basicAuthRealm?: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  httpVerifySsl?: boolean;
  httpBookmarks?: HttpBookmarkItem[];
  
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

  // Recording Config Override (per-connection)
  recordingConfigOverride?: Partial<import('../types/settings').RecordingConfig>;

  /** Disable SSH terminal recording for this connection */
  disableSshRecording?: boolean;
  /** Disable RDP screen recording for this connection */
  disableRdpRecording?: boolean;
  /** Disable web HAR/video recording for this connection */
  disableWebRecording?: boolean;

  // SSH Connection Config Override (protocol-level settings)
  sshConnectionConfigOverride?: Partial<SSHConnectionConfig>;

  // Trust & Verification (per-connection override — falls back to global)
  /** TLS certificate trust policy override */
  tlsTrustPolicy?: TrustPolicy;
  /** SSH host key trust policy override */
  sshTrustPolicy?: TrustPolicy;
  /** RDP server certificate trust policy override */
  rdpTrustPolicy?: TrustPolicy;

  // RDP Connection Settings
  rdpSettings?: RDPConnectionSettings;
}

/**
 * Comprehensive RDP connection settings covering display, audio, input,
 * device redirection, performance, and security/fingerprint options.
 */
export interface RDPConnectionSettings {
  // ─── Display ──────────────────────────────────────────────────────
  display?: RdpDisplaySettings;
  // ─── Audio ────────────────────────────────────────────────────────
  audio?: RdpAudioSettings;
  // ─── Input ────────────────────────────────────────────────────────
  input?: RdpInputSettings;
  // ─── Local Device Redirection ─────────────────────────────────────
  deviceRedirection?: RdpDeviceRedirection;
  // ─── Performance ──────────────────────────────────────────────────
  performance?: RdpPerformanceSettings;
  // ─── Security ─────────────────────────────────────────────────────
  security?: RdpSecuritySettings;
  // ─── Gateway ──────────────────────────────────────────────────────
  gateway?: RdpGatewaySettings;
  // ─── Hyper-V / Enhanced Session ───────────────────────────────────
  hyperv?: RdpHyperVSettings;
  // ─── Connection Negotiation ───────────────────────────────────────
  negotiation?: RdpNegotiationSettings;
  // ─── Advanced / Internals ─────────────────────────────────────────
  advanced?: RdpAdvancedSettings;
  // ─── TCP / Socket ─────────────────────────────────────────────────
  tcp?: RdpTcpSettings;
}

export interface RdpDisplaySettings {
  /** Initial resolution width (0 = match window) */
  width?: number;
  /** Initial resolution height (0 = match window) */
  height?: number;
  /** Dynamically resize to match the window dimensions */
  resizeToWindow?: boolean;
  /** Color depth: 16, 24, or 32 */
  colorDepth?: 16 | 24 | 32;
  /** Desktop scale factor (100-500) */
  desktopScaleFactor?: number;
  /** Enable lossy bitmap compression (reduces bandwidth) */
  lossyCompression?: boolean;
  /** Enable magnifier glass overlay tool */
  magnifierEnabled?: boolean;
  /** Magnifier zoom level (2-8x) */
  magnifierZoom?: number;
  /** Smart sizing: scale the remote desktop to fit the client window */
  smartSizing?: boolean;
}

export type RdpAudioPlaybackMode = 'local' | 'remote' | 'disabled';
export type RdpAudioRecordingMode = 'enabled' | 'disabled';
export type RdpAudioQuality = 'dynamic' | 'medium' | 'high';

export interface RdpAudioSettings {
  /** Where to play remote audio: on the local machine, remote, or disable */
  playbackMode?: RdpAudioPlaybackMode;
  /** Audio recording / microphone redirection */
  recordingMode?: RdpAudioRecordingMode;
  /** Audio quality hint */
  audioQuality?: RdpAudioQuality;
}

export type RdpMouseMode = 'relative' | 'absolute';
export type RdpKeyboardLayout = number; // LCID e.g. 0x0409 for US English

export interface RdpInputSettings {
  /** Mouse input mode: relative (virtual) or absolute (real) */
  mouseMode?: RdpMouseMode;
  /** Keyboard layout LCID (e.g., 0x0409 = US, 0x0407 = German) */
  keyboardLayout?: RdpKeyboardLayout;
  /** Keyboard type */
  keyboardType?:
    | 'ibm-pc-xt'
    | 'olivetti'
    | 'ibm-pc-at'
    | 'ibm-enhanced'
    | 'nokia1050'
    | 'nokia9140'
    | 'japanese';
  /** Number of function keys (typically 12) */
  keyboardFunctionKeys?: number;
  /** IME filename for Asian input methods */
  imeFileName?: string;
  /** Enable Unicode keyboard events (for characters without scancodes) */
  enableUnicodeInput?: boolean;
  /** Auto-detect keyboard layout from the OS at connection time */
  autoDetectLayout?: boolean;
  /** Input event priority: 'realtime' sends immediately, 'batched' groups events */
  inputPriority?: 'realtime' | 'batched';
  /** Batch interval in ms when inputPriority is 'batched' */
  batchIntervalMs?: number;
}

export interface RdpDeviceRedirection {
  /** Clipboard redirection */
  clipboard?: boolean;
  /** Drive/folder redirection (list of local paths to share) */
  drives?: RdpDriveRedirection[];
  /** Printer redirection */
  printers?: boolean;
  /** Serial/COM port redirection */
  ports?: boolean;
  /** Smart card redirection */
  smartCards?: boolean;
  /** WebAuthn / FIDO device redirection */
  webAuthn?: boolean;
  /** Video capture device (camera) redirection */
  videoCapture?: boolean;
  /** USB device redirection */
  usbDevices?: boolean;
  /** Audio input (microphone) device redirection */
  audioInput?: boolean;
}

export interface RdpDriveRedirection {
  name: string;
  path: string;
  readOnly?: boolean;
}

export interface RdpPerformanceSettings {
  // ─── Visual Experience ────────────────────────────────────────────
  /** Disable desktop wallpaper (saves bandwidth) */
  disableWallpaper?: boolean;
  /** Disable full-window drag (show contents during drag) */
  disableFullWindowDrag?: boolean;
  /** Disable menu/window animations */
  disableMenuAnimations?: boolean;
  /** Disable visual themes */
  disableTheming?: boolean;
  /** Disable cursor shadow */
  disableCursorShadow?: boolean;
  /** Disable cursor blinking/settings */
  disableCursorSettings?: boolean;
  /** Enable ClearType font smoothing */
  enableFontSmoothing?: boolean;
  /** Enable desktop composition (Aero) */
  enableDesktopComposition?: boolean;

  // ─── Bitmap Caching ───────────────────────────────────────────────
  /** Enable persistent bitmap caching (disk cache) */
  persistentBitmapCaching?: boolean;
  
  // ─── Network ──────────────────────────────────────────────────────
  /** Connection speed preset: determines which optimizations to enable */
  connectionSpeed?: 'modem' | 'broadband-low' | 'broadband-high' | 'wan' | 'lan' | 'auto-detect';
  
  // ─── Frame Delivery ───────────────────────────────────────────────
  /** Target frame rate limit (0 = unlimited) */
  targetFps?: number;
  /** Frame batching: accumulate dirty regions and emit combined updates */
  frameBatching?: boolean;
  /** Frame batch interval in ms (16 = ~60fps, 33 = ~30fps) */
  frameBatchIntervalMs?: number;

  // ─── Bitmap Codec Negotiation ─────────────────────────────────────
  /** Codec negotiation settings */
  codecs?: RdpCodecSettings;

  // ─── Server-side Compositor (Rust backend) ────────────────────────
  /**
   * Which server-side compositor to use for frame accumulation.
   * - `webview` — no compositor, stream each dirty region directly
   * - `softbuffer` — CPU shadow buffer, batch dirty regions
   * - `wgpu` — GPU compositor (CPU fallback currently)
   * - `auto` — try wgpu → softbuffer → webview
   */
  renderBackend?: 'auto' | 'softbuffer' | 'wgpu' | 'webview';

  // ─── Client-side Renderer (JS frontend) ───────────────────────────
  /**
   * Which frontend canvas renderer to paint received frames.
   * - `auto` — best available (WebGPU → WebGL → Canvas 2D)
   * - `canvas2d` — Canvas 2D putImageData (baseline, always works)
   * - `webgl` — WebGL texSubImage2D (GPU texture upload)
   * - `webgpu` — WebGPU writeTexture (latest GPU API)
   * - `offscreen-worker` — OffscreenCanvas in a Worker (off-main-thread)
   */
  frontendRenderer?: 'auto' | 'canvas2d' | 'webgl' | 'webgpu' | 'offscreen-worker';
}

// ─── Bitmap Codec Negotiation ──────────────────────────────────────

/** Available RDP bitmap codec identifiers */
export const RdpBitmapCodecs = [
  'remotefx',    // Microsoft RemoteFX (RFX) — DWT + RLGR entropy coding
  'nscodec',     // NSCodec — simple wavelet compression
] as const;
export type RdpBitmapCodec = (typeof RdpBitmapCodecs)[number];

export interface RdpCodecSettings {
  /** Enable bitmap codec negotiation (when false, only raw/RLE bitmaps are used) */
  enableCodecs?: boolean;
  /** Enable RemoteFX (RFX) codec — best quality + compression ratio */
  remoteFx?: boolean;
  /** RemoteFX entropy algorithm: RLGR1 (faster) or RLGR3 (better compression) */
  remoteFxEntropy?: 'rlgr1' | 'rlgr3';
  /** Enable RDPGFX Dynamic Virtual Channel for H.264 hardware-accelerated decode */
  enableGfx?: boolean;
  /** H.264 decoder preference: auto tries MF hardware first, then openh264 software */
  h264Decoder?: 'auto' | 'media-foundation' | 'openh264';
}

// ─── CredSSP Oracle Remediation Policy ─────────────────────────────
/** Maps to Windows Group Policy "Encryption Oracle Remediation" */
export const CredsspOracleRemediationPolicies = [
  'force-updated',
  'mitigated',
  'vulnerable',
] as const;
export type CredsspOracleRemediationPolicy =
  (typeof CredsspOracleRemediationPolicies)[number];

/** NLA negotiation enforcement level */
export const NlaModes = ['required', 'preferred', 'disabled'] as const;
export type NlaMode = (typeof NlaModes)[number];

/** Minimum TLS version */
export const TlsVersions = ['1.0', '1.1', '1.2', '1.3'] as const;
export type TlsVersion = (typeof TlsVersions)[number];

/** CredSSP TSRequest version to advertise */
export const CredsspVersions = [2, 3, 6] as const;
export type CredsspVersion = (typeof CredsspVersions)[number];

export interface RdpSecuritySettings {
  /** Enable TLS security protocol (legacy graphical logon) */
  enableTls?: boolean;
  /** Enable NLA / CredSSP (recommended) */
  enableNla?: boolean;
  /** Master toggle: use CredSSP at all (when false, disables CredSSP entirely) */
  useCredSsp?: boolean;
  /** Auto logon (send credentials in INFO packet) */
  autoLogon?: boolean;
  /** Enable server-side pointer (cursor managed by server) */
  enableServerPointer?: boolean;
  /** Use software rendering for server pointers */
  pointerSoftwareRendering?: boolean;

  // ─── CredSSP Remediation Configuration ──────────────────────────

  /** Encryption Oracle Remediation policy (CVE-2018-0886).
   *  - force-updated: Requires both client and server to be patched
   *  - mitigated: Blocks connections to vulnerable servers (default)
   *  - vulnerable: Allows all connections regardless of patch status */
  credsspOracleRemediation?: CredsspOracleRemediationPolicy;

  /** Allow HYBRID_EX protocol negotiation (Early User Auth Result).
   *  When disabled, only HYBRID is requested. Some servers break with HYBRID_EX. */
  allowHybridEx?: boolean;

  /** Allow automatic fallback from NLA/CredSSP to TLS when NLA fails */
  nlaFallbackToTls?: boolean;

  /** Minimum TLS version for the connection */
  tlsMinVersion?: TlsVersion;

  /** Enable NTLM authentication in CredSSP SSPI negotiation */
  ntlmEnabled?: boolean;

  /** Enable Kerberos authentication in CredSSP SSPI negotiation */
  kerberosEnabled?: boolean;

  /** Enable PKU2U authentication in CredSSP SSPI negotiation */
  pku2uEnabled?: boolean;

  /** Enable Restricted Admin mode (credentials are not sent to the server) */
  restrictedAdmin?: boolean;

  /** Enable Remote Credential Guard (credentials proxied via Kerberos) */
  remoteCredentialGuard?: boolean;

  /** Require server public key validation during CredSSP nonce binding */
  enforceServerPublicKeyValidation?: boolean;

  /** CredSSP TSRequest version to advertise (2, 3, or 6) */
  credsspVersion?: CredsspVersion;

  /** Custom SSPI package list override (e.g. "!kerberos,!pku2u") */
  sspiPackageList?: string;

  /** Server certificate validation mode for the RDP TLS handshake */
  serverCertValidation?: 'validate' | 'warn' | 'ignore';
}

// ─── RDP Gateway ────────────────────────────────────────────────────

/** Gateway authentication methods */
export const GatewayAuthMethods = ['ntlm', 'basic', 'digest', 'negotiate', 'smartcard'] as const;
export type GatewayAuthMethod = (typeof GatewayAuthMethods)[number];

/** Gateway credential sources */
export const GatewayCredentialSources = ['same-as-connection', 'separate', 'ask'] as const;
export type GatewayCredentialSource = (typeof GatewayCredentialSources)[number];

/** Gateway transport modes */
export const GatewayTransportModes = ['auto', 'http', 'udp'] as const;
export type GatewayTransportMode = (typeof GatewayTransportModes)[number];

export interface RdpGatewaySettings {
  /** Enable RDP Gateway tunnelling */
  enabled?: boolean;
  /** Gateway server hostname or IP */
  hostname?: string;
  /** Gateway server port (default 443) */
  port?: number;
  /** Authentication method for the gateway */
  authMethod?: GatewayAuthMethod;
  /** Where to get credentials for the gateway */
  credentialSource?: GatewayCredentialSource;
  /** Separate gateway username (when credentialSource is 'separate') */
  username?: string;
  /** Separate gateway password (when credentialSource is 'separate') */
  password?: string;
  /** Separate gateway domain (when credentialSource is 'separate') */
  domain?: string;
  /** Bypass gateway for local addresses */
  bypassForLocal?: boolean;
  /** Transport mode: HTTP, UDP, or auto */
  transportMode?: GatewayTransportMode;
  /** Access token for token-based gateway auth (e.g. Azure AD) */
  accessToken?: string;
}

// ─── Hyper-V / Enhanced Session ─────────────────────────────────────

export interface RdpHyperVSettings {
  /** Connect to a Hyper-V VM by ID instead of hostname */
  useVmId?: boolean;
  /** The Hyper-V VM GUID (e.g. "12345678-abcd-...") */
  vmId?: string;
  /** Enable Hyper-V Enhanced Session Mode (VMBus channel) */
  enhancedSessionMode?: boolean;
  /** Hyper-V host server address (required when using VM ID) */
  hostServer?: string;
}

// ─── Connection Negotiation & Auto-detect ───────────────────────────

/** Negotiation strategies for auto-detect */
export const NegotiationStrategies = [
  'auto',            // Try all combos automatically
  'nla-first',       // NLA/CredSSP → TLS → plain
  'tls-first',       // TLS → NLA/CredSSP → plain
  'nla-only',        // Only NLA/CredSSP, fail if unavailable
  'tls-only',        // Only TLS, no CredSSP
  'plain-only',      // No TLS, no CredSSP (extremely insecure)
] as const;
export type NegotiationStrategy = (typeof NegotiationStrategies)[number];

export interface RdpNegotiationSettings {
  /** Enable auto-detect: automatically try different negotiation strategies */
  autoDetect?: boolean;
  /** Negotiation strategy / order of protocols to attempt */
  strategy?: NegotiationStrategy;
  /** Maximum number of retry attempts during auto-detect */
  maxRetries?: number;
  /** Delay between retry attempts in ms */
  retryDelayMs?: number;
  /** Load balancing info string (RDP routing token / cookie sent during X.224) */
  loadBalancingInfo?: string;
  /** Use routing token format for load balancing (vs. cookie format) */
  useRoutingToken?: boolean;
}

export interface RdpAdvancedSettings {
  /** Client name reported to server (max 15 chars) */
  clientName?: string;
  /** Client build number */
  clientBuild?: number;
  /** Read timeout in ms for the PDU read loop (affects responsiveness vs CPU) */
  readTimeoutMs?: number;
  /** Full-frame sync interval (emit complete framebuffer every N frames) */
  fullFrameSyncInterval?: number;
  /** Maximum consecutive PDU errors before disconnecting */
  maxConsecutiveErrors?: number;
  /** Stats emission interval in seconds */
  statsIntervalSecs?: number;
}

export interface RdpTcpSettings {
  /** TCP connect timeout in seconds */
  connectTimeoutSecs?: number;
  /** Enable TCP_NODELAY (Nagle's algorithm disabled) */
  nodelay?: boolean;
  /** Enable TCP keep-alive */
  keepAlive?: boolean;
  /** TCP keep-alive interval in seconds (only when keepAlive is true) */
  keepAliveIntervalSecs?: number;
  /** Socket receive buffer size in bytes */
  recvBufferSize?: number;
  /** Socket send buffer size in bytes */
  sendBufferSize?: number;
}

/** Default RDP settings for new connections */
export const DEFAULT_RDP_SETTINGS: RDPConnectionSettings = {
  display: {
    width: 1920,
    height: 1080,
    resizeToWindow: false,
    colorDepth: 32,
    desktopScaleFactor: 100,
    lossyCompression: true,
    magnifierEnabled: false,
    magnifierZoom: 3,
    smartSizing: true,
  },
  audio: {
    playbackMode: 'local',
    recordingMode: 'disabled',
    audioQuality: 'dynamic',
  },
  input: {
    mouseMode: 'absolute',
    keyboardLayout: 0x0409,
    keyboardType: 'ibm-enhanced',
    keyboardFunctionKeys: 12,
    imeFileName: '',
    enableUnicodeInput: true,
    autoDetectLayout: true,
    inputPriority: 'realtime',
    batchIntervalMs: 16,
  },
  deviceRedirection: {
    clipboard: true,
    drives: [],
    printers: false,
    ports: false,
    smartCards: false,
    webAuthn: false,
    videoCapture: false,
    usbDevices: false,
    audioInput: false,
  },
  performance: {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    disableCursorSettings: false,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
    persistentBitmapCaching: false,
    connectionSpeed: 'broadband-high',
    targetFps: 30,
    frameBatching: false,
    frameBatchIntervalMs: 33,
    codecs: {
      enableCodecs: true,
      remoteFx: true,
      remoteFxEntropy: 'rlgr3',
      enableGfx: false,
      h264Decoder: 'auto',
    },
    renderBackend: 'webview',
    frontendRenderer: 'auto',
  },
  security: {
    enableTls: true,
    enableNla: true,
    useCredSsp: true,
    autoLogon: false,
    enableServerPointer: true,
    pointerSoftwareRendering: true,
  },
  gateway: {
    enabled: false,
    hostname: '',
    port: 443,
    authMethod: 'ntlm',
    credentialSource: 'same-as-connection',
    bypassForLocal: true,
    transportMode: 'auto',
  },
  hyperv: {
    useVmId: false,
    vmId: '',
    enhancedSessionMode: false,
    hostServer: '',
  },
  negotiation: {
    autoDetect: false,
    strategy: 'nla-first',
    maxRetries: 3,
    retryDelayMs: 1000,
    loadBalancingInfo: '',
    useRoutingToken: false,
  },
  advanced: {
    clientName: 'SortOfRemoteNG',
    clientBuild: 0,
    readTimeoutMs: 16,
    fullFrameSyncInterval: 300,
    maxConsecutiveErrors: 50,
    statsIntervalSecs: 1,
  },
  tcp: {
    connectTimeoutSecs: 10,
    nodelay: true,
    keepAlive: true,
    keepAliveIntervalSecs: 60,
    recvBufferSize: 262144,
    sendBufferSize: 262144,
  },
};

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

export interface SecurityQuestion {
  question: string;
  answer: string;
}

export interface RecoveryInfo {
  phone?: string;
  alternativeEmail?: string;
  alternativePhone?: string;
  alternativeEquipment?: string;
  seedPhrase?: string;
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

