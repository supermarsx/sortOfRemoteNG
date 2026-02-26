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
