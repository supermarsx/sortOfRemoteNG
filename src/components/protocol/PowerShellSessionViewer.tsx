"use client";

import {
  ClipboardCopy,
  CornerDownLeft,
  Eraser,
  LogOut,
  Play,
  RefreshCw,
  Send,
  Square,
  TerminalSquare,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { usePowerShellSession } from "../../hooks/protocol/usePowerShellSession";
import type { PowerShellStreamKind } from "../../hooks/protocol/powerShellSessionRuntime";
import type { ConnectionSession } from "../../types/connection/connection";

const STREAM_STYLES: Record<PowerShellStreamKind, string> = {
  output: "text-[var(--color-text)]",
  error: "text-error",
  warning: "text-warning",
  verbose: "text-info",
  debug: "text-[var(--color-textMuted)]",
  information: "text-primary",
  progress: "text-success",
  pipeline_state: "text-[var(--color-textMuted)]",
  session_state: "text-[var(--color-textMuted)]",
};

const actionMessage = (cause: unknown): string =>
  cause instanceof Error
    ? cause.message
    : typeof cause === "string"
      ? cause
      : "The PowerShell operation failed.";

export const PowerShellSessionViewer: React.FC<{
  session: ConnectionSession;
}> = ({ session }) => {
  const model = usePowerShellSession(session);
  const [script, setScript] = useState("Get-Date\n$PSVersionTable.PSVersion");
  const [acceptsInput, setAcceptsInput] = useState(false);
  const [pipelineInput, setPipelineInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const active = Boolean(model.backend?.activePipelineId);
  const canRun = model.status === "ready" && !active;
  const activeTransport =
    model.backend?.diagnostics.transport ?? model.transport;
  const isWsman = activeTransport === "wsman";

  const transcript = useMemo(
    () =>
      model.events
        .filter(
          (event) => event.kind !== "session_state" || event.text === "failed",
        )
        .map((event) => `${event.kind}: ${event.text}`)
        .join("\n"),
    [model.events],
  );

  const perform = async (operation: () => Promise<unknown>) => {
    try {
      setActionError(null);
      await operation();
    } catch (cause) {
      setActionError(actionMessage(cause));
    }
  };

  const run = () =>
    perform(async () => {
      if (!script.trim()) throw new Error("Enter a PowerShell command first.");
      await model.execute(script, acceptsInput);
    });

  const sendInput = () =>
    perform(async () => {
      await model.sendInput({ type: "string", value: pipelineInput });
      setPipelineInput("");
    });

  const copyTranscript = () =>
    perform(async () => {
      if (!navigator.clipboard) {
        throw new Error("Clipboard access is unavailable in this window.");
      }
      await navigator.clipboard.writeText(transcript);
    });

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label={`PowerShell session to ${session.hostname}`}
      data-testid="powershell-session-viewer"
    >
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <TerminalSquare size={15} className="text-primary" aria-hidden />
          <strong>PowerShell over {isWsman ? "WSMan" : "SSH"}</strong>
          <span
            className="rounded-full border border-[var(--color-border)] px-2 py-1 font-medium uppercase"
            role="status"
            aria-live="polite"
          >
            {model.status}
          </span>
          <span className="text-[var(--color-textMuted)]">
            {session.hostname}
            {model.backend ? `:${model.backend.port}` : ""}
          </span>
          {model.backend?.runspaceId ? (
            <span
              className="font-mono text-[var(--color-textMuted)]"
              title={model.backend.runspaceId}
            >
              runspace {model.backend.runspaceId.slice(0, 8)}
            </span>
          ) : null}
          <span className="ml-auto text-[var(--color-textMuted)]">
            {model.backend
              ? `${model.backend.stats.pipelinesCompleted} completed · ${model.backend.stats.pipelinesFailed} failed · ${model.backend.stats.pipelinesCancelled} cancelled`
              : isWsman
                ? "Opening Trust Center-verified WSMan runspace"
                : "Opening verified SSH runspace"}
          </span>
        </div>
        {isWsman ? (
          <div
            className="mt-2 inline-flex rounded border border-warning/30 bg-warning/5 px-2 py-1 text-[10px] text-warning"
            data-testid="powershell-wsman-verification"
            title={model.backend?.diagnostics.limitations.join(" · ")}
          >
            Deterministic contract verified · live Windows unverified · direct
            endpoints only
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surfaceHover)]"
            onClick={() => void copyTranscript()}
            disabled={!transcript}
          >
            <ClipboardCopy size={13} aria-hidden /> Copy output
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surfaceHover)]"
            onClick={model.clear}
          >
            <Eraser size={13} aria-hidden /> Clear
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surfaceHover)] disabled:opacity-50"
            onClick={() => void perform(model.reconnect)}
            disabled={model.status === "connecting"}
          >
            <RefreshCw size={13} aria-hidden /> New runspace
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error disabled:opacity-50"
            onClick={() => void perform(model.disconnect)}
            disabled={model.status === "closed" || model.status === "closing"}
          >
            <LogOut size={13} aria-hidden /> Disconnect
          </button>
        </div>
      </header>

      {(model.error || actionError || model.replayTruncated) && (
        <div
          className="border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
          role="alert"
        >
          {actionError || model.error || "Older retained output was truncated."}
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs"
        role="log"
        aria-label="PowerShell output streams"
        aria-live="polite"
      >
        {model.events.length === 0 ? (
          <div className="flex h-full items-center justify-center font-sans text-[var(--color-textMuted)]">
            Run a command to see output, errors, warnings, verbose, debug,
            information, and progress streams here.
          </div>
        ) : (
          <ol className="space-y-1.5">
            {model.events.map((event) => {
              const percent = Math.max(
                0,
                Math.min(100, event.progress?.percentComplete ?? 0),
              );
              return (
                <li
                  key={`${event.sessionId}:${event.sequence}`}
                  className={`rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 ${STREAM_STYLES[event.kind]}`}
                  data-stream={event.kind}
                  data-sequence={event.sequence}
                >
                  <div className="mb-0.5 flex gap-2 text-[10px] uppercase text-[var(--color-textMuted)]">
                    <span>#{event.sequence}</span>
                    <span>{event.kind.replace("_", " ")}</span>
                    <span>
                      {new Date(event.timestampMs).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono">
                    {event.text}
                  </pre>
                  {event.progress ? (
                    <div className="mt-1.5">
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-[var(--color-background)]"
                        role="progressbar"
                        aria-label={
                          event.progress.activity || "PowerShell progress"
                        }
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <div
                          className="h-full bg-success"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="mt-1 block text-[10px] text-[var(--color-textMuted)]">
                        {percent}%
                        {event.progress.currentOperation
                          ? ` · ${event.progress.currentOperation}`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        {model.backend?.inputOpen ? (
          <div className="mb-3 rounded border border-primary/30 bg-primary/5 p-2">
            <label
              className="mb-1 block text-xs font-medium"
              htmlFor={`powershell-input-${session.id}`}
            >
              Pipeline input object
            </label>
            <div className="flex gap-2">
              <input
                id={`powershell-input-${session.id}`}
                className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 font-mono text-xs"
                value={pipelineInput}
                onChange={(event) => setPipelineInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void sendInput();
                  }
                }}
              />
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1.5 text-xs text-primary-foreground"
                onClick={() => void sendInput()}
              >
                <Send size={13} aria-hidden /> Send input
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-xs"
                onClick={() => void perform(model.endInput)}
              >
                <CornerDownLeft size={13} aria-hidden /> End input
              </button>
            </div>
          </div>
        ) : null}

        <label
          className="mb-1 block text-xs font-medium"
          htmlFor={`powershell-script-${session.id}`}
        >
          PowerShell script
        </label>
        <textarea
          id={`powershell-script-${session.id}`}
          className="min-h-24 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 font-mono text-xs"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          placeholder="Enter a multiline PowerShell script. Ctrl+Enter runs it."
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            onClick={() => void run()}
            disabled={!canRun || !script.trim()}
          >
            <Play size={14} aria-hidden /> Run script
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-error/40 px-3 py-1.5 text-xs text-error disabled:opacity-50"
            onClick={() => void perform(model.cancel)}
            disabled={!active || model.status === "cancelling"}
          >
            <Square size={13} aria-hidden /> Cancel pipeline
          </button>
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={acceptsInput}
              onChange={(event) => setAcceptsInput(event.target.checked)}
              disabled={!canRun}
            />
            Keep pipeline input open
          </label>
        </div>
      </footer>
    </section>
  );
};

export default PowerShellSessionViewer;
