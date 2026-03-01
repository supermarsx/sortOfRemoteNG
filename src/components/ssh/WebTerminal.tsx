import React from "react";
import { useWebTerminal } from "../../hooks/ssh/useWebTerminal";
import { WebTerminalProps } from "./webTerminal/types";
import TerminalToolbar from "./webTerminal/TerminalToolbar";
import TerminalStatusBar from "./webTerminal/TerminalStatusBar";
import ScriptSelectorModal from "./webTerminal/ScriptSelectorModal";
import SshTrustDialog from "./webTerminal/SshTrustDialog";

const WebTerminal: React.FC<WebTerminalProps> = ({ session, onResize }) => {
  const mgr = useWebTerminal(session, onResize);

  return (
    <div
      className={`flex flex-col ${mgr.isFullscreen ? "fixed inset-0 z-50" : "h-full"}`}
      style={{
        backgroundColor: "var(--color-background)",
        color: "var(--color-text)",
      }}
    >
      <div className="app-bar border-b relative z-20 overflow-visible">
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {session.name || "Terminal"}
            </div>
            <div className="truncate text-xs uppercase tracking-[0.2em] text-[var(--color-textSecondary)]">
              {session.protocol.toUpperCase()} - {session.hostname}
            </div>
          </div>
          <TerminalToolbar mgr={mgr} />
        </div>
        <TerminalStatusBar mgr={mgr} />
      </div>

      <div className="flex-1 min-h-0 p-3">
        <div
          ref={mgr.containerRef}
          className="h-full w-full rounded-lg border relative overflow-hidden"
          style={{
            backgroundColor: "var(--color-background)",
            borderColor: "var(--color-border)",
          }}
        />
      </div>

      <ScriptSelectorModal mgr={mgr} />
      <SshTrustDialog mgr={mgr} />
    </div>
  );
};

export { WebTerminal };
export default WebTerminal;

