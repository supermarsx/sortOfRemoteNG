import { WebTerminalMgr } from "./types";
import { Circle, SquareIcon } from "lucide-react";

function RecordingButton({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.terminalRecorder.isRecording) {
    return (
      <button
        onClick={mgr.handleStartRecording}
        className="app-bar-button p-2"
        data-tooltip="Record Session"
        aria-label="Record Session"
        disabled={mgr.status !== "connected"}
      >
        <Circle size={14} />
      </button>
    );
  }
  return (
    <button
      onClick={mgr.handleStopRecording}
      className="app-bar-button p-2 text-red-400"
      data-tooltip="Stop Recording"
      aria-label="Stop Recording"
    >
      <SquareIcon size={12} fill="currentColor" />
      <span className="ml-1 text-[10px] font-mono animate-pulse">
        REC {mgr.formatDuration(mgr.terminalRecorder.duration)}
      </span>
    </button>
  );
}

export default RecordingButton;
