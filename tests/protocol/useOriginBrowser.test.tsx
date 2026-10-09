import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  useOriginBrowser,
  tauriOriginBrowserTransport,
  type UseOriginBrowserOptions,
} from "../../src/hooks/protocol/useOriginBrowser";
import type {
  OriginBrowserCreateResult,
  OriginBrowserIdentity,
  OriginBrowserSnapshot,
  OriginBrowserTransport,
} from "../../src/types/protocols/originBrowser";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const owner = {
  ownerDatabaseId: "database-1",
  connectionId: "connection-1",
  sessionId: "tab-1",
};
const identity = { ...owner, attemptId: "native-attempt-1" };
const bounds = { x: 20, y: 80, width: 800, height: 600 };
function snapshot(
  overrides: Partial<OriginBrowserSnapshot> = {},
): OriginBrowserSnapshot {
  return {
    identity,
    sequence: 0,
    phase: "attached",
    displayUrl: "https://fixture.invalid/login",
    title: "Fixture",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...overrides,
  };
}

function fixture() {
  const listeners: Array<(event: OriginBrowserSnapshot) => void> = [];
  const unsubscribe = vi.fn();
  let serial = 0;
  const transport = {
    create: vi.fn<OriginBrowserTransport["create"]>(async (request) => ({
      requestId: request.requestId,
      snapshot: snapshot({
        identity: { ...request.owner, attemptId: `native-attempt-${++serial}` },
      }),
    })),
    navigate: vi
      .fn<OriginBrowserTransport["navigate"]>()
      .mockResolvedValue(undefined),
    control: vi
      .fn<OriginBrowserTransport["control"]>()
      .mockResolvedValue(undefined),
    close: vi
      .fn<OriginBrowserTransport["close"]>()
      .mockResolvedValue(undefined),
    status: vi.fn<OriginBrowserTransport["status"]>(async (request) => ({
      capability: { availability: "available" },
      snapshot: request.identity
        ? snapshot({ identity: request.identity })
        : null,
    })),
    listen: vi.fn<OriginBrowserTransport["listen"]>(async (listener) => {
      listeners.push(listener);
      return unsubscribe;
    }),
  };
  const options: UseOriginBrowserOptions = {
    owner,
    expectedSecurityRevision: "revision-7",
    sourceSessionId: "unlock-1",
    initialUrl: "https://fixture.invalid/login",
    enabled: true,
    ownerAvailable: true,
    active: true,
    dialogOpen: false,
    consent: { kind: "required" },
    transport,
  };
  const emit = (event: OriginBrowserSnapshot) =>
    act(() => listeners.forEach((listener) => listener(event)));
  return { transport, options, emit, listeners, unsubscribe };
}

async function mounted(overrides: Partial<UseOriginBrowserOptions> = {}) {
  const f = fixture();
  const props = { ...f.options, ...overrides };
  const hook = renderHook((options) => useOriginBrowser(options), {
    initialProps: props,
  });
  act(() => hook.result.current.setViewport(bounds));
  await waitFor(() => expect(hook.result.current.state.phase).toBe("attached"));
  return { ...f, ...hook, props };
}

describe("origin browser attempt controller", () => {
  it("keeps retryable deferred startup while explaining a recorded UI dispatch failure", async () => {
    const f = fixture();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "deferred" },
        snapshot: null,
      })
      .mockResolvedValueOnce({
        capability: { availability: "deferred" },
        snapshot: null,
        runtimeFailure: { code: "ui-dispatch", stage: "preparing" },
      });
    f.transport.create.mockRejectedValue(
      "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
    );
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("error"));
    expect(hook.result.current.state.runtimeFailure).toEqual({
      code: "ui-dispatch",
      stage: "preparing",
    });
    expect(hook.result.current.state.error).toContain("UI thread");
    expect(hook.result.current.state.error).not.toContain("runtime package");
    expect(hook.result.current.state.unavailableReason).toBeNull();
  });
  it("recovers the recorded engine cause when deferred initialization fails inside create", async () => {
    const f = fixture();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "deferred" },
        snapshot: null,
      })
      .mockResolvedValueOnce({
        capability: {
          availability: "unavailable",
          reason: "policy-unavailable",
        },
        snapshot: null,
        runtimeFailure: {
          code: "ui-dispatch",
          stage: "initializing",
          extra: "SECRET",
        } as never,
      });
    f.transport.create.mockRejectedValue(
      "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
    );
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() =>
      expect(hook.result.current.state.phase).toBe("unavailable"),
    );
    expect(hook.result.current.state.runtimeFailure).toEqual({
      code: "ui-dispatch",
      stage: "initializing",
    });
    expect(hook.result.current.state.startupFailure).toBeNull();
    expect(f.transport.status).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(hook.result.current.state)).not.toContain("SECRET");
    expect(f.transport.control).not.toHaveBeenCalled();
  });

  it("keeps the original runtime error when the follow-up diagnostic status fails", async () => {
    const f = fixture();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "deferred" },
        snapshot: null,
      })
      .mockRejectedValueOnce(new Error("SECRET"));
    f.transport.create.mockRejectedValue(
      "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
    );
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("error"));
    expect(hook.result.current.state.startupFailure?.code).toBe(
      "runtime-package",
    );
    expect(hook.result.current.state.runtimeFailure).toBeNull();
    expect(JSON.stringify(hook.result.current.state)).not.toContain("SECRET");
  });

  it("drops a late engine status after the owning database becomes unavailable", async () => {
    const f = fixture();
    const pending =
      deferred<Awaited<ReturnType<OriginBrowserTransport["status"]>>>();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "deferred" },
        snapshot: null,
      })
      .mockImplementationOnce(() => pending.promise);
    f.transport.create.mockRejectedValue(
      "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
    );
    const hook = renderHook((options) => useOriginBrowser(options), {
      initialProps: f.options,
    });
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledTimes(2));
    hook.rerender({ ...f.options, ownerAvailable: false });
    await act(async () =>
      pending.resolve({
        capability: {
          availability: "unavailable",
          reason: "policy-unavailable",
        },
        snapshot: null,
        runtimeFailure: { code: "ui-dispatch", stage: "initializing" },
      }),
    );
    expect(hook.result.current.state.runtimeFailure).toBeNull();
    expect(hook.result.current.state.unavailableReason).not.toBe(
      "policy-unavailable",
    );
    expect(f.transport.control).not.toHaveBeenCalled();
  });

  it.each([
    "data-directory",
    "runtime-package",
    "startup-provider",
    "certificate-bridge",
    "runtime-policy",
    "startup-timeout",
    "ui-dispatch",
    "runtime-initialization",
  ] as const)(
    "preserves engine failure %s without starting a host and clears it on explicit retry",
    async (code) => {
      const f = fixture();
      f.transport.status.mockResolvedValueOnce({
        capability: {
          availability: "unavailable",
          reason: "policy-unavailable",
        },
        snapshot: null,
        runtimeFailure: {
          code,
          stage: "preparing",
          message: "SECRET",
        } as never,
      });
      const hook = renderHook(() => useOriginBrowser(f.options));
      await waitFor(() =>
        expect(hook.result.current.state.phase).toBe("unavailable"),
      );
      expect(hook.result.current.state.runtimeFailure).toEqual({
        code,
        stage: "preparing",
      });
      expect(JSON.stringify(hook.result.current.state)).not.toContain("SECRET");
      expect(f.transport.create).not.toHaveBeenCalled();
      act(() => hook.result.current.reconnect());
      await waitFor(() =>
        expect(hook.result.current.state.phase).toBe("attached"),
      );
      expect(hook.result.current.state.runtimeFailure).toBeNull();
      expect(f.transport.create).toHaveBeenCalledOnce();
    },
  );

  it("omits unknown engine failure fields and keeps the known availability reason", async () => {
    const f = fixture();
    f.transport.status.mockResolvedValueOnce({
      capability: { availability: "unavailable", reason: "host-unavailable" },
      snapshot: null,
      runtimeFailure: { code: "SECRET", stage: "preparing" } as never,
    });
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() =>
      expect(hook.result.current.state.phase).toBe("unavailable"),
    );
    expect(hook.result.current.state.runtimeFailure).toBeNull();
    expect(hook.result.current.state.unavailableReason).toBe(
      "host-unavailable",
    );
    expect(JSON.stringify(hook.result.current.state)).not.toContain("SECRET");
    expect(f.transport.create).not.toHaveBeenCalled();
  });

  it("keeps connection status connected during native page/subresource loading", async () => {
    const f = await mounted();
    expect(f.result.current.connectionStatus).toBe("connected");
    for (const [index, loading] of [true, false, true].entries()) {
      f.emit(
        snapshot({ sequence: index + 1, loading, title: "Readable page" }),
      );
      expect(f.result.current.connectionStatus).toBe("connected");
      expect(f.result.current.state.snapshot?.loading).toBe(loading);
    }
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("keeps connection status connecting until native attachment is verified", async () => {
    const f = fixture();
    const resync =
      deferred<Awaited<ReturnType<OriginBrowserTransport["status"]>>>();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "available" },
        snapshot: null,
      })
      .mockReturnValueOnce(resync.promise);
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledTimes(2));
    f.emit(snapshot({ sequence: 1, loading: true }));
    expect(hook.result.current.connectionStatus).toBe("connecting");
    await act(async () =>
      resync.resolve({
        capability: { availability: "available" },
        snapshot: snapshot({ sequence: 1, loading: true }),
      }),
    );
    expect(hook.result.current.connectionStatus).toBe("connected");
  });

  it("reports real document and renderer failures as error connection status", async () => {
    const f = await mounted();
    f.emit(
      snapshot({
        sequence: 1,
        loading: true,
        loadFailure: { code: -105, category: "dns" },
      }),
    );
    expect(f.result.current.connectionStatus).toBe("error");
    expect(f.result.current.state.error).toContain("DNS");
    f.emit(snapshot({ sequence: 2, loading: true }));
    expect(f.result.current.connectionStatus).toBe("connected");
    f.emit(
      snapshot({ sequence: 3, phase: "failed", failureReason: "renderer" }),
    );
    expect(f.result.current.connectionStatus).toBe("error");
    f.emit(snapshot({ sequence: 4 }));
    expect(f.result.current.connectionStatus).toBe("error");
  });

  it("reports unavailable and closed connection status without claiming attachment", async () => {
    const f = fixture();
    f.transport.status.mockResolvedValue({
      capability: { availability: "unavailable", reason: "runtime-missing" },
      snapshot: null,
    });
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() =>
      expect(hook.result.current.state.phase).toBe("unavailable"),
    );
    expect(hook.result.current.connectionStatus).toBe("error");
    const attached = await mounted();
    await act(async () => attached.result.current.close());
    expect(attached.result.current.connectionStatus).toBe("disconnected");
  });

  it("keeps rendering around shell overlays without allowing focus through them", async () => {
    const f = await mounted({ preserveRenderingUnderOverlays: true });
    f.transport.control.mockClear();
    const occlusions = [{ x: 700, y: 85, width: 110, height: 240 }];
    f.rerender({ ...f.props, dialogOpen: true, occlusions });
    await waitFor(() =>
      expect(f.transport.control).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({
            kind: "presentation",
            bounds,
            visible: true,
            inputBlocked: true,
            occlusions,
          }),
        }),
      ),
    );
    expect(await f.result.current.focus()).toBe(false);
    expect(f.transport.close).not.toHaveBeenCalled();
    f.rerender({ ...f.props, dialogOpen: false, occlusions: [] });
    await waitFor(() =>
      expect(f.transport.control).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({
            kind: "presentation",
            visible: true,
            inputBlocked: false,
            occlusions: [],
          }),
        }),
      ),
    );
    f.rerender({ ...f.props, active: false, dialogOpen: true, occlusions });
    await waitFor(() =>
      expect(f.transport.control).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ visible: false }),
        }),
      ),
    );
  });
  it("sends volatile Quick Connect data only on create, never status or controls", async () => {
    const quickConnect = {
      protocol: "https" as const,
      hostname: "fixture.invalid",
      port: 443,
      httpVerifySsl: true,
      basicAuthUsername: "test-user",
      basicAuthPassword: "test-only-secret",
    };
    const f = await mounted({
      owner: { ...owner, ownerDatabaseId: "quick-connect:tab-1" },
      expectedSecurityRevision: "quick-connect",
      sourceSessionId: "tab-1",
      quickConnect,
    });
    expect(f.transport.create.mock.calls[0][0].quickConnect).toEqual(
      quickConnect,
    );
    for (const calls of [
      f.transport.status.mock.calls,
      f.transport.control.mock.calls,
    ]) {
      expect(JSON.stringify(calls)).not.toContain("test-only-secret");
    }
    f.unmount();
    await waitFor(() => expect(f.transport.close).toHaveBeenCalled());
    expect(JSON.stringify(f.transport.close.mock.calls)).not.toContain(
      "test-only-secret",
    );
  });
  it("permits deferred startup but stays hidden until available post-create status", async () => {
    const f = fixture();
    const verified =
      deferred<Awaited<ReturnType<OriginBrowserTransport["status"]>>>();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "deferred" },
        snapshot: null,
      })
      .mockImplementationOnce(() => verified.promise);
    const assertOwner = vi.fn();
    const { result } = renderHook(() =>
      useOriginBrowser({ ...f.options, assertOwner }),
    );
    act(() => result.current.setViewport(bounds));
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledTimes(2));
    expect(assertOwner).toHaveBeenCalledOnce();
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(result.current.state.phase).toBe("starting");
    f.emit(snapshot({ sequence: 1 }));
    expect(f.transport.control).not.toHaveBeenCalled();
    await act(async () =>
      verified.resolve({
        capability: { availability: "available" },
        snapshot: snapshot({ sequence: 2 }),
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe("attached"));
    expect(f.transport.control).toHaveBeenCalled();
  });

  it("rejects deferred after create and closes without presenting the view", async () => {
    const f = fixture();
    f.transport.status.mockResolvedValue({
      capability: { availability: "deferred" },
      snapshot: null,
    });
    const { result } = renderHook(() => useOriginBrowser(f.options));
    act(() => result.current.setViewport(bounds));
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.startupFailure?.stage).toBe("resync");
    expect(f.transport.close).toHaveBeenCalledOnce();
    expect(f.transport.control).not.toHaveBeenCalled();
  });

  it("does not create from deferred status when the captured owner was revoked", async () => {
    const f = fixture();
    f.transport.status.mockResolvedValue({
      capability: { availability: "deferred" },
      snapshot: null,
    });
    const { result } = renderHook(() =>
      useOriginBrowser({
        ...f.options,
        assertOwner: () => {
          throw new Error("revoked");
        },
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.startupFailure?.stage).toBe("owner-check");
    expect(f.transport.create).not.toHaveBeenCalled();
  });

  it.each([
    "Native browser working-data preparation failed. Review Settings > Web Browser and restart if the working folder changed; the owning database and retained cookies were not changed.",
    "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
    "Native browser initialization or policy readiness timed out. Check the native startup diagnostics and restart the app.",
    "Native browser initialization or policy readiness failed. Check the native startup diagnostics and restart the app.",
  ])(
    "classifies whitelisted startup errors separately from saved login configuration: %s",
    async (message) => {
      const f = fixture();
      f.transport.status.mockResolvedValueOnce({
        capability: { availability: "deferred" },
        snapshot: null,
      });
      f.transport.create.mockRejectedValue(message);
      const { result } = renderHook(() => useOriginBrowser(f.options));
      await waitFor(() => expect(result.current.state.phase).toBe("error"));
      expect(result.current.state.startupFailure).toEqual({
        stage: "create",
        category: "runtime",
        code: expect.any(String),
      });
      expect(result.current.state.error).toContain(message);
      expect(result.current.state.error).not.toContain("login, credentials");
    },
  );

  it("does not echo a page URL appended to a native runtime error", async () => {
    const f = fixture();
    f.transport.create.mockRejectedValue(
      "Native browser initialization or policy readiness failed. Check the native startup diagnostics and restart the app. https://private.invalid/?secret=token",
    );
    const { result } = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.error).not.toContain("private.invalid");
    expect(result.current.state.startupFailure?.category).toBe("ipc");
  });

  it.each(["listen", "status", "resync"] as const)(
    "does not infer certificate policy or CEF availability from certificate text during %s",
    async (stage) => {
      const f = fixture();
      const message =
        "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported";
      if (stage === "listen") f.transport.listen.mockRejectedValue(message);
      if (stage === "status") f.transport.status.mockRejectedValue(message);
      if (stage === "resync")
        f.transport.status
          .mockResolvedValueOnce({
            capability: { availability: "available" },
            snapshot: null,
          })
          .mockRejectedValueOnce(message);
      const { result } = renderHook(() => useOriginBrowser(f.options));
      await waitFor(() => expect(result.current.state.phase).toBe("error"));
      expect(result.current.state.startupFailure).toEqual({
        stage,
        category: "ipc",
      });
      expect(result.current.state.error).toContain(`(${stage})`);
      expect(result.current.state.error).not.toMatch(
        /certificate|CEF runtime was available/,
      );
      expect(result.current.state.unavailableReason).toBeNull();
    },
  );
  it.each([
    [
      "This saved automatic-login configuration is not supported by the real-origin browser yet. Choose manual login explicitly in this connection's settings to open it without automatic credential entry.",
      "automatic-login configuration is not supported",
      "connection",
    ],
    [
      "Website login was not authorized. No saved credentials were sent. Reopen the website to review consent, or select manual login in its connection settings.",
      "No saved credentials were sent",
      "connection",
    ],
    [
      "Saved website credentials are unavailable. Unlock the owning database and review this connection's credential source before retrying.",
      "credential source",
      "connection",
    ],
    [
      "Automatic website login needs complete saved credentials. Edit this connection's website login credentials or linked database-vault entry, or explicitly choose manual login, then reopen the tab.",
      "Edit this connection's website login credentials",
      "connection",
    ],
    [
      "Saved website credentials are unavailable or invalid in the owning database; review its credential reference",
      "credential reference",
      "connection",
    ],
    [
      "Browser saved database owner is unavailable or changed",
      "owning database is unavailable or changed",
      "connection",
    ],
    [
      "Browser initial URL does not match its saved source",
      "no longer matches the saved connection",
      "connection",
    ],
    [
      "Saved browser network route is invalid or unsupported; no direct fallback",
      "no direct fallback was used",
      "connection",
    ],
    [
      "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported",
      "No trust-policy change or fallback was applied",
      "certificate-policy",
    ],
    [
      "The loaded CEF runtime does not provide the required app certificate-verifier bridge. Install or rebuild the patched browser runtime; the saved trust policy was not changed.",
      "Install or rebuild the patched browser runtime",
      "certificate-bridge",
    ],
  ])(
    "classifies a known create failure without declaring CEF unavailable (%#)",
    async (nativeMessage, guidance, category) => {
      const f = fixture();
      f.transport.create.mockRejectedValue(nativeMessage);
      const { result } = renderHook(() => useOriginBrowser(f.options));
      await waitFor(() => expect(result.current.state.phase).toBe("error"));
      expect(result.current.state.unavailableReason).toBeNull();
      expect(result.current.state.error).toContain(guidance);
      expect(result.current.state.startupFailure).toEqual({
        stage: "create",
        category,
        code: expect.any(String),
      });
      expect(f.unsubscribe).toHaveBeenCalledOnce();
      expect(f.transport.close).not.toHaveBeenCalled();
      expect(f.transport.navigate).not.toHaveBeenCalled();
      expect(f.transport.create).toHaveBeenCalledTimes(1);
      expect(f.transport.create.mock.calls[0][0].policy).toEqual({
        darkMode: "forced",
        autoLogin: { enabled: true, consent: { kind: "required" } },
      });
    },
  );
  it("preserves the safe MFA repair discriminator from the exact native create failure", async () => {
    const message = readFileSync(
      "src-tauri/src/origin_browser_authority.rs",
      "utf8",
    ).match(/#\[error\("([^"\n]+)"\)\]\s*MfaOriginMismatch,/)?.[1];
    expect(message).toBeTruthy();
    const f = fixture();
    f.transport.create.mockRejectedValue(message);
    const { result } = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.startupFailure).toEqual({
      stage: "create",
      category: "connection",
      reason: "mfa-origin-mismatch",
      code: "mfa-origin-mismatch",
    });
    expect(result.current.state.startupFailure).not.toHaveProperty("message");
    expect(result.current.state.error).toContain("re-enable automatic codes");
    expect(result.current.state.error).toContain("save the connection");
  });

  it.each(["listen", "status", "create", "resync"] as const)(
    "redacts unknown errors and identifies the %s IPC stage",
    async (stage) => {
      const f = fixture();
      const secret = new Error(
        "https://user:password@fixture.invalid/?token=secret#private sourceSessionId=unlock-secret",
      );
      if (stage === "listen") f.transport.listen.mockRejectedValue(secret);
      if (stage === "status") f.transport.status.mockRejectedValue(secret);
      if (stage === "create") f.transport.create.mockRejectedValue(secret);
      if (stage === "resync")
        f.transport.status
          .mockResolvedValueOnce({
            capability: { availability: "available" },
            snapshot: null,
          })
          .mockRejectedValueOnce(secret);
      const { result } = renderHook(() => useOriginBrowser(f.options));
      await waitFor(() => expect(result.current.state.phase).toBe("error"));
      expect(result.current.state.startupFailure).toEqual({
        stage,
        category: "ipc",
      });
      expect(result.current.state.error).toContain(`(${stage})`);
      expect(result.current.state.unavailableReason).toBeNull();
      expect(JSON.stringify(result.current.state)).not.toMatch(
        /password|token=|fixture\.invalid|unlock-secret|private/,
      );
      if (stage === "resync")
        expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({ identity });
      if (stage !== "listen") expect(f.unsubscribe).toHaveBeenCalledOnce();
    },
  );
  it.each([
    "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported https://secret.invalid/?token=private",
    {
      message:
        "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported",
      token: "private",
    },
    null,
  ])(
    "does not classify partial matches or arbitrary objects as trusted native errors (%#)",
    async (error) => {
      const f = fixture();
      f.transport.create.mockRejectedValue(error);
      const { result } = renderHook(() => useOriginBrowser(f.options));
      await waitFor(() => expect(result.current.state.phase).toBe("error"));
      expect(result.current.state.startupFailure).toEqual({
        stage: "create",
        category: "ipc",
      });
      expect(JSON.stringify(result.current.state)).not.toMatch(
        /secret\.invalid|token=|private/,
      );
    },
  );
  it("recognizes the exact certificate error wrapped in Error without exposing stack or cause", async () => {
    const f = fixture();
    const failure = new Error(
      "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported",
    );
    failure.stack = "SECRET STACK";
    f.transport.create.mockRejectedValue(failure);
    const { result } = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() =>
      expect(result.current.state.startupFailure?.category).toBe(
        "certificate-policy",
      ),
    );
    expect(result.current.state.phase).toBe("error");
    expect(JSON.stringify(result.current.state)).not.toContain("SECRET");
  });
  it("reports owner validation separately and never sends create after the lease fails", async () => {
    const f = fixture();
    const { result } = renderHook(() =>
      useOriginBrowser({
        ...f.options,
        assertOwner: () => {
          throw new Error("secret-owner");
        },
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.startupFailure).toEqual({
      stage: "owner-check",
      category: "connection",
    });
    expect(f.transport.create).not.toHaveBeenCalled();
    expect(JSON.stringify(result.current.state)).not.toContain("secret-owner");
  });
  it("ignores a delayed startup rejection from a retired attempt", async () => {
    const f = fixture();
    const pending = deferred<OriginBrowserCreateResult>();
    f.transport.create.mockReturnValueOnce(pending.promise);
    const hook = renderHook((options) => useOriginBrowser(options), {
      initialProps: f.options,
    });
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledOnce());
    hook.rerender({ ...f.options, ownerAvailable: false });
    await act(async () =>
      pending.reject(
        "Saved HTTPS trust policy requires a native certificate adapter; only explicit strict verification is supported",
      ),
    );
    expect(hook.result.current.state.phase).toBe("unavailable");
    expect(hook.result.current.state.unavailableReason).toBe(
      "owner-unavailable",
    );
    expect(hook.result.current.state.startupFailure).toBeNull();
    hook.rerender(f.options);
    await waitFor(() =>
      expect(hook.result.current.state.phase).toBe("attached"),
    );
    expect(hook.result.current.state.startupFailure).toBeNull();
  });
  it("still waits for confirmed cleanup after a resync failure before reconnecting", async () => {
    const f = fixture();
    const close = deferred<void>();
    f.transport.close.mockReturnValueOnce(close.promise);
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "available" },
        snapshot: null,
      })
      .mockRejectedValueOnce("sensitive resync");
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("error"));
    act(() => hook.result.current.reconnect());
    await act(async () => {});
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    await act(async () => close.resolve());
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(hook.result.current.state.phase).toBe("attached"),
    );
    expect(hook.result.current.state.startupFailure).toBeNull();
  });
  it("creates hidden with native owner evidence and active policies, without spreading secrets or handles", async () => {
    const f = fixture();
    const polluted = {
      ...f.options,
      owner: { ...owner, password: "never-copy" },
      nativeParent: 42,
      proxyPassword: "never-copy",
      rawJs: "never-copy",
      consent: {
        kind: "existing-grant",
        grantId: "grant-1",
        password: "never-copy",
      },
    } as UseOriginBrowserOptions;
    const hook = renderHook(() => useOriginBrowser(polluted));
    await waitFor(() =>
      expect(hook.result.current.state.phase).toBe("attached"),
    );
    expect(f.transport.create).toHaveBeenCalledWith({
      owner,
      expectedSecurityRevision: "revision-7",
      sourceSessionId: "unlock-1",
      requestId: expect.any(String),
      initialUrl: "https://fixture.invalid/login",
      visible: false,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      policy: {
        darkMode: "forced",
        autoLogin: {
          enabled: true,
          consent: { kind: "existing-grant", grantId: "grant-1" },
        },
      },
    });
    const request = f.transport.create.mock.calls[0][0];
    expect(request.requestId).not.toBe(identity.attemptId);
    expect(JSON.stringify(f.transport.create.mock.calls)).not.toContain(
      "never-copy",
    );
    expect(f.transport.control).toHaveBeenCalledWith({
      identity,
      action: {
        kind: "presentation",
        revision: 1,
        bounds: null,
        visible: false,
      },
    });
    expect(
      f.transport.control.mock.calls.some(([r]) => r.action.kind === "focus"),
    ).toBe(false);
  });

  it.each([
    "runtime-missing",
    "platform-unsupported",
    "containment-unverified",
    "policy-unavailable",
    "host-unavailable",
    "owner-unavailable",
  ] as const)(
    "keeps %s unavailable without creating a fallback",
    async (reason) => {
      const f = fixture();
      f.transport.status.mockResolvedValue({
        capability: { availability: "unavailable", reason },
        snapshot: null,
      });
      const { result } = renderHook(() => useOriginBrowser(f.options));
      await waitFor(() =>
        expect(result.current.state.unavailableReason).toBe(reason),
      );
      expect(f.transport.create).not.toHaveBeenCalled();
      expect(f.transport.navigate).not.toHaveBeenCalled();
      expect(f.unsubscribe).toHaveBeenCalledOnce();
    },
  );

  it("reports event subscription failure without claiming host unavailability or displaying native error details", async () => {
    const f = fixture();
    f.transport.listen.mockRejectedValue(new Error("secret-native-error"));
    const { result } = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.unavailableReason).toBeNull();
    expect(result.current.state.error).toContain("(listen)");
    expect(JSON.stringify(result.current.state)).not.toContain("secret");
    expect(f.transport.create).not.toHaveBeenCalled();
  });

  it.each([
    { expectedSecurityRevision: "" },
    { sourceSessionId: "" },
    { initialUrl: "javascript:alert(1)" },
    { initialUrl: "https://user:secret@fixture.invalid" },
  ])("rejects incomplete or unsafe create input %j", async (overrides) => {
    const f = fixture();
    const { result } = renderHook(() =>
      useOriginBrowser({ ...f.options, ...overrides }),
    );
    expect(result.current.state.phase).toBe("error");
    expect(f.transport.create).not.toHaveBeenCalled();
    expect(f.transport.status).not.toHaveBeenCalled();
    expect(
      result.current.state.configurationFailure?.issues.length,
    ).toBeGreaterThan(0);
    expect(result.current.state.error).not.toBe(
      "Browser configuration is invalid.",
    );
    expect(result.current.state.error).not.toContain("fixture.invalid");
    expect(result.current.state.error).not.toContain("secret");
  });

  it("reports every failed preflight field and clears the evidence after repair", async () => {
    const f = fixture();
    const { result, rerender } = renderHook(
      (options) => useOriginBrowser(options),
      {
        initialProps: {
          ...f.options,
          expectedSecurityRevision: "",
          sourceSessionId: "",
          initialUrl: "",
        },
      },
    );
    expect(result.current.state.configurationFailure?.issues).toEqual([
      "url-missing",
      "expectedSecurityRevision:missing",
      "sourceSessionId:missing",
    ]);
    expect(result.current.state.error).toContain(
      "security revision is missing",
    );
    expect(f.transport.listen).not.toHaveBeenCalled();
    rerender(f.options);
    await waitFor(() => expect(result.current.state.phase).toBe("attached"));
    expect(result.current.state.configurationFailure).toBeNull();
  });

  it("ignores other owners, tabs, attempts, duplicates and older status events", async () => {
    const f = await mounted();
    for (const field of [
      "ownerDatabaseId",
      "connectionId",
      "sessionId",
      "attemptId",
    ] as const) {
      f.emit(
        snapshot({
          identity: { ...identity, [field]: "foreign" },
          sequence: 80,
          title: "Foreign",
          currentUrl: "https://foreign.invalid/?token=foreign-secret",
        }),
      );
    }
    expect(f.result.current.state.snapshot?.title).toBe("Fixture");
    f.emit(
      snapshot({
        sequence: 5,
        title: "Current",
        displayUrl: "https://fixture.invalid/new?token=secret#secret",
        currentUrl:
          "https://fixture.invalid/new?token=address-only#address-fragment",
        loading: true,
      }),
    );
    f.emit(
      snapshot({
        sequence: 4,
        title: "Late",
        currentUrl: "https://late.invalid/?token=stale",
      }),
    );
    f.emit(
      snapshot({
        sequence: 5,
        title: "Duplicate",
        currentUrl: "https://duplicate.invalid/?token=stale",
      }),
    );
    expect(f.result.current.state.snapshot).toMatchObject({
      title: "Current",
      displayUrl: "https://fixture.invalid/new",
      currentUrl:
        "https://fixture.invalid/new?token=address-only#address-fragment",
      loading: true,
    });
    expect(JSON.stringify(f.result.current.state)).not.toContain("secret");
  });

  it.each([
    null,
    42,
    { url: "https://fixture.invalid" },
    "javascript:alert(1)",
    "data:text/html,secret",
    "file:///secret",
    "https://user:secret@fixture.invalid/",
    "https://user@fixture.invalid/",
    "https://fixture.invalid/\nsecret",
    "https://fixture.invalid/ path",
    "https://fixture.invalid\\secret",
    "not-a-url",
    `https://fixture.invalid/?token=${"x".repeat(16_384)}`,
    `https://fixture.invalid/?token=${"é".repeat(8_192)}`,
  ])(
    "rejects malformed or credential-bearing currentUrl (%#) without publishing it",
    async (currentUrl) => {
      const f = await mounted();
      f.emit(snapshot({ sequence: 6, currentUrl: currentUrl as string }));
      expect(f.result.current.state.phase).toBe("error");
      expect(f.result.current.state.snapshot).toBeNull();
      expect(f.result.current.state.error).toBe(
        "Native browser operation failed.",
      );
      expect(f.transport.close).toHaveBeenCalledWith({ identity });
      expect(f.transport.navigate).not.toHaveBeenCalled();
    },
  );

  it("copies only the full address field, never native extras or URL values into controls", async () => {
    const f = await mounted();
    const currentUrl =
      "https://fixture.invalid/path?token=address-only&next=%2Fhome#fragment-only";
    f.emit({
      ...snapshot({ sequence: 7, currentUrl }),
      cookies: "never-copy",
      diagnostics: { currentUrl },
    } as OriginBrowserSnapshot);
    expect(f.result.current.state.snapshot?.currentUrl).toBe(currentUrl);
    expect(f.result.current.state.snapshot?.displayUrl).toBe(
      "https://fixture.invalid/login",
    );
    expect(f.result.current.state.snapshot).not.toHaveProperty("cookies");
    expect(f.result.current.state.snapshot).not.toHaveProperty("diagnostics");
    await act(async () => {
      await f.result.current.reload();
    });
    expect(JSON.stringify(f.transport.control.mock.calls)).not.toContain(
      "address-only",
    );
    expect(JSON.stringify(f.transport.status.mock.calls)).not.toContain(
      "address-only",
    );
    expect(f.transport.navigate).not.toHaveBeenCalled();
  });

  it("closes the returned native attempt when an old create completes after replacement", async () => {
    const f = fixture();
    const oldCreate = deferred<OriginBrowserCreateResult>();
    f.transport.create.mockImplementationOnce(() => oldCreate.promise);
    const hook = renderHook((options) => useOriginBrowser(options), {
      initialProps: f.options,
    });
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledOnce());
    const oldRequest = f.transport.create.mock.calls[0][0];
    hook.rerender({ ...f.options, owner: { ...owner, sessionId: "tab-2" } });
    await waitFor(() =>
      expect(hook.result.current.state.snapshot?.identity.sessionId).toBe(
        "tab-2",
      ),
    );
    const successor = hook.result.current.state.snapshot;
    const lateIdentity = { ...identity, attemptId: "native-late" };
    await act(async () =>
      oldCreate.resolve({
        requestId: oldRequest.requestId,
        snapshot: snapshot({ identity: lateIdentity }),
      }),
    );
    expect(f.transport.close).toHaveBeenCalledWith({ identity: lateIdentity });
    expect(f.transport.close).not.toHaveBeenCalledWith({
      identity: successor!.identity,
    });
    f.emit(snapshot({ identity: lateIdentity, sequence: 99, title: "Stale" }));
    expect(hook.result.current.state.snapshot).toEqual(successor);
  });

  it("unmount during create closes exactly the native attempt returned later", async () => {
    const f = fixture();
    const pending = deferred<OriginBrowserCreateResult>();
    f.transport.create.mockImplementationOnce(() => pending.promise);
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledOnce());
    hook.unmount();
    const requestId = f.transport.create.mock.calls[0][0].requestId;
    await act(async () => pending.resolve({ requestId, snapshot: snapshot() }));
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({ identity });
    expect(f.transport.control).not.toHaveBeenCalled();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });

  it("disposes a late listener and never creates after cancellation during capability lookup", async () => {
    const f = fixture();
    const registration = deferred<() => void>();
    f.transport.listen.mockReturnValueOnce(registration.promise);
    const first = renderHook(() => useOriginBrowser(f.options));
    first.unmount();
    await act(async () => registration.resolve(f.unsubscribe));
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(f.transport.status).not.toHaveBeenCalled();
    const status =
      deferred<Awaited<ReturnType<OriginBrowserTransport["status"]>>>();
    f.transport.status.mockReturnValueOnce(status.promise);
    const second = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledOnce());
    second.unmount();
    await act(async () =>
      status.resolve({
        capability: { availability: "available" },
        snapshot: null,
      }),
    );
    expect(f.transport.create).not.toHaveBeenCalled();
  });

  it("hides for inactive tabs, dialogs and invalid bounds without granting focus", async () => {
    const f = await mounted();
    expect(f.transport.control).toHaveBeenLastCalledWith({
      identity,
      action: { kind: "presentation", revision: 1, bounds, visible: true },
    });
    f.rerender({ ...f.props, active: false });
    expect(f.transport.control).toHaveBeenLastCalledWith({
      identity,
      action: { kind: "presentation", revision: 2, bounds, visible: false },
    });
    expect(await f.result.current.focus()).toBe(false);
    f.rerender({ ...f.props, dialogOpen: true });
    expect(await f.result.current.focus()).toBe(false);
    f.rerender(f.props);
    await act(async () => {
      expect(await f.result.current.focus()).toBe(true);
    });
    expect(f.transport.control).toHaveBeenLastCalledWith({
      identity,
      action: { kind: "focus", presentationRevision: 3 },
    });
    act(() => f.result.current.setViewport({ ...bounds, width: 0 }));
    expect(f.transport.control).toHaveBeenLastCalledWith({
      identity,
      action: {
        kind: "presentation",
        revision: 4,
        bounds: null,
        visible: false,
      },
    });
    expect(await f.result.current.focus()).toBe(false);
  });

  it("does not show or focus before native attachment", async () => {
    const f = fixture();
    f.transport.create.mockImplementationOnce(async (request) => ({
      requestId: request.requestId,
      snapshot: snapshot({ phase: "starting" }),
    }));
    f.transport.status.mockResolvedValue({
      capability: { availability: "available" },
      snapshot: null,
    });
    const hook = renderHook(() => useOriginBrowser(f.options));
    act(() => hook.result.current.setViewport(bounds));
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledTimes(2));
    expect(f.transport.control).not.toHaveBeenCalled();
    expect(await hook.result.current.focus()).toBe(false);
    f.emit(snapshot({ sequence: 1 }));
    expect(hook.result.current.state.phase).toBe("attached");
    expect(f.transport.control).toHaveBeenLastCalledWith({
      identity,
      action: { kind: "presentation", revision: 1, bounds, visible: true },
    });
  });

  it("closes on owner loss and recreates on owner revision or unlock-session change", async () => {
    const f = await mounted();
    f.rerender({ ...f.props, ownerAvailable: false });
    expect(f.result.current.state.phase).toBe("unavailable");
    expect(f.transport.close).toHaveBeenCalledWith({ identity });
    expect(await f.result.current.focus()).toBe(false);
    f.rerender({
      ...f.props,
      expectedSecurityRevision: "revision-8",
      sourceSessionId: "unlock-2",
    });
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledTimes(2));
    expect(f.transport.create.mock.calls[1][0]).toMatchObject({
      expectedSecurityRevision: "revision-8",
      sourceSessionId: "unlock-2",
    });
    await waitFor(() =>
      expect(f.result.current.state.snapshot?.identity.attemptId).toBe(
        "native-attempt-2",
      ),
    );
    f.rerender({
      ...f.props,
      expectedSecurityRevision: "revision-9",
      sourceSessionId: "unlock-2",
    });
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledTimes(3));
    expect(f.transport.close).toHaveBeenCalledWith({
      identity: { ...owner, attemptId: "native-attempt-2" },
    });
  });

  it("Quick Connect address changes retire the old context and never forward its credentials", async () => {
    const quickConnect = {
      protocol: "https" as const,
      hostname: "fixture.invalid",
      port: 443,
      httpVerifySsl: false,
      basicAuthUsername: "local-user",
      basicAuthPassword: "private-value",
    };
    const f = await mounted({ quickConnect });
    const closing = deferred<void>();
    f.transport.close.mockReturnValueOnce(closing.promise);
    await act(async () => {
      expect(
        await f.result.current.navigate(
          "https://www.google.com/search?q=browser",
        ),
      ).toBe(true);
    });
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    expect(f.transport.close).toHaveBeenCalledWith({ identity });
    await act(async () => closing.resolve());
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledTimes(2));
    expect(f.transport.create.mock.calls[1][0]).toMatchObject({
      owner,
      initialUrl: "https://www.google.com/search?q=browser",
      quickConnect: {
        protocol: "https",
        hostname: "https://www.google.com/search?q=browser",
        port: 443,
        httpVerifySsl: true,
      },
    });
    expect(f.transport.create.mock.calls[1][0].quickConnect).not.toHaveProperty(
      "basicAuthUsername",
    );
    expect(f.transport.create.mock.calls[1][0].quickConnect).not.toHaveProperty(
      "basicAuthPassword",
    );
    await waitFor(() => expect(f.result.current.state.phase).toBe("attached"));
    await act(async () => {
      await f.result.current.navigate("https://www.google.com/other");
    });
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(f.transport.navigate).toHaveBeenLastCalledWith({
      identity: { ...owner, attemptId: "native-attempt-2" },
      url: "https://www.google.com/other",
    });
  });

  it("Quick Connect address changes do not replace a context whose cleanup failed", async () => {
    const f = await mounted({
      quickConnect: {
        protocol: "https",
        hostname: "fixture.invalid",
        port: 443,
        httpVerifySsl: true,
      },
    });
    f.transport.close.mockRejectedValueOnce("private-close-error");
    await act(async () => {
      await f.result.current.navigate("https://www.cloudflare.com/");
    });
    await waitFor(() =>
      expect(f.result.current.state.phase).toBe("unavailable"),
    );
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    expect(f.result.current.state.operationFailure).toBe("cleanup");
    expect(JSON.stringify(f.result.current.state)).not.toContain(
      "private-close-error",
    );
  });

  it("saved connections never use temporary address-change authority", async () => {
    const f = await mounted();
    await act(async () => {
      await f.result.current.navigate("https://www.google.com/");
    });
    expect(f.transport.navigate).toHaveBeenCalledWith({
      identity,
      url: "https://www.google.com/",
    });
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    expect(f.transport.create.mock.calls[0][0]).not.toHaveProperty(
      "quickConnect",
    );
  });

  it("rejects raw-script and credential URLs and binds navigation controls to the native identity", async () => {
    const f = await mounted();
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://user:secret@fixture.invalid",
    ])
      expect(await f.result.current.navigate(url)).toBe(false);
    expect(f.transport.navigate).not.toHaveBeenCalled();
    await act(async () => {
      expect(
        await f.result.current.navigate("https://fixture.invalid/next"),
      ).toBe(true);
      await f.result.current.back();
      await f.result.current.forward();
      await f.result.current.reload();
      await f.result.current.stop();
    });
    expect(f.transport.navigate).toHaveBeenCalledExactlyOnceWith({
      identity,
      url: "https://fixture.invalid/next",
    });
    for (const kind of ["back", "forward", "reload", "stop"])
      expect(f.transport.control).toHaveBeenCalledWith({
        identity,
        action: { kind },
      });
  });

  it("waits for pending creation and close acknowledgement before reporting closed", async () => {
    const f = fixture();
    const pending = deferred<OriginBrowserCreateResult>();
    const closing = deferred<void>();
    f.transport.create.mockReturnValueOnce(pending.promise);
    f.transport.close.mockReturnValueOnce(closing.promise);
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledOnce());
    let completion!: Promise<void>;
    act(() => {
      completion = hook.result.current.close();
    });
    expect(hook.result.current.state.phase).toBe("closing");
    await act(async () =>
      pending.resolve({
        requestId: f.transport.create.mock.calls[0][0].requestId,
        snapshot: snapshot(),
      }),
    );
    expect(hook.result.current.state.phase).toBe("closing");
    await act(async () => {
      closing.resolve();
      await completion;
    });
    expect(hook.result.current.state.phase).toBe("closed");
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({ identity });
  });

  it("reports cleanup failure without a false closed state or secret error", async () => {
    const f = await mounted();
    f.transport.close.mockRejectedValueOnce(
      new Error("native-password-secret"),
    );
    await act(async () => f.result.current.close());
    expect(f.result.current.state.phase).toBe("error");
    expect(f.result.current.state.error).toContain("cleanup");
    expect(JSON.stringify(f.result.current.state)).not.toContain("secret");
  });

  it("retires on current host failure and ignores subsequent callbacks", async () => {
    const f = await mounted();
    f.emit(snapshot({ sequence: 1, phase: "failed" }));
    expect(f.result.current.state.phase).toBe("error");
    expect(f.transport.close).toHaveBeenCalledWith({ identity });
    f.emit(snapshot({ sequence: 2 }));
    expect(f.result.current.state.phase).toBe("error");
  });

  it("keeps a failed document attached for explicit navigation without replaying a request", async () => {
    const f = await mounted();
    f.transport.control.mockClear();
    const loadFailure = { code: -21, category: "network-changed" as const };
    f.emit(snapshot({ sequence: 1, loadFailure, canGoBack: true }));
    expect(f.result.current.state.phase).toBe("error");
    expect(f.result.current.state.snapshot?.phase).toBe("attached");
    expect(f.result.current.state.error).toContain("network changed");
    expect(f.result.current.state.error).toContain("-21");
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.unsubscribe).not.toHaveBeenCalled();
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(f.transport.control).not.toHaveBeenCalled();
    // CEF loading-stopped and title/history events retain the native evidence.
    f.emit(snapshot({ sequence: 2, loadFailure, loading: false }));
    expect(f.result.current.state.phase).toBe("error");
    expect(await f.result.current.back()).toBe(true);
    expect(
      await f.result.current.navigate("https://fixture.invalid/next"),
    ).toBe(true);
    expect(f.transport.create).toHaveBeenCalledOnce();
    f.emit(snapshot({ sequence: 3, loading: true }));
    expect(f.result.current.state.phase).toBe("attached");
    expect(f.result.current.state.error).toBeNull();
    f.emit(
      snapshot({ sequence: 4, phase: "failed", failureReason: "renderer" }),
    );
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({ identity });
  });

  it("copies only fixed document-failure fields and ignores stale failures", async () => {
    const f = await mounted();
    f.emit({
      ...snapshot({ sequence: 2 }),
      loadFailure: {
        code: -202,
        category: "certificate",
        url: "https://SECRET",
        text: "SECRET",
      },
    } as OriginBrowserSnapshot);
    expect(f.result.current.state.snapshot?.loadFailure).toEqual({
      code: -202,
      category: "certificate",
    });
    expect(JSON.stringify(f.result.current.state)).not.toContain("SECRET");
    expect(f.result.current.state.error).toContain("saved trust policy");
    f.emit(snapshot({ sequence: 1 }));
    f.emit(
      snapshot({ sequence: 8, identity: { ...identity, attemptId: "old" } }),
    );
    expect(f.result.current.state.phase).toBe("error");
    f.emit(snapshot({ sequence: 3 }));
    expect(f.result.current.state.phase).toBe("attached");
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("preserves an early document failure across create/status resync without closing", async () => {
    const f = fixture();
    const pending =
      deferred<Awaited<ReturnType<OriginBrowserTransport["status"]>>>();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "available" },
        snapshot: null,
      })
      .mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledTimes(2));
    f.emit(
      snapshot({ sequence: 8, loadFailure: { code: -105, category: "dns" } }),
    );
    await act(async () =>
      pending.resolve({
        capability: { availability: "available" },
        snapshot: snapshot({ sequence: 2 }),
      }),
    );
    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.error).toContain("DNS");
    expect(result.current.state.snapshot?.loadFailure?.code).toBe(-105);
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it.each([
    [
      "renderer",
      "page renderer stopped or its native communication bridge failed",
    ],
    ["session", "private browser session was no longer available or valid"],
    ["callback", "internal native browser callback failed"],
    ["native-surface", "could not maintain the embedded browser view"],
    ["load", "page could not be loaded"],
  ] as const)(
    "delivers the native %s fault to the shell with recovery and retires once",
    async (failureReason, detail) => {
      const f = await mounted();
      f.emit(snapshot({ sequence: 1, phase: "failed", failureReason }));
      expect(f.result.current.state.phase).toBe("error");
      expect(f.result.current.state.snapshot?.failureReason).toBe(
        failureReason,
      );
      expect(f.result.current.state.startupFailure).toBeNull();
      const error = f.result.current.state.error;
      expect(error).toContain(detail);
      expect(error).toContain("Reopen");
      expect(error).not.toMatch(/GPU|fixture\.invalid|Fixture/);
      await waitFor(() =>
        expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({ identity }),
      );
      f.emit(snapshot({ sequence: 2 }));
      expect(f.result.current.state.error).toBe(error);
    },
  );

  it.each([
    undefined,
    null,
    "future-fault",
    "renderer SECRET",
    { message: "SECRET" },
  ])(
    "publishes a generic no-cause failure for an older or unknown fault (%#)",
    async (failureReason) => {
      const f = await mounted();
      f.emit({
        ...snapshot({ sequence: 1, phase: "failed" }),
        failureReason,
        error: "SECRET native exception",
        details: "SECRET stack",
      } as unknown as OriginBrowserSnapshot);
      expect(f.result.current.state.phase).toBe("error");
      expect(f.result.current.state.error).toContain(
        "No cause was provided by the native browser.",
      );
      expect(f.result.current.state.snapshot).not.toHaveProperty(
        "failureReason",
      );
      expect(JSON.stringify(f.result.current.state)).not.toMatch(
        /SECRET|future-fault/,
      );
    },
  );

  it("does not diagnose an attached snapshot from an out-of-phase failure reason", async () => {
    const f = await mounted();
    f.emit(snapshot({ sequence: 1, failureReason: "renderer" }));
    expect(f.result.current.state.phase).toBe("attached");
    expect(f.result.current.state.error).toBeNull();
    expect(f.result.current.state.snapshot).not.toHaveProperty("failureReason");
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("ignores stale and foreign native fault events", async () => {
    const f = await mounted();
    f.emit(
      snapshot({ sequence: 0, phase: "failed", failureReason: "renderer" }),
    );
    for (const patch of [
      { ownerDatabaseId: "other-db" },
      { connectionId: "other-connection" },
      { sessionId: "other-tab" },
      { attemptId: "old-attempt" },
    ]) {
      f.emit(
        snapshot({
          identity: { ...identity, ...patch },
          sequence: 90,
          phase: "failed",
          failureReason: "session",
        }),
      );
    }
    expect(f.result.current.state.phase).toBe("attached");
    expect(f.result.current.state.error).toBeNull();
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("preserves an early native fault reason through the post-create status resync", async () => {
    const f = fixture();
    const pending =
      deferred<Awaited<ReturnType<OriginBrowserTransport["status"]>>>();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "available" },
        snapshot: null,
      })
      .mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledTimes(2));
    f.emit(
      snapshot({ sequence: 8, phase: "failed", failureReason: "callback" }),
    );
    await act(async () =>
      pending.resolve({
        capability: { availability: "available" },
        snapshot: snapshot({ sequence: 2 }),
      }),
    );
    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.error).toContain(
      "internal native browser callback failed",
    );
    expect(result.current.state.snapshot?.failureReason).toBe("callback");
    expect(f.transport.control).not.toHaveBeenCalled();
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({ identity });
  });

  it("settles a native closing event only when cleanup has been acknowledged", async () => {
    const f = await mounted();
    const pending = deferred<void>();
    f.transport.close.mockReturnValueOnce(pending.promise);
    f.emit(snapshot({ sequence: 1, phase: "closing" }));
    expect(f.result.current.state.phase).toBe("closing");
    expect(
      await f.result.current.navigate("https://fixture.invalid/next"),
    ).toBe(false);
    await act(async () => pending.resolve());
    expect(f.result.current.state.phase).toBe("closed");
  });

  it("ignores failure of an older presentation after a newer hide", async () => {
    const f = await mounted();
    const pending = deferred<void>();
    f.transport.control.mockReturnValueOnce(pending.promise);
    act(() => f.result.current.setViewport({ ...bounds, width: 900 }));
    f.rerender({ ...f.props, active: false });
    await act(async () => pending.reject(new Error("old presentation")));
    expect(f.result.current.state.phase).toBe("attached");
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("ignores native rejection of focus that became stale when a dialog opened", async () => {
    const f = await mounted();
    const pending = deferred<void>();
    f.transport.control.mockReturnValueOnce(pending.promise);
    const focus = f.result.current.focus();
    f.rerender({ ...f.props, dialogOpen: true });
    await act(async () => {
      pending.reject(new Error("stale focus revision"));
      expect(await focus).toBe(false);
    });
    expect(f.result.current.state.phase).toBe("attached");
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("closes its own malformed create response but never another owner's attempt", async () => {
    const f = fixture();
    f.transport.create.mockResolvedValueOnce({
      requestId: "wrong-request",
      snapshot: snapshot(),
    });
    const first = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(first.result.current.state.phase).toBe("error"));
    expect(f.transport.close).toHaveBeenCalledWith({ identity });
    first.unmount();
    f.transport.close.mockClear();
    f.transport.create.mockImplementationOnce(async (request) => ({
      requestId: request.requestId,
      snapshot: snapshot({
        identity: { ...identity, ownerDatabaseId: "other-owner" },
      }),
    }));
    const second = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() =>
      expect(second.result.current.state.phase).toBe("error"),
    );
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("keeps a late-created browser hidden if a dialog opened during creation", async () => {
    const f = fixture();
    const pending = deferred<OriginBrowserCreateResult>();
    f.transport.create.mockReturnValueOnce(pending.promise);
    const hook = renderHook((options) => useOriginBrowser(options), {
      initialProps: f.options,
    });
    act(() => hook.result.current.setViewport(bounds));
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledOnce());
    hook.rerender({ ...f.options, dialogOpen: true });
    await act(async () =>
      pending.resolve({
        requestId: f.transport.create.mock.calls[0][0].requestId,
        snapshot: snapshot(),
      }),
    );
    expect(f.transport.control).toHaveBeenCalledExactlyOnceWith({
      identity,
      action: { kind: "presentation", revision: 1, bounds, visible: false },
    });
    expect(await hook.result.current.focus()).toBe(false);
  });

  it("does not let a delayed status reply overwrite a newer native event", async () => {
    const f = fixture();
    const pending =
      deferred<Awaited<ReturnType<OriginBrowserTransport["status"]>>>();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "available" },
        snapshot: null,
      })
      .mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() => expect(f.transport.status).toHaveBeenCalledTimes(2));
    expect(hook.result.current.state.phase).toBe("starting");
    f.emit(snapshot({ sequence: 8, title: "Newer event" }));
    await act(async () =>
      pending.resolve({
        capability: { availability: "available" },
        snapshot: snapshot({ sequence: 2, title: "Older reply" }),
      }),
    );
    expect(hook.result.current.state.snapshot?.title).toBe("Newer event");
  });

  it("retires the attempt when only the managed unlock session changes", async () => {
    const f = await mounted();
    f.rerender({ ...f.props, sourceSessionId: "replacement-proof" });
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledTimes(2));
    expect(f.transport.close).toHaveBeenCalledWith({ identity });
    expect(f.transport.create.mock.calls[1][0]).toMatchObject({
      expectedSecurityRevision: "revision-7",
      sourceSessionId: "replacement-proof",
    });
    expect(JSON.stringify(f.result.current.state)).not.toContain(
      "replacement-proof",
    );
  });

  it("closes after capability loss in post-create status without publishing a fallback", async () => {
    const f = fixture();
    f.transport.status
      .mockResolvedValueOnce({
        capability: { availability: "available" },
        snapshot: null,
      })
      .mockResolvedValueOnce({
        capability: {
          availability: "unavailable",
          reason: "containment-unverified",
        },
        snapshot: null,
        runtimeFailure: { code: "runtime-policy", stage: "policy-readback" },
      });
    const hook = renderHook(() => useOriginBrowser(f.options));
    await waitFor(() =>
      expect(hook.result.current.state.phase).toBe("unavailable"),
    );
    expect(f.transport.close).toHaveBeenCalledWith({ identity });
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(hook.result.current.state.runtimeFailure).toEqual({
      code: "runtime-policy",
      stage: "policy-readback",
    });
  });
});

describe("Tauri transport naming and envelope", () => {
  it("uses only the five proposed invoke commands and the typed event payload", async () => {
    ipc.invoke.mockResolvedValue(undefined);
    const request = {
      owner,
      expectedSecurityRevision: "revision-7",
      sourceSessionId: "unlock-1",
      requestId: "request-1",
      initialUrl: "https://fixture.invalid",
      bounds,
      visible: false as const,
      policy: {
        darkMode: "forced" as const,
        autoLogin: {
          enabled: true as const,
          consent: { kind: "required" as const },
        },
      },
    };
    await tauriOriginBrowserTransport.create(request);
    await tauriOriginBrowserTransport.navigate({
      identity,
      url: request.initialUrl,
    });
    await tauriOriginBrowserTransport.control({
      identity,
      action: { kind: "reload" },
    });
    await tauriOriginBrowserTransport.close({ identity });
    await tauriOriginBrowserTransport.status({ owner, identity });
    expect(ipc.invoke.mock.calls).toEqual([
      ["origin_browser_create", { request }],
      [
        "origin_browser_navigate",
        { request: { identity, url: request.initialUrl } },
      ],
      [
        "origin_browser_control",
        { request: { identity, action: { kind: "reload" } } },
      ],
      ["origin_browser_close", { request: { identity } }],
      ["origin_browser_status", { request: { owner, identity } }],
    ]);
    const listener = vi.fn();
    const unsubscribe = vi.fn();
    ipc.listen.mockResolvedValueOnce(unsubscribe);
    expect(await tauriOriginBrowserTransport.listen(listener)).toBe(
      unsubscribe,
    );
    expect(ipc.listen).toHaveBeenCalledWith(
      "origin-browser-state",
      expect.any(Function),
    );
    ipc.listen.mock.calls[0][1]({ payload: snapshot() });
    expect(listener).toHaveBeenCalledWith(snapshot());
  });
});
