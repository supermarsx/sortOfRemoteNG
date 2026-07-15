"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { AlertTriangle, ShieldAlert, StopCircle } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useRloginSession } from "../../hooks/protocol/useRloginSession";
import type { ConnectionSession } from "../../types/connection/connection";
import { RloginTerminalDecoder } from "../../utils/rlogin/rloginSettings";

export const RloginClient: React.FC<{ session: ConnectionSession }> = ({
  session,
}) => {
  const model = useRloginSession(session);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const decoderRef = useRef(new RloginTerminalDecoder(model.settings.encoding));
  const lastWrittenSequenceRef = useRef(0);
  const sendRef = useRef(model.sendInput);
  const resizeRef = useRef(model.resize);
  const [inputWarning, setInputWarning] = useState<string | null>(null);
  sendRef.current = model.sendInput;
  resizeRef.current = model.resize;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      cols: model.settings.initialColumns,
      rows: model.settings.initialRows,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10_000,
      convertEol: false,
      disableStdin: false,
      allowTransparency: true,
      theme: {
        background: "#00000000",
        foreground: "#d7dde8",
        cursor: "#9cc2ff",
        selectionBackground: "#40608088",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    terminal.focus();

    const fit = () => {
      try {
        fitAddon.fit();
      } catch {
        // Detached webviews can briefly report zero dimensions while opening.
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    const inputDisposable = terminal.onData((data) => {
      void sendRef
        .current(data)
        .then(({ lossy }) => {
          setInputWarning(
            lossy
              ? "Some characters are unavailable in " +
                  model.settings.encoding +
                  " and were sent as ?."
              : null,
          );
        })
        .catch((error) => {
          setInputWarning(
            error instanceof Error ? error.message : String(error),
          );
        });
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void resizeRef.current(
        cols,
        rows,
        container.clientWidth,
        container.clientHeight,
      );
    });

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [
    model.settings.encoding,
    model.settings.initialColumns,
    model.settings.initialRows,
  ]);

  useEffect(() => {
    decoderRef.current = new RloginTerminalDecoder(model.settings.encoding);
    lastWrittenSequenceRef.current = 0;
    terminalRef.current?.reset();
  }, [model.backendSessionId, model.settings.encoding]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    for (const frame of model.outputFrames) {
      if (frame.sequence <= lastWrittenSequenceRef.current) continue;
      terminal.write(decoderRef.current.decode(frame.data, true));
      lastWrittenSequenceRef.current = frame.sequence;
    }
  }, [model.outputFrames]);

  const plaintextAcknowledged =
    model.settings.plaintextAcknowledgement.acknowledged === true;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label={"RLogin session to " + session.hostname}
      data-testid="rlogin-client"
    >
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border border-[var(--color-border)] px-2 py-1 font-medium uppercase"
            role="status"
            aria-live="polite"
          >
            {model.status}
          </span>
          <span className="inline-flex items-center gap-1 text-warning">
            <ShieldAlert size={13} aria-hidden /> Plaintext{" "}
            {plaintextAcknowledged ? "acknowledged" : "blocked"}
          </span>
          <span>
            {model.capabilities.directRoute
              ? "Direct TCP supported"
              : "Direct TCP unavailable"}
          </span>
          <span className="text-[var(--color-textMuted)]">
            {model.capabilities.proxyRoutes
              ? "Proxy available"
              : "Proxy unavailable"}
            {" · "}
            {model.capabilities.reservedSourcePort
              ? "Reserved source port available"
              : "Reserved source port unavailable"}
            {" · "}
            {model.capabilities.outOfBandControl
              ? "OOB available"
              : "OOB unavailable"}
          </span>
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error disabled:opacity-50"
            disabled={model.status === "disconnected"}
            onClick={() => void model.disconnect()}
          >
            <StopCircle size={13} aria-hidden /> Disconnect
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[var(--color-textMuted)]">
          {model.localAddress && model.remoteAddress ? (
            <span>
              {model.localAddress} → {model.remoteAddress}
            </span>
          ) : null}
          {model.stats ? (
            <span>
              {model.stats.terminalBytesReceived} B received ·{" "}
              {model.stats.terminalBytesSent} B sent ·{" "}
              {model.stats.resizeFramesSent} resizes
            </span>
          ) : (
            <span>Waiting for exact native statistics</span>
          )}
        </div>
      </header>

      {(model.error || inputWarning) && (
        <div
          className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {model.error || inputWarning}
        </div>
      )}

      {(model.replayTruncated ||
        model.sourcePortFallback ||
        model.diagnosisWarnings.length > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="shrink-0" aria-hidden />
          {model.replayTruncated ? (
            <span>Older retained terminal output was truncated.</span>
          ) : null}
          {model.sourcePortFallback ? (
            <span>
              Automatic source-port policy is using its ephemeral fallback.
            </span>
          ) : null}
          {model.diagnosisWarnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 p-3">
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden rounded border border-[var(--color-border)] bg-black/90 p-1"
          role="application"
          aria-label="RLogin terminal"
          tabIndex={0}
        />
      </div>
    </section>
  );
};

export default RloginClient;
