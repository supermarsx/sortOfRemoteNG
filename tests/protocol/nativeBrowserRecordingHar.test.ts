import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { createNativeBrowserHarAdapter } from "../../src/hooks/protocol/nativeBrowserRecordingHar";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
const target = {
  identity: {
    ownerDatabaseId: "db",
    connectionId: "connection",
    sessionId: "session",
    attemptId: "attempt",
  },
  viewId: null,
};
function snapshot() {
  return {
    identity: target.identity,
    recordingId: "abc-123",
    phase: "stopped",
    durationMs: 1234,
    entryCount: 1,
    droppedEntries: 0,
    receivedBodyBytes: 512,
    metadataOnly: true,
  };
}
function reply() {
  return {
    snapshot: snapshot(),
    har: {
      log: {
        version: "1.2",
        _metadataOnly: true,
        entries: [
          {
            startedDateTime: "2026-10-08T12:00:00.000Z",
            time: 20,
            request: { method: "GET", url: "https://example.test/" },
            response: { status: 200, content: { size: 512 } },
            _outcome: "success",
          },
        ],
      },
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(reply());
  vi.mocked(save).mockResolvedValue("C:/chosen/capture.har");
  vi.mocked(writeFile).mockResolvedValue(undefined);
});

describe("native metadata HAR wire adapter", () => {
  it("retains a late start's exact cleanup handle without adopting another recording", async () => {
    let valid = true;
    const adapter = createNativeBrowserHarAdapter(() => {
      if (!valid) throw new Error();
    });
    vi.mocked(invoke).mockImplementationOnce(async () => {
      valid = false;
      return reply();
    });
    await expect(adapter.start(target)).rejects.toThrow();
    vi.mocked(invoke).mockResolvedValue({ snapshot: null, har: null });
    await adapter.discard(target);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[1][1]).toEqual({
      request: {
        identity: target.identity,
        operation: { kind: "discard", recordingId: "abc-123" },
      },
    });
  });
  it("never discards an existing recording when our start was rejected", async () => {
    const adapter = createNativeBrowserHarAdapter(vi.fn());
    vi.mocked(invoke).mockRejectedValueOnce(new Error("already recording"));
    await expect(adapter.start(target)).rejects.toThrow();
    await adapter.discard(target);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("sends the exact backend envelope and never exports on Stop", async () => {
    const adapter = createNativeBrowserHarAdapter(vi.fn());
    await adapter.start(target);
    await adapter.stop(target);
    expect(invoke).toHaveBeenNthCalledWith(1, "origin_browser_recording", {
      request: {
        identity: target.identity,
        operation: { kind: "start", metadataOnly: true },
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "origin_browser_recording", {
      request: {
        identity: target.identity,
        operation: { kind: "stop", recordingId: "abc-123" },
      },
    });
    expect(save).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("exports only bounded metadata to the explicit destination and scrubs its byte buffer", async () => {
    const response = reply();
    Object.assign(response.har.log, { arbitrarySecret: "never export" });
    Object.assign(response.har.log.entries[0].request, {
      headers: [{ value: "credential" }],
      postData: "password",
    });
    vi.mocked(invoke).mockResolvedValue(response);
    let written = "",
      passed: Uint8Array | undefined;
    vi.mocked(writeFile).mockImplementation(async (_path, data) => {
      passed = data as Uint8Array;
      written = new TextDecoder().decode(passed);
    });
    const adapter = createNativeBrowserHarAdapter(vi.fn());
    await adapter.start(target);
    expect(await adapter.save(target)).toBe("saved");
    const saved = JSON.parse(written);
    expect(saved.log.entries[0].request.url).toBe("https://example.test/");
    expect(saved.log.entries[0].request.headers).toEqual([]);
    expect(written).not.toMatch(/never export|credential|password/);
    expect(passed!.every((byte) => byte === 0)).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
    // Export leaves the stopped recording until an explicit Discard/owner cleanup.
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls[calls.length - 1]?.[1]).toEqual({
      request: {
        identity: target.identity,
        operation: { kind: "export", recordingId: "abc-123" },
      },
    });
  });
  it("never exports bytes when the destination picker is cancelled", async () => {
    const adapter = createNativeBrowserHarAdapter(vi.fn());
    await adapter.start(target);
    vi.mocked(save).mockResolvedValue(null);
    expect(await adapter.save(target)).toBe("cancelled");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it.each([
    "owner",
    "recording",
    "entries",
    "path",
    "query",
    "userinfo",
    "metadata",
  ])("rejects invalid %s export data", async (bad) => {
    const adapter = createNativeBrowserHarAdapter(vi.fn());
    await adapter.start(target);
    const response = reply();
    if (bad === "owner")
      response.snapshot.identity = {
        ...target.identity,
        attemptId: "replacement",
      };
    if (bad === "recording") response.snapshot.recordingId = "def-456";
    if (bad === "entries") response.snapshot.entryCount = 2049;
    if (bad === "path")
      response.har.log.entries[0].request.url = "https://example.test/private";
    if (bad === "query")
      response.har.log.entries[0].request.url =
        "https://example.test/?token=value";
    if (bad === "userinfo")
      response.har.log.entries[0].request.url =
        "https://user:pass@example.test/";
    if (bad === "metadata") response.snapshot.metadataOnly = false;
    vi.mocked(invoke).mockResolvedValue(response);
    await expect(adapter.save(target)).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("refuses popup retargeting without invoking native", async () => {
    const adapter = createNativeBrowserHarAdapter(vi.fn());
    const child = { ...target, viewId: "popup" };
    expect(adapter.available?.(child)).toBe(false);
    await expect(adapter.start(child)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects a different attempt and rechecks ownership after the dialog", async () => {
    let valid = true;
    const adapter = createNativeBrowserHarAdapter(() => {
      if (!valid) throw new Error();
    });
    await adapter.start(target);
    await expect(
      adapter.stop({
        ...target,
        identity: { ...target.identity, attemptId: "replacement" },
      }),
    ).rejects.toThrow();
    vi.mocked(save).mockImplementation(async () => {
      valid = false;
      return "C:/chosen/capture.har";
    });
    await expect(adapter.save(target)).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("permits cleanup of the original capture after revocation", async () => {
    let valid = true;
    const adapter = createNativeBrowserHarAdapter(() => {
      if (!valid) throw new Error();
    });
    await adapter.start(target);
    valid = false;
    vi.mocked(invoke).mockResolvedValue({ snapshot: null, har: null });
    await adapter.discard(target);
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls[calls.length - 1]?.[1]).toEqual({
      request: {
        identity: target.identity,
        operation: { kind: "discard", recordingId: "abc-123" },
      },
    });
  });
});
