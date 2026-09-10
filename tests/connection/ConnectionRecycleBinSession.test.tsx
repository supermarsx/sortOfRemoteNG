import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
const fixture = vi.hoisted(() => ({
  sessions: [] as ConnectionSession[],
  databaseId: "db-a" as string | null,
  activeId: "db-a",
  dispatch: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: fixture.sessions, connections: [] },
    dispatch: fixture.dispatch,
    databaseAvailability: {
      status: fixture.databaseId ? "ready" : "none",
      databaseId: fixture.databaseId ?? undefined,
      generation: 1,
    },
    recycleBin: {
      snapshot: fixture.databaseId
        ? { scope: { databaseId: fixture.databaseId } }
        : null,
    },
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: fixture.activeId, name: "Demo" }),
    }),
  },
}));
vi.mock("../../src/components/connection/ConnectionRecycleBinTab", () => ({
  default: ({ databaseId }: { databaseId: string }) => (
    <section aria-label="Database recycle workspace">{databaseId}</section>
  ),
}));
vi.mock("../../src/components/connection/ConnectionTree", () => ({
  ConnectionTree: () => <div>Tree</div>,
}));
vi.mock("../../src/hooks/connection/useSidebar", () => ({
  useSidebar: () => ({
    state: {
      sidebarCollapsed: false,
      filter: { searchTerm: "", tags: [], colorTags: [], protocols: [] },
    },
    t: (key: string, fallback?: string) => fallback ?? key,
    dispatch: vi.fn(),
    showFilters: false,
    reorderReady: true,
    canChangeReorder: true,
    savingReorder: false,
  }),
}));
import { useConnectionRecycleBinSession } from "../../src/hooks/connection/useConnectionRecycleBinSession";
import {
  createConnectionRecycleBinSession,
  CONNECTION_RECYCLE_BIN_PROTOCOL,
} from "../../src/components/app/toolSession";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
import { Sidebar } from "../../src/components/connection/Sidebar";
beforeEach(() => {
  fixture.sessions = [];
  fixture.databaseId = "db-a";
  fixture.activeId = "db-a";
  fixture.dispatch.mockReset();
});

describe("database recycle-bin tab wiring", () => {
  it("creates one tab per database and deduplicates rapid launches", () => {
    const activate = vi.fn();
    const { result, rerender } = renderHook(() =>
      useConnectionRecycleBinSession(activate),
    );
    act(() => {
      result.current.open();
      result.current.open();
    });
    expect(fixture.dispatch).toHaveBeenCalledOnce();
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        protocol: CONNECTION_RECYCLE_BIN_PROTOCOL,
        connectionRecycleBin: { databaseId: "db-a" },
        id: "connection-recycle-bin-db-a",
      }),
    });
    expect(activate).toHaveBeenCalledTimes(2);
    fixture.databaseId = "db-b";
    fixture.activeId = "db-b";
    rerender();
    act(() => result.current.open());
    expect(fixture.dispatch).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenLastCalledWith("connection-recycle-bin-db-b");
  });
  it("focuses an existing pinned tab without selecting or unlocking its database", () => {
    fixture.sessions = [createConnectionRecycleBinSession("db-a", "Demo")];
    const activate = vi.fn();
    const { result } = renderHook(() =>
      useConnectionRecycleBinSession(activate),
    );
    act(() => result.current.open());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith("connection-recycle-bin-db-a");
  });
  it("does not launch when locked, no host opener, or the active database has drifted", () => {
    const activate = vi.fn();
    fixture.databaseId = null;
    const { result, rerender } = renderHook(() =>
      useConnectionRecycleBinSession(activate),
    );
    expect(result.current.available).toBe(false);
    act(() => result.current.open());
    fixture.databaseId = "db-a";
    fixture.activeId = "db-b";
    rerender();
    act(() => result.current.open());
    expect(activate).not.toHaveBeenCalled();
    const absent = renderHook(() => useConnectionRecycleBinSession());
    expect(absent.result.current.available).toBe(false);
  });
  it("routes the dedicated protocol to the pinned workspace without a redundant close button", async () => {
    render(
      <ToolTabViewer
        session={createConnectionRecycleBinSession("db-a", "Demo")}
        onClose={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("region", { name: "Database recycle workspace" }),
    ).toHaveTextContent("db-a");
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });
  it("connects the actual Sidebar recycle button to the existing session host", () => {
    const activate = vi.fn();
    const noop = () => {};
    const props = {
      sidebarPosition: "left" as const,
      onToggleSidebarPosition: noop,
      onNewConnection: noop,
      onEditConnection: noop,
      onDeleteConnection: noop,
      onConnect: noop,
      onDisconnect: noop,
      onDiagnostics: noop,
      onSessionDetach: noop,
      onShowPasswordDialog: noop,
      onActivateSession: activate,
      enableConnectionReorder: true,
      noCollection: false,
    };
    const view = render(<Sidebar {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open connection recycle bin" }),
    );
    expect(activate).toHaveBeenCalledWith("connection-recycle-bin-db-a");
    fixture.databaseId = null;
    view.rerender(<Sidebar {...props} />);
    expect(
      screen.getByRole("button", { name: "Open connection recycle bin" }),
    ).toBeDisabled();
  });
});
