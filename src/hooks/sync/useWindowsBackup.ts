import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";

// ─── Types ─────────────────────────────────────────────────────────

export interface ShadowCopy {
  id: string;
  shadowId: string;
  volumeName: string;
  installDate: string | null;
  state: "stable" | "creating" | "deleting" | "unknown";
  providerId: string | null;
  count: number;
  clientAccessible: boolean;
  persistent: boolean;
  noAutoRelease: boolean;
  noWriters: boolean;
  originatingMachine: string | null;
  serviceMachine: string | null;
  exposedName: string | null;
  exposedPath: string | null;
}

export interface ShadowStorage {
  volume: string;
  diffVolume: string;
  usedSpace: number;
  allocatedSpace: number;
  maxSpace: number;
}

export interface BackupStatus {
  isRunning: boolean;
  currentOperation: string | null;
  progressPercent: number | null;
  lastSuccessfulBackup: string | null;
  lastFailedBackup: string | null;
  nextScheduledBackup: string | null;
  rawOutput: string;
}

export interface BackupVersion {
  versionId: string;
  backupTime: string | null;
  backupLocation: string | null;
  versionInfo: string | null;
  canRecover: boolean;
}

export interface BackupPolicy {
  configured: boolean;
  schedule: string | null;
  backupTarget: string | null;
  includedVolumes: string[];
  systemStateBackup: boolean;
  bareMetalRecovery: boolean;
  rawOutput: string;
}

export interface BackupItem {
  name: string;
  itemType: "volume" | "file" | "systemState";
  size: number | null;
}

export interface BackupVolume {
  name: string;
  driveLetter: string | null;
  label: string | null;
  capacity: number;
  freeSpace: number;
  fileSystem: string | null;
  driveType: number;
  deviceId: string;
}

export interface BackupJobInfo {
  success: boolean;
  error: string | null;
  rawOutput: string;
}

export type BackupTab =
  | "overview"
  | "shadowCopies"
  | "versions"
  | "policy"
  | "volumes";

// ─── Hook ──────────────────────────────────────────────────────────

export function useWindowsBackup(isOpen: boolean) {
  const { state } = useConnections();

  // WMI sessions are identifiable by the "winmgmt:" prefix or similar.
  // For now, we track a sessionId the user manually enters/selects.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hostname, setHostname] = useState("");

  // ── Tab state ──────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<BackupTab>("overview");

  // ── Data state ─────────────────────────────────────────
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [shadowCopies, setShadowCopies] = useState<ShadowCopy[]>([]);
  const [shadowStorage, setShadowStorage] = useState<ShadowStorage[]>([]);
  const [versions, setVersions] = useState<BackupVersion[]>([]);
  const [policy, setPolicy] = useState<BackupPolicy | null>(null);
  const [backupItems, setBackupItems] = useState<BackupItem[]>([]);
  const [volumes, setVolumes] = useState<BackupVolume[]>([]);

  // ── UI state ───────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(0);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isTauri = useMemo(() => {
    return (
      typeof window !== "undefined" &&
      Boolean(
        (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
      )
    );
  }, []);

  // ── Helpers ────────────────────────────────────────────

  const invokeCmd = useCallback(
    async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      if (!isTauri) throw new Error("Windows Backup requires the Tauri runtime.");
      if (!sessionId) throw new Error("No WMI session connected.");
      return invoke<T>(cmd, { sessionId, ...args });
    },
    [isTauri, sessionId],
  );

  // ── Connect ────────────────────────────────────────────

  const connect = useCallback(
    async (host: string, username?: string, password?: string) => {
      if (!isTauri) {
        setError("Windows Backup requires the Tauri runtime.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const config: Record<string, unknown> = { computerName: host };
        if (username && password) {
          config.credential = { username, password };
        }
        const id = await invoke<string>("winmgmt_connect", { config });
        setSessionId(id);
        setHostname(host);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [isTauri],
  );

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    try {
      await invoke("winmgmt_disconnect", { sessionId });
    } catch {
      // ignore
    }
    setSessionId(null);
    setHostname("");
    setStatus(null);
    setShadowCopies([]);
    setVersions([]);
    setPolicy(null);
    setVolumes([]);
  }, [sessionId]);

  // ── Fetch functions ────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const s = await invokeCmd<BackupStatus>("winmgmt_backup_get_status");
      setStatus(s);
    } catch (err) {
      setError(String(err));
    }
  }, [invokeCmd]);

  const fetchShadowCopies = useCallback(async () => {
    try {
      const sc = await invokeCmd<ShadowCopy[]>("winmgmt_list_shadow_copies");
      setShadowCopies(sc);
      const ss = await invokeCmd<ShadowStorage[]>("winmgmt_list_shadow_storage");
      setShadowStorage(ss);
    } catch (err) {
      setError(String(err));
    }
  }, [invokeCmd]);

  const fetchVersions = useCallback(async () => {
    try {
      const v = await invokeCmd<BackupVersion[]>("winmgmt_backup_list_versions");
      setVersions(v);
    } catch (err) {
      setError(String(err));
    }
  }, [invokeCmd]);

  const fetchPolicy = useCallback(async () => {
    try {
      const p = await invokeCmd<BackupPolicy>("winmgmt_backup_get_policy");
      setPolicy(p);
      const items = await invokeCmd<BackupItem[]>("winmgmt_backup_get_items");
      setBackupItems(items);
    } catch (err) {
      setError(String(err));
    }
  }, [invokeCmd]);

  const fetchVolumes = useCallback(async () => {
    try {
      const v = await invokeCmd<BackupVolume[]>("winmgmt_backup_list_volumes");
      setVolumes(v);
    } catch (err) {
      setError(String(err));
    }
  }, [invokeCmd]);

  // ── Refresh all data ───────────────────────────────────

  const refreshAll = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchStatus(),
        fetchShadowCopies(),
        fetchVersions(),
        fetchPolicy(),
        fetchVolumes(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, fetchStatus, fetchShadowCopies, fetchVersions, fetchPolicy, fetchVolumes]);

  // ── Shadow copy actions ────────────────────────────────

  const createShadowCopy = useCallback(
    async (volume: string) => {
      setLoading(true);
      try {
        await invokeCmd<string>("winmgmt_create_shadow_copy", { volume });
        await fetchShadowCopies();
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [invokeCmd, fetchShadowCopies],
  );

  const deleteShadowCopy = useCallback(
    async (shadowId: string) => {
      setLoading(true);
      try {
        await invokeCmd<void>("winmgmt_delete_shadow_copy", { shadowId });
        await fetchShadowCopies();
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [invokeCmd, fetchShadowCopies],
  );

  // ── Auto-refresh ───────────────────────────────────────

  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (autoRefresh > 0 && sessionId && isOpen) {
      autoRefreshRef.current = setInterval(() => {
        refreshAll();
      }, autoRefresh * 1000);
    }
    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [autoRefresh, sessionId, isOpen, refreshAll]);

  // ── Auto-fetch on connect ──────────────────────────────

  useEffect(() => {
    if (isOpen && sessionId) {
      refreshAll();
    }
  }, [isOpen, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshAll is stable, only run when dialog opens

  // ── Cleanup on close ───────────────────────────────────

  useEffect(() => {
    if (!isOpen) {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    }
  }, [isOpen]);

  return {
    // Connection
    sessionId,
    hostname,
    connect,
    disconnect,
    isConnected: !!sessionId,
    isTauri,

    // Data
    status,
    shadowCopies,
    shadowStorage,
    versions,
    policy,
    backupItems,
    volumes,

    // UI
    loading,
    error,
    activeTab,
    setActiveTab,
    showRawOutput,
    setShowRawOutput,
    autoRefresh,
    setAutoRefresh,

    // Actions
    refreshAll,
    fetchStatus,
    fetchShadowCopies,
    fetchVersions,
    fetchPolicy,
    fetchVolumes,
    createShadowCopy,
    deleteShadowCopy,
  };
}
