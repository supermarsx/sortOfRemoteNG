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
                  ? "border-green-500 text-green-700 dark:text-green-400 bg-green-500/10"
                  : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
              }`}
            >
              {session.name}
              {mgr.sessionOutputs[session.id]?.status === "running" && (
                <span className="ml-2 w-2 h-2 inline-block bg-yellow-500 rounded-full animate-pulse" />
              )}
            </button>
          ))}
      </div>
      <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
        {mgr.activeOutputTab &&
          mgr.sessionOutputs[mgr.activeOutputTab] && (
            <div className="font-mono text-sm">
              {mgr.sessionOutputs[mgr.activeOutputTab].error ? (
                <div className="text-red-600 dark:text-red-400">
                  {mgr.sessionOutputs[mgr.activeOutputTab].error}
                </div>
              ) : (
                <pre className="text-green-800 dark:text-green-400 whitespace-pre-wrap">
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
