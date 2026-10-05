import { Bell, AlertTriangle, Clock } from "lucide-react";
import {
  MAX_CLOUD_SYNC_INTERVAL_MINUTES,
  normalizeCloudSyncFailureNotificationMinutes,
} from "../../../../types/settings/cloudSyncSettings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
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
          settingKey="cloudSync.notifyOnSync"
          icon={<Bell size={16} />}
          label="Notify on Sync Failure"
          description="Show an in-app notification when sync does not complete"
          checked={mgr.cloudSync.notifyOnSync}
          onChange={(v) => mgr.updateCloudSync({ notifyOnSync: v })}
          infoTooltip="Repeated failures respect the interval below. Target statuses always update, even with notifications off."
        />

        <Toggle
          settingKey="cloudSync.notifyOnSyncSuccess"
          icon={<Bell size={16} />}
          label="Notify on Sync Success"
          description="Show a toast when cloud sync completes successfully. Off by default."
          checked={mgr.cloudSync.notifyOnSyncSuccess === true}
          onChange={(v) => mgr.updateCloudSync({ notifyOnSyncSuccess: v })}
          infoTooltip="Applies to manual and automatic sync. Successful syncs still appear in target statuses when this is off."
        />

        <SettingsNumberRow
          settingKey="cloudSync.failureNotificationIntervalMinutes"
          icon={<Clock size={16} />}
          label="Sync Failure Notification Interval"
          description="First failure is shown immediately; repeated failures are limited across all targets. Target statuses always update. 0 shows every failure."
          value={normalizeCloudSyncFailureNotificationMinutes(
            mgr.cloudSync.failureNotificationIntervalMinutes,
          )}
          min={0}
          max={MAX_CLOUD_SYNC_INTERVAL_MINUTES}
          step={1}
          unit="minutes"
          onChange={(value) =>
            mgr.updateCloudSync({
              failureNotificationIntervalMinutes:
                normalizeCloudSyncFailureNotificationMinutes(value),
            })
          }
        />

        <Toggle
          settingKey="cloudSync.notifyOnConflict"
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
