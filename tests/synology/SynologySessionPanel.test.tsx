import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import SynologySessionPanel from "../../src/components/synology/SynologySessionPanel";
import { disconnectSynologySession } from "../../src/utils/session/synologySessionLifecycle";
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  owner: "db-a",
  allowed: true,
  lock: () => {},
  access: (_event: unknown) => {},
  current: () => {},
  capabilities: vi.fn(),
  realContent: false,
}));
let connections: Connection[] = [];
let availability: DatabaseAvailability;
let vaultApi: DatabaseCredentialVaultApi | undefined;
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, fn: () => void) => {
    mocks.lock = fn;
    return () => {};
  }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections },
    dispatch: mocks.dispatch,
    databaseAvailability: availability,
    credentialVault: vaultApi,
  }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: mocks.owner }),
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: mocks.owner,
        readCurrent: async () => ({ connections }),
        assertAccessible: () => {
          if (!mocks.allowed) throw new Error("locked");
        },
      }),
      onCurrentDatabaseChange: (fn: () => void) => {
        mocks.current = fn;
        return () => {};
      },
    }),
  },
  onDatabaseAccessChange: (fn: (event: unknown) => void) => {
    mocks.access = fn;
    return () => {};
  },
}));
vi.mock(
  "../../src/utils/runtime/runtimeCapabilities",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    loadRuntimeCapabilities: mocks.capabilities,
  }),
);
vi.mock(
  "../../src/components/synology/SynologyPanel",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/components/synology/SynologyPanel")
      >();
    return {
      SynologySessionContent: ({
        connection,
        runtimeVerified,
      }: {
        connection: ReturnType<
          typeof import("../../src/hooks/synology/useSynologyFileConnection").useSynologyFileConnection
        >;
        runtimeVerified?: boolean;
      }) =>
        mocks.realContent ? (
          <actual.SynologySessionContent
            connection={connection}
            runtimeVerified={runtimeVerified}
          />
        ) : (
          <section aria-label={connection.instanceId}>
            <span>{connection.host}</span>
            <span>{connection.connectionStatus}</span>
            <button onClick={() => void connection.disconnect()}>
              Disconnect {connection.instanceId}
            </button>
          </section>
        ),
    };
  },
);

const saved = (id: string): Connection => ({
  id,
  name: id,
  protocol: "synology",
  hostname: `${id}.example.test`,
  port: 5001,
  username: "user",
  password: "synthetic-private-password",
  isGroup: false,
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
});
const session = (id: string, connectionId = id): ConnectionSession => ({
  id,
  connectionId,
  ownerDatabaseId: "db-a",
  name: id,
  protocol: "synology",
  hostname: `${connectionId}.example.test`,
  status: "connecting",
  startTime: new Date(),
});
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockClear();
  mocks.owner = "db-a";
  mocks.allowed = true;
  mocks.realContent = false;
  vaultApi = undefined;
  connections = [saved("one"), saved("two")];
  availability = { status: "ready", databaseId: "db-a", generation: 1 };
  mocks.capabilities.mockResolvedValue({
    source: "native",
    ops: true,
    platform: true,
  });
  mocks.invoke.mockImplementation(
    async (command: string, args: { instanceId?: string }) =>
      command === "syn_fs_connect"
        ? {
            status: "connected",
            sessionId: `receipt-${args.instanceId}`,
            message: "ok",
          }
        : undefined,
  );
});
afterEach(cleanup);
describe("saved Synology session ownership", () => {
  it("mounts the actual saved-vault adapter without copying ignored local credentials into native login or session updates", async () => {
    const credentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    connections[0].credentialSource = { kind: "vault", credentialId };
    vaultApi = {
      scope: { databaseId: "db-a", generation: 1 },
      changeRevision: 1,
      list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
        scope: { databaseId: "db-a", generation: 1 },
        revision: 1,
        receipt: "vault-receipt",
        entries: [
          {
            id: credentialId,
            name: "NAS account",
            createdAt: "2026-09-01",
            updatedAt: "2026-09-01",
            availableFacets: ["username", "password"],
          },
        ],
      })),
      resolve: vi.fn(async () => ({
        username: "VAULT_NAS_ACCOUNT",
        password: "VAULT_NAS_SECRET",
      })),
      compareAndSwap: vi.fn(),
    };
    render(
      <React.StrictMode>
        <SynologySessionPanel session={session("one")} />
      </React.StrictMode>,
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "syn_fs_connect",
        expect.objectContaining({
          username: "VAULT_NAS_ACCOUNT",
          password: "VAULT_NAS_SECRET",
          host: "one.example.test",
          instanceId: "one",
        }),
      ),
    );
    expect(vaultApi!.resolve).toHaveBeenCalledWith(
      expect.anything(),
      credentialId,
      ["username", "password"],
    );
    await waitFor(() =>
      expect(screen.getByText("connected")).toBeInTheDocument(),
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      "VAULT_NAS_SECRET",
    );
    expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain(
      "synthetic-private-password",
    );
    expect(connections[0].password).toBe("synthetic-private-password");
  });
  it("starts the initial saved sign-in after Strict Mode effect replay without requiring Retry", async () => {
    mocks.realContent = true;
    let resolveLogin!: (result: unknown) => void;
    let resolveShares!: (result: unknown) => void;
    let resolveCapabilities!: (result: unknown) => void;
    mocks.capabilities.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCapabilities = resolve;
        }),
    );
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "syn_fs_connect")
        return new Promise((resolve) => {
          resolveLogin = resolve;
        });
      if (command === "syn_fs_list")
        return new Promise((resolve) => {
          resolveShares = resolve;
        });
      if (command === "syn_fs_session_health")
        return Promise.resolve({
          status: "connected",
          lastVerifiedAt: "2026-09-10T12:00:00Z",
          consecutiveFailures: 0,
          message: null,
        });
      return Promise.resolve(undefined);
    });
    render(
      <React.StrictMode>
        <SynologySessionPanel session={session("one")} />
      </React.StrictMode>,
    );
    expect(
      screen.getByRole("heading", { name: "Checking desktop capabilities…" }),
    ).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () =>
      resolveCapabilities({ source: "native", ops: true, platform: true }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Resolving the NAS and signing in…",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Desktop capabilities verified"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("DSM API session established"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.queryByText("The NAS session is disconnected."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "syn_fs_connect",
    ]);
    await act(async () =>
      resolveLogin({
        status: "connected",
        sessionId: "receipt-one",
        message: "ok",
      }),
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "syn_fs_list",
        expect.objectContaining({
          instanceId: "one",
          expectedSessionId: "receipt-one",
        }),
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Loading shared folders…" }),
    ).toBeInTheDocument();
    const explorer = screen.getByTestId("synology-file-station");
    const fileTable = screen.getByRole("table", { name: "File Station files" });
    expect(fileTable).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("navigation", { name: "File Station folders" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("file-list-skeleton")).toHaveLength(4);
    await act(async () => resolveShares({ files: [], total: 0, offset: 0 }));
    expect(screen.getByTestId("synology-file-station")).toBe(explorer);
    expect(screen.getByRole("table", { name: "File Station files" })).toBe(
      fileTable,
    );
    expect(fileTable).toHaveAttribute("aria-busy", "false");
    expect(
      screen.queryByLabelText("Current stage elapsed time"),
    ).not.toBeInTheDocument();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "syn_fs_connect",
      ),
    ).toHaveLength(1);
    expect(
      screen.queryByText("The NAS session is disconnected."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("synology-panel")).toBeInTheDocument();
  });
  it("preserves actual first-login errors and requires an explicit Retry", async () => {
    mocks.realContent = true;
    mocks.invoke.mockRejectedValue(new Error("The NAS refused this sign-in."));
    render(
      <React.StrictMode>
        <SynologySessionPanel session={session("one")} />
      </React.StrictMode>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The NAS refused this sign-in.",
    );
    expect(
      screen.getByRole("heading", { name: "NAS connection unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Current stage elapsed time"),
    ).not.toBeInTheDocument();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "syn_fs_connect",
      ),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.filter(
          ([command]) => command === "syn_fs_connect",
        ),
      ).toHaveLength(2),
    );
  });
  it("cancels from the status panel and releases late authentication without opening the workspace", async () => {
    mocks.realContent = true;
    let resolveLogin!: (result: unknown) => void;
    mocks.invoke.mockImplementation((command: string) =>
      command === "syn_fs_connect"
        ? new Promise((resolve) => {
            resolveLogin = resolve;
          })
        : Promise.resolve(true),
    );
    render(<SynologySessionPanel session={session("one")} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel connection" }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "syn_fs_cancel_connect",
      expect.objectContaining({
        instanceId: "one",
        requestId: expect.any(String),
      }),
    );
    expect(
      screen.queryByLabelText("Current stage elapsed time"),
    ).not.toBeInTheDocument();
    await act(async () =>
      resolveLogin({
        status: "connected",
        sessionId: "late-receipt",
        message: "ok",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "one",
      expectedSessionId: "late-receipt",
    });
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "syn_fs_list"),
    ).toBe(false);
    expect(
      screen.queryByText("DSM API session established"),
    ).not.toBeInTheDocument();
  });
  it("shows the actual initial share-read error instead of leaving initialization running", async () => {
    mocks.realContent = true;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "syn_fs_connect")
        return { status: "connected", sessionId: "receipt-one", message: "ok" };
      if (command === "syn_fs_list")
        throw new Error("File Station permission denied for this account");
      if (command === "syn_fs_session_health")
        return {
          status: "connected",
          lastVerifiedAt: "",
          consecutiveFailures: 0,
          message: null,
        };
      return undefined;
    });
    render(<SynologySessionPanel session={session("one")} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "File Station permission denied for this account",
    );
    expect(screen.getByRole("button", { name: "Refresh files" })).toBeEnabled();
    expect(
      screen.queryByLabelText("Current stage elapsed time"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("synthetic-private-password"),
    ).not.toBeInTheDocument();
  });
  it("does not start a saved login if access is revoked during capability discovery", async () => {
    let resolveCapabilities!: (value: unknown) => void;
    mocks.capabilities.mockReturnValue(
      new Promise((resolve) => {
        resolveCapabilities = resolve;
      }),
    );
    render(
      <React.StrictMode>
        <SynologySessionPanel session={session("one")} />
      </React.StrictMode>,
    );
    await act(async () => {
      mocks.allowed = false;
      mocks.access({ databaseId: "db-a", status: "suspended" });
      resolveCapabilities({ source: "native", ops: true, platform: true });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("owning database");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("opens the API explorer for HTTP(S) Synology applications using application credentials", async () => {
    connections = [
      {
        ...saved("one"),
        protocol: "https",
        hostname: "https://nas.office.example.test:5443/",
        httpApplication: {
          version: 1,
          id: "synology-dsm",
          loginMode: "manual",
        },
        synologySettings: { version: 1, useHttps: true, accessMode: "native" },
        basicAuthUsername: "application-user",
        basicAuthPassword: "application-secret",
        httpsTrustPolicy: "strict",
      },
    ];
    render(<SynologySessionPanel session={session("one")} />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "syn_fs_connect",
        expect.objectContaining({
          host: "nas.office.example.test",
          port: 5443,
          useHttps: true,
          username: "application-user",
          password: "application-secret",
        }),
      ),
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      "application-secret",
    );
  });
  it("never opens the native API for a browser-view connection", () => {
    connections = [
      {
        ...saved("one"),
        protocol: "https",
        httpApplication: {
          version: 1,
          id: "synology-dsm",
          loginMode: "manual",
        },
        synologySettings: { version: 1, useHttps: true, accessMode: "website" },
      },
    ];
    render(<SynologySessionPanel session={session("one")} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each([
    { ops: false, platform: true },
    { ops: true, platform: false },
  ])(
    "shows a dedicated missing-build page without NAS requests (%j)",
    async (flags) => {
      mocks.capabilities.mockResolvedValue({ source: "native", ...flags });
      const close = vi.fn();
      render(<SynologySessionPanel session={session("one")} onClose={close} />);
      expect(
        await screen.findByRole("heading", {
          name: "Feature unavailable in this build",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("npm run tauri:dev")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /reconnect|retry/i }),
      ).not.toBeInTheDocument();
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(
        screen.queryByText("synthetic-private-password"),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close session" }));
      expect(close).toHaveBeenCalledOnce();
    },
  );
  it("does not mislabel missing desktop IPC as a disabled compiled feature", async () => {
    mocks.capabilities.mockResolvedValue({
      source: "unavailable",
      ops: false,
      platform: false,
    });
    render(<SynologySessionPanel session={session("one")} />);
    expect(
      await screen.findByRole("heading", {
        name: "Desktop capabilities unavailable",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Feature unavailable in this build",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("npm run tauri:dev")).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("keeps authentication/network failure on the connection view after capabilities succeed", async () => {
    mocks.invoke.mockRejectedValue(new Error("Synology connection failed"));
    render(<SynologySessionPanel session={session("one")} />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "syn_fs_connect",
        expect.anything(),
      ),
    );
    expect(
      screen.queryByRole("heading", {
        name: /capabilities unavailable|Feature unavailable/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "one" })).toBeInTheDocument();
  });
  it("does not mount login actions or send credentials before runtime capability validation", async () => {
    let resolve!: (value: unknown) => void;
    mocks.capabilities.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<SynologySessionPanel session={session("one")} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking desktop capabilities",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () =>
      resolve({ source: "native", ops: true, platform: false }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("platform");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("mounts two independent NAS sessions and awaited close releases only its instance", async () => {
    render(
      <>
        <SynologySessionPanel session={session("one")} />
        <SynologySessionPanel session={session("two")} />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("connected")).toHaveLength(2),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "syn_fs_connect",
      expect.objectContaining({
        instanceId: "one",
        host: "one.example.test",
        password: "synthetic-private-password",
      }),
    );
    await act(() => disconnectSynologySession("one"));
    expect(mocks.invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "one",
      expectedSessionId: "receipt-one",
    });
    expect(screen.getAllByText("connected")).toHaveLength(1);
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      "synthetic-private-password",
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain("receipt-");
  });
  it("refuses known owner A under B and does not mount secret-bearing content", () => {
    mocks.owner = "db-b";
    availability = { status: "ready", databaseId: "db-b", generation: 2 };
    render(<SynologySessionPanel session={session("one")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("owning database");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("cancels a pending login and releases late success on same-owner suspension", async () => {
    let resolve!: (result: unknown) => void;
    mocks.invoke.mockImplementation((command: string) =>
      command === "syn_fs_connect"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(undefined),
    );
    const { rerender } = render(
      <SynologySessionPanel session={session("one")} />,
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "syn_fs_connect",
        expect.anything(),
      ),
    );
    availability = { status: "suspended", databaseId: "db-a", generation: 2 };
    mocks.allowed = false;
    rerender(<SynologySessionPanel session={session("one")} />);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "syn_fs_cancel_connect",
      expect.objectContaining({ instanceId: "one" }),
    );
    await act(async () =>
      resolve({ status: "connected", sessionId: "late", message: "ok" }),
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
        instanceId: "one",
        expectedSessionId: "late",
      }),
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("revokes immediately on the native master-lock event", async () => {
    render(<SynologySessionPanel session={session("one")} />);
    await waitFor(() =>
      expect(screen.getByText("connected")).toBeInTheDocument(),
    );
    await act(async () => mocks.lock());
    expect(screen.getByRole("alert")).toHaveTextContent("owning database");
    expect(mocks.invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "one",
      expectedSessionId: "receipt-one",
    });
  });
  it("blocks inherited routes and does not offer Connect before capability readiness", async () => {
    connections = [
      { ...saved("one"), parentId: "folder" },
      { ...saved("folder"), isGroup: true, proxyChainId: "explicit-route" },
    ];
    render(<SynologySessionPanel session={session("one")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("proxy/VPN");
    await act(async () => {});
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("manual disconnect remains usable without replaying saved credentials", async () => {
    render(<SynologySessionPanel session={session("one")} />);
    await waitFor(() =>
      expect(screen.getByText("connected")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect one" }));
    await waitFor(() =>
      expect(screen.getByText("disconnected")).toBeInTheDocument(),
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "syn_fs_connect",
      ),
    ).toHaveLength(1);
  });
});
