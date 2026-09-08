import { useCallback, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import {
  createRecordingPlayerSession,
  RECORDING_PLAYER_PROTOCOL,
} from "../../components/app/toolSession";
import type { SavedRDPRecording } from "../../types/recording/macroTypes";

export function useRecordingPlayerSession(
  onActivateSession?: (sessionId: string) => void,
) {
  const { state, dispatch } = useConnections();
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;

  return useCallback(
    (recording: SavedRDPRecording) => {
      if (!onActivateSession)
        throw new Error("Recording tab navigation is unavailable.");
      const existing = sessionsRef.current.find(
        (candidate) =>
          candidate.protocol === RECORDING_PLAYER_PROTOCOL &&
          candidate.recordingPlayer?.recordingId === recording.id,
      );
      const session =
        existing ?? createRecordingPlayerSession(recording.id, recording.name);
      if (!existing) {
        // Reserve before dispatch so two clicks in the same React turn cannot duplicate the tab.
        sessionsRef.current = [...sessionsRef.current, session];
        dispatch({ type: "ADD_SESSION", payload: session });
      }
      onActivateSession(session.id);
    },
    [dispatch, onActivateSession],
  );
}
