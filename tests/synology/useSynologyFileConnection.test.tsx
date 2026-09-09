import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import type { SynologyFileAuthResult } from "../../src/types/hardware/synologyFileStation";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const setup = () => {
  const hook = renderHook(({ open }) => useSynologyFileConnection(open), {
    initialProps: { open: true },
  });
  act(() => {
    hook.result.current.setHost("nas.example.test");
    hook.result.current.setUsername("alice");
    hook.result.current.setPassword("private-password");
  });
  return hook;
};
beforeEach(() => vi.mocked(invoke).mockReset());
afterEach(cleanup);
describe("scoped Synology sign-in", () => {
  it("defaults to verified HTTPS, no insecure/PAT/remembered-device options", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: "connected",
      sessionId: "receipt-a",
      message: "Connected",
    });
    const { result } = setup();
    await act(() => result.current.connect());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("syn_fs_connect", {
      host: "nas.example.test",
      port: 5001,
      username: "alice",
      password: "private-password",
      useHttps: true,
      otpCode: null,
    });
    expect(result.current.connectionStatus).toBe("connected");
    expect(result.current.password).toBe("");
  });
  it("keeps OTP challenge credentials transient and retries invalid codes without saving them", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        status: "otp_required",
        message: "Code required",
      })
      .mockResolvedValueOnce({ status: "otp_invalid", message: "Invalid code" })
      .mockResolvedValueOnce({
        status: "connected",
        sessionId: "receipt-a",
        message: "Connected",
      });
    const { result } = setup();
    await act(() => result.current.connect());
    expect(result.current.challenge?.status).toBe("otp_required");
    expect(result.current.password).toBe("");
    act(() => result.current.setOtpCode("123456"));
    await act(() => result.current.submitOtp());
    expect(result.current.challenge?.status).toBe("otp_invalid");
    expect(result.current.otpCode).toBe("");
    act(() => result.current.setOtpCode("234567"));
    await act(() => result.current.submitOtp());
    expect(invoke).toHaveBeenLastCalledWith(
      "syn_fs_connect",
      expect.objectContaining({
        password: "private-password",
        otpCode: "234567",
      }),
    );
    expect(result.current.challenge).toBeNull();
    expect(result.current.otpCode).toBe("");
  });
  it("cancel destroys pending OTP credentials and refuses retained retry callbacks", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: "otp_required",
      message: "Code required",
    });
    const { result } = setup();
    await act(() => result.current.connect());
    act(() => result.current.setOtpCode("123456"));
    const retry = result.current.submitOtp;
    act(() => result.current.cancelChallenge());
    await act(() => retry());
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "syn_fs_connect"),
    ).toHaveLength(1);
    expect(result.current.password).toBe("");
    expect(result.current.otpCode).toBe("");
  });
  it("releases a late successful login only by its old receipt after cancel/new login", async () => {
    const first = deferred<SynologyFileAuthResult>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_connect" ? first.promise : Promise.resolve(false),
    );
    const { result } = setup();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.connect();
    });
    act(() => result.current.cancelChallenge());
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_connect"
        ? {
            status: "connected",
            sessionId: "new-receipt",
            message: "Connected",
          }
        : false,
    );
    act(() => result.current.setPassword("new-password"));
    await act(() => result.current.connect());
    await act(async () => {
      first.resolve({
        status: "connected",
        sessionId: "old-receipt",
        message: "Connected",
      });
      await pending;
    });
    expect(result.current.sessionId).toBe("new-receipt");
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      expectedSessionId: "old-receipt",
    });
    expect(invoke).not.toHaveBeenCalledWith("syn_disconnect");
  });
  it("close and reopen cannot revive an outstanding OTP result", async () => {
    const pending = deferred<SynologyFileAuthResult>();
    vi.mocked(invoke).mockReturnValue(pending.promise);
    const { result, rerender } = setup();
    let attempt!: Promise<void>;
    act(() => {
      attempt = result.current.connect();
    });
    rerender({ open: false });
    rerender({ open: true });
    await act(async () => {
      pending.resolve({ status: "otp_required", message: "Old code request" });
      await attempt;
    });
    expect(result.current.challenge).toBeNull();
    expect(result.current.connectionStatus).toBe("disconnected");
  });
  it("unsupported MFA does not retry automatically or retain a password", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: "unsupported_mfa",
      message: "Web sign-in required",
    });
    const { result } = setup();
    await act(() => result.current.connect());
    act(() => result.current.setOtpCode("123456"));
    await act(() => result.current.submitOtp());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.password).toBe("");
  });
});
