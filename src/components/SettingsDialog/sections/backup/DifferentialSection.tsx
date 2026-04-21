import type { Mgr } from './types';
import React from "react";
import { HardDrive } from "lucide-react";
import { Checkbox, NumberInput } from "../../../ui/forms";

const DifferentialSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <HardDrive className="w-4 h-4 text-primary" />
      Differential Backups
    </h4>

    <div className="sor-settings-sub-card">
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <span className="text-[var(--color-text)]">
            Enable Differential Backups
          </span>
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            Only backup changes since the last full backup (saves space)
          </p>
        </div>
        <Checkbox checked={mgr.backup.differentialEnabled} onChange={(v: boolean) => mgr.updateBackup({ differentialEnabled: v })} className="sor-checkbox-lg" />
      </label>

      {mgr.backup.differentialEnabled && (
        <div className="space-y-2 pl-4 border-l-2 border-accent/30">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Full backup every N backups
          </label>
          <NumberInput value={mgr.backup.fullBackupInterval} onChange={(v: number) => mgr.updateBackup({
                fullBackupInterval: v,
              })} className="w-24 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]" min={1} max={30} />
          <p className="text-xs text-[var(--color-textMuted)]">
            A full backup will be created every{" "}
            {mgr.backup.fullBackupInterval} differential backups
          </p>
        </div>
      )}
    </div>
  </div>
);

export default DifferentialSection;
