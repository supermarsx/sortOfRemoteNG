import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeOriginPopupBridge } from "../../src/hooks/protocol/useNativeOriginPopupBridge";
import { useOriginPageMenu } from "../../src/hooks/protocol/useOriginPageMenu";
import type { OriginBrowserIdentity } from "../../src/types/protocols/originBrowser";

const mocked = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocked.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocked.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "owner-window" }),
}));
const identity: OriginBrowserIdentity = {
  ownerDatabaseId: "db",
  connectionId: "conn",
  sessionId: "tab",
  attemptId: "attempt",
};
const history = {
  snapshotId: "42",
  currentIndex: 1,
  entries: [
    { index: 0, title: "Before", url: "https://fixture.test/" },
    { index: 1, title: "Now", url: "https://fixture.test/current" },
  ],
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocked.invoke.mockResolvedValue(null);
  mocked.listen.mockResolvedValue(() => {});
});
afterEach(cleanup);
function harness() {
  const assertOwner = vi.fn();
  const hook = renderHook(
    ({ id, viewId, interactive, enabled }) => {
      const bridge = useNativeOriginPopupBridge();
      const menu = useOriginPageMenu({
        identity: id,
        viewId,
        enabled,
        interactive,
        assertOwner,
        runInteractive: bridge.runInteractive,
      });
      return { bridge, menu };
    },
    {
      initialProps: {
        id: identity,
        viewId: null as string | null,
        interactive: false,
        enabled: true,
      },
    },
  );
  act(() => hook.result.current.bridge.bind(identity));
  const show = (revision: number, blocked = false) =>
    hook.result.current.bridge.browserTransport.control({
      identity,
      action: {
        kind: "presentation",
        revision,
        visible: true,
        inputBlocked: blocked,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        occlusions: [],
      },
    });
  const interactive = (viewId: string | null = null) =>
    hook.rerender({ id: identity, viewId, interactive: true, enabled: true });
  return { ...hook, assertOwner, show, interactive };
}
const mutations = () =>
  mocked.invoke.mock.calls.filter(
    ([cmd, { request }]) =>
      (cmd === "origin_browser_page_menu" &&
        request.action.kind !== "history") ||
      (cmd === "origin_browser_popup" && request.action.kind === "open-tab"),
  );

describe("native page-menu integrations", () => {
  it("does no receipt/history reads on mount or unrelated renders", () => {
    const h = harness();
    h.rerender({
      id: identity,
      viewId: null,
      interactive: false,
      enabled: true,
    });
    expect(mocked.invoke).not.toHaveBeenCalled();
  });
  it("targets popup listeners to the exact owner window and still filters source identity", async () => {
    const h = harness();
    const receive = vi.fn();
    await h.result.current.bridge.popupTransport.subscribe(identity, receive);
    expect(mocked.listen).toHaveBeenCalledWith(
      "origin-browser-popups",
      expect.any(Function),
      {
        target: { kind: "WebviewWindow", label: "owner-window" },
      },
    );
    const listener = mocked.listen.mock.calls[0][1];
    listener({
      payload: { sourceIdentity: { ...identity, attemptId: "foreign" } },
    });
    expect(receive).not.toHaveBeenCalled();
    listener({ payload: { sourceIdentity: identity } });
    expect(receive).toHaveBeenCalledTimes(1);
  });
  it("waits for overlay closure, show ACK and focus ACK before one print", async () => {
    const h = harness();
    await h.show(1, true);
    act(() => {
      h.result.current.menu.print();
      h.result.current.menu.print();
    });
    expect(mutations()).toHaveLength(0);
    const shown = deferred(),
      focused = deferred();
    mocked.invoke.mockImplementation((cmd, { request }) => {
      if (cmd === "origin_browser_control") return shown.promise;
      if (request.action.kind === "control") return focused.promise;
      return Promise.resolve(null);
    });
    const showTask = h.show(2);
    h.interactive();
    expect(mutations()).toHaveLength(0);
    expect(
      mocked.invoke.mock.calls.some(
        ([, a]) => a.request.action.kind === "control",
      ),
    ).toBe(false);
    await act(async () => {
      shown.resolve();
      await showTask;
    });
    expect(mutations()).toHaveLength(0);
    expect(mocked.invoke).toHaveBeenLastCalledWith("origin_browser_popup", {
      request: {
        sourceIdentity: identity,
        action: {
          kind: "control",
          viewId: null,
          action: { kind: "focus", presentationRevision: 2 },
        },
      },
    });
    await act(async () => focused.resolve());
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]).toEqual([
      "origin_browser_page_menu",
      { request: { identity, viewId: null, action: { kind: "print" } } },
    ]);
  });
  it("lists history while blocked and jumps with native receipt/index, never a URL", async () => {
    const h = harness();
    await h.show(1, true);
    mocked.invoke.mockResolvedValue(history);
    await act(async () => h.result.current.menu.refreshHistory());
    expect(h.result.current.menu.history).toEqual(history);
    act(() => h.result.current.menu.jump(0));
    expect(mutations()).toHaveLength(0);
    await h.show(2);
    h.interactive();
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0][1].request.action).toEqual({
      kind: "historyJump",
      snapshotId: "42",
      index: 0,
    });
    expect(JSON.stringify(mutations())).not.toContain("https:");
  });
  it("opens a tab from the selected actual child with its acknowledged revision", async () => {
    const h = harness();
    await act(async () =>
      h.result.current.bridge.activate(identity, {
        sourceIdentity: identity,
        viewId: "child",
      }),
    );
    h.rerender({
      id: identity,
      viewId: "child",
      interactive: false,
      enabled: true,
    });
    act(() => h.result.current.menu.openTab());
    await h.show(7);
    h.interactive("child");
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toEqual([
      "origin_browser_popup",
      {
        request: {
          sourceIdentity: identity,
          action: {
            kind: "open-tab",
            viewId: "child",
            presentationRevision: 7,
          },
        },
      },
    ]);
    expect(
      mocked.invoke.mock.calls.some(([cmd]) => cmd === "origin_browser_create"),
    ).toBe(false);
  });
  it("routes printing to the selected child instead of the hidden root", async () => {
    const h = harness();
    await act(async () =>
      h.result.current.bridge.activate(identity, {
        sourceIdentity: identity,
        viewId: "child",
      }),
    );
    h.rerender({
      id: identity,
      viewId: "child",
      interactive: false,
      enabled: true,
    });
    act(() => h.result.current.menu.print());
    await h.show(8);
    h.interactive("child");
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0][1].request.viewId).toBe("child");
  });
  it.each(["database", "attempt", "tab", "A-B-A", "unmount", "revoked"])(
    "cancels late print after %s change",
    async (kind) => {
      const h = harness();
      await h.show(2);
      const focused = deferred();
      mocked.invoke.mockReturnValue(focused.promise);
      act(() => h.result.current.menu.print());
      h.interactive();
      await act(async () => {});
      if (kind === "unmount") h.unmount();
      else if (kind === "revoked")
        h.assertOwner.mockImplementation(() => {
          throw new Error();
        });
      else {
        const id =
          kind === "database"
            ? { ...identity, ownerDatabaseId: "other" }
            : kind === "attempt"
              ? { ...identity, attemptId: "new" }
              : identity;
        h.rerender({
          id,
          viewId: kind === "tab" || kind === "A-B-A" ? "child" : null,
          interactive: true,
          enabled: true,
        });
        if (kind === "A-B-A") h.interactive();
      }
      await act(async () => focused.resolve());
      expect(mutations()).toHaveLength(0);
    },
  );
  it("rejects a superseded presentation instead of replaying the mutation", async () => {
    const h = harness();
    await h.show(1);
    const focused = deferred();
    mocked.invoke.mockReturnValueOnce(focused.promise);
    act(() => h.result.current.menu.print());
    h.interactive();
    await act(async () => {});
    await h.show(2, true);
    await act(async () => focused.resolve());
    expect(mutations()).toHaveLength(0);
    expect(h.result.current.menu.error).toContain("not completed");
  });
  it("shows a scoped failure and never mutates when focus fails", async () => {
    const h = harness();
    await h.show(1);
    mocked.invoke.mockRejectedValueOnce(new Error("PRIVATE"));
    act(() => h.result.current.menu.print());
    h.interactive();
    await waitFor(() => expect(h.result.current.menu.busy).toBe(false));
    expect(mutations()).toHaveLength(0);
    expect(h.result.current.menu.error).toContain("not completed");
    expect(h.result.current.menu.error).not.toContain("PRIVATE");
  });
  it("ignores history returned after an A-B-A selection", async () => {
    const h = harness();
    let finish!: (value: unknown) => void;
    mocked.invoke.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let task!: Promise<void>;
    act(() => {
      task = h.result.current.menu.refreshHistory();
    });
    h.rerender({
      id: identity,
      viewId: "child",
      interactive: false,
      enabled: true,
    });
    h.rerender({
      id: identity,
      viewId: null,
      interactive: false,
      enabled: true,
    });
    await act(async () => {
      finish(history);
      await task;
    });
    expect(h.result.current.menu.history).toBeNull();
  });
  it("rejects oversized history snapshots", async () => {
    const h = harness();
    mocked.invoke.mockResolvedValue({
      ...history,
      entries: Array(129).fill(history.entries[0]),
    });
    await act(async () => h.result.current.menu.refreshHistory());
    expect(h.result.current.menu.history).toBeNull();
    expect(h.result.current.menu.error).toContain("History");
  });
  it("opens Find after the focus ACK without issuing a page mutation", async () => {
    const h = harness();
    await h.show(1);
    act(() => h.result.current.menu.find());
    h.interactive();
    await waitFor(() => expect(h.result.current.menu.findOpenRequest).toBe(1));
    expect(mutations()).toHaveLength(0);
  });
});
