import type { Mgr } from './types';
import React from "react";
import { Settings } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";

const AdvancedSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Settings className="w-4 h-4 text-primary" />}
      title="Advanced Options"
    />

    <div className="sor-settings-card">
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <span className="text-[var(--color-text)]">
            Backup on App Close
          </span>
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            Create a backup when closing the application
          </p>
        </div>
        <Checkbox checked={mgr.backup.backupOnClose} onChange={(v: boolean) => mgr.updateBackup({ backupOnClose: v })} className="sor-checkbox-lg" />
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
        <Checkbox checked={mgr.backup.notifyOnBackup} onChange={(v: boolean) => mgr.updateBackup({ notifyOnBackup: v })} className="sor-checkbox-lg" />
      </label>
    </div>
  </div>
);

export default AdvancedSection;
