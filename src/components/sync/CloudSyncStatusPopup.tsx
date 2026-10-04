import React from "react";
import { CloudSyncStatusIcon } from "./CloudSyncStatusIcon";
import { CloudSyncProviderIcon } from "./CloudSyncProviderIcon";
import { CloudSyncErrorMessage } from "./CloudSyncErrorMessage";
import {
  CloudSync,
  CloudCheck,
  CloudAlert,
  CloudOff,
  CheckCircle,
  Clock,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { CloudSyncProvider } from "../../types/settings/settings";
import {
  ToolbarPopover,
  ToolbarPopoverHeader,
} from "../ui/overlays/ToolbarPopover";
import type { SettingsTabId } from "../SettingsDialog/settingsConstants";
import {
  useCloudSyncStatus,
  PROVIDER_NAMES,
  formatRelativeTime,
} from "../../hooks/sync/useCloudSyncStatus";

interface CloudSyncStatusPopupProps {
  cloudSyncConfig?: {
    enabled: boolean;
    enabledProviders: CloudSyncProvider[];
    syncTargets?: Array<{ provider: CloudSyncProvider; enabled: boolean }>;
    providerStatus: Partial<
      Record<
        CloudSyncProvider,
        {
          enabled: boolean;
          lastSyncTime?: number;
          lastSyncStatus?: "success" | "failed" | "partial" | "conflict";
          lastSyncError?: string;
        }
      >
    >;
    frequency: string;
  };
  onSyncNow?: (provider?: CloudSyncProvider) => Promise<void>;
  /** Opens settings; receives the tab this popup owns (`cloudSync`). */
  onOpenSettings?: (tab?: SettingsTabId) => void;
}

type Mgr = ReturnType<typeof useCloudSyncStatus>;

/* ── Helper icons ────────────────────────────────────────────────── */

const OverallStatusIcon: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.isSyncing)
    return (
      <CloudSyncStatusIcon
        state="syncing"
        label={mgr.t("sync.syncing", "Syncing")}
      />
    );
  if (!mgr.hasSync)
    return <CloudOff className="w-4 h-4 text-[var(--color-textMuted)]" />;
  const statuses = mgr.enabledProviders.map(
    (p) => mgr.config.providerStatus[p]?.lastSyncStatus,
  );
  if (statuses.some((s) => s === "failed"))
    return (
      <CloudSyncStatusIcon
        state="failed"
        label={mgr.t("sync.syncFailed", "Sync failed")}
      />
    );
  if (statuses.some((s) => s === "conflict" || s === "partial"))
    return <CloudAlert className="w-4 h-4 text-warning" />;
  if (statuses.every((s) => s === "success"))
    return <CloudCheck className="w-4 h-4 text-success" />;
  return <CloudSync className="w-4 h-4 text-[var(--color-textSecondary)]" />;
};

const ProviderStatusIcon: React.FC<{
  mgr: Mgr;
  provider: CloudSyncProvider;
}> = ({ mgr, provider }) => {
  const status = mgr.config.providerStatus[provider];
  if (mgr.isProviderSyncing(provider))
    return (
      <CloudSyncStatusIcon
        state="syncing"
        label={`${PROVIDER_NAMES[provider]}: ${mgr.t("sync.syncing", "Syncing")}`}
        className="w-3 h-3"
      />
    );
  if (!status?.lastSyncStatus)
    return <Clock className="w-3 h-3 text-[var(--color-textSecondary)]" />;
  switch (status.lastSyncStatus) {
    case "success":
      return <CheckCircle className="w-3 h-3 text-success" />;
    case "failed":
      return (
        <CloudSyncStatusIcon
          state="failed"
          label={`${PROVIDER_NAMES[provider]}: ${mgr.t("sync.syncFailed", "Sync failed")}`}
          className="w-3 h-3"
        />
      );
    case "conflict":
      return <AlertTriangle className="w-3 h-3 text-warning" />;
    case "partial":
      return <AlertTriangle className="w-3 h-3 text-warning" />;
    default:
      return <Clock className="w-3 h-3 text-[var(--color-textSecondary)]" />;
  }
};

/* ── Sub-components ──────────────────────────────────────────────── */

const EmptyState: React.FC<{
  mgr: Mgr;
  onOpenSettings?: (tab?: SettingsTabId) => void;
}> = ({ mgr, onOpenSettings }) => (
  <div className="text-center py-6">
    <CloudOff className="w-12 h-12 text-[var(--color-textMuted)] mx-auto mb-3" />
    <p className="text-sm text-[var(--color-textSecondary)] mb-4">
      {mgr.t("sync.noProviders", "No sync providers configured")}
    </p>
    <button
      onClick={() => onOpenSettings?.("cloudSync")}
      className="px-4 py-2 bg-primary hover:bg-primary/90 rounded-lg text-sm font-medium transition-colors"
      data-testid="cloud-sync-configure"
    >
      {mgr.t("sync.configure", "Configure Sync")}
    </button>
  </div>
);

const OverallStatusBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
    <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
      <Clock className="w-4 h-4" />
      <span>{mgr.t("sync.lastSync", "Last sync")}:</span>
      <span className="text-[var(--color-textSecondary)]">
        {formatRelativeTime(mgr.getLastSyncTime())}
      </span>
    </div>
    <div className="flex gap-2">
      <button
        onClick={mgr.handleSyncAll}
        disabled={mgr.isSyncing}
        className="flex items-center gap-1.5 px-2 py-1 text-xs bg-success hover:bg-success/90 disabled:opacity-50 rounded transition-colors"
      >
        {mgr.isSyncing ? (
          <CloudSyncStatusIcon
            state="syncing"
            label={mgr.t("sync.syncing", "Syncing")}
            className="w-3 h-3"
            inheritColor
          />
        ) : (
          <CloudSync className="w-3 h-3" />
        )}
        {mgr.t("sync.syncAll", "Sync All")}
      </button>
    </div>
  </div>
);

const ProviderCard: React.FC<{ mgr: Mgr; provider: CloudSyncProvider }> = ({
  mgr,
  provider,
}) => {
  const status = mgr.config.providerStatus[provider];
  const retry =
    status?.lastSyncStatus === "failed" || status?.lastSyncStatus === "partial";
  return (
    <div className="sor-status-item p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CloudSyncProviderIcon provider={provider} />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            {PROVIDER_NAMES[provider]}
          </span>
          <ProviderStatusIcon mgr={mgr} provider={provider} />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => mgr.handleSyncProvider(provider)}
            disabled={mgr.isSyncing}
            className="inline-flex items-center gap-1 p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-success disabled:opacity-50"
            aria-label={`${retry ? mgr.t("sync.retry", "Retry") : mgr.t("sync.syncProvider", "Sync Now")} ${PROVIDER_NAMES[provider]}`}
            title={
              retry
                ? mgr.t("sync.retry", "Retry")
                : mgr.t("sync.syncProvider", "Sync Now")
            }
          >
            {mgr.isProviderSyncing(provider) ? (
              <CloudSyncStatusIcon
                state="syncing"
                label={mgr.t("sync.syncing", "Syncing")}
                className="w-3.5 h-3.5"
              />
            ) : (
              <CloudSync className="w-3.5 h-3.5" />
            )}
            {retry && (
              <span className="text-xs">{mgr.t("sync.retry", "Retry")}</span>
            )}
          </button>
        </div>
      </div>
      <div className="text-xs text-[var(--color-textMuted)]">
        <span>{mgr.t("sync.lastSync", "Last sync")}: </span>
        <span className="text-[var(--color-textSecondary)]">
          {formatRelativeTime(status?.lastSyncTime)}
        </span>
      </div>
      {status?.lastSyncError && (
        <div className="mt-2 p-2 bg-error/20 border border-error rounded text-xs text-error">
          <CloudSyncErrorMessage message={status.lastSyncError} />
        </div>
      )}
    </div>
  );
};

/* ── Root component ──────────────────────────────────────────────── */

export const CloudSyncStatusPopup: React.FC<CloudSyncStatusPopupProps> = ({
  cloudSyncConfig,
  onSyncNow,
  onOpenSettings,
}) => {
  const mgr = useCloudSyncStatus({ cloudSyncConfig, onSyncNow });

  return (
    <div className="relative" ref={mgr.dropdownRef}>
      <button
        onClick={() => mgr.setIsOpen(!mgr.isOpen)}
        className="app-bar-button p-2"
        title={mgr.t("sync.title", "Cloud Sync Status")}
        data-testid="cloud-sync-status"
      >
        <OverallStatusIcon mgr={mgr} />
      </button>

      <ToolbarPopover
        isOpen={mgr.isOpen}
        onClose={() => mgr.setIsOpen(false)}
        anchorRef={mgr.dropdownRef}
        dataTestId="cloud-sync-status-popover"
      >
        <div>
          <ToolbarPopoverHeader
            title={mgr.t("sync.title", "Cloud Sync")}
            icon={<CloudSync className="w-5 h-5 text-primary" />}
            onClose={() => mgr.setIsOpen(false)}
            actions={
              <button
                onClick={() => onOpenSettings?.("cloudSync")}
                className="sor-toolbar-popover-action-btn"
                title={mgr.t("sync.settings", "Sync Settings")}
                data-testid="cloud-sync-open-settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            }
          />
          <div className="p-4">
            {!mgr.hasSync ? (
              <EmptyState mgr={mgr} onOpenSettings={onOpenSettings} />
            ) : (
              <>
                <OverallStatusBar mgr={mgr} />
                <div className="space-y-2">
                  {mgr.enabledProviders.map((provider) => (
                    <ProviderCard
                      key={provider}
                      mgr={mgr}
                      provider={provider}
                    />
                  ))}
                </div>
                {onOpenSettings && (
                  <button
                    type="button"
                    className="mt-3 text-xs text-primary hover:underline"
                    onClick={() => {
                      mgr.setIsOpen(false);
                      onOpenSettings("cloudSync");
                    }}
                  >
                    {mgr.t(
                      "sync.connectionTestsInSettings",
                      "Connection tests are in Sync Settings",
                    )}
                  </button>
                )}
                <div className="mt-4 pt-3 border-t border-[var(--color-border)] text-xs text-[var(--color-textMuted)]">
                  <span>{mgr.t("sync.frequency", "Sync frequency")}: </span>
                  <span className="text-[var(--color-textSecondary)]">
                    {mgr.config.frequency}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </ToolbarPopover>
    </div>
  );
};

export default CloudSyncStatusPopup;
