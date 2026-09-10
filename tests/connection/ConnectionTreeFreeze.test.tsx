import React, { useEffect, useState } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../src/components/connection/Sidebar";
import SettingsContext, {
  defaultSettings,
} from "../../src/contexts/SettingsContext";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";

// These component fixtures exercise a deliberately available synthetic database.
vi.mock("../../src/contexts/useConnections", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/contexts/useConnections")>();
  return {
    useConnections: () => ({
      ...actual.useConnections(),
      databaseAvailability: {
        status: "ready",
        databaseId: "tree-fixture",
        generation: 1,
      },
    }),
  };
});
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnectionTree } from "../../src/hooks/connection/useConnectionTree";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";

vi.unmock("../../src/contexts/SettingsContext");

const entries: Connection[] = [
  { id: "folder", name: "Folder", isGroup: true, expanded: true, order: 0 },
  { id: "zulu", name: "Zulu", order: 0 },
  { id: "alpha", name: "Alpha", order: 1 },
  { id: "child", name: "Child", parentId: "folder", order: 0 },
].map((entry) => ({
  protocol: "ssh",
  hostname: "fixture.invalid",
  port: 22,
  isGroup: false,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  ...entry,
}));

function Seed() {
  const { state, dispatch } = useConnections();
  useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: entries });
    dispatch({
      type: "SET_FILTER",
      payload: { sortBy: "custom", sortDirection: "asc" },
    });
  }, [dispatch]);
  return (
    <output data-testid="connections-state">
      {JSON.stringify(state.connections)}
    </output>
  );
}

const noop = () => {};
function Fixture({
  initial = true,
  ready = true,
  persist = async () => {},
  connect = noop,
}: {
  initial?: boolean;
  ready?: boolean;
  persist?: (updates: Partial<GlobalSettings>) => Promise<void>;
  connect?: (connection: Connection) => void;
}) {
  const [enabled, setEnabled] = useState(initial);
  return (
    <SettingsContext.Provider
      value={{
        settings: { ...defaultSettings, enableConnectionReorder: enabled },
        settingsReady: ready,
        reloadSettings: async () => {},
        updateSettings: async (updates) => {
          await persist(updates);
          if (updates.enableConnectionReorder !== undefined)
            setEnabled(updates.enableConnectionReorder);
        },
      }}
    >
      <ToastProvider>
        <ConnectionProvider>
          <Seed />
          <Sidebar
            sidebarPosition="left"
            onToggleSidebarPosition={noop}
            onNewConnection={noop}
            onEditConnection={noop}
            onDeleteConnection={noop}
            onConnect={connect}
            onDisconnect={noop}
            onDiagnostics={noop}
            onSessionDetach={noop}
            onShowPasswordDialog={noop}
            noCollection={false}
            enableConnectionReorder={enabled}
          />
        </ConnectionProvider>
      </ToastProvider>
    </SettingsContext.Provider>
  );
}

function row(id: string): HTMLElement {
  return document.querySelector(`[data-connection-id="${id}"]`)!;
}
function positions() {
  return (
    JSON.parse(
      screen.getByTestId("connections-state").textContent!,
    ) as Connection[]
  ).map(({ id, parentId, order }) => ({ id, parentId, order }));
}
function visualOrder() {
  return [
    ...screen.getByRole("tree").querySelectorAll("[data-connection-id]"),
  ].map((element) => element.getAttribute("data-connection-id"));
}
function transfer() {
  return { effectAllowed: "", dropEffect: "", setData: vi.fn() };
}
function drop(target: HTMLElement, dataTransfer = transfer()) {
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    top: 0,
    height: 32,
  } as DOMRect);
  fireEvent(
    target,
    Object.assign(
      new MouseEvent("drop", { bubbles: true, cancelable: true, clientY: 16 }),
      { dataTransfer },
    ),
  );
}
const toggle = () =>
  screen.getByRole("button", { name: "Freeze connection positions" });

describe("connection position freeze", () => {
  it("preserves custom order and cancels an in-flight drag across item and root drops", async () => {
    const persist = vi.fn(async () => {});
    render(<Fixture persist={persist} />);
    await screen.findByText("Zulu");
    const before = positions();
    const order = visualOrder();
    expect(order.indexOf("zulu")).toBeLessThan(order.indexOf("alpha"));
    const dataTransfer = transfer();
    fireEvent.dragStart(row("zulu"), { dataTransfer });
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-busy", "false"));
    expect(persist).toHaveBeenCalledWith({ enableConnectionReorder: false });
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(toggle()).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("Unfreeze positions"),
    );
    expect(row("zulu")).toHaveAttribute("draggable", "false");
    drop(row("folder"), dataTransfer);
    drop(row("alpha"), dataTransfer);
    drop(screen.getByRole("tree"), dataTransfer);
    expect(positions()).toEqual(before);
    expect(visualOrder()).toEqual(order);
    expect(screen.getByRole("tree")).not.toHaveClass("min-h-[100px]");
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(toggle()).toHaveAttribute("aria-pressed", "false"),
    );
    // Thaw does not revive the drag that was cancelled when positions froze.
    drop(row("folder"), dataTransfer);
    expect(positions()).toEqual(before);
    fireEvent.dragStart(row("zulu"), { dataTransfer });
    drop(row("folder"), dataTransfer);
    expect(positions().find((item) => item.id === "zulu")?.parentId).toBe(
      "folder",
    );
  });

  it("blocks nested-to-root moves while retaining selection, open and folder expansion", async () => {
    const connect = vi.fn();
    render(<Fixture connect={connect} />);
    await screen.findByText("Child");
    const dataTransfer = transfer();
    fireEvent.dragStart(row("child"), { dataTransfer });
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-busy", "false"));
    drop(screen.getByRole("tree"), dataTransfer);
    expect(positions().find((item) => item.id === "child")?.parentId).toBe(
      "folder",
    );
    const blockedTransfer = transfer();
    expect(
      fireEvent.dragStart(row("zulu"), { dataTransfer: blockedTransfer }),
    ).toBe(false);
    expect(blockedTransfer.setData).not.toHaveBeenCalled();
    fireEvent.click(row("zulu"));
    expect(row("zulu").closest('[role="treeitem"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.doubleClick(row("zulu"));
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "zulu" }),
    );
    fireEvent.click(row("folder"));
    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    fireEvent.click(row("folder"));
    expect(await screen.findByText("Child")).toBeInTheDocument();
  });

  it("uses the persisted setting on remount and reports a failed save without claiming frozen", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => {
      reject = fail;
    });
    const persist = vi.fn(() => pending);
    const view = render(<Fixture persist={persist} />);
    await screen.findByText("Zulu");
    fireEvent.click(toggle());
    expect(toggle()).toBeDisabled();
    expect(row("zulu")).toHaveAttribute("draggable", "false");
    await act(async () => {
      reject(new Error("synthetic storage refusal"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update the position lock",
    );
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(row("zulu")).toHaveAttribute("draggable", "true");
    let savedEnabled = true;
    persist.mockImplementation(async (updates?: Partial<GlobalSettings>) => {
      savedEnabled = updates?.enableConnectionReorder ?? true;
    });
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-busy", "false"));
    expect(savedEnabled).toBe(false);
    view.unmount();
    render(<Fixture initial={savedEnabled} />);
    await screen.findByText("Zulu");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(row("zulu")).toHaveAttribute("draggable", "false");
  });

  it("does not permit dragging while the saved preference is unresolved", async () => {
    const view = render(<Fixture ready={false} />);
    await screen.findByText("Zulu");
    expect(toggle()).toBeDisabled();
    expect(row("zulu")).toHaveAttribute("draggable", "false");
    const before = positions();
    const dataTransfer = transfer();
    fireEvent.dragStart(row("zulu"), { dataTransfer });
    drop(row("folder"), dataTransfer);
    drop(screen.getByRole("tree"), dataTransfer);
    expect(positions()).toEqual(before);
    view.rerender(<Fixture ready />);
    expect(toggle()).toBeEnabled();
    expect(row("zulu")).toHaveAttribute("draggable", "true");
  });

  it("guards hook-level handlers and clears transient state when frozen", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SettingsContext.Provider
        value={{
          settings: defaultSettings,
          updateSettings: async () => {},
          reloadSettings: async () => {},
        }}
      >
        <ToastProvider>
          <ConnectionProvider>
            <Seed />
            {children}
          </ConnectionProvider>
        </ToastProvider>
      </SettingsContext.Provider>
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useConnectionTree(noop, enabled),
      { wrapper, initialProps: { enabled: true } },
    );
    await waitFor(() =>
      expect(result.current.state.connections.length).toBe(entries.length),
    );
    act(() => result.current.handleItemDragStart("child"));
    act(() => result.current.handleItemDragOver("alpha", "before"));
    const staleDrop = result.current.handleItemDrop;
    const stalePanelDrop = result.current.handlePanelDrop;
    rerender({ enabled: false });
    expect(result.current.draggedId).toBeNull();
    expect(result.current.dragOverId).toBeNull();
    expect(result.current.dropPosition).toBeNull();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: transfer(),
    } as unknown as React.DragEvent;
    act(() => {
      result.current.handleItemDragStart("child");
      result.current.handleItemDragOver("folder", "inside");
      staleDrop("alpha", "before");
      stalePanelDrop(event);
    });
    expect(result.current.draggedId).toBeNull();
    expect(event.dataTransfer.dropEffect).toBe("none");
    rerender({ enabled: true });
    act(() => {
      staleDrop("alpha", "before");
      stalePanelDrop(event);
    });
    expect(
      result.current.state.connections.find((item) => item.id === "child")
        ?.parentId,
    ).toBe("folder");
  });
});
