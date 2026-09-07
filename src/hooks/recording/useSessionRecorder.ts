import { useState, useRef, useCallback, useEffect } from "react";
import {
  createGifFrameCollector,
  type GifFrameCollector,
} from "../../utils/recording/gifEncoder";

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  isFinalizing: boolean;
  duration: number;
  format: string;
  error: string | null;
  limitReached: string | null;
}

const INITIAL_STATE: RecordingState = {
  isRecording: false,
  isPaused: false,
  isFinalizing: false,
  duration: 0,
  format: "",
  error: null,
  limitReached: null,
};

/** Canvas video recording and bounded GIF capture/worker encoding. */
export function useSessionRecorder(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [state, setState] = useState<RecordingState>(INITIAL_STATE);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const gifCollectorRef = useRef<GifFrameCollector | null>(null);
  const gifIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gifDelayRef = useRef(100);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const recordingRef = useRef(false);
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);
  const resumedAtRef = useRef(0);
  const stopPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const settleVideoRef = useRef<((blob: Blob | null) => void) | null>(null);
  const lastRecordingRef = useRef<
    | { width: number; height: number; durationMs: number; limit?: string }
    | undefined
  >(undefined);
  const getRecordingDetails = useCallback(() => lastRecordingRef.current, []);

  const elapsed = useCallback(
    () =>
      elapsedRef.current +
      (recordingRef.current && !pausedRef.current
        ? performance.now() - resumedAtRef.current
        : 0),
    [],
  );
  const clearGifTimer = useCallback(() => {
    if (gifIntervalRef.current) clearInterval(gifIntervalRef.current);
    gifIntervalRef.current = null;
  }, []);
  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);
  const release = useCallback(() => {
    generationRef.current++;
    recordingRef.current = false;
    pausedRef.current = false;
    clearGifTimer();
    gifCollectorRef.current?.clear();
    gifCollectorRef.current = null;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    stopTracks();
    chunksRef.current = [];
    settleVideoRef.current?.(null);
    settleVideoRef.current = null;
    stopPromiseRef.current = null;
  }, [clearGifTimer, stopTracks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      release();
    };
  }, [release]);

  useEffect(() => {
    if (!state.isRecording || state.isPaused) return;
    const timer = setInterval(
      () =>
        setState((prev) => ({
          ...prev,
          duration: Math.floor(elapsed() / 1000),
        })),
      1000,
    );
    return () => clearInterval(timer);
  }, [state.isRecording, state.isPaused, elapsed]);

  const getSupportedMimeType = useCallback(
    (preferred: string): string | null => {
      if (typeof MediaRecorder === "undefined") return null;
      const candidates: Record<string, string[]> = {
        webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
        mp4: ["video/mp4;codecs=h264", "video/mp4"],
      };
      return (
        [
          ...(candidates[preferred] ?? candidates.webm),
          ...Object.values(candidates).flat(),
        ].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null
      );
    },
    [],
  );

  const startGifTimer = useCallback(() => {
    clearGifTimer();
    gifIntervalRef.current = setInterval(
      () => gifCollectorRef.current?.captureFrame(elapsed()),
      gifDelayRef.current,
    );
  }, [clearGifTimer, elapsed]);

  const startRecording = useCallback(
    (format = "webm", fps = 30) => {
      // A requested save owns this recording until finalization has settled.
      if (stopPromiseRef.current) return false;
      release();
      lastRecordingRef.current = undefined;
      const generation = generationRef.current;
      const fail = (error: unknown) => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        release();
        setState({
          ...INITIAL_STATE,
          error: error instanceof Error ? error.message : String(error),
        });
      };
      if (!canvasRef.current) {
        fail(new Error("No recording canvas is available."));
        return false;
      }
      if (!Number.isFinite(fps) || fps <= 0) {
        fail(new Error("Recording FPS must be greater than zero."));
        return false;
      }
      try {
        elapsedRef.current = 0;
        resumedAtRef.current = performance.now();
        recordingRef.current = true;
        let actualFormat = format;
        if (format === "gif") {
          gifDelayRef.current = Math.round(1000 / Math.min(fps, 10));
          gifCollectorRef.current = createGifFrameCollector(canvasRef.current, {
            delayMs: gifDelayRef.current,
            maxColors: 256,
            onError: fail,
            onLimit: (result) => {
              if (!mountedRef.current || generation !== generationRef.current)
                return;
              clearGifTimer();
              pausedRef.current = true;
              elapsedRef.current = result.durationMs;
              setState((prev) => ({
                ...prev,
                isPaused: true,
                duration: result.durationMs / 1000,
                limitReached: result.limit ?? null,
              }));
            },
          });
          gifCollectorRef.current.captureFrame(0);
          startGifTimer();
        } else {
          const mimeType = getSupportedMimeType(format);
          if (!mimeType)
            throw new Error("This browser does not support video recording.");
          const stream = canvasRef.current.captureStream(fps);
          streamRef.current = stream;
          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 5_000_000,
          });
          mediaRecorderRef.current = recorder;
          recorder.ondataavailable = (event) => {
            if (generation === generationRef.current && event.data.size > 0)
              chunksRef.current.push(event.data);
          };
          recorder.onerror = () => fail(new Error("Video recording failed."));
          recorder.start(1000);
          actualFormat = mimeType.split(";")[0].split("/")[1] || format;
        }
        setState({ ...INITIAL_STATE, isRecording: true, format: actualFormat });
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [canvasRef, clearGifTimer, getSupportedMimeType, release, startGifTimer],
  );

  const stopRecording = useCallback((): Promise<Blob | null> => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    const collector = gifCollectorRef.current;
    const recorder = mediaRecorderRef.current;
    if (!collector && (!recorder || recorder.state === "inactive"))
      return Promise.resolve(null);
    const end = elapsed();
    elapsedRef.current = end;
    recordingRef.current = false;
    clearGifTimer();
    setState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
      isFinalizing: true,
      limitReached: null,
    }));
    const generation = generationRef.current;
    const finish = (blob: Blob | null, error?: unknown) => {
      if (!mountedRef.current || generation !== generationRef.current)
        return null;
      if (blob)
        lastRecordingRef.current = collector?.details() ?? {
          width: canvasRef.current?.width ?? 0,
          height: canvasRef.current?.height ?? 0,
          durationMs: end,
        };
      release();
      setState({
        ...INITIAL_STATE,
        error: error
          ? error instanceof Error
            ? error.message
            : String(error)
          : null,
      });
      return blob;
    };
    const promise = collector
      ? collector.encode(end).then(
          (blob) => finish(blob),
          (error) => finish(null, error),
        )
      : new Promise<Blob | null>((resolve) => {
          settleVideoRef.current = resolve;
          recorder!.onstop = () => {
            const blob = new Blob(chunksRef.current, {
              type: recorder!.mimeType,
            });
            settleVideoRef.current = null;
            resolve(finish(blob));
          };
          try {
            recorder!.stop();
          } catch (error) {
            settleVideoRef.current = null;
            resolve(finish(null, error));
          }
        });
    stopPromiseRef.current = promise;
    void promise.finally(() => {
      if (stopPromiseRef.current === promise) stopPromiseRef.current = null;
    });
    return promise;
  }, [canvasRef, clearGifTimer, elapsed, release]);

  const pauseRecording = useCallback(() => {
    if (!recordingRef.current || pausedRef.current) return;
    elapsedRef.current = elapsed();
    pausedRef.current = true;
    clearGifTimer();
    if (mediaRecorderRef.current?.state === "recording")
      mediaRecorderRef.current.pause();
    setState((prev) => ({
      ...prev,
      isPaused: true,
      duration: Math.floor(elapsedRef.current / 1000),
    }));
  }, [clearGifTimer, elapsed]);

  const resumeRecording = useCallback(() => {
    if (!recordingRef.current || !pausedRef.current || state.limitReached)
      return;
    pausedRef.current = false;
    resumedAtRef.current = performance.now();
    if (gifCollectorRef.current) startGifTimer();
    if (mediaRecorderRef.current?.state === "paused")
      mediaRecorderRef.current.resume();
    setState((prev) => ({ ...prev, isPaused: false }));
  }, [startGifTimer, state.limitReached]);

  return {
    state,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    getRecordingDetails,
  };
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
