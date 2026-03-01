import { FolderSync, Check, X, AlertTriangle } from "lucide-react";
import { providerLabels, providerIcons } from "../../../../hooks/settings/useCloudSyncSettings";
import type { Mgr } from "./types";
function SyncStatusOverview({ mgr }: { mgr: Mgr }) {
  return (
    <div className="sor-section-card">
      <div className="flex items-center gap-2 mb-3">
        <FolderSync className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-[var(--color-text)]">
          Syncing to {mgr.enabledProviders.length} target
          {mgr.enabledProviders.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {mgr.enabledProviders.map((provider) => {
          const status = mgr.getProviderStatus(provider);
          return (
            <div
              key={provider}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
                status?.lastSyncStatus === "success"
                  ? "bg-green-500/20 text-green-400"
                  : status?.lastSyncStatus === "failed"
                    ? "bg-red-500/20 text-red-400"
                    : status?.lastSyncStatus === "conflict"
                      ? "bg-orange-500/20 text-orange-400"
                      : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {providerIcons[provider]}
              <span>{providerLabels[provider].split(" ")[0]}</span>
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
