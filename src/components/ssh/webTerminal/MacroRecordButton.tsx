import { WebTerminalMgr } from "./types";

function MacroRecordButton({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.macroRecorder.isRecording) {
    return (
      <button
        onClick={mgr.handleStartMacroRecording}
        className="app-bar-button p-2"
        data-tooltip="Record Macro"
        aria-label="Record Macro"
        disabled={mgr.status !== "connected"}
      >
        <CircleDot size={14} />
      </button>
    );
  }
  return (
    <button
      onClick={mgr.handleStopMacroRecording}
      className="app-bar-button p-2 text-orange-400"
      data-tooltip="Stop Macro Recording"
      aria-label="Stop Macro Recording"
    >
      <SquareIcon size={12} fill="currentColor" />
      <span className="ml-1 text-[10px] font-mono animate-pulse">
        MACRO
      </span>
    </button>
  );
}

export default MacroRecordButton;
