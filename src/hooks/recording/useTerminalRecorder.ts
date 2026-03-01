import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SessionRecording, SessionRecordingMetadata } from '../../types/macroTypes';

export interface UseTerminalRecorderResult {
  isRecording: boolean;
  duration: number;
  entryCount: number;
  startRecording: (sessionId: string, recordInput?: boolean, cols?: number, rows?: number) => Promise<void>;
  stopRecording: (sessionId: string) => Promise<SessionRecording | null>;
}

export function useTerminalRecorder(): UseTerminalRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [entryCount, setEntryCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((sessionId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await invoke<SessionRecordingMetadata | null>('get_recording_status', {
          sessionId,
        });
        if (status) {
          setDuration(status.duration_ms);
          setEntryCount(status.entry_count);
        } else {
          // Recording ended externally
          setIsRecording(false);
          stopPolling();
        }
      } catch {
        // Session may have gone away
      }
    }, 1000);
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startRecording = useCallback(
    async (sessionId: string, recordInput?: boolean, cols?: number, rows?: number) => {
      await invoke('start_session_recording', {
        sessionId,
        recordInput: recordInput ?? false,
        initialCols: cols ?? 80,
        initialRows: rows ?? 24,
      });
      sessionIdRef.current = sessionId;
      setIsRecording(true);
      setDuration(0);
      setEntryCount(0);
      startPolling(sessionId);
    },
    [startPolling],
  );

  const stopRecording = useCallback(
    async (sessionId: string): Promise<SessionRecording | null> => {
      try {
        const recording = await invoke<SessionRecording>('stop_session_recording', { sessionId });
        setIsRecording(false);
        stopPolling();
        sessionIdRef.current = null;
        return recording;
      } catch {
        setIsRecording(false);
        stopPolling();
        return null;
      }
    },
    [stopPolling],
  );

  return { isRecording, duration, entryCount, startRecording, stopRecording };
}
