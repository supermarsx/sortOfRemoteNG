/**
 * t63 — sessions that never had a live transport (`error` / `connecting`,
 * no active VPN binding) must ALWAYS close: no confirmations, no RDP
 * detach-into-background, best-effort backend cleanup whose failures are
 * logged + alerted but never keep the tab. Live sessions keep the existing
 * fail-closed semantics (negative controls at the bottom).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => {
  const holder = {
    state: {
      connections: [] as Connection[],
      sessions: [] as ConnectionSession[],
    },
  };
  const dispatch = vi.fn(
    (action: { type: string; payload: ConnectionSession | string }) => {
      const { state } = holder;
      if (action.type === "UPDATE_SESSION") {
        const updated = action.payload as ConnectionSession;
        holder.state = {
          ...state,
          sessions: state.sessions.map((session) =>
            session.id === updated.id ? updated : session,
          ),
        };
      } else if (action.type === "REMOVE_SESSION") {
        holder.state = {
          ...state,
          sessions: state.sessions.filter(
            (session) => session.id !== action.payload,
          ),
        };
      } else if (action.type === "ADD_SESSION") {
        holder.state = {
          ...state,
          sessions: [...state.sessions, action.payload as ConnectionSession],
        };
      }
    },
  );
  return {
    holder,
    dispatch,
    invoke: vi.fn(),
    logAction: vi.fn(),
    releaseIntegrationSession: vi.fn(
      async (_sessionId: string): Promise<void> => undefined,
    ),
    settings: {
      confirmCloseActiveTab: true,
      warnOnClose: true,
      rdpSessionClosePolicy: "detach" as "detach" | "ask" | "disconnect",
      retryAttempts: 0,
      retryDelay: 0,
      notifyOnConnect: false,
      notifyOnReconnect: false,
      notifyOnDisconnect: false,
      notifyOnError: false,
      notificationSound: false,
      reconnectOnReload: false,
    },
    executeScriptsForTrigger: vi.fn(async () => undefined),
    beginEnding: vi.fn(),
    emitEnded: vi.fn(async () => undefined),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: mocks.holder.state,
    dispatch: mocks.dispatch,
  }),
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: () => mocks.settings,
      logAction: mocks.logAction,
      recordPerformanceMetric: vi.fn(),
    }),
  },
}));

vi.mock("../../src/utils/connection/statusChecker", () => ({
  StatusChecker: {
    getInstance: () => ({
      startChecking: vi.fn(),
      stopChecking: vi.fn(),
      cleanup: vi.fn(),
    }),
  },
}));

vi.mock("../../src/utils/recording/scriptEngine", () => ({
  ScriptEngine: {
    getInstance: () => ({
      executeScriptsForTrigger: mocks.executeScriptsForTrigger,
    }),
  },
}));

vi.mock("../../src/utils/session/runtimeConnectionRegistry", () => ({
  registerRuntimeConnection: vi.fn(),
  releaseRuntimeConnection: vi.fn(),
  resolveRuntimeConnection: (connections: Connection[], connectionId: string) =>
    connections.find((connection) => connection.id === connectionId),
}));

vi.mock("../../src/utils/behavior/windowActions", () => ({
  BehaviorWindowActionRuntime: class {
    constructor(_options: unknown) {}
  },
}));

vi.mock("../../src/utils/rdp/rdpSessionHistory", () => ({
  recordRdpSessionHistory: vi.fn(),
}));

vi.mock("../../src/hooks/session/useSessionLifecycleEvents", () => ({
  useSessionLifecycleEvents: () => ({
    beginEnding: mocks.beginEnding,
    emitEnded: mocks.emitEnded,
    emitStarted: vi.fn(async () => undefined),
    emitInitialStatus: vi.fn(async () => undefined),
    emitWindowSignal: vi.fn(async () => undefined),
  }),
}));

vi.mock("../../src/hooks/integrations/IntegrationSessionLifecycle", () => ({
  reconnectIntegrationSession: vi.fn(async () => undefined),
  releaseIntegrationSession: (sessionId: string) =>
    mocks.releaseIntegrationSession(sessionId),
}));

import { useSessionManager } from "../../src/hooks/session/useSessionManager";

const makeConnection = (
  id: string,
  overrides: Partial<Connection> = {},
): Connection =>
  ({
    id,
    name: id,
    protocol: "ssh",
    hostname: "127.0.0.1",
    port: 1,
    isGroup: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Connection;

const makeSession = (
  id: string,
  connectionId: string,
  overrides: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id,
  connectionId,
  name: id,
  status: "error",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: "127.0.0.1",
  ...overrides,
});

const seed = (connections: Connection[], sessions: ConnectionSession[]) => {
  mocks.holder.state = { connections, sessions };
};

const sessions = () => mocks.holder.state.sessions;

const removeDispatched = (id: string) =>
  mocks.dispatch.mock.calls.some(
    ([action]) => action.type === "REMOVE_SESSION" && action.payload === id,
  );

const invokedCommands = () =>
  mocks.invoke.mock.calls.map(([command]) => command);

/**
 * `handleSessionClose` never resolves while a confirm dialog is pending, so
 * race it against a short timer: `"pending"` means a dialog blocked it.
 */
const closeOrPending = async (
  close: () => Promise<boolean>,
): Promise<boolean | "pending"> => {
  let outcome: boolean | "pending" = "pending";
  await act(async () => {
    outcome = await Promise.race<boolean | "pending">([
      close(),
      new Promise<"pending">((resolve) =>
        setTimeout(() => resolve("pending"), 150),
      ),
    ]);
  });
  return outcome;
};

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.logAction.mockClear();
  mocks.releaseIntegrationSession.mockReset();
  mocks.releaseIntegrationSession.mockResolvedValue(undefined);
  mocks.executeScriptsForTrigger.mockClear();
  mocks.beginEnding.mockClear();
  mocks.emitEnded.mockClear();
  mocks.settings.confirmCloseActiveTab = true;
  mocks.settings.warnOnClose = true;
  mocks.settings.rdpSessionClosePolicy = "detach";
  seed([], []);
});

describe("handleSessionClose — sessions with no live transport", () => {
  it("closes an error SSH tab with no backend id: no confirm even with warnOnClose", async () => {
    const conn = makeConnection("ssh-1", { warnOnClose: true });
    const session = makeSession("s-error", conn.id);
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    act(() => result.current.setActiveSessionId(session.id));

    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(removeDispatched(session.id)).toBe(true);
    expect(sessions()).toEqual([]);
    // No dialog of any kind was queued (confirm or alert).
    expect(result.current.confirmDialog).toBeNull();
    expect(mocks.logAction).not.toHaveBeenCalledWith(
      "error",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("disconnects an error MySQL tab through mysql_disconnect with its backend session id", async () => {
    const conn = makeConnection("mysql-1", { protocol: "mysql", port: 3306 });
    const session = makeSession("s-mysql", conn.id, {
      protocol: "mysql",
      backendSessionId: "mysql-backend-7",
    });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_disconnect", {
      sessionId: "mysql-backend-7",
    });
    expect(invokedCommands()).not.toContain("disconnect_db");
    expect(sessions()).toEqual([]);
  });

  it("disconnects an error MongoDB tab through mongo_disconnect with its backend session id", async () => {
    const conn = makeConnection("mongo-1", {
      protocol: "mongodb",
      port: 27017,
    });
    const session = makeSession("s-mongo", conn.id, {
      protocol: "mongodb",
      backendSessionId: "mongo-backend-3",
    });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("mongo_disconnect", {
      sessionId: "mongo-backend-3",
    });
    expect(sessions()).toEqual([]);
  });

  it("skips the MySQL backend disconnect when the tab never got a backend session id", async () => {
    const conn = makeConnection("mysql-2", { protocol: "mysql", port: 3306 });
    const session = makeSession("s-mysql-none", conn.id, { protocol: "mysql" });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(invokedCommands()).not.toContain("mysql_disconnect");
    expect(invokedCommands()).not.toContain("disconnect_db");
    expect(sessions()).toEqual([]);
  });

  it("closes a connecting SSH tab without confirmation", async () => {
    const conn = makeConnection("ssh-2");
    const session = makeSession("s-connecting", conn.id, {
      status: "connecting",
    });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(sessions()).toEqual([]);
    expect(result.current.confirmDialog).toBeNull();
  });

  it("still removes an error SSH tab when disconnect_ssh rejects: logs + alerts", async () => {
    const conn = makeConnection("ssh-3");
    const session = makeSession("s-backend", conn.id, {
      backendSessionId: "native-ssh",
      vpnLeaseOwnerId: "owner-1",
      vpnLeaseOwnerIds: ["owner-1"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-1",
          backendSessionId: "native-ssh",
          protocol: "ssh",
          status: "cleanup-pending",
        },
      ],
    });
    seed([conn], [session]);
    mocks.invoke.mockImplementation((command: string) =>
      command === "disconnect_ssh"
        ? Promise.reject(new Error("transport cleanup timeout"))
        : Promise.resolve(undefined),
    );

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(invokedCommands()).toContain("disconnect_ssh");
    expect(removeDispatched(session.id)).toBe(true);
    expect(sessions()).toEqual([]);
    expect(mocks.logAction).toHaveBeenCalledWith(
      "error",
      "Session cleanup incomplete",
      conn.id,
      expect.stringMatching(/VPN manager/i),
    );
    // Non-blocking alert was queued (an alert dialog has no cancel handler).
    expect(result.current.confirmDialog).not.toBeNull();
    expect(result.current.confirmDialog?.props.onCancel).toBeUndefined();
    expect(result.current.confirmDialog?.props.message).toMatch(
      /cleanup did not complete/i,
    );
    expect(mocks.beginEnding).toHaveBeenCalledWith(session.id);
  });

  it("removes an error SSH tab whose VPN owner ids have no backend id (owner-only branch)", async () => {
    const conn = makeConnection("ssh-4");
    const session = makeSession("s-owner-only", conn.id, {
      vpnLeaseOwnerIds: ["owner-stale"],
    });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(sessions()).toEqual([]);
    expect(mocks.logAction).toHaveBeenCalledWith(
      "error",
      "Session cleanup incomplete",
      conn.id,
      expect.stringMatching(/cannot be released automatically/i),
    );
    expect(result.current.confirmDialog?.props.onCancel).toBeUndefined();
    expect(result.current.confirmDialog?.props.message).toMatch(
      /VPN ownership/i,
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "disconnect_ssh",
      expect.anything(),
    );
  });

  it.each(["detach", "ask"] as const)(
    "connecting RDP tab with close policy %s is disconnected, never detached, no dialog",
    async (policy) => {
      mocks.settings.rdpSessionClosePolicy = policy;
      const conn = makeConnection("rdp-1", { protocol: "rdp", port: 3389 });
      const session = makeSession("s-rdp-connecting", conn.id, {
        protocol: "rdp",
        status: "connecting",
        backendSessionId: "native-rdp",
      });
      seed([conn], [session]);

      const { result } = renderHook(() => useSessionManager());
      const outcome = await closeOrPending(() =>
        result.current.handleSessionClose(session.id),
      );

      expect(outcome).toBe(true);
      expect(mocks.invoke).toHaveBeenCalledWith("disconnect_rdp", {
        sessionId: "native-rdp",
      });
      expect(invokedCommands()).not.toContain("detach_rdp_session");
      expect(removeDispatched(session.id)).toBe(true);
      expect(sessions()).toEqual([]);
      expect(
        mocks.dispatch.mock.calls.some(
          ([action]) =>
            action.type === "UPDATE_SESSION" &&
            (action.payload as ConnectionSession).layout?.isDetached === true,
        ),
      ).toBe(false);
      expect(result.current.confirmDialog).toBeNull();
    },
  );

  it("error RDP tab with a per-connection 'ask' policy closes without asking", async () => {
    const conn = makeConnection("rdp-ask", {
      protocol: "rdp",
      port: 3389,
      rdpSettings: {
        advanced: { sessionClosePolicy: "ask" },
      } as unknown as Connection["rdpSettings"],
    });
    const session = makeSession("s-rdp-error", conn.id, { protocol: "rdp" });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(sessions()).toEqual([]);
    expect(invokedCommands()).not.toContain("detach_rdp_session");
    expect(result.current.confirmDialog).toBeNull();
  });

  it("error RDP tab with a backend id whose disconnect_rdp rejects is still removed and logged", async () => {
    const conn = makeConnection("rdp-2", { protocol: "rdp", port: 3389 });
    const session = makeSession("s-rdp-failed", conn.id, {
      protocol: "rdp",
      backendSessionId: "native-rdp-failed",
    });
    seed([conn], [session]);
    mocks.invoke.mockImplementation((command: string) =>
      command === "disconnect_rdp"
        ? Promise.reject(new Error("no such session"))
        : Promise.resolve(undefined),
    );

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_rdp", {
      sessionId: "native-rdp-failed",
    });
    expect(invokedCommands()).not.toContain("detach_rdp_session");
    expect(sessions()).toEqual([]);
    expect(mocks.logAction).toHaveBeenCalledWith(
      "error",
      "Session cleanup incomplete",
      conn.id,
      expect.stringMatching(/RDP backend\/VPN cleanup did not complete/i),
    );
  });

  it("integration panel in error state is removed even when provider cleanup rejects", async () => {
    const conn = makeConnection("grafana", {
      protocol: "integration:grafana",
      integration: { descriptorKey: "grafana", instanceId: "inst" },
    } as Partial<Connection>);
    const session = makeSession("s-integration", conn.id, {
      protocol: "integration:grafana",
      integration: conn.integration,
    });
    seed([conn], [session]);
    mocks.releaseIntegrationSession.mockRejectedValueOnce(
      new Error("provider cleanup failed"),
    );

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(mocks.releaseIntegrationSession).toHaveBeenCalledWith(session.id);
    expect(removeDispatched(session.id)).toBe(true);
    expect(sessions()).toEqual([]);
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) =>
          action.type === "UPDATE_SESSION" &&
          /kept open/i.test(
            (action.payload as ConnectionSession).errorMessage ?? "",
          ),
      ),
    ).toBe(false);
    expect(mocks.logAction).toHaveBeenCalledWith(
      "error",
      "Session cleanup incomplete",
      conn.id,
      expect.stringMatching(/Integration cleanup failed/i),
    );
    expect(result.current.confirmDialog?.props.onCancel).toBeUndefined();
  });

  it("singleConnectionMode authoritative close of a failed session returns true", async () => {
    const conn = makeConnection("ssh-auth");
    const session = makeSession("s-auth", conn.id);
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id, session),
    );

    expect(outcome).toBe(true);
    expect(sessions()).toEqual([]);
  });

  it("moves the active tab to the next remaining session", async () => {
    const conn = makeConnection("ssh-5");
    const failed = makeSession("s-failed", conn.id);
    const other = makeSession("s-other", conn.id, { status: "disconnected" });
    seed([conn], [failed, other]);

    const { result } = renderHook(() => useSessionManager());
    act(() => result.current.setActiveSessionId(failed.id));
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(failed.id),
    );

    expect(outcome).toBe(true);
    expect(result.current.activeSessionId).toBe(other.id);
  });
});

describe("handleSessionClose — negative controls (live sessions keep fail-closed semantics)", () => {
  it("connected SSH with failing VPN cleanup still returns false and stays", async () => {
    mocks.settings.warnOnClose = false;
    mocks.settings.confirmCloseActiveTab = false;
    const conn = makeConnection("ssh-live", { warnOnClose: false });
    const session = makeSession("s-live", conn.id, {
      status: "connected",
      backendSessionId: "native-live",
      vpnLeaseOwnerId: "owner-live",
      vpnLeaseOwnerIds: ["owner-live"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-live",
          backendSessionId: "native-live",
          protocol: "ssh",
          status: "active",
        },
      ],
    });
    seed([conn], [session]);
    mocks.invoke.mockImplementation((command: string) =>
      command === "disconnect_ssh"
        ? Promise.reject(new Error("transport cleanup timeout"))
        : Promise.resolve(undefined),
    );

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(false);
    expect(removeDispatched(session.id)).toBe(false);
    expect(sessions()).toEqual([
      expect.objectContaining({ id: session.id, status: "error" }),
    ]);
    expect(mocks.logAction).not.toHaveBeenCalledWith(
      "error",
      "Session cleanup incomplete",
      expect.anything(),
      expect.anything(),
    );
  });

  it("connected SSH with warnOnClose still asks for confirmation", async () => {
    const conn = makeConnection("ssh-warn", { warnOnClose: true });
    const session = makeSession("s-warn", conn.id, { status: "connected" });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe("pending");
    expect(result.current.confirmDialog?.props.message).toBe(
      "dialogs.confirmClose",
    );
    expect(sessions()).toHaveLength(1);
  });

  it("connected RDP with 'detach' policy still detaches instead of disconnecting", async () => {
    const conn = makeConnection("rdp-live", { protocol: "rdp", port: 3389 });
    const session = makeSession("s-rdp-live", conn.id, {
      protocol: "rdp",
      status: "connected",
      backendSessionId: "native-rdp-live",
    });
    seed([conn], [session]);

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("detach_rdp_session", {
      sessionId: "native-rdp-live",
    });
    expect(invokedCommands()).not.toContain("disconnect_rdp");
    expect(removeDispatched(session.id)).toBe(false);
    expect(sessions()).toEqual([
      expect.objectContaining({
        id: session.id,
        layout: expect.objectContaining({ isDetached: true }),
      }),
    ]);
  });

  it("error session with an ACTIVE VPN binding stays fail-closed (intended exception)", async () => {
    mocks.settings.warnOnClose = false;
    const conn = makeConnection("ssh-active-route", { warnOnClose: false });
    const session = makeSession("s-active-route", conn.id, {
      status: "error",
      backendSessionId: "native-route",
      vpnLeaseOwnerId: "owner-route",
      vpnLeaseOwnerIds: ["owner-route"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-route",
          backendSessionId: "native-route",
          protocol: "ssh",
          status: "active",
        },
      ],
    });
    seed([conn], [session]);
    mocks.invoke.mockImplementation((command: string) =>
      command === "disconnect_ssh"
        ? Promise.reject(new Error("transport cleanup timeout"))
        : Promise.resolve(undefined),
    );

    const { result } = renderHook(() => useSessionManager());
    const outcome = await closeOrPending(() =>
      result.current.handleSessionClose(session.id),
    );

    expect(outcome).toBe(false);
    expect(removeDispatched(session.id)).toBe(false);
    expect(sessions()).toHaveLength(1);
  });
});

describe("restoreSession duplicate check", () => {
  it("reads current state, not the render-time closure", async () => {
    const conn = makeConnection("ssh-restore");
    seed([conn], []);
    const { result, rerender } = renderHook(() => useSessionManager());

    // Capture the closure the lifecycle hook would hold in a timer.
    const staleRestore = result.current.restoreSession;

    act(() => {
      mocks.dispatch({
        type: "ADD_SESSION",
        payload: makeSession("restored-1", conn.id, {
          status: "disconnected",
        }),
      });
    });
    rerender();
    mocks.dispatch.mockClear();

    await act(async () => {
      await staleRestore(
        {
          id: "restored-1",
          connectionId: conn.id,
          name: conn.name,
          protocol: "ssh",
          hostname: conn.hostname,
          status: "disconnected",
        },
        conn,
      );
    });

    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) => action.type === "ADD_SESSION",
      ),
    ).toBe(false);
    expect(sessions()).toHaveLength(1);
    expect(result.current.activeSessionId).toBe("restored-1");
  });
});
