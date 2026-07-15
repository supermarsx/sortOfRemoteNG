export const RLOGIN_SETTINGS_VERSION = 1 as const;
export const RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE =
  "rlogin-plaintext-v1" as const;
export const RLOGIN_DEFAULT_PORT = 513 as const;

export const RLOGIN_SOURCE_PORT_MODES = [
  "ephemeral",
  "reserved",
  "auto",
] as const;
export type RloginSourcePortMode = (typeof RLOGIN_SOURCE_PORT_MODES)[number];

export const RLOGIN_ENCODINGS = [
  "utf-8",
  "windows-1252",
  "iso-8859-1",
] as const;
export type RloginEncoding = (typeof RLOGIN_ENCODINGS)[number];

export interface RloginPlaintextAcknowledgement {
  version: 1;
  scope: typeof RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

/**
 * Versioned per-connection RLogin settings.
 *
 * The target host and port remain canonical connection-level fields. RLogin
 * has no password field because RFC 1282 does not authenticate a password in
 * its handshake and the client must never automate a password prompt.
 */
export interface RloginSettings {
  version: typeof RLOGIN_SETTINGS_VERSION;
  localUsername: string;
  remoteUsername: string;
  terminalType: string;
  terminalSpeed: number;
  encoding: RloginEncoding;
  initialRows: number;
  initialColumns: number;
  localFlowControl: boolean;
  escapeEnabled: boolean;
  escapeCharacter: string;
  sourcePortMode: RloginSourcePortMode;
  reservedPortStart: number;
  reservedPortEnd: number;
  connectTimeoutMs: number;
  handshakeTimeoutMs: number;
  writeTimeoutMs: number;
  idleTimeoutMs: number;
  tcpNoDelay: boolean;
  tcpKeepAlive: boolean;
  tcpKeepAliveSeconds: number;
  plaintextAcknowledgement: RloginPlaintextAcknowledgement;
}

export type RloginSettingsPatch = Partial<
  Omit<RloginSettings, "version" | "plaintextAcknowledgement">
> & {
  plaintextAcknowledgement?: RloginPlaintextAcknowledgement;
};

export type RloginNetworkPathLayerKind =
  | "vpn"
  | "http-connect"
  | "https-connect"
  | "socks4"
  | "socks5"
  | "ssh-jump"
  | "unsupported";

/** UI-safe capability projection. It must never contain path credentials. */
export interface RloginNetworkPathCapability {
  configured: boolean;
  supported: boolean;
  summary: string;
  layers: readonly {
    kind: RloginNetworkPathLayerKind;
    label: string;
  }[];
}

export const DIRECT_RLOGIN_NETWORK_PATH: RloginNetworkPathCapability = {
  configured: false,
  supported: true,
  summary: "Direct TCP connection to the target",
  layers: [],
};
