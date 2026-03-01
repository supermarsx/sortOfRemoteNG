import React from "react";
import { Archive } from "lucide-react";
import { Checkbox } from "../../../ui/forms";

const EnableBackup: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="sor-section-card">
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
      <Checkbox checked={mgr.backup.enabled} onChange={(v: boolean) => mgr.updateBackup({ enabled: v })} className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
    </label>
  </div>
);

export default EnableBackup;
