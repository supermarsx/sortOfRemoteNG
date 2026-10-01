import { FolderSync, Check, AlertTriangle, RefreshCw } from "lucide-react";
import {
  providerIcons,
  providerLabels,
} from "../../../../hooks/settings/useCloudSyncSettings";
import { CloudSyncStatusIcon } from "../../../sync/CloudSyncStatusIcon";
import { Card } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function SyncStatusOverview({ mgr }: { mgr: Mgr }) {
  if (mgr.syncTargets.length === 0) return null;

  const renderTime = (timestamp?: number) => {
    const ms = mgr.getSyncTimestampMs(timestamp);
    if (ms === undefined || !Number.isFinite(ms)) return "Never";
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return "Unknown";
    return <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>;
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FolderSync aria-hidden="true" className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium text-[var(--color-text)]">
          Target sync status
        </h3>
        <span className="text-xs text-[var(--color-textSecondary)]">
          {mgr.syncTargets.length} configured ·{" "}
          {mgr.syncTargets.filter((t) => t.enabled).length} enabled
        </span>
      </div>
      <ul aria-label="Target sync status" className="space-y-2">
        {mgr.syncTargets.map((target) => {
          const status = mgr.getTargetStatus(target.id);
          const syncing = mgr.isTargetSyncing(target.id);
          const result = status?.lastSyncStatus;
          const retry = result === "failed" || result === "partial";
          const resultLabel =
            result === "success"
              ? "Success"
              : result === "failed"
                ? "Failed"
                : result === "partial"
                  ? "Partial"
                  : result === "conflict"
                    ? "Conflict"
                    : "Not synced yet";
          return (
            <li
              key={target.id}
              aria-label={target.label}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true" className="shrink-0">
                      {providerIcons[target.provider]}
                    </span>
                    <span className="break-words [overflow-wrap:anywhere] text-sm font-medium text-[var(--color-text)]">
                      {target.label}
                    </span>
                    <span className="text-xs text-[var(--color-textSecondary)]">
                      {providerLabels[target.provider]}
                    </span>
                    {!target.enabled && (
                      <span className="text-xs text-[var(--color-textMuted)]">
                        Target disabled
                      </span>
                    )}
                    {!mgr.cloudSync.enabled && (
                      <span className="text-xs text-[var(--color-textMuted)]">
                        Cloud sync disabled
                      </span>
                    )}
                  </div>
                  <div
                    role="status"
                    aria-label={`${target.label} sync status`}
                    className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-textSecondary)]"
                  >
                    {syncing ? (
                      <>
                        <CloudSyncStatusIcon
                          state="syncing"
                          label={`Syncing ${target.label}`}
                        />
                        <span>Syncing…</span>
                        <span>· Last result: {resultLabel}</span>
                      </>
                    ) : (
                      <>
                        {result === "failed" && (
                          <CloudSyncStatusIcon
                            state="failed"
                            label={`${target.label} sync failed`}
                          />
                        )}
                        {result === "success" && (
                          <Check
                            aria-hidden="true"
                            className="w-4 h-4 text-success"
                          />
                        )}
                        {(result === "partial" || result === "conflict") && (
                          <AlertTriangle
                            aria-hidden="true"
                            className="w-4 h-4 text-warning"
                          />
                        )}
                        <span>{resultLabel}</span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-textMuted)]">
                    <span>
                      Last attempt: {renderTime(status?.lastSyncTime)}
                    </span>
                    {status?.lastSuccessTime != null &&
                      status.lastSuccessTime !== status.lastSyncTime && (
                        <span>
                          Last success: {renderTime(status.lastSuccessTime)}
                        </span>
                      )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => mgr.handleSyncTarget(target.id)}
                  disabled={
                    !mgr.cloudSync.enabled ||
                    !target.enabled ||
                    Boolean(mgr.validationError) ||
                    mgr.isBusy ||
                    mgr.isSyncing ||
                    syncing
                  }
                  aria-label={`${retry ? "Retry" : "Sync"} ${target.label}`}
                  className="inline-flex shrink-0 self-start items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw aria-hidden="true" className="w-3.5 h-3.5" />
                  {syncing ? "Syncing…" : retry ? "Retry" : "Sync"}
                </button>
              </div>
              {result === "conflict" && (
                <div className="mt-2 space-y-2 text-xs text-[var(--color-textSecondary)]">
                  <p>
                    Choose which copy to keep for this target. Keep local
                    replaces the remote copy; keep remote replaces selected
                    local data. This choice applies only to this retry.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(["keepLocal", "keepRemote"] as const).map(
                      (resolution) => (
                        <button
                          key={resolution}
                          type="button"
                          disabled={
                            !mgr.cloudSync.enabled ||
                            !target.enabled ||
                            Boolean(mgr.validationError) ||
                            mgr.isBusy ||
                            mgr.isSyncing ||
                            syncing
                          }
                          onClick={() =>
                            void mgr.handleResolveConflict(
                              target.id,
                              resolution,
                            )
                          }
                          aria-label={`${resolution === "keepLocal" ? "Keep local" : "Keep remote"} for ${target.label}`}
                          className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surfaceHover)] disabled:opacity-50"
                        >
                          {resolution === "keepLocal"
                            ? "Keep local and retry"
                            : "Keep remote and retry"}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
              {status?.lastSyncError && (
                <details className="mt-2 text-xs text-[var(--color-textSecondary)]">
                  <summary className="cursor-pointer text-error">
                    Error details
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {status.lastSyncError}
                  </p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default SyncStatusOverview;
