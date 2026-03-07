import { Mgr, TFunc } from "./types";
import { Send } from "lucide-react";

function TabOutputView({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <>
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
        {mgr.sshSessions
          .filter((s) => mgr.selectedSessionIds.has(s.id))
          .map((session) => (
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
              {mgr.sessionOutputs[session.id]?.status === "running" && (
                <span className="ml-2 w-2 h-2 inline-block bg-warning rounded-full animate-pulse" />
              )}
            </button>
          ))}
      </div>
      <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
        {mgr.activeOutputTab &&
          mgr.sessionOutputs[mgr.activeOutputTab] && (
            <div className="font-mono text-sm">
              {mgr.sessionOutputs[mgr.activeOutputTab].error ? (
                <div className="text-error dark:text-error">
                  {mgr.sessionOutputs[mgr.activeOutputTab].error}
                </div>
              ) : (
                <pre className="text-success dark:text-success whitespace-pre-wrap">
                  {mgr.sessionOutputs[mgr.activeOutputTab].output ||
                    t(
                      "bulkSsh.noOutput",
                      "No output yet. Send a command to see results.",
                    )}
                </pre>
              )}
            </div>
          )}
      </div>
    </>
  );
}

export default TabOutputView;
