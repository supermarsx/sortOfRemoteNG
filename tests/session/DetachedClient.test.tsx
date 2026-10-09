import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Exercise the real provider; detached policy updates are now provider-owned.
vi.unmock("../../src/contexts/SettingsContext");
import DetachedClient, {
  DetachedSessionContent,
} from "../../app/detached/DetachedClient";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  SettingsManager,
  SettingsSyncRevisionTracker,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { SettingsProvider } from "../../src/contexts/SettingsContext";
import { ConnectionContext } from "../../src/contexts/ConnectionContextTypes";
import type { WindowSessionSync } from "../../src/types/windowManager";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import {
  getMemoryWatchdog,
  stopMemoryWatchdog,
} from "../../src/utils/debug/memoryWatchdog";

const searchSession = vi.hoisted(() => ({ id: "s1" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "sessionId" ? searchSession.id : null),
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

const linkedViewer = vi.hoisted(() => ({
  enabled: false,
  mounts: 0,
  unmounts: 0,
}));
vi.mock("../../src/components/session/SessionViewer", async () => {
  const { useEffect } = await import("react");
  const { useConnections } = await import("../../src/contexts/useConnections");
  const { createRdpInternalsSession } =
    await import("../../src/components/app/toolSession");
  return {
    SessionViewer: ({ session, onActivateSession, onCloseSession }: any) => {
      const { state, dispatch } = useConnections();
      useEffect(() => {
        if (!linkedViewer.enabled || session.protocol !== "rdp") return;
        linkedViewer.mounts++;
        return () => {
          linkedViewer.unmounts++;
        };
      }, [session.id, session.protocol]);
      if (!linkedViewer.enabled)
        return <div data-testid="mock-session-viewer">Session Viewer</div>;
      return (
        <div data-testid={`viewer-${session.id}`}>
          {session.protocol === "rdp" ? (
            <button
              onClick={() => {
                const tab = createRdpInternalsSession(session);
                if (
                  !state.sessions.some((candidate) => candidate.id === tab.id)
                )
                  dispatch({ type: "ADD_SESSION", payload: tab });
                onActivateSession?.(tab.id);
              }}
            >
              Open linked internals
            </button>
          ) : (
            <button onClick={() => onCloseSession?.(session.id)}>
              Close linked tool
            </button>
          )}
        </div>
      );
    },
  };
});

vi.mock("../../src/hooks/window/useTooltipSystem", () => ({
  useTooltipSystem: vi.fn(),
}));

let closeRequestedHandler:
  ((event: { preventDefault: () => void }) => Promise<void>) | undefined;
let closeResultHandler:
  | ((event: {
      payload: { requestId: string; sessionId: string; success: boolean };
    }) => void)
  | undefined;
let mainSessionClosedHandler:
  ((event: { payload: { sessionId: string } }) => void) | undefined;
type SyncEvent = { payload: WindowSessionSync };
type SyncHandler = (event: SyncEvent) => void;
type SyncRegistration = {
  handler: SyncHandler;
  active: boolean;
  unlisten: ReturnType<typeof vi.fn>;
};

const syncRegistrations: SyncRegistration[] = [];
let syncHandler: SyncHandler | undefined;
let settingsSyncHandler: ((event: { payload: unknown }) => void) | undefined;

const activeSyncRegistrations = () =>
  syncRegistrations.filter(({ active }) => active);

const emitSyncSnapshot = (payload: WindowSessionSync) => {
  for (const registration of activeSyncRegistrations()) {
    registration.handler({ payload });
  }
};

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
        const registration: SyncRegistration = {
          handler: handler as SyncHandler,
          active: true,
          unlisten: vi.fn(),
        };
        registration.unlisten.mockImplementation(() => {
          registration.active = false;
        });
        syncRegistrations.push(registration);
        syncHandler = registration.handler;
        queueMicrotask(() => {
          if (!registration.active) return;
          registration.handler({
            payload: {
              windowId: "detached-1",
              syncRevision: 1,
              sessions: [syncedSession as any],
              connections: [syncedConnection as any],
              tabGroups: [],
              activeSessionId: "s1",
            },
          });
        });
        return Promise.resolve(registration.unlisten);
      }
      if (eventName === "settings-sync") {
        settingsSyncHandler = handler as typeof settingsSyncHandler;
      }
      return Promise.resolve(() => {});
    },
  ),
}));

const defaultListenImplementation = vi.mocked(listen).getMockImplementation()!;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  isTauri: () => true,
}));

describe("DetachedClient accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchSession.id = "s1";
    linkedViewer.enabled = false;
    linkedViewer.mounts = 0;
    linkedViewer.unmounts = 0;
    stopMemoryWatchdog();
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
    closeRequestedHandler = undefined;
    closeResultHandler = undefined;
    mainSessionClosedHandler = undefined;
    syncHandler = undefined;
    syncRegistrations.length = 0;
    settingsSyncHandler = undefined;
    vi.mocked(listen).mockImplementation(defaultListenImplementation);
    vi.mocked(emit).mockResolvedValue(undefined);
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopMemoryWatchdog();
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

  it("keeps only the linked RDP source mounted, retains local Internals across sync, and closes tools locally", async () => {
    linkedViewer.enabled = true;
    await renderAndLoadDetachedClient();
    const rdp = { ...syncedSession, protocol: "rdp" } as any;
    const sync = (syncRevision: number, sessions = [rdp]) =>
      act(() =>
        emitSyncSnapshot({
          windowId: "detached-1",
          syncRevision,
          sessions,
          connections: [syncedConnection as any],
          tabGroups: [],
          activeSessionId: "s1",
        }),
      );
    sync(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Open linked internals" }),
    );
    expect(
      screen.getByRole("button", { name: "Close linked tool" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("viewer-s1")).not.toBeVisible();
    expect(linkedViewer.mounts).toBe(1);
    expect(linkedViewer.unmounts).toBe(0);
    sync(3);
    expect(
      screen.getByRole("button", { name: "Close linked tool" }),
    ).toBeInTheDocument();
    expect(linkedViewer.mounts).toBe(1);
    expect(linkedViewer.unmounts).toBe(0);
    vi.mocked(emit).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close linked tool" }));
    expect(
      screen.getByRole("button", { name: "Open linked internals" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("viewer-rdp-internals-s1"),
    ).not.toBeInTheDocument();
    expect(linkedViewer.mounts).toBe(1);
    expect(linkedViewer.unmounts).toBe(0);
    expect(
      vi
        .mocked(emit)
        .mock.calls.some(
          ([, command]) => (command as any)?.type === "CLOSE_SESSION",
        ),
    ).toBe(false);
  });

  it("does not let a local Internals tab retain ownership after an authoritative empty sync", async () => {
    linkedViewer.enabled = true;
    (window as any).__TAURI__ = {};
    await renderAndLoadDetachedClient();
    act(() =>
      emitSyncSnapshot({
        windowId: "detached-1",
        syncRevision: 2,
        sessions: [{ ...syncedSession, protocol: "rdp" } as any],
        connections: [syncedConnection as any],
        tabGroups: [],
        activeSessionId: "s1",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open linked internals" }),
    );
    vi.mocked(emit).mockClear();
    act(() =>
      emitSyncSnapshot({
        windowId: "detached-1",
        syncRevision: 3,
        sessions: [],
        connections: [],
        tabGroups: [],
      }),
    );
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByTestId("viewer-rdp-internals-s1"),
    ).not.toBeInTheDocument();
    expect(linkedViewer.unmounts).toBe(1);
    expect(
      vi
        .mocked(emit)
        .mock.calls.some(
          ([, command]) =>
            (command as any)?.type === "SYNC_SESSION_LIFECYCLE" &&
            (command as any)?.sessionId === "rdp-internals-s1",
        ),
    ).toBe(false);
  });

  it("preserves reattach for a recording player authoritatively assigned by main", async () => {
    (window as any).__TAURI__ = {};
    await renderAndLoadDetachedClient();
    const player = {
      id: "recording-player-r1",
      connectionId: "recording-player-r1",
      name: "Recording One",
      status: "connected",
      protocol: "tool:recordingPlayer",
      hostname: "",
      startTime: new Date(),
      recordingPlayer: { recordingId: "r1" },
    } as const;
    act(() =>
      emitSyncSnapshot({
        windowId: "detached-1",
        syncRevision: 2,
        sessions: [syncedSession as any, player],
        connections: [syncedConnection as any],
        tabGroups: [],
        activeSessionId: player.id,
      }),
    );
    const reattach = screen.getByRole("button", {
      name: "Reattach Recording One",
    });
    expect(reattach).not.toBeDisabled();
    vi.mocked(emit).mockClear();
    fireEvent.click(reattach);
    expect(emit).toHaveBeenCalledWith(
      "wm:command",
      expect.objectContaining({
        type: "REATTACH_SESSION",
        sessionId: player.id,
        sourceWindow: "detached-1",
      }),
    );
  });

  it("owns detached watchdog thresholds, live settings, and cleanup", async () => {
    vi.useFakeTimers();
    const previousMemory = Object.getOwnPropertyDescriptor(
      performance,
      "memory",
    );
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: {
        usedJSHeapSize: 1300 * 1024 * 1024,
        totalJSHeapSize: 1400 * 1024 * 1024,
        jsHeapSizeLimit: 2048 * 1024 * 1024,
      },
    });
    const { unmount } = render(<DetachedClient />);

    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const alert = screen.getByTestId("memory-pressure-alert");
      expect(alert).toHaveAttribute("data-window-label", "detached-1");
      expect(screen.getByText("Memory pressure detected")).toBeInTheDocument();
      expect(getMemoryWatchdog()).not.toBeNull();

      const settings = SettingsManager.getInstance().getSettings();
      fireEvent(
        window,
        new CustomEvent("settings-updated", {
          detail: {
            ...settings,
            memoryWatchdog: {
              ...settings.memoryWatchdog,
              intervalMs: 1000,
              detached: {
                heapWarningMb: 1000,
                heapCriticalMb: 1400,
                heapKillMb: 1500,
              },
            },
          },
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("memory-pressure-alert")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(
        screen.queryByTestId("memory-pressure-alert"),
      ).not.toBeInTheDocument();

      fireEvent(
        window,
        new CustomEvent("settings-updated", {
          detail: {
            ...settings,
            memoryWatchdog: {
              ...settings.memoryWatchdog,
              intervalMs: 1000,
              detached: {
                heapWarningMb: 64,
                heapCriticalMb: 128,
                heapKillMb: 256,
              },
            },
          },
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Memory pressure detected")).toBeInTheDocument();

      unmount();
      expect(getMemoryWatchdog()).toBeNull();
    } finally {
      if (getMemoryWatchdog()) unmount();
      if (previousMemory) {
        Object.defineProperty(performance, "memory", previousMemory);
      } else {
        Reflect.deleteProperty(performance, "memory");
      }
      vi.useRealTimers();
    }
  });

  it("keeps exactly one live wm:sync listener and releases it on unmount", async () => {
    (window as any).__TAURI__ = true;
    const { unmount } = render(<DetachedClient />);

    await waitFor(() => {
      expect(activeSyncRegistrations()).toHaveLength(1);
    });
    expect(syncRegistrations).toHaveLength(1);
    expect(
      vi
        .mocked(listen)
        .mock.calls.filter(([eventName]) => eventName === "wm:sync"),
    ).toHaveLength(1);

    const [registration] = syncRegistrations;
    unmount();

    await waitFor(() => {
      expect(activeSyncRegistrations()).toHaveLength(0);
    });
    expect(registration.unlisten).toHaveBeenCalledTimes(1);
  });

  it("applies only the newest sync dispatch set and closes once for a newest empty snapshot", async () => {
    (window as any).__TAURI__ = true;
    const dispatch = vi.fn();
    const noopAsync = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <SettingsProvider>
        <ConnectionContext.Provider
          value={
            {
              state: {
                connections: [],
                sessions: [],
                selectedConnection: null,
                selectedConnectionIds: new Set(),
                filter: {
                  searchTerm: "",
                  protocols: [],
                  tags: [],
                  colorTags: [],
                  showRecent: false,
                  showFavorites: false,
                  sortBy: "custom",
                  sortDirection: "asc",
                },
                isLoading: false,
                sidebarCollapsed: false,
                tabGroups: [],
              },
              dispatch,
              dispatchAndFlush: noopAsync,
              persistence: { dirty: false, saving: false, error: null },
              saveData: noopAsync,
              flushPendingSave: noopAsync,
              loadData: vi.fn().mockResolvedValue(true),
            } as any
          }
        >
          <DetachedSessionContent onRegisterDisconnect={vi.fn()} />
        </ConnectionContext.Provider>
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(activeSyncRegistrations()).toHaveLength(1);
    });
    dispatch.mockClear();
    mockWindow.close.mockClear();

    const newestSession = { ...syncedSession, name: "Newest Session" };
    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 4,
        sessions: [newestSession as any],
        connections: [syncedConnection as any],
        tabGroups: [],
        activeSessionId: "s1",
      });
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 4,
        sessions: [{ ...syncedSession, name: "Duplicate Session" } as any],
        connections: [syncedConnection as any],
        tabGroups: [],
        activeSessionId: "s1",
      });
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 3,
        sessions: [{ ...syncedSession, name: "Stale Session" } as any],
        connections: [syncedConnection as any],
        tabGroups: [],
        activeSessionId: "s1",
      });
    });

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: "SET_CONNECTIONS",
        payload: [expect.objectContaining({ id: "c1" })],
      },
      {
        type: "SET_SESSIONS",
        payload: [expect.objectContaining({ name: "Newest Session" })],
      },
      { type: "SET_TAB_GROUPS", payload: [] },
    ]);

    dispatch.mockClear();
    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 5,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 5,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });

    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "SET_CONNECTIONS",
      "SET_SESSIONS",
      "SET_TAB_GROUPS",
    ]);
    expect(mockWindow.close).toHaveBeenCalledTimes(1);
    unmount();
  });

  it.each(["plain", "legacy-password"] as const)(
    "handles a %s owner without trusting snapshot rows",
    async (kind) => {
      const manager = DatabaseManager.getInstance();
      const adopt = vi
        .spyOn(manager, "adoptPlainDetachedDatabase")
        .mockResolvedValue(undefined);
      const release = vi
        .spyOn(manager, "releaseDetachedDatabaseAccess")
        .mockResolvedValue(undefined);
      const dispatch = vi.fn();
      const loadData = vi.fn().mockResolvedValue(true);
      vi.mocked(listen).mockImplementation(((
        eventName: string,
        handler: any,
      ) => {
        if (eventName !== "wm:sync")
          return (defaultListenImplementation as any)(eventName, handler);
        syncHandler = handler;
        return Promise.resolve(vi.fn());
      }) as any);
      const view = render(
        <SettingsProvider>
          <ConnectionContext.Provider
            value={
              {
                state: { connections: [], sessions: [], tabGroups: [] },
                dispatch,
                loadData,
              } as any
            }
          >
            <DetachedSessionContent onRegisterDisconnect={vi.fn()} />
          </ConnectionContext.Provider>
        </SettingsProvider>,
      );
      try {
        await waitFor(() =>
          expect(
            vi
              .mocked(emit)
              .mock.calls.some(
                ([, payload]) => (payload as any)?.type === "WINDOW_READY",
              ),
          ).toBe(true),
        );
        const ready = vi
          .mocked(emit)
          .mock.calls.find(
            ([, payload]) => (payload as any)?.type === "WINDOW_READY",
          )![1] as { handoffId: string };
        const snapshot: WindowSessionSync = {
          windowId: "detached-1",
          handoffId: ready.handoffId,
          syncRevision: 1,
          sessions: [{ ...syncedSession, ownerDatabaseId: "plain-db" } as any],
          connections: [syncedConnection as any],
          tabGroups: [],
          localDatabaseOwner: {
            databaseId: "plain-db",
            securityRevision: "plain-r1",
            kind,
          },
        };
        await act(async () => {
          syncHandler?.({
            payload: { ...snapshot, handoffId: undefined, syncRevision: 999 },
          });
        });
        expect(adopt).not.toHaveBeenCalled();
        await act(async () => {
          syncHandler?.({ payload: snapshot });
        });
        if (kind === "plain") {
          await waitFor(() =>
            expect(loadData).toHaveBeenCalledExactlyOnceWith("plain-db"),
          );
          expect(adopt).toHaveBeenCalledExactlyOnceWith(
            "plain-db",
            "plain-r1",
            { isCurrent: expect.any(Function) },
          );
        } else {
          expect(adopt).not.toHaveBeenCalled();
          expect(loadData).not.toHaveBeenCalled();
          expect(
            screen.getByText(
              /legacy password-encrypted database needs a local unlock/,
            ),
          ).toBeInTheDocument();
        }
        expect(
          dispatch.mock.calls.every(
            ([action]) => action.type === "SET_SESSIONS",
          ),
        ).toBe(true);
      } finally {
        view.unmount();
        adopt.mockRestore();
        release.mockRestore();
      }
    },
  );

  it("loads the delegated owner once without replacing full database rows or groups with a window subset", async () => {
    const manager = DatabaseManager.getInstance();
    const adopt = vi
      .spyOn(manager, "adoptDelegatedDatabase")
      .mockResolvedValue(undefined);
    const release = vi
      .spyOn(manager, "releaseDetachedDatabaseAccess")
      .mockResolvedValue(undefined);
    const dispatch = vi.fn();
    const loadData = vi.fn().mockResolvedValue(true);
    vi.mocked(listen).mockImplementation(((eventName: string, handler: any) => {
      if (eventName !== "wm:sync")
        return (defaultListenImplementation as any)(eventName, handler);
      syncHandler = handler;
      return Promise.resolve(vi.fn());
    }) as any);
    const context = {
      state: { connections: [], sessions: [], tabGroups: [] },
      dispatch,
      loadData,
    } as any;
    const view = render(
      <SettingsProvider>
        <ConnectionContext.Provider value={context}>
          <DetachedSessionContent onRegisterDisconnect={vi.fn()} />
        </ConnectionContext.Provider>
      </SettingsProvider>,
    );
    const grant = {
      databaseId: "database-a",
      sessionId: "target-only-token",
      securityRevision: "revision-a",
      sessionExpiresAt: null,
    };
    await waitFor(() =>
      expect(
        vi
          .mocked(emit)
          .mock.calls.some(
            ([, payload]) => (payload as any)?.type === "WINDOW_READY",
          ),
      ).toBe(true),
    );
    const ready = vi
      .mocked(emit)
      .mock.calls.find(
        ([, payload]) => (payload as any)?.type === "WINDOW_READY",
      )![1] as { handoffId: string };
    const snapshot: WindowSessionSync = {
      windowId: "detached-1",
      handoffId: ready.handoffId,
      syncRevision: 1,
      sessions: [{ ...syncedSession, ownerDatabaseId: "database-a" } as any],
      connections: [syncedConnection as any],
      tabGroups: [],
      activeSessionId: "s1",
      databaseGrant: grant,
    };
    try {
      await act(async () => {
        syncHandler?.({
          payload: {
            ...snapshot,
            handoffId: "previous-receiver",
            syncRevision: 999,
          },
        });
        syncHandler?.({
          payload: { ...snapshot, handoffId: undefined, syncRevision: 1000 },
        });
      });
      expect(adopt).not.toHaveBeenCalled();
      await act(async () => {
        syncHandler?.({ payload: snapshot });
      });
      await waitFor(() =>
        expect(loadData).toHaveBeenCalledExactlyOnceWith("database-a"),
      );
      expect(adopt).toHaveBeenCalledExactlyOnceWith("database-a", grant, {
        isCurrent: expect.any(Function),
      });
      for (const syncRevision of [2, 2, 1, 3]) {
        await act(async () => {
          syncHandler?.({ payload: { ...snapshot, syncRevision } });
        });
      }
      expect(loadData).toHaveBeenCalledOnce();
      expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
        "SET_SESSIONS",
        "SET_SESSIONS",
        "SET_SESSIONS",
      ]);
      await act(async () => {
        syncHandler?.({
          payload: {
            ...snapshot,
            syncRevision: 4,
            databaseContentRevision: { databaseId: "database-a", revision: 1 },
          },
        });
      });
      expect(loadData).toHaveBeenCalledTimes(2);
      expect(adopt).toHaveBeenCalledOnce();
      expect(release).not.toHaveBeenCalled();
      // A foreign grant may not be used to make an identically named row ready.
      await act(async () => {
        syncHandler?.({
          payload: {
            ...snapshot,
            syncRevision: 5,
            databaseGrant: { ...grant, databaseId: "database-b" },
          },
        });
      });
      expect(release).toHaveBeenCalledExactlyOnceWith("database-a");
      expect(adopt).toHaveBeenCalledOnce();
      expect(
        dispatch.mock.calls.every(([action]) => action.type === "SET_SESSIONS"),
      ).toBe(true);
      // A delayed prior revision cannot re-adopt the revoked database.
      await act(async () => {
        syncHandler?.({ payload: { ...snapshot, syncRevision: 3 } });
      });
      expect(adopt).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      adopt.mockRestore();
      release.mockRestore();
    }
  });

  it("uses a new lifetime grant while the predecessor's native release is still pending", async () => {
    const manager = DatabaseManager.getInstance();
    const adopt = vi
      .spyOn(manager, "adoptDelegatedDatabase")
      .mockResolvedValue(undefined);
    let finishRelease!: () => void;
    const release = vi
      .spyOn(manager, "releaseDetachedDatabaseAccess")
      .mockResolvedValue(undefined)
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishRelease = resolve;
        }),
      );
    const loadData = vi.fn().mockResolvedValue(true);
    const dispatch = vi.fn();
    const ready: Array<{ handoffId: string }> = [];
    vi.mocked(listen).mockImplementation(((eventName: string, handler: any) => {
      if (eventName !== "wm:sync")
        return (defaultListenImplementation as any)(eventName, handler);
      syncHandler = handler;
      return Promise.resolve(vi.fn<() => void>());
    }) as any);
    const snapshot = (
      handoffId: string,
      syncRevision: number,
    ): WindowSessionSync => ({
      windowId: "detached-1",
      handoffId,
      syncRevision,
      sessions: [{ ...syncedSession, ownerDatabaseId: "database-a" } as any],
      connections: [],
      tabGroups: [],
      databaseGrant: {
        databaseId: "database-a",
        sessionId: `token-${handoffId}`,
        securityRevision: "revision-a",
        sessionExpiresAt: null,
      },
    });
    vi.mocked(emit).mockImplementation(async (_, payload) => {
      if ((payload as any)?.type !== "WINDOW_READY") return;
      const request = payload as { handoffId: string };
      ready.push(request);
      syncHandler?.({ payload: snapshot(request.handoffId, ready.length) });
    });
    const content = () => (
      <SettingsProvider>
        <ConnectionContext.Provider
          value={
            {
              state: { sessions: [], connections: [], tabGroups: [] },
              dispatch,
              loadData,
            } as any
          }
        >
          <DetachedSessionContent onRegisterDisconnect={vi.fn()} />
        </ConnectionContext.Provider>
      </SettingsProvider>
    );
    const view = render(content());
    try {
      await waitFor(() => expect(loadData).toHaveBeenCalledOnce());
      // Restart the bootstrap effect while preserving its hook state, as HMR can.
      searchSession.id = "s2";
      view.rerender(content());
      await waitFor(() => expect(loadData).toHaveBeenCalledTimes(2));
      expect(release).toHaveBeenCalledOnce();
      expect(ready).toHaveLength(2);
      expect(ready[0].handoffId).not.toBe(ready[1].handoffId);
      expect(adopt.mock.calls.map(([, grant]) => grant.sessionId)).toEqual([
        `token-${ready[0].handoffId}`,
        `token-${ready[1].handoffId}`,
      ]);
      await act(async () => {
        syncHandler?.({ payload: snapshot(ready[0].handoffId, 999) });
        finishRelease();
      });
      expect(adopt).toHaveBeenCalledTimes(2);
      expect(loadData).toHaveBeenCalledTimes(2);
      expect(
        dispatch.mock.calls.every(([action]) => action.type === "SET_SESSIONS"),
      ).toBe(true);
    } finally {
      finishRelease();
      view.unmount();
      adopt.mockRestore();
      release.mockRestore();
    }
  });

  it.each([false, true])(
    "bounds fresh-grant retries after native adoption failure (permanent=%s)",
    async (permanent) => {
      const manager = DatabaseManager.getInstance();
      const adopt = vi.spyOn(manager, "adoptDelegatedDatabase");
      if (permanent)
        adopt.mockRejectedValue(new Error("fixture native failure"));
      else
        adopt
          .mockResolvedValue(undefined)
          .mockRejectedValueOnce(new Error("fixture native failure"));
      const release = vi
        .spyOn(manager, "releaseDetachedDatabaseAccess")
        .mockResolvedValue(undefined);
      const loadData = vi.fn().mockResolvedValue(true);
      const ready: string[] = [];
      vi.mocked(listen).mockImplementation(((
        eventName: string,
        handler: any,
      ) => {
        if (eventName !== "wm:sync")
          return (defaultListenImplementation as any)(eventName, handler);
        syncHandler = handler;
        return Promise.resolve(vi.fn<() => void>());
      }) as any);
      vi.mocked(emit).mockImplementation(async (_, payload) => {
        if ((payload as any)?.type !== "WINDOW_READY") return;
        const { handoffId } = payload as { handoffId: string };
        ready.push(handoffId);
        syncHandler?.({
          payload: {
            windowId: "detached-1",
            handoffId,
            syncRevision: ready.length,
            sessions: [
              { ...syncedSession, ownerDatabaseId: "database-a" } as any,
            ],
            connections: [],
            tabGroups: [],
            databaseGrant: {
              databaseId: "database-a",
              sessionId: `target-token-${ready.length}`,
              securityRevision: "revision-a",
              sessionExpiresAt: null,
            },
          },
        });
      });
      const view = render(
        <SettingsProvider>
          <ConnectionContext.Provider
            value={
              {
                state: { sessions: [], connections: [], tabGroups: [] },
                dispatch: vi.fn(),
                loadData,
              } as any
            }
          >
            <DetachedSessionContent onRegisterDisconnect={vi.fn()} />
          </ConnectionContext.Provider>
        </SettingsProvider>,
      );
      try {
        await waitFor(() =>
          expect(adopt).toHaveBeenCalledTimes(permanent ? 3 : 2),
        );
        await act(async () => {
          await Promise.resolve();
        });
        expect(ready).toHaveLength(permanent ? 3 : 2);
        expect(new Set(ready).size).toBe(1);
        expect(loadData).toHaveBeenCalledTimes(permanent ? 0 : 1);
      } finally {
        view.unmount();
        adopt.mockRestore();
        release.mockRestore();
      }
    },
  );

  it("settles a before-close rejection and retries one later empty sync", async () => {
    (window as any).__TAURI__ = true;
    await renderAndLoadDetachedClient();
    await waitFor(() => expect(closeRequestedHandler).toBeTypeOf("function"));

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 2,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(1));

    vi.mocked(emitTo).mockRejectedValueOnce(new Error("before close rejected"));
    await act(async () => {
      await expect(
        closeRequestedHandler!({ preventDefault: vi.fn() }),
      ).resolves.toBeUndefined();
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(1);

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 3,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 3,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(2));
  });

  it("settles a rejected final close, restores confirmation, and retries once", async () => {
    (window as any).__TAURI__ = true;
    mockWindow.close
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("final close rejected"))
      .mockResolvedValueOnce(undefined);
    await renderAndLoadDetachedClient();
    await waitFor(() => expect(closeRequestedHandler).toBeTypeOf("function"));

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 2,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(1));
    await act(async () => {
      await expect(
        closeRequestedHandler!({ preventDefault: vi.fn() }),
      ).resolves.toBeUndefined();
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(2);

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 3,
        sessions: [syncedSession as any],
        connections: [syncedConnection as any],
        tabGroups: [],
        activeSessionId: "s1",
      });
    });
    await waitFor(() => {
      expect(
        screen.getByRole("tablist", { name: /detached session tabs/i }),
      ).toBeInTheDocument();
    });

    let manualClose: Promise<void> | undefined;
    act(() => {
      manualClose = closeRequestedHandler!({ preventDefault: vi.fn() });
    });
    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
    expect(mockWindow.close).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId("confirm-no"));
    await act(async () => {
      await manualClose;
    });

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 4,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 4,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(3));
  });

  it("queues a newer empty sync behind a cancelled delayed close intent", async () => {
    (window as any).__TAURI__ = true;
    await renderAndLoadDetachedClient();
    await waitFor(() => expect(closeRequestedHandler).toBeTypeOf("function"));

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 2,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(1));

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 3,
        sessions: [syncedSession as any],
        connections: [syncedConnection as any],
        tabGroups: [],
        activeSessionId: "s1",
      });
    });
    await waitFor(() => {
      expect(
        screen.getByRole("tablist", { name: /detached session tabs/i }),
      ).toBeInTheDocument();
    });

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 4,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 4,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(1);

    const preventDefault = vi.fn();
    await act(async () => {
      await closeRequestedHandler!({ preventDefault });
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 5,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(2);

    await act(async () => {
      await closeRequestedHandler!({ preventDefault: vi.fn() });
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(3);
  });

  it("coalesces a newer automatic close during manual checking and re-drives it once", async () => {
    (window as any).__TAURI__ = true;
    await renderAndLoadDetachedClient();
    await waitFor(() => expect(closeRequestedHandler).toBeTypeOf("function"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: {
            ...SettingsManager.getInstance().getSettings(),
            warnOnDetachClose: false,
          },
        }),
      );
    });

    let pendingCloseRequest:
      { requestId: string; sessionId: string } | undefined;
    vi.mocked(emit).mockImplementation(async (eventName, payload) => {
      const command = payload as any;
      if (eventName === "wm:command" && command.type === "CLOSE_SESSION") {
        pendingCloseRequest = command;
      }
    });

    let manualClose: Promise<void> | undefined;
    act(() => {
      manualClose = closeRequestedHandler!({ preventDefault: vi.fn() });
    });
    await waitFor(() => expect(pendingCloseRequest).toBeDefined());

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 2,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(1));

    // Model the native event raised by that automatic close request while the
    // manual request is still awaiting its authoritative session result.
    const coalescedPreventDefault = vi.fn();
    await act(async () => {
      await closeRequestedHandler!({
        preventDefault: coalescedPreventDefault,
      });
    });
    expect(coalescedPreventDefault).toHaveBeenCalledTimes(1);
    expect(mockWindow.close).toHaveBeenCalledTimes(1);

    act(() => {
      closeResultHandler?.({
        payload: {
          requestId: pendingCloseRequest!.requestId,
          sessionId: pendingCloseRequest!.sessionId,
          success: false,
        },
      });
    });
    await act(async () => {
      await manualClose;
    });
    await waitFor(() => expect(mockWindow.close).toHaveBeenCalledTimes(2));

    act(() => {
      emitSyncSnapshot({
        windowId: "detached-1" as any,
        syncRevision: 3,
        sessions: [],
        connections: [],
        tabGroups: [],
      });
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(2);

    await act(async () => {
      await closeRequestedHandler!({ preventDefault: vi.fn() });
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });

  it("releases a wm:sync listener that resolves after unmount", async () => {
    let resolveLateListener: ((unlisten: () => void) => void) | undefined;
    const lateRegistration: SyncRegistration = {
      handler: () => {},
      active: true,
      unlisten: vi.fn(),
    };
    lateRegistration.unlisten.mockImplementation(() => {
      lateRegistration.active = false;
    });

    vi.mocked(listen).mockImplementation(((eventName: string, handler: any) => {
      if (eventName !== "wm:sync") {
        return (defaultListenImplementation as any)(eventName, handler);
      }
      lateRegistration.handler = handler as SyncHandler;
      syncRegistrations.push(lateRegistration);
      return new Promise<() => void>((resolve) => {
        resolveLateListener = resolve;
      });
    }) as any);

    const { unmount } = render(<DetachedClient />);
    await waitFor(() => expect(resolveLateListener).toBeTypeOf("function"));
    unmount();
    expect(lateRegistration.unlisten).not.toHaveBeenCalled();

    await act(async () => {
      resolveLateListener!(lateRegistration.unlisten as () => void);
      await Promise.resolve();
    });

    expect(lateRegistration.unlisten).toHaveBeenCalledTimes(1);
    expect(activeSyncRegistrations()).toHaveLength(0);
    expect(
      vi
        .mocked(emit)
        .mock.calls.some(
          ([, payload]) => (payload as any)?.type === "WINDOW_READY",
        ),
    ).toBe(false);
  });

  it("waits for the sync listener before requesting an immediate handoff", async () => {
    let register: (() => void) | undefined;
    let ready = false;
    vi.mocked(listen).mockImplementation(((eventName: string, handler: any) => {
      if (eventName !== "wm:sync")
        return (defaultListenImplementation as any)(eventName, handler);
      syncHandler = handler;
      return new Promise<() => void>((resolve) => {
        register = () => {
          ready = true;
          resolve(vi.fn<() => void>());
        };
      });
    }) as any);
    vi.mocked(emit).mockImplementation(async (eventName, payload) => {
      if (
        eventName === "wm:command" &&
        (payload as any)?.type === "WINDOW_READY"
      ) {
        expect(ready).toBe(true);
        syncHandler?.({
          payload: {
            windowId: "detached-1",
            syncRevision: 1,
            sessions: [syncedSession as any],
            connections: [syncedConnection as any],
            tabGroups: [],
            activeSessionId: "s1",
          },
        });
      }
    });
    render(<DetachedClient />);
    await waitFor(() => expect(register).toBeTypeOf("function"));
    expect(
      vi
        .mocked(emit)
        .mock.calls.some(
          ([, payload]) => (payload as any)?.type === "WINDOW_READY",
        ),
    ).toBe(false);
    await act(async () => register!());
    expect(screen.getByTestId("mock-session-viewer")).toBeInTheDocument();
  });

  it.each(["legacy", "metadata"])(
    "never hydrates %s local storage as a database owner and accepts a later live handoff",
    async (format) => {
      vi.useFakeTimers();
      vi.mocked(listen).mockImplementation(((
        eventName: string,
        handler: any,
      ) => {
        if (eventName !== "wm:sync")
          return (defaultListenImplementation as any)(eventName, handler);
        syncHandler = handler;
        return Promise.resolve(vi.fn());
      }) as any);
      localStorage.setItem(
        "detached-session-s1",
        JSON.stringify(
          format === "legacy"
            ? {
                session: syncedSession,
                connection: {
                  ...syncedConnection,
                  password: "fixture-stale-secret",
                },
              }
            : {
                version: 2,
                sessionId: "s1",
                connectionId: "c1",
                ownerWindowId: "detached-1",
              },
        ),
      );
      const view = render(<DetachedClient />);
      try {
        await act(async () => vi.advanceTimersByTimeAsync(0));
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(
          screen.queryByTestId("mock-session-viewer"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByText(
            "Waiting for the session handoff from its owning window.",
          ),
        ).toBeInTheDocument();
        act(() =>
          syncHandler?.({
            payload: {
              windowId: "detached-1",
              syncRevision: 1,
              sessions: [syncedSession as any],
              connections: [syncedConnection as any],
              tabGroups: [],
              activeSessionId: "s1",
            },
          }),
        );
        expect(screen.getByTestId("mock-session-viewer")).toBeInTheDocument();
        expect(
          screen.queryByText(
            "Waiting for the session handoff from its owning window.",
          ),
        ).not.toBeInTheDocument();
      } finally {
        view.unmount();
        vi.useRealTimers();
      }
    },
  );

  it.each([100, 500, 1000])(
    "does not grow wm:sync listeners across %i accepted emissions",
    async (emissionCount) => {
      const { unmount } = render(<DetachedClient />);
      await waitFor(() => expect(activeSyncRegistrations()).toHaveLength(1));

      act(() => {
        for (let index = 0; index < emissionCount; index += 1) {
          emitSyncSnapshot({
            windowId: "detached-1" as any,
            syncRevision: index + 2,
            sessions: [syncedSession as any],
            connections: [syncedConnection as any],
            tabGroups: [],
            activeSessionId: "s1",
          });
        }
      });

      await waitFor(() => {
        expect(syncRegistrations).toHaveLength(1);
        expect(activeSyncRegistrations()).toHaveLength(1);
      });
      unmount();
    },
  );

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
    await waitFor(() => expect(settingsSyncHandler).toBeTypeOf("function"));
    const remote = new SettingsSyncRevisionTracker("writer-main", () => 100);
    await act(async () => {
      settingsSyncHandler?.({
        payload: remote.next("main", {
          ...SettingsManager.getInstance().getSettings(),
          warnOnDetachClose: false,
        }),
      });
      await Promise.resolve();
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
          detail: {
            ...SettingsManager.getInstance().getSettings(),
            warnOnDetachClose: false,
          },
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
          syncRevision: 2,
          sessions: [syncedSession as any, secondSession as any],
          connections: [syncedConnection as any],
          tabGroups: [],
          activeSessionId: "s1",
        },
      });
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: {
            ...SettingsManager.getInstance().getSettings(),
            warnOnDetachClose: false,
          },
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
              syncRevision: 1,
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
              syncRevision: 1,
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
