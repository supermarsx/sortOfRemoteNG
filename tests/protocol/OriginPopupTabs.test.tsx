import React from "react";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OriginPopupTabs from "../../src/components/protocol/webBrowser/OriginPopupTabs";
import {
  useOriginBrowserPopups,
  type OriginBrowserPopups,
} from "../../src/hooks/protocol/useOriginBrowserPopups";
import type { OriginBrowserIdentity } from "../../src/types/protocols/originBrowser";
import type {
  OriginPopupInventory,
  OriginPopupTransport,
  OriginPopupView,
} from "../../src/types/protocols/originBrowserPopups";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const identity: OriginBrowserIdentity = {
  ownerDatabaseId: "quick-connect:owner",
  connectionId: "connection",
  sessionId: "owner",
  attemptId: "attempt-1",
};
const child = (
  viewId: string,
  patch: Partial<OriginPopupView> = {},
): OriginPopupView => ({
  viewId,
  title: viewId.toUpperCase(),
  disposition: "background",
  phase: "adopted",
  ...patch,
});

async function mountTabs(initialViews = [child("a"), child("b"), child("c")]) {
  let listener: (inventory: unknown) => void = () => {};
  let sequence = 0;
  let views: readonly OriginPopupView[] = initialViews;
  let sourceIdentity = identity;
  let popups!: OriginBrowserPopups;
  const inventory = (): OriginPopupInventory => ({
    sourceIdentity,
    sequence,
    views,
    sourceClosed: false,
  });
  const off = vi.fn();
  const transport = {
    subscribe: vi.fn<OriginPopupTransport["subscribe"]>(async (_, receive) => {
      listener = receive;
      return off;
    }),
    list: vi.fn<OriginPopupTransport["list"]>(async () => inventory()),
    adopt: vi.fn<OriginPopupTransport["adopt"]>(async ({ viewId }) => {
      sequence++;
      views = views.map((view) =>
        view.viewId === viewId ? { ...view, phase: "adopted" } : view,
      );
      return inventory();
    }),
    close: vi.fn<OriginPopupTransport["close"]>(async () => {}),
  };
  const onActivate = vi.fn();
  const assertOwner = vi.fn();
  function Shell({ show = true }: { show?: boolean }) {
    popups = useOriginBrowserPopups({
      sourceIdentity,
      enabled: true,
      transport,
      assertOwner,
      onActivate,
    });
    return show ? (
      <OriginPopupTabs popups={popups} parentTitle="Owner" />
    ) : null;
  }
  const shell = render(<Shell />);
  await act(async () => {});
  return {
    transport,
    onActivate,
    assertOwner,
    off,
    get popups() {
      return popups;
    },
    inventory,
    emit(next: readonly OriginPopupView[]) {
      views = next;
      sequence++;
      act(() => listener(inventory()));
    },
    deliver(payload: unknown) {
      act(() => listener(payload));
    },
    showStrip(show: boolean) {
      shell.rerender(<Shell show={show} />);
    },
    async replaceSource() {
      sourceIdentity = { ...identity, attemptId: "attempt-2" };
      sequence = 0;
      views = initialViews;
      shell.rerender(<Shell />);
      await act(async () => {});
    },
  };
}

const tab = (name: string) => screen.getByRole("tab", { name });
const tabNames = () =>
  screen.getAllByRole("tab").map((node) => node.textContent);
const ids = (f: Awaited<ReturnType<typeof mountTabs>>) =>
  f.popups.tabs.map((view) => view.viewId);
const auxClick = (node: Element, button = 1) =>
  fireEvent(
    node,
    new MouseEvent("auxclick", { bubbles: true, cancelable: true, button }),
  );

function drag(from: string, to: string, placement: "before" | "after") {
  const source = tab(from).parentElement!;
  const target = tab(to).parentElement!;
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    left: 100,
    width: 100,
  } as DOMRect);
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(source, { dataTransfer });
  // jsdom has no DragEvent constructor, so provide the pointer coordinate.
  for (const type of ["dragOver", "drop"] as const) {
    const event = createEvent[type](target, { dataTransfer });
    Object.defineProperty(event, "clientX", {
      value: placement === "before" ? 110 : 190,
    });
    fireEvent(target, event);
    if (type === "dragOver")
      expect(target).toHaveAttribute("data-drop", placement);
  }
  fireEvent.dragEnd(source, { dataTransfer });
  return dataTransfer;
}

describe("native popup tab UI and ordering", () => {
  it("shows selected, opening and closing states, accessible close buttons, and a fixed owner", async () => {
    const f = await mountTabs();
    expect(tab("Owner")).toHaveAttribute("aria-selected", "true");
    expect(tab("Owner").parentElement).toHaveAttribute("data-active", "true");
    expect(tab("Owner").parentElement).not.toHaveAttribute("draggable", "true");
    expect(screen.queryByRole("button", { name: "Close Owner" })).toBeNull();
    expect(tab("A").parentElement).toHaveAttribute("draggable", "true");
    expect(screen.getByRole("button", { name: "Close A" })).toBeEnabled();
    fireEvent.click(tab("B"));
    expect(tab("B")).toHaveAttribute("aria-selected", "true");
    expect(tab("B").parentElement).toHaveAttribute("data-active", "true");
    expect(f.onActivate).toHaveBeenLastCalledWith({
      sourceIdentity: identity,
      viewId: "b",
    });

    f.transport.adopt.mockReturnValue(new Promise(() => {}));
    f.emit([
      child("a"),
      child("b"),
      child("opening", { phase: "available" }),
      child("closing", { phase: "closing" }),
    ]);
    expect(tab("OPENING · Opening")).toBeDisabled();
    expect(tab("OPENING · Opening")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Close OPENING" })).toBeEnabled();
    expect(tab("CLOSING · Closing")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close CLOSING" }),
    ).toBeDisabled();
  });

  it("drags before and after other children without replacing DOM nodes or touching native lifecycle", async () => {
    const f = await mountTabs();
    fireEvent.click(tab("B"));
    f.onActivate.mockClear();
    const originalB = tab("B");
    const nativeRows = [...f.popups.tabs];
    expect(drag("C", "A", "before").effectAllowed).toBe("move");
    expect(tabNames()).toEqual(["Owner", "C", "A", "B"]);
    drag("C", "B", "after");
    expect(tabNames()).toEqual(["Owner", "A", "B", "C"]);
    expect(tab("B")).toBe(originalB);
    expect(f.popups.activeViewId).toBe("b");
    f.popups.tabs.forEach((row, index) => expect(row).toBe(nativeRows[index]));
    expect(f.onActivate).not.toHaveBeenCalled();
    expect(f.transport.adopt).not.toHaveBeenCalled();
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.transport.subscribe).toHaveBeenCalledOnce();
    expect(f.transport.list).toHaveBeenCalledOnce();
    expect(f.off).not.toHaveBeenCalled();
  });

  it("retains dragged order through metadata updates, new tabs, removal and strip remount", async () => {
    const f = await mountTabs();
    drag("C", "A", "before");
    f.emit([
      child("b"),
      child("d"),
      child("a", { title: "Renamed" }),
      child("c"),
    ]);
    expect(ids(f)).toEqual(["c", "a", "b", "d"]);
    expect(tabNames()).toEqual(["Owner", "C", "Renamed", "B", "D"]);
    f.emit([child("d"), child("a", { title: "Renamed again" }), child("c")]);
    expect(ids(f)).toEqual(["c", "a", "d"]);
    f.showStrip(false);
    f.showStrip(true);
    expect(tabNames()).toEqual(["Owner", "C", "Renamed again", "D"]);
    expect(f.transport.subscribe).toHaveBeenCalledOnce();
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("preserves order while adoption finishes and ignores stale native inventory", async () => {
    const f = await mountTabs();
    let finish!: (receipt: unknown) => void;
    f.transport.adopt.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    f.emit([
      child("a"),
      child("b"),
      child("c"),
      child("d", { phase: "available" }),
    ]);
    const stale = f.inventory();
    drag("D · Opening", "A", "before");
    await act(async () =>
      finish({
        ...stale,
        sequence: stale.sequence + 1,
        views: [child("a"), child("b"), child("c"), child("d")],
      }),
    );
    expect(ids(f)).toEqual(["d", "a", "b", "c"]);
    expect(tab("D")).toBeEnabled();
    f.deliver(stale);
    expect(ids(f)).toEqual(["d", "a", "b", "c"]);
    expect(f.transport.adopt).toHaveBeenCalledExactlyOnceWith({
      sourceIdentity: identity,
      viewId: "d",
    });
    expect(f.onActivate).not.toHaveBeenCalled();
  });

  it("middle-click closes only a child, deduplicates until native removal, and returns an active child to the owner", async () => {
    const f = await mountTabs();
    fireEvent.click(tab("B"));
    f.onActivate.mockClear();
    const button = tab("B");
    expect(fireEvent.mouseDown(button, { button: 1 })).toBe(false);
    expect(auxClick(button)).toBe(false);
    await act(async () => {});
    expect(tab("Owner")).toHaveAttribute("aria-selected", "true");
    expect(f.onActivate).toHaveBeenCalledExactlyOnceWith(null);
    expect(ids(f)).toEqual(["a", "b", "c"]);
    expect(tab("B · Closing")).toBeDisabled();
    auxClick(button.parentElement!);
    await act(async () => f.popups.close("b"));
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      sourceIdentity: identity,
      viewId: "b",
    });
    f.emit([child("a"), child("c")]);
    expect(ids(f)).toEqual(["a", "c"]);
  });

  it("leaves the owner and right-clicks alone and closes background children without selecting them", async () => {
    const f = await mountTabs();
    fireEvent.click(tab("C"));
    f.onActivate.mockClear();
    fireEvent.mouseDown(tab("Owner"), { button: 1 });
    auxClick(tab("Owner"));
    auxClick(tab("A"), 2);
    expect(f.transport.close).not.toHaveBeenCalled();
    auxClick(screen.getByRole("button", { name: "Close A" }));
    await act(async () => {});
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      sourceIdentity: identity,
      viewId: "a",
    });
    expect(f.onActivate).not.toHaveBeenCalled();
    expect(f.popups.activeViewId).toBe("c");
  });

  it("keeps native close failures retryable via the close button", async () => {
    const f = await mountTabs();
    f.transport.close.mockRejectedValueOnce(
      new Error("private native details"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close A" }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A popup could not be closed. Retry closing it.",
    );
    expect(screen.getByRole("button", { name: "Close A" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Close A" }));
    await act(async () => {});
    expect(f.transport.close).toHaveBeenCalledTimes(2);
  });

  it("uses roving keyboard focus, skips unavailable children, and supports Home and End without native activation", async () => {
    const f = await mountTabs();
    f.transport.adopt.mockReturnValue(new Promise(() => {}));
    f.emit([
      child("a"),
      child("opening", { phase: "available" }),
      child("c"),
      child("closing", { phase: "closing" }),
    ]);
    act(() => tab("Owner").focus());
    fireEvent.keyDown(tab("Owner"), { key: "ArrowRight" });
    expect(tab("A")).toHaveFocus();
    expect(tab("A")).toHaveAttribute("tabindex", "0");
    expect(tab("Owner")).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(tab("A"), { key: "ArrowRight" });
    expect(tab("C")).toHaveFocus();
    fireEvent.keyDown(tab("C"), { key: "ArrowRight" });
    expect(tab("Owner")).toHaveFocus();
    fireEvent.keyDown(tab("Owner"), { key: "End" });
    expect(tab("C")).toHaveFocus();
    fireEvent.keyDown(tab("C"), { key: "Home" });
    expect(tab("Owner")).toHaveFocus();
    fireEvent.keyDown(tab("Owner"), { key: "ArrowLeft" });
    expect(tab("C")).toHaveFocus();
    expect(f.onActivate).not.toHaveBeenCalled();
    expect(tab("C")).toHaveAccessibleDescription(/Alt\+Left/);
  });

  it("reorders by keyboard with stable focus and selection, and Delete closes only children", async () => {
    const f = await mountTabs();
    fireEvent.click(tab("B"));
    act(() => tab("B").focus());
    f.onActivate.mockClear();
    fireEvent.keyDown(tab("B"), { key: "ArrowLeft", altKey: true });
    expect(ids(f)).toEqual(["b", "a", "c"]);
    expect(tab("B")).toHaveFocus();
    expect(tab("B")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("B"), { key: "ArrowLeft", altKey: true });
    expect(ids(f)).toEqual(["b", "a", "c"]);
    fireEvent.keyDown(tab("B"), { key: "ArrowRight", altKey: true });
    expect(ids(f)).toEqual(["a", "b", "c"]);
    expect(tab("B")).toHaveFocus();
    expect(f.onActivate).not.toHaveBeenCalled();
    fireEvent.keyDown(tab("B"), { key: "Delete" });
    await act(async () => {});
    expect(tab("Owner")).toHaveFocus();
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      sourceIdentity: identity,
      viewId: "b",
    });
    fireEvent.keyDown(tab("Owner"), { key: "Delete" });
    expect(f.transport.close).toHaveBeenCalledOnce();
  });

  it("ignores external drops, cancelled drags, and missing or closing targets", async () => {
    const f = await mountTabs();
    const target = tab("B").parentElement!;
    fireEvent.drop(target, { dataTransfer: { getData: () => "a" } });
    const source = tab("A").parentElement!;
    fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragEnd(source);
    fireEvent.drop(target);
    act(() => {
      f.popups.reorder("missing", "b", "before");
      f.popups.reorder("a", "missing", "after");
      f.popups.reorder("a", "a", "after");
    });
    expect(ids(f)).toEqual(["a", "b", "c"]);
    f.emit([child("a"), child("b", { phase: "closing" }), child("c")]);
    act(() => {
      f.popups.reorder("a", "b", "after");
      f.popups.reorder("b", "c", "after");
    });
    expect(ids(f)).toEqual(["a", "b", "c"]);
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.onActivate).not.toHaveBeenCalled();
  });

  it("resets order for a new native source attempt and retains original cleanup identities", async () => {
    const f = await mountTabs();
    drag("C", "A", "before");
    await f.replaceSource();
    expect(ids(f)).toEqual(["a", "b", "c"]);
    expect(f.off).toHaveBeenCalledOnce();
    expect(f.transport.close).toHaveBeenCalledTimes(3);
    expect(
      f.transport.close.mock.calls.map(
        ([reference]) => reference.sourceIdentity,
      ),
    ).toEqual([identity, identity, identity]);
  });

  it("does not reorder or issue native commands when owner authority is no longer current", async () => {
    const f = await mountTabs();
    f.assertOwner.mockImplementation(() => {
      throw new Error("revoked");
    });
    act(() => f.popups.reorder("c", "a", "before"));
    expect(ids(f)).toEqual(["a", "b", "c"]);
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.transport.adopt).not.toHaveBeenCalled();
    expect(f.onActivate).not.toHaveBeenCalled();
  });
});
