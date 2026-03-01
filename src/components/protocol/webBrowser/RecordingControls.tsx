import React from "react";
import { Circle, Film, Square, Pause, PlayIcon } from "lucide-react";

const RecordingControls: React.FC<SectionProps> = ({ mgr }) => (
  <>
    <div className="w-px h-5 bg-[var(--color-surfaceHover)] mx-1" />
    {/* HAR Recording */}
    {!mgr.webRecorder.isRecording ? (
      <button
        onClick={mgr.handleStartHarRecording}
        disabled={!mgr.proxySessionIdRef.current}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Record HTTP traffic (HAR)"
      >
        <Circle size={16} />
      </button>
    ) : (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 px-2 py-1 bg-red-900/40 rounded text-red-400 text-xs font-mono animate-pulse">
          <Circle size={10} fill="currentColor" />
          HAR {Math.floor(mgr.webRecorder.duration / 60000)}:
          {String(
            Math.floor((mgr.webRecorder.duration % 60000) / 1000),
          ).padStart(2, "0")}
          <span className="text-[var(--color-textSecondary)] ml-1">
            {mgr.webRecorder.entryCount} req
          </span>
        </span>
        <button
          onClick={mgr.handleStopHarRecording}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-red-400 hover:text-red-300"
          title="Stop HAR recording"
        >
          <Square size={14} fill="currentColor" />
        </button>
      </div>
    )}
    {/* Video Recording */}
    {!mgr.displayRecorder.state.isRecording ? (
      <button
        onClick={mgr.handleStartVideoRecording}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-blue-400"
        title="Record screen video"
      >
        <Film size={16} />
      </button>
    ) : (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 px-2 py-1 bg-blue-900/40 rounded text-blue-400 text-xs font-mono animate-pulse">
          <Film size={10} />
          VIDEO {Math.floor(mgr.displayRecorder.state.duration / 60)}:
          {String(mgr.displayRecorder.state.duration % 60).padStart(2, "0")}
        </span>
        {mgr.displayRecorder.state.isPaused ? (
          <button
            onClick={() => mgr.displayRecorder.resumeRecording()}
            className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-blue-400"
            title="Resume video recording"
          >
            <PlayIcon size={14} />
          </button>
        ) : (
          <button
            onClick={() => mgr.displayRecorder.pauseRecording()}
            className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-blue-400"
            title="Pause video recording"
          >
            <Pause size={14} />
          </button>
        )}
        <button
          onClick={mgr.handleStopVideoRecording}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-blue-400 hover:text-blue-300"
          title="Stop video recording"
        >
          <Square size={14} fill="currentColor" />
        </button>
      </div>
    )}
  </>
);

export default RecordingControls;
