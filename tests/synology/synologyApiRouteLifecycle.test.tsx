import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
const h = vi.hoisted(() => ({
  selected: "http://proxy-user:proxy-private@proxy.test:8080",
  invalid: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => {
    if (h.invalid) throw new Error("Invalid global HTTP proxy");
    return h.selected;
  },
}));
const seed = {
  host: "fixture.quickconnect.to",
  port: 443,
  useHttps: true,
  username: "nas-user",
  password: "nas-private",
};
const route = {
  kind: "http_proxy",
  url: "http://proxy.test:8080",
  username: "proxy-user",
  password: "proxy-private",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const connectCalls = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "syn_fs_connect");
const capabilities = { version: 1, httpProxy: true, quickConnect: true };
beforeEach(() => {
  h.selected = "http://proxy-user:proxy-private@proxy.test:8080";
  h.invalid = false;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) =>
      command === "syn_fs_transport_capabilities"
        ? capabilities
        : command === "syn_fs_connect"
          ? {
              status: "connected",
              sessionId: "receipt-a",
              message: "Connected",
            }
          : command === "syn_fs_session_health"
            ? {
                status: "connected",
                lastVerifiedAt: "",
                consecutiveFailures: 0,
                message: null,
              }
            : true,
    );
});
afterEach(cleanup);
describe("native API route lifecycle", () => {
  it("does not issue the second credential-bearing call if the selected proxy changes while a requested OTP is held", async () => {
    const held = deferred<{ code: string; assertCurrent: () => void }>();
    const resolveOtp = vi.fn(() => held.promise);
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_transport_capabilities"
        ? capabilities
        : command === "syn_fs_connect"
          ? { status: "otp_required" }
          : true,
    );
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, { initialConfig: seed, resolveOtp }),
    );
    let connecting!: Promise<void>;
    await act(async () => {
      connecting = result.current.connect();
    });
    expect(resolveOtp).toHaveBeenCalledOnce();
    await act(async () => {
      h.selected = "http://other.test:8080";
      held.resolve({ code: "123456", assertCurrent: () => {} });
      await connecting;
    });
    expect(connectCalls()).toHaveLength(1);
    expect(result.current.connectionStatus).toBe("error");
    expect(result.current.connectionError).toContain(
      "global HTTP proxy changed",
    );
  });
  it("passes the same explicit route to first sign-in and the one requested vault OTP without exposing it in returned form state", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_transport_capabilities"
        ? capabilities
        : command === "syn_fs_connect"
          ? connectCalls().length === 1
            ? { status: "otp_required" }
            : { status: "connected", sessionId: "receipt-a" }
          : true,
    );
    const resolveOtp = vi.fn(async (assertCurrent: () => void) => ({
      code: "123456",
      assertCurrent,
    }));
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, { initialConfig: seed, resolveOtp }),
    );
    await act(() => result.current.connect());
    expect(connectCalls()).toHaveLength(2);
    expect(
      connectCalls().map(([, args]) => {
        if (!args || Array.isArray(args) || !("route" in args))
          throw new Error("Expected named native connect arguments");
        return args.route;
      }),
    ).toEqual([route, route]);
    expect(result.current.connectionStatus).toBe("connected");
    expect(JSON.stringify(result.current)).not.toMatch(
      /proxy-private|proxy-user|proxy\.test/,
    );
  });
  it("refuses an invalid selected proxy before resolving vault credentials or issuing a NAS request", async () => {
    h.invalid = true;
    const resolveCredentials = vi.fn();
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: seed,
        resolveCredentials,
      }),
    );
    await act(() => result.current.connect());
    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(connectCalls()).toHaveLength(0);
    expect(result.current.connectionStatus).toBe("error");
  });
  it("fences proxy change/return ABA during held credential resolution without login replay", async () => {
    const held = deferred<{
      username: string;
      password: string;
      assertCurrent: () => void;
    }>();
    const resolveCredentials = vi.fn(() => held.promise);
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: seed,
        resolveCredentials,
      }),
    );
    let connecting!: Promise<void>;
    await act(async () => {
      connecting = result.current.connect();
    });
    expect(resolveCredentials).toHaveBeenCalledOnce();
    await act(async () => {
      h.selected = "http://other.test:8080";
      window.dispatchEvent(new Event("settings-updated"));
      h.selected = "http://proxy-user:proxy-private@proxy.test:8080";
      window.dispatchEvent(new Event("settings-updated"));
      held.resolve({
        username: "vault-user",
        password: "vault-private",
        assertCurrent: () => {},
      });
      await connecting;
    });
    expect(connectCalls()).toHaveLength(0);
    expect(result.current.connectionError).toContain(
      "global HTTP proxy changed",
    );
    expect(result.current.connectionStatus).toBe("error");
  });
  it("releases a late native receipt on an unannounced route change instead of adopting it", async () => {
    const held = deferred<{ status: string; sessionId: string }>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_transport_capabilities"
        ? Promise.resolve(capabilities)
        : command === "syn_fs_connect"
          ? held.promise
          : Promise.resolve(true),
    );
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, { initialConfig: seed }),
    );
    let connecting!: Promise<void>;
    await act(async () => {
      connecting = result.current.connect();
    });
    expect(connectCalls()).toHaveLength(1);
    await act(async () => {
      h.selected = "http://other.test:8080";
      held.resolve({ status: "connected", sessionId: "late-receipt" });
      await connecting;
    });
    expect(connectCalls()).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: result.current.instanceId,
      expectedSessionId: "late-receipt",
    });
    expect(result.current.sessionId).toBeNull();
    expect(result.current.connectionError).toContain(
      "global HTTP proxy changed",
    );
  });
  it("revokes an established API receipt when the selected route changes, ignoring event payloads", async () => {
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, { initialConfig: seed }),
    );
    await act(() => result.current.connect());
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: { globalProxy: "untrusted event payload" },
        }),
      ),
    );
    expect(result.current.sessionId).toBe("receipt-a");
    await act(async () => {
      h.selected = "http://other.test:8080";
      window.dispatchEvent(new Event("settings-updated"));
    });
    expect(result.current.sessionId).toBeNull();
    expect(connectCalls()).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: result.current.instanceId,
      expectedSessionId: "receipt-a",
    });
  });
  it("redacts proxy credential echoes from failure text while retaining the saved NAS target", async () => {
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_transport_capabilities"
        ? Promise.resolve(capabilities)
        : Promise.reject(
            "Connection failed proxy-user proxy-private nas-private",
          ),
    );
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, { initialConfig: seed }),
    );
    await act(() => result.current.connect());
    expect(result.current.connectionError).not.toMatch(
      /proxy-user|proxy-private|nas-private/,
    );
    expect(result.current.host).toBe(seed.host);
  });
});
