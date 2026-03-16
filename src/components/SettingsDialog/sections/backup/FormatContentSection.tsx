import type { Mgr } from './types';
import React from "react";
import { Settings, FileArchive } from "lucide-react";
import { BackupFormats, BackupFormat } from "../../../../types/settings/settings";
import { formatLabels } from "../../../../hooks/settings/useBackupSettings";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const FormatContentSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <FileArchive className="w-4 h-4 text-warning" />
      Format & Content
    </h4>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Backup Format <InfoTooltip text="The file format used for backup archives. JSON is human-readable; binary formats are more compact." />
        </label>
        <Select value={mgr.backup.format} onChange={(v: string) =>
            mgr.updateBackup({ format: v as BackupFormat })} options={[...BackupFormats.map((fmt) => ({ value: fmt, label: formatLabels[fmt] }))]} className="sor-settings-input" />
      </div>

      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Keep Last X Backups <InfoTooltip text="Maximum number of backup files to retain. Older backups are automatically deleted. Set to 0 to keep all." />
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
                    ? "bg-primary text-[var(--color-text)]"
                    : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceActive)]"
                }`}
              >
                {count === 0 ? "∞" : count}
              </button>
            ))}
          </div>
          <NumberInput value={mgr.backup.maxBackupsToKeep} onChange={(v: number) => mgr.updateBackup({
                maxBackupsToKeep: v,
              })} className="w-20 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]  text-center" min={0} max={365} />
        </div>
        <p className="text-xs text-[var(--color-textMuted)]">
          Older backups are automatically deleted. 0 or ∞ = keep all.
        </p>
      </div>
    </div>

    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-3">
      {(
        [
          ["includePasswords", "Include Passwords", "Include saved connection passwords in backups. Passwords are stored encrypted."],
          ["includeSettings", "Include Settings", "Include application preferences and global settings in backup files."],
          ["includeSSHKeys", "Include SSH Keys", "Include SSH private keys in backup files. Handle with care as these grant server access."],
          ["compressBackups", "Compress Backups", "Compress backup files to reduce disk space usage at the cost of slightly longer backup times."],
        ] as const
      ).map(([key, label, tooltip]) => (
        <label
          key={key}
          className="flex items-center justify-between cursor-pointer"
        >
          <span className="text-[var(--color-text)]">{label} <InfoTooltip text={tooltip} /></span>
          <Checkbox checked={mgr.backup[key]} onChange={(v: boolean) => mgr.updateBackup({ [key]: v })} className="sor-checkbox-lg" />
        </label>
      ))}
    </div>
  </div>
);

export default FormatContentSection;
