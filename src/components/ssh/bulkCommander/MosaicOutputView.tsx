import { Mgr, TFunc } from "./types";
import { AlertCircle, Check, Copy, Grid3x3, Terminal } from "lucide-react";
import { Select } from "../../ui/forms";

function MosaicOutputView({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
      <div
        className={`grid gap-4 h-full ${
          mgr.selectedCount <= 1
            ? "grid-cols-1"
            : mgr.selectedCount <= 2
              ? "grid-cols-2"
              : mgr.selectedCount <= 4
                ? "grid-cols-2"
                : mgr.selectedCount <= 6
                  ? "grid-cols-3"
                  : "grid-cols-4"
        }`}
      >
        {mgr.sshSessions
          .filter((s) => mgr.selectedSessionIds.has(s.id))
          .map((session) => {
            const output = mgr.sessionOutputs[session.id];
            return (
              <div
                key={session.id}
                className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-h-[200px]"
              >
                <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surfaceHover)] border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <Terminal
                      size={12}
                      className="text-green-600 dark:text-green-500"
                    />
                    <span className="text-sm font-medium text-[var(--color-text)] truncate">
                      {session.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
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
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(output?.output || "");
                      }}
                      className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors"
                      title={t("common.copy", "Copy")}
                    >
                      <Copy
                        size={12}
                        className="text-[var(--color-textSecondary)]"
                      />
                    </button>
                  </div>
                </div>
                <div className="flex-1 p-3 overflow-auto bg-[var(--color-background)]">
                  <pre className="font-mono text-xs text-green-800 dark:text-green-400 whitespace-pre-wrap">
                    {output?.error ? (
                      <span className="text-red-600 dark:text-red-400">
                        {output.error}
                      </span>
                    ) : (
                      output?.output || (
                        <span className="text-[var(--color-textMuted)]">
                          {t(
                            "bulkSsh.waitingOutput",
                            "Waiting for output...",
                          )}
                        </span>
                      )
                    )}
                  </pre>
                </div>
              </div>
            );
          })}
      </div>
      {mgr.selectedCount === 0 && (
        <div className="flex items-center justify-center h-full text-[var(--color-textSecondary)]">
          <div className="text-center">
            <Grid3x3 size={48} className="mx-auto mb-4 opacity-30" />
            <p>
              {t(
                "bulkSsh.selectSessions",
                "Select SSH sessions from the left panel",
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


export default MosaicOutputView;
