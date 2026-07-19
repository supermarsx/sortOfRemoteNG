import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

const mocks = vi.hoisted(() => {
  const state = {
    connections: [] as Connection[],
    sessions: [] as ConnectionSession[],
  };
  const dispatch = vi.fn(
    (action: { type: string; payload: ConnectionSession | string }) => {
      if (action.type === "UPDATE_SESSION") {
        const updated = action.payload as ConnectionSession;
        state.sessions = state.sessions.map((session) =>
          session.id === updated.id ? updated : session,
        );
      } else if (action.type === "REMOVE_SESSION") {
        state.sessions = state.sessions.filter(
          (session) => session.id !== action.payload,
        );
      }
    },
  );
  return {
    state,
    dispatch,
    invoke: vi.fn(),
    settings: {
      confirmCloseActiveTab: false,
      warnOnClose: false,
      rdpSessionClosePolicy: "disconnect",
      retryAttempts: 0,
      retryDelay: 0,
      notifyOnConnect: false,
      notifyOnReconnect: false,
      notifyOnDisconnect: false,
      notifyOnError: false,
      notificationSound: false,
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

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));

vi.mock("../../utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: () => mocks.settings,
      logAction: vi.fn(),
      recordPerformanceMetric: vi.fn(),
    }),
  },
}));

vi.mock("../../utils/connection/statusChecker", () => ({
  StatusChecker: {
    getInstance: () => ({
      startChecking: vi.fn(),
      stopChecking: vi.fn(),
    }),
  },
}));

vi.mock("../../utils/recording/scriptEngine", () => ({
  ScriptEngine: {
    getInstance: () => ({
      executeScriptsForTrigger: mocks.executeScriptsForTrigger,
    }),
  },
}));

vi.mock("../../utils/session/runtimeConnectionRegistry", () => ({
  registerRuntimeConnection: vi.fn(),
  releaseRuntimeConnection: vi.fn(),
  resolveRuntimeConnection: (connections: Connection[], connectionId: string) =>
    connections.find((connection) => connection.id === connectionId),
}));

vi.mock("../../utils/behavior/windowActions", () => ({
  BehaviorWindowActionRuntime: class {
    constructor(_options: unknown) {}
  },
}));

vi.mock("../../utils/rdp/rdpSessionHistory", () => ({
  recordRdpSessionHistory: vi.fn(),
}));

vi.mock("./useSessionLifecycleEvents", () => ({
  useSessionLifecycleEvents: () => ({
    beginEnding: mocks.beginEnding,
    emitEnded: mocks.emitEnded,
    emitStarted: vi.fn(async () => undefined),
    emitInitialStatus: vi.fn(async () => undefined),
    emitWindowSignal: vi.fn(async () => undefined),
  }),
}));

import { useSessionManager } from "./useSessionManager";

const connection = (id: string): Connection => ({
  id,
  name: id,
  protocol: "ssh",
  hostname: `${id}.example.test`,
  port: 22,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  warnOnClose: false,
});

const session = (
  id: string,
  connectionId: string,
  ownerId: string,
): ConnectionSession => ({
  id,
  connectionId,
  name: id,
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: `${id}.example.test`,
  backendSessionId: "shared-native-ssh",
  shellId: `shell-${id}`,
  vpnLeaseOwnerId: ownerId,
});

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.invoke.mockReset();
  mocks.executeScriptsForTrigger.mockClear();
  mocks.beginEnding.mockClear();
  mocks.emitEnded.mockClear();
  mocks.settings.rdpSessionClosePolicy = "disconnect";
});

describe("useSessionManager VPN cleanup", () => {
  it("retries an orphaned RDP cleanup row without re-detaching its closed backend", async () => {
    mocks.settings.rdpSessionClosePolicy = "detach";
    const rdpConnection: Connection = {
      ...connection("rdp-orphan-connection"),
      protocol: "rdp",
      port: 3389,
    };
    const orphanedSession: ConnectionSession = {
      ...session("frontend-rdp-orphan", rdpConnection.id, "owner-current"),
      protocol: "rdp",
      backendSessionId: undefined,
      status: "error",
      errorMessage:
        "RDP disconnected, but VPN cleanup needs attention. Retry disconnect to finish cleanup.",
      vpnLeaseOwnerIds: ["owner-previous", "owner-current"],
    };
    mocks.state.connections = [rdpConnection];
    mocks.state.sessions = [orphanedSession];
    mocks.invoke.mockImplementation(
      (command: string, args?: { ownerId?: string }) => {
        if (command === "release_vpn_leases") {
          return Promise.resolve({
            owner_id: args?.ownerId,
            released: [],
            errors: [],
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useSessionManager());
    let closeResult = false;
    await act(async () => {
      closeResult = await result.current.handleSessionClose(orphanedSession.id);
    });

    expect(closeResult).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "detach_rdp_session",
      expect.anything(),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "disconnect_rdp",
      expect.anything(),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "owner-previous",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "owner-current",
    });
    expect(mocks.state.sessions).toEqual([]);
  });

  it("keeps a hidden RDP owner row when close policy detaches the live backend", async () => {
    mocks.settings.rdpSessionClosePolicy = "detach";
    const rdpConnection: Connection = {
      ...connection("rdp-connection"),
      protocol: "rdp",
      port: 3389,
    };
    const rdpSession: ConnectionSession = {
      ...session("frontend-rdp", rdpConnection.id, "owner-current"),
      protocol: "rdp",
      backendSessionId: "native-rdp",
      vpnLeaseOwnerIds: ["owner-previous", "owner-current"],
    };
    mocks.state.connections = [rdpConnection];
    mocks.state.sessions = [rdpSession];
    mocks.invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSessionManager());
    let closeResult = false;
    await act(async () => {
      closeResult = await result.current.handleSessionClose(rdpSession.id);
    });

    expect(closeResult).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("detach_rdp_session", {
      sessionId: "native-rdp",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "disconnect_rdp",
      expect.anything(),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "release_vpn_leases",
      expect.anything(),
    );
    expect(mocks.state.sessions).toEqual([
      expect.objectContaining({
        id: rdpSession.id,
        backendSessionId: "native-rdp",
        vpnLeaseOwnerId: "owner-current",
        vpnLeaseOwnerIds: ["owner-previous", "owner-current"],
        layout: expect.objectContaining({
          isDetached: true,
          windowId: undefined,
        }),
      }),
    ]);
    expect(mocks.beginEnding).not.toHaveBeenCalled();
    expect(mocks.executeScriptsForTrigger).not.toHaveBeenCalled();
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) => action.type === "REMOVE_SESSION",
      ),
    ).toBe(false);
  });

  it("retains associated owners after partial cleanup and retries without closing the backend twice", async () => {
    const connectionA = connection("connection-a");
    const connectionB = connection("connection-b");
    mocks.state.connections = [connectionA, connectionB];
    mocks.state.sessions = [
      session("frontend-a", connectionA.id, "owner-a"),
      session("frontend-b", connectionB.id, "owner-b"),
    ];
    let ownerBAttempts = 0;
    mocks.invoke.mockImplementation(
      (command: string, args?: { ownerId?: string }) => {
        if (command === "disconnect_ssh") return Promise.resolve(undefined);
        if (command === "release_vpn_leases") {
          if (args?.ownerId === "owner-b") ownerBAttempts += 1;
          return Promise.resolve({
            owner_id: args?.ownerId,
            released: [],
            errors:
              args?.ownerId === "owner-b" && ownerBAttempts === 1
                ? ["provider still stopping"]
                : [],
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useSessionManager());
    let firstResult = true;
    await act(async () => {
      firstResult = await result.current.handleSessionClose("frontend-a");
    });

    expect(firstResult).toBe(false);
    expect(mocks.state.sessions).toHaveLength(2);
    expect(mocks.state.sessions.find((row) => row.id === "frontend-a")).toEqual(
      expect.objectContaining({
        vpnLeaseOwnerId: undefined,
        status: "error",
        backendSessionId: "shared-native-ssh",
        errorMessage: expect.stringMatching(/VPN cleanup needs attention/i),
      }),
    );
    expect(mocks.state.sessions.find((row) => row.id === "frontend-b")).toEqual(
      expect.objectContaining({
        vpnLeaseOwnerId: "owner-b",
        status: "error",
        backendSessionId: "shared-native-ssh",
        errorMessage: expect.stringMatching(/VPN cleanup needs attention/i),
      }),
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_ssh",
      ),
    ).toHaveLength(1);
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) => action.type === "REMOVE_SESSION",
      ),
    ).toBe(false);

    let retryResult = false;
    await act(async () => {
      retryResult = await result.current.handleSessionClose("frontend-b");
    });
    expect(retryResult).toBe(true);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_ssh",
      ),
    ).toHaveLength(1);
    expect(ownerBAttempts).toBe(2);
    expect(mocks.state.sessions).toEqual([
      expect.objectContaining({
        id: "frontend-a",
        status: "disconnected",
        vpnLeaseOwnerId: undefined,
      }),
    ]);
  });
});
