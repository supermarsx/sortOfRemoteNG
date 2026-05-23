import { Power, LogIn, LogOut } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
function StartupShutdownGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Power className="w-4 h-4 text-primary" />}
        title="Startup & Shutdown"
      />
      <div className="sor-settings-card">
        <div className="grid grid-cols-2 gap-4">
          <label className="sor-toggle-card">
            <Checkbox checked={mgr.cloudSync.syncOnStartup} onChange={(v: boolean) => mgr.updateCloudSync({ syncOnStartup: v })} className="sor-checkbox-sm" />
            <LogIn className="w-4 h-4 text-[var(--color-textSecondary)]" />
            <span className="text-sm text-[var(--color-text)]">
              Sync on Startup
            </span>
          </label>

          <label className="sor-toggle-card">
            <Checkbox checked={mgr.cloudSync.syncOnShutdown} onChange={(v: boolean) => mgr.updateCloudSync({ syncOnShutdown: v })} className="sor-checkbox-sm" />
            <LogOut className="w-4 h-4 text-[var(--color-textSecondary)]" />
            <span className="text-sm text-[var(--color-text)]">
              Sync on Shutdown
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default StartupShutdownGrid;
