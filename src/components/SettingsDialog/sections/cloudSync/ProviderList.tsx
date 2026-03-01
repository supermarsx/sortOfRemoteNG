import ProviderConfig from "./ProviderConfig";
import { Cloud, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { CloudSyncProviders } from "../../../../types/settings";
import { providerLabels, providerDescriptions, providerIcons } from "../../../../hooks/settings/useCloudSyncSettings";
import { Checkbox } from "../../../ui/forms";
import type { Mgr } from "./types";
function ProviderList({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
          <Cloud className="w-4 h-4 inline mr-2" />
          Sync Targets
        </label>
        <span className="text-xs text-[var(--color-textMuted)]">
          Enable multiple targets for redundancy
        </span>
      </div>

      <div className="space-y-2">
        {CloudSyncProviders.filter((p) => p !== "none").map((provider) => {
          const isEnabled = mgr.enabledProviders.includes(provider);
          const isExpanded = mgr.expandedProvider === provider;
          const status = mgr.getProviderStatus(provider);

          return (
            <div
              key={provider}
              className={`rounded-lg border transition-all ${
                isEnabled
                  ? "border-blue-500/50 bg-blue-500/10"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]/50"
              }`}
            >
              {/* Provider Header */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <label className="flex items-center cursor-pointer">
                    <Checkbox checked={isEnabled} onChange={() => mgr.toggleProvider(provider)} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
                  </label>
                  <div className="flex items-center gap-2">
                    {providerIcons[provider]}
                    <div>
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {providerLabels[provider]}
                      </div>
                      <div className="text-xs text-[var(--color-textSecondary)]">
                        {providerDescriptions[provider]}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isEnabled && status?.lastSyncTime && (
                    <span className="text-xs text-[var(--color-textMuted)]">
                      {new Date(
                        mgr.getSyncTimestampMs(status.lastSyncTime) ?? 0,
                      ).toLocaleDateString()}
                    </span>
                  )}

                  {isEnabled && (
                    <button
                      onClick={() => mgr.handleSyncProvider(provider)}
                      disabled={
                        mgr.syncingProvider === provider || mgr.isSyncing
                      }
                      className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Sync to ${providerLabels[provider]}`}
                    >
                      <RefreshCw className="w-4 h-4 text-[var(--color-textSecondary)]" />
                    </button>
                  )}

                  {isEnabled && (
                    <button
                      onClick={() =>
                        mgr.setExpandedProvider(isExpanded ? null : provider)
                      }
                      className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-[var(--color-textSecondary)]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[var(--color-textSecondary)]" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Provider Configuration (expanded) */}
              {isEnabled && isExpanded && (
                <div className="border-t border-[var(--color-border)] p-3">
                  <ProviderConfig provider={provider} mgr={mgr} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ProviderList;
