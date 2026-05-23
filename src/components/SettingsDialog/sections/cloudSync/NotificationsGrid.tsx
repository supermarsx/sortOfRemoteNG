import { Bell, AlertTriangle } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
function NotificationsGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Bell className="w-4 h-4 text-primary" />}
        title="Notifications"
      />
      <div className="sor-settings-card">
        <div className="grid grid-cols-2 gap-4">
          <label className="sor-toggle-card">
            <Checkbox checked={mgr.cloudSync.notifyOnSync} onChange={(v: boolean) => mgr.updateCloudSync({ notifyOnSync: v })} className="sor-checkbox-sm" />
            <Bell className="w-4 h-4 text-primary" />
            <span className="text-sm text-[var(--color-text)]">
              Notify on Sync
            </span>
          </label>

          <label className="sor-toggle-card">
            <Checkbox checked={mgr.cloudSync.notifyOnConflict} onChange={(v: boolean) => mgr.updateCloudSync({ notifyOnConflict: v })} className="sor-checkbox-sm" />
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-sm text-[var(--color-text)]">
              Notify on Conflict
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default NotificationsGrid;
