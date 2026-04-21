import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  UpdateInfo,
  UpdateProgress,
  UpdateHistoryEntry,
  RollbackInfo,
  ReleaseNotes,
  VersionInfo,
  UpdaterConfig,
  UpdateChannel,
} from "../../types/updater/updater";

export function useUpdater() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [history, setHistory] = useState<UpdateHistoryEntry[]>([]);
  const [rollbacks, setRollbacks] = useState<RollbackInfo[]>([]);
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotes | null>(null);
  const [config, setConfig] = useState<UpdaterConfig | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const info = await invoke<UpdateInfo | null>("updater_check");
      setUpdateInfo(info);
      return info;
    } catch (e) { setError(String(e)); return null; }
    finally { setChecking(false); }
  }, []);

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      await invoke("updater_download");
      // Poll progress
      const poll = setInterval(async () => {
        try {
          const p = await invoke<UpdateProgress>("updater_get_status");
          setProgress(p);
          if (p.status === "ready" || p.status === "error") {
            clearInterval(poll);
            setDownloading(false);
          }
        } catch { clearInterval(poll); setDownloading(false); }
      }, 500);
    } catch (e) { setError(String(e)); setDownloading(false); }
  }, []);

  const cancelDownload = useCallback(async () => {
    try {
      await invoke("updater_cancel_download");
      setDownloading(false);
      setProgress(null);
    } catch (e) { setError(String(e)); }
  }, []);

  const install = useCallback(async () => {
    try {
      await invoke("updater_install");
    } catch (e) { setError(String(e)); }
  }, []);

  const scheduleInstall = useCallback(async (delayMs: number) => {
    try {
      await invoke("updater_schedule_install", { delayMs });
    } catch (e) { setError(String(e)); }
  }, []);

  const setChannel = useCallback(async (channel: UpdateChannel) => {
    try {
      await invoke("updater_set_channel", { channel });
      if (config) setConfig({ ...config, channel });
    } catch (e) { setError(String(e)); }
  }, [config]);

  const fetchVersionInfo = useCallback(async () => {
    try {
      const v = await invoke<VersionInfo>("updater_get_version_info");
      setVersionInfo(v);
      return v;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const list = await invoke<UpdateHistoryEntry[]>("updater_get_history");
      setHistory(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const rollback = useCallback(async (version: string) => {
    try {
      await invoke("updater_rollback", { version });
    } catch (e) { setError(String(e)); }
  }, []);

  const fetchRollbacks = useCallback(async () => {
    try {
      const list = await invoke<RollbackInfo[]>("updater_get_rollbacks");
      setRollbacks(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const fetchReleaseNotes = useCallback(async (version?: string) => {
    try {
      const notes = await invoke<ReleaseNotes>("updater_get_release_notes", { version: version ?? null });
      setReleaseNotes(notes);
      return notes;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<UpdaterConfig>("updater_get_config");
      setConfig(c);
    } catch (e) { setError(String(e)); }
  }, []);

  const updateConfig = useCallback(async (cfg: Partial<UpdaterConfig>) => {
    try {
      const merged = { ...config, ...cfg } as UpdaterConfig;
      await invoke("updater_update_config", { config: merged });
      setConfig(merged);
    } catch (e) { setError(String(e)); }
  }, [config]);

  // Auto-check on mount if enabled
  useEffect(() => {
    loadConfig().then(async () => {
      fetchVersionInfo();
    });
  }, [loadConfig, fetchVersionInfo]);

  return {
    updateInfo, progress, versionInfo, history, rollbacks, releaseNotes, config,
    checking, downloading, error,
    checkForUpdates, download, cancelDownload, install, scheduleInstall,
    setChannel, fetchVersionInfo, fetchHistory, rollback, fetchRollbacks,
    fetchReleaseNotes, loadConfig, updateConfig,
  };
}
