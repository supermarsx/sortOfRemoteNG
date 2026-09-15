import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import type { SynologyFileAuthResult } from "../../src/types/hardware/synologyFileStation";
import {
  parseSynologyApiFailure,
  SYNOLOGY_DIAGNOSTIC_MARKER,
} from "../../src/utils/synology/apiFailureDiagnostic";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));
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
  it.each(["html", "200"])(
    "preserves only closed failure metadata when a short password is %s",
    async (password) => {
      const data = {
        stage: "api_login",
        category: "html",
        httpStatus: 200,
        contentType: "html",
        bytesRead: 500,
      };
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error(
          `Safe failure mentioning ${password}.${SYNOLOGY_DIAGNOSTIC_MARKER}${JSON.stringify(data)}`,
        ),
      );
      const { result } = setup();
      act(() => result.current.setPassword(password));
      await act(() => result.current.connect());
      expect(parseSynologyApiFailure(result.current.connectionError!)).toEqual(
        data,
      );
      expect(
        result.current.connectionError!.split(SYNOLOGY_DIAGNOSTIC_MARKER)[0],
      ).not.toContain(password);
      expect(result.current.connectionError).toContain("[REDACTED]");
      expect(result.current.connectionStatus).toBe("error");
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === "syn_fs_connect"),
      ).toHaveLength(1);
    },
  );
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
    await act(async () => {
      work = result.current.connect();
    });
    expect(resolveCredentials).toHaveBeenCalledOnce();
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
    await act(async () => {
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
      route: { kind: "direct" },
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
    await act(async () => {
      pending = result.current.connect();
    });
    expect(invoke).toHaveBeenCalledWith(
      "syn_fs_connect",
      expect.objectContaining({ password: "private-password" }),
    );
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
    await act(async () => {
      attempt = result.current.connect();
    });
    expect(invoke).toHaveBeenCalledWith(
      "syn_fs_connect",
      expect.objectContaining({ otpCode: null }),
    );
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

const savedLogin = {
  host: "nas.example.test",
  port: 5001,
  useHttps: true,
  username: "fixture-admin",
  password: "fixture-password-9f3",
};
const healthy = {
  status: "connected",
  lastVerifiedAt: "",
  consecutiveFailures: 0,
  message: null,
};
/** Scripts `syn_fs_connect` outcomes in order; other commands succeed. */
const scriptNative = (
  ...outcomes: (unknown | (() => Promise<unknown>) | Error)[]
) => {
  const queue = [...outcomes];
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "syn_fs_session_health") return healthy;
    if (command !== "syn_fs_connect") return true;
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
};
const connectCalls = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "syn_fs_connect")
    .map(([, args]) => args as Record<string, unknown>);
const vaultOptions = () => ({
  resolveCredentials: vi.fn(async (assertAttempt: () => void) => ({
    username: "vault-admin",
    password: "vault-password-7c1",
    assertCurrent: assertAttempt,
  })),
  resolveOtp: vi.fn(async (assertAttempt: () => void) => ({
    code: "246810",
    assertCurrent: assertAttempt,
  })),
});
const savedHook = (options: Parameters<typeof useSynologyFileConnection>[1]) =>
  renderHook(() =>
    useSynologyFileConnection(true, {
      instanceId: "saved-tab",
      initialConfig: savedLogin,
      ...options,
    }),
  );

describe("NAS API two-factor challenge states", () => {
  it("403 asks for a manual code, then connects with the same credentials", async () => {
    scriptNative(
      { status: "otp_required", message: "native text", methods: ["otp"] },
      { status: "connected", sessionId: "receipt-otp", message: "ok" },
    );
    const { result } = savedHook({});
    await act(() => result.current.connect());
    expect(result.current.challenge).toEqual({
      status: "otp_required",
      message: "Enter the current one-time code from your authenticator.",
      methods: ["otp"],
    });
    act(() => result.current.setOtpCode(" 135790 "));
    await act(() => result.current.submitOtp());
    expect(result.current.connectionStatus).toBe("connected");
    expect(result.current.challenge).toBeNull();
    expect(connectCalls()).toHaveLength(2);
    expect(connectCalls()[1]).toMatchObject({
      username: "fixture-admin",
      password: "fixture-password-9f3",
      otpCode: "135790",
    });
    expect(connectCalls()[1]).not.toHaveProperty("sessionProfile");
  });

  it("403 with a vault authenticator generates exactly one code and one retry, even when DSM asks again", async () => {
    const vault = vaultOptions();
    scriptNative({ status: "otp_required" }, { status: "otp_required" });
    const { result } = savedHook(vault);
    await act(() => result.current.connect());
    expect(vault.resolveOtp).toHaveBeenCalledOnce();
    expect(connectCalls().map((args) => args.otpCode)).toEqual([
      null,
      "246810",
    ]);
    expect(result.current.challenge?.status).toBe("otp_required");
    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("404 keeps the code dialog open for a fresh manual code", async () => {
    scriptNative(
      { status: "otp_invalid", message: "native" },
      { status: "connected", sessionId: "receipt-404", message: "ok" },
    );
    const { result } = savedHook({});
    await act(() => result.current.connect());
    expect(result.current.challenge).toEqual({
      status: "otp_invalid",
      message: "The one-time code was not accepted. Enter a fresh code.",
    });
    act(() => result.current.setOtpCode("112233"));
    await act(() => result.current.submitOtp());
    expect(connectCalls()[1]).toMatchObject({ otpCode: "112233" });
    expect(result.current.sessionId).toBe("receipt-404");
  });

  it("406 shows enrollment guidance, never asks the vault authenticator, and clears pending credentials", async () => {
    const vault = vaultOptions();
    scriptNative({ status: "otp_enrollment_required", message: "native" });
    const { result } = savedHook(vault);
    await act(() => result.current.connect());
    expect(result.current.challenge).toEqual({
      status: "otp_enrollment_required",
      message:
        "DSM requires this account to set up two-factor authentication before it can sign in. Complete setup once in DSM in your browser (the DSM website view works), then connect again.",
    });
    expect(vault.resolveOtp).not.toHaveBeenCalled();
    expect(connectCalls()).toHaveLength(1);
    act(() => result.current.setOtpCode("246810"));
    await act(() => result.current.submitOtp());
    expect(connectCalls()).toHaveLength(1);
    expect(result.current.password).toBe("");
    expect(JSON.stringify(result.current.challenge)).not.toContain("vault");
  });

  it("449 with methods names Secure SignIn approval and security keys, with no code path", async () => {
    scriptNative({
      status: "unsupported_mfa",
      message: "native password=fixture-password-9f3",
      methods: ["secure_signin_approval", "security_key", "carrier_pigeon", 7],
    });
    const { result } = savedHook(vaultOptions());
    await act(() => result.current.connect());
    expect(result.current.challenge).toEqual({
      status: "unsupported_mfa",
      message:
        "DSM requires a sign-in method the NAS API can't complete. This account uses Secure SignIn approval and a security key. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.",
      methods: ["secure_signin_approval", "security_key"],
    });
    act(() => result.current.setOtpCode("246810"));
    await act(() => result.current.submitOtp());
    expect(connectCalls()).toHaveLength(1);
  });

  it.each([undefined, [], "otp", [{ type: "fido" }]])(
    "449 with unusable methods %j falls back to generic guidance",
    async (methods) => {
      scriptNative({ status: "unsupported_mfa", message: "native", methods });
      const { result } = savedHook({});
      await act(() => result.current.connect());
      expect(result.current.challenge).toEqual({
        status: "unsupported_mfa",
        message:
          "DSM requires a sign-in method the NAS API can't complete. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.",
      });
    },
  );

  it("403 with an approval method combines the code prompt with the website fallback and keeps trusted-device flags", async () => {
    scriptNative({
      status: "otp_required",
      message: "native",
      methods: ["secure_signin_approval", "otp"],
      trustedDeviceRejected: true,
      trustedDeviceMismatch: "yes",
      deviceId: "fixture-did-should-not-survive",
    });
    const { result } = savedHook({});
    await act(() => result.current.connect());
    expect(result.current.challenge).toEqual({
      status: "otp_required",
      message:
        "Enter the one-time code from your authenticator app or the code shown in Synology Secure SignIn. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.",
      methods: ["otp", "secure_signin_approval"],
      trustedDeviceRejected: true,
    });
    expect(JSON.stringify(result.current)).not.toContain("fixture-did");
  });

  it("cancel during a code prompt keeps the next sign-in a normal attempt", async () => {
    scriptNative(
      { status: "otp_required" },
      { status: "connected", sessionId: "receipt-after-cancel", message: "" },
    );
    const { result } = savedHook({});
    await act(() => result.current.connect());
    act(() => result.current.cancelChallenge());
    expect(result.current.challenge).toBeNull();
    expect(result.current.connectionStatus).toBe("disconnected");
    await act(() => result.current.connect());
    expect(connectCalls()).toHaveLength(2);
    expect(connectCalls()[1]).toMatchObject({ otpCode: null });
    expect(result.current.sessionId).toBe("receipt-after-cancel");
  });
});

describe("NAS API reconnect", () => {
  const connectFirst = async (
    options: Parameters<typeof useSynologyFileConnection>[1] = {},
  ) => {
    scriptNative({
      status: "connected",
      sessionId: "receipt-old",
      message: "ok",
    });
    const hook = savedHook(options);
    await act(() => hook.result.current.connect());
    expect(hook.result.current.sessionId).toBe("receipt-old");
    vi.mocked(invoke).mockClear();
    return hook;
  };

  it("releases the previous receipt first, then makes exactly one DSM desktop sign-in", async () => {
    const { result } = await connectFirst();
    scriptNative({
      status: "connected",
      sessionId: "receipt-webui",
      message: "ok",
    });
    await act(() =>
      result.current.reconnect({ sessionProfile: "dsm_desktop" }),
    );
    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    const released = commands.indexOf("syn_fs_disconnect");
    expect(released).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(invoke).mock.calls[released][1]).toEqual({
      instanceId: "saved-tab",
      expectedSessionId: "receipt-old",
    });
    expect(released).toBeLessThan(commands.indexOf("syn_fs_connect"));
    expect(connectCalls()).toHaveLength(1);
    expect(connectCalls()[0]).toEqual({
      ...savedLogin,
      instanceId: "saved-tab",
      requestId: expect.any(String),
      otpCode: null,
      route: { kind: "direct" },
      sessionProfile: "dsm_desktop",
    });
    expect(result.current.sessionId).toBe("receipt-webui");
    expect(result.current.connectionStatus).toBe("connected");
  });

  it("keeps the old payload for a plain reconnect and sends an explicit File Station profile only when asked", async () => {
    const { result } = await connectFirst();
    scriptNative(
      { status: "connected", sessionId: "receipt-plain", message: "ok" },
      { status: "connected", sessionId: "receipt-fs", message: "ok" },
    );
    await act(() => result.current.reconnect());
    expect(connectCalls()[0]).not.toHaveProperty("sessionProfile");
    expect(result.current.sessionId).toBe("receipt-plain");
    await act(() =>
      result.current.reconnect({ sessionProfile: "file_station" }),
    );
    expect(connectCalls()).toHaveLength(2);
    expect(connectCalls()[1]).toMatchObject({ sessionProfile: "file_station" });
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "saved-tab",
      expectedSessionId: "receipt-plain",
    });
  });

  it("shows the code prompt during reconnect and keeps the DSM desktop profile for the submitted code", async () => {
    const { result } = await connectFirst();
    scriptNative(
      { status: "otp_required" },
      { status: "otp_invalid" },
      { status: "connected", sessionId: "receipt-webui", message: "ok" },
    );
    await act(() =>
      result.current.reconnect({ sessionProfile: "dsm_desktop" }),
    );
    expect(result.current.sessionId).toBeNull();
    expect(result.current.challenge?.status).toBe("otp_required");
    act(() => result.current.setOtpCode("111111"));
    await act(() => result.current.submitOtp());
    expect(result.current.challenge?.status).toBe("otp_invalid");
    act(() => result.current.setOtpCode("222222"));
    await act(() => result.current.submitOtp());
    expect(
      connectCalls().map((args) => [args.otpCode, args.sessionProfile]),
    ).toEqual([
      [null, "dsm_desktop"],
      ["111111", "dsm_desktop"],
      ["222222", "dsm_desktop"],
    ]);
    expect(result.current.sessionId).toBe("receipt-webui");
  });

  it("uses a vault authenticator at most once during reconnect", async () => {
    const vault = vaultOptions();
    const { result } = await connectFirst(vault);
    scriptNative({ status: "otp_required" }, { status: "otp_invalid" });
    await act(() =>
      result.current.reconnect({ sessionProfile: "dsm_desktop" }),
    );
    expect(vault.resolveOtp).toHaveBeenCalledOnce();
    expect(
      connectCalls().map((args) => [args.otpCode, args.sessionProfile]),
    ).toEqual([
      [null, "dsm_desktop"],
      ["246810", "dsm_desktop"],
    ]);
    expect(result.current.challenge?.status).toBe("otp_invalid");
  });

  it("does not sign in when releasing the previous receipt fails", async () => {
    const { result } = await connectFirst();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "syn_fs_disconnect") throw new Error("release failed");
      return { status: "connected", sessionId: "never", message: "" };
    });
    await act(() =>
      result.current.reconnect({ sessionProfile: "dsm_desktop" }),
    );
    expect(connectCalls()).toHaveLength(0);
    expect(result.current.connectionStatus).toBe("error");
    expect(result.current.connectionError).toContain("NAS cleanup failed");
  });

  it("stops when the user cancels while the previous receipt is being released", async () => {
    const { result } = await connectFirst();
    const releasing = deferred<boolean>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_disconnect"
        ? releasing.promise
        : Promise.resolve({ status: "connected", sessionId: "never" }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.reconnect({ sessionProfile: "dsm_desktop" });
    });
    expect(result.current.connectionStatus).toBe("connecting");
    await act(() => result.current.reconnect());
    act(() => result.current.cancelChallenge());
    await act(async () => {
      releasing.resolve(true);
      await pending;
    });
    expect(connectCalls()).toHaveLength(0);
    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("does not reuse the DSM desktop profile after that reconnect attempt ends", async () => {
    const { result } = await connectFirst();
    scriptNative(new Error("DSM refused API sign-in for this account."), {
      status: "connected",
      sessionId: "receipt-normal",
      message: "",
    });
    await act(() =>
      result.current.reconnect({ sessionProfile: "dsm_desktop" }),
    );
    expect(result.current.connectionStatus).toBe("error");
    await act(() => result.current.connect());
    expect(connectCalls()[0]).toMatchObject({ sessionProfile: "dsm_desktop" });
    expect(connectCalls()[1]).not.toHaveProperty("sessionProfile");
  });

  it("refuses an unknown profile and ignores reconnect while a code prompt is open", async () => {
    const { result } = await connectFirst();
    await act(() =>
      result.current.reconnect({
        sessionProfile: "admin" as unknown as "dsm_desktop",
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBe("receipt-old");
    scriptNative({ status: "otp_required" });
    await act(() => result.current.reconnect());
    expect(result.current.challenge?.status).toBe("otp_required");
    vi.mocked(invoke).mockClear();
    await act(() =>
      result.current.reconnect({ sessionProfile: "dsm_desktop" }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks a standalone form for the password again and applies the requested profile to that one sign-in", async () => {
    scriptNative({ status: "connected", sessionId: "receipt-a", message: "" });
    const { result } = setup();
    await act(() => result.current.connect());
    expect(result.current.password).toBe("");
    vi.mocked(invoke).mockClear();
    await act(() =>
      result.current.reconnect({ sessionProfile: "dsm_desktop" }),
    );
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: result.current.instanceId,
      expectedSessionId: "receipt-a",
    });
    expect(connectCalls()).toHaveLength(0);
    expect(result.current.connectionStatus).toBe("error");
    expect(result.current.connectionError).toContain("to reconnect");
    scriptNative(
      { status: "connected", sessionId: "receipt-b", message: "" },
      { status: "connected", sessionId: "receipt-c", message: "" },
    );
    act(() => result.current.setPassword("private-password"));
    await act(() => result.current.connect());
    expect(connectCalls()[0]).toMatchObject({
      password: "private-password",
      sessionProfile: "dsm_desktop",
    });
    await act(() => result.current.reconnect());
    expect(connectCalls()).toHaveLength(1);
    expect(result.current.connectionError).not.toContain("password=");
  });

  it("never exposes the password, code or trusted-device id in status, challenge or logs", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    try {
      const vault = vaultOptions();
      const { result } = await connectFirst(vault);
      const secrets = [
        "fixture-password-9f3",
        "vault-password-7c1",
        "246810",
        "864200",
        "fixture-did-secret",
      ];
      scriptNative(
        {
          status: "otp_required",
          message: "password=vault-password-7c1 code 246810",
          deviceId: "fixture-did-secret",
        },
        {
          status: "otp_invalid",
          message: "rejected 246810 for vault-password-7c1",
        },
        new Error(
          "NAS said password vault-password-7c1 and code 864200 failed",
        ),
      );
      await act(() =>
        result.current.reconnect({ sessionProfile: "dsm_desktop" }),
      );
      const snapshots = [
        JSON.stringify({
          status: result.current.connectionStatus,
          error: result.current.connectionError,
          challenge: result.current.challenge,
          health: result.current.sessionHealth,
          otp: result.current.otpCode,
          password: result.current.password,
        }),
      ];
      act(() => result.current.setOtpCode("864200"));
      await act(() => result.current.submitOtp());
      snapshots.push(
        JSON.stringify({
          status: result.current.connectionStatus,
          error: result.current.connectionError,
          challenge: result.current.challenge,
          health: result.current.sessionHealth,
          otp: result.current.otpCode,
          password: result.current.password,
        }),
      );
      expect(result.current.connectionStatus).toBe("error");
      expect(result.current.connectionError).toContain("[REDACTED]");
      const logged = JSON.stringify(logs.map((spy) => spy.mock.calls));
      for (const secret of secrets) {
        for (const snapshot of snapshots)
          expect(snapshot).not.toContain(secret);
        expect(logged).not.toContain(secret);
      }
    } finally {
      for (const spy of logs) spy.mockRestore();
    }
  });
});
describe("trusted-device payload compatibility", () => {
  it("keeps the pre-trust sign-in payload and ignores a returned device without vault storage", async () => {
    let connects = 0;
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_connect"
        ? ++connects === 1
          ? { status: "otp_required", trustedDeviceRejected: true }
          : {
              status: "connected",
              sessionId: "receipt",
              trustedDevice: {
                deviceName: "SortOfRemoteNG · DESKTOP",
                deviceId: "fixture-did-secret",
              },
            }
        : {
            status: "connected",
            lastVerifiedAt: "",
            consecutiveFailures: 0,
            message: null,
          },
    );
    const { result } = setup();
    await act(() => result.current.connect());
    expect(result.current.deviceTrust.notice).toBeNull();
    act(() => {
      result.current.deviceTrust.setEnabled(true);
      result.current.setOtpCode("123456");
    });
    await act(() => result.current.submitOtp());
    expect(result.current.connectionStatus).toBe("connected");
    const legacyKeys = [
      "host",
      "instanceId",
      "otpCode",
      "password",
      "port",
      "requestId",
      "route",
      "useHttps",
      "username",
    ];
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "syn_fs_connect")
        .map(([, args]) => Object.keys(args as object).sort()),
    ).toEqual([legacyKeys, legacyKeys]);
    expect(result.current.deviceTrust).toEqual(
      expect.objectContaining({
        available: false,
        unavailableReason: null,
        enabled: false,
        remembered: false,
        notice: null,
      }),
    );
    expect(JSON.stringify(result.current)).not.toContain("fixture-did-secret");
  });
});
