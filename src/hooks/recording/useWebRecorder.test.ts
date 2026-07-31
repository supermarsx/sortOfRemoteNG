import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebRecording } from "../../types/recording/macroTypes";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import { useWebRecorder } from "./useWebRecorder";

const capturedRecording: WebRecording = {
  metadata: {
    session_id: "session-1",
    start_time: "2026-07-30T12:00:00Z",
    end_time: "2026-07-30T12:00:01Z",
    host: "example.test",
    target_url: "https://example.test",
    duration_ms: 10,
    entry_count: 1,
    total_bytes_transferred: 0,
  },
  entries: [
    {
      timestamp_ms: 0,
      method: "GET",
      url: "https://example.test",
      request_headers: {
        Cookie: "session=secret",
        "X-Request-ID": "request-123",
      },
      request_body_size: 0,
      status: 200,
      response_headers: {
        "Set-Cookie": "session=secret",
        "Content-Type": "text/html",
      },
      response_body_size: 0,
      content_type: "text/html",
      duration_ms: 10,
      error: null,
    },
  ],
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "stop_web_recording") return capturedRecording;
    return undefined;
  });
});

describe("useWebRecorder privacy boundary", () => {
  it("defaults header capture off and sanitizes the stopped recording", async () => {
    const { result, unmount } = renderHook(() => useWebRecorder());

    await act(async () => {
      await result.current.startRecording("session-1");
    });
    expect(mocks.invoke).toHaveBeenCalledWith("start_web_recording", {
      sessionId: "session-1",
      recordHeaders: false,
    });

    let stopped: WebRecording | null = null;
    await act(async () => {
      stopped = await result.current.stopRecording("session-1");
    });
    const completedRecording = stopped as WebRecording | null;
    if (!completedRecording) {
      throw new Error("Expected the stopped web recording to be returned");
    }
    expect(completedRecording.entries[0].request_headers).toEqual({
      "X-Request-ID": "request-123",
    });
    expect(completedRecording.entries[0].response_headers).toEqual({
      "Content-Type": "text/html",
    });

    unmount();
  });
});
