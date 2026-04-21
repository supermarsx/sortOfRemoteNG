import { useState, useMemo, useCallback } from "react";
import { languageIcons, languageLabels, OS_TAG_ICONS, OS_TAG_LABELS } from "./shared";
import HighlightedCode from "../../ui/display/HighlightedCode";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { Check, ChevronDown, Copy, CopyPlus, Edit2, Loader2, Play, Trash2 } from "lucide-react";
import { useConnections } from "../../../contexts/useConnections";
import { invoke } from "@tauri-apps/api/core";

function ScriptDetailView({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  const { state } = useConnections();
  const script = mgr.selectedScript!;

  const [showRunMenu, setShowRunMenu] = useState(false);
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ output?: string; error?: string; exitCode?: number; stderr?: string } | null>(null);

  // Get active SSH sessions that can run scripts
  const activeSshSessions = useMemo(() =>
    state.sessions.filter(
      (s) => s.protocol === "ssh" && s.status === "connected" && s.backendSessionId,
    ),
    [state.sessions],
  );

  const handleRunOnSession = useCallback(async (backendSessionId: string) => {
    setShowRunMenu(false);
    setRunningSessionId(backendSessionId);
    setRunResult(null);

    const interpreter = script.language === "powershell" ? "powershell"
      : script.language === "sh" ? "sh"
      : "bash";

    const lines = script.script.split("\n").filter((l) => !l.startsWith("#!"));
    const content = lines.join("\n");

    try {
      const result = await invoke<{ stdout: string; stderr: string; exitCode: number }>("execute_script", {
        sessionId: backendSessionId,
        script: content,
        interpreter,
      });
      setRunResult({
        output: result.stdout || "(no output)",
        stderr: result.stderr || undefined,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? `Script exited with code ${result.exitCode}` : undefined,
      });
    } catch (err) {
      setRunResult({ error: typeof err === "string" ? err : String(err) });
    } finally {
      setRunningSessionId(null);
    }
  }, [script]);

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-3xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{languageIcons[script.language]}</span>
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
              {script.id.startsWith('default-') && (
                <span className="text-xs px-2 py-1 bg-[var(--color-secondary)]/20 text-[var(--color-textSecondary)] rounded">
                  Default
                </span>
              )}
            </div>
            {script.osTags && script.osTags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {script.osTags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-primary/10 text-primary dark:text-primary rounded-full"
                  >
                    <span>{OS_TAG_ICONS[tag]}</span>
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
                disabled={activeSshSessions.length === 0 || runningSessionId !== null}
                className="sor-icon-btn text-success disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  activeSshSessions.length === 0
                    ? t('scriptManager.noActiveSessions', 'No active SSH sessions')
                    : t('scriptManager.runOnSsh', 'Run on SSH')
                }
              >
                {runningSessionId ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
                {activeSshSessions.length > 1 && <ChevronDown size={10} />}
              </button>
              {showRunMenu && activeSshSessions.length > 1 && (
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
              title={t('scriptManager.copyToClipboard', 'Copy to Clipboard')}
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
              title={t('scriptManager.duplicate', 'Duplicate Script')}
            >
              <CopyPlus size={16} />
            </button>
            <button
              onClick={() => mgr.handleEditScript(script)}
              className="sor-icon-btn"
              title={t('common.edit', 'Edit')}
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => mgr.handleDeleteScript(script.id)}
              className="sor-icon-btn-danger"
              title={t('common.delete', 'Delete')}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto">
          <HighlightedCode code={script.script} language={script.language} />
        </div>

        {/* Execution result panel */}
        {runResult && (
          <div className={`mt-4 p-4 rounded-lg border ${runResult.exitCode !== undefined && runResult.exitCode !== 0 ? 'border-red-500/30 bg-red-500/5' : runResult.error ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/30 bg-green-500/5'}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${runResult.error || (runResult.exitCode !== undefined && runResult.exitCode !== 0) ? 'text-red-400' : 'text-green-400'}`}>
                  {runResult.error ? 'Execution Failed' : 'Execution Output'}
                </span>
                {runResult.exitCode !== undefined && (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${runResult.exitCode === 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    exit {runResult.exitCode}
                  </span>
                )}
              </div>
              <button
                onClick={() => setRunResult(null)}
                className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
              >
                Dismiss
              </button>
            </div>
            {runResult.output && (
              <pre className="text-xs whitespace-pre-wrap font-mono text-[var(--color-text)] max-h-[300px] overflow-auto">
                {runResult.output}
              </pre>
            )}
            {runResult.stderr && (
              <div className="mt-2">
                <span className="text-xs font-medium text-red-400">stderr:</span>
                <pre className="text-xs whitespace-pre-wrap font-mono text-red-300 max-h-[150px] overflow-auto mt-1">
                  {runResult.stderr}
                </pre>
              </div>
            )}
            {runResult.error && !runResult.output && (
              <pre className="text-xs whitespace-pre-wrap font-mono text-red-300 max-h-[300px] overflow-auto">
                {runResult.error}
              </pre>
            )}
          </div>
        )}

        <div className="mt-4 text-xs text-[var(--color-textMuted)]">
          {t('scriptManager.lastUpdated', 'Last updated')}: {new Date(script.updatedAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export default ScriptDetailView;
