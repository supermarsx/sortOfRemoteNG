import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { WebRecording, WebRecordingMetadata } from '../types/macroTypes';

export interface UseWebRecorderResult {
  isRecording: boolean;
  duration: number;
  entryCount: number;
  bytesTransferred: number;
  startRecording: (sessionId: string, recordHeaders?: boolean) => Promise<void>;
  stopRecording: (sessionId: string) => Promise<WebRecording | null>;
}

export function useWebRecorder(): UseWebRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [entryCount, setEntryCount] = useState(0);
  const [bytesTransferred, setBytesTransferred] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        const status = await invoke<WebRecordingMetadata | null>('get_web_recording_status', {
          sessionId,
        });
        if (status) {
          setDuration(status.duration_ms);
          setEntryCount(status.entry_count);
          setBytesTransferred(status.total_bytes_transferred);
        } else {
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
    async (sessionId: string, recordHeaders?: boolean) => {
      await invoke('start_web_recording', {
        sessionId,
        recordHeaders: recordHeaders ?? true,
      });
      setIsRecording(true);
      setDuration(0);
      setEntryCount(0);
      setBytesTransferred(0);
      startPolling(sessionId);
    },
    [startPolling],
  );

  const stopRecording = useCallback(
    async (sessionId: string): Promise<WebRecording | null> => {
      try {
        const recording = await invoke<WebRecording>('stop_web_recording', { sessionId });
        setIsRecording(false);
        stopPolling();
        return recording;
      } catch {
        setIsRecording(false);
        stopPolling();
        return null;
      }
    },
    [stopPolling],
  );

  return { isRecording, duration, entryCount, bytesTransferred, startRecording, stopRecording };
}
