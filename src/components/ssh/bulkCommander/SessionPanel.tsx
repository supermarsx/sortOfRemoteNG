import { Mgr, TFunc } from "./types";
import {
  AlertCircle,
  Check,
  CheckSquare,
  Eye,
  Loader2,
  RefreshCw,
  Square,
  Terminal,
} from "lucide-react";
import { Select } from "../../ui/forms";

function SessionPanel({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="w-64 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {t("bulkSsh.sshSessions", "SSH Sessions")}
          </span>
          <button
            onClick={mgr.selectAllSessions}
            className="text-xs text-primary hover:underline"
          >
            {mgr.selectedSessionIds.size === mgr.sshSessions.length
              ? t("bulkSsh.deselectAll", "Deselect All")
              : t("bulkSsh.selectAll", "Select All")}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {mgr.sshSessions.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-textSecondary)]">
            <Terminal size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {t("bulkSsh.noSessions", "No active SSH sessions")}
            </p>
            <p className="text-xs mt-1">
              {t("bulkSsh.connectFirst", "Connect to SSH servers first")}
            </p>
          </div>
        ) : (
          mgr.sshSessions.map((session) => {
            const isSelected = mgr.selectedSessionIds.has(session.id);
            const output = mgr.sessionOutputs[session.id];
            const isPreviewLoading = mgr.previewLoadingSessionIds.has(
              session.id,
            );
            const previewFailed = Boolean(mgr.previewErrors[session.id]);
            const previewAction = isPreviewLoading
              ? t("bulkSsh.loadingSessionPreview", `Loading ${session.name}`)
              : output?.previewedAt
                ? t("bulkSsh.refreshSessionPreview", `Refresh ${session.name}`)
                : previewFailed
                  ? t("bulkSsh.retrySessionPreview", `Retry ${session.name}`)
                  : t("bulkSsh.peekSession", `Peek ${session.name}`);
            return (
              <div key={session.id} className="flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => mgr.toggleSessionSelection(session.id)}
                  aria-pressed={isSelected}
                  aria-label={t(
                    isSelected
                      ? "bulkSsh.removeCommandRecipient"
                      : "bulkSsh.addCommandRecipient",
                    isSelected
                      ? `Remove ${session.name} from command recipients`
                      : `Add ${session.name} to command recipients`,
                  )}
                  className={`min-w-0 flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                    isSelected
                      ? "bg-primary/20 border border-primary/40"
                      : "hover:bg-[var(--color-surfaceHover)] border border-transparent"
                  }`}
                >
                  {isSelected ? (
                    <CheckSquare
                      size={14}
                      className="text-primary flex-shrink-0"
                    />
                  ) : (
                    <Square
                      size={14}
                      className="text-[var(--color-textSecondary)] flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--color-text)] truncate">
                      {session.name}
                    </div>
                    <div className="text-xs text-[var(--color-textSecondary)] truncate">
                      {session.hostname}
                    </div>
                  </div>
                  {output?.status === "running" && (
                    <div className="w-2 h-2 bg-warning rounded-full animate-pulse" />
                  )}
                  {output?.status === "dispatched" && (
                    <Check size={12} className="text-info" />
                  )}
                  {output?.status === "cancelled" && (
                    <AlertCircle size={12} className="text-error" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void mgr.peekSession(session.id)}
                  disabled={!session.backendSessionId || isPreviewLoading}
                  className="px-2 rounded-lg border border-transparent text-[var(--color-textSecondary)] hover:text-primary hover:bg-[var(--color-surfaceHover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label={previewAction}
                  title={t(
                    "bulkSsh.peekSessionTitle",
                    `Read ${session.name}'s live backend terminal buffer into this view. This does not change command recipients or clear the backend buffer.`,
                  )}
                >
                  {isPreviewLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : output?.previewedAt || previewFailed ? (
                    <RefreshCw size={14} />
                  ) : (
                    <Eye size={14} />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default SessionPanel;
