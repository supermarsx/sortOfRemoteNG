import { Settings } from "lucide-react";
import type { useToastContext } from "../../contexts/ToastContext";
import type { SettingsTabId } from "../SettingsDialog/settingsConstants";
import { claimCloudSyncFailureNotification } from "../../utils/services/cloudSyncNotifications";
import { openCloudSyncConflictReview } from "../../utils/settings/cloudSyncReviewNavigation";

export function showCloudSyncReviewToast(
  toast: Pick<
    ReturnType<typeof useToastContext>["toast"],
    "error" | "warning" | "update"
  >,
  openSettings: (tab?: SettingsTabId) => void,
  message: string,
  type: "error" | "warning" = "error",
  failureIntervalMinutes?: number,
) {
  if (
    type === "error" &&
    !claimCloudSyncFailureNotification(failureIntervalMinutes)
  )
    return null;
  const id = toast[type](message, 10_000);
  toast.update(id, {
    action: {
      label: "Open sync settings",
      icon: Settings,
      onClick: () => openCloudSyncConflictReview(openSettings),
    },
  });
  return id;
}
