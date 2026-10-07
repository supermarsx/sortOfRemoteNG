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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
  HttpBookmarkItem,
} from "../../src/types/connection/connection";

const f = vi.hoisted(() => ({
  context: {} as any,
  locked: false,
  lease: vi.fn(),
  invoke: vi.fn(),
  clipboard: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke }));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => f.context,
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: () => f.lease,
}));
import OriginBookmarkBar from "../../src/components/protocol/webBrowser/OriginBookmarkBar";
import {
  changeOriginBookmarks,
  cloneOriginBookmarks,
  useOriginBookmarks,
} from "../../src/hooks/protocol/useOriginBookmarks";

const session = {
  id: "tab",
  connectionId: "connection",
  ownerDatabaseId: "database",
} as ConnectionSession;
const connection = {
  id: "connection",
  name: "Saved",
  hostname: "fixture.invalid",
  httpBookmarks: [],
} as unknown as Connection;
const link = (name: string): HttpBookmarkItem => ({ name, path: `/${name}` });
const folder = (
  name: string,
  children: HttpBookmarkItem[] = [],
): HttpBookmarkItem => ({ name, isFolder: true, children });
const owner = () => {
  if (f.locked) throw new Error("Owner unavailable");
};
const props = () => ({
  session,
  bookmarks: f.context.state.connections[0].httpBookmarks,
  initialUrl: "https://fixture.invalid/login",
  currentUrl: "https://fixture.invalid/page?token=secret#fragment",
  currentTitle: "Current title",
  eligible: true,
  canNavigate: true,
  assertOwner: owner,
  hideNative: vi.fn(),
  onOverlayChange: vi.fn(),
  onNavigate: vi.fn(),
});
beforeEach(() => {
  f.invoke.mockResolvedValue(undefined);
  f.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: f.clipboard },
  });
  f.locked = false;
  f.lease.mockImplementation(owner);
  f.context = {
    databaseAvailability: {
      status: "ready",
      databaseId: "database",
      generation: 1,
    },
    state: { connections: [{ ...connection }] },
    getCurrentConnections: vi.fn(() => f.context.state.connections),
    dispatchAndFlush: vi.fn(async ({ payload }) => {
      f.context.state.connections = [payload];
    }),
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const manage = () =>
  fireEvent.click(screen.getByRole("button", { name: "Manage bookmarks" }));
const menu = (name: string) =>
  fireEvent.click(screen.getByRole("menuitem", { name }));
const input = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), {
    target: { value },
  });
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));

describe("native bookmark tree editing", () => {
  it("moves across shifted sibling paths without losing metadata or children", () => {
    const original = [link("first"), folder("target", [link("child")])];
    expect(
      changeOriginBookmarks(original, { kind: "move", path: [0], parent: [1] }),
    ).toEqual([folder("target", [link("child"), link("first")])]);
    expect(original).toEqual([
      link("first"),
      folder("target", [link("child")]),
    ]);
  });
  it("renames a folder while retaining descendants and original metadata", () => {
    const original = [{ ...folder("old", [link("child")]), id: "old-id" }];
    expect(
      changeOriginBookmarks(original, {
        kind: "save",
        path: [0],
        parent: [],
        item: folder("new"),
      }),
    ).toEqual([{ ...folder("new", [link("child")]), id: "old-id" }]);
  });
  it("reorders and removes nested items and moves them back to the bar", () => {
    const original = [folder("tools", [link("a"), link("b")])];
    expect(
      changeOriginBookmarks(original, {
        kind: "move",
        path: [0, 0],
        parent: [0],
        before: 2,
      }),
    ).toEqual([folder("tools", [link("b"), link("a")])]);
    expect(
      changeOriginBookmarks(original, { kind: "remove", path: [0, 0] }),
    ).toEqual([folder("tools", [link("b")])]);
    expect(
      changeOriginBookmarks(original, {
        kind: "move",
        path: [0, 0],
        parent: [],
      }),
    ).toEqual([folder("tools", [link("b")]), link("a")]);
  });
  it("rejects cycles, nonexistent destinations and invalid indices", () => {
    const tree = [folder("a", [folder("b")])];
    for (const parent of [[0], [0, 0], [4]])
      expect(() =>
        changeOriginBookmarks(tree, { kind: "move", path: [0], parent }),
      ).toThrow();
    expect(() =>
      changeOriginBookmarks(tree, { kind: "remove", path: [-1] }),
    ).toThrow();
  });
  it("rejects malformed/oversized trees rather than silently truncating on save", () => {
    expect(() =>
      cloneOriginBookmarks([{ name: "bad", isFolder: true, children: null }]),
    ).toThrow();
    expect(() =>
      cloneOriginBookmarks(Array.from({ length: 1025 }, () => link("a"))),
    ).toThrow();
    const circular: any = { name: "cycle", isFolder: true, children: [] };
    circular.children.push(circular);
    expect(() => cloneOriginBookmarks([circular])).toThrow();
  });
});

describe("native bookmark owner transactions", () => {
  it("never revives a review after becoming ineligible and eligible again", async () => {
    let eligible = true;
    const hook = renderHook(() => useOriginBookmarks(session, eligible, owner));
    const review = hook.result.current();
    eligible = false;
    hook.rerender();
    eligible = true;
    hook.rerender();
    await expect(review.commit({ kind: "clear" })).rejects.toThrow();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    await hook.result
      .current()
      .commit({ kind: "save", parent: [], item: link("fresh") });
    expect(f.context.dispatchAndFlush).toHaveBeenCalledTimes(1);
  });
  it("saves only bookmarks and preserves authoritative unrelated fields", async () => {
    const { result } = renderHook(() =>
      useOriginBookmarks(session, true, owner),
    );
    const review = result.current();
    f.context.state.connections[0] = { ...connection, name: "Other edit" };
    await review.commit({ kind: "save", parent: [], item: link("new") });
    expect(f.context.state.connections[0]).toMatchObject({
      name: "Other edit",
      httpBookmarks: [link("new")],
    });
    await expect(review.commit({ kind: "clear" })).rejects.toThrow();
    expect(f.context.dispatchAndFlush).toHaveBeenCalledTimes(1);
  });
  it.each([
    "lock",
    "generation",
    "database",
    "duplicate",
    "removed",
    "bookmarks",
    "inactive",
    "unmount",
  ])("rejects a stale %s review before dispatch", async (change) => {
    let eligible = true;
    const hook = renderHook(() => useOriginBookmarks(session, eligible, owner));
    const review = hook.result.current();
    if (change === "lock") f.locked = true;
    if (change === "generation")
      f.context = {
        ...f.context,
        databaseAvailability: {
          ...f.context.databaseAvailability,
          generation: 2,
        },
      };
    if (change === "database")
      f.context = {
        ...f.context,
        databaseAvailability: {
          ...f.context.databaseAvailability,
          databaseId: "other",
        },
      };
    if (change === "duplicate")
      f.context.state.connections.push({ ...connection });
    if (change === "removed") f.context.state.connections = [];
    if (change === "bookmarks")
      f.context.state.connections[0] = {
        ...connection,
        httpBookmarks: [link("concurrent")],
      };
    if (change === "inactive") eligible = false;
    if (change === "unmount") hook.unmount();
    else hook.rerender();
    await expect(
      review.commit({ kind: "save", parent: [], item: link("late") }),
    ).rejects.toThrow();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("does not report success after owner loss during persistence", async () => {
    let finish!: () => void;
    f.context.dispatchAndFlush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(() => useOriginBookmarks(session, true, owner));
    const saving = hook.result.current().commit({ kind: "clear" });
    f.locked = true;
    finish();
    await expect(saving).rejects.toThrow();
  });
});

describe("native bookmark themed review UI", () => {
  it("leaves embedded input context menus and drops with the owning control", () => {
    f.context.state.connections[0].httpBookmarks = [link("one")];
    render(
      <OriginBookmarkBar
        {...props()}
        automationSlot={<input aria-label="Automation input" />}
      />,
    );
    const control = screen.getByRole("textbox", { name: "Automation input" });
    fireEvent.contextMenu(control);
    expect(screen.queryByRole("menu")).toBeNull();
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(screen.getByRole("button", { name: "one" }), {
      dataTransfer,
    });
    fireEvent.drop(control, { dataTransfer });
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    fireEvent.dragEnd(screen.getByRole("button", { name: "one" }));
    fireEvent.keyDown(
      screen.getByRole("group", { name: "Saved website bookmarks" }),
      { key: "F10", shiftKey: true },
    );
    expect(
      screen.getByRole("menu", { name: "Bookmark actions" }),
    ).toBeInTheDocument();
  });
  it("uses shared themed menus, dialogs, inputs and folder selector without native titles", () => {
    const view = render(<OriginBookmarkBar {...props()} />);
    expect(
      screen.getByRole("button", { name: "Manage bookmarks" }),
    ).toHaveClass("sor-btn", "sor-icon-btn-sm");
    expect(view.container.querySelector("[title]")).toBeNull();
    manage();
    for (const item of screen.getAllByRole("menuitem"))
      expect(item).toHaveClass("sor-menu-item");
    menu("Add bookmark");
    expect(screen.getByRole("dialog")).toHaveClass("sor-modal-panel");
    expect(screen.getByRole("textbox", { name: "Bookmark name" })).toHaveClass(
      "sor-form-input",
    );
    expect(
      screen.getByRole("combobox", { name: "Bookmark folder" }),
    ).toHaveClass("sor-form-select");
    expect(document.querySelector("select")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save bookmark" }),
    ).toBeDisabled();
  });
  it.each(["owner", "bookmarks"])(
    "rejects external confirmation after %s changes",
    async (reason) => {
      f.context.state.connections[0].httpBookmarks = [link("saved")];
      render(<OriginBookmarkBar {...props()} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: "saved" }));
      menu("Open externally…");
      if (reason === "owner") f.locked = true;
      else f.context.state.connections[0].httpBookmarks = [link("different")];
      fireEvent.click(
        screen.getByRole("button", { name: "Open in system browser" }),
      );
      await waitFor(() =>
        expect(
          screen.getByText(/No fallback was attempted/),
        ).toBeInTheDocument(),
      );
      expect(f.invoke).not.toHaveBeenCalled();
    },
  );
  it("does not leak late clipboard completion into a reopened owner scope", async () => {
    let complete!: () => void;
    f.clipboard.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    f.context.state.connections[0].httpBookmarks = [link("saved")];
    const p = props();
    const view = render(<OriginBookmarkBar {...p} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "saved" }));
    menu("Copy URL");
    view.rerender(<OriginBookmarkBar {...p} eligible={false} />);
    view.rerender(<OriginBookmarkBar {...p} />);
    await act(async () => {
      complete();
    });
    fireEvent.contextMenu(screen.getByRole("button", { name: "saved" }));
    expect(screen.queryByText(/URL copied/)).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Copy URL" })).toBeEnabled();
  });
  it("does not open a new URL review after an unreported owner lock", () => {
    f.context.state.connections[0].httpBookmarks = [link("saved")];
    render(<OriginBookmarkBar {...props()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "saved" }));
    f.locked = true;
    menu("Open externally…");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("copies only on request and reviews external opening without direct fallback", async () => {
    f.context.state.connections[0].httpBookmarks = [link("saved")];
    render(<OriginBookmarkBar {...props()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "saved" }));
    expect(f.clipboard).not.toHaveBeenCalled();
    menu("Copy URL");
    await waitFor(() =>
      expect(screen.getByText(/URL copied/)).toBeInTheDocument(),
    );
    expect(f.clipboard).toHaveBeenCalledWith("https://fixture.invalid/saved");
    menu("Open externally…");
    expect(screen.getByText(/outside the app proxy/)).toBeInTheDocument();
    expect(f.invoke).not.toHaveBeenCalled();
    f.invoke.mockRejectedValueOnce(new Error("sensitive native failure"));
    fireEvent.click(
      screen.getByRole("button", { name: "Open in system browser" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/No fallback was attempted/)).toBeInTheDocument(),
    );
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith("open_url_external", {
      url: "https://fixture.invalid/saved",
    });
    expect(screen.queryByText(/sensitive native failure/)).toBeNull();
  });
  it("fences stale rendered bookmark clicks before capturing a new review", () => {
    f.context.state.connections[0].httpBookmarks = [link("old")];
    const p = props();
    render(<OriginBookmarkBar {...p} />);
    f.context.state.connections[0] = {
      ...connection,
      httpBookmarks: [link("new")],
    };
    fireEvent.click(screen.getByRole("button", { name: "old" }));
    expect(p.onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bookmarks cannot be changed",
    );
  });
  it("supports owner-fenced drag into a folder without exporting a URL", async () => {
    f.context.state.connections[0].httpBookmarks = [
      link("one"),
      folder("Tools"),
    ];
    render(<OriginBookmarkBar {...props()} />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(screen.getByRole("button", { name: "one" }), {
      dataTransfer,
    });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-sorng-native-bookmark",
      "move",
    );
    fireEvent.drop(screen.getByRole("button", { name: "Tools" }), {
      dataTransfer,
    });
    await waitFor(() =>
      expect(f.context.dispatchAndFlush).toHaveBeenCalledTimes(1),
    );
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      folder("Tools", [link("one")]),
    ]);
  });
  it("adds the current page only after explicit URL review and hides native first", async () => {
    const p = props();
    render(<OriginBookmarkBar {...p} />);
    manage();
    expect(p.hideNative).toHaveBeenCalled();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(true);
    menu("Bookmark this page");
    expect(
      screen.getByRole("textbox", { name: "Bookmark URL or path" }),
    ).toHaveValue(p.currentUrl);
    expect(
      screen.getByText(/remove sensitive tokens before saving/),
    ).toBeInTheDocument();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    input("Bookmark URL or path", "/page#safe");
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      { name: "Current title", path: "/page#safe" },
    ]);
    expect(JSON.stringify(f.context.dispatchAndFlush.mock.calls)).not.toContain(
      "secret",
    );
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
  });
  it("edits folder children and moves bookmarks with the shared themed Select", async () => {
    f.context.state.connections[0].httpBookmarks = [
      folder("Tools", [link("child")]),
    ];
    const p = props();
    render(<OriginBookmarkBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    menu("Actions for child");
    menu("Edit bookmark");
    input("Bookmark name", "Edited");
    fireEvent.click(screen.getByRole("combobox", { name: "Bookmark folder" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Bookmarks bar" }));
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      folder("Tools"),
      { name: "Edited", path: "/child" },
    ]);
  });
  it("creates empty folders and confirms deletion of a folder with descendants", async () => {
    render(<OriginBookmarkBar {...props()} />);
    manage();
    menu("New folder");
    input("Bookmark name", "Tools");
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      folder("Tools"),
    ]);
    cleanup();
    f.context.state.connections[0].httpBookmarks = [
      folder("Tools", [link("child")]),
    ];
    render(<OriginBookmarkBar {...props()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tools" }));
    menu("Delete");
    expect(screen.getByText(/and all its bookmarks/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      folder("Tools", [link("child")]),
    ]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tools" }));
    menu("Delete");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.context.state.connections[0].httpBookmarks).toEqual([]);
  });
  it("keeps broken links repairable through Organize, without enabling navigation", () => {
    f.context.state.connections[0].httpBookmarks = [
      { name: "Bad", path: "javascript:bad" },
    ];
    render(<OriginBookmarkBar {...props()} />);
    expect(screen.getByRole("button", { name: "Bad" })).toBeDisabled();
    manage();
    menu("Organize bookmarks");
    menu("Actions for Bad");
    menu("Edit bookmark");
    expect(
      screen.getByRole("button", { name: "Save bookmark" }),
    ).toBeDisabled();
    input("Bookmark URL or path", "https://user:password@fixture.invalid/");
    expect(
      screen.getByRole("button", { name: "Save bookmark" }),
    ).toBeDisabled();
    input("Bookmark URL or path", "/valid");
    expect(screen.getByRole("button", { name: "Save bookmark" })).toBeEnabled();
  });
  it("rejects a revoked owner on Save with static errors and no writes", async () => {
    render(<OriginBookmarkBar {...props()} />);
    manage();
    menu("Bookmark this page");
    f.locked = true;
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save"),
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("closes menus on owner loss and cannot use their old navigation callbacks", () => {
    f.context.state.connections[0].httpBookmarks = [
      folder("Tools", [link("child")]),
    ];
    const p = props();
    const view = render(<OriginBookmarkBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const old = screen.getByRole("menuitem", { name: "child" });
    view.rerender(<OriginBookmarkBar {...p} eligible={false} />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(old);
    expect(p.onNavigate).not.toHaveBeenCalled();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
  });
  it("keeps a pending save single-flight and fences completion after unmount", async () => {
    let finish!: () => void;
    f.context.dispatchAndFlush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const p = props();
    const view = render(<OriginBookmarkBar {...p} />);
    manage();
    menu("Bookmark this page");
    save();
    save();
    expect(f.context.dispatchAndFlush).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    view.unmount();
    p.onOverlayChange.mockClear();
    await act(async () => {
      finish();
    });
    expect(p.onOverlayChange).not.toHaveBeenCalled();
  });
});
