import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOriginFindResults } from "../../src/hooks/protocol/useOriginFindResults";
import { useOriginBrowser } from "../../src/hooks/protocol/useOriginBrowser";
import type {
  OriginBrowserFindEvent,
  OriginBrowserTransport,
} from "../../src/types/protocols/originBrowser";

const ipc = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "owner-a" }),
}));
const identity = {
  ownerDatabaseId: "db",
  connectionId: "connection",
  sessionId: "tab",
  attemptId: "native-1",
};
const requestId = "10000000-0000-4000-8000-000000000001";
const event = (): OriginBrowserFindEvent => ({
  sourceIdentity: { ...identity },
  viewId: null,
  result: {
    requestId,
    activeMatchOrdinal: 2,
    numberOfMatches: 7,
    finalUpdate: true,
  },
});
const settle = () => act(async () => {});
let listeners: Array<(event: { payload: unknown }) => void>;
let stops: Array<ReturnType<typeof vi.fn>>;
beforeEach(() => {
  listeners = [];
  stops = [];
  ipc.listen.mockReset().mockImplementation(async (_name, callback) => {
    listeners.push(callback);
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
});
afterEach(cleanup);
function fixture() {
  const props = {
    identity,
    viewId: null as string | null,
    enabled: true,
    documentKey: "document-1",
    assertOwner: vi.fn(),
  };
  const hook = renderHook((options) => useOriginFindResults(options), {
    initialProps: props,
  });
  return { ...hook, props };
}
function emit(value: unknown = event(), index = listeners.length - 1) {
  act(() => listeners[index]({ payload: value }));
}

describe("find result owner-window subscription", () => {
  it("waits for registration and targets the exact owner webview window", async () => {
    const f = fixture();
    expect(f.result.current.ready).toBe(false);
    expect(ipc.listen).toHaveBeenCalledWith(
      "origin-browser-find-result",
      expect.any(Function),
      { target: { kind: "WebviewWindow", label: "owner-a" } },
    );
    await settle();
    expect(f.result.current.ready).toBe(true);
    emit();
    expect(f.result.current.result).toEqual(event().result);
    f.unmount();
    expect(stops[0]).toHaveBeenCalledOnce();
  });

  it.each([
    "ownerDatabaseId",
    "connectionId",
    "sessionId",
    "attemptId",
  ] as const)("rejects another %s", async (field) => {
    const f = fixture();
    await settle();
    const value = {
      ...event(),
      sourceIdentity: { ...identity, [field]: "other" },
    };
    emit(value);
    expect(f.result.current.result).toBeNull();
  });

  it("rejects other views and malformed counts without displaying zero", async () => {
    const f = fixture();
    await settle();
    emit({ ...event(), viewId: "popup" });
    for (const patch of [
      { numberOfMatches: -1 },
      { activeMatchOrdinal: 8 },
      { numberOfMatches: 2 ** 32 },
      { finalUpdate: "yes" },
      { requestId: "query" },
    ]) {
      emit({ ...event(), result: { ...event().result, ...patch } });
    }
    emit(null);
    emit("untrusted");
    expect(f.result.current.result).toBeNull();
  });

  it("retires callbacks across popup/root ABA and document changes", async () => {
    const f = fixture();
    await settle();
    emit();
    f.rerender({ ...f.props, viewId: "popup" });
    await settle();
    emit(event(), 0);
    expect(f.result.current.result).toBeNull();
    emit({ ...event(), viewId: "popup" });
    expect(f.result.current.result).not.toBeNull();
    f.rerender(f.props);
    await settle();
    emit(event(), 0);
    expect(f.result.current.result).toBeNull();
    emit();
    expect(f.result.current.result).not.toBeNull();
    const old = listeners.length - 1;
    f.rerender({ ...f.props, documentKey: "replacement-document" });
    await settle();
    emit(event(), old);
    expect(f.result.current.result).toBeNull();
  });

  it("permanently retires a listener on owner revocation", async () => {
    const f = fixture();
    await settle();
    emit();
    f.props.assertOwner.mockImplementationOnce(() => {
      throw new Error("revoked");
    });
    emit();
    expect(f.result.current.ready).toBe(false);
    expect(f.result.current.result).toBeNull();
    emit();
    expect(f.result.current.result).toBeNull();
    expect(stops[0]).toHaveBeenCalledOnce();
  });

  it("cleans up delayed registration after unmount and never re-enables find", async () => {
    let resolve!: (stop: () => void) => void;
    ipc.listen.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const f = fixture();
    f.unmount();
    const stop = vi.fn();
    await act(async () => resolve(stop));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("disabling owner clears feedback and does not resubscribe", async () => {
    const f = fixture();
    await settle();
    emit();
    f.rerender({ ...f.props, enabled: false });
    await settle();
    emit();
    expect(f.result.current).toEqual({ ready: false, result: null });
    expect(ipc.listen).toHaveBeenCalledOnce();
  });
});

describe("existing control IPC find token", () => {
  it("forwards the UUID with current identity and presentation; rejects invalid tokens locally", async () => {
    const snapshot = {
      identity,
      sequence: 0,
      phase: "attached" as const,
      displayUrl: "https://example.test/",
      title: "Example",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const control = vi.fn().mockResolvedValue(undefined);
    const transport: OriginBrowserTransport = {
      create: async (request) => ({ requestId: request.requestId, snapshot }),
      navigate: vi.fn().mockResolvedValue(undefined),
      control,
      close: vi.fn().mockResolvedValue(undefined),
      status: async (request) => ({
        capability: { availability: "available" },
        snapshot: request.identity ? snapshot : null,
      }),
      listen: async () => () => {},
    };
    const f = renderHook(() =>
      useOriginBrowser({
        owner: identity,
        expectedSecurityRevision: "r1",
        sourceSessionId: "unlock",
        initialUrl: snapshot.displayUrl,
        enabled: true,
        ownerAvailable: true,
        active: true,
        dialogOpen: false,
        consent: { kind: "required" },
        transport,
      }),
    );
    act(() =>
      f.result.current.setViewport({ x: 0, y: 50, width: 800, height: 600 }),
    );
    await waitFor(() => expect(f.result.current.state.phase).toBe("attached"));
    control.mockClear();
    await act(async () => {
      expect(
        await f.result.current.find("needle", false, true, false, requestId),
      ).toBe(true);
    });
    expect(control).toHaveBeenCalledExactlyOnceWith({
      identity,
      action: {
        kind: "find",
        text: "needle",
        forward: false,
        matchCase: true,
        findNext: false,
        requestId,
        presentationRevision: expect.any(Number),
      },
    });
    await act(async () => {
      expect(
        await f.result.current.find("needle", true, false, false, "bad"),
      ).toBe(false);
    });
    expect(control).toHaveBeenCalledOnce();
    expect(f.result.current.state.phase).toBe("attached");
  });
});
