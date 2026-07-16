"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  Activity,
  Cable,
  RefreshCw,
  StopCircle,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSerialSession } from "../../hooks/protocol/useSerialSession";
import type { ConnectionSession } from "../../types/connection/connection";
import { sanitizeBehaviorText } from "../../utils/behavior/template";

const parityLetter = (parity: "none" | "odd" | "even") =>
  parity === "none" ? "N" : parity === "odd" ? "O" : "E";

const indicatorClass = (active: boolean) =>
  `rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${
    active
      ? "border-success/50 bg-success/10 text-success"
      : "border-[var(--color-border)] text-[var(--color-textMuted)]"
  }`;

export function SerialClient({ session }: { session: ConnectionSession }) {
  const model = useSerialSession(session);
  const [actionError, setActionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const lastWrittenChunkRef = useRef<Uint8Array | null>(null);
  const sendRef = useRef(model.sendInput);
  sendRef.current = model.sendInput;

  const runAction = (action: () => Promise<unknown>) => {
    setActionError(null);
    void action().catch((error) => {
      setActionError(
        sanitizeBehaviorText(
          error instanceof Error ? error.message : String(error),
        ),
      );
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      scrollback: 10_000,
      convertEol: false,
      theme: {
        background: "#00000000",
        foreground: "#d7dde8",
        cursor: "#9cc2ff",
        selectionBackground: "#40608088",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    terminal.focus();

    const fitTerminal = () => {
      try {
        // Serial transports do not have remote terminal dimensions. Fitting
        // affects only the local xterm canvas and intentionally sends no IPC.
        fit.fit();
      } catch {
        // Detached webviews can briefly report zero dimensions.
      }
    };
    fitTerminal();
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(container);
    const input = terminal.onData((data) =>
      runAction(() => sendRef.current(data)),
    );

    return () => {
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      lastWrittenChunkRef.current = null;
    };
  }, []);

  useEffect(() => {
    let startIndex = 0;
    const previous = lastWrittenChunkRef.current;
    if (previous) {
      const previousIndex = model.outputChunks.indexOf(previous);
      if (previousIndex >= 0) {
        startIndex = previousIndex + 1;
      } else {
        terminalRef.current?.reset();
      }
    }
    for (
      let index = startIndex;
      index < model.outputChunks.length;
      index += 1
    ) {
      terminalRef.current?.write(model.outputChunks[index]);
    }
    lastWrittenChunkRef.current =
      model.outputChunks.length > 0
        ? model.outputChunks[model.outputChunks.length - 1]
        : null;
  }, [model.outputChunks]);

  const shorthand = `${model.settings.baudRate}-${model.settings.dataBits}${parityLetter(model.settings.parity)}${model.settings.stopBits}`;
  const connected = model.status === "connected";
  const shownError = actionError ?? model.error;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label={`Serial session on ${model.settings.portName}`}
      data-testid="serial-client"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <Cable size={14} aria-hidden />
        <span className="font-medium">
          Serial · {model.settings.portName || session.hostname}
        </span>
        <span className="font-mono text-[var(--color-textSecondary)]">
          {shorthand}
        </span>
        <span
          className="rounded-full border border-[var(--color-border)] px-2 py-1 uppercase"
          role="status"
          aria-live="polite"
        >
          {model.status}
        </span>
        <span className="text-[var(--color-textMuted)]">Local device</span>

        <div
          className="flex items-center gap-1"
          aria-label="Serial input control lines"
        >
          {(["cts", "dsr", "ri", "dcd"] as const).map((line) => (
            <span
              key={line}
              className={indicatorClass(model.controlLines[line])}
            >
              {line.toUpperCase()}
            </span>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1"
            disabled={!connected}
            onClick={() => runAction(() => model.refreshControlLines())}
            title="Read the CTS, DSR, RI, and DCD input lines"
          >
            <RefreshCw size={12} aria-hidden /> Lines
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1"
            disabled={!connected}
            onClick={() => runAction(() => model.sendBreak())}
          >
            <Zap size={12} aria-hidden /> BREAK
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1"
            disabled={!connected}
            onClick={() => runAction(() => model.flush())}
          >
            <Trash2 size={12} aria-hidden /> Flush
          </button>
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-2 py-1"
            disabled={!connected}
            onClick={() => runAction(() => model.setDtr(!model.requestedDtr))}
            title="Queue a DTR output request. The current backend cannot confirm the resulting output state."
          >
            DTR requested {model.requestedDtr ? "on" : "off"}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-2 py-1"
            disabled={!connected}
            onClick={() => runAction(() => model.setRts(!model.requestedRts))}
            title="Queue an RTS output request. The current backend cannot confirm the resulting output state."
          >
            RTS requested {model.requestedRts ? "on" : "off"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error"
            disabled={model.status === "disconnected"}
            onClick={() => runAction(() => model.disconnect())}
          >
            <StopCircle size={13} aria-hidden /> Disconnect
          </button>
        </div>
      </header>

      {shownError ? (
        <div
          className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {shownError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 p-3">
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden rounded border border-[var(--color-border)] bg-black/90 p-1"
          role="application"
          aria-label="Serial terminal"
          tabIndex={0}
        />
      </div>

      <footer className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-textMuted)]">
        <Activity size={11} aria-hidden /> Terminal resizing is local only;
        serial devices do not receive rows or columns.
      </footer>
    </section>
  );
}

export default SerialClient;
