import { Bell, AlertTriangle } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import type { Mgr } from "./types";
function NotificationsGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <label className="sor-toggle-card">
        <Checkbox checked={mgr.cloudSync.notifyOnSync} onChange={(v: boolean) => mgr.updateCloudSync({ notifyOnSync: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
        <Bell className="w-4 h-4 text-blue-400" />
        <span className="text-sm text-[var(--color-text)]">
          Notify on Sync
        </span>
      </label>

      <label className="sor-toggle-card">
        <Checkbox checked={mgr.cloudSync.notifyOnConflict} onChange={(v: boolean) => mgr.updateCloudSync({ notifyOnConflict: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
        <AlertTriangle className="w-4 h-4 text-orange-400" />
        <span className="text-sm text-[var(--color-text)]">
          Notify on Conflict
        </span>
      </label>
    </div>
  );
}

export default NotificationsGrid;
