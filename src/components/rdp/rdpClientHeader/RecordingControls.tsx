import React from "react";
import { RDPClientHeaderProps, btnDefault, formatDuration } from "./helpers";

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
      title="Start recording"
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
          title="Resume recording"
        >
          <Play size={12} />
        </button>
      ) : (
        <button
          onClick={pauseRecording}
          className={btnDefault}
          title="Pause recording"
        >
          <Pause size={12} />
        </button>
      )}
      <button
        onClick={handleStopRecording}
        className={btnDefault}
        title="Stop and save recording"
      >
        <Square size={12} className="fill-current" />
      </button>
    </div>
  );

/* ------------------------------------------------------------------ */
/*  Root component                                                     */

export default RecordingControls;
