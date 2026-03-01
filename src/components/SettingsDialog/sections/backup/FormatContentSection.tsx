import React from "react";
import { Settings, FileArchive } from "lucide-react";
import { BackupFormats, BackupFormat } from "../../../../types/settings";
import { formatLabels } from "../../../../hooks/settings/useBackupSettings";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";

const FormatContentSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <FileArchive className="w-4 h-4 text-orange-400" />
      Format & Content
    </h4>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Backup Format
        </label>
        <Select value={mgr.backup.format} onChange={(v: string) =>
            mgr.updateBackup({ format: v as BackupFormat })} options={[...BackupFormats.map((fmt) => ({ value: fmt, label: formatLabels[fmt] }))]} className="sor-settings-input" />
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
          <Checkbox checked={mgr.backup[key]} onChange={(v: boolean) => mgr.updateBackup({ [key]: v })} className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
        </label>
      ))}
    </div>
  </div>
);

export default FormatContentSection;
