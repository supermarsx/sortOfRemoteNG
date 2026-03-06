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

// ===================================
// SSH Compression Types
// ===================================

/** Compression algorithms supported by the SSH transport layer (RFC 4253). */
export const SshCompressionAlgorithms = [
  /** No compression — raw data transfer */
  'none',
  /** Standard zlib compression (RFC 1950) — compresses from session start */
  'zlib',
  /** Delayed zlib — compression activates only after user authentication.
   *  More secure than plain `zlib` (mitigates pre-auth exploits). */
  'zlib_openssh',
  /** Automatically negotiate the best available algorithm.
   *  Preference order: zlib@openssh.com > zlib > none */
  'auto',
] as const;
export type SshCompressionAlgorithm = (typeof SshCompressionAlgorithms)[number];

/** Per-direction compression settings for upload (C→S) or download (S→C). */
export interface SshDirectionalCompression {
  /** Compression algorithm for this direction */
  algorithm: SshCompressionAlgorithm;
  /** Compression level 1-9 (1 = fastest, 9 = best, 0 = library default) */
  level: number;
}

/** Adaptive compression adjusts behaviour based on data characteristics. */
export interface SshAdaptiveCompression {
  /** When true, compression skips already-compressed payloads */
  enabled: boolean;
  /** Minimum payload size (bytes) before compression kicks in */
  minPayloadBytes: number;
  /** Disable compression if compression ratio exceeds this (0.0–1.0) */
  ratioThreshold: number;
  /** File extensions that should never be compressed (already compressed) */
  incompressibleExtensions: string[];
}

export const defaultAdaptiveCompression: SshAdaptiveCompression = {
  enabled: false,
  minPayloadBytes: 256,
  ratioThreshold: 0.9,
  incompressibleExtensions: [
    'gz', 'bz2', 'xz', 'zst', 'lz4', 'lzma', 'zip', '7z', 'rar',
    'tar.gz', 'tar.bz2', 'tar.xz', 'tgz',
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif',
    'mp3', 'mp4', 'mkv', 'avi', 'flac', 'ogg', 'webm',
    'pdf', 'docx', 'xlsx',
  ],
};

/** Comprehensive SSH compression configuration. */
export interface SshCompressionConfig {
  /** Master switch — when false, compression is completely disabled */
  enabled: boolean;
  /** Global compression algorithm preference */
  algorithm: SshCompressionAlgorithm;
  /** Global compression level 1-9 (1 = fastest, 9 = best, 0 = default) */
  level: number;
  /** Per-direction overrides (take precedence over global settings) */
  clientToServer?: SshDirectionalCompression;
  serverToClient?: SshDirectionalCompression;
  /** Adaptive compression settings */
  adaptive: SshAdaptiveCompression;
  /** Track runtime compression statistics */
  trackStatistics: boolean;
  /** Compress SFTP transfer data (false = bypass compression for SFTP) */
  compressSftp: boolean;
  /** Allow runtime updates to compression settings */
  allowRuntimeUpdate: boolean;
}

export const defaultCompressionConfig: SshCompressionConfig = {
  enabled: false,
  algorithm: 'auto',
  level: 6,
  clientToServer: undefined,
  serverToClient: undefined,
  adaptive: { ...defaultAdaptiveCompression },
  trackStatistics: false,
  compressSftp: false,
  allowRuntimeUpdate: false,
};

/** Runtime compression statistics tracked per-session. */
export interface SshCompressionStats {
  bytesSentUncompressed: number;
  bytesSentCompressed: number;
  bytesRecvUncompressed: number;
  bytesRecvCompressed: number;
  sendRatio: number;
  recvRatio: number;
  negotiatedCsAlgorithm: string;
  negotiatedScAlgorithm: string;
  compressionActive: boolean;
  adaptiveSkips: number;
}

/** Full compression info snapshot returned by get_ssh_compression_info. */
export interface SshCompressionInfo {
  sessionId: string;
  config: SshCompressionConfig;
  stats: SshCompressionStats;
  negotiatedCsAlgorithm: string;
  negotiatedScAlgorithm: string;
}

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
  /** Full compression configuration — takes precedence over legacy enableCompression/compressionLevel */
  compressionConfig: SshCompressionConfig;

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

  // Custom background, fading & overlays
  background: TerminalBackgroundConfig;
}

// ===================================
// Terminal Background Types
// ===================================

export const TerminalBackgroundTypes = [
  'none',
  'solid',
  'gradient',
  'image',
  'animated',
] as const;
export type TerminalBackgroundType = (typeof TerminalBackgroundTypes)[number];

export const GradientDirections = [
  'to-bottom',
  'to-right',
  'to-bottom-right',
  'to-bottom-left',
  'radial',
  'conic',
] as const;
export type GradientDirection = (typeof GradientDirections)[number];

export const AnimatedBackgroundEffects = [
  'matrix-rain',
  'starfield',
  'particles',
  'scanlines',
  'noise',
  'aurora',
  'rain',
  'fireflies',
] as const;
export type AnimatedBackgroundEffect = (typeof AnimatedBackgroundEffects)[number];

export const OverlayBlendModes = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'soft-light',
  'hard-light',
] as const;
export type OverlayBlendMode = (typeof OverlayBlendModes)[number];

export const FadingEdges = [
  'none',
  'top',
  'bottom',
  'left',
  'right',
  'all',
  'top-bottom',
  'left-right',
] as const;
export type FadingEdge = (typeof FadingEdges)[number];

export interface GradientStop {
  color: string;
  position: number; // 0-100
}

export interface TerminalOverlay {
  id: string;
  enabled: boolean;
  type: 'color' | 'gradient' | 'vignette' | 'scanlines' | 'noise' | 'crt' | 'grid';
  opacity: number; // 0-1
  blendMode: OverlayBlendMode;
  color?: string;
  gradientStops?: GradientStop[];
  gradientDirection?: GradientDirection;
  /** Overlay-specific intensity (scanline spacing, noise grain, etc.) */
  intensity?: number;
}

export interface TerminalFadingConfig {
  enabled: boolean;
  edge: FadingEdge;
  /** Fade size in pixels */
  size: number;
  /** Fade color — defaults to terminal background */
  color?: string;
}

export interface TerminalBackgroundConfig {
  enabled: boolean;
  type: TerminalBackgroundType;

  // Solid color
  solidColor?: string;

  // Gradient
  gradientStops?: GradientStop[];
  gradientDirection?: GradientDirection;

  // Image
  imagePath?: string;
  imageOpacity?: number; // 0-1
  imageBlur?: number; // px
  imageSize?: 'cover' | 'contain' | 'fill' | 'tile';
  imagePosition?: string; // CSS background-position

  // Animated effect
  animatedEffect?: AnimatedBackgroundEffect;
  animationSpeed?: number; // 0.1-3 multiplier
  animationDensity?: number; // 0.1-3 multiplier
  animationColor?: string;

  // Global background opacity (applied over terminal background)
  opacity: number; // 0-1

  // Fading
  fading: TerminalFadingConfig;

  // Overlays (layered on top)
  overlays: TerminalOverlay[];
}

export const defaultTerminalFading: TerminalFadingConfig = {
  enabled: false,
  edge: 'none',
  size: 40,
};

export const defaultTerminalBackground: TerminalBackgroundConfig = {
  enabled: false,
  type: 'none',
  opacity: 1,
  solidColor: '#0b1120',
  gradientStops: [
    { color: '#0b1120', position: 0 },
    { color: '#1a1a2e', position: 100 },
  ],
  gradientDirection: 'to-bottom',
  imageOpacity: 0.15,
  imageBlur: 0,
  imageSize: 'cover',
  imagePosition: 'center center',
  animatedEffect: 'matrix-rain',
  animationSpeed: 1,
  animationDensity: 1,
  animationColor: '#00ff41',
  fading: { ...defaultTerminalFading },
  overlays: [],
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
  compressionConfig: { ...defaultCompressionConfig },

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

  // Custom background, fading & overlays
  background: { ...defaultTerminalBackground },
};

// ===================================
// Jump Host & Mixed Chain Types
// ===================================

/** Configuration for a single SSH jump host. */
export interface JumpHostConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  agentForwarding?: boolean;
  totpSecret?: string;
  keyboardInteractiveResponses?: string[];
  preferredCiphers?: string[];
  preferredMacs?: string[];
  preferredKex?: string[];
  preferredHostKeyAlgorithms?: string[];
}

/** Proxy hop used inside a mixed chain. */
export interface ProxyConfig {
  proxyType: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** A single hop in a mixed chain. */
export type ChainHop =
  | { type: 'ssh_jump' } & JumpHostConfig
  | { type: 'proxy' } & ProxyConfig;

/** Configuration for a mixed chain of SSH jumps + proxy hops. */
export interface MixedChainConfig {
  hops: ChainHop[];
  hopTimeoutMs?: number;
}

/** Per-hop descriptive info returned by validate_mixed_chain. */
export interface ChainHopInfo {
  index: number;
  label: string;
  hopType: string;
  host: string;
  port: number;
}

/** Overall status / validation result of a mixed chain. */
export interface MixedChainStatus {
  totalHops: number;
  sshJumpCount: number;
  proxyCount: number;
  hops: ChainHopInfo[];
}

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
  /** Full compression configuration — takes precedence over legacy enableCompression/compressionLevel */
  compressionConfig: SshCompressionConfig;

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
  x11Trusted: boolean;
  x11Screen: number;
  x11DisplayOverride?: string;
  x11XauthorityPath?: string;
  x11TimeoutSecs: number;
  enableTcpForwarding: boolean;

  // Jump host / ProxyCommand
  enableJumpHost: boolean;
  jumpHostConnectionId?: string;
  proxyCommand?: string;
  proxyCommandTemplate?: ProxyCommandTemplate;
  proxyCommandHost?: string;
  proxyCommandPort?: number;
  proxyCommandUsername?: string;
  proxyCommandPassword?: string;
  proxyCommandProxyType?: string;
  proxyCommandTimeout?: number;

  // Mixed chain (SSH jumps + proxy hops)
  mixedChain?: MixedChainConfig;

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

export const ProxyCommandTemplates = ['nc', 'ncat', 'socat', 'connect', 'corkscrew', 'ssh_stdio'] as const;
export type ProxyCommandTemplate = (typeof ProxyCommandTemplates)[number];

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
  compressionConfig: { ...defaultCompressionConfig },

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
  x11Trusted: false,
  x11Screen: 0,
  x11DisplayOverride: undefined,
  x11XauthorityPath: undefined,
  x11TimeoutSecs: 0,
  enableTcpForwarding: true,

  // Jump host / ProxyCommand
  enableJumpHost: false,
  jumpHostConnectionId: undefined,
  proxyCommand: undefined,
  proxyCommandTemplate: undefined,
  proxyCommandHost: undefined,
  proxyCommandPort: undefined,
  proxyCommandUsername: undefined,
  proxyCommandPassword: undefined,
  proxyCommandProxyType: undefined,
  proxyCommandTimeout: undefined,

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
    // Deep merge compression config
    compressionConfig: {
      ...globalConfig.compressionConfig,
      ...(override.compressionConfig || {}),
      adaptive: {
        ...globalConfig.compressionConfig.adaptive,
        ...(override.compressionConfig?.adaptive || {}),
      },
    },
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
    compressionConfig: {
      ...globalConfig.compressionConfig,
      ...(override.compressionConfig || {}),
      adaptive: {
        ...globalConfig.compressionConfig.adaptive,
        ...(override.compressionConfig?.adaptive || {}),
      },
    },
    background: {
      ...globalConfig.background,
      ...(override.background || {}),
      fading: {
        ...globalConfig.background.fading,
        ...(override.background?.fading || {}),
      },
      overlays: override.background?.overlays ?? globalConfig.background.overlays,
    },
  };
}
