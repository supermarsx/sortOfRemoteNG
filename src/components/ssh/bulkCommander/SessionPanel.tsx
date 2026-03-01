import { Mgr, TFunc } from "./types";
import { AlertCircle, Check, CheckSquare, Square, Terminal } from "lucide-react";
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
            className="text-xs text-green-700 dark:text-green-400 hover:underline"
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
            return (
              <button
                key={session.id}
                onClick={() => mgr.toggleSessionSelection(session.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                  isSelected
                    ? "bg-green-500/20 border border-green-500/40"
                    : "hover:bg-[var(--color-surfaceHover)] border border-transparent"
                }`}
              >
                {isSelected ? (
                  <CheckSquare
                    size={14}
                    className="text-green-600 dark:text-green-500 flex-shrink-0"
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
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                )}
                {output?.status === "success" && (
                  <Check
                    size={12}
                    className="text-green-600 dark:text-green-500"
                  />
                )}
                {output?.status === "error" && (
                  <AlertCircle size={12} className="text-red-500" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default SessionPanel;
