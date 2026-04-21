import { useState, useRef, useCallback, useEffect } from 'react';

export interface DisplayRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  format: string;
}

const INITIAL_STATE: DisplayRecordingState = {
  isRecording: false,
  isPaused: false,
  duration: 0,
  format: '',
};

/**
 * Hook for recording the screen/window using getDisplayMedia + MediaRecorder.
 * Used for web browser session video recording where canvas capture isn't possible
 * (cross-origin iframe).
 */
export function useDisplayRecorder() {
  const [state, setState] = useState<DisplayRecordingState>(INITIAL_STATE);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (state.isRecording && !state.isPaused) {
      timerRef.current = setInterval(() => {
        setState(prev => ({
          ...prev,
          duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
        }));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.isRecording, state.isPaused]);

  const getSupportedMimeType = useCallback((preferredFormat: string): string | null => {
    const candidates: Record<string, string[]> = {
      webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
      mp4: ['video/mp4;codecs=h264', 'video/mp4'],
    };
    const list = candidates[preferredFormat] || candidates.webm;
    for (const mime of list) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    for (const mimes of Object.values(candidates)) {
      for (const mime of mimes) {
        if (MediaRecorder.isTypeSupported(mime)) return mime;
      }
    }
    return null;
  }, []);

  const startRecording = useCallback(async (format: string = 'webm'): Promise<boolean> => {
    try {
      // Request screen/window capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });

      streamRef.current = stream;

      const mimeType = getSupportedMimeType(format);
      if (!mimeType) {
        stream.getTracks().forEach(t => t.stop());
        return false;
      }

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Handle user stopping the share via browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (mediaRecorderRef.current?.state !== 'inactive') {
          mediaRecorderRef.current?.stop();
        }
      });

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();
      setState({
        isRecording: true,
        isPaused: false,
        duration: 0,
        format: mimeType.split(';')[0].split('/')[1] || format,
      });
      return true;
    } catch {
      return false;
    }
  }, [getSupportedMimeType]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      // Stop the stream
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setState(INITIAL_STATE);
      return Promise.resolve(null);
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setState(INITIAL_STATE);
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setState(prev => ({ ...prev, isPaused: true }));
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setState(prev => ({ ...prev, isPaused: false }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return { state, startRecording, stopRecording, pauseRecording, resumeRecording };
}
