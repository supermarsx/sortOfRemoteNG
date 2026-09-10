import { useState, useMemo, useCallback } from "react";
import { languageLabels, OS_TAG_LABELS } from "./shared";
import { ScriptMetadataIcon } from "./ScriptMetadataIcon";
import HighlightedCode from "../../ui/display/HighlightedCode";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import {
  Check,
  ChevronDown,
  Copy,
  CopyPlus,
  Edit2,
  Loader2,
  Play,
  Trash2,
} from "lucide-react";
import { useConnections } from "../../../contexts/useConnections";
import { useScriptRun } from "../../../hooks/ssh/useScriptRun";
import ScriptOutputPane from "./ScriptOutputPane";

function ScriptDetailView({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  const { state } = useConnections();
  const script = mgr.selectedScript!;

  const [showRunMenu, setShowRunMenu] = useState(false);
  const run = useScriptRun();
  const { status: runStatus, start: startRun, reset: resetRun } = run;
  const running = runStatus === "running";
  const interpreter = ["bash", "sh", "powershell"].includes(script.language)
    ? script.language
    : null;
  const executionUnavailable = !interpreter
    ? "Choose an explicit Bash, sh or PowerShell interpreter before running here. Batch and device CLI commands must use their matching terminal workflow; they are never sent to Bash automatically."
    : null;

  // Get active SSH sessions that can run scripts
  const activeSshSessions = useMemo(
    () =>
      state.sessions.filter(
        (s) =>
          s.protocol === "ssh" &&
          s.status === "connected" &&
          s.backendSessionId,
      ),
    [state.sessions],
  );

  const handleRunOnSession = useCallback(
    async (backendSessionId: string) => {
      setShowRunMenu(false);
      if (runStatus === "running" || !interpreter) return;
      resetRun();

      const lines = script.script
        .split("\n")
        .filter((l) => !l.startsWith("#!"));
      const content = lines.join("\n");

      try {
        await startRun(backendSessionId, content, interpreter);
      } catch {
        // The hook already surfaces the rejection as status "failed" + error.
      }
    },
    [script, interpreter, runStatus, startRun, resetRun],
  );

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-3xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <ScriptMetadataIcon language={script.language} size={24} />
              <h3 className="text-xl font-semibold text-[var(--color-text)]">
                {script.name}
              </h3>
            </div>
            {script.description && (
              <p className="text-sm text-[var(--color-textSecondary)] mt-1">
                {script.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-1 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
                {script.category}
              </span>
              <span className="text-xs px-2 py-1 bg-primary/20 text-primary dark:text-primary rounded">
                {languageLabels[script.language]}
              </span>
              {script.id.startsWith("default-") && (
                <span className="text-xs px-2 py-1 bg-[var(--color-secondary)]/20 text-[var(--color-textSecondary)] rounded">
                  Default
                </span>
              )}
            </div>
            {script.osTags && script.osTags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {script.osTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-primary/10 text-primary dark:text-primary rounded-full"
                  >
                    <ScriptMetadataIcon platform={tag} size={14} />
                    <span>{OS_TAG_LABELS[tag]}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Run on SSH dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  if (activeSshSessions.length === 1) {
                    handleRunOnSession(activeSshSessions[0].backendSessionId!);
                  } else {
                    setShowRunMenu(!showRunMenu);
                  }
                }}
                disabled={
                  activeSshSessions.length === 0 || running || !interpreter
                }
                className="sor-icon-btn text-success disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  executionUnavailable ??
                  (activeSshSessions.length === 0
                    ? t(
                        "scriptManager.noActiveSessions",
                        "No active SSH sessions",
                      )
                    : t("scriptManager.runOnSsh", "Run on SSH"))
                }
              >
                {running ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
                {activeSshSessions.length > 1 && <ChevronDown size={10} />}
              </button>
              {showRunMenu && interpreter && activeSshSessions.length > 1 && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg min-w-[200px] py-1">
                  <div className="px-3 py-1.5 text-xs font-medium text-[var(--color-textMuted)] uppercase">
                    Run on session
                  </div>
                  {activeSshSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleRunOnSession(s.backendSessionId!)}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors"
                    >
                      {s.name || s.hostname}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => mgr.handleCopyScript(script)}
              className="sor-icon-btn"
              title={t("scriptManager.copyToClipboard", "Copy to Clipboard")}
            >
              {mgr.copiedId === script.id ? (
                <Check size={16} className="text-success" />
              ) : (
                <Copy size={16} />
              )}
            </button>
            <button
              onClick={() => mgr.handleDuplicateScript(script)}
              className="sor-icon-btn"
              title={t("scriptManager.duplicate", "Duplicate Script")}
            >
              <CopyPlus size={16} />
            </button>
            <button
              onClick={() => mgr.handleEditScript(script)}
              className="sor-icon-btn"
              title={t("common.edit", "Edit")}
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => mgr.handleDeleteScript(script.id)}
              className="sor-icon-btn-danger"
              title={t("common.delete", "Delete")}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {executionUnavailable && (
          <p role="status" className="mb-3 text-xs text-warning">
            {executionUnavailable}
          </p>
        )}
        <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto">
          <HighlightedCode code={script.script} language={script.language} />
        </div>

        {/* Execution output (streams live while the script runs) */}
        {run.status !== "idle" && (
          <ScriptOutputPane
            chunks={run.chunks}
            status={run.status}
            exitCode={run.exitCode}
            error={run.error}
            truncated={run.truncated}
            durationMs={run.durationMs}
            notices={run.notices}
            onCancel={() => {
              void run.cancel();
            }}
            onDismiss={run.reset}
          />
        )}

        <div className="mt-4 text-xs text-[var(--color-textMuted)]">
          {t("scriptManager.lastUpdated", "Last updated")}:{" "}
          {new Date(script.updatedAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export default ScriptDetailView;
