import { Bell, AlertTriangle } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function NotificationsGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Bell className="w-4 h-4 text-primary" />}
        title="Notifications"
      />
      <Card>
        <Toggle
          icon={<Bell size={16} />}
          label="Notify on Sync"
          description="Show a desktop notification when a sync completes"
          checked={mgr.cloudSync.notifyOnSync}
          onChange={(v) => mgr.updateCloudSync({ notifyOnSync: v })}
          infoTooltip="Show a desktop notification each time a cloud sync completes successfully."
        />

        <Toggle
          icon={<AlertTriangle size={16} />}
          label="Notify on Conflict"
          description="Show a notification when a sync conflict needs attention"
          checked={mgr.cloudSync.notifyOnConflict}
          onChange={(v) => mgr.updateCloudSync({ notifyOnConflict: v })}
          infoTooltip="Show a desktop notification when the local and cloud copies have diverged and the configured strategy needs to step in."
        />
      </Card>
    </div>
  );
}

export default NotificationsGrid;
