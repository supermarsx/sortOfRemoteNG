import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// ─── Types ─────────────────────────────────────────────────────────

export interface AgentStatus {
  running: boolean;
  locked: boolean;
  loaded_keys: number;
  system_agent_connected: boolean;
  socket_path: string;
  forwarding_sessions: number;
  started_at: string | null;
}

export interface AgentConfig {
  socket_path: string;
  listen_tcp: boolean;
  tcp_address: string;
  auto_connect_system_agent: boolean;
  system_agent_socket: string;
  system_agent_cache_ttl: number;
  auto_load_default_keys: boolean;
  default_key_paths: string[];
  key_passphrase_prompt: boolean;
  max_loaded_keys: number;
  default_key_lifetime: number;
  confirm_before_use: boolean;
  max_sign_operations: number;
  lock_on_idle: boolean;
  idle_lock_timeout: number;
  auto_remove_expired: boolean;
  persist_keys: boolean;
  persistence_path: string;
  encrypt_persistence: boolean;
  allow_forwarding: boolean;
  max_forwarding_depth: number;
  forwarding_allowed_hosts: string[];
  forwarding_denied_hosts: string[];
  audit_enabled: boolean;
  audit_file: string;
  audit_max_entries: number;
  pkcs11_providers: string[];
  pkcs11_auto_load: boolean;
}

export interface AgentKey {
  id: string;
  comment: string;
  algorithm: string;
  bits: number;
  fingerprint_sha256: string;
  fingerprint_md5: string;
  public_key_blob: number[];
  public_key_openssh: string;
  source: string;
  constraints: KeyConstraint[];
  certificate: CertificateInfo | null;
  added_at: string;
  last_used_at: string | null;
  sign_count: number;
  metadata: Record<string, string>;
}

export type KeyConstraint =
  | { Lifetime: number }
  | "ConfirmBeforeUse"
  | { MaxSignatures: number }
  | { HostRestriction: string[] }
  | { UserRestriction: string[] }
  | { ForwardingDepth: number }
  | { Extension: { name: string; data: number[] } };

export interface CertificateInfo {
  serial: number;
  cert_type: "User" | "Host";
  key_id: string;
  valid_principals: string[];
  valid_after: string;
  valid_before: string;
  critical_options: Record<string, string>;
  extensions: Record<string, string>;
  ca_fingerprint: string;
}

export interface ForwardingSession {
  id: string;
  remote_host: string;
  remote_user: string;
  started_at: string;
  depth: number;
  active: boolean;
  key_filter: string;
  sign_count: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  key_fingerprint: string | null;
  client_info: string | null;
  success: boolean;
  details: string;
}

export type SshAgentTab =
  | "overview"
  | "keys"
  | "system-agent"
  | "forwarding"
  | "config"
  | "audit";

// ─── Tauri runtime check ──────────────────────────────────────────

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
    )
  );
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useSSHAgentManager(isOpen: boolean) {
  // ── State ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SshAgentTab>("overview");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);

  // Keys
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);

  // Forwarding
  const [forwardingSessions, setForwardingSessions] = useState<
    ForwardingSession[]
  >([]);

  // System agent
  const [systemAgentPath, setSystemAgentPath] = useState<string>("");
  const [discoveredPath, setDiscoveredPath] = useState<string | null>(null);

  // Audit
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Lock
  const [lockPassphrase, setLockPassphrase] = useState("");

  // ── Data Loaders ───────────────────────────────────────

  const loadStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const s = await invoke<AgentStatus>("ssh_agent_get_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to load SSH agent status:", e);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const c = await invoke<AgentConfig>("ssh_agent_get_config");
      setConfig(c);
    } catch (e) {
      console.error("Failed to load SSH agent config:", e);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    if (!isTauri()) return;
    setIsLoadingKeys(true);
    try {
      const k = await invoke<AgentKey[]>("ssh_agent_list_keys");
      setKeys(k);
    } catch (e) {
      console.error("Failed to list keys:", e);
    } finally {
      setIsLoadingKeys(false);
    }
  }, []);

  const loadForwarding = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const f = await invoke<ForwardingSession[]>(
        "ssh_agent_list_forwarding",
      );
      setForwardingSessions(f);
    } catch (e) {
      console.error("Failed to list forwarding sessions:", e);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    if (!isTauri()) return;
    setIsLoadingAudit(true);
    try {
      const entries = await invoke<AuditEntry[]>("ssh_agent_audit_log", {
        count: 200,
      });
      setAuditLog(entries);
    } catch (e) {
      console.error("Failed to load audit log:", e);
    } finally {
      setIsLoadingAudit(false);
    }
  }, []);

  // ── Actions ────────────────────────────────────────────

  const startAgent = useCallback(async () => {
    if (!isTauri()) return;
    setIsLoading(true);
    setError(null);
    try {
      await invoke("ssh_agent_start");
      await loadStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to start agent");
    } finally {
      setIsLoading(false);
    }
  }, [loadStatus]);

  const stopAgent = useCallback(async () => {
    if (!isTauri()) return;
    setIsLoading(true);
    setError(null);
    try {
      await invoke("ssh_agent_stop");
      await loadStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to stop agent");
    } finally {
      setIsLoading(false);
    }
  }, [loadStatus]);

  const restartAgent = useCallback(async () => {
    if (!isTauri()) return;
    setIsLoading(true);
    setError(null);
    try {
      await invoke("ssh_agent_restart");
      await loadStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to restart agent");
    } finally {
      setIsLoading(false);
    }
  }, [loadStatus]);

  const removeKey = useCallback(
    async (keyId: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("ssh_agent_remove_key", { keyId });
        await loadKeys();
        await loadStatus();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to remove key");
      }
    },
    [loadKeys, loadStatus],
  );

  const removeAllKeys = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      await invoke("ssh_agent_remove_all_keys");
      await loadKeys();
      await loadStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to remove all keys");
    }
  }, [loadKeys, loadStatus]);

  const lockAgent = useCallback(
    async (passphrase: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("ssh_agent_lock", { passphrase });
        await loadStatus();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to lock agent");
      }
    },
    [loadStatus],
  );

  const unlockAgent = useCallback(
    async (passphrase: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("ssh_agent_unlock", { passphrase });
        await loadStatus();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to unlock agent");
      }
    },
    [loadStatus],
  );

  const connectSystemAgent = useCallback(async () => {
    if (!isTauri()) return;
    setIsLoading(true);
    setError(null);
    try {
      await invoke("ssh_agent_connect_system");
      await loadStatus();
      await loadKeys();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to connect to system agent");
    } finally {
      setIsLoading(false);
    }
  }, [loadStatus, loadKeys]);

  const disconnectSystemAgent = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      await invoke("ssh_agent_disconnect_system");
      await loadStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to disconnect system agent");
    }
  }, [loadStatus]);

  const discoverSystemAgent = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const path = await invoke<string | null>(
        "ssh_agent_discover_system",
      );
      setDiscoveredPath(path);
      if (path) setSystemAgentPath(path);
    } catch (e) {
      console.error("Failed to discover system agent:", e);
    }
  }, []);

  const setSystemPath = useCallback(
    async (path: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("ssh_agent_set_system_path", { path });
        setSystemAgentPath(path);
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to set system agent path");
      }
    },
    [],
  );

  const updateConfig = useCallback(
    async (newConfig: AgentConfig) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("ssh_agent_update_config", { config: newConfig });
        setConfig(newConfig);
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to update config");
      }
    },
    [],
  );

  const stopForwarding = useCallback(
    async (sessionId: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("ssh_agent_stop_forwarding", { sessionId });
        await loadForwarding();
        await loadStatus();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to stop forwarding");
      }
    },
    [loadForwarding, loadStatus],
  );

  const exportAudit = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      return await invoke<string>("ssh_agent_export_audit");
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to export audit");
      return null;
    }
  }, []);

  const clearAudit = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("ssh_agent_clear_audit");
      setAuditLog([]);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to clear audit");
    }
  }, []);

  const runMaintenance = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("ssh_agent_run_maintenance");
      await loadStatus();
      await loadKeys();
    } catch (e: any) {
      setError(e?.toString() ?? "Maintenance failed");
    }
  }, [loadStatus, loadKeys]);

  // ── Auto-load on open ──────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      loadStatus();
      loadConfig();
      discoverSystemAgent();
    }
  }, [isOpen, loadStatus, loadConfig, discoverSystemAgent]);

  useEffect(() => {
    if (isOpen && activeTab === "keys") {
      loadKeys();
    }
  }, [isOpen, activeTab, loadKeys]);

  useEffect(() => {
    if (isOpen && activeTab === "forwarding") {
      loadForwarding();
    }
  }, [isOpen, activeTab, loadForwarding]);

  useEffect(() => {
    if (isOpen && activeTab === "audit") {
      loadAudit();
    }
  }, [isOpen, activeTab, loadAudit]);

  // ── Return ─────────────────────────────────────────────

  return {
    // Navigation
    activeTab,
    setActiveTab,

    // Status
    isLoading,
    error,
    setError,
    status,
    config,

    // Keys
    keys,
    isLoadingKeys,
    loadKeys,
    removeKey,
    removeAllKeys,

    // Lock
    lockPassphrase,
    setLockPassphrase,
    lockAgent,
    unlockAgent,

    // System agent
    systemAgentPath,
    setSystemAgentPath,
    discoveredPath,
    connectSystemAgent,
    disconnectSystemAgent,
    discoverSystemAgent,
    setSystemPath,

    // Forwarding
    forwardingSessions,
    stopForwarding,

    // Config
    updateConfig,

    // Audit
    auditLog,
    isLoadingAudit,
    loadAudit,
    exportAudit,
    clearAudit,

    // Maintenance
    runMaintenance,

    // Actions
    startAgent,
    stopAgent,
    restartAgent,

    // Data loaders
    loadStatus,
    loadConfig,
  };
}
