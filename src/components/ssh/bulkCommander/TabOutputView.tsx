import { Mgr, TFunc } from "./types";
import { Send } from "lucide-react";

function TabOutputView({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  const outputSessions = mgr.sshSessions.filter(
    (session) =>
      mgr.selectedSessionIds.has(session.id) ||
      mgr.previewSessionId === session.id,
  );
  const activeOutput = mgr.activeOutputTab
    ? mgr.sessionOutputs[mgr.activeOutputTab]
    : undefined;
  const previewLoading = mgr.activeOutputTab
    ? mgr.previewLoadingSessionIds.has(mgr.activeOutputTab)
    : false;
  const displayedError = mgr.activeOutputTab
    ? (mgr.previewErrors[mgr.activeOutputTab] ?? activeOutput?.error)
    : activeOutput?.error;

  return (
    <>
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
        {outputSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => mgr.setActiveOutputTab(session.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              mgr.activeOutputTab === session.id
                ? "border-success text-success dark:text-success bg-success/10"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            {session.name}
            {(mgr.sessionOutputs[session.id]?.status === "running" ||
              mgr.previewLoadingSessionIds.has(session.id)) && (
              <span className="ml-2 w-2 h-2 inline-block bg-warning rounded-full animate-pulse" />
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
        {mgr.activeOutputTab && (
          <div className="font-mono text-sm">
            {previewLoading ? (
              <div className="mb-2 text-[10px] font-sans text-[var(--color-textMuted)]">
                {t("bulkSsh.loadingPreview", "Loading terminal preview...")}
              </div>
            ) : activeOutput?.previewedAt ? (
              <div className="mb-2 text-[10px] font-sans text-[var(--color-textMuted)]">
                {t("bulkSsh.peeked", "Peeked")}{" "}
                {activeOutput.previewedAt.toLocaleTimeString()}
              </div>
            ) : null}
            {previewLoading ? (
              <div className="text-[var(--color-textMuted)]">
                {t("bulkSsh.loadingPreview", "Loading terminal preview...")}
              </div>
            ) : displayedError ? (
              <div className="text-error dark:text-error">{displayedError}</div>
            ) : (
              <pre className="text-success dark:text-success whitespace-pre-wrap">
                {activeOutput?.output ||
                  (activeOutput?.previewedAt
                    ? t(
                        "bulkSsh.emptyPeek",
                        "The terminal buffer was empty when peeked.",
                      )
                    : t(
                        "bulkSsh.noOutput",
                        "No dispatch activity yet. Send a command or peek at this session.",
                      ))}
              </pre>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default TabOutputView;
