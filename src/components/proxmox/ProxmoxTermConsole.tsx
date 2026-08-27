/**
 * ProxmoxTermConsole — xterm.js overlay on top of the `sorng-proxmox` termproxy
 * relay.
 *
 * Rendered inside the Proxmox panel (a `Modal`, not a session tab) so the panel
 * never has to reach into `SessionViewer`/`useSessionManager`, which belong to
 * another task. Everything transport-shaped lives in `useProxmoxConsole`; this
 * file is the terminal surface: fit-on-resize, keystrokes out, decoded bytes in,
 * clipboard paste, and a reconnect affordance once the relay closes.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  AlertTriangle,
  ClipboardPaste,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import Modal from "../ui/overlays/Modal";
import {
  useProxmoxConsole,
  type ProxmoxConsoleTarget,
} from "../../hooks/proxmox/useProxmoxConsole";

export interface ProxmoxTermConsoleProps {
  target: ProxmoxConsoleTarget;
  onClose: () => void;
}

function describeTarget(target: ProxmoxConsoleTarget): string {
  if (target.label) return target.label;
  if (target.vmid == null) return target.node;
  return `${target.node} · ${target.vmid}`;
}

export const ProxmoxTermConsole: React.FC<ProxmoxTermConsoleProps> = ({
  target,
  onClose,
}) => {
  const { t } = useTranslation();
  const relay = useProxmoxConsole(target);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenSeqRef = useRef(0);
  const sendRef = useRef(relay.send);
  const resizeRef = useRef(relay.resize);
  const acceptsInputRef = useRef(false);
  sendRef.current = relay.send;
  resizeRef.current = relay.resize;
  acceptsInputRef.current = relay.status === "open";

  // The terminal is created once for the lifetime of the overlay; a reconnect
  // reuses it (and its scrollback) rather than remounting the DOM node.
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
    fitRef.current = fit;
    terminal.focus();

    const fitTerminal = () => {
      try {
        fit.fit();
      } catch {
        // A freshly mounted modal can report zero dimensions for a frame.
      }
    };
    fitTerminal();
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(fitTerminal)
        : null;
    observer?.observe(container);

    const input = terminal.onData((data) => {
      if (!acceptsInputRef.current) return;
      void sendRef.current(data).catch(() => undefined);
    });
    const resized = terminal.onResize(({ cols, rows }) => {
      void resizeRef.current(cols, rows).catch(() => undefined);
    });

    return () => {
      observer?.disconnect();
      input.dispose();
      resized.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Push the relay's current geometry once the session is actually open — the
  // first `fit()` usually happens before `proxmox_console_open` resolves.
  const relayStatus = relay.status;
  useEffect(() => {
    if (relayStatus !== "open") return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    try {
      fitRef.current?.fit();
    } catch {
      /* zero-sized container */
    }
    void resizeRef.current(terminal.cols, terminal.rows).catch(() => undefined);
  }, [relayStatus]);

  useEffect(() => {
    const batch = relay.output;
    if (batch.seq <= writtenSeqRef.current) return;
    writtenSeqRef.current = batch.seq;
    const terminal = terminalRef.current;
    if (!terminal) return;
    for (const chunk of batch.chunks) terminal.write(chunk);
  }, [relay.output]);

  const handlePaste = useCallback(async () => {
    try {
      const clipboard = navigator?.clipboard;
      if (!clipboard?.readText) return;
      const text = await clipboard.readText();
      if (text) await sendRef.current(text);
    } catch {
      // Clipboard permission denied — the terminal's own Ctrl+V still works.
    }
  }, []);

  const closeRelay = relay.close;
  const handleClose = useCallback(() => {
    void closeRelay().catch(() => undefined);
    onClose();
  }, [closeRelay, onClose]);

  const statusLabel =
    relay.status === "open"
      ? t("proxmox.console.statusOpen", "Connected")
      : relay.status === "opening"
        ? t("proxmox.console.statusOpening", "Opening…")
        : relay.status === "error"
          ? t("proxmox.console.statusError", "Failed")
          : relay.status === "closed"
            ? t("proxmox.console.statusClosed", "Closed")
            : t("proxmox.console.statusIdle", "Idle");

  const canReconnect = relay.status === "closed" || relay.status === "error";

  return (
    <Modal
      isOpen
      onClose={handleClose}
      backdropClassName="bg-black/60"
      panelClassName="max-w-5xl h-[80vh] rounded-xl overflow-hidden border border-[var(--color-border)]"
      contentClassName="bg-[var(--color-surface)]"
      dataTestId="proxmox-console-overlay"
    >
      <section
        className="flex h-full min-h-0 w-full flex-col"
        aria-label={t("proxmox.console.overlayLabel", "Proxmox console")}
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-3 py-2 text-xs">
          <TerminalSquare className="h-4 w-4 text-info" aria-hidden />
          <span
            className="font-medium text-[var(--color-text)]"
            data-testid="proxmox-console-title"
          >
            {describeTarget(target)}
          </span>
          <span
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 uppercase text-[var(--color-textSecondary)]"
            role="status"
            aria-live="polite"
            data-testid="proxmox-console-status"
          >
            {statusLabel}
          </span>
          {relay.handle?.user ? (
            <span className="text-[var(--color-textSecondary)]">
              {relay.handle.user}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
              onClick={() => void handlePaste()}
              disabled={relay.status !== "open"}
              data-testid="proxmox-console-paste-btn"
            >
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />
              {t("proxmox.console.paste", "Paste")}
            </button>
            {canReconnect ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)]"
                onClick={relay.reconnect}
                data-testid="proxmox-console-reconnect-btn"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("proxmox.console.reconnect", "Reconnect")}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error transition-colors hover:bg-error/10"
              onClick={handleClose}
              data-testid="proxmox-console-close-btn"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t("common.close", "Close")}
            </button>
          </div>
        </header>

        {relay.error ? (
          <div
            className="flex items-center gap-2 border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
            role="alert"
            data-testid="proxmox-console-error"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {relay.error}
          </div>
        ) : null}

        {relay.notice ? (
          <div
            className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
            role="status"
            data-testid="proxmox-console-notice"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{relay.notice}</span>
            <button
              type="button"
              className="rounded border border-warning/40 px-1.5 py-0.5"
              onClick={relay.dismissNotice}
              data-testid="proxmox-console-notice-dismiss"
            >
              {t("common.dismiss", "Dismiss")}
            </button>
          </div>
        ) : null}

        {relay.status === "closed" && relay.closeReason ? (
          <div
            className="border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]"
            data-testid="proxmox-console-close-reason"
          >
            {relay.closeReason}
          </div>
        ) : null}

        <div
          ref={containerRef}
          className="min-h-0 flex-1 bg-[var(--color-background)] p-2"
          data-testid="proxmox-console-terminal"
        />
      </section>
    </Modal>
  );
};

export default ProxmoxTermConsole;
