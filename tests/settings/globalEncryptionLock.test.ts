import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeGlobalLock,
  executeMainGlobalLock,
  GLOBAL_LOCK_RESPONSE,
  registerGlobalLockExecutor,
} from "../../src/utils/security/globalEncryptionLock";
const mocks = vi.hoisted(() => ({
  label: "main",
  listener: null as
    | ((event: { payload: { requestId: string; error?: string } }) => void)
    | null,
  emitTo: vi.fn(),
  off: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: mocks.label }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, callback) => {
    mocks.listener = callback;
    return mocks.off;
  }),
  emitTo: mocks.emitTo,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.label = "main";
  mocks.listener = null;
});
describe("Global encryption lock ownership", () => {
  it("fails closed without a primary executor", async () => {
    const native = vi.fn();
    await expect(executeMainGlobalLock(native)).rejects.toThrow("not ready");
    expect(native).not.toHaveBeenCalled();
  });
  it("holds preparation around native invocation and propagates a save failure", async () => {
    const native = vi.fn().mockResolvedValue(undefined);
    const unregister = registerGlobalLockExecutor(async () => {
      throw new Error("save failed");
    });
    try {
      await expect(executeGlobalLock("manual", native)).rejects.toThrow(
        "save failed",
      );
      expect(native).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
  it("routes a detached action to main and waits for its matching acknowledgement", async () => {
    mocks.label = "detached-1";
    const native = vi.fn();
    mocks.emitTo.mockImplementation(async (_target, _event, payload) => {
      mocks.listener?.({ payload: { requestId: "wrong-request" } });
      mocks.listener?.({ payload: { requestId: payload.requestId } });
    });
    await executeGlobalLock("manual", native);
    expect(mocks.emitTo).toHaveBeenCalledWith(
      "main",
      expect.any(String),
      expect.objectContaining({ windowLabel: "detached-1", reason: "manual" }),
    );
    expect(native).not.toHaveBeenCalled();
    expect(mocks.off).toHaveBeenCalledOnce();
    expect(GLOBAL_LOCK_RESPONSE).toBe("encryption-ui-lock-response");
  });
  it("surfaces primary refusal without locally dropping the key", async () => {
    mocks.label = "detached-1";
    const native = vi.fn();
    mocks.emitTo.mockImplementation(async (_target, _event, payload) =>
      mocks.listener?.({
        payload: {
          requestId: payload.requestId,
          error: "Resolve pending database save",
        },
      }),
    );
    await expect(executeGlobalLock("manual", native)).rejects.toThrow(
      "pending database save",
    );
    expect(native).not.toHaveBeenCalled();
  });
  it("times out an unavailable primary and releases the listener", async () => {
    vi.useFakeTimers();
    mocks.label = "detached-1";
    mocks.emitTo.mockResolvedValue(undefined);
    const pending = executeGlobalLock("manual", vi.fn());
    const rejected = expect(pending).rejects.toThrow("did not confirm");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(mocks.off).toHaveBeenCalledOnce();
  });
});
