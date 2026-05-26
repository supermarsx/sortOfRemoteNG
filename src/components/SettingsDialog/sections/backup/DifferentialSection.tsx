import type { Mgr } from './types';
import React from "react";
import { HardDrive, Layers, Hash } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";

const DifferentialSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<HardDrive className="w-4 h-4 text-primary" />}
      title="Differential Backups"
    />

    <Card>
      <Toggle
        icon={<Layers size={16} />}
        label="Enable Differential Backups"
        description="Only backup changes since the last full backup (saves space)"
        checked={mgr.backup.differentialEnabled}
        onChange={(v) => mgr.updateBackup({ differentialEnabled: v })}
        infoTooltip="Emits a compact diff against the previous full backup, periodically anchored by a fresh full backup."
      />

      <div
        className={
          mgr.backup.differentialEnabled
            ? undefined
            : "opacity-50 pointer-events-none"
        }
      >
        <SettingsNumberRow
          icon={<Hash size={16} />}
          label="Full backup interval"
          value={mgr.backup.fullBackupInterval}
          min={1}
          max={30}
          onChange={(v) => mgr.updateBackup({ fullBackupInterval: v })}
          infoTooltip="A full backup is created every N differential backups so restores never need to replay too many diffs."
        />
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          A full backup will be created every{" "}
          {mgr.backup.fullBackupInterval} differential backups
        </p>
      </div>
    </Card>
  </div>
);

export default DifferentialSection;
