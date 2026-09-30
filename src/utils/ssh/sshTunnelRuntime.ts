import type { ConnectionContextType } from "../../contexts/ConnectionContextTypes";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { DatabaseManager } from "../connection/databaseManager";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { normalizeAdvancedProtocolConnection } from "../connection/normalizeAdvancedProtocolConnection";
import { normalizeConnectionCredentialSource } from "../security/databaseCredentialVault";
import {
  resolveRuntimeVaultCredential,
  type RuntimeVaultCredentialResult,
} from "../security/runtimeCredentialVault";
import {
  defaultSSHConnectionConfig,
  type SSHConnectionConfig,
} from "../../types/ssh/sshSettings";
import type {
  ResolvedChainConfig,
  ResolvedJumpHost,
} from "./resolveChainConfig";
import { invoke } from "@tauri-apps/api/core";

export interface SshTunnelNativeEndpoint extends ResolvedJumpHost {
  allow_agent_auth?: boolean;
  private_key_content?: string | null;
  totp_options?: { algorithm: string; digits: number; period: number } | null;
}

/** Complete native connect_ssh payload, shared by saved and RDP tunnel callers.
 * Keep this ephemeral: it may contain resolved vault credentials.
 * Callers must install listenForTunnelTrust before invoking connect_ssh.
 */
export function buildSshTunnelNativeConfig(
  endpoint: SshTunnelNativeEndpoint,
  transport: ResolvedChainConfig,
  options: {
    sshConfig?: Partial<SSHConnectionConfig>;
    trustPolicy?: Connection["sshTrustPolicy"];
    ignoreSshSecurityErrors?: boolean;
  } = {},
) {
  const config = options.sshConfig ?? {};
  const defaults = defaultSSHConnectionConfig;
  return {
    host: endpoint.host,
    port: endpoint.port || 22,
    username: endpoint.username,
    password: endpoint.password ?? null,
    private_key_path: endpoint.private_key_path ?? null,
    private_key_content: endpoint.private_key_content ?? null,
    private_key_passphrase: endpoint.private_key_passphrase ?? null,
    // Match native's default for existing RDP callers. Saved/vault tunnels
    // explicitly disable fallback when their selected credential owns auth.
    allow_agent_auth: endpoint.allow_agent_auth ?? true,
    totp_secret: endpoint.totp_secret ?? null,
    totp_options: endpoint.totp_options ?? null,
    keyboard_interactive_responses:
      endpoint.keyboard_interactive_responses ?? [],
    agent_forwarding:
      endpoint.agent_forwarding ??
      config.agentForwarding ??
      defaults.agentForwarding,
    jump_hosts: transport.jump_hosts,
    proxy_config: transport.proxy_config,
    proxy_chain: transport.proxy_chain,
    mixed_chain: transport.mixed_chain,
    openvpn_config: transport.openvpn_config,
    connect_timeout: config.connectTimeout ?? defaults.connectTimeout,
    keep_alive_interval: config.keepAliveInterval ?? defaults.keepAliveInterval,
    // Strict Trust Center policy cannot be weakened by a legacy SSH toggle.
    // Undefined/partial persisted options must serialize a boolean, not vanish.
    strict_host_key_checking:
      options.trustPolicy === "strict" ||
      (config.strictHostKeyChecking !== false &&
        options.ignoreSshSecurityErrors !== true &&
        options.trustPolicy !== "always-trust"),
    accept_new_host_keys: false,
    also_write_known_hosts: true,
    known_hosts_path: config.knownHostsPath ?? null,
    tcp_no_delay: config.tcpNoDelay ?? defaults.tcpNoDelay,
    tcp_keepalive: config.tcpKeepAlive ?? defaults.tcpKeepAlive,
    keepalive_probes: config.keepAliveProbes ?? defaults.keepAliveProbes,
    ip_protocol: config.ipProtocol ?? defaults.ipProtocol,
    compression: config.enableCompression ?? defaults.enableCompression,
    compression_level: config.compressionLevel ?? defaults.compressionLevel,
    ssh_version: config.sshVersion ?? defaults.sshVersion,
    preferred_ciphers:
      endpoint.preferred_ciphers ?? config.preferredCiphers ?? [],
    preferred_macs: endpoint.preferred_macs ?? config.preferredMACs ?? [],
    preferred_kex: endpoint.preferred_kex ?? config.preferredKeyExchanges ?? [],
    preferred_host_key_algorithms:
      endpoint.preferred_host_key_algorithms ??
      config.preferredHostKeyAlgorithms ??
      [],
  };
}

/** RDP/shared tunnel handshake: install the Trust Center listener before native
 * verification can prompt, and release it on success, rejection or cancellation.
 */
export async function connectSshTunnelTransport(
  endpoint: SshTunnelNativeEndpoint,
  transport: ResolvedChainConfig,
  options: NonNullable<Parameters<typeof buildSshTunnelNativeConfig>[2]> & {
    connectionId?: string;
    assertCurrent?: () => void;
  } = {},
): Promise<string> {
  options.assertCurrent?.();
  const config = buildSshTunnelNativeConfig(endpoint, transport, options);
  // Saved-source resolution also imports this module; defer Trust Center's
  // event subscriptions until a handshake actually needs its listener.
  const { listenForTunnelTrust } = await import("./sshTunnelTrust");
  options.assertCurrent?.();
  const unlisten = await listenForTunnelTrust(
    config.host,
    config.port,
    config.username,
    options.connectionId,
    options.trustPolicy ?? "always-ask",
    () => options.assertCurrent?.(),
  );
  let sessionId: string | undefined;
  try {
    options.assertCurrent?.();
    sessionId = await invoke<string>("connect_ssh", { config });
    options.assertCurrent?.();
    return sessionId;
  } catch (error) {
    if (sessionId) await invoke("disconnect_ssh", { sessionId });
    throw error;
  } finally {
    unlisten();
  }
}

export interface TunnelRuntimeOptions {
  networkPathContext?: () => ConnectionContextType;
  connections?: readonly Connection[];
  vault?: RuntimeVaultCredentialResult;
  assertCurrent?: () => void;
}

/** Private comparison only: never log or persist this credential-bearing key.
 * Retain unknown fields so new authentication/route/trust options participate
 * automatically. Unlike website identities this has no HTTP normalization.
 */
export function tunnelSourceIdentity(
  connection: Connection | undefined,
): string {
  if (!connection) return stableJsonStringify(null);
  const source: Record<string, unknown> = { ...connection };
  for (const key of [
    "name",
    "description",
    "tags",
    "order",
    "color",
    "colorTag",
    "tabColor",
    "icon",
    "expanded",
    "favorite",
    "httpBookmarks",
    "focusOnConnect",
    "focusOnWinmgmtTool",
    "lastConnected",
    "connectionCount",
    "updatedAt",
    "lastAccessed",
    "lastUsed",
  ])
    delete source[key];
  // Keep creation identity (and invalid/missing values), but equate hydrated
  // Dates and persisted strings representing the same instant.
  const createdAt = source.createdAt;
  if (typeof createdAt === "string" || createdAt instanceof Date) {
    const timestamp = new Date(createdAt).getTime();
    if (Number.isFinite(timestamp))
      source.createdAt = new Date(timestamp).toISOString();
  }
  return stableJsonStringify(source);
}

/** Read the owning saved database at connect time; never serialize resolved authentication. */
export async function resolveSavedTunnelBase(
  connectionId: string,
  ownerDatabaseId: string | undefined,
  current: () => ConnectionContextType,
): Promise<{ connection: Connection; options: TunnelRuntimeOptions }> {
  if (!ownerDatabaseId)
    throw new Error(
      "This legacy tunnel has no owning database. Edit it, explicitly reselect its saved SSH base and save before connecting.",
    );
  const captured = current();
  const availability = captured.databaseAvailability;
  const target =
    DatabaseManager.getInstance().captureCurrentDatabaseDataTarget();
  if (
    !target?.readCurrent ||
    !target.assertAccessible ||
    availability?.status !== "ready" ||
    availability.databaseId !== target.databaseId ||
    (ownerDatabaseId && ownerDatabaseId !== target.databaseId)
  ) {
    throw new Error(
      "Open and unlock the tunnel's owning database before connecting its saved SSH base.",
    );
  }
  const api = captured.credentialVault;
  const revision = api?.changeRevision;
  const scope = JSON.stringify(api?.scope);
  const selected = captured.state.connections.find(
    (c) => c.id === connectionId,
  );
  const selectedKey = tunnelSourceIdentity(selected);
  const assertCurrent = () => {
    const latest = current();
    target.assertAccessible!();
    const live =
      latest.getCurrentConnections?.({
        databaseId: target.databaseId,
        generation: availability.generation,
      }) ?? latest.state.connections;
    if (
      latest.databaseAvailability?.status !== "ready" ||
      latest.databaseAvailability.databaseId !== target.databaseId ||
      latest.databaseAvailability.generation !== availability.generation ||
      latest.credentialVault?.changeRevision !== revision ||
      JSON.stringify(latest.credentialVault?.scope) !== scope ||
      tunnelSourceIdentity(live.find((c) => c.id === connectionId)) !==
        selectedKey
    ) {
      throw new Error(
        "The SSH base or owning database changed. Review the saved connection and retry.",
      );
    }
  };
  assertCurrent();
  const data = await target.readCurrent();
  assertCurrent();
  const matches = data?.connections.filter((c) => c.id === connectionId);
  const connection =
    matches?.length === 1
      ? normalizeAdvancedProtocolConnection(matches[0])
      : undefined;
  if (
    !selected ||
    !connection ||
    connection.protocol !== "ssh" ||
    connection.isGroup ||
    tunnelSourceIdentity(connection) !== selectedKey
  ) {
    throw new Error(
      "Save the SSH base connection in its owning database before opening this tunnel.",
    );
  }
  let vault: RuntimeVaultCredentialResult | undefined;
  if (
    normalizeConnectionCredentialSource(connection.credentialSource)?.kind ===
    "vault"
  ) {
    if (!api?.scope)
      throw new Error(
        "Unlock the owning database credential vault before connecting this SSH tunnel.",
      );
    vault = await resolveRuntimeVaultCredential({
      api,
      connection,
      target,
      assertCurrent,
      session: {
        id: `ssh-tunnel:${connection.id}`,
        connectionId: connection.id,
        ownerDatabaseId: target.databaseId,
        hostname: connection.hostname,
        protocol: "ssh",
        name: connection.name,
        status: "connecting",
        startTime: new Date(),
      } as ConnectionSession,
    });
  }
  return {
    connection,
    options: {
      connections: data!.connections,
      vault,
      assertCurrent,
      networkPathContext: current,
    },
  };
}
