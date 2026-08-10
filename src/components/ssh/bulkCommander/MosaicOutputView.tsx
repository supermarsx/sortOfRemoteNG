import { Mgr, TFunc } from "./types";
import { AlertCircle, Check, Copy, Grid3x3, Terminal } from "lucide-react";
import { Select } from "../../ui/forms";

function MosaicOutputView({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  const outputSessions = mgr.sshSessions.filter(
    (session) =>
      mgr.selectedSessionIds.has(session.id) ||
      mgr.previewSessionId === session.id,
  );

  return (
    <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
      <div
        className={`grid gap-4 h-full ${
          outputSessions.length <= 1
            ? "grid-cols-1"
            : outputSessions.length <= 2
              ? "grid-cols-2"
              : outputSessions.length <= 4
                ? "grid-cols-2"
                : outputSessions.length <= 6
                  ? "grid-cols-3"
                  : "grid-cols-4"
        }`}
      >
        {outputSessions.map((session) => {
          const output = mgr.sessionOutputs[session.id];
          const previewLoading = mgr.previewLoadingSessionIds.has(session.id);
          const displayedError = mgr.previewErrors[session.id] ?? output?.error;
          return (
            <div
              key={session.id}
              className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-h-[200px]"
            >
              <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surfaceHover)] border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <Terminal
                    size={12}
                    className="text-success dark:text-success"
                  />
                  <span className="text-sm font-medium text-[var(--color-text)] truncate">
                    {session.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {previewLoading ? (
                    <span className="text-[10px] text-[var(--color-textMuted)]">
                      {t(
                        "bulkSsh.loadingPreview",
                        "Loading terminal preview...",
                      )}
                    </span>
                  ) : output?.previewedAt ? (
                    <span className="text-[10px] text-[var(--color-textMuted)]">
                      {t("bulkSsh.peeked", "Peeked")}{" "}
                      {output.previewedAt.toLocaleTimeString()}
                    </span>
                  ) : null}
                  {output?.status === "running" && (
                    <div className="w-2 h-2 bg-warning rounded-full animate-pulse" />
                  )}
                  {output?.status === "dispatched" && (
                    <Check size={12} className="text-info" />
                  )}
                  {output?.status === "cancelled" && (
                    <AlertCircle size={12} className="text-error" />
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
                <pre className="font-mono text-xs text-success dark:text-success whitespace-pre-wrap">
                  {previewLoading ? (
                    <span className="text-[var(--color-textMuted)]">
                      {t(
                        "bulkSsh.loadingPreview",
                        "Loading terminal preview...",
                      )}
                    </span>
                  ) : displayedError ? (
                    <span className="text-error dark:text-error">
                      {displayedError}
                    </span>
                  ) : (
                    output?.output || (
                      <span className="text-[var(--color-textMuted)]">
                        {output?.previewedAt
                          ? t(
                              "bulkSsh.emptyPeek",
                              "The terminal buffer was empty when peeked.",
                            )
                          : t(
                              "bulkSsh.waitingOutput",
                              "Waiting to dispatch command input or peek at this session...",
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
      {outputSessions.length === 0 && (
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
