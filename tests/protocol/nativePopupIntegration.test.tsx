import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOriginSelectedDownloads } from "../../src/hooks/protocol/useOriginSelectedDownloads";
import { useNativeOriginPopupBridge } from "../../src/hooks/protocol/useNativeOriginPopupBridge";
import { useOriginCredentialTyping } from "../../src/hooks/security/useOriginCredentialTyping";
import type { OriginCredentialInputTransport } from "../../src/types/protocols/originCredentialTyping";
import { readPopupInventory } from "../../src/types/protocols/originBrowserPopups";

const mocked = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocked.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocked.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "owner-window" }),
}));
const source = {
  ownerDatabaseId: "quick-connect:tab",
  connectionId: "conn",
  sessionId: "tab",
  attemptId: "attempt",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocked.invoke.mockResolvedValue({});
  mocked.listen.mockResolvedValue(() => {});
});
afterEach(() => vi.useRealTimers());

function typingBridge(transport: OriginCredentialInputTransport) {
  return renderHook(() => {
    const bridge = useNativeOriginPopupBridge();
    const typing = useOriginCredentialTyping({
      identity: source,
      sessionId: "tab",
      viewId: null,
      documentKey: "page",
      enabled: true,
      interactive: true,
      open: true,
      assertOwner: () => {},
      runInteractive: bridge.runInteractive,
      transport,
    });
    return { bridge, typing };
  });
}

describe("credential typing presentation handoff", () => {
  it.each(["blocked", "superseded-ready", "superseded-rejected"])(
    "waits for popup removal and its native ACK on repeated Type attempts (%s)",
    async (handoff) => {
      vi.useFakeTimers();
      let acknowledge!: () => void;
      let refuse!: () => void;
      mocked.invoke.mockImplementation((_name, { request }) =>
        request.action?.kind === "presentation" && !request.action.inputBlocked
          ? new Promise<void>((resolve, reject) => {
              acknowledge = resolve;
              refuse = () => reject(new Error("obsolete revision"));
            })
          : Promise.resolve({}),
      );
      const transport = vi.fn<OriginCredentialInputTransport>(
        async (request) => ({
          status:
            request.action.kind === "capture"
              ? "captured"
              : request.action.kind === "type"
                ? "complete"
                : "cancelled",
          captureId: "current-capture",
        }),
      );
      const { result, unmount } = typingBridge(transport);
      act(() => result.current.bridge.bind(source));
      for (let attempt = 0; attempt < 2; attempt++) {
        const previous = result.current.bridge.browserTransport.control({
          identity: source,
          action: {
            kind: "presentation",
            revision: attempt * 2 + 1,
            visible: true,
            inputBlocked: handoff === "blocked",
            bounds: { x: 0, y: 0, width: 500, height: 400 },
            occlusions: [{ x: 0, y: 0, width: 50, height: 50 }],
          },
        });
        void previous.catch(() => {});
        const previousAck =
          handoff === "superseded-rejected" ? refuse : acknowledge;
        const target = result.current.typing.target!;
        const disclose = vi.fn(() => target.type("synthetic-value", () => {}));
        let pending!: Promise<void>;
        await act(async () => {
          pending = result.current.typing.run(disclose);
        });
        expect(result.current.typing.phase).toBe("waiting");
        expect(disclose).not.toHaveBeenCalled();
        expect(
          transport.mock.calls.filter(([r]) => r.action.kind === "capture"),
        ).toHaveLength(attempt);
        const presented = result.current.bridge.browserTransport.control({
          identity: source,
          action: {
            kind: "presentation",
            revision: attempt * 2 + 2,
            visible: true,
            inputBlocked: false,
            bounds: { x: 0, y: 0, width: 500, height: 400 },
            occlusions: [],
          },
        });
        if (handoff !== "blocked") previousAck();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });
        expect(disclose).not.toHaveBeenCalled();
        expect(
          mocked.invoke.mock.calls.filter(
            ([, { request }]) => request.action?.action?.kind === "focus",
          ),
        ).toHaveLength(2 * attempt);
        await act(async () => {
          acknowledge();
          await presented;
          await pending;
        });
        expect(disclose).toHaveBeenCalledOnce();
        expect(result.current.typing.finished).toBe(attempt + 1);
        expect(result.current.typing.notice).toBe("");
      }
      expect(
        transport.mock.calls.filter(([r]) => r.action.kind === "type"),
      ).toHaveLength(2);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["timeout", "cancel", "selection-roundtrip"])(
    "ends a pending handoff on %s without capturing a field",
    async (reason) => {
      vi.useFakeTimers();
      const transport = vi.fn<OriginCredentialInputTransport>();
      const { result, unmount } = typingBridge(transport);
      act(() => result.current.bridge.bind(source));
      await result.current.bridge.browserTransport.control({
        identity: source,
        action: {
          kind: "presentation",
          revision: 1,
          visible: true,
          inputBlocked: true,
          bounds: { x: 0, y: 0, width: 500, height: 400 },
        },
      });
      const disclose = vi.fn(async () => {});
      let pending!: Promise<void>;
      await act(async () => {
        pending = result.current.typing.run(disclose);
      });
      if (reason === "cancel") act(() => result.current.typing.cancel());
      if (reason === "selection-roundtrip")
        await act(async () => {
          await result.current.bridge.activate(source, {
            sourceIdentity: source,
            viewId: "other",
          });
          await result.current.bridge.activate(source, null);
        });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(reason === "timeout" ? 30000 : 300);
        await pending;
      });
      expect(result.current.typing.phase).toBe("idle");
      if (reason === "timeout")
        expect(result.current.typing.notice).toContain("Typing timed out");
      expect(disclose).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["unchanged-ack-refusal", "replacement-after-focus"])(
    "does not retry %s",
    async (failure) => {
      vi.useFakeTimers();
      const transport = vi.fn<OriginCredentialInputTransport>();
      const { result, unmount } = typingBridge(transport);
      act(() => result.current.bridge.bind(source));
      let releaseFocus!: () => void;
      mocked.invoke.mockImplementation((_name, { request }) => {
        if (
          failure === "unchanged-ack-refusal" &&
          request.action?.kind === "presentation"
        )
          return Promise.reject(new Error("synthetic native refusal"));
        if (request.action?.action?.kind === "focus")
          return new Promise<void>((resolve) => {
            releaseFocus = resolve;
          });
        return Promise.resolve({});
      });
      const presentation = {
        kind: "presentation" as const,
        revision: 1,
        visible: true,
        inputBlocked: false,
        bounds: { x: 0, y: 0, width: 500, height: 400 },
      };
      await result.current.bridge.browserTransport
        .control({ identity: source, action: presentation })
        .catch(() => {});
      const disclose = vi.fn(async () => {});
      let pending!: Promise<void>;
      await act(async () => {
        pending = result.current.typing.run(disclose);
      });
      if (failure === "replacement-after-focus") {
        expect(releaseFocus).toBeTypeOf("function");
        await result.current.bridge.browserTransport.control({
          identity: source,
          action: { ...presentation, revision: 2 },
        });
        await act(async () => {
          releaseFocus();
        });
      }
      await act(async () => {
        await pending;
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(result.current.typing.phase).toBe("idle");
      expect(disclose).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
      expect(
        mocked.invoke.mock.calls.filter(
          ([, { request }]) => request.action?.action?.kind === "focus",
        ),
      ).toHaveLength(failure === "replacement-after-focus" ? 1 : 0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("selected download reconciliation", () => {
  it("shows blocked download notices only for the current exact owner and unsubscribes stale attempts", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    const off = vi.fn();
    mocked.listen.mockImplementation(async (name, callback) => {
      listeners.set(name, callback);
      return off;
    });
    mocked.invoke.mockResolvedValue([]);
    const owner = vi.fn();
    const view = renderHook(
      ({ identity }) => useOriginSelectedDownloads(identity, null, true, owner),
      { initialProps: { identity: source } },
    );
    await act(async () => {});
    const notify = listeners.get("origin-browser-download-blocked")!;
    act(() =>
      notify({
        payload: {
          identity: { ...source, attemptId: "other" },
          reason: "disabled",
        },
      }),
    );
    expect(view.result.current.notice).toBe("");
    act(() => notify({ payload: { identity: source, reason: "disabled" } }));
    expect(view.result.current.notice).toContain(
      "Enable downloads in Web Browser settings",
    );
    owner.mockImplementation(() => {
      throw new Error("closed");
    });
    act(() => notify({ payload: { identity: source, reason: "capacity" } }));
    expect(view.result.current.notice).not.toContain("limit");
    owner.mockReset();
    view.rerender({ identity: { ...source, attemptId: "replacement" } });
    expect(view.result.current.notice).toBe("");
    act(() => notify({ payload: { identity: source, reason: "disabled" } }));
    expect(view.result.current.notice).toBe("");
    view.unmount();
    expect(off).toHaveBeenCalled();
  });
  it("does no work while inactive and does not render identical active snapshots", async () => {
    vi.useFakeTimers();
    mocked.invoke.mockResolvedValue([]);
    let renders = 0;
    const { result, rerender, unmount } = renderHook(
      ({ active }) => {
        renders++;
        return useOriginSelectedDownloads(source, "popup-1", active, () => {});
      },
      { initialProps: { active: false } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocked.invoke).not.toHaveBeenCalled();
    rerender({ active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.rows).toEqual([]);
    const before = renders;
    const requests = mocked.invoke.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocked.invoke.mock.calls.length).toBe(requests + 1);
    expect(renders).toBe(before);
    rerender({ active: false });
    const paused = mocked.invoke.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocked.invoke.mock.calls.length).toBe(paused);
    unmount();
  });

  it("coalesces source events, preserves view routing and displays failed actions", async () => {
    vi.useFakeTimers();
    let notify!: (event: { payload: unknown }) => void;
    mocked.listen.mockImplementation(async (_event, callback) => {
      if (_event === "origin-browser-download") notify = callback;
      return () => {};
    });
    mocked.invoke.mockResolvedValue([]);
    const { result, unmount } = renderHook(() =>
      useOriginSelectedDownloads(source, "popup-2", true, () => {}),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      for (let n = 0; n < 10; n++) notify({ payload: { identity: source } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(749);
    });
    expect(mocked.invoke.mock.calls.length).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocked.invoke.mock.calls.length).toBe(2);
    expect(mocked.invoke.mock.lastCall?.[1].request.action).toEqual({
      kind: "downloads",
      viewId: "popup-2",
    });
    mocked.invoke.mockRejectedValueOnce(new Error("native rejection"));
    await act(async () => {
      expect(await result.current.act(2, "cancel")).toBe(false);
    });
    expect(result.current.error).toContain(
      "could not be completed for this view",
    );
    expect(mocked.invoke.mock.lastCall?.[1].request.action.viewId).toBe(
      "popup-2",
    );
    unmount();
  });
});

describe("native popup control routing", () => {
  it("routes DevTools to the selected native popup without creating a session", async () => {
    const { result } = renderHook(() => useNativeOriginPopupBridge());
    act(() => result.current.bind(source));
    const action = { kind: "devtools" as const, presentationRevision: 7 };
    await result.current.browserTransport.control({ identity: source, action });
    expect(mocked.invoke).toHaveBeenLastCalledWith("origin_browser_control", {
      request: { identity: source, action },
    });
    await act(async () =>
      result.current.activate(source, {
        sourceIdentity: source,
        viewId: "inspected-popup",
      }),
    );
    await result.current.browserTransport.control({ identity: source, action });
    expect(mocked.invoke).toHaveBeenLastCalledWith("origin_browser_popup", {
      request: {
        sourceIdentity: source,
        action: { kind: "control", viewId: "inspected-popup", action },
      },
    });
    expect(
      mocked.invoke.mock.calls.some(
        ([name]) => name === "origin_browser_create",
      ),
    ).toBe(false);
  });

  it("adopts and selects existing child handles without creating another session", async () => {
    const { result } = renderHook(() => useNativeOriginPopupBridge());
    const transport = result.current.browserTransport;
    act(() => result.current.bind(source));
    await act(async () => {
      await result.current.popupTransport.adopt({
        sourceIdentity: source,
        viewId: "popup-1",
      });
      await result.current.activate(source, {
        sourceIdentity: source,
        viewId: "popup-1",
      });
    });
    await transport.navigate({
      identity: source,
      url: "https://website.test/child",
    });
    await transport.control({ identity: source, action: { kind: "back" } });
    expect(result.current.browserTransport).toBe(transport);
    const requests = mocked.invoke.mock.calls.map(([command, envelope]) => ({
      command,
      ...envelope.request,
    }));
    expect(requests.map((r) => r.action.kind)).toEqual([
      "adopt",
      "select",
      "navigate",
      "control",
    ]);
    for (const request of requests) {
      expect(request.command).toBe("origin_browser_popup");
      expect(request.sourceIdentity).toEqual(source);
      expect(request.action.viewId).toBe("popup-1");
    }
    expect(
      mocked.invoke.mock.calls.some(
        ([name]) => name === "origin_browser_create",
      ),
    ).toBe(false);
  });

  it("keeps viewport clipping source-scoped while targeting page actions to the child", async () => {
    const { result } = renderHook(() => useNativeOriginPopupBridge());
    act(() => result.current.bind(source));
    await act(async () =>
      result.current.activate(source, {
        sourceIdentity: source,
        viewId: "popup-2",
      }),
    );
    const action = {
      kind: "presentation" as const,
      revision: 9,
      bounds: { x: 0, y: 0, width: 500, height: 400 },
      visible: true,
      occlusions: [{ x: 0, y: 0, width: 30, height: 40 }],
      inputBlocked: true,
    };
    await result.current.browserTransport.control({ identity: source, action });
    expect(mocked.invoke).toHaveBeenLastCalledWith("origin_browser_control", {
      request: { identity: source, action },
    });
    await result.current.browserTransport.control({
      identity: source,
      action: { kind: "zoom", percent: 120, presentationRevision: 9 },
    });
    expect(mocked.invoke).toHaveBeenLastCalledWith("origin_browser_popup", {
      request: {
        sourceIdentity: source,
        action: {
          kind: "control",
          viewId: "popup-2",
          action: { kind: "zoom", percent: 120, presentationRevision: 9 },
        },
      },
    });
  });

  it("cannot let an old-source selection or late ACK replace the current session", async () => {
    let resolve!: (value: unknown) => void;
    mocked.invoke.mockImplementation((_name, { request }) =>
      request.action?.kind === "select"
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({}),
    );
    const { result } = renderHook(() => useNativeOriginPopupBridge());
    act(() => result.current.bind(source));
    let selected!: Promise<void>;
    act(() => {
      selected = result.current.activate(source, {
        sourceIdentity: source,
        viewId: "popup-1",
      });
    });
    const next = { ...source, attemptId: "replacement" };
    act(() => result.current.bind(next));
    await act(async () => {
      resolve({});
      await selected;
    });
    expect(result.current.selection).toBeNull();
    await expect(result.current.activate(source, null)).rejects.toThrow(
      "replaced",
    );
    expect(result.current.pending).toBe(false);
  });

  it("child selection failure retains the previous actual control target", async () => {
    const { result } = renderHook(() => useNativeOriginPopupBridge());
    act(() => result.current.bind(source));
    await act(async () =>
      result.current.activate(source, {
        sourceIdentity: source,
        viewId: "popup-1",
      }),
    );
    mocked.invoke.mockRejectedValueOnce(new Error("stale"));
    await act(async () => {
      await expect(
        result.current.activate(source, {
          sourceIdentity: source,
          viewId: "popup-2",
        }),
      ).rejects.toThrow();
    });
    await result.current.browserTransport.navigate({
      identity: source,
      url: "https://website.test/next",
    });
    expect(mocked.invoke.mock.lastCall?.[1].request.action.viewId).toBe(
      "popup-1",
    );
  });

  it("retains only bounded child display state with the exact source identity", () => {
    const snapshot = {
      identity: source,
      sequence: 3,
      phase: "attached",
      title: "Child",
      displayUrl: "https://website.test",
      currentUrl: "https://website.test/path?q=private",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      password: "must not copy",
    };
    const payload = {
      sourceIdentity: source,
      sequence: 3,
      sourceClosed: false,
      views: [
        {
          viewId: "popup-1",
          phase: "adopted",
          disposition: "foreground",
          snapshot,
        },
      ],
    };
    const decoded = readPopupInventory(payload, source);
    expect(decoded?.views[0].snapshot?.currentUrl).toBe(snapshot.currentUrl);
    expect(JSON.stringify(decoded)).not.toContain("must not copy");
    expect(
      readPopupInventory(
        {
          ...payload,
          views: [
            {
              ...payload.views[0],
              snapshot: {
                ...snapshot,
                identity: { ...source, sessionId: "other" },
              },
            },
          ],
        },
        source,
      ),
    ).toBeNull();
  });
});
