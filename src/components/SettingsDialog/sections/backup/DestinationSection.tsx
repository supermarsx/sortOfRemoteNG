import locationPresetIcons from "./locationPresetIcons";
import React from "react";
import { FolderOpen, Info, Cloud } from "lucide-react";
import { BackupLocationPresets } from "../../../../types/settings";
import { locationPresetLabels } from "../../../../hooks/settings/useBackupSettings";
import { Select } from "../../../ui/forms";

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
            className="sor-settings-input"
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

export default DestinationSection;
