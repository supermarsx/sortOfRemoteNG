import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DetachedClient from "../../app/detached/DetachedClient";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "sessionId" ? "s1" : null),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../src/i18n", () => ({
  default: {},
}));

vi.mock("../../src/components/session/SessionViewer", () => ({
  SessionViewer: () => (
    <div data-testid="mock-session-viewer">Session Viewer</div>
  ),
}));

vi.mock("../../src/hooks/window/useTooltipSystem", () => ({
  useTooltipSystem: vi.fn(),
}));

let closeRequestedHandler:
  | ((event: { preventDefault: () => void }) => Promise<void>)
  | undefined;
let closeResultHandler:
  | ((event: {
      payload: { requestId: string; sessionId: string; success: boolean };
    }) => void)
  | undefined;
let mainSessionClosedHandler:
  | ((event: { payload: { sessionId: string } }) => void)
  | undefined;
let syncHandler:
  | ((event: {
      payload: {
        windowId: string;
        sessions: unknown[];
        connections: unknown[];
        tabGroups: unknown[];
        activeSessionId: string;
      };
    }) => void)
  | undefined;

const mockWindow = {
  label: "detached-1",
  setTitle: vi.fn(() => Promise.resolve()),
  outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  close: vi.fn(() => Promise.resolve()),
  isAlwaysOnTop: vi.fn(() => Promise.resolve(false)),
  setAlwaysOnTop: vi.fn(() => Promise.resolve()),
  setBackgroundColor: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  isMinimized: vi.fn(() => Promise.resolve(false)),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  maximize: vi.fn(() => Promise.resolve()),
  unmaximize: vi.fn(() => Promise.resolve()),
  onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
  onResized: vi.fn(() => Promise.resolve(() => {})),
  onCloseRequested: vi.fn(
    (handler: (event: { preventDefault: () => void }) => Promise<void>) => {
      closeRequestedHandler = handler;
      return Promise.resolve(() => {});
    },
  ),
};

const syncedSession = {
  id: "s1",
  connectionId: "c1",
  name: "Session One",
  status: "connected",
  startTime: "2026-01-01T00:00:00.000Z",
  protocol: "ssh",
  hostname: "host-1",
  backendSessionId: "backend-detached-1",
  shellId: "shell-detached-1",
  vpnLeaseOwnerId: "owner-detached-1",
  vpnLeaseOwnerIds: ["owner-detached-1"],
  vpnLeaseBindings: [
    {
      ownerId: "owner-detached-1",
      backendSessionId: "backend-detached-1",
      protocol: "ssh",
      status: "active",
    },
  ],
  password: "must-never-be-synced",
};

const syncedConnection = {
  id: "c1",
  name: "Connection One",
  protocol: "ssh",
  hostname: "host-1",
  port: 22,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => mockWindow),
  getAllWindows: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  emitTo: vi.fn(() => Promise.resolve()),
  listen: vi.fn(
    (eventName: string, handler: (event: { payload: unknown }) => void) => {
      if (eventName === "wm:close-result") {
        closeResultHandler = handler as typeof closeResultHandler;
      }
      if (eventName === "main-session-closed") {
        mainSessionClosedHandler = handler as typeof mainSessionClosedHandler;
      }
      if (eventName === "wm:sync") {
        syncHandler = handler as typeof syncHandler;
        queueMicrotask(() => {
          handler({
            payload: {
              windowId: "detached-1",
              sessions: [syncedSession],
              connections: [syncedConnection],
              tabGroups: [],
              activeSessionId: "s1",
            },
          });
        });
      }
      return Promise.resolve(() => {});
    },
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

describe("DetachedClient accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeRequestedHandler = undefined;
    closeResultHandler = undefined;
    mainSessionClosedHandler = undefined;
    syncHandler = undefined;
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as any).__TAURI__;
  });

  const renderAndLoadDetachedClient = async () => {
    render(<DetachedClient />);

    await waitFor(() => {
      expect(
        screen.getByRole("tablist", { name: /detached session tabs/i }),
      ).toBeInTheDocument();
    });
  };

  it("exposes detached tablist/tab semantics and header control labels", async () => {
    await renderAndLoadDetachedClient();

    const tab = screen.getByRole("tab", { name: /session one/i });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveAttribute("aria-controls", "detached-session-panel-s1");

    expect(screen.getByLabelText(/rename window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pin window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimize window/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/toggle maximize window/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/close window/i)).toBeInTheDocument();
  });

  it("adds labels for window title and tab rename inline inputs", async () => {
    await renderAndLoadDetachedClient();

    fireEvent.click(screen.getByLabelText(/rename window/i));
    expect(
      await screen.findByLabelText(/edit window title/i),
    ).toBeInTheDocument();

    const tab = screen.getByRole("tab", { name: /session one/i });
    fireEvent.contextMenu(tab);

    fireEvent.click(
      await screen.findByRole("menuitem", { name: /rename tab/i }),
    );

    expect(
      await screen.findByLabelText(/rename tab session one/i),
    ).toBeInTheDocument();
  });

  it("tab close buttons have descriptive aria-label", async () => {
    await renderAndLoadDetachedClient();

    const closeBtn = screen.getByLabelText(/close session one/i);
    expect(closeBtn).toBeInTheDocument();
    expect(closeBtn.tagName).toBe("BUTTON");
  });

  it("status indicator dots have accessible labels", async () => {
    await renderAndLoadDetachedClient();

    const statusDot = screen.getByRole("status", { name: /connected/i });
    expect(statusDot).toBeInTheDocument();
  });

  it("syncs lifecycle to main and carries it on reattach without secrets", async () => {
    await renderAndLoadDetachedClient();

    await waitFor(() => {
      expect(
        vi
          .mocked(emit)
          .mock.calls.some(
            ([eventName, command]) =>
              eventName === "wm:command" &&
              (command as any).type === "SYNC_SESSION_LIFECYCLE" &&
              (command as any).lifecycle.backendSessionId ===
                "backend-detached-1",
          ),
      ).toBe(true);
    });

    const syncCommand = vi
      .mocked(emit)
      .mock.calls.map(([, command]) => command as any)
      .find((command) => command?.type === "SYNC_SESSION_LIFECYCLE");
    expect(syncCommand.lifecycle).toEqual(
      expect.objectContaining({
        shellId: "shell-detached-1",
        vpnLeaseOwnerId: "owner-detached-1",
        vpnLeaseOwnerIds: ["owner-detached-1"],
      }),
    );
    expect(syncCommand.lifecycle).not.toHaveProperty("password");

    fireEvent.click(screen.getByLabelText(/reattach session one/i));
    await waitFor(() => {
      expect(vi.mocked(emit)).toHaveBeenCalledWith(
        "wm:command",
        expect.objectContaining({
          type: "REATTACH_SESSION",
          sessionId: "s1",
          lifecycle: expect.objectContaining({
            backendSessionId: "backend-detached-1",
            vpnLeaseOwnerId: "owner-detached-1",
          }),
        }),
      );
    });
  });

  it("uses the acknowledged main-window closer without directly closing SSH", async () => {
    (window as any).__TAURI__ = true;
    await renderAndLoadDetachedClient();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: { warnOnDetachClose: false },
        }),
      );
    });
    await waitFor(() => expect(closeRequestedHandler).toBeTypeOf("function"));

    vi.mocked(emit).mockImplementation(async (eventName, payload) => {
      const command = payload as any;
      if (eventName === "wm:command" && command.type === "CLOSE_SESSION") {
        queueMicrotask(() =>
          closeResultHandler?.({
            payload: {
              requestId: command.requestId,
              sessionId: command.sessionId,
              success: true,
            },
          }),
        );
      }
    });

    await act(async () => {
      await closeRequestedHandler!({ preventDefault: vi.fn() });
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "disconnect_ssh",
      expect.anything(),
    );
    expect(emit).toHaveBeenCalledWith(
      "wm:command",
      expect.objectContaining({
        type: "CLOSE_SESSION",
        sessionId: "s1",
        requestId: expect.any(String),
        sourceWindow: "detached-1",
        lifecycle: expect.objectContaining({
          backendSessionId: "backend-detached-1",
          vpnLeaseBindings: syncedSession.vpnLeaseBindings,
        }),
      }),
    );
    expect(mockWindow.close).toHaveBeenCalledOnce();
  });

  it("aborts detached-window close when authoritative main cleanup fails", async () => {
    (window as any).__TAURI__ = true;
    localStorage.setItem("detached-session-s1", "persisted");
    await renderAndLoadDetachedClient();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: { warnOnDetachClose: false },
        }),
      );
    });
    await waitFor(() => expect(closeRequestedHandler).toBeTypeOf("function"));

    vi.mocked(emit).mockImplementation(async (eventName, payload) => {
      const command = payload as any;
      if (eventName === "wm:command" && command.type === "CLOSE_SESSION") {
        queueMicrotask(() =>
          closeResultHandler?.({
            payload: {
              requestId: command.requestId,
              sessionId: command.sessionId,
              success: false,
            },
          }),
        );
      }
    });

    await act(async () => {
      await closeRequestedHandler!({ preventDefault: vi.fn() });
    });

    expect(mockWindow.close).not.toHaveBeenCalled();
    expect(localStorage.getItem("detached-session-s1")).not.toBeNull();
  });

  it("keeps a two-tab detached window open when the second authoritative close fails", async () => {
    const secondSession = {
      ...syncedSession,
      id: "s2",
      name: "Session Two",
      backendSessionId: "backend-detached-2",
      shellId: "shell-detached-2",
      vpnLeaseOwnerId: "owner-detached-2",
      vpnLeaseOwnerIds: ["owner-detached-2"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-detached-2",
          backendSessionId: "backend-detached-2",
          protocol: "ssh",
          status: "active",
        },
      ],
    };
    (window as any).__TAURI__ = true;
    localStorage.setItem("detached-session-s1", "persisted-one");
    localStorage.setItem("detached-session-s2", "persisted-two");
    await renderAndLoadDetachedClient();

    act(() => {
      syncHandler?.({
        payload: {
          windowId: "detached-1",
          sessions: [syncedSession, secondSession],
          connections: [syncedConnection],
          tabGroups: [],
          activeSessionId: "s1",
        },
      });
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: { warnOnDetachClose: false },
        }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /session two/i }),
      ).toBeInTheDocument();
      expect(closeRequestedHandler).toBeTypeOf("function");
    });

    vi.mocked(emit).mockImplementation(async (eventName, payload) => {
      const command = payload as any;
      if (eventName === "wm:command" && command.type === "CLOSE_SESSION") {
        queueMicrotask(() => {
          if (command.sessionId === "s1") {
            mainSessionClosedHandler?.({
              payload: { sessionId: command.sessionId },
            });
          }
          closeResultHandler?.({
            payload: {
              requestId: command.requestId,
              sessionId: command.sessionId,
              success: command.sessionId === "s1",
            },
          });
        });
      }
    });

    await act(async () => {
      await closeRequestedHandler!({ preventDefault: vi.fn() });
    });

    const closeCommands = vi
      .mocked(emit)
      .mock.calls.filter(
        ([eventName, payload]) =>
          eventName === "wm:command" &&
          (payload as { type?: string }).type === "CLOSE_SESSION",
      )
      .map(([, payload]) => payload as { sessionId: string });
    expect(closeCommands.map(({ sessionId }) => sessionId)).toEqual([
      "s1",
      "s2",
    ]);
    expect(mockWindow.close).not.toHaveBeenCalled();
    expect(
      screen.getByRole("tab", { name: /session two/i }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("detached-session-s1")).toBeNull();
    expect(localStorage.getItem("detached-session-s2")).toBe("persisted-two");
  });
});

describe("DetachedClient reconnect banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const disconnectedSession = { ...syncedSession, status: "disconnected" };
    vi.mocked(listen).mockImplementation(((eventName: string, handler: any) => {
      if (eventName === "wm:sync") {
        queueMicrotask(() => {
          handler({
            payload: {
              windowId: "detached-1",
              sessions: [disconnectedSession],
              connections: [syncedConnection],
              tabGroups: [],
              activeSessionId: "s1",
            },
          });
        });
      }
      return Promise.resolve(() => {});
    }) as any);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows reconnect banner when session disconnected", async () => {
    render(<DetachedClient />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry connection/i }),
    ).toBeInTheDocument();
  });

  it("shows error banner when session has error status", async () => {
    const errorSession = { ...syncedSession, status: "error" };
    vi.mocked(listen).mockImplementation(((eventName: string, handler: any) => {
      if (eventName === "wm:sync") {
        queueMicrotask(() => {
          handler({
            payload: {
              windowId: "detached-1",
              sessions: [errorSession],
              connections: [syncedConnection],
              tabGroups: [],
              activeSessionId: "s1",
            },
          });
        });
      }
      return Promise.resolve(() => {});
    }) as any);

    render(<DetachedClient />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText(/connection error occurred/i)).toBeInTheDocument();
  });
});
