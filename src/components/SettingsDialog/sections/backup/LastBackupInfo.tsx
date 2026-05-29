import type { Mgr } from './types';
import React from "react";
import { Calendar, Info } from "lucide-react";
import { Card } from "../../../ui/settings/SettingsPrimitives";

const LastBackupInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.backup.lastBackupTime) return null;

  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
        <Info className="w-4 h-4 text-primary" />
        <span>
          Last backup:{" "}
          <span className="text-[var(--color-text)]">
            {new Date(mgr.backup.lastBackupTime).toLocaleString()}
          </span>
        </span>
      </div>
      {mgr.backup.differentialEnabled && mgr.backup.lastFullBackupTime && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)] mt-1">
          <Calendar className="w-4 h-4 text-primary" />
          <span>
            Last full backup:{" "}
            <span className="text-[var(--color-text)]">
              {new Date(mgr.backup.lastFullBackupTime).toLocaleString()}
            </span>
          </span>
        </div>
      )}
    </Card>
  );
};

export default LastBackupInfo;
