import { Cloud } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import type { Mgr } from "./types";
function EnableSyncToggle({ mgr }: { mgr: Mgr }) {
  return (
    <div className="sor-section-card">
      <label className="flex items-center justify-between cursor-pointer">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Cloud className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <span className="text-[var(--color-text)] font-medium">
              Enable Cloud Sync
            </span>
            <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
              Synchronize your connections and settings across devices
            </p>
          </div>
        </div>
        <Checkbox checked={mgr.cloudSync.enabled} onChange={(v: boolean) => mgr.updateCloudSync({ enabled: v })} className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
      </label>
    </div>
  );
}

export default EnableSyncToggle;
