import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUnsupportedDirectSessionMessage,
  isSingletonIntegrationProtocol,
  useSessionManager,
  usesGenericSessionTimer,
} from "../../src/hooks/session/useSessionManager";
import { PROTOCOL_OPTIONS } from "../../src/hooks/connection/useConnectionEditor";
import type {
  Connection,
  ConnectionProtocol,
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
  reconnectIntegrationSession: vi.fn(),
  releaseIntegrationSession: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => connectionMocks.invoke(...args),
}));

vi.mock("../../src/hooks/integrations/IntegrationSessionLifecycle", () => ({
  reconnectIntegrationSession: (sessionId: string) =>
    connectionMocks.reconnectIntegrationSession(sessionId),
  releaseIntegrationSession: (sessionId: string) =>
    connectionMocks.releaseIntegrationSession(sessionId),
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

const singletonIntegrationProtocols = [
  "integration:exchange",
  "integration:gdrive",
  "integration:lxd",
  "integration:vmware",
  "integration:vmwareDesktop",
] satisfies readonly ConnectionProtocol[];

describe("useSessionManager settings effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRuntimeConnectionsForTests();
    SettingsManager.resetInstance();
    connectionMocks.state = { sessions: [], connections: [] };
    connectionMocks.executeScriptsForTrigger.mockResolvedValue(undefined);
    connectionMocks.invoke.mockResolvedValue(undefined);
    connectionMocks.reconnectIntegrationSession.mockResolvedValue(false);
    connectionMocks.releaseIntegrationSession.mockResolvedValue(true);
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

  it("classifies only process-wide native integration services as singletons", () => {
    expect(
      singletonIntegrationProtocols.every(isSingletonIntegrationProtocol),
    ).toBe(true);
    expect(isSingletonIntegrationProtocol("integration:keepass")).toBe(false);
    expect(isSingletonIntegrationProtocol("integration:mssql")).toBe(false);
    expect(isSingletonIntegrationProtocol("integration:ansible")).toBe(false);
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

  it.each(singletonIntegrationProtocols)(
    "allows only one healthy %s native session but ignores cold disconnected tabs",
    async (protocol) => {
      const firstDrive = makeConnection({
        id: "gdrive-first",
        name: "First Drive",
        protocol,
      });
      const secondDrive = makeConnection({
        id: "gdrive-second",
        name: "Second Drive",
        protocol,
      });
      connectionMocks.state = {
        sessions: [
          makeSession({
            id: "gdrive-first-session",
            connectionId: firstDrive.id,
            protocol,
            status: "connected",
          }),
        ],
        connections: [firstDrive, secondDrive],
      };
      const { result, rerender } = renderHook(() => useSessionManager());

      let blocked!: Promise<void>;
      act(() => {
        blocked = result.current.handleConnect(secondDrive);
      });
      await waitFor(() =>
        expect(result.current.confirmDialog?.props.message).toMatch(
          /one process-wide native session.*different saved instance/i,
        ),
      );
      expect(connectionMocks.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "ADD_SESSION" }),
      );
      act(() => result.current.confirmDialog?.props.onConfirm());
      await blocked;

      connectionMocks.dispatch.mockClear();
      connectionMocks.state = {
        sessions: [
          makeSession({
            id: "gdrive-first-error",
            connectionId: firstDrive.id,
            protocol,
            status: "disconnected",
          }),
        ],
        connections: [firstDrive, secondDrive],
      };
      rerender();

      await act(async () => {
        await result.current.handleConnect(secondDrive);
      });
      expect(connectionMocks.dispatch).toHaveBeenCalledWith({
        type: "ADD_SESSION",
        payload: expect.objectContaining({ connectionId: secondDrive.id }),
      });
      expect(result.current.activeSessionId).not.toBe("gdrive-first-error");
    },
  );

  it("does not reconnect a singleton integration over another active saved instance", async () => {
    const protocol = "integration:vmware";
    const firstConnection = makeConnection({
      id: "vmware-first",
      protocol,
    });
    const secondConnection = makeConnection({
      id: "vmware-second",
      protocol,
    });
    const activeSession = makeSession({
      id: "vmware-active",
      connectionId: firstConnection.id,
      protocol,
      status: "connected",
    });
    const disconnectedSession = makeSession({
      id: "vmware-disconnected",
      connectionId: secondConnection.id,
      protocol,
      status: "disconnected",
    });
    connectionMocks.state = {
      sessions: [activeSession, disconnectedSession],
      connections: [firstConnection, secondConnection],
    };
    const { result } = renderHook(() => useSessionManager());

    let reconnectPromise!: Promise<void>;
    act(() => {
      reconnectPromise = result.current.handleReconnect(disconnectedSession);
    });
    await waitFor(() =>
      expect(result.current.confirmDialog?.props.message).toMatch(
        /one process-wide native session.*reconnect a different saved instance/i,
      ),
    );
    act(() => result.current.confirmDialog?.props.onConfirm());
    await reconnectPromise;

    expect(connectionMocks.reconnectIntegrationSession).not.toHaveBeenCalled();
  });

  it("keeps a cleanup-failed singleton as owner and blocks a different saved instance", async () => {
    const protocol = "integration:vmware" satisfies ConnectionProtocol;
    const firstConnection = makeConnection({
      id: "vmware-cleanup-owner",
      protocol,
      warnOnClose: false,
    });
    const secondConnection = makeConnection({
      id: "vmware-second-instance",
      protocol,
    });
    const ownerSession = makeSession({
      id: "vmware-cleanup-owner-session",
      connectionId: firstConnection.id,
      protocol,
      status: "connected",
    });
    connectionMocks.state = {
      sessions: [ownerSession],
      connections: [firstConnection, secondConnection],
    };
    connectionMocks.releaseIntegrationSession.mockRejectedValueOnce(
      new Error("native logout failed"),
    );
    const { result, rerender } = renderHook(() => useSessionManager());

    await act(async () => {
      await expect(
        result.current.handleSessionClose(ownerSession.id),
      ).resolves.toBe(false);
    });
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: ownerSession.id,
        status: "error",
        errorMessage: expect.stringMatching(/cleanup failed.*kept open/i),
      }),
    });

    connectionMocks.dispatch.mockClear();
    connectionMocks.state = {
      sessions: [
        {
          ...ownerSession,
          status: "error",
          errorMessage:
            "Integration cleanup failed and the session was kept open.",
        },
      ],
      connections: [firstConnection, secondConnection],
    };
    rerender();

    let blocked!: Promise<void>;
    act(() => {
      blocked = result.current.handleConnect(secondConnection);
    });
    await waitFor(() =>
      expect(result.current.confirmDialog?.props.message).toMatch(
        /one process-wide native session.*different saved instance/i,
      ),
    );
    expect(connectionMocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_SESSION" }),
    );
    act(() => result.current.confirmDialog?.props.onConfirm());
    await blocked;
  });

  it("singleConnectionMode replaces the existing session even when the old count was at the limit", async () => {
    connectionMocks.state = {
      sessions: [makeSession()],
      connections: [makeConnection({ id: "conn-existing" })],
    };
    SettingsManager.getInstance().applyInMemory({
      singleConnectionMode: true,
      maxConcurrentConnections: 1,
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

  it("singleConnectionMode keeps an integration session and aborts replacement when cleanup fails", async () => {
    const existingConnection = makeConnection({
      id: "grafana-existing",
      name: "Existing Grafana",
      protocol: "integration:grafana",
      integration: {
        descriptorKey: "grafana",
        instanceId: "grafana-instance",
      },
    });
    const existingSession = makeSession({
      id: "grafana-session",
      connectionId: existingConnection.id,
      name: existingConnection.name,
      protocol: existingConnection.protocol,
      integration: existingConnection.integration,
    });
    connectionMocks.state = {
      sessions: [existingSession],
      connections: [existingConnection],
    };
    connectionMocks.releaseIntegrationSession.mockRejectedValueOnce(
      new Error("native cleanup failed"),
    );
    SettingsManager.getInstance().applyInMemory({
      singleConnectionMode: true,
    });
    const { result } = renderHook(() => useSessionManager());

    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.handleConnect(makeConnection());
    });
    await waitFor(() =>
      expect(result.current.confirmDialog?.props.message).toMatch(
        /close existing connection/i,
      ),
    );
    act(() => result.current.confirmDialog?.props.onConfirm());

    await waitFor(() =>
      expect(result.current.confirmDialog?.props.message).toMatch(
        /could not close.*new connection was not opened/i,
      ),
    );
    act(() => result.current.confirmDialog?.props.onConfirm());
    await connectPromise;

    expect(connectionMocks.releaseIntegrationSession).toHaveBeenCalledWith(
      existingSession.id,
    );
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: existingSession.id,
        status: "error",
        errorMessage: expect.stringMatching(/cleanup failed.*kept open/i),
      }),
    });
    expect(connectionMocks.dispatch).not.toHaveBeenCalledWith({
      type: "REMOVE_SESSION",
      payload: existingSession.id,
    });
    expect(connectionMocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_SESSION",
        payload: expect.objectContaining({ connectionId: "conn-new" }),
      }),
    );
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

  it("restores an integration tab truthfully disconnected without starting a backend transport", async () => {
    const connection = makeConnection({
      id: "grafana-connection",
      name: "Grafana",
      protocol: "integration:grafana",
      hostname: "grafana.example.test",
      integration: {
        descriptorKey: "grafana",
        instanceId: "grafana-instance",
        credentialRefId: "vault-ref",
      },
    });
    const { result } = renderHook(() => useSessionManager());
    connectionMocks.dispatch.mockClear();
    connectionMocks.invoke.mockClear();
    connectionMocks.startChecking.mockClear();

    await act(async () => {
      await result.current.restoreSession(
        {
          id: "restored-grafana",
          connectionId: connection.id,
          name: connection.name,
          protocol: connection.protocol,
          hostname: connection.hostname,
          status: "connected",
          integration: connection.integration,
        },
        connection,
      );
    });

    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        id: "restored-grafana",
        status: "disconnected",
        integration: connection.integration,
      }),
    });
    expect(connectionMocks.invoke).not.toHaveBeenCalled();
    expect(connectionMocks.startChecking).not.toHaveBeenCalled();
  });

  it("keeps a failed integration cleanup open and lets a later close retry succeed", async () => {
    const connection = makeConnection({
      id: "grafana-connection",
      protocol: "integration:grafana",
      warnOnClose: false,
      integration: {
        descriptorKey: "grafana",
        instanceId: "grafana-instance",
      },
    });
    const session = makeSession({
      id: "grafana-session",
      connectionId: connection.id,
      protocol: connection.protocol,
      status: "connected",
      integration: connection.integration,
    });
    connectionMocks.state = {
      sessions: [session],
      connections: [connection],
    };
    connectionMocks.releaseIntegrationSession
      .mockRejectedValueOnce(new Error("provider cleanup failed"))
      .mockResolvedValueOnce(true);
    const { result } = renderHook(() => useSessionManager());
    connectionMocks.dispatch.mockClear();

    await act(async () => {
      await expect(result.current.handleSessionClose(session.id)).resolves.toBe(
        false,
      );
    });

    expect(connectionMocks.releaseIntegrationSession).toHaveBeenCalledWith(
      session.id,
    );
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: session.id,
        status: "error",
        errorMessage: expect.stringMatching(
          /cleanup failed.*kept open.*retry close/i,
        ),
      }),
    });
    expect(connectionMocks.dispatch).not.toHaveBeenCalledWith({
      type: "REMOVE_SESSION",
      payload: session.id,
    });

    connectionMocks.dispatch.mockClear();
    await act(async () => {
      await expect(result.current.handleSessionClose(session.id)).resolves.toBe(
        true,
      );
    });
    expect(connectionMocks.releaseIntegrationSession).toHaveBeenCalledTimes(2);
    expect(connectionMocks.dispatch).toHaveBeenCalledWith({
      type: "REMOVE_SESSION",
      payload: session.id,
    });
  });

  it("returns a cold integration reconnect to disconnected with an actionable fallback", async () => {
    vi.useFakeTimers();
    try {
      const connection = makeConnection({
        id: "grafana-connection",
        protocol: "integration:grafana",
        integration: {
          descriptorKey: "grafana",
          instanceId: "grafana-instance",
        },
      });
      const session = makeSession({
        id: "grafana-session",
        connectionId: connection.id,
        protocol: connection.protocol,
        status: "disconnected",
        integration: connection.integration,
      });
      connectionMocks.state = {
        sessions: [session],
        connections: [connection],
      };
      connectionMocks.reconnectIntegrationSession.mockResolvedValue(false);
      const { result } = renderHook(() => useSessionManager());
      connectionMocks.dispatch.mockClear();

      await act(async () => {
        await result.current.handleReconnect(session);
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(connectionMocks.reconnectIntegrationSession).toHaveBeenCalledWith(
        session.id,
      );
      expect(connectionMocks.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          id: session.id,
          status: "disconnected",
          errorMessage: expect.stringMatching(
            /no live integration connection.*open the panel/i,
          ),
        }),
      });
    } finally {
      vi.useRealTimers();
    }
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
