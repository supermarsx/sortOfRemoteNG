import { Checkbox } from "../../../ui/forms";
import type { Mgr } from "./types";
function StartupShutdownGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <label className="sor-toggle-card">
        <Checkbox checked={mgr.cloudSync.syncOnStartup} onChange={(v: boolean) => mgr.updateCloudSync({ syncOnStartup: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
        <span className="text-sm text-[var(--color-text)]">
          Sync on Startup
        </span>
      </label>

      <label className="sor-toggle-card">
        <Checkbox checked={mgr.cloudSync.syncOnShutdown} onChange={(v: boolean) => mgr.updateCloudSync({ syncOnShutdown: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
        <span className="text-sm text-[var(--color-text)]">
          Sync on Shutdown
        </span>
      </label>
    </div>
  );
}

export default StartupShutdownGrid;
