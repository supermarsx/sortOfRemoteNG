import React from "react";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  Settings,
  TestTube,
  FileCheck,
  AlertTriangle,
} from "lucide-react";
import { CloudSyncProvider } from "../types/settings";
import { ToolbarPopover, ToolbarPopoverHeader } from "./ui/overlays/ToolbarPopover";
import {
  useCloudSyncStatus,
  PROVIDER_NAMES,
  PROVIDER_ICONS,
  formatRelativeTime,
  SyncTestResult,
} from "../hooks/sync/useCloudSyncStatus";

interface CloudSyncStatusPopupProps {
  cloudSyncConfig?: {
    enabled: boolean;
    enabledProviders: CloudSyncProvider[];
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
  onOpenSettings?: () => void;
}

type Mgr = ReturnType<typeof useCloudSyncStatus>;

/* ── Helper icons ────────────────────────────────────────────────── */

const OverallStatusIcon: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.isSyncing) return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
  if (!mgr.hasSync) return <CloudOff className="w-4 h-4 text-gray-500" />;
  const statuses = mgr.enabledProviders.map((p) => mgr.config.providerStatus[p]?.lastSyncStatus);
  if (statuses.some((s) => s === "failed")) return <AlertCircle className="w-4 h-4 text-red-400" />;
  if (statuses.some((s) => s === "conflict")) return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
  if (statuses.every((s) => s === "success")) return <CheckCircle className="w-4 h-4 text-green-400" />;
  return <Cloud className="w-4 h-4 text-[var(--color-textSecondary)]" />;
};

const ProviderStatusIcon: React.FC<{ mgr: Mgr; provider: CloudSyncProvider }> = ({ mgr, provider }) => {
  const status = mgr.config.providerStatus[provider];
  if (mgr.syncingProvider === provider) return <Loader2 className="w-3 h-3 animate-spin text-blue-400" />;
  if (!status?.lastSyncStatus) return <Clock className="w-3 h-3 text-[var(--color-textSecondary)]" />;
  switch (status.lastSyncStatus) {
    case "success": return <CheckCircle className="w-3 h-3 text-green-400" />;
    case "failed": return <AlertCircle className="w-3 h-3 text-red-400" />;
    case "conflict": return <AlertTriangle className="w-3 h-3 text-yellow-400" />;
    case "partial": return <AlertTriangle className="w-3 h-3 text-orange-400" />;
    default: return <Clock className="w-3 h-3 text-[var(--color-textSecondary)]" />;
  }
};

/* ── Sub-components ──────────────────────────────────────────────── */

const EmptyState: React.FC<{ mgr: Mgr; onOpenSettings?: () => void }> = ({ mgr, onOpenSettings }) => (
  <div className="text-center py-6">
    <CloudOff className="w-12 h-12 text-gray-600 mx-auto mb-3" />
    <p className="text-sm text-[var(--color-textSecondary)] mb-4">
      {mgr.t("sync.noProviders", "No sync providers configured")}
    </p>
    <button onClick={onOpenSettings} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
      {mgr.t("sync.configure", "Configure Sync")}
    </button>
  </div>
);

const OverallStatusBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
    <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
      <Clock className="w-4 h-4" />
      <span>{mgr.t("sync.lastSync", "Last sync")}:</span>
      <span className="text-gray-200">{formatRelativeTime(mgr.getLastSyncTime())}</span>
    </div>
    <div className="flex gap-2">
      <button onClick={mgr.handleTestAll} disabled={mgr.isTesting} className="flex items-center gap-1.5 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded transition-colors" title={mgr.t("sync.testAll", "Test All Connections")}>
        {mgr.isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube className="w-3 h-3" />}
        {mgr.t("sync.test", "Test")}
      </button>
      <button onClick={mgr.handleSyncAll} disabled={mgr.isSyncing} className="flex items-center gap-1.5 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded transition-colors">
        {mgr.isSyncing && !mgr.syncingProvider ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        {mgr.t("sync.syncAll", "Sync All")}
      </button>
    </div>
  </div>
);

const TestResultBadge: React.FC<{ result: SyncTestResult }> = ({ result }) => (
  <div className={`mt-2 p-2 rounded text-xs ${result.success ? "bg-green-900/20 border border-green-800 text-green-300" : "bg-red-900/20 border border-red-800 text-red-300"}`}>
    <div className="flex items-center gap-2">
      {result.success ? <FileCheck className="w-3.5 h-3.5 text-green-400" /> : <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
      <span>{result.message}</span>
    </div>
    {result.latencyMs && (
      <div className="mt-1 text-gray-500">
        Latency: {result.latencyMs}ms
        {result.canRead !== undefined && <> • Read: {result.canRead ? "✓" : "✗"}</>}
        {result.canWrite !== undefined && <> • Write: {result.canWrite ? "✓" : "✗"}</>}
      </div>
    )}
  </div>
);

const ProviderCard: React.FC<{ mgr: Mgr; provider: CloudSyncProvider }> = ({ mgr, provider }) => {
  const status = mgr.config.providerStatus[provider];
  const testResult = mgr.getTestResultForProvider(provider);
  return (
    <div className="sor-status-item p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{PROVIDER_ICONS[provider]}</span>
          <span className="text-sm font-medium text-gray-200">{PROVIDER_NAMES[provider]}</span>
          <ProviderStatusIcon mgr={mgr} provider={provider} />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => mgr.handleTestProvider(provider)} disabled={mgr.testingProvider === provider} className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-blue-400 disabled:opacity-50" title={mgr.t("sync.testProvider", "Test Connection")}>
            {mgr.testingProvider === provider ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => mgr.handleSyncProvider(provider)} disabled={mgr.syncingProvider === provider} className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-green-400 disabled:opacity-50" title={mgr.t("sync.syncProvider", "Sync Now")}>
            {mgr.syncingProvider === provider ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <div className="text-xs text-gray-500">
        <span>{mgr.t("sync.lastSync", "Last sync")}: </span>
        <span className="text-[var(--color-textSecondary)]">{formatRelativeTime(status?.lastSyncTime)}</span>
      </div>
      {status?.lastSyncError && (
        <div className="mt-2 p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-300">{status.lastSyncError}</div>
      )}
      {testResult && <TestResultBadge result={testResult} />}
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
      <button onClick={() => mgr.setIsOpen(!mgr.isOpen)} className="app-bar-button p-2" title={mgr.t("sync.title", "Cloud Sync Status")}>
        <OverallStatusIcon mgr={mgr} />
      </button>

      <ToolbarPopover isOpen={mgr.isOpen} onClose={() => mgr.setIsOpen(false)} anchorRef={mgr.dropdownRef} dataTestId="cloud-sync-status-popover">
        <div>
          <ToolbarPopoverHeader
            title={mgr.t("sync.title", "Cloud Sync")}
            icon={<Cloud className="w-5 h-5 text-blue-400" />}
            onClose={() => mgr.setIsOpen(false)}
            actions={
              <button onClick={onOpenSettings} className="sor-toolbar-popover-action-btn" title={mgr.t("sync.settings", "Sync Settings")}>
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
                    <ProviderCard key={provider} mgr={mgr} provider={provider} />
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-[var(--color-border)] text-xs text-gray-500">
                  <span>{mgr.t("sync.frequency", "Sync frequency")}: </span>
                  <span className="text-[var(--color-textSecondary)]">{mgr.config.frequency}</span>
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
