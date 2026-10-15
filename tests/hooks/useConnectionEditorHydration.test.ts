import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionEditor } from "../../src/hooks/connection/useConnectionEditor";
import type { Connection } from "../../src/types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  close: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  settings: { autoSaveEnabled: false },
  state: { connections: [] as Connection[] },
  instances: [],
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  vault: undefined as DatabaseCredentialVaultApi | undefined,
  databaseAvailability: undefined as DatabaseAvailability | undefined,
  getCurrentConnections: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: mocks.state,
    dispatchAndFlush: mocks.flush,
    credentialVault: mocks.vault,
    databaseAvailability: mocks.databaseAvailability,
    getCurrentConnections: mocks.getCurrentConnections,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toast }),
}));
vi.mock("../../src/hooks/integrations/useIntegrationConfigStore", () => ({
  useIntegrationConfigStore: () => ({
    instances: mocks.instances,
    createInstance: mocks.createInstance,
    updateInstance: mocks.updateInstance,
  }),
}));

const connectionA: Connection = {
  id: "connection-a",
  name: "A",
  protocol: "rdp",
  hostname: "initial.example",
  port: 3389,
  isGroup: false,
  tags: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const connectionB: Connection = {
  ...connectionA,
  id: "connection-b",
  name: "B",
  hostname: "other.example",
};
type Props = { connection: Connection | undefined; open: boolean };
function editor(connection: Connection | undefined = connectionA) {
  const initialProps: Props = { connection, open: true };
  return renderHook(
    ({ connection, open }: Props) =>
      useConnectionEditor(connection, open, mocks.close),
    {
      initialProps,
    },
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Editor = ReturnType<typeof useConnectionEditor>;
function submitEvent(): Parameters<Editor["handleSubmit"]>[0] {
  const target = document.createElement("form");
  return {
    nativeEvent: new Event("submit"),
    currentTarget: target,
    target,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    eventPhase: 2,
    isTrusted: false,
    preventDefault: vi.fn(),
    isDefaultPrevented: () => false,
    stopPropagation: vi.fn(),
    isPropagationStopped: () => false,
    persist: vi.fn(),
    timeStamp: 0,
    type: "submit",
  };
}
function edit(result: { current: Editor }, hostname: string) {
  act(() => result.current.setFormData((draft) => ({ ...draft, hostname })));
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.settings.autoSaveEnabled = false;
  mocks.state.connections = [];
  mocks.vault = undefined;
  mocks.databaseAvailability = {
    status: "ready",
    databaseId: "db-a",
    generation: 1,
  };
  mocks.getCurrentConnections
    .mockReset()
    .mockImplementation(() => mocks.state.connections);
  mocks.flush.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("connection editor draft ownership", () => {
  it.each(["switch", "lock", "new-generation", "missing-owner"])(
    "does not save or offer machine targets after %s",
    async (kind) => {
      const original = {
        ...connectionA,
        machineAssignment: {
          version: 1 as const,
          type: "vm" as const,
          name: "B",
          connectionRef: { databaseId: "db-a", connectionId: connectionB.id },
        },
      };
      mocks.state.connections = [connectionB];
      const { result, rerender } = editor(original);
      expect(result.current.noteAssignmentDatabaseId).toBe("db-a");
      expect(result.current.noteAssignmentConnections).toEqual([connectionB]);
      edit(result, "changed.example");
      mocks.databaseAvailability =
        kind === "missing-owner"
          ? undefined
          : {
              status: kind === "lock" ? "suspended" : "ready",
              databaseId: kind === "switch" ? "db-b" : "db-a",
              generation: 2,
            };
      // A same-ID row in another database must not leak into this editor.
      mocks.state.connections = [{ ...connectionB, name: "Foreign server" }];
      rerender({ connection: original, open: true });
      expect(result.current.noteAssignmentDatabaseId).toBeUndefined();
      expect(result.current.noteAssignmentConnections).toEqual([]);
      await act(() => result.current.saveNow());
      expect(mocks.flush).not.toHaveBeenCalled();
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.stringContaining("owning database changed or is locked"),
      );
      expect(result.current.formData.machineAssignment).toEqual(
        original.machineAssignment,
      );
    },
  );

  it("checks provider ownership immediately before persistence even before a lock rerenders", async () => {
    const { result } = editor();
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        machineAssignment: {
          version: 1,
          type: "server",
          name: "B",
          connectionRef: { databaseId: "db-a", connectionId: connectionB.id },
        },
      })),
    );
    mocks.getCurrentConnections.mockImplementation(() => {
      throw new Error("Database is locked");
    });
    await act(() => result.current.saveNow());
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Database is locked"),
    );
  });

  it("keeps unresolved foreign notes links without resolving against current rows", async () => {
    const original = {
      ...connectionA,
      machineAssignment: {
        version: 1 as const,
        type: "vm" as const,
        name: "Elsewhere",
        connectionRef: { databaseId: "db-b", connectionId: connectionB.id },
      },
    };
    mocks.state.connections = [connectionB];
    const { result } = editor(original);
    edit(result, "changed.example");
    await act(() => result.current.saveNow());
    expect(mocks.flush.mock.calls[0][0].payload.machineAssignment).toEqual(
      original.machineAssignment,
    );
  });

  it("saves and reloads a machine assignment with the connection's notes", async () => {
    const { result, rerender } = editor();
    const machineAssignment = {
      version: 1 as const,
      type: "container" as const,
      name: "Billing worker",
      resourceId: "ct-104",
      host: "PVE-01",
      connectionRef: { databaseId: "db-a", connectionId: "connection-b" },
    };
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        description: "Restart after the database",
        machineAssignment,
      })),
    );
    await act(() => result.current.saveNow());
    const saved = mocks.flush.mock.calls[0][0].payload as Connection;
    expect(saved).toMatchObject({
      id: connectionA.id,
      hostname: connectionA.hostname,
      description: "Restart after the database",
      machineAssignment,
    });
    rerender({ connection: saved, open: false });
    rerender({ connection: saved, open: true });
    expect(result.current.formData.machineAssignment).toEqual(
      machineAssignment,
    );
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        machineAssignment: undefined,
      })),
    );
    await act(() => result.current.saveNow());
    const cleared =
      mocks.flush.mock.calls[mocks.flush.mock.calls.length - 1][0].payload;
    expect(cleared.machineAssignment).toBeUndefined();
    expect(cleared.description).toBe("Restart after the database");
  });

  it.each(["gcp", "integration:gdrive"] as const)(
    "uses no endpoint port when selecting %s",
    (protocol) => {
      const { result } = editor();
      act(() => result.current.handleProtocolChange(protocol));
      expect(result.current.formData.port).toBe(0);
    },
  );

  it.each([0, 22, 8443])(
    "preserves the stored GCP address and port %s on save",
    async (port) => {
      const { result } = editor({
        ...connectionA,
        protocol: "gcp",
        hostname: "legacy.example",
        port,
      });
      act(() =>
        result.current.setFormData((draft) => ({
          ...draft,
          name: "Edited Google",
        })),
      );
      await act(() => result.current.saveNow());
      expect(mocks.flush).toHaveBeenCalledOnce();
      expect(mocks.flush.mock.calls[0][0].payload).toMatchObject({
        protocol: "gcp",
        hostname: "legacy.example",
        port,
      });
    },
  );

  it("saves a GCP connection without an address", async () => {
    const { result } = editor({
      ...connectionA,
      protocol: "gcp",
      hostname: "",
      port: 0,
    });
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        name: "Edited Google",
      })),
    );
    await act(() => result.current.saveNow());
    expect(mocks.flush.mock.calls[0][0].payload).toMatchObject({
      protocol: "gcp",
      hostname: "",
      port: 0,
    });
  });

  it.each([0, 443])(
    "preserves independent Drive compatibility fields and port %s",
    async (port) => {
      mocks.createInstance.mockImplementation(async (input) => ({
        ...input,
        id: "drive-instance",
      }));
      const { result } = editor({
        ...connectionA,
        protocol: "integration:gdrive",
        hostname: "",
        port,
        integration: {
          descriptorKey: "gdrive",
          host: "legacy-host",
          baseUrl: "https://legacy.example",
        },
      });
      act(() =>
        result.current.setFormData((draft) => ({
          ...draft,
          name: "Edited Drive",
        })),
      );
      await act(() => result.current.saveNow());
      expect(mocks.flush).toHaveBeenCalledOnce();
      expect(mocks.flush.mock.calls[0][0].payload).toMatchObject({
        hostname: "",
        port,
        integration: { host: "legacy-host", baseUrl: "https://legacy.example" },
      });
    },
  );
  it("creates Drive with no host, URL or port supplied", async () => {
    mocks.createInstance.mockImplementation(async (input) => ({
      ...input,
      id: "drive-new",
    }));
    const { result } = renderHook(() =>
      useConnectionEditor(undefined, true, mocks.close),
    );
    act(() => result.current.handleProtocolChange("integration:gdrive"));
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        name: "Drive",
        hostname: "",
      })),
    );
    await act(() => result.current.handleSubmit(submitEvent()));
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.flush.mock.calls[0][0].payload).toMatchObject({
      hostname: "",
      port: 0,
      integration: { host: "", baseUrl: "" },
    });
  });
  const vaultId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const vaultApi = (): DatabaseCredentialVaultApi => ({
    scope: { databaseId: "db-a", generation: 1 },
    changeRevision: 0,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async (scope) => ({
      scope,
      revision: 0,
      receipt: "review",
      entries: [
        {
          id: vaultId,
          name: "Reusable",
          createdAt: "2026-09-10T00:00:00.000Z",
          updatedAt: "2026-09-10T00:00:00.000Z",
          availableFacets: ["password"],
        },
      ],
    })),
    resolve: vi.fn(),
    compareAndSwap: vi.fn(),
  });
  it("persists only an explicitly selected same-database reference and preserves ignored local fields", async () => {
    mocks.vault = vaultApi();
    const { result } = editor({ ...connectionA, password: "LOCAL_SECRET" });
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        credentialSource: { kind: "vault", credentialId: vaultId },
      })),
    );
    await act(() => result.current.saveNow());
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.flush.mock.calls[0][0].payload).toMatchObject({
      credentialSource: { kind: "vault", credentialId: vaultId },
      password: "LOCAL_SECRET",
    });
    expect(mocks.vault.list).toHaveBeenCalledWith({
      databaseId: "db-a",
      generation: 1,
    });
    expect(mocks.vault.resolve).not.toHaveBeenCalled();
  });
  it("refuses saving a missing vault reference without using a local credential fallback", async () => {
    mocks.vault = vaultApi();
    vi.mocked(mocks.vault.list).mockResolvedValue({
      scope: mocks.vault.scope!,
      revision: 0,
      receipt: "review",
      entries: [],
    });
    const { result } = editor({ ...connectionA, password: "LOCAL_SECRET" });
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        credentialSource: { kind: "vault", credentialId: vaultId },
      })),
    );
    await act(() => result.current.saveNow());
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(result.current.formData.credentialSource?.kind).toBe("vault");
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("selected vault credential is unavailable"),
    );
  });
  it("fences a reference save when the database access generation changes during metadata review", async () => {
    mocks.vault = vaultApi();
    const gate = deferred();
    const list = mocks.vault.list;
    vi.mocked(mocks.vault.list).mockImplementationOnce(async (scope) => {
      await gate.promise;
      return {
        scope,
        revision: 0,
        receipt: "review",
        entries: [
          {
            id: vaultId,
            name: "Reusable",
            createdAt: "2026-09-10T00:00:00.000Z",
            updatedAt: "2026-09-10T00:00:00.000Z",
            availableFacets: ["password"],
          },
        ],
      };
    });
    const { result, rerender } = editor();
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        credentialSource: { kind: "vault", credentialId: vaultId },
      })),
    );
    let pending!: Promise<Connection | null>;
    await act(async () => {
      pending = result.current.saveNow();
    });
    expect(list).toHaveBeenCalledOnce();
    mocks.vault = {
      ...mocks.vault,
      scope: { databaseId: "db-a", generation: 2 },
    };
    rerender({ connection: connectionA, open: true });
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("vault owner changed"),
    );
  });
  it("initializes an unsaved draft with only its requested folder and persists only after Save", async () => {
    const folder = {
      ...connectionA,
      id: "target-folder",
      isGroup: true,
      password: "synthetic-parent-secret",
      hostname: "parent-host",
      icon: "folder-lock",
    };
    mocks.state.connections = [folder];
    mocks.settings.autoSaveEnabled = true;
    const { result } = renderHook(() =>
      useConnectionEditor(undefined, true, mocks.close, folder.id),
    );
    expect(result.current.formData).toMatchObject({
      parentId: folder.id,
      hostname: "",
      password: "",
    });
    expect(result.current.formData.icon).not.toBe(folder.icon);
    expect(result.current.isNewConnection).toBe(true);
    await advance(2000);
    expect(mocks.flush).not.toHaveBeenCalled();
    act(() =>
      result.current.setFormData((draft) => ({
        ...draft,
        name: "New child",
        hostname: "child.example",
      })),
    );
    await advance(2000);
    expect(mocks.flush).not.toHaveBeenCalled();
    await act(async () => result.current.handleSubmit(submitEvent()));
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.flush.mock.calls[0][0]).toMatchObject({
      type: "ADD_CONNECTION",
      payload: {
        name: "New child",
        hostname: "child.example",
        parentId: folder.id,
      },
    });
    expect(JSON.stringify(mocks.flush.mock.calls[0][0])).not.toContain(
      "synthetic-parent-secret",
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("keeps root creation and existing edits unchanged and never selects a non-folder as initial parent", () => {
    mocks.state.connections = [connectionA];
    const root = renderHook(() =>
      useConnectionEditor(undefined, true, mocks.close),
    );
    expect(root.result.current.formData.parentId).toBeUndefined();
    const invalid = renderHook(() =>
      useConnectionEditor(undefined, true, mocks.close, connectionA.id),
    );
    expect(invalid.result.current.formData.parentId).toBeUndefined();
    const missing = renderHook(() =>
      useConnectionEditor(undefined, true, mocks.close, "missing-folder"),
    );
    expect(missing.result.current.formData.parentId).toBeUndefined();
    const existing = renderHook(() =>
      useConnectionEditor(
        { ...connectionB, parentId: "original-parent" },
        true,
        mocks.close,
        "ignored-target",
      ),
    );
    expect(existing.result.current.formData.parentId).toBe("original-parent");
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it.each(["deleted", "no longer a folder"])(
    "preserves a new draft and refuses saving when its parent is %s",
    async (change) => {
      const folder = { ...connectionA, id: "target-folder", isGroup: true };
      mocks.state.connections = [folder];
      const { result, rerender } = renderHook(() =>
        useConnectionEditor(undefined, true, mocks.close, folder.id),
      );
      edit(result, "unsaved.example");
      mocks.state.connections = [{ ...folder, name: "Renamed folder" }];
      rerender();
      expect(result.current.formData.hostname).toBe("unsaved.example");
      mocks.state.connections =
        change === "deleted" ? [] : [{ ...folder, isGroup: false }];
      rerender();
      await act(async () => result.current.handleSubmit(submitEvent()));
      expect(mocks.flush).not.toHaveBeenCalled();
      expect(mocks.close).not.toHaveBeenCalled();
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.stringContaining("parent folder is no longer available"),
      );
      expect(result.current.formData.parentId).toBe(folder.id);
      act(() =>
        result.current.setFormData((draft) => ({
          ...draft,
          parentId: undefined,
        })),
      );
      await act(async () => result.current.handleSubmit(submitEvent()));
      expect(mocks.flush).toHaveBeenCalledTimes(1);
      expect(mocks.flush.mock.calls[0][0].payload.parentId).toBeUndefined();
      expect(mocks.flush.mock.calls[0][0].payload.hostname).toBe(
        "unsaved.example",
      );
    },
  );
  it("preserves a newer edit during a slow save and an optimistic same-ID echo", async () => {
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result, rerender } = editor();
    edit(result, "first.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, "newer.example");
    rerender({ connection: mocks.flush.mock.calls[0][0].payload, open: true });
    expect(result.current.formData.hostname).toBe("newer.example");
    let oldOutcome: Connection | null | undefined;
    await act(async () => {
      flush.resolve();
      oldOutcome = await first;
    });
    expect(oldOutcome).toBeNull();
    expect(result.current.formData.hostname).toBe("newer.example");
    let latest: Connection | null = null;
    await act(async () => {
      latest = await result.current.saveNow();
    });
    expect(latest).toMatchObject({
      id: connectionA.id,
      hostname: "newer.example",
    });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["first.example", "newer.example"]);
  });

  it("suppresses connection A's completion after switching to B", async () => {
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result, rerender } = editor();
    edit(result, "a-pending.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    rerender({ connection: connectionB, open: true });
    expect(result.current.formData).toMatchObject({
      id: connectionB.id,
      hostname: connectionB.hostname,
    });
    let outcome: Connection | null | undefined;
    await act(async () => {
      flush.resolve();
      outcome = await first;
    });
    expect(outcome).toBeNull();
    expect(result.current.formData.id).toBe(connectionB.id);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    edit(result, "b-current.example");
    await act(async () => {
      await result.current.saveNow();
    });
    expect(mocks.flush.mock.calls[1][0].payload).toMatchObject({
      id: connectionB.id,
      hostname: "b-current.example",
    });
  });

  it("rehydrates the latest same-ID prop only when the editor is reopened", () => {
    const { result, rerender } = editor();
    edit(result, "local-draft.example");
    const latest = { ...connectionA, hostname: "latest-stored.example" };
    rerender({ connection: latest, open: true });
    expect(result.current.formData.hostname).toBe("local-draft.example");
    rerender({ connection: latest, open: false });
    rerender({ connection: latest, open: true });
    expect(result.current.formData.hostname).toBe("latest-stored.example");
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it("distinguishes a new form from a saved connection whose literal ID is new", () => {
    const { result, rerender } = editor({ ...connectionA, id: "new" });
    expect(result.current.formData.id).toBe("new");
    rerender({ connection: undefined, open: true });
    expect(result.current.formData.id).toBeUndefined();
    expect(result.current.formData.hostname).toBe("");
  });

  it("does not enqueue redundant same-revision autosaves after a live prop echo", async () => {
    mocks.settings.autoSaveEnabled = true;
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result, rerender } = editor();
    await advance(20);
    edit(result, "autosaved.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    rerender({ connection: mocks.flush.mock.calls[0][0].payload, open: true });
    await advance(1000);
    await act(async () => {
      flush.resolve();
    });
    await advance(4000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, "next-revision.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(2);
    expect(mocks.flush.mock.calls[1][0].payload.hostname).toBe(
      "next-revision.example",
    );
  });

  it("autosaves reverting to the original value after another value was durably saved", async () => {
    mocks.settings.autoSaveEnabled = true;
    const { result } = editor();
    await advance(20);
    edit(result, "saved-intermediate.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, connectionA.hostname);
    await advance(1000);
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["saved-intermediate.example", connectionA.hostname]);
  });

  it("queues a revert while the intermediate autosave is still pending", async () => {
    mocks.settings.autoSaveEnabled = true;
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result } = editor();
    await advance(20);
    edit(result, "pending-intermediate.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, connectionA.hostname);
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    await act(async () => {
      flush.resolve();
    });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["pending-intermediate.example", connectionA.hostname]);
    expect(result.current.formData.hostname).toBe(connectionA.hostname);
  });

  it("does not return an apparently clean revert before an older manual save finishes", async () => {
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result } = editor();
    edit(result, "pending-manual.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    edit(result, connectionA.hostname);
    let settled = false;
    let latest!: Promise<Connection | null>;
    await act(async () => {
      latest = result.current.saveNow().then((value) => {
        settled = true;
        return value;
      });
    });
    expect(settled).toBe(false);
    let outcomes!: Array<Connection | null>;
    await act(async () => {
      flush.resolve();
      outcomes = await Promise.all([first, latest]);
    });
    expect(outcomes[0]).toBeNull();
    expect(outcomes[1]).toMatchObject({
      id: connectionA.id,
      hostname: connectionA.hostname,
    });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["pending-manual.example", connectionA.hostname]);
  });

  it("keeps a failed reverted write retryable even when the form matches the initial baseline", async () => {
    const flush = deferred();
    mocks.flush
      .mockImplementationOnce(() => flush.promise)
      .mockRejectedValueOnce(new Error("Revert was not persisted"));
    const { result } = editor();
    edit(result, "intermediate-on-disk.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    edit(result, connectionA.hostname);
    let revert!: Promise<Connection | null>;
    await act(async () => {
      revert = result.current.saveNow();
    });
    let failed: Connection | null | undefined;
    await act(async () => {
      flush.resolve();
      await first;
      failed = await revert;
    });
    expect(failed).toBeNull();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Revert was not persisted"),
    );
    expect(result.current.formData.hostname).toBe(connectionA.hostname);
    let retry: Connection | null = null;
    await act(async () => {
      retry = await result.current.saveNow();
    });
    expect(retry).toMatchObject({ hostname: connectionA.hostname });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual([
      "intermediate-on-disk.example",
      connectionA.hostname,
      connectionA.hostname,
    ]);
  });
});

describe("pending bookmark save coordination", () => {
  function startDraft(result: { current: Editor }, name = "Renamed") {
    const data = result.current.formData;
    mocks.state.connections = [data as Connection];
    mocks.flush.mockImplementation(async (action) => {
      mocks.state.connections = [action.payload];
    });
    const item = data.httpBookmarks![0];
    act(() =>
      result.current.bookmarkDraft.setEdit({
        source: data.httpBookmarks,
        connectionId: data.id,
        protocol: data.protocol,
        parents: [],
        index: 0,
        item,
        name,
        path: item.isFolder ? "" : item.path,
      }),
    );
  }
  const web = {
    ...connectionA,
    protocol: "https" as const,
    httpBookmarks: [{ name: "Status", path: "/status" }],
  };
  it("saveNow includes a pending name-only draft", async () => {
    const { result } = editor(web);
    await advance(20);
    startDraft(result);
    await act(async () => {
      expect((await result.current.saveNow())?.httpBookmarks?.[0].name).toBe(
        "Renamed",
      );
    });
    expect(mocks.flush.mock.calls[0][0].payload.httpBookmarks[0].name).toBe(
      "Renamed",
    );
    expect(result.current.bookmarkDraft.edit).toBeNull();
  });
  it("refuses stale tree replacement before requesting persistence", async () => {
    const { result } = editor(web);
    await advance(20);
    startDraft(result);
    act(() =>
      result.current.setFormData((data) => ({
        ...data,
        httpBookmarks: [{ name: "Concurrent", path: "/other" }],
      })),
    );
    await act(async () => {
      expect(await result.current.saveNow()).toBeNull();
    });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(result.current.formData.httpBookmarks?.[0].name).toBe("Concurrent");
  });
  it("does not let an older save clear a name typed while persistence waits", async () => {
    const { result } = editor(web);
    await advance(20);
    startDraft(result, "First");
    const pending = deferred();
    mocks.flush.mockReturnValueOnce(pending.promise);
    let save: Promise<Connection | null>;
    act(() => {
      save = result.current.saveNow();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() =>
      result.current.bookmarkDraft.setEdit((edit) =>
        edit ? { ...edit, name: "Latest" } : null,
      ),
    );
    await act(async () => {
      pending.resolve();
      await save;
    });
    expect(result.current.bookmarkDraft.edit?.name).toBe("Latest");
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
  it("waits for the pending bookmark review before autosaving unrelated edits", async () => {
    const { result } = editor(web);
    await advance(20);
    startDraft(result, "");
    mocks.settings.autoSaveEnabled = true;
    edit(result, "other.example");
    await advance(2000);
    expect(mocks.flush).not.toHaveBeenCalled();
    act(() => result.current.bookmarkDraft.setEdit(null));
    await advance(1200);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });
});

describe("pending bookmark editor lifetime", () => {
  it.each(["close", "owner"])(
    "discards the pending bookmark after %s changes",
    async (kind) => {
      const web = {
        ...connectionA,
        protocol: "https" as const,
        httpBookmarks: [{ name: "Old", path: "/old" }],
      };
      const { result, rerender } = editor(web);
      await advance(20);
      const data = result.current.formData;
      act(() =>
        result.current.bookmarkDraft.setEdit({
          source: data.httpBookmarks,
          connectionId: data.id,
          protocol: data.protocol,
          parents: [],
          index: 0,
          item: data.httpBookmarks![0],
          name: "Discard",
          path: "/old",
        }),
      );
      if (kind === "owner")
        mocks.databaseAvailability = {
          status: "ready",
          databaseId: "db-b",
          generation: 2,
        };
      rerender({ connection: web, open: kind !== "close" });
      expect(result.current.bookmarkDraft.edit).toBeNull();
      expect(mocks.flush).not.toHaveBeenCalled();
      if (kind === "close") {
        rerender({ connection: web, open: true });
        expect(result.current.bookmarkDraft.edit).toBeNull();
      }
    },
  );
});

describe("pending bookmark live ownership proof", () => {
  const web = {
    ...connectionA,
    protocol: "https" as const,
    httpBookmarks: [{ name: "Status", path: "/status" }],
  };
  async function begin() {
    mocks.state.connections = [web];
    mocks.flush.mockImplementation(async (action) => {
      mocks.state.connections = [action.payload];
    });
    const hook = editor(web);
    await advance(20);
    const data = hook.result.current.formData;
    act(() =>
      hook.result.current.bookmarkDraft.setEdit({
        source: data.httpBookmarks,
        connectionId: data.id,
        protocol: data.protocol,
        parents: [],
        index: 0,
        item: data.httpBookmarks![0],
        name: "New name",
        path: "/status",
      }),
    );
    return hook;
  }
  it("retains the owner fence after clearing the child draft and blocks dirty-field autosave and main Save", async () => {
    const { result, rerender } = await begin();
    edit(result, "unsaved.example");
    mocks.settings.autoSaveEnabled = true;
    mocks.databaseAvailability = {
      status: "ready",
      databaseId: "db-b",
      generation: 2,
    };
    rerender({ connection: web, open: true });
    expect(result.current.bookmarkDraft.edit).toBeNull();
    await advance(2000);
    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalled();
  });
  it("does not overwrite a live same-ID bookmark edit absent from the local editor draft", async () => {
    const { result, rerender } = await begin();
    const foreign = {
      ...web,
      httpBookmarks: [{ name: "Other editor", path: "/other" }],
    };
    mocks.state.connections = [foreign];
    rerender({ connection: foreign, open: true });
    await act(async () => {
      expect(await result.current.saveNow()).toBeNull();
    });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.state.connections[0].httpBookmarks?.[0].name).toBe(
      "Other editor",
    );
  });
  it("rechecks ownership immediately before dispatch after async preparation", async () => {
    const { result } = await begin();
    // Resolve-time and pre-prepare proofs succeed; the post-await proof sees
    // the provider transition before React can publish it.
    mocks.getCurrentConnections
      .mockImplementationOnce(() => [web])
      .mockImplementationOnce(() => [web])
      .mockImplementation(() => {
        throw new Error("owner changed");
      });
    await act(async () => {
      expect(await result.current.saveNow()).toBeNull();
    });
    expect(mocks.getCurrentConnections).toHaveBeenCalledTimes(3);
    expect(mocks.flush).not.toHaveBeenCalled();
  });
});

it.each(["external", "original"])(
  "retains a pending bookmark when the %s tree arrives during storage flush",
  async (treeKind) => {
    const web = {
      ...connectionA,
      protocol: "https" as const,
      httpBookmarks: [{ name: "Old", path: "/old" }],
    };
    mocks.state.connections = [web];
    const { result } = editor(web);
    await advance(20);
    const data = result.current.formData;
    act(() =>
      result.current.bookmarkDraft.setEdit({
        source: data.httpBookmarks,
        connectionId: data.id,
        protocol: data.protocol,
        parents: [],
        index: 0,
        item: data.httpBookmarks![0],
        name: "Pending name",
        path: "/old",
      }),
    );
    const pending = deferred();
    mocks.flush.mockReturnValueOnce(pending.promise);
    let save: Promise<Connection | null>;
    act(() => {
      save = result.current.saveNow();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    const other =
      treeKind === "original"
        ? web
        : { ...web, httpBookmarks: [{ name: "External", path: "/external" }] };
    mocks.state.connections = [other];
    await act(async () => {
      pending.resolve();
      expect(await save).toBeNull();
    });
    expect(result.current.bookmarkDraft.edit?.name).toBe("Pending name");
    expect(mocks.state.connections[0].httpBookmarks?.[0].name).toBe(
      other.httpBookmarks[0].name,
    );
    expect(mocks.toast.error).toHaveBeenCalled();
  },
);

it("does not replace another editor lifecycle's bookmark source after an older flush settles", async () => {
  const a = {
    ...connectionA,
    protocol: "https" as const,
    httpBookmarks: [{ name: "A bookmark", path: "/a" }],
  };
  const b = {
    ...connectionB,
    protocol: "https" as const,
    httpBookmarks: [{ name: "B bookmark", path: "/b" }],
  };
  mocks.state.connections = [a, b];
  const { result, rerender } = editor(a);
  await advance(20);
  const setName = (name: string) => {
    const data = result.current.formData;
    act(() =>
      result.current.bookmarkDraft.setEdit({
        source: data.httpBookmarks,
        connectionId: data.id,
        protocol: data.protocol,
        parents: [],
        index: 0,
        item: data.httpBookmarks![0],
        name,
        path: (data.httpBookmarks![0] as { path: string }).path,
      }),
    );
  };
  setName("A saved");
  const pending = deferred();
  mocks.flush.mockImplementationOnce((action) => {
    mocks.state.connections = [action.payload, b];
    return pending.promise;
  });
  let old: Promise<Connection | null>;
  act(() => {
    old = result.current.saveNow();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(mocks.flush).toHaveBeenCalledTimes(1);
  rerender({ connection: b, open: true });
  await advance(20);
  await act(async () => {
    pending.resolve();
    await old;
  });
  mocks.flush.mockImplementation(async (action) => {
    mocks.state.connections = mocks.state.connections.map((row) =>
      row.id === action.payload.id ? action.payload : row,
    );
  });
  setName("B saved");
  await act(async () => {
    expect((await result.current.saveNow())?.httpBookmarks?.[0].name).toBe(
      "B saved",
    );
  });
  expect(mocks.flush).toHaveBeenCalledTimes(2);
});

it("prunes a first bookmark review opened while an earlier local edit save waits", async () => {
  const web = {
    ...connectionA,
    protocol: "https" as const,
    httpBookmarks: [
      { name: "Remove", path: "/remove" },
      { name: "Keep", path: "/keep" },
    ],
  };
  mocks.state.connections = [web];
  const { result } = editor(web);
  await advance(20);
  act(() =>
    result.current.setFormData((data) => ({
      ...data,
      httpBookmarks: [web.httpBookmarks[1]],
    })),
  );
  const pending = deferred();
  mocks.flush.mockImplementationOnce((action) => {
    mocks.state.connections = [action.payload];
    return pending.promise;
  });
  let old: Promise<Connection | null>;
  act(() => {
    old = result.current.saveNow();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(mocks.flush).toHaveBeenCalledTimes(1);
  const data = result.current.formData;
  act(() =>
    result.current.bookmarkDraft.setEdit({
      source: data.httpBookmarks,
      connectionId: data.id,
      protocol: data.protocol,
      parents: [],
      index: 0,
      item: data.httpBookmarks![0],
      name: "Pending rename",
      path: "/keep",
    }),
  );
  await act(async () => {
    pending.resolve();
    await old;
  });
  mocks.state.connections = [web];
  await act(async () => {
    expect(await result.current.saveNow()).toBeNull();
  });
  expect(mocks.flush).toHaveBeenCalledTimes(1);
  expect(result.current.bookmarkDraft.edit?.name).toBe("Pending rename");
});

it("does not adopt another owner when the first bookmark review opens after switching databases", async () => {
  const web = {
    ...connectionA,
    protocol: "https" as const,
    httpBookmarks: [{ name: "Old owner bookmark", path: "/old" }],
  };
  mocks.state.connections = [web];
  const { result, rerender } = editor(web);
  await advance(20);
  mocks.databaseAvailability = {
    status: "ready",
    databaseId: "db-b",
    generation: 2,
  };
  rerender({ connection: web, open: true });
  const data = result.current.formData;
  act(() =>
    result.current.bookmarkDraft.setEdit({
      source: data.httpBookmarks,
      connectionId: data.id,
      protocol: data.protocol,
      parents: [],
      index: 0,
      item: data.httpBookmarks![0],
      name: "Wrong owner rename",
      path: "/old",
    }),
  );
  await act(async () => {
    expect(await result.current.saveNow()).toBeNull();
  });
  expect(mocks.flush).not.toHaveBeenCalled();
});
