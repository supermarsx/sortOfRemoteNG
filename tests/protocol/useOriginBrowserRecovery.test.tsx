import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOriginBrowserRecovery } from "../../src/hooks/protocol/useOriginBrowserRecovery";
import {
  ORIGIN_BROWSER_RECOVERY_EVENT,
  requestOriginBrowserRecovery,
  type BrowserRecoveryDestination,
} from "../../src/utils/session/originBrowserRecovery";
import {
  clearRuntimeConnectionsForTests,
  registerQuickConnectConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

const f = vi.hoisted(() => ({
  context: {} as any,
  databaseId: "db-a",
  revoked: false,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => f.context,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: f.databaseId }),
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: f.databaseId,
        assertAccessible: () => {
          if (f.revoked) throw new Error("locked");
        },
      }),
    }),
  },
}));
const row = {
  id: "site",
  name: "Site",
  protocol: "https",
  hostname: "example.test",
  port: 443,
} as Connection;
const source = {
  id: "browser",
  connectionId: row.id,
  ownerDatabaseId: "db-a",
  protocol: "https",
} as ConnectionSession;
beforeEach(() => {
  f.databaseId = "db-a";
  f.revoked = false;
  f.context = {
    state: { connections: [row], sessions: [source] },
    databaseAvailability: {
      status: "ready",
      databaseId: "db-a",
      generation: 1,
    },
    getCurrentConnections: vi.fn(() => f.context.state.connections),
    dispatch: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  clearRuntimeConnectionsForTests();
  vi.clearAllMocks();
});
function fixture() {
  const options = {
    activateSession: vi.fn(),
    openDatabases: vi.fn(),
    openQuickConnect: vi.fn(),
  };
  const view = renderHook(() => useOriginBrowserRecovery(options));
  return { ...view, ...options };
}
function request(action: BrowserRecoveryDestination, assertCurrent = () => {}) {
  return requestOriginBrowserRecovery(
    {
      action,
      sessionId: source.id,
      connectionId: row.id,
      ownerDatabaseId: source.ownerDatabaseId,
    },
    assertCurrent,
  );
}
describe("native browser recovery destinations", () => {
  it.each([
    ["connection", "general", undefined],
    ["application", "protocol", "application"],
    ["credentials", "protocol", "authentication"],
    ["trust", "protocol", "security"],
    ["network", "protocol", "network-path"],
    ["browser-session", "protocol", "advanced"],
    ["legacy-proxy", "protocol", "advanced"],
  ] as const)(
    "opens %s in its actual editor section",
    (action, tab, subtab) => {
      const fxt = fixture();
      act(() => {
        expect(request(action)).toBe(true);
      });
      const dispatched = f.context.dispatch.mock.lastCall[0];
      expect(dispatched.type).toBe("ADD_SESSION");
      expect(dispatched.payload).toMatchObject({
        protocol: "tool:connectionEditor",
        connectionId: row.id,
        ownerDatabaseId: "db-a",
        browserRecoveryNavigation: {
          tab,
          ...(subtab ? { subtab } : {}),
          connectionId: row.id,
          ownerDatabaseId: "db-a",
        },
      });
      expect(fxt.activateSession).toHaveBeenCalledWith(dispatched.payload.id);
      expect(fxt.openQuickConnect).not.toHaveBeenCalled();
    },
  );
  it("uses the Application login fields for a profile and Basics for a linked vault source", () => {
    fixture();
    f.context.state.connections = [
      { ...row, httpApplication: { id: "synology-dsm" } },
    ];
    act(() => {
      request("credentials");
    });
    expect(
      f.context.dispatch.mock.lastCall[0].payload.browserRecoveryNavigation,
    ).toMatchObject({ tab: "protocol", subtab: "application" });
    f.context.state.connections = [
      { ...row, credentialSource: { kind: "vault" } },
    ];
    act(() => {
      request("credentials");
    });
    expect(
      f.context.dispatch.mock.lastCall[0].payload.browserRecoveryNavigation,
    ).toMatchObject({ tab: "general" });
  });
  it("focuses the same owner's existing editor and updates the requested tab", () => {
    const editor = {
      id: "editor",
      protocol: "tool:connectionEditor",
      connectionId: row.id,
      ownerDatabaseId: "db-a",
    };
    f.context.state.sessions.push(editor);
    const fxt = fixture();
    act(() => {
      request("application");
    });
    expect(f.context.dispatch.mock.lastCall[0]).toMatchObject({
      type: "UPDATE_SESSION",
      payload: { id: "editor" },
    });
    expect(fxt.activateSession).toHaveBeenCalledWith("editor");
  });
  it.each([
    "manager-owner",
    "provider-owner",
    "locked",
    "duplicate",
    "removed",
    "detached",
    "source-owner",
  ])("refuses saved editor recovery after %s changed", (change) => {
    fixture();
    if (change === "manager-owner") f.databaseId = "db-b";
    if (change === "provider-owner")
      f.context.databaseAvailability.databaseId = "db-b";
    if (change === "locked") f.revoked = true;
    if (change === "duplicate") f.context.state.connections = [row, row];
    if (change === "removed") f.context.state.connections = [];
    if (change === "detached")
      f.context.state.sessions = [{ ...source, layout: { isDetached: true } }];
    if (change === "source-owner")
      f.context.state.sessions = [{ ...source, ownerDatabaseId: "db-b" }];
    act(() => {
      expect(request("connection")).toBe(false);
    });
    expect(f.context.dispatch).not.toHaveBeenCalled();
  });
  it("rechecks the exact saved row at dispatch and rejects a replacement", () => {
    fixture();
    f.context.getCurrentConnections
      .mockReturnValueOnce([row])
      .mockReturnValueOnce([{ ...row }]);
    act(() => {
      expect(request("application")).toBe(false);
    });
    expect(f.context.dispatch).not.toHaveBeenCalled();
  });
  it("does not accept forged, replayed, or revoked renderer events", () => {
    const fxt = fixture();
    let issued: Event | undefined;
    const capture = (event: Event) => {
      issued = event;
    };
    window.addEventListener(ORIGIN_BROWSER_RECOVERY_EVENT, capture);
    act(() => {
      request("database");
    });
    window.removeEventListener(ORIGIN_BROWSER_RECOVERY_EVENT, capture);
    fxt.openDatabases.mockClear();
    act(() => {
      window.dispatchEvent(issued!);
      window.dispatchEvent(
        new CustomEvent(ORIGIN_BROWSER_RECOVERY_EVENT, {
          detail: {
            action: "database",
            sessionId: source.id,
            connectionId: row.id,
            ownerDatabaseId: "db-a",
          },
        }),
      );
      let checks = 0;
      expect(
        request("database", () => {
          if (++checks > 1) throw new Error("inactive");
        }),
      ).toBe(false);
    });
    expect(fxt.openDatabases).not.toHaveBeenCalled();
    fxt.unmount();
    expect(request("database")).toBe(false);
  });
  it("opens Database Center for an unavailable owner without selecting or unlocking another database", () => {
    const fxt = fixture();
    f.databaseId = "db-b";
    f.revoked = true;
    f.context.databaseAvailability = { status: "suspended" };
    act(() => {
      expect(request("database")).toBe(true);
    });
    expect(fxt.openDatabases).toHaveBeenCalledOnce();
    expect(f.context.dispatch).not.toHaveBeenCalled();
  });
  it("opens explicit Quick Connect correction without touching a saved connection", () => {
    f.context.state.connections = [];
    f.context.state.sessions = [{ ...source, ownerDatabaseId: undefined }];
    registerQuickConnectConnection(row);
    const fxt = fixture();
    const send = () =>
      requestOriginBrowserRecovery(
        { action: "quick-connect", sessionId: source.id, connectionId: row.id },
        () => {},
      );
    act(() => {
      expect(send()).toBe(true);
    });
    expect(fxt.openQuickConnect).toHaveBeenCalledOnce();
    expect(f.context.dispatch).not.toHaveBeenCalled();
    f.context.state.connections = [{ ...row }];
    act(() => {
      expect(send()).toBe(false);
    });
    expect(fxt.openQuickConnect).toHaveBeenCalledOnce();
  });
});
