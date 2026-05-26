import type { Mgr } from './types';
import React from "react";
import { Settings, LogOut, Bell } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const AdvancedSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Settings className="w-4 h-4 text-primary" />}
      title="Advanced Options"
    />

    <Card>
      <Toggle
        icon={<LogOut size={16} />}
        label="Backup on App Close"
        description="Create a backup when closing the application"
        checked={mgr.backup.backupOnClose}
        onChange={(v) => mgr.updateBackup({ backupOnClose: v })}
        infoTooltip="Trigger a one-off backup to all enabled destinations when the app is shutting down. Skipped if a backup is already in progress."
      />

      <Toggle
        icon={<Bell size={16} />}
        label="Show Notifications"
        description="Display a notification after successful backup"
        checked={mgr.backup.notifyOnBackup}
        onChange={(v) => mgr.updateBackup({ notifyOnBackup: v })}
        infoTooltip="Show a desktop notification after each scheduled backup completes (or fails). Disable for fully silent operation."
      />
    </Card>
  </div>
);

export default AdvancedSection;
