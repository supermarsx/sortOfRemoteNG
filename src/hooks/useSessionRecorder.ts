import { useState, useRef, useCallback, useEffect } from 'react';

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  format: string;
}

const INITIAL_STATE: RecordingState = {
  isRecording: false,
  isPaused: false,
  duration: 0,
  format: '',
};

/**
 * Hook for recording an HTML canvas stream using the MediaRecorder API.
 * Supports WebM (VP8/VP9) natively in Chromium-based webviews.
 */
export function useSessionRecorder(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [state, setState] = useState<RecordingState>(INITIAL_STATE);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Duration tracking timer
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
      webm: [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ],
      mp4: [
        'video/mp4;codecs=h264',
        'video/mp4',
      ],
    };
    const list = candidates[preferredFormat] || candidates.webm;
    for (const mime of list) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    // Fallback to any supported format
    for (const mimes of Object.values(candidates)) {
      for (const mime of mimes) {
        if (MediaRecorder.isTypeSupported(mime)) return mime;
      }
    }
    return null;
  }, []);

  const startRecording = useCallback((format: string = 'webm', fps: number = 30) => {
    if (!canvasRef.current) return false;

    const mimeType = getSupportedMimeType(format);
    if (!mimeType) return false;

    try {
      const stream = canvasRef.current.captureStream(fps);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000); // Request data every 1 second
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
  }, [canvasRef, getSupportedMimeType]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setState(INITIAL_STATE);
      return Promise.resolve(null);
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        setState(INITIAL_STATE);
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.pause();
      setState(prev => ({ ...prev, isPaused: true }));
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'paused') {
      recorder.resume();
      setState(prev => ({ ...prev, isPaused: false }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  return {
    state,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  };
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
