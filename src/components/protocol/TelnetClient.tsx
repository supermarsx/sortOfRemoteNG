"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Activity, Radio, RefreshCw, StopCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTelnetSession } from "../../hooks/protocol/useTelnetSession";
import type { ConnectionSession } from "../../types/connection/connection";

export function TelnetClient({ session }: { session: ConnectionSession }) {
  const model = useTelnetSession(session);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const writtenChunksRef = useRef(0);
  const sendRef = useRef(model.sendInput);
  const resizeRef = useRef(model.resize);
  const inputEnabledRef = useRef(false);
  sendRef.current = model.sendInput;
  resizeRef.current = model.resize;
  inputEnabledRef.current =
    model.status === "connected" && !model.requiresInsecureApproval;

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
        fit.fit();
      } catch {
        // Detached webviews can briefly report zero dimensions.
      }
    };
    fitTerminal();
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(container);
    const input = terminal.onData((data) => {
      if (!inputEnabledRef.current) return;
      void sendRef.current(data).catch(() => undefined);
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      void resizeRef.current(cols, rows).catch(() => undefined);
    });

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (writtenChunksRef.current > model.outputChunks.length) {
      writtenChunksRef.current = 0;
      terminalRef.current?.reset();
    }
    for (
      let index = writtenChunksRef.current;
      index < model.outputChunks.length;
      index += 1
    ) {
      terminalRef.current?.write(model.outputChunks[index]);
    }
    writtenChunksRef.current = model.outputChunks.length;
  }, [model.outputChunks]);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label={`Telnet session to ${session.hostname}`}
      data-testid="telnet-client"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <Radio size={14} aria-hidden />
        <span className="font-medium">Telnet · {session.hostname}</span>
        <span
          className="rounded-full border border-[var(--color-border)] px-2 py-1 uppercase"
          role="status"
          aria-live="polite"
        >
          {model.status}
        </span>
        <span className="text-warning">Plaintext transport</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1"
            disabled={model.status !== "connected"}
            onClick={() => void model.sendAreYouThere().catch(() => undefined)}
          >
            <Activity size={13} aria-hidden /> AYT
          </button>
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-2 py-1"
            disabled={model.status !== "connected"}
            onClick={() => void model.sendBreak().catch(() => undefined)}
          >
            BREAK
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error"
            disabled={model.status === "disconnected"}
            onClick={() => void model.disconnect().catch(() => undefined)}
          >
            <StopCircle size={13} aria-hidden /> Disconnect
          </button>
          {(model.status === "disconnected" || model.status === "error") &&
          !model.requiresInsecureApproval ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1"
              onClick={model.reconnect}
            >
              <RefreshCw size={13} aria-hidden /> Reconnect
            </button>
          ) : null}
        </div>
      </header>
      {model.error ? (
        <div
          className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {model.error}
        </div>
      ) : null}
      {model.requiresInsecureApproval ? (
        <div
          className="border-b border-warning/40 bg-warning/10 px-4 py-3 text-sm"
          role="alert"
        >
          <p className="font-semibold">Telnet is not encrypted.</p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            Commands, terminal output, and anything typed into the session can
            be read or modified on the network.
          </p>
          {model.savedCredentialsIgnored ? (
            <p className="mt-1 text-[var(--color-text-muted)]">
              Saved credentials will not be sent automatically. Automatic Telnet
              login is unavailable.
            </p>
          ) : null}
          <button
            type="button"
            className="mt-3 rounded border border-warning/60 bg-warning/15 px-3 py-1.5 font-medium"
            onClick={model.approveInsecureTransport}
          >
            Connect using plaintext Telnet
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 p-3">
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden rounded border border-[var(--color-border)] bg-black/90 p-1"
          role="application"
          aria-label="Telnet terminal"
          aria-disabled={!inputEnabledRef.current}
          tabIndex={0}
        />
      </div>
    </section>
  );
}

export default TelnetClient;
