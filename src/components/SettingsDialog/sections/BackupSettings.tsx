import React from "react";
import { PasswordInput } from "../../ui/PasswordInput";
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
import {
  useBackupSettings,
  frequencyLabels,
  dayLabels,
  formatLabels,
  encryptionAlgorithmLabels,
  encryptionAlgorithmDescriptions,
  locationPresetLabels,
} from "../../../hooks/useBackupSettings";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface BackupSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

type Mgr = ReturnType<typeof useBackupSettings>;

/* ═══════════════════════════════════════════════════════════════
   Static data
   ═══════════════════════════════════════════════════════════════ */

const locationPresetIcons: Record<BackupLocationPreset, React.ReactNode> = {
  custom: <FolderOpen className="w-4 h-4" />,
  appData: <Folder className="w-4 h-4 text-blue-400" />,
  documents: <FileText className="w-4 h-4 text-yellow-400" />,
  googleDrive: <Cloud className="w-4 h-4 text-green-400" />,
  oneDrive: <Cloud className="w-4 h-4 text-blue-500" />,
  nextcloud: <Cloud className="w-4 h-4 text-cyan-400" />,
  dropbox: <Cloud className="w-4 h-4 text-blue-300" />,
};

/* ═══════════════════════════════════════════════════════════════
   Enable Backup
   ═══════════════════════════════════════════════════════════════ */

const EnableBackup: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
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
        checked={mgr.backup.enabled}
        onChange={(e) => mgr.updateBackup({ enabled: e.target.checked })}
        className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
      />
    </label>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Destination Section
   ═══════════════════════════════════════════════════════════════ */

const DestinationSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
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
          onClick={() => mgr.handleLocationPresetChange(preset)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm ${
            mgr.backup.locationPreset === preset
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
    {mgr.backup.locationPreset !== "custom" &&
      mgr.backup.locationPreset !== "appData" &&
      mgr.backup.locationPreset !== "documents" && (
        <div className="space-y-2">
          <label className="block text-xs text-[var(--color-textSecondary)]">
            Custom Subfolder (optional)
          </label>
          <input
            type="text"
            value={mgr.backup.cloudCustomPath || ""}
            onChange={(e) => mgr.handleCloudSubfolderChange(e.target.value)}
            placeholder="e.g., Work/Projects"
            className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)]"
          />
        </div>
      )}

    {/* Path Display / Custom Path Input */}
    <div className="flex gap-2">
      <input
        type="text"
        value={mgr.backup.destinationPath}
        onChange={(e) =>
          mgr.updateBackup({
            destinationPath: e.target.value,
            locationPreset: "custom",
          })
        }
        placeholder="Select a folder for backups..."
        readOnly={mgr.backup.locationPreset !== "custom"}
        className={`flex-1 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)] ${
          mgr.backup.locationPreset !== "custom" ? "opacity-70" : ""
        }`}
      />
      <button
        onClick={mgr.handleSelectFolder}
        className="px-4 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
      >
        Browse
      </button>
    </div>

    {mgr.backup.locationPreset !== "custom" && (
      <p className="text-xs text-[var(--color-textMuted)] flex items-center gap-1">
        <Info className="w-3 h-3" />
        {mgr.backup.locationPreset === "appData" ||
        mgr.backup.locationPreset === "documents"
          ? "Local folder - always available"
          : "Ensure the cloud sync app is installed and running for automatic sync"}
      </p>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Schedule Section
   ═══════════════════════════════════════════════════════════════ */

const ScheduleSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Clock className="w-4 h-4 text-blue-400" />
      Schedule
    </h4>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Frequency
        </label>
        <select
          value={mgr.backup.frequency}
          onChange={(e) =>
            mgr.updateBackup({
              frequency: e.target.value as BackupFrequency,
            })
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

      {mgr.backup.frequency !== "manual" &&
        mgr.backup.frequency !== "hourly" && (
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Time
            </label>
            <input
              type="time"
              value={mgr.backup.scheduledTime}
              onChange={(e) =>
                mgr.updateBackup({ scheduledTime: e.target.value })
              }
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
            />
          </div>
        )}

      {mgr.backup.frequency === "weekly" && (
        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Day of Week
          </label>
          <select
            value={mgr.backup.weeklyDay}
            onChange={(e) =>
              mgr.updateBackup({ weeklyDay: e.target.value as DayOfWeek })
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

      {mgr.backup.frequency === "monthly" && (
        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Day of Month
          </label>
          <select
            value={mgr.backup.monthlyDay}
            onChange={(e) =>
              mgr.updateBackup({ monthlyDay: parseInt(e.target.value) })
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
);

/* ═══════════════════════════════════════════════════════════════
   Differential Backups
   ═══════════════════════════════════════════════════════════════ */

const DifferentialSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
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
          checked={mgr.backup.differentialEnabled}
          onChange={(e) =>
            mgr.updateBackup({ differentialEnabled: e.target.checked })
          }
          className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
      </label>

      {mgr.backup.differentialEnabled && (
        <div className="space-y-2 pl-4 border-l-2 border-purple-500/30">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Full backup every N backups
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={mgr.backup.fullBackupInterval}
            onChange={(e) =>
              mgr.updateBackup({
                fullBackupInterval: parseInt(e.target.value) || 7,
              })
            }
            className="w-24 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
          />
          <p className="text-xs text-[var(--color-textMuted)]">
            A full backup will be created every{" "}
            {mgr.backup.fullBackupInterval} differential backups
          </p>
        </div>
      )}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Format & Content
   ═══════════════════════════════════════════════════════════════ */

const FormatContentSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <FileArchive className="w-4 h-4 text-orange-400" />
      Format & Content
    </h4>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Backup Format
        </label>
        <select
          value={mgr.backup.format}
          onChange={(e) =>
            mgr.updateBackup({ format: e.target.value as BackupFormat })
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
                onClick={() => mgr.updateBackup({ maxBackupsToKeep: count })}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  mgr.backup.maxBackupsToKeep === count
                    ? "bg-blue-600 text-[var(--color-text)]"
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
            value={mgr.backup.maxBackupsToKeep}
            onChange={(e) =>
              mgr.updateBackup({
                maxBackupsToKeep: parseInt(e.target.value) || 0,
              })
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
      {(
        [
          ["includePasswords", "Include Passwords"],
          ["includeSettings", "Include Settings"],
          ["includeSSHKeys", "Include SSH Keys"],
          ["compressBackups", "Compress Backups"],
        ] as const
      ).map(([key, label]) => (
        <label
          key={key}
          className="flex items-center justify-between cursor-pointer"
        >
          <span className="text-[var(--color-text)]">{label}</span>
          <input
            type="checkbox"
            checked={mgr.backup[key]}
            onChange={(e) => mgr.updateBackup({ [key]: e.target.checked })}
            className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
        </label>
      ))}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Encryption
   ═══════════════════════════════════════════════════════════════ */

const EncryptionSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
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
          checked={mgr.backup.encryptBackups}
          onChange={(e) =>
            mgr.updateBackup({ encryptBackups: e.target.checked })
          }
          className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
      </label>

      {mgr.backup.encryptBackups && (
        <div className="space-y-4 pl-4 border-l-2 border-yellow-500/30">
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              <Shield className="w-4 h-4 inline mr-2" />
              Encryption Algorithm
            </label>
            <select
              value={mgr.backup.encryptionAlgorithm}
              onChange={(e) =>
                mgr.updateBackup({
                  encryptionAlgorithm:
                    e.target.value as BackupEncryptionAlgorithm,
                })
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
              {
                encryptionAlgorithmDescriptions[
                  mgr.backup.encryptionAlgorithm
                ]
              }
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              <Key className="w-4 h-4 inline mr-2" />
              Encryption Password
            </label>
            <PasswordInput
              value={mgr.backup.encryptionPassword || ""}
              onChange={(e) =>
                mgr.updateBackup({ encryptionPassword: e.target.value })
              }
              placeholder="Enter encryption password..."
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)]"
            />
          </div>
        </div>
      )}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Advanced Options
   ═══════════════════════════════════════════════════════════════ */

const AdvancedSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <button
      type="button"
      onClick={() => mgr.setShowAdvanced(!mgr.showAdvanced)}
      className="w-full flex items-center justify-between px-4 py-2 bg-[var(--color-surfaceHover)]/30 border border-[var(--color-border)] rounded-lg text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
    >
      <span className="flex items-center gap-2">
        <Settings className="w-4 h-4" />
        Advanced Options
      </span>
      {mgr.showAdvanced ? (
        <ChevronUp className="w-4 h-4" />
      ) : (
        <ChevronDown className="w-4 h-4" />
      )}
    </button>

    {mgr.showAdvanced && (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-3">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-[var(--color-text)]">
              Backup on App Close
            </span>
            <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
              Create a backup when closing the application
            </p>
          </div>
          <input
            type="checkbox"
            checked={mgr.backup.backupOnClose}
            onChange={(e) =>
              mgr.updateBackup({ backupOnClose: e.target.checked })
            }
            className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
        </label>

        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-[var(--color-text)]">
              Show Notifications
            </span>
            <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
              Display a notification after successful backup
            </p>
          </div>
          <input
            type="checkbox"
            checked={mgr.backup.notifyOnBackup}
            onChange={(e) =>
              mgr.updateBackup({ notifyOnBackup: e.target.checked })
            }
            className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
        </label>
      </div>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Last Backup Info
   ═══════════════════════════════════════════════════════════════ */

const LastBackupInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.backup.lastBackupTime) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
      <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
        <Info className="w-4 h-4 text-blue-400" />
        <span>
          Last backup:{" "}
          <span className="text-[var(--color-text)]">
            {new Date(mgr.backup.lastBackupTime).toLocaleString()}
          </span>
        </span>
      </div>
      {mgr.backup.differentialEnabled && mgr.backup.lastFullBackupTime && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)] mt-1">
          <Calendar className="w-4 h-4 text-purple-400" />
          <span>
            Last full backup:{" "}
            <span className="text-[var(--color-text)]">
              {new Date(mgr.backup.lastFullBackupTime).toLocaleString()}
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

const BackupSettings: React.FC<BackupSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useBackupSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
          <Archive className="w-5 h-5" />
          Backup
        </h3>
        <button
          onClick={mgr.handleRunBackupNow}
          disabled={!mgr.backup.destinationPath || mgr.isRunningBackup}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors text-sm"
        >
          <Play className="w-4 h-4" />
          Backup Now
        </button>
      </div>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Automatic and manual backup scheduling, encryption, destination, and
        retention settings.
      </p>

      <EnableBackup mgr={mgr} />
      <DestinationSection mgr={mgr} />
      <ScheduleSection mgr={mgr} />
      <DifferentialSection mgr={mgr} />
      <FormatContentSection mgr={mgr} />
      <EncryptionSection mgr={mgr} />
      <AdvancedSection mgr={mgr} />
      <LastBackupInfo mgr={mgr} />
    </div>
  );
};

export default BackupSettings;
