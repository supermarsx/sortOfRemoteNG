import type { OutputBufferingMode, PsAuthMethod } from "./powershell";

/**
 * Persisted PowerShell Remoting settings.
 *
 * This is intentionally separate from `winrmSettings`: Windows management
 * tools (including WMI) and a PowerShell remoting session are different
 * products even when both happen to use WSMan.
 */
export const POWERSHELL_REMOTING_SCHEMA_VERSION = 1 as const;

export type PowerShellRemotingSchemaVersion =
  typeof POWERSHELL_REMOTING_SCHEMA_VERSION;

export type PowerShellRemotingTransport = "wsman" | "ssh";
export type PowerShellCredentialSource = "saved" | "prompt" | "vault";
export type PowerShellWsmanScheme = "http" | "https";
export type PowerShellSshAuthMethod = "password" | "privateKey" | "agent";
export type PowerShellTlsTrustMode =
  | "system"
  | "tofu"
  | "pinned"
  | "alwaysTrust";
export type PowerShellSshHostTrustMode = "strict" | "tofu" | "pinned";
export type PowerShellProxyMode = "none" | "http" | "socks5";

export interface PowerShellVaultReference {
  /** Integration that owns the vault record, when more than one is enabled. */
  integrationId?: string | null;
  /** Opaque record identifier. The secret value is never persisted here. */
  secretId: string;
}

export interface PowerShellCredentialSettings {
  source: PowerShellCredentialSource;
  username: string;
  domain?: string | null;
  /** Opaque reference to the app's encrypted credential store. */
  savedCredentialId?: string | null;
  vaultRef?: PowerShellVaultReference | null;
}

export interface PowerShellTlsSettings {
  trustMode: PowerShellTlsTrustMode;
  pinnedFingerprint?: string | null;
  skipHostnameCheck: boolean;
  skipRevocationCheck: boolean;
  /** Opaque reference only; a private key or passphrase is never embedded. */
  clientCertificateRef?: string | null;
}

export interface PowerShellProxySettings {
  mode: PowerShellProxyMode;
  url?: string | null;
  credentialRef?: string | null;
}

export interface PowerShellWsmanSettings {
  scheme: PowerShellWsmanScheme;
  port: number;
  path: string;
  /** Optional complete HTTP(S) endpoint. It overrides host, port, and path. */
  connectionUri?: string | null;
  configurationName: string;
  applicationName: string;
  authMethod: PsAuthMethod;
  tls: PowerShellTlsSettings;
  proxy: PowerShellProxySettings;
}

export interface PowerShellSshHostTrustSettings {
  mode: PowerShellSshHostTrustMode;
  fingerprint?: string | null;
}

export interface PowerShellSshSettings {
  port: number;
  subsystem: string;
  authMethod: PowerShellSshAuthMethod;
  privateKeyPath?: string | null;
  /** Opaque encrypted-store or vault reference for a key/passphrase. */
  privateKeyCredentialRef?: string | null;
  agentSocket?: string | null;
  hostTrust: PowerShellSshHostTrustSettings;
  keepaliveSec: number;
  compression: boolean;
}

export interface PowerShellReconnectSettings {
  enabled: boolean;
  maxAttempts: number;
  delaySec: number;
}

export interface PowerShellSessionSettings {
  connectTimeoutSec: number;
  openTimeoutSec: number;
  operationTimeoutSec: number;
  cancelTimeoutSec: number;
  idleTimeoutSec: number;
  reconnect: PowerShellReconnectSettings;
  outputBufferingMode: OutputBufferingMode;
  maxReceivedDataSizeMb: number;
  maxReceivedObjectSizeMb: number;
}

export type PowerShellNetworkPathMode = "direct" | "connectionPath";

/**
 * A non-secret reference/summary only. The shared network-path resolver owns
 * the actual chain, VPN, bastion, and proxy configuration.
 */
export interface PowerShellNetworkPathSettings {
  mode: PowerShellNetworkPathMode;
  pathId?: string | null;
  summary?: string | null;
}

export interface PowerShellWindowsToolsSettings {
  enabled: boolean;
  /** A literal guard against accidentally treating WMI config as PowerShell. */
  settingsSource: "separateWinrmSettings";
}

export interface PowerShellRemotingSettings {
  schemaVersion: PowerShellRemotingSchemaVersion;
  transport: PowerShellRemotingTransport;
  credential: PowerShellCredentialSettings;
  wsman: PowerShellWsmanSettings;
  ssh: PowerShellSshSettings;
  session: PowerShellSessionSettings;
  networkPath: PowerShellNetworkPathSettings;
  windowsTools: PowerShellWindowsToolsSettings;
}

export interface PowerShellSettingsIssue {
  path: string;
  code:
    | "basicRequiresTls"
    | "invalidEndpoint"
    | "invalidPort"
    | "missingCredentialReference"
    | "missingFingerprint"
    | "missingPrivateKey"
    | "missingProxyUrl"
    | "unsupportedSchema";
  severity: "error" | "warning";
  message: string;
}

export interface NormalizedPowerShellRemotingSettings {
  settings: PowerShellRemotingSettings;
  warnings: string[];
  issues: PowerShellSettingsIssue[];
  migratedFromVersion?: number | "legacy";
}
