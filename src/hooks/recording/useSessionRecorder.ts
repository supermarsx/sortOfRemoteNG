import { useState, useRef, useCallback, useEffect } from 'react';
import { createGifFrameCollector, type GifFrameCollector } from '../../utils/gifEncoder';

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
 * Hook for recording an HTML canvas stream using the MediaRecorder API
 * or frame-by-frame GIF capture.
 * Supports WebM (VP8/VP9), MP4 (H.264), and GIF.
 */
export function useSessionRecorder(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [state, setState] = useState<RecordingState>(INITIAL_STATE);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // GIF-specific refs
  const gifCollectorRef = useRef<GifFrameCollector | null>(null);
  const gifIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isGifModeRef = useRef(false);

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

    // ── GIF mode: capture frames directly from canvas ──
    if (format === 'gif') {
      const delayMs = Math.round(1000 / Math.min(fps, 10)); // Cap GIF at 10fps for size
      const collector = createGifFrameCollector(canvasRef.current, {
        delayMs,
        maxColors: 256,
      });
      gifCollectorRef.current = collector;
      isGifModeRef.current = true;

      // Capture frames at the specified interval
      gifIntervalRef.current = setInterval(() => {
        collector.captureFrame();
      }, delayMs);

      startTimeRef.current = Date.now();
      setState({
        isRecording: true,
        isPaused: false,
        duration: 0,
        format: 'gif',
      });
      return true;
    }

    // ── Video mode: use MediaRecorder ──
    isGifModeRef.current = false;
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
    // ── GIF stop ──
    if (isGifModeRef.current) {
      if (gifIntervalRef.current) {
        clearInterval(gifIntervalRef.current);
        gifIntervalRef.current = null;
      }

      const collector = gifCollectorRef.current;
      if (!collector || collector.frameCount() === 0) {
        setState(INITIAL_STATE);
        isGifModeRef.current = false;
        return Promise.resolve(null);
      }

      const blob = collector.encode();
      collector.clear();
      gifCollectorRef.current = null;
      isGifModeRef.current = false;
      setState(INITIAL_STATE);
      return Promise.resolve(blob);
    }

    // ── Video stop ──
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
    if (isGifModeRef.current) {
      // Pause GIF capture by stopping the interval
      if (gifIntervalRef.current) {
        clearInterval(gifIntervalRef.current);
        gifIntervalRef.current = null;
      }
      setState(prev => ({ ...prev, isPaused: true }));
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.pause();
      setState(prev => ({ ...prev, isPaused: true }));
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (isGifModeRef.current) {
      // Resume GIF capture
      const collector = gifCollectorRef.current;
      const canvas = canvasRef.current;
      if (collector && canvas) {
        // Use the same delay (we stored it indirectly; default to 100ms)
        gifIntervalRef.current = setInterval(() => {
          collector.captureFrame();
        }, 100);
      }
      setState(prev => ({ ...prev, isPaused: false }));
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'paused') {
      recorder.resume();
      setState(prev => ({ ...prev, isPaused: false }));
    }
  }, [canvasRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gifIntervalRef.current) clearInterval(gifIntervalRef.current);
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
