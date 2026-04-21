import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionRecorder, formatDuration } from "../../src/hooks/recording/useSessionRecorder";

// Stub MediaRecorder which jsdom doesn't provide
class MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;

  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'video/webm';
  }

  static isTypeSupported(mime: string): boolean {
    return mime.startsWith('video/webm');
  }

  start(_timeslice?: number) {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }
}

// Stub MediaStream if not available in jsdom
if (typeof globalThis.MediaStream === "undefined") {
  (globalThis as Record<string, unknown>).MediaStream = class MediaStream {};
}

// Stub captureStream on HTMLCanvasElement
const mockCaptureStream = vi.fn().mockReturnValue(new MediaStream());

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (globalThis as Record<string, unknown>).MediaRecorder = MockMediaRecorder;
  HTMLCanvasElement.prototype.captureStream = mockCaptureStream;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).MediaRecorder;
});

function createCanvasRef(): React.RefObject<HTMLCanvasElement | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  return { current: canvas };
}

describe("useSessionRecorder", () => {
  it("starts with idle state", () => {
    const ref = createCanvasRef();
    const { result } = renderHook(() => useSessionRecorder(ref));

    expect(result.current.state.isRecording).toBe(false);
    expect(result.current.state.isPaused).toBe(false);
    expect(result.current.state.duration).toBe(0);
    expect(result.current.state.format).toBe("");
  });

  it("starts a recording session", () => {
    const ref = createCanvasRef();
    const { result } = renderHook(() => useSessionRecorder(ref));

    let ok = false;
    act(() => {
      ok = result.current.startRecording("webm", 30);
    });

    expect(ok).toBe(true);
    expect(result.current.state.isRecording).toBe(true);
    expect(result.current.state.isPaused).toBe(false);
  });

  it("stops a recording and saves data", async () => {
    const ref = createCanvasRef();
    const { result } = renderHook(() => useSessionRecorder(ref));

    act(() => {
      result.current.startRecording("webm");
    });
    expect(result.current.state.isRecording).toBe(true);

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stopRecording();
    });

    // After stop, state should reset
    expect(result.current.state.isRecording).toBe(false);
    expect(result.current.state.duration).toBe(0);
    // Blob is created from accumulated chunks (empty in stub, but not null because onstop fires)
    expect(blob).toBeInstanceOf(Blob);
  });

  it("handles recording errors when no canvas available", () => {
    const emptyRef: React.RefObject<HTMLCanvasElement | null> = { current: null };
    const { result } = renderHook(() => useSessionRecorder(emptyRef));

    let ok = false;
    act(() => {
      ok = result.current.startRecording("webm");
    });

    expect(ok).toBe(false);
    expect(result.current.state.isRecording).toBe(false);
  });

  it("pauses and resumes recording", () => {
    const ref = createCanvasRef();
    const { result } = renderHook(() => useSessionRecorder(ref));

    act(() => {
      result.current.startRecording("webm");
    });
    expect(result.current.state.isRecording).toBe(true);
    expect(result.current.state.isPaused).toBe(false);

    act(() => {
      result.current.pauseRecording();
    });
    expect(result.current.state.isPaused).toBe(true);

    act(() => {
      result.current.resumeRecording();
    });
    expect(result.current.state.isPaused).toBe(false);
    expect(result.current.state.isRecording).toBe(true);
  });

  it("returns false for unsupported format when no MediaRecorder support", () => {
    // Override isTypeSupported to return false for everything
    (globalThis as Record<string, unknown>).MediaRecorder = class extends MockMediaRecorder {
      static isTypeSupported(): boolean { return false; }
    };

    const ref = createCanvasRef();
    const { result } = renderHook(() => useSessionRecorder(ref));

    let ok = false;
    act(() => {
      ok = result.current.startRecording("mp4");
    });

    expect(ok).toBe(false);
    expect(result.current.state.isRecording).toBe(false);
  });

  it("stopRecording returns null when not recording", async () => {
    const ref = createCanvasRef();
    const { result } = renderHook(() => useSessionRecorder(ref));

    let blob: Blob | null = new Blob();
    await act(async () => {
      blob = await result.current.stopRecording();
    });

    expect(blob).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
});
