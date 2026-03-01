import { useState, useEffect } from "react";
import {
  GlobalSettings,
  BackupConfig,
  BackupFrequency,
  BackupFormat,
  DayOfWeek,
  BackupEncryptionAlgorithm,
  BackupLocationPreset,
} from "../../types/settings";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { appDataDir, documentDir, join, homeDir } from "@tauri-apps/api/path";
import { useConnections } from "../../contexts/useConnections";

/* ═══════════════════════════════════════════════════════════════
   Static label / description maps
   ═══════════════════════════════════════════════════════════════ */

export const frequencyLabels: Record<BackupFrequency, string> = {
  manual: "Manual Only",
  hourly: "Every Hour",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const dayLabels: Record<DayOfWeek, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

export const formatLabels: Record<BackupFormat, string> = {
  json: "JSON (Human-readable)",
  xml: "XML (mRemoteNG compatible)",
  "encrypted-json": "Encrypted JSON",
};

export const encryptionAlgorithmLabels: Record<
  BackupEncryptionAlgorithm,
  string
> = {
  "AES-256-GCM": "AES-256-GCM (Recommended)",
  "AES-256-CBC": "AES-256-CBC",
  "AES-128-GCM": "AES-128-GCM (Faster)",
  "ChaCha20-Poly1305": "ChaCha20-Poly1305 (Modern)",
  "Serpent-256-GCM": "Serpent-256-GCM (High Security)",
  "Serpent-256-CBC": "Serpent-256-CBC",
  "Twofish-256-GCM": "Twofish-256-GCM (Fast & Secure)",
  "Twofish-256-CBC": "Twofish-256-CBC",
};

export const encryptionAlgorithmDescriptions: Record<
  BackupEncryptionAlgorithm,
  string
> = {
  "AES-256-GCM": "Industry standard with authenticated encryption",
  "AES-256-CBC": "Classic encryption, widely compatible",
  "AES-128-GCM": "Faster with slightly smaller key size",
  "ChaCha20-Poly1305": "Modern algorithm, excellent on mobile devices",
  "Serpent-256-GCM": "AES finalist, extremely conservative security margin",
  "Serpent-256-CBC": "Serpent cipher with classic CBC mode",
  "Twofish-256-GCM": "AES finalist by Bruce Schneier, very fast",
  "Twofish-256-CBC": "Twofish cipher with classic CBC mode",
};

export const locationPresetLabels: Record<BackupLocationPreset, string> = {
  custom: "Custom Location",
  appData: "App Data Folder",
  documents: "Documents Folder",
  googleDrive: "Google Drive",
  oneDrive: "OneDrive",
  nextcloud: "Nextcloud",
  dropbox: "Dropbox",
};

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useBackupSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const { state } = useConnections();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRunningBackup, setIsRunningBackup] = useState(false);
  const [presetPaths, setPresetPaths] = useState<
    Record<BackupLocationPreset, string>
  >({
    custom: "",
    appData: "",
    documents: "",
    googleDrive: "",
    oneDrive: "",
    nextcloud: "",
    dropbox: "",
  });

  const backup = settings.backup;

  // Load preset paths on mount
  useEffect(() => {
    const loadPaths = async () => {
      try {
        const home = await homeDir();
        const appData = await appDataDir();
        const docs = await documentDir();

        const [
          appDataPath,
          documentsPath,
          googleDrivePath,
          oneDrivePath,
          nextcloudPath,
          dropboxPath,
        ] = await Promise.all([
          join(appData, "backups"),
          join(docs, "sortOfRemoteNG Backups"),
          join(home, "Google Drive", "sortOfRemoteNG Backups"),
          join(home, "OneDrive", "sortOfRemoteNG Backups"),
          join(home, "Nextcloud", "sortOfRemoteNG Backups"),
          join(home, "Dropbox", "sortOfRemoteNG Backups"),
        ]);

        setPresetPaths({
          custom: backup.destinationPath || "",
          appData: appDataPath,
          documents: documentsPath,
          googleDrive: googleDrivePath,
          oneDrive: oneDrivePath,
          nextcloud: nextcloudPath,
          dropbox: dropboxPath,
        });
      } catch (error) {
        console.error("Failed to load preset paths:", error);
      }
    };
    loadPaths();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateBackup = (updates: Partial<BackupConfig>) => {
    updateSettings({ backup: { ...backup, ...updates } });
  };

  const handleSelectFolder = async () => {
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Backup Destination Folder",
      });
      if (result && typeof result === "string") {
        updateBackup({ destinationPath: result });
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  const handleRunBackupNow = async () => {
    if (!backup.destinationPath || isRunningBackup) return;

    setIsRunningBackup(true);
    try {
      await invoke("backup_update_config", { config: backup });

      const connections = backup.includePasswords
        ? state.connections
        : state.connections.map((conn) => ({
            ...conn,
            password: conn.password ? "***ENCRYPTED***" : undefined,
            basicAuthPassword: conn.basicAuthPassword
              ? "***ENCRYPTED***"
              : undefined,
          }));

      const data = {
        connections,
        settings: backup.includeSettings ? settings : {},
        timestamp: Date.now(),
      };

      await invoke("backup_run_now", { backupType: "manual", data });
      updateBackup({ lastBackupTime: Date.now() });
    } catch (error) {
      console.error("Failed to run backup now:", error);
    } finally {
      setIsRunningBackup(false);
    }
  };

  const handleLocationPresetChange = async (preset: BackupLocationPreset) => {
    let path: string;
    if (preset === "custom") {
      path = backup.destinationPath;
    } else if (backup.cloudCustomPath) {
      path = await join(presetPaths[preset], backup.cloudCustomPath);
    } else {
      path = presetPaths[preset];
    }

    updateBackup({ locationPreset: preset, destinationPath: path });
  };

  const handleCloudSubfolderChange = async (customPath: string) => {
    const basePath = presetPaths[backup.locationPreset];
    const destinationPath = customPath
      ? await join(basePath, customPath)
      : basePath;
    updateBackup({ cloudCustomPath: customPath, destinationPath });
  };

  return {
    backup,
    updateBackup,
    showAdvanced,
    setShowAdvanced,
    isRunningBackup,
    presetPaths,
    handleSelectFolder,
    handleRunBackupNow,
    handleLocationPresetChange,
    handleCloudSubfolderChange,
  };
}
