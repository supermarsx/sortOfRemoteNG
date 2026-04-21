import type { SectionProps } from "./types";
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
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-error disabled:opacity-50 disabled:cursor-not-allowed"
        title="Record HTTP traffic (HAR)"
      >
        <Circle size={16} />
      </button>
    ) : (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 px-2 py-1 bg-error/40 rounded text-error text-xs font-mono animate-pulse">
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
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-error hover:text-error"
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
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-primary"
        title="Record screen video"
      >
        <Film size={16} />
      </button>
    ) : (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 px-2 py-1 bg-primary/40 rounded text-primary text-xs font-mono animate-pulse">
          <Film size={10} />
          VIDEO {Math.floor(mgr.displayRecorder.state.duration / 60)}:
          {String(mgr.displayRecorder.state.duration % 60).padStart(2, "0")}
        </span>
        {mgr.displayRecorder.state.isPaused ? (
          <button
            onClick={() => mgr.displayRecorder.resumeRecording()}
            className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-primary"
            title="Resume video recording"
          >
            <PlayIcon size={14} />
          </button>
        ) : (
          <button
            onClick={() => mgr.displayRecorder.pauseRecording()}
            className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-primary"
            title="Pause video recording"
          >
            <Pause size={14} />
          </button>
        )}
        <button
          onClick={mgr.handleStopVideoRecording}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors text-primary hover:text-primary"
          title="Stop video recording"
        >
          <Square size={14} fill="currentColor" />
        </button>
      </div>
    )}
  </>
);

export default RecordingControls;
