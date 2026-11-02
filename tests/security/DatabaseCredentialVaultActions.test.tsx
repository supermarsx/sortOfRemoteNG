import React, { useCallback, useEffect, useReducer } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DatabaseCredentialVault from "../../src/components/security/DatabaseCredentialVault";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../src/types/security/databaseCredentialVault";
import { databaseCredentialMetadata } from "../../src/utils/security/databaseCredentialVault";
import { Sidebar } from "../../src/components/connection/Sidebar";
import { connectionReducer } from "../../src/contexts/ConnectionProvider";
import SettingsContext, {
  defaultSettings,
} from "../../src/contexts/SettingsContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import type { ConnectionState } from "../../src/contexts/ConnectionContextTypes";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  compute: vi.fn(),
  currentDatabase: "db",
  target: null as any,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("../../src/hooks/totp/useTOTP", () => ({
  totpApi: { computeCode: native.compute },
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      captureCurrentDatabaseDataTarget: () => native.target,
      getCurrentDatabase: () => ({ id: native.currentDatabase }),
    }),
  },
}));

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const credential = (): DatabaseCredentialEntry => ({
  id,
  name: "Operator",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  facets: {
    username: "VAULT_ACCOUNT",
    password: "VAULT_PASSWORD",
    totp: [
      {
        id: "first",
        label: "NAS code",
        secret: "PRIVATE_SEED",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ],
  },
});
const connection = (patch: Partial<Connection> = {}): Connection =>
  ({
    id: "ssh-one",
    name: "SSH server",
    protocol: "ssh",
    hostname: "ssh.private.test",
    port: 22,
    credentialSource: { kind: "vault", credentialId: id },
    ...patch,
  }) as Connection;
function MountedTreeModel() {
  useEffect(() => {
    const ready = () =>
      window.dispatchEvent(new Event("connection-tree-ready"));
    window.addEventListener("connection-tree-reveal-request", ready);
    return () =>
      window.removeEventListener("connection-tree-reveal-request", ready);
  }, []);
  return null;
}
function fixture({
  entries = [credential()],
  connections = [] as Connection[],
  onOpenConnection = vi.fn(),
  withSidebar = false,
  sidebarInitiallyCollapsed = true,
} = {}) {
  const owner = { databaseId: "db", generation: 1 };
  const state = { connections };
  const snapshot = (): DatabaseCredentialSnapshot => ({
    scope: owner,
    revision: 1,
    receipt: "review",
    entries: entries.map(databaseCredentialMetadata),
  });
  const api: DatabaseCredentialVaultApi = {
    scope: owner,
    changeRevision: 0,
    list: vi.fn(async () => snapshot()),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (_review, selected, fields) =>
        structuredClone(
          Object.fromEntries(
            fields.map((field) => [
              field,
              entries.find((row) => row.id === selected)!.facets[field],
            ]),
          ),
        ),
    ),
    compareAndSwap: vi.fn(),
  };
  const dispatch = vi.fn();
  const context = {
    credentialVault: api,
    databaseAvailability: { status: "ready", databaseId: "db", generation: 7 },
    dispatch,
    getCurrentConnections: vi.fn(
      (scope: { databaseId: string; generation: number }) => {
        expect(scope).toEqual({ databaseId: "db", generation: 7 });
        return state.connections;
      },
    ),
  } as unknown as ConnectionContextType;
  native.target = {
    databaseId: "db",
    assertAccessible: vi.fn(),
    verifyCurrent: vi.fn(async () => {}),
    readCurrent: vi.fn(async () => ({
      connections: structuredClone(state.connections),
    })),
  };
  function StatefulSidebar() {
    const [current, publish] = useReducer(connectionReducer, {
      connections,
      sessions: [],
      selectedConnection: connections[0] ?? null,
      selectedConnectionIds: new Set(connections[0] ? [connections[0].id] : []),
      filter: {
        searchTerm: "hidden",
        protocols: ["rdp"],
        tags: ["hidden"],
        colorTags: ["blue"],
        showRecent: true,
        showFavorites: true,
        sortBy: "custom",
        sortDirection: "asc",
      },
      sidebarCollapsed: sidebarInitiallyCollapsed,
      isLoading: false,
      tabGroups: [],
    } as ConnectionState);
    state.connections = current.connections;
    const send = useCallback((action: Parameters<typeof publish>[0]) => {
      dispatch(action);
      publish(action);
    }, []);
    return (
      <SettingsContext.Provider
        value={
          {
            settings: {
              ...defaultSettings,
              showDocumentsInConnectionTree: false,
            },
            updateSettings: vi.fn(),
            reloadSettings: vi.fn(async () => {}),
            settingsReady: true,
          } as React.ContextType<typeof SettingsContext>
        }
      >
        <ToastProvider>
          <ConnectionContext.Provider
            value={{
              ...context,
              state: current,
              dispatch: send,
              dispatchAndFlush: async (action) => {
                send(action);
              },
            }}
          >
            <Sidebar
              sidebarPosition="left"
              onToggleSidebarPosition={() => {}}
              onNewConnection={() => {}}
              onEditConnection={() => {}}
              onDeleteConnection={() => {}}
              onConnect={() => {}}
              onDisconnect={() => {}}
              onDiagnostics={() => {}}
              onSessionDetach={() => {}}
              onShowPasswordDialog={() => {}}
              enableConnectionReorder={false}
              noCollection={false}
            />
            <DatabaseCredentialVault onOpenConnection={onOpenConnection} />
          </ConnectionContext.Provider>
        </ToastProvider>
      </SettingsContext.Provider>
    );
  }
  const view = render(
    withSidebar ? (
      <StatefulSidebar />
    ) : (
      <ConnectionContext.Provider value={context}>
        <MountedTreeModel />
        <DatabaseCredentialVault onOpenConnection={onOpenConnection} />
      </ConnectionContext.Provider>
    ),
  );
  return { ...view, state, api, dispatch, context, onOpenConnection, snapshot };
}
const click = async (name: string) => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
const writes = () =>
  native.invoke.mock.calls.filter(([name]) => name === "secure_clip_copy");
beforeEach(() => {
  vi.clearAllMocks();
  native.currentDatabase = "db";
  native.invoke.mockResolvedValue(undefined);
  native.compute.mockResolvedValue("123456");
  vi.spyOn(Date, "now").mockReturnValue(1800000001000);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("credential vault row actions", () => {
  it("copies each requested vault facet only after its real click through native secure clipboard", async () => {
    const f = fixture();
    await screen.findByRole("button", { name: "Copy password for Operator" });
    expect(f.api.resolve).not.toHaveBeenCalled();
    expect(screen.queryByText("VAULT_PASSWORD")).not.toBeInTheDocument();
    await click("Copy username for Operator");
    await screen.findByText("Username copied.");
    await click("Copy password for Operator");
    await screen.findByText("Password copied.");
    await click("Copy 2FA code for Operator");
    await screen.findByText("2FA code copied.");
    expect(vi.mocked(f.api.resolve).mock.calls.map((call) => call[2])).toEqual([
      ["username"],
      ["password"],
      ["totp"],
    ]);
    expect(writes().map(([, arg]) => arg.request.value)).toEqual([
      "VAULT_ACCOUNT",
      "VAULT_PASSWORD",
      "123456",
    ]);
    expect(writes().map(([, arg]) => arg.request.kind)).toEqual([
      "username",
      "password",
      "totpCode",
    ]);
    expect(writes()[2][1].request.clearAfterSecs).toBeLessThanOrEqual(29);
    expect(native.compute).toHaveBeenCalledWith("PRIVATE_SEED", "SHA1", 6, 30);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(
      /PRIVATE_SEED|VAULT_ACCOUNT|VAULT_PASSWORD|123456/,
    );
  });

  it("keeps multiple authenticator choices metadata-only and resolves the selected code afresh", async () => {
    const entry = credential();
    entry.facets.totp!.push({
      ...entry.facets.totp![0],
      id: "second",
      label: "Backup code",
      secret: "SECOND_PRIVATE_SEED",
    });
    const f = fixture({ entries: [entry] });
    await click("Copy 2FA code for Operator");
    const picker = await screen.findByRole("dialog", {
      name: "Choose authenticator",
    });
    expect(picker).not.toHaveTextContent("PRIVATE_SEED");
    expect(native.compute).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
    fireEvent.click(
      within(picker).getByRole("button", { name: "Backup code" }),
    );
    await screen.findByText("2FA code copied.");
    expect(native.compute).toHaveBeenCalledWith(
      "SECOND_PRIVATE_SEED",
      "SHA1",
      6,
      30,
    );
    expect(f.api.resolve).toHaveBeenCalledTimes(2);
  });

  it("preserves authoritative native lock denial and never falls back to the browser clipboard", async () => {
    native.invoke.mockRejectedValue("locked");
    fixture();
    await click("Copy password for Operator");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was copied because the app is locked",
    );
    expect(screen.queryByText("Password copied.")).not.toBeInTheDocument();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    native.invoke.mockResolvedValue(undefined);
    await click("Copy password for Operator");
    await screen.findByText("Password copied.");
  });

  it("offers a small connection picker, reveals filtered targets and opens the unchanged canonical connection", async () => {
    const ssh = connection(),
      web = connection({
        id: "web-two",
        name: "NAS website",
        protocol: "https",
        hostname: "https://nas.private.test:444/admin?view=one",
      });
    const f = fixture({ connections: [ssh, web] });
    const revealed = vi.fn();
    window.addEventListener("reveal-connection", revealed);
    try {
      await click("Go to connection for Operator");
      const picker = await screen.findByRole("dialog", {
        name: "Choose connection",
      });
      fireEvent.click(
        within(picker).getByRole("button", { name: "SSH server · ssh" }),
      );
      await waitFor(() => expect(revealed).toHaveBeenCalledOnce());
      expect(f.dispatch).toHaveBeenCalledWith({
        type: "SET_FILTER",
        payload: {
          searchTerm: "",
          protocols: [],
          tags: [],
          colorTags: [],
          showRecent: false,
          showFavorites: false,
          status: undefined,
        },
      });
      expect(f.dispatch).toHaveBeenCalledWith({
        type: "SELECT_CONNECTION",
        payload: ssh,
      });
      expect(f.dispatch).toHaveBeenCalledWith({
        type: "SET_SIDEBAR_COLLAPSED",
        payload: false,
      });
      expect(revealed.mock.calls[0][0].detail).toEqual({
        connectionId: ssh.id,
      });
      await click("Open connection for Operator");
      fireEvent.click(
        within(
          await screen.findByRole("dialog", { name: "Choose connection" }),
        ).getByRole("button", { name: "NAS website · https" }),
      );
      await waitFor(() =>
        expect(f.onOpenConnection).toHaveBeenCalledExactlyOnceWith(web),
      );
      expect(f.onOpenConnection.mock.calls[0][0]).toBe(web);
      expect(f.api.resolve).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("reveal-connection", revealed);
    }
  });

  it.each([true, false])(
    "Go reveals and focuses a different filtered nested connection in the actual sidebar (initially collapsed=%s)",
    async (collapsed) => {
      fixture({
        withSidebar: true,
        sidebarInitiallyCollapsed: collapsed,
        connections: [
          connection({
            id: "folder",
            name: "Closed folder",
            isGroup: true,
            expanded: false,
            credentialSource: { kind: "local" },
          }),
          connection({ parentId: "folder" }),
        ],
      });
      if (collapsed) expect(screen.queryByRole("tree")).not.toBeInTheDocument();
      else expect(screen.getByRole("tree")).toBeInTheDocument();
      await click("Go to connection for Operator");
      const tree = await screen.findByRole("tree");
      await waitFor(() =>
        expect(
          tree.querySelector('[data-connection-id="ssh-one"]'),
        ).toHaveClass("sor-tree-item-blink"),
      );
      const row = tree.querySelector('[data-connection-id="ssh-one"]')!;
      expect(row.closest('[role="treeitem"]')).toHaveFocus();
      expect(
        screen.getByRole("textbox", { name: /connections.search/ }),
      ).toHaveValue("");
    },
  );

  it("does not deliver a deferred tree reveal after its original database owner changes", async () => {
    const originalDispatch = window.dispatchEvent.bind(window),
      pending: Event[] = [];
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      if (event.type === "connection-tree-ready") {
        pending.push(event);
        return true;
      }
      return originalDispatch(event);
    });
    const revealed = vi.fn();
    window.addEventListener("reveal-connection", revealed);
    try {
      fixture({
        withSidebar: true,
        connections: [
          connection({
            id: "folder",
            name: "Closed folder",
            isGroup: true,
            expanded: false,
            credentialSource: { kind: "local" },
          }),
          connection({ parentId: "folder" }),
        ],
      });
      await click("Go to connection for Operator");
      await screen.findByRole("tree");
      await waitFor(() => expect(pending.length).toBeGreaterThan(0));
      native.currentDatabase = "other-db";
      await act(async () => {
        pending.forEach((event) => originalDispatch(event));
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "owning database",
      );
      expect(revealed).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole("tree")
          .querySelector('[data-connection-id="ssh-one"]'),
      ).toBeNull();
    } finally {
      window.removeEventListener("reveal-connection", revealed);
    }
  });

  it("navigates a vault-only connection with no local facets and denies a reassigned connection", async () => {
    const f = fixture({ connections: [connection()] });
    await click("Open connection for Operator");
    await waitFor(() => expect(f.onOpenConnection).toHaveBeenCalledOnce());
    f.onOpenConnection.mockClear();
    let release!: (value: DatabaseCredentialSnapshot) => void;
    vi.mocked(f.api.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await click("Open connection for Operator");
    await waitFor(() => expect(release).toBeTypeOf("function"));
    f.state.connections = [
      connection({
        credentialSource: { kind: "vault", credentialId: "other" },
      }),
    ];
    await act(async () => release(f.snapshot()));
    await screen.findByRole("alert");
    expect(f.onOpenConnection).not.toHaveBeenCalled();
  });

  it("copies local fields from the verified persisted snapshot and preserves HTTP pair semantics", async () => {
    const local = connection({
      credentialSource: { kind: "local" },
      name: "Local website",
      protocol: "https",
      username: "IGNORED_GENERIC_USER",
      password: "IGNORED_GENERIC_PASSWORD",
      basicAuthUsername: "HTTP_ACCOUNT",
      basicAuthPassword: "HTTP_PASSWORD",
      totpConfigs: [
        {
          id: "local-otp",
          secret: "LOCAL_SEED",
          issuer: "Local OTP",
          account: "account",
          digits: 6,
          period: 30,
          algorithm: "sha1",
        },
      ],
    });
    const f = fixture({ entries: [], connections: [local] });
    await click("Copy username for Local website");
    await screen.findByText("Username copied.");
    await click("Copy password for Local website");
    await screen.findByText("Password copied.");
    await click("Copy 2FA code for Local website");
    await screen.findByText("2FA code copied.");
    expect(writes().map(([, arg]) => arg.request.value)).toEqual([
      "HTTP_ACCOUNT",
      "HTTP_PASSWORD",
      "123456",
    ]);
    expect(native.target.readCurrent).toHaveBeenCalledTimes(3);
    expect(native.target.verifyCurrent).toHaveBeenCalledTimes(6);
    expect(f.api.resolve).not.toHaveBeenCalled();
    expect(native.compute).toHaveBeenCalledWith("LOCAL_SEED", "SHA1", 6, 30);
  });

  it("never copies ignored local values from a vault-linked inventory row", async () => {
    const f = fixture({
      connections: [
        connection({ username: "IGNORED_LOCAL", password: "IGNORED_PASSWORD" }),
      ],
    });
    await click("Copy password for SSH server");
    await screen.findByText("Password copied.");
    expect(writes()[0][1].request.value).toBe("VAULT_PASSWORD");
    expect(f.api.resolve).toHaveBeenCalledWith(expect.anything(), id, [
      "password",
    ]);
  });

  it("does not mix an incomplete dedicated HTTP pair with the generic password", async () => {
    fixture({
      entries: [],
      connections: [
        connection({
          name: "Dedicated account",
          protocol: "https",
          credentialSource: { kind: "local" },
          username: "GENERIC_USER",
          password: "GENERIC_PASSWORD",
          basicAuthUsername: "HTTP_USER",
          basicAuthPassword: "",
        }),
      ],
    });
    await click("Copy password for Dedicated account");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No password is saved",
    );
    expect(writes()).toHaveLength(0);
  });

  it("bounds a large association picker to25 matches and searches the remaining connections", async () => {
    const connections = Array.from({ length: 30 }, (_, index) =>
      connection({
        id: `linked-${index}`,
        name: `Target ${String(index).padStart(2, "0")}`,
      }),
    );
    const f = fixture({ connections });
    await click("Open connection for Operator");
    const picker = await screen.findByRole("dialog", {
      name: "Choose connection",
    });
    expect(within(picker).getAllByRole("button")).toHaveLength(26);
    expect(picker).toHaveTextContent("Showing 25 matches");
    const search = within(picker).getByRole("textbox", {
      name: "Filter choices",
    });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "Target 29" } });
    fireEvent.click(
      within(picker).getByRole("button", { name: "Target 29 · ssh" }),
    );
    await waitFor(() =>
      expect(f.onOpenConnection).toHaveBeenCalledExactlyOnceWith(
        connections[29],
      ),
    );
  });

  it("shows unavailable actions for absent facets, external references and unassigned entries", async () => {
    fixture({
      entries: [{ ...credential(), facets: {} }],
      connections: [
        connection({
          credentialSource: { kind: "local" },
          name: "External only",
          postgresClientKeyPath: "/synthetic/external-key",
        } as Partial<Connection>),
      ],
    });
    expect(
      await screen.findByRole("button", { name: "Copy password for Operator" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Go to connection for Operator" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copy 2FA code for Operator" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copy password for External only" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copy username for External only" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copy 2FA code for External only" }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("revokes a late credential read when its owner locks before disclosure", async () => {
    const f = fixture();
    let release!: (value: { password: string }) => void;
    vi.mocked(f.api.resolve).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await click("Copy password for Operator");
    await waitFor(() => expect(release).toBeTypeOf("function"));
    native.target.assertAccessible.mockImplementation(() => {
      throw Error("PRIVATE_NATIVE_ERROR");
    });
    await act(async () => release({ password: "LATE_PRIVATE_PASSWORD" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "PRIVATE_NATIVE_ERROR",
    );
    expect(writes()).toHaveLength(0);
  });

  it("refuses a closing 2FA time window without computing or copying a doomed code", async () => {
    vi.mocked(Date.now).mockReturnValue(1800000029500);
    fixture();
    await click("Copy 2FA code for Operator");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "about to expire",
    );
    expect(native.compute).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });
});
