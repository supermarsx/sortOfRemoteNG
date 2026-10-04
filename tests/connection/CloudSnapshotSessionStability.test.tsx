import React, { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { SessionViewer } from "../../src/components/session/SessionViewer";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { acquireCloudSyncDatabaseBarrier } from "../../src/utils/services/cloudSyncDatabaseBarrier";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

const lifecycle = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: vi.fn(async () => null),
}));
vi.mock("../../src/components/ssh/WebTerminal", () => ({
  default: function Terminal() {
    useEffect(() => {
      lifecycle.mounted();
      return () => {
        lifecycle.unmounted();
      };
    }, []);
    return <div data-testid="live-terminal">Live terminal</div>;
  },
}));

const connection: Connection = {
  id: "cloud-session-row",
  name: "Snapshot fixture",
  protocol: "ssh",
  hostname: "fixture.invalid",
  port: 22,
  isGroup: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
let api: ReturnType<typeof useConnections>;
let manager: DatabaseManager;
let owner: string;
function Harness({ session }: { session: ConnectionSession }) {
  api = useConnections();
  return <SessionViewer session={session} />;
}
async function mountSession(
  status: ConnectionSession["status"] = "connecting",
) {
  render(
    <ConnectionProvider>
      <Harness
        session={{
          id: "live-session",
          connectionId: connection.id,
          ownerDatabaseId: owner,
          hostname: connection.hostname,
          name: connection.name,
          protocol: "ssh",
          status,
          startTime: new Date(0),
        }}
      />
    </ConnectionProvider>,
  );
  await act(async () => {
    await api.loadData(owner);
  });
  await screen.findByTestId("live-terminal");
  lifecycle.mounted.mockClear();
  lifecycle.unmounted.mockClear();
}
beforeEach(async () => {
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
  owner = (await manager.createDatabase("Snapshot fixture")).id;
  await manager.selectDatabase(owner);
  await manager.saveDatabaseData(owner, {
    connections: [connection],
    settings: {},
    timestamp: Date.now(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("cloud snapshot session continuity", () => {
  it.each(["connecting", "connected"] as const)(
    "keeps a %s client and its credential lease mounted during repeated snapshots",
    async (status) => {
      await mountSession(status);
      const availability = api.databaseAvailability;
      const vaultScope = api.credentialVault!.scope;
      for (let attempt = 0; attempt < 3; attempt++) {
        let release!: () => Promise<void>;
        await act(async () => {
          release = await acquireCloudSyncDatabaseBarrier([owner]);
        });
        try {
          expect(api.databaseAvailability).toEqual(availability);
          expect(api.credentialVault!.scope).toEqual(vaultScope);
          expect(screen.getByTestId("live-terminal")).toBeInTheDocument();
          expect(
            screen.queryByText(/different database will not be substituted/),
          ).toBeNull();
          act(() =>
            api.dispatch({
              type: "UPDATE_CONNECTION",
              payload: { ...connection, name: "Blocked during snapshot" },
            }),
          );
          expect(api.state.connections[0].name).toBe(connection.name);
          await expect(
            api.recycleBin!.archive([connection.id]),
          ).rejects.toThrow(/pending|progress/);
        } finally {
          await act(async () => {
            await release();
          });
        }
      }
      expect(api.databaseAvailability).toEqual(availability);
      expect(api.credentialVault!.scope).toEqual(vaultScope);
      expect(lifecycle.unmounted).not.toHaveBeenCalled();
      expect(lifecycle.mounted).not.toHaveBeenCalled();
    },
  );

  it("still suspends session access during a restore and reloads before making it ready", async () => {
    await mountSession();
    let release!: () => Promise<void>;
    await act(async () => {
      release = await acquireCloudSyncDatabaseBarrier([owner], true);
    });
    expect(api.databaseAvailability?.status).toBe("loading");
    expect(api.credentialVault!.scope).toBeNull();
    expect(screen.queryByTestId("live-terminal")).toBeNull();
    await act(async () => {
      await release();
    });
    expect(api.databaseAvailability?.status).toBe("ready");
    expect(await screen.findByTestId("live-terminal")).toBeInTheDocument();
  });

  it("does not make a closed owner ready when a pending snapshot releases", async () => {
    await mountSession();
    let release!: () => Promise<void>;
    await act(async () => {
      release = await acquireCloudSyncDatabaseBarrier([owner]);
    });
    await act(async () => {
      await manager.closeCurrentDatabase();
      await release();
    });
    expect(api.databaseAvailability?.status).toBe("none");
    expect(api.credentialVault!.scope).toBeNull();
    act(() => api.dispatch({ type: "SET_CONNECTIONS", payload: [connection] }));
    expect(api.state.connections).toEqual([]);
  });

  it("does not turn a genuine suspension back into ready on snapshot release", async () => {
    let suspended = false;
    let notify!: Parameters<DatabaseManager["onDatabaseAccessChange"]>[0];
    vi.spyOn(manager, "getDatabaseAccessState").mockImplementation(() =>
      suspended
        ? {
            databaseId: owner,
            status: "suspended",
            reason: "locked",
            accessEpoch: "locked-epoch",
            securityRevision: "1",
          }
        : null,
    );
    vi.spyOn(manager, "onDatabaseAccessChange").mockImplementation(
      (listener) => {
        notify = listener;
        return () => {};
      },
    );
    await mountSession();
    let release!: () => Promise<void>;
    await act(async () => {
      release = await acquireCloudSyncDatabaseBarrier([owner]);
    });
    act(() => {
      suspended = true;
      notify(manager.getDatabaseAccessState(owner)!);
    });
    expect(api.databaseAvailability?.status).toBe("suspended");
    expect(screen.queryByTestId("live-terminal")).toBeNull();
    await act(async () => {
      await release();
    });
    expect(api.databaseAvailability?.status).toBe("suspended");
    expect(api.credentialVault!.scope).toBeNull();
  });

  it("releases the upload edit fence after a failed flush without revoking the session lease", async () => {
    const capture = manager.captureCurrentDatabaseDataTarget.bind(manager);
    vi.spyOn(manager, "captureCurrentDatabaseDataTarget").mockImplementation(
      () => ({
        ...capture()!,
        save: async () => {
          throw new Error("Synthetic save failure");
        },
      }),
    );
    await mountSession();
    act(() =>
      api.dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, name: "Unsaved edit" },
      }),
    );
    const availability = api.databaseAvailability;
    await act(async () => {
      await expect(acquireCloudSyncDatabaseBarrier([owner])).rejects.toThrow(
        "Synthetic save failure",
      );
    });
    expect(api.databaseAvailability).toEqual(availability);
    expect(screen.getByTestId("live-terminal")).toBeInTheDocument();
    expect(lifecycle.unmounted).not.toHaveBeenCalled();
    act(() =>
      api.dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, name: "Retained after failure" },
      }),
    );
    expect(api.state.connections[0].name).toBe("Retained after failure");
    expect(api.persistence.dirty).toBe(true);
  });
});
