import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionManager } from "../../src/hooks/session/useSessionManager";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { SettingsManager } from "../../src/utils/settings/settingsManager";

const connectionMocks = vi.hoisted(() => ({
  state: {
    sessions: [] as ConnectionSession[],
    connections: [] as Connection[],
  },
  dispatch: vi.fn(),
  executeScriptsForTrigger: vi.fn(),
  startChecking: vi.fn(),
  stopChecking: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: connectionMocks.state,
    dispatch: connectionMocks.dispatch,
  }),
}));

vi.mock("../../src/utils/recording/scriptEngine", () => ({
  ScriptEngine: {
    getInstance: () => ({
      executeScriptsForTrigger: connectionMocks.executeScriptsForTrigger,
    }),
  },
}));

vi.mock("../../src/utils/connection/statusChecker", () => ({
  StatusChecker: {
    getInstance: () => ({
      startChecking: connectionMocks.startChecking,
      stopChecking: connectionMocks.stopChecking,
      cleanup: vi.fn(),
    }),
  },
}));

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-new",
    name: "New SSH",
    protocol: "ssh",
    hostname: "ssh-new.example.test",
    port: 22,
    isGroup: false,
    ...overrides,
  } as Connection;
}

function makeSession(
  overrides: Partial<ConnectionSession> = {},
): ConnectionSession {
  return {
    id: "session-existing",
    connectionId: "conn-existing",
    name: "Existing SSH",
    status: "connected",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    protocol: "ssh",
    hostname: "ssh-existing.example.test",
    ...overrides,
  };
}

describe("useSessionManager settings effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SettingsManager.resetInstance();
    connectionMocks.state = { sessions: [], connections: [] };
    connectionMocks.executeScriptsForTrigger.mockResolvedValue(undefined);
    SettingsManager.getInstance().applyInMemory({
      maxConcurrentConnections: 10,
      retryAttempts: 0,
      retryDelay: 1,
      connectionTimeout: 0,
      singleConnectionMode: false,
      openConnectionInBackground: false,
      notifyOnConnect: false,
      notifyOnReconnect: false,
      notifyOnDisconnect: false,
      notifyOnError: false,
      notificationSound: false,
    });
  });

  it("openConnectionInBackground controls whether a new connection becomes active", async () => {
    SettingsManager.getInstance().applyInMemory({
      openConnectionInBackground: true,
    });
    const { result, rerender } = renderHook(() => useSessionManager());

    await act(async () => {
      await result.current.handleConnect(makeConnection());
    });

    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({ connectionId: "conn-new" }),
    });
    expect(result.current.activeSessionId).toBeUndefined();

    const addedSession = connectionMocks.dispatch.mock.calls.find(
      ([action]) => action.type === "ADD_SESSION",
    )?.[0].payload as ConnectionSession;
    connectionMocks.state = {
      sessions: [addedSession],
      connections: [makeConnection()],
    };
    SettingsManager.getInstance().applyInMemory({
      openConnectionInBackground: false,
    });
    connectionMocks.dispatch.mockClear();
    rerender();

    await act(async () => {
      await result.current.handleConnect(
        makeConnection({ id: "conn-foreground", hostname: "fg.example.test" }),
      );
    });

    const foregroundSession = connectionMocks.dispatch.mock.calls.find(
      ([action]) =>
        action.type === "ADD_SESSION" &&
        action.payload.connectionId === "conn-foreground",
    )?.[0].payload as ConnectionSession;
    expect(result.current.activeSessionId).toBe(foregroundSession.id);
  });

  it("singleConnectionMode confirms and removes existing real sessions before opening a new one", async () => {
    connectionMocks.state = {
      sessions: [makeSession()],
      connections: [makeConnection({ id: "conn-existing" })],
    };
    SettingsManager.getInstance().applyInMemory({
      singleConnectionMode: true,
    });
    const { result } = renderHook(() => useSessionManager());

    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.handleConnect(makeConnection());
    });

    await waitFor(() => {
      expect(result.current.confirmDialog).not.toBeNull();
    });

    act(() => {
      (result.current.confirmDialog as any).props.onConfirm();
    });
    await connectPromise;

    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "REMOVE_SESSION",
      payload: "session-existing",
    });
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({ connectionId: "conn-new" }),
    });
  });

  it("notifyOnConnect gates OS notifications for session status changes", async () => {
    const notificationCtor = vi.fn();
    Object.assign(notificationCtor, {
      permission: "granted",
      requestPermission: vi.fn(),
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: notificationCtor,
    });
    SettingsManager.getInstance().applyInMemory({
      notifyOnConnect: true,
      notificationSound: false,
    });
    connectionMocks.state = {
      sessions: [makeSession({ status: "connecting" })],
      connections: [],
    };
    const { rerender } = renderHook(() => useSessionManager());

    connectionMocks.state = {
      sessions: [makeSession({ status: "connected" })],
      connections: [],
    };
    rerender();

    await waitFor(() => {
      expect(notificationCtor).toHaveBeenCalledWith(
        "Session connected",
        expect.objectContaining({
          body: "Existing SSH (SSH ssh-existing.example.test)",
          silent: true,
          tag: "sortofremoteng:connect:session-existing",
        }),
      );
    });

    notificationCtor.mockClear();
    SettingsManager.getInstance().applyInMemory({
      notifyOnConnect: false,
    });
    connectionMocks.state = {
      sessions: [makeSession({ id: "session-second", status: "connecting" })],
      connections: [],
    };
    rerender();
    connectionMocks.state = {
      sessions: [makeSession({ id: "session-second", status: "connected" })],
      connections: [],
    };
    rerender();

    expect(notificationCtor).not.toHaveBeenCalled();
  });

  it("preserves an explicit zero retry-attempt override on new and restored sessions", async () => {
    SettingsManager.getInstance().applyInMemory({ retryAttempts: 5 });
    const connection = makeConnection({ retryAttempts: 0 });
    const { result } = renderHook(() => useSessionManager());

    await act(async () => {
      await result.current.handleConnect(connection);
    });
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({ maxReconnectAttempts: 0 }),
    });

    connectionMocks.dispatch.mockClear();
    await act(async () => {
      await result.current.restoreSession(
        {
          id: "restored-session",
          connectionId: connection.id,
          name: connection.name,
          protocol: connection.protocol,
          hostname: connection.hostname,
          status: "connected",
        },
        connection,
      );
    });
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        id: "restored-session",
        maxReconnectAttempts: 0,
      }),
    });
  });

  it("allows per-connection warnOnClose=false to override a global warning", async () => {
    const connection = makeConnection({
      id: "conn-existing",
      warnOnClose: false,
    });
    const session = makeSession();
    connectionMocks.state = {
      sessions: [session],
      connections: [connection],
    };
    SettingsManager.getInstance().applyInMemory({
      warnOnClose: true,
      confirmCloseActiveTab: false,
    });
    const { result } = renderHook(() => useSessionManager());

    await act(async () => {
      await result.current.handleSessionClose(session.id);
    });

    expect(result.current.confirmDialog).toBeNull();
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "REMOVE_SESSION",
      payload: session.id,
    });
  });

  it("starts an automatic retry after exactly the configured delay", async () => {
    vi.useFakeTimers();
    try {
      SettingsManager.getInstance().applyInMemory({
        retryAttempts: 1,
        retryDelay: 100,
        connectionTimeout: 1,
      });
      const connection = makeConnection({
        protocol: "telnet",
        port: 23,
        timeout: 0.001,
        retryAttempts: 1,
        retryDelay: 100,
      });
      const { result, rerender, unmount } = renderHook(() =>
        useSessionManager(),
      );

      let connectPromise!: Promise<void>;
      act(() => {
        connectPromise = result.current.handleConnect(connection);
      });
      const addedSession = connectionMocks.dispatch.mock.calls.find(
        ([action]) => action.type === "ADD_SESSION",
      )?.[0].payload as ConnectionSession;
      connectionMocks.state = {
        sessions: [addedSession],
        connections: [connection],
      };
      rerender();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await connectPromise;
      });
      connectionMocks.dispatch.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(99);
      });
      expect(connectionMocks.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_SESSION",
          payload: expect.objectContaining({ status: "reconnecting" }),
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(connectionMocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          id: addedSession.id,
          status: "reconnecting",
          reconnectAttempts: 1,
        }),
      });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
