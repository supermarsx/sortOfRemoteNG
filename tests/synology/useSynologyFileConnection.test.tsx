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
  it("resolves vault credentials with a base guard, completes one server-requested OTP, and never stores login secrets in form state", async () => {
    const resolveCredentials = vi.fn(async (assertAttempt: () => void) => ({
      username: "vault-user",
      password: "vault-secret",
      assertCurrent: assertAttempt,
    }));
    const resolveOtp = vi.fn(async (assertAttempt: () => void) => ({
      code: "123456",
      assertCurrent: assertAttempt,
    }));
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_connect"
        ? vi
            .mocked(invoke)
            .mock.calls.filter(([name]) => name === "syn_fs_connect").length ===
          1
          ? { status: "otp_required" }
          : { status: "connected", sessionId: "vault-receipt" }
        : {
            status: "connected",
            lastVerifiedAt: "",
            consecutiveFailures: 0,
            message: null,
          },
    );
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: {
          host: "nas.test",
          port: 5001,
          useHttps: true,
          username: "",
          password: "",
        },
        resolveCredentials,
        resolveOtp,
      }),
    );
    await act(() => result.current.connect());
    expect(result.current.connectionStatus).toBe("connected");
    expect(result.current.username).toBe("");
    expect(result.current.password).toBe("");
    expect(result.current.otpCode).toBe("");
    const calls = vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "syn_fs_connect");
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({
      username: "vault-user",
      password: "vault-secret",
      otpCode: null,
    });
    expect(calls[1][1]).toMatchObject({
      username: "vault-user",
      password: "vault-secret",
      otpCode: "123456",
    });
    expect((calls[0][1] as Record<string, unknown>).requestId).not.toBe(
      (calls[1][1] as Record<string, unknown>).requestId,
    );
    expect(resolveOtp).toHaveBeenCalledOnce();
  });
  it("does not retry a rejected vault OTP and re-resolves credentials for explicit manual verification", async () => {
    const resolveCredentials = vi.fn(async (assertAttempt: () => void) => ({
      username: "vault-user",
      password: "vault-secret",
      assertCurrent: assertAttempt,
    }));
    const resolveOtp = vi.fn(async (assertAttempt: () => void) => ({
      code: "123456",
      assertCurrent: assertAttempt,
    }));
    vi.mocked(invoke)
      .mockResolvedValueOnce({ status: "otp_required" })
      .mockResolvedValue({ status: "otp_invalid" });
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: {
          host: "nas.test",
          port: 5001,
          useHttps: true,
          username: "",
          password: "",
        },
        resolveCredentials,
        resolveOtp,
      }),
    );
    await act(() => result.current.connect());
    expect(result.current.challenge?.status).toBe("otp_invalid");
    expect(invoke).toHaveBeenCalledTimes(2);
    act(() => result.current.setOtpCode("654321"));
    await act(() => result.current.submitOtp());
    expect(resolveCredentials).toHaveBeenCalledTimes(2);
    expect(resolveOtp).toHaveBeenCalledOnce();
    expect(vi.mocked(invoke).mock.calls[2][1]).toMatchObject({
      otpCode: "654321",
      password: "vault-secret",
    });
  });
  it("cancels a deferred vault resolution before any NAS request", async () => {
    const pending = deferred<{
      username: string;
      password: string;
      assertCurrent: () => void;
    }>();
    const resolveCredentials = vi.fn(() => pending.promise);
    const { result, unmount } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: {
          host: "nas.test",
          port: 5001,
          useHttps: true,
          username: "",
          password: "",
        },
        resolveCredentials,
      }),
    );
    let work!: Promise<void>;
    act(() => {
      work = result.current.connect();
    });
    unmount();
    pending.resolve({
      username: "late",
      password: "secret",
      assertCurrent: () => {},
    });
    await act(() => work);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "syn_fs_connect"),
    ).toBe(false);
  });
  it.each<[string, boolean]>([
    ["http://nas.example.test/", true],
    ["https://nas.example.test/", false],
  ])(
    "refuses saved transport conflict %s / HTTPS=%s before releasing credentials",
    async (host, useHttps) => {
      const { result } = renderHook(() =>
        useSynologyFileConnection(true, {
          initialConfig: {
            host,
            port: 5001,
            username: "fixture-user",
            password: "fixture-password",
            useHttps,
          },
        }),
      );
      await act(() => result.current.connect());
      expect(invoke).not.toHaveBeenCalled();
      expect(result.current.connectionStatus).toBe("error");
      expect(result.current.sessionId).toBeNull();
      expect(result.current.connectionError).toContain("URL conflicts");
      expect(result.current.connectionError).toContain("Edit Connection");
    },
  );

  it("retains explicit URL transport selection for the standalone form", async () => {
    vi.mocked(invoke).mockResolvedValue({ status: "otp_required" });
    const { result } = setup();
    act(() => result.current.setHost("http://nas.example.test/"));
    await act(() => result.current.connect());
    expect(invoke).toHaveBeenCalledWith(
      "syn_fs_connect",
      expect.objectContaining({
        host: "nas.example.test",
        port: 80,
        useHttps: false,
      }),
    );
  });

  it("normalizes a saved subdomain URL and retries with its saved credentials, not an inline form", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(Error("NAS unreachable"))
      .mockResolvedValueOnce({
        status: "connected",
        sessionId: "receipt-retry",
      });
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: {
          host: "https://nas.office.example.test:5443/",
          port: 5001,
          username: "fixture-user",
          password: "fixture-password",
          useHttps: true,
        },
      }),
    );
    await act(() => result.current.connect());
    expect(result.current.connectionStatus).toBe("error");
    expect(result.current.password).toBe("");
    await act(() => result.current.connect());
    expect(result.current.connectionStatus).toBe("connected");
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "syn_fs_connect",
      expect.objectContaining({
        host: "nas.office.example.test",
        port: 5443,
        username: "fixture-user",
        password: "fixture-password",
        useHttps: true,
      }),
    );
  });
  it.each([
    null,
    { status: "__proto__" },
    { status: "connected", sessionId: "" },
  ])("rejects malformed authentication outcomes %j", async (response) => {
    vi.mocked(invoke).mockResolvedValue(response);
    const { result } = setup();
    await act(() => result.current.connect());
    expect(result.current.connectionStatus).toBe("error");
    expect(result.current.sessionId).toBeNull();
    expect(result.current.challenge).toBeNull();
  });
  it("isolates simultaneous NAS tabs and expires only the matching receipt", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === "syn_fs_connect"
        ? {
            status: "connected",
            sessionId: `receipt-${(args as { instanceId: string }).instanceId}`,
            message: "Connected",
          }
        : undefined,
    );
    const config = {
      host: "nas.example.test",
      port: 5001,
      username: "user",
      password: "secret-value",
      useHttps: true,
    };
    const a = renderHook(() =>
      useSynologyFileConnection(true, {
        instanceId: "tab-a",
        initialConfig: config,
      }),
    );
    const b = renderHook(() =>
      useSynologyFileConnection(true, {
        instanceId: "tab-b",
        initialConfig: config,
      }),
    );
    await act(async () => {
      await Promise.all([
        a.result.current.connect(),
        b.result.current.connect(),
      ]);
    });
    expect(a.result.current.sessionId).toBe("receipt-tab-a");
    expect(b.result.current.sessionId).toBe("receipt-tab-b");
    act(() => b.result.current.notifySessionExpired("receipt-tab-a"));
    expect(b.result.current.connectionStatus).toBe("connected");
    await act(() => a.result.current.disconnect());
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "tab-a",
      expectedSessionId: "receipt-tab-a",
    });
    expect(b.result.current.connectionStatus).toBe("connected");
    act(() => b.result.current.notifySessionExpired("receipt-tab-b"));
    expect(b.result.current.connectionStatus).toBe("disconnected");
    expect(b.result.current.sessionId).toBeNull();
  });
  it("cancels the exact native attempt on close and refuses stale success after access revocation", async () => {
    const pending = deferred<SynologyFileAuthResult>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_connect"
        ? pending.promise
        : Promise.resolve(undefined),
    );
    let allowed = true;
    const access = () => {
      if (!allowed) throw new Error("locked");
    };
    const config = {
      host: "nas.example.test",
      port: 5001,
      username: "user",
      password: "secret",
      useHttps: true,
    };
    const hook = renderHook(
      ({ open }) =>
        useSynologyFileConnection(open, {
          instanceId: "saved-tab",
          initialConfig: config,
          assertCurrent: access,
        }),
      { initialProps: { open: true } },
    );
    let attempt!: Promise<void>;
    act(() => {
      attempt = hook.result.current.connect();
    });
    const request = vi
      .mocked(invoke)
      .mock.calls.find(([command]) => command === "syn_fs_connect")![1] as {
      requestId: string;
    };
    allowed = false;
    hook.rerender({ open: false });
    expect(invoke).toHaveBeenCalledWith("syn_fs_cancel_connect", {
      instanceId: "saved-tab",
      requestId: request.requestId,
    });
    await act(async () => {
      pending.resolve({
        status: "connected",
        sessionId: "late",
        message: "ok",
      });
      await attempt;
    });
    expect(hook.result.current.sessionId).toBeNull();
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "saved-tab",
      expectedSessionId: "late",
    });
  });
  it("locks a saved target tuple and cannot send credentials to an edited host", async () => {
    const hook = renderHook(() =>
      useSynologyFileConnection(true, {
        instanceId: "saved",
        initialConfig: {
          host: "nas.example.test",
          port: 5001,
          username: "user",
          password: "secret",
          useHttps: true,
        },
      }),
    );
    act(() => hook.result.current.setHost("different.example.test"));
    await act(() => hook.result.current.connect());
    expect(invoke).not.toHaveBeenCalled();
    expect(hook.result.current.connectionError).toContain("Edit Connection");
  });
  it("clears an OTP challenge after a transport failure and preserves safe actionable errors", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ status: "otp_required", message: "code" })
      .mockRejectedValueOnce(
        new Error(
          "This client IP is blocked by the NAS. password=private-password code 123456",
        ),
      );
    const { result } = setup();
    await act(() => result.current.connect());
    act(() => result.current.setOtpCode("123456"));
    await act(() => result.current.submitOtp());
    expect(result.current.challenge).toBeNull();
    expect(result.current.connectionError).toContain("client IP is blocked");
    expect(result.current.connectionError).not.toContain("private-password");
    expect(result.current.connectionError).not.toContain("123456");
    const count = vi.mocked(invoke).mock.calls.length;
    await act(() => result.current.submitOtp());
    expect(vi.mocked(invoke).mock.calls).toHaveLength(count);
  });
  it("defaults to verified HTTPS, no insecure/PAT/remembered-device options", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: "connected",
      sessionId: "receipt-a",
      message: "Connected",
    });
    const { result } = setup();
    await act(() => result.current.connect());
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([name]) => name === "syn_fs_connect"),
    ).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("syn_fs_connect", {
      host: "nas.example.test",
      port: 5001,
      username: "alice",
      password: "private-password",
      useHttps: true,
      otpCode: null,
      instanceId: result.current.instanceId,
      requestId: expect.any(String),
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
    expect(invoke).toHaveBeenNthCalledWith(
      3,
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
      instanceId: result.current.instanceId,
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
