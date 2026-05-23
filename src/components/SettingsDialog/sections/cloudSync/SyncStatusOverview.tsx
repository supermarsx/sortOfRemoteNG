import { FolderSync, Check, X, AlertTriangle } from "lucide-react";
import { providerIcons } from "../../../../hooks/settings/useCloudSyncSettings";
import type { Mgr } from "./types";
function SyncStatusOverview({ mgr }: { mgr: Mgr }) {
  const enabledTargets = mgr.syncTargets.filter((t) => t.enabled);
  if (enabledTargets.length === 0) return null;
  return (
    <div className="sor-settings-card">
      <div className="flex items-center gap-2 mb-3">
        <FolderSync className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-[var(--color-text)]">
          Syncing to {enabledTargets.length} target
          {enabledTargets.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {enabledTargets.map((target) => {
          const status = mgr.getProviderStatus(target.provider);
          return (
            <div
              key={target.id}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
                status?.lastSyncStatus === "success"
                  ? "bg-success/20 text-success"
                  : status?.lastSyncStatus === "failed"
                    ? "bg-error/20 text-error"
                    : status?.lastSyncStatus === "conflict"
                      ? "bg-warning/20 text-warning"
                      : "bg-primary/20 text-primary"
              }`}
            >
              {providerIcons[target.provider]}
              <span>{target.label}</span>
              {status?.lastSyncStatus === "success" && (
                <Check className="w-3 h-3" />
              )}
              {status?.lastSyncStatus === "failed" && (
                <X className="w-3 h-3" />
              )}
              {status?.lastSyncStatus === "conflict" && (
                <AlertTriangle className="w-3 h-3" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SyncStatusOverview;
