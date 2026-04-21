import React from "react";
import { RDPClientHeaderProps, btnDefault, formatDuration } from "./helpers";
import { Circle, Pause, Play, Square } from "lucide-react";

const RecordingControls: React.FC<{
  recState: RDPClientHeaderProps["recState"];
  startRecording: (fmt: string) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  handleStopRecording: () => void;
}> = ({
  recState,
  startRecording,
  pauseRecording,
  resumeRecording,
  handleStopRecording,
}) =>
  !recState.isRecording ? (
    <button
      onClick={() => startRecording("webm")}
      className={btnDefault}
      data-tooltip="Start recording"
    >
      <Circle size={14} className="fill-current" />
    </button>
  ) : (
    <div className="flex items-center space-x-1">
      <span className="text-[10px] text-[var(--color-textSecondary)] animate-pulse font-mono">
        REC {formatDuration(recState.duration)}
      </span>
      {recState.isPaused ? (
        <button
          onClick={resumeRecording}
          className={btnDefault}
          data-tooltip="Resume recording"
        >
          <Play size={12} />
        </button>
      ) : (
        <button
          onClick={pauseRecording}
          className={btnDefault}
          data-tooltip="Pause recording"
        >
          <Pause size={12} />
        </button>
      )}
      <button
        onClick={handleStopRecording}
        className={btnDefault}
        data-tooltip="Stop and save recording"
      >
        <Square size={12} className="fill-current" />
      </button>
    </div>
  );

/* ------------------------------------------------------------------ */
/*  Root component                                                     */

export default RecordingControls;
