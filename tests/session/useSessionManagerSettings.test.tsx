import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUnsupportedDirectSessionMessage,
  useSessionManager,
  usesGenericSessionTimer,
} from "../../src/hooks/session/useSessionManager";
import { PROTOCOL_OPTIONS } from "../../src/hooks/connection/useConnectionEditor";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import {
  clearRuntimeConnectionsForTests,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const connectionMocks = vi.hoisted(() => ({
  state: {
    sessions: [] as ConnectionSession[],
    connections: [] as Connection[],
  },
  dispatch: vi.fn(),
  executeScriptsForTrigger: vi.fn(),
  startChecking: vi.fn(),
  stopChecking: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => connectionMocks.invoke(...args),
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
    clearRuntimeConnectionsForTests();
    SettingsManager.resetInstance();
    connectionMocks.state = { sessions: [], connections: [] };
    connectionMocks.executeScriptsForTrigger.mockResolvedValue(undefined);
    connectionMocks.invoke.mockResolvedValue(undefined);
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

  it("keeps real protocol clients out of the simulated timer/metrics path", () => {
    for (const option of PROTOCOL_OPTIONS) {
      expect(usesGenericSessionTimer(option.value), option.value).toBe(false);
    }
  });

  it("fails closed for unsupported and management-only protocols", () => {
    expect(getUnsupportedDirectSessionMessage("spice")).toBeNull();
    expect(getUnsupportedDirectSessionMessage("xdmcp")).toBeNull();
    expect(getUnsupportedDirectSessionMessage("x2go")).toBeNull();
    expect(getUnsupportedDirectSessionMessage("nx")).toBeNull();
    expect(getUnsupportedDirectSessionMessage("ilo")).toMatch(
      /management-only.*no registered interactive saved-connection route/i,
    );
    expect(getUnsupportedDirectSessionMessage("unknown-protocol")).toMatch(
      /no registered frontend session runtime/i,
    );
    expect(getUnsupportedDirectSessionMessage("ssh")).toBeNull();
  });

  it.each([
    ["ssh", "disconnect_ssh"],
    ["ard", "disconnect_ard"],
    ["serial", "serial_disconnect"],
    ["raw", "disconnect_raw_socket"],
    ["rlogin", "disconnect_rlogin"],
    ["winrm", "close_powershell_session"],
    ["telnet", "disconnect_telnet"],
    ["sftp", "sftp_disconnect"],
    ["ftp", "ftp_disconnect"],
    ["scp", "scp_disconnect"],
    ["anydesk", "disconnect_anydesk"],
    ["rustdesk", "rustdesk_disconnect"],
    ["smb", "smb_disconnect"],
    ["postgresql", "pg_disconnect"],
    ["spice", "disconnect_spice"],
    ["xdmcp", "disconnect_xdmcp"],
    ["x2go", "disconnect_x2go"],
    ["nx", "disconnect_nx"],
  ] as const)(
    "final-close owns the native %s disconnect and then removes the session",
    async (protocol, command) => {
      const connection = makeConnection({
        id: "conn-existing",
        protocol,
        warnOnClose: false,
      });
      const session = makeSession({
        protocol,
        backendSessionId: `backend-${protocol}-1`,
      });
      connectionMocks.state = {
        sessions: [session],
        connections: [connection],
      };
      const { result } = renderHook(() => useSessionManager());

      await act(async () => {
        await result.current.handleSessionClose(session.id);
      });

      expect(connectionMocks.invoke).toHaveBeenCalledWith(command, {
        sessionId: `backend-${protocol}-1`,
      });
      expect(connectionMocks.dispatch).toHaveBeenCalledWith({
        type: "REMOVE_SESSION",
        payload: session.id,
      });
      const dispatchCallOrder =
        connectionMocks.dispatch.mock.invocationCallOrder;
      expect(connectionMocks.invoke.mock.invocationCallOrder[0]).toBeLessThan(
        dispatchCallOrder[dispatchCallOrder.length - 1] ?? Infinity,
      );
    },
  );

  it("keeps Quick Connect credentials in volatile runtime memory", async () => {
    const { result } = renderHook(() => useSessionManager());

    act(() => {
      result.current.handleQuickConnect({
        hostname: "quick.example.test",
        protocol: "telnet",
        username: "operator",
        password: "volatile-secret",
      });
    });

    const added = connectionMocks.dispatch.mock.calls.find(
      ([action]) => action.type === "ADD_SESSION",
    )?.[0].payload as ConnectionSession;
    const runtime = resolveRuntimeConnection([], added.connectionId);
    expect(runtime).toEqual(
      expect.objectContaining({
        hostname: "quick.example.test",
        protocol: "telnet",
        username: "operator",
        password: "volatile-secret",
      }),
    );
    expect(added).not.toHaveProperty("password");
    expect(added).not.toHaveProperty("username");
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

  it("rebuilds exact VPN ownership when restoring a saved session", async () => {
    const connection = makeConnection();
    const { result } = renderHook(() => useSessionManager());

    await act(async () => {
      await result.current.restoreSession(
        {
          id: "restored-vpn-session",
          connectionId: connection.id,
          name: connection.name,
          protocol: connection.protocol,
          hostname: connection.hostname,
          status: "connected",
          backendSessionId: "backend-restored",
          vpnLeaseOwnerId: "owner-restored",
          vpnLeaseOwnerIds: ["owner-restored"],
          vpnLeaseBindings: [
            {
              ownerId: "owner-restored",
              backendSessionId: "backend-restored",
              protocol: "ssh",
              status: "active",
            },
          ],
          lifecycleRevision: 8,
        },
        connection,
      );
    });

    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        id: "restored-vpn-session",
        backendSessionId: "backend-restored",
        vpnLeaseOwnerId: "owner-restored",
        vpnLeaseOwnerIds: ["owner-restored"],
        vpnLeaseBindings: [
          {
            ownerId: "owner-restored",
            backendSessionId: "backend-restored",
            protocol: "ssh",
            status: "active",
          },
        ],
        lifecycleRevision: 9,
      }),
    });
  });

  it("restores quarantined cleanup as a visible error with zero reconnect side effects", async () => {
    const connection = makeConnection();
    const quarantine = {
      proofs: [
        {
          kind: "binding" as const,
          ownerId: "owner-quarantined",
          backendSessionId: "backend-quarantined",
          protocol: "ssh" as const,
          status: "cleanup-pending" as const,
        },
      ],
      proofIncomplete: false,
    };
    const { result } = renderHook(() => useSessionManager());
    connectionMocks.dispatch.mockClear();
    connectionMocks.invoke.mockClear();
    connectionMocks.executeScriptsForTrigger.mockClear();

    await act(async () => {
      await result.current.restoreSession(
        {
          id: "restored-quarantined",
          connectionId: connection.id,
          name: connection.name,
          protocol: connection.protocol,
          hostname: connection.hostname,
          status: "error",
          vpnLeaseCleanupQuarantine: quarantine,
        },
        connection,
      );
    });

    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        id: "restored-quarantined",
        status: "error",
        errorMessage: expect.stringMatching(/quarantined.*manual cleanup/i),
        vpnLeaseCleanupQuarantine: quarantine,
      }),
    });
    expect(connectionMocks.invoke).not.toHaveBeenCalled();
    expect(connectionMocks.executeScriptsForTrigger).not.toHaveBeenCalled();
    expect(connectionMocks.startChecking).not.toHaveBeenCalled();
  });

  it("keeps a quarantined manual reconnect visibly blocked with zero side effects", async () => {
    const connection = makeConnection({ id: "conn-quarantined" });
    const session = makeSession({
      id: "session-quarantined",
      connectionId: connection.id,
      status: "error",
      vpnLeaseCleanupQuarantine: {
        proofs: [
          {
            kind: "binding",
            ownerId: "owner-quarantined",
            backendSessionId: "backend-quarantined",
            protocol: "ssh",
            status: "cleanup-pending",
          },
        ],
        proofIncomplete: false,
      },
    });
    connectionMocks.state = {
      sessions: [session],
      connections: [connection],
    };
    const { result } = renderHook(() => useSessionManager());
    connectionMocks.dispatch.mockClear();
    connectionMocks.invoke.mockClear();

    await act(async () => {
      await result.current.handleReconnect(session);
    });

    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: session.id,
        status: "error",
        errorMessage: expect.stringMatching(/quarantined.*manual cleanup/i),
        vpnLeaseCleanupQuarantine: session.vpnLeaseCleanupQuarantine,
      }),
    });
    expect(connectionMocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: "reconnecting" }),
      }),
    );
    expect(connectionMocks.invoke).not.toHaveBeenCalled();
    expect(connectionMocks.executeScriptsForTrigger).not.toHaveBeenCalled();
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

  it("emits ended only after legacy disconnect work and removal without reporting a remote disconnect", async () => {
    const notificationCtor = vi.fn();
    Object.assign(notificationCtor, {
      permission: "granted",
      requestPermission: vi.fn(),
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: notificationCtor,
    });
    const connection = makeConnection({
      id: "conn-existing",
      warnOnClose: false,
      behaviorAutomation: {
        version: 1,
        rules: [
          {
            id: "ended-notification",
            name: "Ended notification",
            event: "session.ended",
            actions: [
              {
                type: "notify",
                title: "Automation ended",
                message: "Cleanup complete",
                sound: "off",
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    connectionMocks.state = {
      sessions: [session],
      connections: [connection],
    };
    SettingsManager.getInstance().applyInMemory({
      warnOnClose: true,
      confirmCloseActiveTab: false,
      notifyOnDisconnect: true,
    });
    const { result } = renderHook(() => useSessionManager());

    await act(async () => {
      await result.current.handleSessionClose(session.id);
    });

    expect(connectionMocks.executeScriptsForTrigger).toHaveBeenCalledWith(
      "onDisconnect",
      { connection, session },
    );
    const removeCall = connectionMocks.dispatch.mock.calls.find(
      ([action]) => action.type === "REMOVE_SESSION",
    );
    expect(removeCall?.[0]).toEqual({
      type: "REMOVE_SESSION",
      payload: session.id,
    });
    expect(notificationCtor).toHaveBeenCalledWith(
      "Automation ended",
      expect.objectContaining({
        body: "Cleanup complete",
        silent: true,
      }),
    );
    expect(
      notificationCtor.mock.calls.some(([title]) =>
        String(title).includes("Session disconnected"),
      ),
    ).toBe(false);
    expect(
      connectionMocks.executeScriptsForTrigger.mock.invocationCallOrder[0],
    ).toBeLessThan(connectionMocks.dispatch.mock.invocationCallOrder[0]);
    expect(connectionMocks.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      notificationCtor.mock.invocationCallOrder[0],
    );
  });

  it("coalesces duplicate manual reconnect requests through one pending primitive", async () => {
    vi.useFakeTimers();
    try {
      const connection = makeConnection({ id: "conn-existing" });
      const session = makeSession({ maxReconnectAttempts: 0 });
      connectionMocks.state = {
        sessions: [session],
        connections: [connection],
      };
      const { result, unmount } = renderHook(() => useSessionManager());

      await act(async () => {
        await Promise.all([
          result.current.handleReconnect(session),
          result.current.handleReconnect(session),
        ]);
        await vi.advanceTimersByTimeAsync(2000);
      });

      const reconnectUpdates = connectionMocks.dispatch.mock.calls.filter(
        ([action]) =>
          action.type === "UPDATE_SESSION" &&
          action.payload.status === "reconnecting",
      );
      expect(reconnectUpdates).toHaveLength(1);
      expect(reconnectUpdates[0][0].payload).toEqual(
        expect.objectContaining({
          id: session.id,
          reconnectAttempts: 1,
        }),
      );
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
