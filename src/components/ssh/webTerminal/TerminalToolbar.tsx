import { WebTerminalMgr } from "./types";
import RecordingButton from "./RecordingButton";
import MacroRecordButton from "./MacroRecordButton";
import MacroReplayPopover from "./MacroReplayPopover";
import HostKeyPopover from "./HostKeyPopover";
import TotpPopover from "./TotpPopover";
import { Clipboard, Copy, FileCode, Maximize2, Minimize2, RotateCcw, Send, StopCircle, Trash2, Unplug } from "lucide-react";

function TerminalToolbar({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={mgr.copySelection}
        className="app-bar-button p-2"
        data-tooltip="Copy selection"
        aria-label="Copy selection"
      >
        <Copy size={14} />
      </button>
      <button
        onClick={mgr.pasteFromClipboard}
        className="app-bar-button p-2"
        data-tooltip="Paste"
        aria-label="Paste"
      >
        <Clipboard size={14} />
      </button>
      {mgr.isSsh && (
        <>
          <button
            onClick={() => mgr.setShowScriptSelector(true)}
            className="app-bar-button p-2"
            data-tooltip="Run Script"
            aria-label="Run Script"
          >
            <FileCode size={14} />
          </button>
          <button
            onClick={mgr.sendCancel}
            className="app-bar-button p-2 hover:text-red-500"
            data-tooltip="Send Ctrl+C"
            aria-label="Send Ctrl+C"
          >
            <StopCircle size={14} />
          </button>
          <button
            onClick={mgr.disconnectSsh}
            className="app-bar-button p-2 hover:text-red-500"
            data-tooltip="Disconnect"
            aria-label="Disconnect"
            disabled={mgr.status !== "connected"}
          >
            <Unplug size={14} />
          </button>
          <button
            onClick={mgr.handleReconnect}
            className="app-bar-button p-2"
            data-tooltip="Reconnect"
            aria-label="Reconnect"
          >
            <RotateCcw size={14} />
          </button>
          <RecordingButton mgr={mgr} />
          <MacroRecordButton mgr={mgr} />
          <MacroReplayPopover mgr={mgr} />
          <HostKeyPopover mgr={mgr} />
        </>
      )}
      <TotpPopover mgr={mgr} />
      <button
        onClick={mgr.clearTerminal}
        className="app-bar-button p-2"
        data-tooltip="Clear"
        aria-label="Clear"
      >
        <Trash2 size={14} />
      </button>
      <button
        onClick={mgr.toggleFullscreen}
        className="app-bar-button p-2"
        data-tooltip={mgr.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        aria-label={mgr.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {mgr.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}

export default TerminalToolbar;
