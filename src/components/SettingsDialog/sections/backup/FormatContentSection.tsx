import type { Mgr } from "./types";
import React from "react";
import {
  FileArchive,
  FileCode2,
  Archive,
  KeyRound,
  SlidersHorizontal,
  KeySquare,
  FileDown,
} from "lucide-react";
import {
  BackupFormats,
  BackupFormat,
} from "../../../../types/settings/settings";
import { formatLabels } from "../../../../hooks/settings/useBackupSettings";
import { NumberInput } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const formatOptions = BackupFormats.map((fmt) => ({
  value: fmt,
  label: formatLabels[fmt],
}));

const FormatContentSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<FileArchive className="w-4 h-4 text-primary" />}
      title="Format & Content"
    />

    <Card>
      <SettingsSelectRow
        icon={<FileCode2 size={16} />}
        label="Backup Format"
        value={mgr.backup.format}
        options={formatOptions}
        onChange={(v) => mgr.updateBackup({ format: v as BackupFormat })}
        infoTooltip="The file format used for backup archives. JSON is human-readable; binary formats are more compact."
      />

      <div className="sor-settings-select-row">
        <span className="sor-settings-row-label flex items-center gap-1">
          <span className="text-[var(--color-textSecondary)] mr-1">
            <Archive size={16} />
          </span>
          Keep Last X Backups
          <InfoTooltip text="Maximum number of backup files to retain. Older backups are automatically deleted. Set to 0 to keep all." />
        </span>
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
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
          <NumberInput
            value={mgr.backup.maxBackupsToKeep}
            onChange={(v: number) =>
              mgr.updateBackup({ maxBackupsToKeep: v })
            }
            className="text-center"
            style={{ width: "5rem" }}
            min={0}
            max={365}
            variant="settings-compact"
          />
        </div>
      </div>
    </Card>

    <Card>
      <Toggle
        icon={<KeyRound size={16} />}
        label="Include Passwords"
        description="Include saved connection passwords in backups (encrypted)"
        checked={mgr.backup.includePasswords}
        onChange={(v) => mgr.updateBackup({ includePasswords: v })}
        infoTooltip="Include saved connection passwords in backups. Passwords are stored encrypted."
      />

      <Toggle
        icon={<SlidersHorizontal size={16} />}
        label="Include Settings"
        description="Include application preferences and global settings"
        checked={mgr.backup.includeSettings}
        onChange={(v) => mgr.updateBackup({ includeSettings: v })}
        infoTooltip="Include application preferences and global settings in backup files."
      />

      <Toggle
        icon={<KeySquare size={16} />}
        label="Include SSH Keys"
        description="Include SSH private keys (handle with care — grants server access)"
        checked={mgr.backup.includeSSHKeys}
        onChange={(v) => mgr.updateBackup({ includeSSHKeys: v })}
        infoTooltip="Include SSH private keys in backup files. Handle with care as these grant server access."
      />

      <Toggle
        icon={<FileDown size={16} />}
        label="Compress Backups"
        description="Compress backup files to reduce disk space usage"
        checked={mgr.backup.compressBackups}
        onChange={(v) => mgr.updateBackup({ compressBackups: v })}
        infoTooltip="Compress backup files to reduce disk space usage at the cost of slightly longer backup times."
      />
    </Card>
  </div>
);

export default FormatContentSection;
