import React from "react";
import { Calendar, Info } from "lucide-react";

const LastBackupInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.backup.lastBackupTime) return null;

  return (
    <div className="sor-section-card">
      <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
        <Info className="w-4 h-4 text-blue-400" />
        <span>
          Last backup:{" "}
          <span className="text-[var(--color-text)]">
            {new Date(mgr.backup.lastBackupTime).toLocaleString()}
          </span>
        </span>
      </div>
      {mgr.backup.differentialEnabled && mgr.backup.lastFullBackupTime && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)] mt-1">
          <Calendar className="w-4 h-4 text-purple-400" />
          <span>
            Last full backup:{" "}
            <span className="text-[var(--color-text)]">
              {new Date(mgr.backup.lastFullBackupTime).toLocaleString()}
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

export default LastBackupInfo;
