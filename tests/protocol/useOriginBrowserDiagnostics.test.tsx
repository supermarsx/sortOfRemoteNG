import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  useOriginBrowserDiagnostics,
  type UseOriginBrowserDiagnosticsOptions,
} from "../../src/hooks/protocol/useOriginBrowserDiagnostics";

const response = {
  outcome: "response",
  elapsedMs: 42,
  httpStatus: 302,
  contentLength: 100,
};
let accessible = true;
function options(): UseOriginBrowserDiagnosticsOptions {
  return {
    identity: {
      ownerDatabaseId: "db",
      connectionId: "connection",
      sessionId: "tab",
      attemptId: "attempt",
    },
    origin: "https://site.example",
    enabled: true,
    scope: "failure-one",
    assertOwner: vi.fn(() => {
      if (!accessible) throw new Error("PRIVATE_OWNER_ERROR");
    }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  accessible = true;
  vi.mocked(invoke).mockReset().mockResolvedValue(response);
});
afterEach(cleanup);

describe("native anonymous diagnostic probe", () => {
  it("uses only the canonical origin and closed identity through native IPC on explicit action", async () => {
    const p = options();
    Object.assign(p.identity!, { password: "PRIVATE_PASSWORD" });
    const { result } = renderHook(() => useOriginBrowserDiagnostics(p));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.available).toBe(true);
    await act(async () => {
      await result.current.run();
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("origin_browser_diagnose", {
      request: {
        identity: {
          ownerDatabaseId: "db",
          connectionId: "connection",
          sessionId: "tab",
          attemptId: "attempt",
        },
        origin: "https://site.example",
      },
    });
    expect(p.assertOwner).toHaveBeenCalledTimes(2);
    expect(result.current.report).toEqual(response);
    expect(result.current.running).toBe(false);
  });

  it.each([
    "https://site.example/",
    "https://site.example/path",
    "https://site.example?secret=value",
    "https://site.example#fragment",
    "https://user:pass@site.example",
    "javascript:alert(1)",
    "invalid",
    "https://SITE.example",
  ])(
    "rejects noncanonical or secret-bearing origin %s without fallback",
    async (origin) => {
      const { result } = renderHook(() =>
        useOriginBrowserDiagnostics({ ...options(), origin }),
      );
      expect(result.current.available).toBe(false);
      await act(async () => {
        await result.current.run();
      });
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...options().identity!, attemptId: "" }])(
    "requires a complete live identity: %j",
    async (identity) => {
      const { result } = renderHook(() =>
        useOriginBrowserDiagnostics({ ...options(), identity }),
      );
      expect(result.current.available).toBe(false);
      await act(async () => {
        await result.current.run();
      });
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("checks owner access immediately before IPC and never echoes the rejected proof", async () => {
    const { result } = renderHook(() => useOriginBrowserDiagnostics(options()));
    accessible = false;
    await act(async () => {
      await result.current.run();
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.report).toBeNull();
    expect(result.current.error).toContain("Check database access");
    expect(JSON.stringify(result.current)).not.toContain("PRIVATE_OWNER_ERROR");
  });

  it("does not publish a response after the database locks without rerendering", async () => {
    const task = deferred<unknown>();
    vi.mocked(invoke).mockReturnValue(task.promise);
    const { result } = renderHook(() => useOriginBrowserDiagnostics(options()));
    let run!: Promise<void>;
    act(() => {
      run = result.current.run();
    });
    accessible = false;
    await act(async () => {
      task.resolve(response);
      await run;
    });
    expect(result.current.report).toBeNull();
    expect(result.current.running).toBe(false);
    expect(result.current.error).not.toContain("PRIVATE_OWNER_ERROR");
  });

  it.each(["attempt", "origin", "scope", "disabled", "unmount"])(
    "drops an obsolete report after %s changes",
    async (change) => {
      const task = deferred<unknown>();
      vi.mocked(invoke).mockReturnValue(task.promise);
      const p = options();
      const hook = renderHook((value) => useOriginBrowserDiagnostics(value), {
        initialProps: p,
      });
      let run!: Promise<void>;
      act(() => {
        run = hook.result.current.run();
      });
      expect(hook.result.current.running).toBe(true);
      if (change === "attempt")
        hook.rerender({
          ...p,
          identity: { ...p.identity!, attemptId: "new-attempt" },
        });
      if (change === "origin")
        hook.rerender({ ...p, origin: "https://other.example" });
      if (change === "scope") hook.rerender({ ...p, scope: "failure-two" });
      if (change === "disabled") hook.rerender({ ...p, enabled: false });
      if (change === "unmount") hook.unmount();
      await act(async () => {
        task.resolve(response);
        await run;
      });
      expect(hook.result.current.report).toBeNull();
      if (change !== "unmount") expect(hook.result.current.running).toBe(false);
    },
  );

  it("prevents duplicate requests and allows an explicit rerun", async () => {
    const task = deferred<unknown>();
    vi.mocked(invoke).mockReturnValue(task.promise);
    const { result } = renderHook(() => useOriginBrowserDiagnostics(options()));
    let run!: Promise<void>;
    act(() => {
      run = result.current.run();
      void result.current.run();
    });
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => {
      task.resolve(response);
      await run;
    });
    vi.mocked(invoke).mockResolvedValue({ ...response, httpStatus: 401 });
    await act(async () => {
      await result.current.run();
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.current.report?.httpStatus).toBe(401);
  });

  it("drops all arbitrary native response properties", async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...response,
      error: "PRIVATE_ERROR",
      url: "https://user:pass@example/path?secret=value",
      headers: { cookie: "PRIVATE_COOKIE" },
      body: "PRIVATE_BODY",
    });
    const { result } = renderHook(() => useOriginBrowserDiagnostics(options()));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.report).toEqual(response);
    expect(Object.keys(result.current.report!)).toEqual([
      "outcome",
      "elapsedMs",
      "httpStatus",
      "contentLength",
    ]);
  });

  it.each([
    { ...response, outcome: "PRIVATE_ERROR" },
    { ...response, elapsedMs: -1 },
    { ...response, elapsedMs: 4_294_967_296 },
    { ...response, httpStatus: 0 },
    { ...response, httpStatus: null },
    { ...response, contentLength: "PRIVATE_LENGTH" },
    { ...response, contentLength: Number.MAX_SAFE_INTEGER + 1 },
    { ...response, outcome: "timeout" },
    { ...response, outcome: "timeout", httpStatus: null },
    undefined,
  ])("rejects malformed or inconsistent scalar reports: %j", async (value) => {
    vi.mocked(invoke).mockResolvedValue(value);
    const { result } = renderHook(() => useOriginBrowserDiagnostics(options()));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.report).toBeNull();
    expect(result.current.error).toContain("could not be completed");
    expect(result.current.error).not.toContain("PRIVATE_");
  });

  it.each([
    "timeout",
    "route-unavailable",
    "tls-failed",
    "request-failed",
    "owner-unavailable",
    "busy",
  ])(
    "accepts the closed native outcome %s without inventing HTTP status",
    async (outcome) => {
      vi.mocked(invoke).mockResolvedValue({
        outcome,
        elapsedMs: 4,
        httpStatus: null,
        contentLength: null,
      });
      const { result } = renderHook(() =>
        useOriginBrowserDiagnostics(options()),
      );
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.report).toEqual({
        outcome,
        elapsedMs: 4,
        httpStatus: null,
        contentLength: null,
      });
      expect(result.current.error).toBeNull();
    },
  );

  it("reports unsupported old runtimes safely and never invokes legacy diagnostics", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("PRIVATE_COMMAND_ERROR"));
    const { result } = renderHook(() => useOriginBrowserDiagnostics(options()));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.report).toBeNull();
    expect(result.current.error).toContain(
      "native runtime must support diagnostics",
    );
    expect(result.current.error).not.toContain("PRIVATE_COMMAND_ERROR");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke).mock.calls[0][0]).toBe("origin_browser_diagnose");
  });
});
