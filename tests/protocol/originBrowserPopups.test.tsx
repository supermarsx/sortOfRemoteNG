import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OriginBrowserIdentity } from "../../src/types/protocols/originBrowser";
import {
  readPopupInventory,
  type OriginPopupInventory,
  type OriginPopupTransport,
  type OriginPopupView,
} from "../../src/types/protocols/originBrowserPopups";
import { useOriginBrowserPopups } from "../../src/hooks/protocol/useOriginBrowserPopups";
import OriginPopupTabs from "../../src/components/protocol/webBrowser/OriginPopupTabs";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const source = (
  patch: Partial<OriginBrowserIdentity> = {},
): OriginBrowserIdentity =>
  Object.freeze({
    ownerDatabaseId: "db-1",
    connectionId: "connection-1",
    sessionId: "source-tab",
    attemptId: "attempt-1",
    ...patch,
  });
const child = (
  viewId = "popup-1",
  patch: Partial<OriginPopupView> = {},
): OriginPopupView => ({
  viewId,
  phase: "available",
  disposition: "foreground",
  title: "Child website",
  ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture(identity = source()) {
  let listener: ((value: unknown) => void) | undefined;
  let sequence = 0;
  let views: readonly OriginPopupView[] = [];
  let revoked = false;
  const inventory = (
    patch: Partial<OriginPopupInventory> = {},
  ): OriginPopupInventory => ({
    sourceIdentity: identity,
    sequence,
    views,
    sourceClosed: false,
    ...patch,
  });
  const off = vi.fn();
  const transport = {
    subscribe: vi.fn<OriginPopupTransport["subscribe"]>(async (_, callback) => {
      listener = callback;
      return off;
    }),
    list: vi.fn<OriginPopupTransport["list"]>(async () => inventory()),
    adopt: vi.fn<OriginPopupTransport["adopt"]>(async (reference) => {
      sequence++;
      views = views.map((view) =>
        view.viewId === reference.viewId ? { ...view, phase: "adopted" } : view,
      );
      return inventory();
    }),
    close: vi.fn<OriginPopupTransport["close"]>(async () => {}),
  };
  const options = {
    sourceIdentity: identity as OriginBrowserIdentity | null,
    enabled: true,
    transport,
    assertOwner: vi.fn(() => {
      if (revoked) throw new Error("Revoked owner");
    }),
    onActivate: vi.fn(),
  };
  return {
    options,
    transport,
    off,
    inventory,
    revoke: () => {
      revoked = true;
    },
    emit: (
      next: readonly OriginPopupView[],
      patch: Partial<OriginPopupInventory> = {},
    ) => {
      views = next;
      sequence++;
      listener?.(inventory(patch));
    },
    deliver: (value: unknown) => listener?.(value),
  };
}
async function mounted(f = fixture()) {
  const hook = renderHook((options) => useOriginBrowserPopups(options), {
    initialProps: f.options,
  });
  await act(async () => {});
  return { ...f, ...hook };
}

describe("owner-window native popup adoption", () => {
  it.each([
    "renderer",
    "session",
    "callback",
    "native-surface",
    "load",
  ] as const)(
    "preserves only the safe failed-phase %s reason in child snapshots",
    (failureReason) => {
      const f = fixture();
      const snapshot = {
        identity: source(),
        sequence: 1,
        phase: "failed",
        displayUrl: "https://child.test/",
        currentUrl: "https://child.test/",
        title: "Child",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        failureReason,
        error: "SECRET native exception",
      };
      const inventory = (patch = {}) =>
        readPopupInventory(
          {
            ...f.inventory(),
            views: [{ ...child(), snapshot: { ...snapshot, ...patch } }],
          },
          source(),
        );
      expect(inventory()?.views[0].snapshot?.failureReason).toBe(failureReason);
      expect(JSON.stringify(inventory())).not.toContain("SECRET");
      for (const patch of [
        { phase: "attached" },
        { failureReason: undefined },
        { failureReason: "future-fault SECRET" },
        { failureReason: { message: "SECRET" } },
      ]) {
        const parsed = inventory(patch);
        expect(parsed).not.toBeNull();
        expect(parsed?.views[0].snapshot).not.toHaveProperty("failureReason");
        expect(JSON.stringify(parsed)).not.toMatch(/SECRET|future-fault/);
      }
    },
  );

  it.each(["foreground", "background"] as const)(
    "adopts existing %s child without creating a new connection",
    async (disposition) => {
      const f = await mounted();
      act(() => f.emit([child("popup-1", { disposition })]));
      await waitFor(() =>
        expect(f.result.current.tabs[0]?.phase).toBe("adopted"),
      );
      const reference = { sourceIdentity: source(), viewId: "popup-1" };
      expect(f.transport.adopt).toHaveBeenCalledExactlyOnceWith(reference);
      expect(f.result.current.activeViewId).toBe(
        disposition === "foreground" ? "popup-1" : null,
      );
      expect(f.options.onActivate).toHaveBeenCalledTimes(
        disposition === "foreground" ? 1 : 0,
      );
      act(() => f.result.current.select("popup-1"));
      expect(f.options.onActivate).toHaveBeenLastCalledWith(reference);
      expect(f.transport.close).not.toHaveBeenCalled();
    },
  );

  it("retains original Quick Connect source scope and stores only transient display metadata", async () => {
    const f = fixture(source({ ownerDatabaseId: "quick-connect:source-tab" }));
    const localWrite = vi.spyOn(window.localStorage, "setItem");
    const sessionWrite = vi.spyOn(window.sessionStorage, "setItem");
    const hook = await mounted(f);
    act(() =>
      f.emit([
        {
          ...child(),
          credentials: "secret",
          quickConnect: { basicAuthPassword: "secret" },
        } as OriginPopupView,
      ]),
    );
    await waitFor(() =>
      expect(hook.result.current.tabs[0]?.phase).toBe("adopted"),
    );
    expect(f.transport.adopt.mock.calls[0][0]).toEqual({
      sourceIdentity: f.options.sourceIdentity,
      viewId: "popup-1",
    });
    expect(JSON.stringify(hook.result.current.tabs)).not.toMatch(
      /credentials|secret|quickConnect|ownerDatabaseId/,
    );
    expect(f.options.sourceIdentity?.sessionId).toBe("source-tab");
    expect(localWrite).not.toHaveBeenCalled();
    expect(sessionWrite).not.toHaveBeenCalled();
  });

  it("rejects other window-scoped source identities even when connection IDs match", async () => {
    const f = await mounted();
    for (const changed of [
      source({ ownerDatabaseId: "db-2" }),
      source({ sessionId: "other" }),
      source({ attemptId: "other" }),
    ]) {
      act(() => f.emit([child()], { sourceIdentity: changed }));
    }
    expect(f.transport.adopt).not.toHaveBeenCalled();
    expect(f.result.current.tabs).toEqual([]);
    expect(f.result.current.error).toMatch(/invalid/);
  });

  it("subscribes before listing and ignores a stale list or event after newer removal", async () => {
    const f = fixture();
    const list = deferred<unknown>();
    f.transport.list.mockReturnValue(list.promise);
    const hook = await mounted(f);
    expect(f.transport.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      f.transport.list.mock.invocationCallOrder[0],
    );
    act(() => f.emit([child()]));
    await waitFor(() =>
      expect(hook.result.current.tabs[0]?.phase).toBe("adopted"),
    );
    const stale = f.inventory();
    act(() => f.emit([]));
    await act(async () => list.resolve(stale));
    act(() => f.deliver(stale));
    expect(hook.result.current.tabs).toEqual([]);
    expect(hook.result.current.activeViewId).toBeNull();
    expect(f.transport.adopt).toHaveBeenCalledTimes(1);
  });

  it("closes only the selected child and waits for native acknowledgement before removing its tab", async () => {
    const f = await mounted();
    act(() => f.emit([child("a"), child("b", { disposition: "background" })]));
    await waitFor(() =>
      expect(f.result.current.tabs.every((v) => v.phase === "adopted")).toBe(
        true,
      ),
    );
    await act(async () => f.result.current.close("a"));
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      sourceIdentity: source(),
      viewId: "a",
    });
    expect(f.result.current.tabs).toHaveLength(2);
    expect(f.result.current.tabs.find((v) => v.viewId === "a")?.closing).toBe(
      true,
    );
    expect(f.result.current.tabs.find((v) => v.viewId === "b")?.closing).toBe(
      false,
    );
    act(() =>
      f.emit([child("b", { disposition: "background", phase: "adopted" })]),
    );
    expect(f.result.current.tabs.map((v) => v.viewId)).toEqual(["b"]);
    expect(f.options.assertOwner).not.toThrow();
  });

  it("does not let a late adoption receipt resurrect a child closed by native", async () => {
    const f = fixture();
    const adoption = deferred<unknown>();
    f.transport.adopt.mockReturnValue(adoption.promise);
    const hook = await mounted(f);
    act(() => f.emit([child()]));
    const receipt = f.inventory({
      views: [child("popup-1", { phase: "adopted" })],
    });
    act(() => f.emit([]));
    await act(async () => adoption.resolve(receipt));
    expect(hook.result.current.tabs).toEqual([]);
    expect(f.options.onActivate).not.toHaveBeenCalled();
  });

  it("closes late adoption after source replacement using the original identity", async () => {
    const f = fixture();
    const adoption = deferred<unknown>();
    f.transport.adopt.mockReturnValue(adoption.promise);
    const hook = await mounted(f);
    act(() => f.emit([child()]));
    const receipt = f.inventory({
      views: [child("popup-1", { phase: "adopted" })],
    });
    hook.rerender({
      ...f.options,
      sourceIdentity: source({ attemptId: "attempt-2" }),
    });
    await act(async () => adoption.resolve(receipt));
    expect(hook.result.current.tabs).toEqual([]);
    expect(f.options.onActivate).not.toHaveBeenCalled();
    expect(f.off).toHaveBeenCalled();
    expect(
      f.transport.close.mock.calls.every(
        ([ref]) => ref.sourceIdentity.attemptId === "attempt-1",
      ),
    ).toBe(true);
    expect(f.transport.close).toHaveBeenCalled();
  });

  it("clears and closes all children on source revocation without allowing newer events to revive them", async () => {
    const f = await mounted();
    act(() => f.emit([child()]));
    await waitFor(() => expect(f.result.current.activeViewId).toBe("popup-1"));
    act(() =>
      f.emit([child("popup-1", { phase: "adopted" })], { sourceClosed: true }),
    );
    expect(f.result.current.tabs).toEqual([]);
    expect(f.options.onActivate).toHaveBeenLastCalledWith(null);
    act(() => f.emit([child("other")]));
    expect(f.transport.adopt).toHaveBeenCalledTimes(1);
    expect(f.transport.close).toHaveBeenCalledWith({
      sourceIdentity: source(),
      viewId: "popup-1",
    });
  });

  it("checks the source lease again before adopting or activating", async () => {
    const f = await mounted();
    f.revoke();
    act(() => f.emit([child()]));
    act(() => f.result.current.select("popup-1"));
    expect(f.transport.adopt).not.toHaveBeenCalled();
    expect(f.options.onActivate).not.toHaveBeenCalled();
  });

  it("cleans up a subscription resolved after unmount", async () => {
    const f = fixture();
    const subscription = deferred<() => void>();
    f.transport.subscribe.mockReturnValue(subscription.promise);
    const hook = await mounted(f);
    hook.unmount();
    await act(async () => subscription.resolve(f.off));
    expect(f.off).toHaveBeenCalledOnce();
    expect(f.transport.list).not.toHaveBeenCalled();
  });

  it("closes an adoption failure without exposing native error strings", async () => {
    const f = await mounted();
    f.transport.adopt.mockRejectedValue(new Error("secret-token-url"));
    act(() => f.emit([child()]));
    await waitFor(() => expect(f.transport.close).toHaveBeenCalledOnce());
    expect(f.result.current.error).toBe("A popup could not be adopted.");
    expect(f.result.current.tabs[0]?.closing).toBe(true);
  });

  it("allows retrying child close after a rejected native command", async () => {
    const f = await mounted();
    act(() => f.emit([child()]));
    await waitFor(() =>
      expect(f.result.current.tabs[0]?.phase).toBe("adopted"),
    );
    f.transport.close.mockRejectedValueOnce(new Error("private native error"));
    await act(async () => f.result.current.close("popup-1"));
    expect(f.result.current.tabs[0]?.closing).toBe(false);
    await act(async () => f.result.current.close("popup-1"));
    expect(f.transport.close).toHaveBeenCalledTimes(2);
  });
});

describe("transient popup strip and inventory bounds", () => {
  it("preserves safe recoverable child load evidence without closing or selecting another tab", async () => {
    const f = await mounted();
    const snapshot = {
      identity: source(),
      sequence: 1,
      phase: "attached" as const,
      currentUrl: "https://fixture.test/",
      displayUrl: "https://fixture.test/",
      title: "Child website",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      loadFailure: {
        code: -105,
        category: "dns" as const,
        text: "SECRET",
        failedUrl: "https://SECRET",
      },
    };
    act(() => f.emit([child("popup-1", { phase: "adopted", snapshot })]));
    expect(f.result.current.tabs[0]?.snapshot?.loadFailure).toEqual({
      code: -105,
      category: "dns",
    });
    expect(JSON.stringify(f.result.current.tabs)).not.toContain("SECRET");
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.options.onActivate).not.toHaveBeenCalled();
    act(() =>
      f.emit([
        child("popup-1", {
          phase: "adopted",
          snapshot: { ...snapshot, sequence: 2, loadFailure: undefined },
        }),
      ]),
    );
    expect(f.result.current.tabs[0]?.snapshot?.loadFailure).toBeUndefined();
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("selects an adopted native view and exposes child-only close", async () => {
    const f = fixture();
    function Shell() {
      return (
        <OriginPopupTabs
          popups={useOriginBrowserPopups(f.options)}
          parentTitle="Source website"
        />
      );
    }
    render(<Shell />);
    await act(async () => {});
    expect(screen.queryByRole("tablist")).toBeNull();
    act(() => f.emit([child("popup-1", { disposition: "background" })]));
    const tab = await screen.findByRole("tab", { name: "Child website" });
    await waitFor(() => expect(tab).toBeEnabled());
    fireEvent.click(tab);
    expect(tab).toHaveAttribute("aria-selected", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Close Child website" }),
    );
    await waitFor(() => expect(f.transport.close).toHaveBeenCalledOnce());
    expect(screen.getByRole("tab", { name: "Source website" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Close Source website" }),
    ).toBeNull();
  });

  it("rejects malformed, duplicate, oversized and unsafe native inventory data", () => {
    const f = fixture();
    for (const bad of [
      { sequence: -1 },
      { sequence: Number.MAX_SAFE_INTEGER + 1 },
      { sourceClosed: "false" },
      { views: [child(), child()] },
      { views: [child("bad id")] },
      { views: [child("popup-1", { title: "x".repeat(513) })] },
      { views: [child("popup-1", { title: "bad\u202etitle" })] },
      { views: Array.from({ length: 17 }, (_, i) => child(`popup-${i}`)) },
      { views: [{ ...child(), phase: "pending" }] },
    ])
      expect(
        readPopupInventory({ ...f.inventory(), ...bad }, source()),
      ).toBeNull();
  });
});
