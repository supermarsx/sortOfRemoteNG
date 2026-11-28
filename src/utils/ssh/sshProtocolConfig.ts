import type { Connection } from "../../types/connection/connection";
import {
  type SSHConnectionConfig,
  type SSHTerminalConfig,
  defaultSSHConnectionConfig,
  defaultSSHTerminalConfig,
  mergeSSHConnectionConfig,
} from "../../types/ssh/sshSettings";

// Older releases stored protocol controls in terminal overrides. Read them as
// connection overrides until the user explicitly changes or resets that field.
export const LEGACY_SSH_FIELDS = {
  sshVersion: "sshVersion",
  enableCompression: "enableCompression",
  compressionLevel: "compressionLevel",
  preferredCiphers: "preferredCiphers",
  preferredMACs: "preferredMACs",
  preferredKeyExchanges: "preferredKeyExchanges",
  preferredHostKeyAlgorithms: "preferredHostKeyAlgorithms",
} as const;
export const LEGACY_SSH_TCP_FIELDS = {
  connectTimeout: "connectionTimeout",
  keepAliveInterval: "keepAliveInterval",
  tcpNoDelay: "tcpNoDelay",
  tcpKeepAlive: "soKeepAlive",
  keepAliveProbes: "keepAliveProbes",
  ipProtocol: "ipProtocol",
} as const;
export function sshProtocolOverrides(
  connection: Partial<Connection>,
): Partial<SSHConnectionConfig> {
  const legacy = connection.sshTerminalConfigOverride;
  const values: Record<string, unknown> = {};
  for (const [key, oldKey] of Object.entries(LEGACY_SSH_FIELDS))
    if (legacy?.[oldKey] !== undefined) values[key] = legacy[oldKey];
  if (connection.sshConnectTimeout !== undefined)
    values.connectTimeout = connection.sshConnectTimeout;
  if (connection.sshKeepAliveInterval !== undefined)
    values.keepAliveInterval = connection.sshKeepAliveInterval;
  for (const [key, oldKey] of Object.entries(LEGACY_SSH_TCP_FIELDS))
    if (legacy?.tcpOptions?.[oldKey] !== undefined)
      values[key] = legacy.tcpOptions[oldKey];
  if (legacy?.tcpOptions?.tcpKeepAlive === false) values.keepAliveInterval = 0;
  return { ...values, ...connection.sshConnectionConfigOverride };
}
export function sshProtocolDefaults(
  global?: Partial<SSHConnectionConfig>,
  terminal: SSHTerminalConfig = defaultSSHTerminalConfig,
): SSHConnectionConfig {
  const config = { ...defaultSSHConnectionConfig, ...global };
  // Preserve the historical global algorithm list when no global protocol list
  // was selected. A per-connection [] remains an explicit library-default list.
  for (const key of [
    "preferredCiphers",
    "preferredMACs",
    "preferredKeyExchanges",
    "preferredHostKeyAlgorithms",
  ] as const)
    if (!global?.[key]?.length) config[key] = terminal[key];
  return config;
}
export function resolveSshProtocolConfig(
  connection: Partial<Connection>,
  global?: Partial<SSHConnectionConfig>,
  terminal?: SSHTerminalConfig,
): SSHConnectionConfig {
  return mergeSSHConnectionConfig(
    sshProtocolDefaults(global, terminal),
    sshProtocolOverrides(connection),
  );
}
export function clearLegacySshProtocolField(
  connection: Partial<Connection>,
  key: keyof SSHConnectionConfig,
): Partial<Connection> {
  const next = { ...connection };
  const legacy = { ...connection.sshTerminalConfigOverride };
  const direct = LEGACY_SSH_FIELDS[key as keyof typeof LEGACY_SSH_FIELDS];
  if (direct) delete legacy[direct];
  const tcp = LEGACY_SSH_TCP_FIELDS[key as keyof typeof LEGACY_SSH_TCP_FIELDS];
  if (tcp) {
    const options = { ...legacy.tcpOptions };
    delete options[tcp];
    if (key === "keepAliveInterval") delete options.tcpKeepAlive;
    legacy.tcpOptions = Object.keys(options).length
      ? (options as SSHTerminalConfig["tcpOptions"])
      : undefined;
    if (!legacy.tcpOptions) delete legacy.tcpOptions;
  }
  if (key === "connectTimeout") delete next.sshConnectTimeout;
  if (key === "keepAliveInterval") delete next.sshKeepAliveInterval;
  next.sshTerminalConfigOverride = Object.keys(legacy).length
    ? legacy
    : undefined;
  return next;
}
