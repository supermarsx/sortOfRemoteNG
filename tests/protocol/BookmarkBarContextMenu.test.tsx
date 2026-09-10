import React, { useRef, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookmarkBar from "../../src/components/protocol/webBrowser/BookmarkBar";
import type { WebBrowserMgr } from "../../src/components/protocol/webBrowser/types";
import type { HttpBookmarkItem } from "../../src/types/connection/connection";

const actions = vi.hoisted(() => ({
  openLibrary: vi.fn(),
  run: vi.fn(),
  favorite: vi.fn(),
  addFolder: vi.fn(),
  addBookmark: vi.fn(),
  deleteAll: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  moveToFolder: vi.fn(),
  remove: vi.fn(),
  removeFromFolder: vi.fn(),
  navigate: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: actions.invoke }));

const bookmarks: HttpBookmarkItem[] = [
  { name: "Home page", path: "/" },
  {
    name: "Admin folder",
    isFolder: true,
    children: [{ name: "Status page", path: "/status" }],
  },
];
type Automation = WebBrowserMgr["automation"];
function Fixture({
  items = [],
  automation: overrides = {},
}: {
  items?: HttpBookmarkItem[];
  automation?: Partial<Automation>;
}) {
  const [bmContextMenu, setBmContextMenu] =
    useState<WebBrowserMgr["bmContextMenu"]>(null);
  const [bmBarContextMenu, setBmBarContextMenu] =
    useState<WebBrowserMgr["bmBarContextMenu"]>(null);
  const [openFolders, setOpenFolders] = useState(new Set<number>());
  const [editingBmIdx, setEditingBmIdx] = useState<number | null>(null);
  const [editBmName, setEditBmName] = useState("");
  const editBmRef = useRef<HTMLInputElement>(null);
  const folderButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const automation = {
    permissions: {
      showActionBar: true,
      interactionMacrosEnabled: false,
      scriptInjectionEnabled: false,
    },
    recording: false,
    recordingPending: false,
    recordingScopeKey: "fixture-owner:1",
    canEnableMacroRecording: false,
    recordingUnavailableReason: null,
    pageReady: false,
    libraryReady: true,
    busy: false,
    saving: false,
    steps: [],
    favorites: [],
    open: false,
    error: null,
    pendingRun: null,
    valuePrompt: null,
    setOpen: vi.fn(),
    setPendingRun: vi.fn(),
    openLibrary: actions.openLibrary,
    requestRun: actions.run,
    favorite: actions.favorite,
    ...overrides,
  } as Automation;
  const mgr = {
    connection: { httpBookmarks: items },
    automation,
    bmContextMenu,
    setBmContextMenu,
    bmBarContextMenu,
    setBmBarContextMenu,
    openFolders,
    setOpenFolders,
    editingBmIdx,
    setEditingBmIdx,
    editBmName,
    setEditBmName,
    editBmRef,
    folderButtonRefs,
    currentPath: "/",
    buildTargetUrl: () => "https://fixture.test",
    closeFolderDropdown: (idx: number) =>
      setOpenFolders((previous) => {
        const next = new Set(previous);
        next.delete(idx);
        return next;
      }),
    handleAddFolder: actions.addFolder,
    handleAddBookmark: actions.addBookmark,
    handleDeleteAllBookmarks: actions.deleteAll,
    handleRenameBookmark: actions.rename,
    handleMoveBookmark: actions.move,
    handleMoveToFolder: actions.moveToFolder,
    handleRemoveBookmark: actions.remove,
    handleRemoveFromFolder: actions.removeFromFolder,
    navigateToUrl: actions.navigate,
    handleDragStart: () => vi.fn(),
    handleDragOver: () => vi.fn(),
    handleDrop: () => vi.fn(),
    handleDragEnd: vi.fn(),
  } as unknown as WebBrowserMgr;
  return <BookmarkBar mgr={mgr} />;
}
const barMenu = () => screen.getByTestId("web-browser-bookmark-bar-menu");
const itemMenu = () => screen.getByTestId("web-browser-bookmark-menu");
const openBar = () =>
  fireEvent.contextMenu(screen.getByTestId("web-bookmark-bar"), {
    clientX: 30,
    clientY: 40,
  });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("HTTP bookmarks and automation bar context menus", () => {
  it.each(["bar", "scroll", "placeholder", "icon", "svg path"])(
    "opens the bar menu from its noninteractive %s without running anything",
    (target) => {
      render(<Fixture />);
      const scroll = screen.getByTestId("web-bookmark-scroll");
      const element =
        target === "bar"
          ? screen.getByTestId("web-bookmark-bar")
          : target === "scroll"
            ? scroll
            : target === "placeholder"
              ? screen.getByText(/Right-click here/)
              : scroll.querySelector(target === "icon" ? "svg" : "svg path")!;
      expect(fireEvent.contextMenu(element, { clientX: 30, clientY: 40 })).toBe(
        false,
      );
      expect(barMenu()).toBeInTheDocument();
      expect(actions.run).not.toHaveBeenCalled();
      expect(actions.invoke).not.toHaveBeenCalled();
      expect(actions.favorite).not.toHaveBeenCalled();
    },
  );

  it.each(["ContextMenu", "F10"])(
    "supports focused-bar keyboard access with %s",
    (key) => {
      render(<Fixture />);
      const bar = screen.getByRole("group", {
        name: "Bookmarks, scripts and macros",
      });
      bar.focus();
      fireEvent.keyDown(bar, { key, shiftKey: key === "F10" });
      expect(barMenu()).toBeInTheDocument();
      fireEvent.keyDown(barMenu(), { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(bar).toHaveFocus();
    },
  );

  it.each([
    ["New folder", "addFolder"],
    ["Bookmark this page", "addBookmark"],
    ["Delete all bookmarks", "deleteAll"],
  ] as const)("routes %s to the existing bookmark action", (label, action) => {
    render(<Fixture items={bookmarks} />);
    openBar();
    fireEvent.click(within(barMenu()).getByText(label));
    expect(actions[action]).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it.each([
    ["Assign script", "script"],
    ["Assign macro", "macro"],
    ["Manage scripts & macros", undefined],
  ] as const)("%s opens the protected library only", (label, kind) => {
    render(<Fixture />);
    openBar();
    fireEvent.click(within(barMenu()).getByText(label));
    expect(actions.openLibrary).toHaveBeenCalledExactlyOnceWith(kind);
    expect(actions.favorite).not.toHaveBeenCalled();
    expect(actions.run).not.toHaveBeenCalled();
    expect(actions.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it.each([
    { libraryReady: false },
    { busy: true },
    { recording: true },
    { recordingPending: true },
  ])("disables protected actions when unavailable: %o", (automation) => {
    render(<Fixture automation={automation} />);
    openBar();
    for (const label of [
      "Assign script",
      "Assign macro",
      "Manage scripts & macros",
    ]) {
      const button = within(barMenu()).getByText(label).closest("button")!;
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(actions.openLibrary).not.toHaveBeenCalled();
  });

  it("preserves input and library-control context menus", () => {
    render(<Fixture items={bookmarks} />);
    const library = screen.getByRole("button", {
      name: "Website macros & JavaScript library",
    });
    expect(fireEvent.contextMenu(library.querySelector("svg")!)).toBe(true);
    fireEvent.keyDown(library, { key: "F10", shiftKey: true });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Home page" }));
    fireEvent.click(within(itemMenu()).getByText("Rename"));
    const input = screen.getByRole("textbox", { name: "Bookmark name" });
    expect(fireEvent.contextMenu(input)).toBe(true);
    fireEvent.keyDown(input, { key: "ContextMenu" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps bookmark item actions and portal targets out of the bar menu", () => {
    render(<Fixture items={bookmarks} />);
    openBar();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Home page" }).querySelector("svg")!,
    );
    expect(screen.queryByTestId("web-browser-bookmark-bar-menu")).toBeNull();
    const menu = itemMenu();
    fireEvent.contextMenu(menu.querySelector("svg")!);
    expect(screen.queryByTestId("web-browser-bookmark-bar-menu")).toBeNull();
    fireEvent.click(within(menu).getByText("Move to Admin folder"));
    expect(actions.moveToFolder).toHaveBeenCalledExactlyOnceWith(0, 1);
  });

  it("offers keyboard item/folder menus and a working folder rename editor", () => {
    render(<Fixture items={bookmarks} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Home page" }), {
      key: "ContextMenu",
    });
    expect(within(itemMenu()).getByText("Copy URL")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Admin folder" }), {
      key: "F10",
      shiftKey: true,
    });
    expect(within(itemMenu()).queryByText("Copy URL")).toBeNull();
    fireEvent.click(within(itemMenu()).getByText("Rename"));
    const input = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(input, { target: { value: "Renamed folder" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(actions.rename).toHaveBeenCalledWith(1, "Renamed folder");
  });

  it("closes folder popovers for child context actions and does not claim portal background", () => {
    render(<Fixture items={bookmarks} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin folder" }));
    const popover = screen.getByTestId("web-browser-folder-popover-1");
    fireEvent.contextMenu(popover);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByText("Status page"), { key: "ContextMenu" });
    expect(screen.queryByTestId("web-browser-folder-popover-1")).toBeNull();
    fireEvent.click(within(itemMenu()).getByText("Remove from folder"));
    expect(actions.removeFromFolder).toHaveBeenCalledExactlyOnceWith(1, 0);
  });

  it("dismisses favorite and bookmark menus mutually without executing a favorite", () => {
    render(
      <Fixture
        items={bookmarks}
        automation={{
          favorites: [
            {
              kind: "script",
              id: "fixture-script",
              name: "Saved script",
              scope: { kind: "app" },
            },
          ] as Automation["favorites"],
        }}
      />,
    );
    openBar();
    fireEvent.contextMenu(screen.getByText("Saved script"));
    expect(screen.queryByTestId("web-browser-bookmark-bar-menu")).toBeNull();
    expect(
      screen.getByTestId("web-automation-favorite-menu"),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Home page" }), {
      key: "ContextMenu",
    });
    expect(itemMenu()).toBeInTheDocument();
    expect(screen.queryByTestId("web-automation-favorite-menu")).toBeNull();
    expect(actions.run).not.toHaveBeenCalled();
    expect(actions.favorite).not.toHaveBeenCalled();
  });
});
