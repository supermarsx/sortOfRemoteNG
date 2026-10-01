import { invoke } from "@tauri-apps/api/core";
import { Connection } from "../../types/connection/connection";
import {
  readTunnelPassword,
  writeTunnelPassword,
  deleteTunnelPassword,
} from "./sshTunnelCredentials";
import {
  buildSshTunnelNativeConfig,
  type TunnelRuntimeOptions,
} from "./sshTunnelRuntime";
import { resolveRuntimeNetworkPath } from "../network/resolveRuntimeNetworkPath";
import {
  acquireSessionVpnLeases,
  createVpnLeaseAttemptOwnerId,
  releaseSessionVpnLeases,
} from "../network/vpnSessionLeases";
import { normalizeConnectionCredentialSource } from "../security/databaseCredentialVault";
import { SettingsManager } from "../settings/settingsManager";
import {
  defaultSSHConnectionConfig,
  mergeSSHConnectionConfig,
} from "../../types/ssh/sshSettings";
import { resolveEffectiveTrustPolicy } from "../auth/trustStore";
import { redactSecrets } from "../errors/redact";
import { listenForTunnelTrust } from "./sshTunnelTrust";
import { SecureStorage } from "../storage/storage";
import {
  AppDataJsonStore,
  type SanitizedValue,
} from "../storage/appDataJsonStore";

export interface SSHTunnelConfig {
  id: string;
  name: string;
  // The SSH connection to use as the tunnel host
  sshConnectionId?: string;
  ownerDatabaseId?: string;
  host?: string;
  port?: number;
  username?: string;
  /** Opaque OS vault reference; never contains a password. */
  credentialRef?: string;
  /** Durable retry list for retired OS-vault entries. Contains references only. */
  pendingCredentialRefs?: string[];
  /** Persisted before deleting secrets; only deletion retries are allowed. */
  pendingDeletion?: boolean;
  needsCleanup?: boolean;
  // Local port to bind (0 = auto-assign)
  localPort: number;
  // Remote host to forward to (from the SSH server's perspective)
  // Not used for dynamic tunnels
  remoteHost?: string;
  // Remote port to forward to
  // Not used for dynamic tunnels
  remotePort?: number;
  // Tunnel type
  type: "local" | "remote" | "dynamic";
  // Status
  status: "disconnected" | "connecting" | "connected" | "error";
  // Auto-connect when associated connection starts
  autoConnect: boolean;
  // Allow the local forward to bind to a non-loopback (public/LAN) interface.
  // Mirrors the Rust `PortForwardConfig.allow_non_loopback_bind` field.
  // When false/undefined the forward binds to 127.0.0.1 (loopback only) and the
  // backend rejects any non-loopback bind.
  allowNonLoopbackBind?: boolean;
  // Error message if any
  error?: string;
  // Actual local port (may differ from requested if auto-assigned)
  actualLocalPort?: number;
  // SSH session ID (for connected tunnels)
  sshSessionId?: string;
  // Port forward ID (for connected tunnels)
  portForwardId?: string;
  // Created timestamp
  createdAt: Date;
  updatedAt: Date;
}

export interface SSHTunnelCreateParams {
  name: string;
  sshConnectionId?: string;
  ownerDatabaseId?: string;
  host?: string;
  port?: number;
  username?: string;
  /** Write-only: undefined retains the existing standalone password. */
  password?: string;
  localPort?: number;
  // Remote host/port - required for local/remote, not used for dynamic
  remoteHost?: string;
  remotePort?: number;
  type?: "local" | "remote" | "dynamic";
  autoConnect?: boolean;
  // Opt in to binding the local forward to a non-loopback (public/LAN) interface.
  // Default off = loopback-only (127.0.0.1).
  allowNonLoopbackBind?: boolean;
}

interface PortForwardConfig {
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  direction: "Local" | "Remote" | "Dynamic";
  // Mirrors Rust serde field `allow_non_loopback_bind` (#[serde(default)] = false).
  allow_non_loopback_bind: boolean;
}

interface PersistedSSHTunnel {
  id: string;
  name: string;
  sshConnectionId?: string;
  ownerDatabaseId?: string;
  host?: string;
  port?: number;
  username?: string;
  credentialRef?: string;
  pendingCredentialRefs?: string[];
  pendingDeletion?: boolean;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
  type: "local" | "remote" | "dynamic";
  autoConnect: boolean;
  allowNonLoopbackBind?: boolean;
  createdAt: string;
  updatedAt: string;
}

const sanitizePersistedTunnels = (
  value: unknown,
): SanitizedValue<PersistedSSHTunnel[]> => {
  if (!Array.isArray(value))
    throw new Error("Stored SSH tunnels are corrupted");
  let changed = false;
  const tunnels = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Stored SSH tunnels contain an invalid entry");
    }
    const tunnel = item as Record<string, unknown>;
    if (
      typeof tunnel.id !== "string" ||
      typeof tunnel.name !== "string" ||
      (typeof tunnel.sshConnectionId !== "string" &&
        typeof tunnel.host !== "string") ||
      typeof tunnel.localPort !== "number" ||
      !["local", "remote", "dynamic"].includes(String(tunnel.type)) ||
      typeof tunnel.autoConnect !== "boolean" ||
      typeof tunnel.createdAt !== "string" ||
      !Number.isFinite(Date.parse(tunnel.createdAt)) ||
      (tunnel.updatedAt !== undefined &&
        (typeof tunnel.updatedAt !== "string" ||
          !Number.isFinite(Date.parse(tunnel.updatedAt)) ||
          Date.parse(tunnel.updatedAt) < Date.parse(tunnel.createdAt)))
    ) {
      throw new Error("Stored SSH tunnels contain invalid fields");
    }
    const createdAt = new Date(tunnel.createdAt).toISOString();
    const updatedAt = new Date(
      (tunnel.updatedAt as string | undefined) ?? createdAt,
    ).toISOString();
    changed ||=
      createdAt !== tunnel.createdAt ||
      updatedAt !== tunnel.updatedAt ||
      "status" in tunnel ||
      "error" in tunnel ||
      "actualLocalPort" in tunnel ||
      "sshSessionId" in tunnel ||
      "portForwardId" in tunnel ||
      "needsCleanup" in tunnel ||
      "password" in tunnel ||
      "privateKey" in tunnel ||
      "passphrase" in tunnel;
    return {
      id: tunnel.id,
      name: tunnel.name,
      sshConnectionId:
        typeof tunnel.sshConnectionId === "string"
          ? tunnel.sshConnectionId
          : undefined,
      ownerDatabaseId:
        typeof tunnel.ownerDatabaseId === "string"
          ? tunnel.ownerDatabaseId
          : undefined,
      host: typeof tunnel.host === "string" ? tunnel.host : undefined,
      port: typeof tunnel.port === "number" ? tunnel.port : undefined,
      username:
        typeof tunnel.username === "string" ? tunnel.username : undefined,
      credentialRef:
        typeof tunnel.credentialRef === "string" &&
        tunnel.credentialRef.startsWith(`${tunnel.id}:`)
          ? tunnel.credentialRef
          : undefined,
      localPort: tunnel.localPort,
      pendingDeletion: tunnel.pendingDeletion === true || undefined,
      pendingCredentialRefs: Array.isArray(tunnel.pendingCredentialRefs)
        ? tunnel.pendingCredentialRefs.filter(
            (ref): ref is string =>
              typeof ref === "string" && ref.startsWith(`${tunnel.id}:`),
          )
        : undefined,
      ...(typeof tunnel.remoteHost === "string"
        ? { remoteHost: tunnel.remoteHost }
        : {}),
      ...(typeof tunnel.remotePort === "number"
        ? { remotePort: tunnel.remotePort }
        : {}),
      type: tunnel.type as PersistedSSHTunnel["type"],
      autoConnect: tunnel.autoConnect,
      ...(typeof tunnel.allowNonLoopbackBind === "boolean"
        ? { allowNonLoopbackBind: tunnel.allowNonLoopbackBind }
        : {}),
      createdAt,
      updatedAt,
    };
  });
  return { value: tunnels, changed };
};

const tunnelStore = new AppDataJsonStore<PersistedSSHTunnel[]>({
  key: "ssh.tunnels",
  legacyLocalStorageKey: "ssh-tunnels",
  sanitize: sanitizePersistedTunnels,
});

class SSHTunnelService {
  private static instance: SSHTunnelService;
  private tunnels: Map<string, SSHTunnelConfig> = new Map();
  private listeners: Set<() => void> = new Set();
  private readonly loadPromise: Promise<void>;
  private mutationQueue: Promise<void> = Promise.resolve();
  private persistenceError: Error | null = null;
  private migrationWarning: string | null = null;
  private vpnOwners = new Map<string, string>();
  private deleting = new Set<string>();
  private attempts = new Map<
    string,
    { cancelled: boolean; done: Promise<void> }
  >();

  private constructor() {
    this.loadPromise = this.loadTunnels().catch((error) => {
      this.persistenceError =
        error instanceof Error ? error : new Error(String(error));
      this.notifyListeners();
    });
  }

  static getInstance(): SSHTunnelService {
    if (!SSHTunnelService.instance) {
      SSHTunnelService.instance = new SSHTunnelService();
    }
    return SSHTunnelService.instance;
  }

  private async loadTunnels(): Promise<void> {
    const result = await tunnelStore.load();
    for (const tunnel of result.value ?? []) {
      this.tunnels.set(tunnel.id, {
        ...tunnel,
        status: "disconnected",
        createdAt: new Date(tunnel.createdAt),
        updatedAt: new Date(tunnel.updatedAt),
      });
    }
    if (result.sanitized) {
      this.migrationWarning =
        "SSH tunnel data was normalized: timestamps were migrated and any runtime state or secret-bearing fields were removed.";
    }
    this.notifyListeners();
  }

  private async ensureLoaded(): Promise<void> {
    await this.loadPromise;
    if (this.persistenceError) throw this.persistenceError;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async saveTunnels(
    tunnels: Map<string, SSHTunnelConfig>,
  ): Promise<void> {
    const data: PersistedSSHTunnel[] = Array.from(tunnels.values()).map(
      (tunnel) => ({
        id: tunnel.id,
        name: tunnel.name,
        sshConnectionId: tunnel.sshConnectionId,
        ownerDatabaseId: tunnel.ownerDatabaseId,
        host: tunnel.host,
        port: tunnel.port,
        username: tunnel.username,
        credentialRef: tunnel.credentialRef,
        pendingCredentialRefs: tunnel.pendingCredentialRefs,
        pendingDeletion: tunnel.pendingDeletion,
        localPort: tunnel.localPort,
        remoteHost: tunnel.remoteHost,
        remotePort: tunnel.remotePort,
        type: tunnel.type,
        autoConnect: tunnel.autoConnect,
        allowNonLoopbackBind: tunnel.allowNonLoopbackBind,
        createdAt: tunnel.createdAt.toISOString(),
        updatedAt: tunnel.updatedAt.toISOString(),
      }),
    );
    await tunnelStore.save(data);
  }

  getPersistenceError(): string | null {
    return this.persistenceError?.message ?? null;
  }

  async ready(): Promise<void> {
    await this.ensureLoaded();
  }

  getMigrationWarning(): string | null {
    return this.migrationWarning;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getTunnels(): SSHTunnelConfig[] {
    return Array.from(this.tunnels.values());
  }

  getTunnel(id: string): SSHTunnelConfig | undefined {
    return this.tunnels.get(id);
  }

  getTunnelsByConnection(connectionId: string): SSHTunnelConfig[] {
    return Array.from(this.tunnels.values()).filter(
      (t) => t.sshConnectionId === connectionId,
    );
  }

  async createTunnel(params: SSHTunnelCreateParams): Promise<SSHTunnelConfig> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded();
      const id = `tunnel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date();

      const tunnel: SSHTunnelConfig = {
        id,
        name: params.name,
        sshConnectionId: params.sshConnectionId,
        ownerDatabaseId: params.sshConnectionId
          ? params.ownerDatabaseId
          : undefined,
        host: params.sshConnectionId ? undefined : params.host?.trim(),
        port: params.sshConnectionId ? undefined : (params.port ?? 22),
        username: params.sshConnectionId ? undefined : params.username?.trim(),
        localPort: params.localPort || 0,
        remoteHost: params.remoteHost,
        remotePort: params.remotePort,
        type: params.type || "local",
        status: "disconnected",
        autoConnect: params.autoConnect ?? false,
        allowNonLoopbackBind: params.allowNonLoopbackBind ?? false,
        createdAt: now,
        updatedAt: now,
      };

      this.validateTunnel(tunnel);
      if (!tunnel.sshConnectionId) {
        if (!params.password)
          throw new Error("Enter a password for the standalone SSH tunnel.");
        tunnel.credentialRef = await writeTunnelPassword(
          id,
          this.endpoint(tunnel),
          params.password,
        );
      }

      const next = new Map(this.tunnels);
      next.set(id, tunnel);
      try {
        await this.saveTunnels(next);
      } catch (error) {
        await this.rollbackCredential(tunnel, tunnel.credentialRef, true);
        throw error;
      }
      this.tunnels = next;
      this.notifyListeners();
      return tunnel;
    });
  }

  async updateTunnel(
    id: string,
    updates: Partial<SSHTunnelCreateParams>,
  ): Promise<SSHTunnelConfig | null> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded();
      const tunnel = this.tunnels.get(id);
      if (!tunnel) return null;
      if (tunnel.pendingDeletion)
        throw new Error(
          "SSH tunnel deletion is pending. Retry deleting it before creating a replacement.",
        );
      if (tunnel.status === "connecting")
        throw new Error(
          "Wait for the SSH tunnel connection attempt before editing it.",
        );

      // If tunnel is connected, disconnect first
      if (tunnel.sshSessionId || this.vpnOwners.has(id)) {
        await this.disconnectTunnel(id);
      }

      const updated: SSHTunnelConfig = {
        ...tunnel,
        name: updates.name ?? tunnel.name,
        sshConnectionId: updates.sshConnectionId ?? tunnel.sshConnectionId,
        ownerDatabaseId: updates.ownerDatabaseId ?? tunnel.ownerDatabaseId,
        host: updates.host?.trim() ?? tunnel.host,
        port: updates.port ?? tunnel.port ?? 22,
        username: updates.username?.trim() ?? tunnel.username,
        localPort: updates.localPort ?? tunnel.localPort,
        remoteHost: updates.remoteHost ?? tunnel.remoteHost,
        remotePort: updates.remotePort ?? tunnel.remotePort,
        type: updates.type ?? tunnel.type,
        autoConnect: updates.autoConnect ?? tunnel.autoConnect,
        allowNonLoopbackBind:
          updates.allowNonLoopbackBind ?? tunnel.allowNonLoopbackBind,
      };
      this.validateTunnel(updated);
      if (updated.sshConnectionId) {
        updated.host = undefined;
        updated.port = undefined;
        updated.username = undefined;
        updated.credentialRef = undefined;
      } else {
        updated.ownerDatabaseId = undefined;
        if (updates.password !== undefined) {
          if (!updates.password)
            throw new Error("Enter a non-empty SSH tunnel password.");
          updated.credentialRef = await writeTunnelPassword(
            id,
            this.endpoint(updated),
            updates.password,
          );
        } else {
          // Also verifies that destination/user edits did not silently redirect a retained secret.
          await readTunnelPassword(
            id,
            updated.credentialRef,
            this.endpoint(updated),
          );
        }
      }

      const next = new Map(this.tunnels);
      next.set(id, updated);
      if (
        updated.credentialRef !== tunnel.credentialRef &&
        tunnel.credentialRef
      )
        updated.pendingCredentialRefs = [
          ...(tunnel.pendingCredentialRefs ?? []),
          tunnel.credentialRef,
        ];
      if (JSON.stringify(updated) !== JSON.stringify(tunnel))
        updated.updatedAt = new Date(
          Math.max(Date.now(), tunnel.updatedAt.getTime() + 1),
        );
      try {
        await this.saveTunnels(next);
      } catch (error) {
        if (updated.credentialRef !== tunnel.credentialRef)
          await this.rollbackCredential(tunnel, updated.credentialRef, false);
        throw error;
      }
      this.tunnels = next;
      this.notifyListeners();
      await this.cleanupRetiredCredentials(updated);
      return updated;
    });
  }

  async deleteTunnel(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded();
      const tunnel = this.tunnels.get(id);
      if (!tunnel) return false;
      if (tunnel.status === "connecting")
        throw new Error(
          "Wait for the SSH tunnel connection attempt before deleting it.",
        );

      this.deleting.add(id);
      try {
        // Disconnect if connected
        if (tunnel.sshSessionId || this.vpnOwners.has(id)) {
          await this.disconnectTunnel(id);
        }

        // Commit intent before touching secrets. A failed final save leaves a
        // durable, non-connectable record whose cleanup can safely be retried.
        const deleting = {
          ...tunnel,
          pendingDeletion: true,
          updatedAt: tunnel.pendingDeletion
            ? tunnel.updatedAt
            : new Date(Math.max(Date.now(), tunnel.updatedAt.getTime() + 1)),
        };
        const marked = new Map(this.tunnels);
        marked.set(id, deleting);
        await this.saveTunnels(marked);
        this.tunnels = marked;
        this.notifyListeners();
        await this.cleanupRetiredCredentials(deleting);
        await this.deleteCredential(id, deleting.credentialRef);
        const next = new Map(this.tunnels);
        next.delete(id);
        await this.saveTunnels(next);
        this.tunnels = next;
        this.notifyListeners();
        return true;
      } finally {
        this.deleting.delete(id);
      }
    });
  }

  async connectTunnel(
    id: string,
    sshConnection?: Connection,
    options: TunnelRuntimeOptions = {},
  ): Promise<SSHTunnelConfig> {
    await this.ensureLoaded();
    const tunnel = this.tunnels.get(id);
    if (!tunnel) {
      throw new Error(`Tunnel ${id} not found`);
    }
    if (tunnel.pendingDeletion || this.deleting.has(id))
      throw new Error(
        "SSH tunnel deletion is pending. Retry deleting it before connecting.",
      );
    if (tunnel.status === "connected") return tunnel;
    if (
      tunnel.status === "connecting" ||
      tunnel.sshSessionId ||
      this.vpnOwners.has(id)
    ) {
      throw new Error(
        "This tunnel is connecting or needs cleanup. Disconnect it before retrying.",
      );
    }

    // Update status to connecting
    tunnel.status = "connecting";
    tunnel.error = undefined;
    this.tunnels.set(id, tunnel);
    this.notifyListeners();

    const secrets: string[] = [];
    let unlistenTrust: (() => void) | undefined;
    let finishAttempt!: () => void;
    const attempt = {
      cancelled: false,
      done: new Promise<void>((resolve) => {
        finishAttempt = resolve;
      }),
    };
    this.attempts.set(id, attempt);
    const assertCurrent = () => {
      if (attempt.cancelled)
        throw new Error("SSH tunnel connection cancelled.");
      options.assertCurrent?.();
    };
    try {
      this.validateTunnel(tunnel);
      if (tunnel.sshConnectionId) {
        if (
          !sshConnection ||
          sshConnection.id !== tunnel.sshConnectionId ||
          sshConnection.protocol !== "ssh" ||
          sshConnection.isGroup
        )
          throw new Error(
            "The saved SSH base is unavailable. Open its owning database and select the connection again.",
          );
      } else {
        const endpoint = this.endpoint(tunnel);
        const password = await readTunnelPassword(
          id,
          tunnel.credentialRef,
          endpoint,
        );
        sshConnection = {
          id,
          name: tunnel.name,
          protocol: "ssh",
          hostname: endpoint.host,
          port: endpoint.port,
          username: endpoint.username,
          password,
          authType: "password",
        } as Connection;
      }
      if (!sshConnection) throw new Error("Select an SSH base connection.");
      assertCurrent();
      const vaultSource =
        normalizeConnectionCredentialSource(sshConnection.credentialSource)
          ?.kind === "vault";
      if (vaultSource && !options.vault)
        throw new Error(
          "Resolve the saved SSH base from its unlocked database vault before connecting. No local credential fallback was used.",
        );
      const auth = vaultSource ? options.vault!.facets : sshConnection;
      const username = auth.username ?? "";
      const password = auth.password ?? null;
      const privateKey = auth.privateKey ?? null;
      const passphrase = auth.passphrase ?? null;
      const totpId =
        vaultSource && sshConnection.credentialSource?.kind === "vault"
          ? sshConnection.credentialSource.totpId
          : undefined;
      const totp = totpId
        ? options.vault?.facets.totp?.find((t) => t.id === totpId)
        : undefined;
      const totpSecret = vaultSource ? totp?.secret : sshConnection.totpSecret;
      secrets.push(
        ...[password, privateKey, passphrase, totpSecret].filter(
          (s): s is string => typeof s === "string",
        ),
      );
      const authType =
        sshConnection.authType ?? (privateKey ? "key" : "password");
      if (!["password", "key", "totp"].includes(authType))
        throw new Error(
          "This SSH tunnel authentication mode is unsupported. Select password, key or TOTP on the saved base.",
        );
      if (
        !username ||
        (authType === "key" ? !privateKey : !password) ||
        (authType === "totp" && !totpSecret)
      )
        throw new Error(
          "The SSH base is missing its required username or authentication material. Edit and save its credentials before retrying.",
        );
      const path = await resolveRuntimeNetworkPath(
        sshConnection,
        options.connections ?? [sshConnection],
        "ssh",
        options.networkPathContext,
      );
      secrets.push(...path.redactionSecrets);
      assertCurrent();
      options.vault?.assertCurrent();
      if (path.transport.vpnPreSteps.length) {
        const owner = createVpnLeaseAttemptOwnerId(id, "ssh");
        this.vpnOwners.set(id, owner);
        await acquireSessionVpnLeases(owner, path.transport.vpnPreSteps);
      }
      // Get SSH connection overrides from the connection
      const settings = SettingsManager.getInstance().getSettings();
      const override = mergeSSHConnectionConfig(
        settings.sshConnection ?? defaultSSHConnectionConfig,
        sshConnection.sshConnectionConfigOverride,
      );
      const trust = resolveEffectiveTrustPolicy(
        sshConnection.sshTrustPolicy,
        settings.sshTrustPolicy,
        settings.trustPolicy,
      );
      // The tunnel manager has no interactive ProxyCommand review surface.
      if (override.proxyCommand || override.proxyCommandTemplate)
        throw new Error(
          "This SSH base uses ProxyCommand. Configure a supported proxy/jump-host network path before using it as a tunnel base.",
        );
      if (override.enableJumpHost || override.mixedChain?.hops.length)
        throw new Error(
          "This SSH base uses legacy SSH transport overrides. Move its jump hosts or mixed chain into the connection's network path before opening a tunnel; the configured route was not bypassed.",
        );
      assertCurrent();
      options.vault?.assertCurrent();

      unlistenTrust = await listenForTunnelTrust(
        sshConnection.hostname,
        sshConnection.port || 22,
        username,
        tunnel.sshConnectionId,
        trust,
        () => {
          assertCurrent();
          options.vault?.assertCurrent();
        },
      );
      assertCurrent();
      options.vault?.assertCurrent();

      // First, connect to the SSH server
      path.assertCurrent?.();
      const sessionId = await invoke<string>("connect_ssh", {
        config: buildSshTunnelNativeConfig(
          {
            host: sshConnection.hostname,
            port: sshConnection.port || 22,
            username,
            allow_agent_auth: false,
            password: authType === "key" && !vaultSource ? null : password,
            private_key_path:
              authType === "key" && !vaultSource ? privateKey : null,
            private_key_content:
              authType === "key" && vaultSource ? privateKey : null,
            private_key_passphrase: authType === "key" ? passphrase : null,
            totp_secret: totpSecret ?? null,
            totp_options: totp
              ? {
                  algorithm: totp.algorithm,
                  digits: totp.digits,
                  period: totp.period,
                }
              : null,
            agent_forwarding: override.agentForwarding,
          },
          path.transport,
          {
            sshConfig: {
              ...override,
              connectTimeout:
                override.connectTimeout ?? sshConnection.sshConnectTimeout,
              keepAliveInterval:
                override.keepAliveInterval ??
                sshConnection.sshKeepAliveInterval,
              knownHostsPath:
                override.knownHostsPath ?? sshConnection.sshKnownHostsPath,
            },
            trustPolicy: trust,
            ignoreSshSecurityErrors: sshConnection.ignoreSshSecurityErrors,
          },
        ),
      });
      tunnel.sshSessionId = sessionId;
      assertCurrent();
      options.vault?.assertCurrent();

      // Determine the local port (use requested or find available)
      const localPort = tunnel.localPort || (await this.findAvailablePort());

      if (
        tunnel.type !== "dynamic" &&
        (!tunnel.remoteHost || !tunnel.remotePort)
      ) {
        throw new Error(
          "Remote host and port are required for non-dynamic tunnels",
        );
      }

      // Set up port forwarding.
      // The local forward binds to loopback (127.0.0.1) by default. Binding to
      // 0.0.0.0 (all interfaces) is only requested when the user has explicitly
      // opted in via allowNonLoopbackBind; the backend rejects any non-loopback
      // bind unless allow_non_loopback_bind is true.
      const allowNonLoopback = tunnel.allowNonLoopbackBind ?? false;
      const portForwardConfig: PortForwardConfig = {
        local_host: allowNonLoopback ? "0.0.0.0" : "127.0.0.1",
        local_port: localPort,
        remote_host:
          tunnel.type === "dynamic" ? "127.0.0.1" : tunnel.remoteHost!,
        remote_port: tunnel.type === "dynamic" ? 0 : tunnel.remotePort!,
        direction:
          tunnel.type === "local"
            ? "Local"
            : tunnel.type === "remote"
              ? "Remote"
              : "Dynamic",
        allow_non_loopback_bind: allowNonLoopback,
      };

      const portForwardId = await invoke<string>("setup_port_forward", {
        sessionId,
        config: portForwardConfig,
      });
      assertCurrent();
      options.vault?.assertCurrent();

      tunnel.status = "connected";
      tunnel.actualLocalPort = localPort;
      tunnel.sshSessionId = sessionId;
      tunnel.portForwardId = portForwardId;
      tunnel.error = undefined;
      this.tunnels.set(id, tunnel);
      this.notifyListeners();

      return tunnel;
    } catch (error) {
      let cleanupFailed = false;
      try {
        await this.cleanupTransport(tunnel);
      } catch {
        cleanupFailed = true;
      }
      tunnel.status = "error";
      tunnel.needsCleanup = cleanupFailed;
      tunnel.error =
        redactSecrets(
          error instanceof Error ? error.message : String(error),
          secrets,
        ) +
        (cleanupFailed
          ? " Tunnel cleanup is pending; disconnect before retrying."
          : "");
      this.tunnels.set(id, tunnel);
      this.notifyListeners();
      throw new Error(tunnel.error);
    } finally {
      unlistenTrust?.();
      if (options.vault) options.vault.facets = {};
      this.attempts.delete(id);
      finishAttempt();
    }
  }

  async disconnectTunnel(id: string): Promise<void> {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return;
    const attempt = this.attempts.get(id);
    if (attempt) {
      attempt.cancelled = true;
      await attempt.done;
    }

    try {
      await this.cleanupTransport(tunnel);
    } catch {
      tunnel.status = "error";
      tunnel.needsCleanup = true;
      tunnel.error =
        "Could not close the SSH tunnel or release its VPN lease. Retry disconnecting.";
      this.notifyListeners();
      throw new Error(tunnel.error);
    }

    tunnel.status = "disconnected";
    tunnel.needsCleanup = false;
    tunnel.actualLocalPort = undefined;
    tunnel.sshSessionId = undefined;
    tunnel.portForwardId = undefined;
    tunnel.error = undefined;
    this.tunnels.set(id, tunnel);
    this.notifyListeners();
  }

  private endpoint(tunnel: SSHTunnelConfig) {
    return {
      host: tunnel.host ?? "",
      port: tunnel.port ?? 22,
      username: tunnel.username ?? "",
    };
  }

  private async cleanupRetiredCredentials(
    tunnel: SSHTunnelConfig,
  ): Promise<void> {
    for (const reference of [...(tunnel.pendingCredentialRefs ?? [])]) {
      await this.deleteCredential(tunnel.id, reference);
      tunnel.pendingCredentialRefs = tunnel.pendingCredentialRefs!.filter(
        (ref) => ref !== reference,
      );
      tunnel.updatedAt = new Date(
        Math.max(Date.now(), tunnel.updatedAt.getTime() + 1),
      );
      await this.saveTunnels(this.tunnels);
    }
  }

  private async rollbackCredential(
    original: SSHTunnelConfig,
    reference: string | undefined,
    creating: boolean,
  ): Promise<void> {
    if (!reference) return;
    try {
      await this.deleteCredential(original.id, reference);
    } catch {
      // Preserve the old active credential on updates. Failed creates become
      // deletion-only records, never silently successful, connectable tunnels.
      const recovery = {
        ...original,
        updatedAt: new Date(
          Math.max(Date.now(), original.updatedAt.getTime() + 1),
        ),
        credentialRef: creating ? undefined : original.credentialRef,
        pendingDeletion: creating || original.pendingDeletion,
        pendingCredentialRefs: [
          ...new Set([...(original.pendingCredentialRefs ?? []), reference]),
        ],
      };
      this.tunnels.set(original.id, recovery);
      this.notifyListeners();
      try {
        await this.saveTunnels(this.tunnels);
      } catch {
        // Both stores failed: retain the reference in memory and expose only
        // the opaque account id needed for manual recovery, never the secret.
        throw new Error(
          `SSH tunnel credential cleanup is pending and could not be saved. Keep the app open and retry deleting or saving the tunnel. OS vault account: sortofremoteng.ssh-tunnels / ${reference}`,
        );
      }
      throw new Error(
        "SSH tunnel credential cleanup is pending. Its recovery reference was saved; retry deleting or saving the tunnel after unlocking the OS vault.",
      );
    }
  }

  private async deleteCredential(
    id: string,
    reference?: string,
  ): Promise<void> {
    try {
      await deleteTunnelPassword(id, reference);
    } catch (failure) {
      if (reference?.startsWith(`${id}:`)) {
        // Windows/macOS deletion need not be idempotent. Confirm absence via
        // the read API's native VaultError kind, never by interpreting generic
        // deletion failures (which may mean a locked or denied vault).
        try {
          await SecureStorage.vaultReadSecret(
            "sortofremoteng.ssh-tunnels",
            reference,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : error;
          if (typeof message === "string" && message.startsWith("[NotFound] "))
            return;
        }
      }
      throw failure;
    }
  }

  private validateTunnel(tunnel: SSHTunnelConfig): void {
    const port = (n: number | undefined, min = 1) =>
      Number.isInteger(n) && n! >= min && n! <= 65535;
    if (!tunnel.name.trim() || !port(tunnel.localPort, 0))
      throw new Error(
        "Enter a tunnel name and a local port between 0 and 65535.",
      );
    if (!["local", "remote", "dynamic"].includes(tunnel.type))
      throw new Error("Select a valid SSH tunnel type.");
    if (
      tunnel.type !== "dynamic" &&
      (!tunnel.remoteHost?.trim() || !port(tunnel.remotePort))
    )
      throw new Error("Enter a destination host and port between 1 and 65535.");
    if (
      !tunnel.sshConnectionId &&
      (!tunnel.host?.trim() || !tunnel.username?.trim() || !port(tunnel.port))
    )
      throw new Error(
        "Select a saved SSH connection or enter a standalone SSH host, port and username.",
      );
  }

  private async cleanupTransport(tunnel: SSHTunnelConfig): Promise<void> {
    if (tunnel.sshSessionId) {
      await invoke("disconnect_ssh", { sessionId: tunnel.sshSessionId });
      tunnel.sshSessionId = undefined;
      tunnel.portForwardId = undefined;
      tunnel.actualLocalPort = undefined;
    }
    const owner = this.vpnOwners.get(tunnel.id);
    if (owner) {
      const result = await releaseSessionVpnLeases(owner);
      if (result.errors.length) throw new Error("VPN cleanup pending");
      this.vpnOwners.delete(tunnel.id);
    }
  }

  private async findAvailablePort(): Promise<number> {
    // Use a simple approach: try ports starting from 10000
    // The actual binding will happen in the Rust backend
    // This is just a fallback - ideally the backend returns the actual port
    return 10000 + Math.floor(Math.random() * 50000);
  }

  async disconnectAllTunnels(): Promise<void> {
    let failed = false;
    for (const tunnel of this.tunnels.values()) {
      if (
        this.attempts.has(tunnel.id) ||
        tunnel.sshSessionId ||
        this.vpnOwners.has(tunnel.id)
      ) {
        try {
          await this.disconnectTunnel(tunnel.id);
        } catch {
          failed = true;
        }
      }
    }
    if (failed)
      throw new Error(
        "Some SSH tunnels could not be disconnected. Retry their Disconnect actions in the tunnel manager.",
      );
  }

  // Get available tunnels that can be used for a target connection
  getAvailableTunnelsForConnection(targetProtocol: string): SSHTunnelConfig[] {
    return Array.from(this.tunnels.values()).filter(
      (t) => t.status === "connected",
    );
  }

  // Check if a tunnel is using a specific SSH connection
  isTunnelUsingSshConnection(tunnelId: string, connectionId: string): boolean {
    const tunnel = this.tunnels.get(tunnelId);
    return tunnel?.sshConnectionId === connectionId;
  }
}

export const sshTunnelService = SSHTunnelService.getInstance();
export default sshTunnelService;
