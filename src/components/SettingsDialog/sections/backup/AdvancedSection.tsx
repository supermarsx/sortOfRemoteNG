import React from "react";
import { Settings } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import CollapsibleSection from "../../../ui/CollapsibleSection";

const AdvancedSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <CollapsibleSection
      title="Advanced Options"
      icon={<Settings className="w-4 h-4" />}
      open={mgr.showAdvanced}
      onToggle={(v) => mgr.setShowAdvanced(v)}
    >
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-[var(--color-text)]">
              Backup on App Close
            </span>
            <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
              Create a backup when closing the application
            </p>
          </div>
          <Checkbox checked={mgr.backup.backupOnClose} onChange={(v: boolean) => mgr.updateBackup({ backupOnClose: v })} className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
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
          <Checkbox checked={mgr.backup.notifyOnBackup} onChange={(v: boolean) => mgr.updateBackup({ notifyOnBackup: v })} className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
        </label>
    </CollapsibleSection>
  </div>
);

export default AdvancedSection;
