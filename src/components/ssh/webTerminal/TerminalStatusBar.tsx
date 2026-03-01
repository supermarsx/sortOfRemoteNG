import { WebTerminalMgr } from "./types";
import HostKeyTrustBadges from "./HostKeyTrustBadges";

function TerminalStatusBar({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-[10px] uppercase tracking-[0.2em]">
      <span className={`app-badge ${mgr.statusToneClass}`}>
        {mgr.status === "connected"
          ? "Connected"
          : mgr.status === "connecting"
            ? "Connecting"
            : mgr.status === "error"
              ? "Error"
              : "Idle"}
      </span>
      {mgr.error && (
        <span className="app-badge app-badge--error normal-case tracking-normal">
          {mgr.error}
        </span>
      )}
      {mgr.isSsh && (
        <span className="app-badge app-badge--info">SSH lib: Rust</span>
      )}
      {mgr.terminalRecorder.isRecording && (
        <span className="app-badge app-badge--error animate-pulse">
          REC {mgr.formatDuration(mgr.terminalRecorder.duration)}
        </span>
      )}
      {mgr.macroRecorder.isRecording && (
        <span className="app-badge app-badge--warning animate-pulse">
          MACRO ({mgr.macroRecorder.steps.length} steps)
        </span>
      )}
      {mgr.replayingMacro && (
        <span className="app-badge app-badge--info animate-pulse">
          Replaying...
        </span>
      )}
      <HostKeyTrustBadges mgr={mgr} />
    </div>
  );
}

export default TerminalStatusBar;
