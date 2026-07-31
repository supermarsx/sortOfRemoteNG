import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebRecording } from "../../types/recording/macroTypes";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import { exportWebRecording, redactWebRecordingHeaders } from "./macroService";

const recordingFixture = (): WebRecording => ({
  metadata: {
    session_id: "session-1",
    start_time: "2026-07-30T12:00:00Z",
    end_time: "2026-07-30T12:00:01Z",
    host: "example.test",
    target_url: "https://example.test",
    duration_ms: 10,
    entry_count: 1,
    total_bytes_transferred: 12,
  },
  entries: [
    {
      timestamp_ms: 0,
      method: "GET",
      url: "https://example.test/api",
      request_headers: {
        COOKIE: "session=request-secret",
        Authorization: "Bearer request-secret",
        "x-auth-token": "request-token",
        "X-Client-Secret": "client-secret",
        "X-Signing-Key": "signing-key",
        "Content-Type": "application/json",
        "X-Request-ID": "request-123",
      },
      request_body_size: 0,
      status: 200,
      response_headers: {
        "Set-Cookie": "session=response-secret",
        "PROXY-AUTHORIZATION": "Basic response-secret",
        "x-api-key": "response-key",
        "Cache-Control": "no-store",
        "Server-Timing": "db;dur=4",
      },
      response_body_size: 12,
      content_type: "application/json",
      duration_ms: 10,
      error: null,
    },
  ],
});

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("web recording header redaction", () => {
  it("removes sensitive names case-insensitively and preserves diagnostics", () => {
    const redacted = redactWebRecordingHeaders(recordingFixture());

    expect(redacted.entries[0].request_headers).toEqual({
      "Content-Type": "application/json",
      "X-Request-ID": "request-123",
    });
    expect(redacted.entries[0].response_headers).toEqual({
      "Cache-Control": "no-store",
      "Server-Timing": "db;dur=4",
    });
  });

  it("redacts native JSON and the recording passed to HAR export", async () => {
    const nativeJson = await exportWebRecording(recordingFixture(), "json");
    expect(nativeJson).not.toContain("request-secret");
    expect(nativeJson).not.toContain("response-secret");
    expect(nativeJson).toContain("X-Request-ID");

    mocks.invoke.mockResolvedValueOnce('{"log":{"entries":[]}}');
    await exportWebRecording(recordingFixture(), "har");

    expect(mocks.invoke).toHaveBeenCalledWith("export_web_recording_har", {
      recording: expect.objectContaining({
        entries: [
          expect.objectContaining({
            request_headers: {
              "Content-Type": "application/json",
              "X-Request-ID": "request-123",
            },
            response_headers: {
              "Cache-Control": "no-store",
              "Server-Timing": "db;dur=4",
            },
          }),
        ],
      }),
    });
  });
});
