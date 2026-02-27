import React, { useState, useEffect } from "react";
import { PasswordInput } from '../../ui/PasswordInput';
import { useTranslation } from "react-i18next";
import {
  Archive,
  Clock,
  FolderOpen,
  Lock,
  Settings,
  Play,
  Calendar,
  HardDrive,
  FileArchive,
  Key,
  Bell,
  ChevronDown,
  ChevronUp,
  Info,
  Cloud,
  Folder,
  FileText,
  Shield,
} from "lucide-react";
import {
  GlobalSettings,
  BackupConfig,
  BackupFrequencies,
  BackupFormats,
  DaysOfWeek,
  BackupFrequency,
  BackupFormat,
  DayOfWeek,
  BackupEncryptionAlgorithms,
  BackupEncryptionAlgorithm,
  BackupLocationPresets,
  BackupLocationPreset,
} from "../../../types/settings";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { appDataDir, documentDir, join } from "@tauri-apps/api/path";
import { homeDir } from "@tauri-apps/api/path";
import { useConnections } from "../../../contexts/useConnections";

interface BackupSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const BackupSettings: React.FC<BackupSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  const { state } = useConnections();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRunningBackup, setIsRunningBackup] = useState(false);
  const [presetPaths, setPresetPaths] = useState<Record<BackupLocationPreset, string>>({
    custom: '',
    appData: '',
    documents: '',
    googleDrive: '',
    oneDrive: '',
    nextcloud: '',
    dropbox: '',
  });
  const backup = settings.backup;

  // Load preset paths on mount
  useEffect(() => {
    const loadPaths = async () => {
      try {
        const home = await homeDir();
        const appData = await appDataDir();
        const docs = await documentDir();
        
        // Use join() for cross-platform path construction
        const [
          appDataPath,
          documentsPath,
          googleDrivePath,
          oneDrivePath,
          nextcloudPath,
          dropboxPath,
        ] = await Promise.all([
          join(appData, 'backups'),
          join(docs, 'sortOfRemoteNG Backups'),
          join(home, 'Google Drive', 'sortOfRemoteNG Backups'),
          join(home, 'OneDrive', 'sortOfRemoteNG Backups'),
          join(home, 'Nextcloud', 'sortOfRemoteNG Backups'),
          join(home, 'Dropbox', 'sortOfRemoteNG Backups'),
        ]);
        
        setPresetPaths({
          custom: backup.destinationPath || '',
          appData: appDataPath,
          documents: documentsPath,
          googleDrive: googleDrivePath,
          oneDrive: oneDrivePath,
          nextcloud: nextcloudPath,
          dropbox: dropboxPath,
        });
      } catch (error) {
        console.error('Failed to load preset paths:', error);
      }
    };
    loadPaths();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateBackup = (updates: Partial<BackupConfig>) => {
    updateSettings({
      backup: { ...backup, ...updates },
    });
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
    if (!backup.destinationPath || isRunningBackup) {
      return;
    }

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

      await invoke("backup_run_now", {
        backupType: "manual",
        data,
      });

      updateBackup({ lastBackupTime: Date.now() });
    } catch (error) {
      console.error("Failed to run backup now:", error);
    } finally {
      setIsRunningBackup(false);
    }
  };

  const frequencyLabels: Record<BackupFrequency, string> = {
    manual: "Manual Only",
    hourly: "Every Hour",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };

  const dayLabels: Record<DayOfWeek, string> = {
    sunday: "Sunday",
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
  };

  const formatLabels: Record<BackupFormat, string> = {
    json: "JSON (Human-readable)",
    xml: "XML (mRemoteNG compatible)",
    "encrypted-json": "Encrypted JSON",
  };

  const encryptionAlgorithmLabels: Record<BackupEncryptionAlgorithm, string> = {
    "AES-256-GCM": "AES-256-GCM (Recommended)",
    "AES-256-CBC": "AES-256-CBC",
    "AES-128-GCM": "AES-128-GCM (Faster)",
    "ChaCha20-Poly1305": "ChaCha20-Poly1305 (Modern)",
    "Serpent-256-GCM": "Serpent-256-GCM (High Security)",
    "Serpent-256-CBC": "Serpent-256-CBC",
    "Twofish-256-GCM": "Twofish-256-GCM (Fast & Secure)",
    "Twofish-256-CBC": "Twofish-256-CBC",
  };

  const locationPresetLabels: Record<BackupLocationPreset, string> = {
    custom: "Custom Location",
    appData: "App Data Folder",
    documents: "Documents Folder",
    googleDrive: "Google Drive",
    oneDrive: "OneDrive",
    nextcloud: "Nextcloud",
    dropbox: "Dropbox",
  };

  const locationPresetIcons: Record<BackupLocationPreset, React.ReactNode> = {
    custom: <FolderOpen className="w-4 h-4" />,
    appData: <Folder className="w-4 h-4 text-blue-400" />,
    documents: <FileText className="w-4 h-4 text-yellow-400" />,
    googleDrive: <Cloud className="w-4 h-4 text-green-400" />,
    oneDrive: <Cloud className="w-4 h-4 text-blue-500" />,
    nextcloud: <Cloud className="w-4 h-4 text-cyan-400" />,
    dropbox: <Cloud className="w-4 h-4 text-blue-300" />,
  };

  const handleLocationPresetChange = async (preset: BackupLocationPreset) => {
    let path: string;
    if (preset === 'custom') {
      path = backup.destinationPath;
    } else if (backup.cloudCustomPath) {
      path = await join(presetPaths[preset], backup.cloudCustomPath);
    } else {
      path = presetPaths[preset];
    }
    
    updateBackup({ 
      locationPreset: preset,
      destinationPath: path,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          <Archive className="w-5 h-5" />
          Backup & Scheduling
        </h3>
        <button
          onClick={handleRunBackupNow}
          disabled={!backup.destinationPath || isRunningBackup}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
        >
          <Play className="w-4 h-4" />
          Backup Now
        </button>
      </div>

      {/* Enable Backup */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Archive className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <span className="text-[var(--color-text)] font-medium">
                Enable Automatic Backups
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Automatically backup your connections and settings on a schedule
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={backup.enabled}
            onChange={(e) => updateBackup({ enabled: e.target.checked })}
            className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
        </label>
      </div>

      {/* Destination Folder */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
          <FolderOpen className="w-4 h-4 inline mr-2" />
          Backup Destination
        </label>
        
        {/* Location Presets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {BackupLocationPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handleLocationPresetChange(preset)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm ${
                backup.locationPreset === preset
                  ? "bg-blue-600/20 border-blue-500 text-blue-400"
                  : "bg-[var(--color-surfaceHover)]/30 border-[var(--color-border)] text-[var(--color-textSecondary)] hover:border-[var(--color-textMuted)]"
              }`}
            >
              {locationPresetIcons[preset]}
              <span className="truncate">{locationPresetLabels[preset]}</span>
            </button>
          ))}
        </div>

        {/* Cloud Service Custom Subfolder */}
        {backup.locationPreset !== 'custom' && backup.locationPreset !== 'appData' && backup.locationPreset !== 'documents' && (
          <div className="space-y-2">
            <label className="block text-xs text-[var(--color-textSecondary)]">
              Custom Subfolder (optional)
            </label>
            <input
              type="text"
              value={backup.cloudCustomPath || ""}
              onChange={async (e) => {
                const customPath = e.target.value;
                const basePath = presetPaths[backup.locationPreset];
                const destinationPath = customPath 
                  ? await join(basePath, customPath)
                  : basePath;
                updateBackup({ 
                  cloudCustomPath: customPath,
                  destinationPath,
                });
              }}
              placeholder="e.g., Work/Projects"
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)]"
            />
          </div>
        )}

        {/* Path Display / Custom Path Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={backup.destinationPath}
            onChange={(e) => updateBackup({ destinationPath: e.target.value, locationPreset: 'custom' })}
            placeholder="Select a folder for backups..."
            readOnly={backup.locationPreset !== 'custom'}
            className={`flex-1 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)] ${
              backup.locationPreset !== 'custom' ? 'opacity-70' : ''
            }`}
          />
          <button
            onClick={handleSelectFolder}
            className="px-4 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
          >
            Browse
          </button>
        </div>
        
        {backup.locationPreset !== 'custom' && (
          <p className="text-xs text-[var(--color-textMuted)] flex items-center gap-1">
            <Info className="w-3 h-3" />
            {backup.locationPreset === 'appData' || backup.locationPreset === 'documents' 
              ? 'Local folder - always available'
              : 'Ensure the cloud sync app is installed and running for automatic sync'}
          </p>
        )}
      </div>

      {/* Schedule Settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          Schedule
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Frequency */}
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Frequency
            </label>
            <select
              value={backup.frequency}
              onChange={(e) =>
                updateBackup({ frequency: e.target.value as BackupFrequency })
              }
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
            >
              {BackupFrequencies.map((freq) => (
                <option key={freq} value={freq}>
                  {frequencyLabels[freq]}
                </option>
              ))}
            </select>
          </div>

          {/* Time (for daily/weekly/monthly) */}
          {backup.frequency !== "manual" && backup.frequency !== "hourly" && (
            <div className="space-y-2">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Time
              </label>
              <input
                type="time"
                value={backup.scheduledTime}
                onChange={(e) => updateBackup({ scheduledTime: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              />
            </div>
          )}

          {/* Day of week (for weekly) */}
          {backup.frequency === "weekly" && (
            <div className="space-y-2">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Day of Week
              </label>
              <select
                value={backup.weeklyDay}
                onChange={(e) =>
                  updateBackup({ weeklyDay: e.target.value as DayOfWeek })
                }
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              >
                {DaysOfWeek.map((day) => (
                  <option key={day} value={day}>
                    {dayLabels[day]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Day of month (for monthly) */}
          {backup.frequency === "monthly" && (
            <div className="space-y-2">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Day of Month
              </label>
              <select
                value={backup.monthlyDay}
                onChange={(e) =>
                  updateBackup({ monthlyDay: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Differential Backup */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-purple-400" />
          Differential Backups
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-[var(--color-text)]">
                Enable Differential Backups
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Only backup changes since the last full backup (saves space)
              </p>
            </div>
            <input
              type="checkbox"
              checked={backup.differentialEnabled}
              onChange={(e) =>
                updateBackup({ differentialEnabled: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          {backup.differentialEnabled && (
            <div className="space-y-2 pl-4 border-l-2 border-purple-500/30">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Full backup every N backups
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={backup.fullBackupInterval}
                onChange={(e) =>
                  updateBackup({ fullBackupInterval: parseInt(e.target.value) || 7 })
                }
                className="w-24 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              />
              <p className="text-xs text-[var(--color-textMuted)]">
                A full backup will be created every {backup.fullBackupInterval}{" "}
                differential backups
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Format & Content */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <FileArchive className="w-4 h-4 text-orange-400" />
          Format & Content
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Backup Format
            </label>
            <select
              value={backup.format}
              onChange={(e) =>
                updateBackup({ format: e.target.value as BackupFormat })
              }
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
            >
              {BackupFormats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {formatLabels[fmt]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Keep Last X Backups
            </label>
            <div className="flex gap-2">
              <div className="flex flex-wrap gap-1.5 flex-1">
                {[5, 10, 30, 60, 0].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => updateBackup({ maxBackupsToKeep: count })}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      backup.maxBackupsToKeep === count
                        ? "bg-blue-600 text-white"
                        : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceActive)]"
                    }`}
                  >
                    {count === 0 ? "∞" : count}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                max={365}
                value={backup.maxBackupsToKeep}
                onChange={(e) =>
                  updateBackup({ maxBackupsToKeep: parseInt(e.target.value) || 0 })
                }
                className="w-20 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm text-center"
              />
            </div>
            <p className="text-xs text-[var(--color-textMuted)]">
              Older backups are automatically deleted. 0 or ∞ = keep all.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Include Passwords</span>
            <input
              type="checkbox"
              checked={backup.includePasswords}
              onChange={(e) =>
                updateBackup({ includePasswords: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Include Settings</span>
            <input
              type="checkbox"
              checked={backup.includeSettings}
              onChange={(e) =>
                updateBackup({ includeSettings: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Include SSH Keys</span>
            <input
              type="checkbox"
              checked={backup.includeSSHKeys}
              onChange={(e) =>
                updateBackup({ includeSSHKeys: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Compress Backups</span>
            <input
              type="checkbox"
              checked={backup.compressBackups}
              onChange={(e) =>
                updateBackup({ compressBackups: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>
        </div>
      </div>

      {/* Encryption */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Lock className="w-4 h-4 text-yellow-400" />
          Encryption
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-[var(--color-text)]">Encrypt Backups</span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Password-protect backup files
              </p>
            </div>
            <input
              type="checkbox"
              checked={backup.encryptBackups}
              onChange={(e) =>
                updateBackup({ encryptBackups: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          {backup.encryptBackups && (
            <div className="space-y-4 pl-4 border-l-2 border-yellow-500/30">
              {/* Encryption Algorithm */}
              <div className="space-y-2">
                <label className="block text-sm text-[var(--color-textSecondary)]">
                  <Shield className="w-4 h-4 inline mr-2" />
                  Encryption Algorithm
                </label>
                <select
                  value={backup.encryptionAlgorithm}
                  onChange={(e) =>
                    updateBackup({ encryptionAlgorithm: e.target.value as BackupEncryptionAlgorithm })
                  }
                  className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
                >
                  {BackupEncryptionAlgorithms.map((alg) => (
                    <option key={alg} value={alg}>
                      {encryptionAlgorithmLabels[alg]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--color-textMuted)]">
                  {backup.encryptionAlgorithm === 'AES-256-GCM' && 'Industry standard with authenticated encryption'}
                  {backup.encryptionAlgorithm === 'AES-256-CBC' && 'Classic encryption, widely compatible'}
                  {backup.encryptionAlgorithm === 'AES-128-GCM' && 'Faster with slightly smaller key size'}
                  {backup.encryptionAlgorithm === 'ChaCha20-Poly1305' && 'Modern algorithm, excellent on mobile devices'}
                  {backup.encryptionAlgorithm === 'Serpent-256-GCM' && 'AES finalist, extremely conservative security margin'}
                  {backup.encryptionAlgorithm === 'Serpent-256-CBC' && 'Serpent cipher with classic CBC mode'}
                  {backup.encryptionAlgorithm === 'Twofish-256-GCM' && 'AES finalist by Bruce Schneier, very fast'}
                  {backup.encryptionAlgorithm === 'Twofish-256-CBC' && 'Twofish cipher with classic CBC mode'}
                </p>
              </div>

              {/* Encryption Password */}
              <div className="space-y-2">
                <label className="block text-sm text-[var(--color-textSecondary)]">
                  <Key className="w-4 h-4 inline mr-2" />
                  Encryption Password
                </label>
                <PasswordInput
                  value={backup.encryptionPassword || ""}
                  onChange={(e) =>
                    updateBackup({ encryptionPassword: e.target.value })
                  }
                  placeholder="Enter encryption password..."
                  className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)]"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Options */}
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-2 bg-[var(--color-surfaceHover)]/30 border border-[var(--color-border)] rounded-lg text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <span className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Advanced Options
          </span>
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showAdvanced && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-[var(--color-text)]">Backup on App Close</span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  Create a backup when closing the application
                </p>
              </div>
              <input
                type="checkbox"
                checked={backup.backupOnClose}
                onChange={(e) =>
                  updateBackup({ backupOnClose: e.target.checked })
                }
                className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-[var(--color-text)]">Show Notifications</span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  Display a notification after successful backup
                </p>
              </div>
              <input
                type="checkbox"
                checked={backup.notifyOnBackup}
                onChange={(e) =>
                  updateBackup({ notifyOnBackup: e.target.checked })
                }
                className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
              />
            </label>
          </div>
        )}
      </div>

      {/* Last Backup Info */}
      {backup.lastBackupTime && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Info className="w-4 h-4 text-blue-400" />
            <span>
              Last backup:{" "}
              <span className="text-[var(--color-text)]">
                {new Date(backup.lastBackupTime).toLocaleString()}
              </span>
            </span>
          </div>
          {backup.differentialEnabled && backup.lastFullBackupTime && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)] mt-1">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span>
                Last full backup:{" "}
                <span className="text-[var(--color-text)]">
                  {new Date(backup.lastFullBackupTime).toLocaleString()}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BackupSettings;
