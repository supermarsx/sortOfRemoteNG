import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageData } from "../../src/utils/storage/storage";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import type { DatabaseCredentialEntry } from "../../src/types/security/databaseCredentialVault";
import type { DatabaseVaultArchive } from "../../src/types/security/vaultArchive";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import DatabaseCredentialVault from "../../src/components/security/DatabaseCredentialVault";
const mock = vi.hoisted(() => ({
  owner: "db-a",
  locked: false,
  desktop: true,
  managed: true,
  saved: null as StorageData | null,
  save: vi.fn(),
  status: vi.fn(),
  verify: vi.fn(),
  choose: vi.fn(),
  decrypt: vi.fn(),
  manager: {} as Record<string, unknown>,
  access: null as
    null | ((event: { databaseId: string; status: string }) => void),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => mock.manager },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (mock.desktop ? vi.fn() : null),
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
}));
vi.mock("../../src/utils/security/vaultArchiveFiles", () => ({
  chooseVaultArchiveFile: mock.choose,
  saveVaultArchiveFile: vi.fn(),
}));
vi.mock("../../src/utils/security/vaultArchive", async (original) => ({
  ...(await original<object>()),
  decryptVaultArchive: mock.decrypt,
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entry = (): DatabaseCredentialEntry => ({
  id,
  name: "NAS operator",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  facets: {
    username: "PRIVATE_ACCOUNT",
    password: "PRIVATE_PASSWORD",
    totp: [
      {
        id,
        label: "OTP",
        secret: "JBSWY3DPEHPK3PXP",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ],
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mock.owner = "db-a";
  mock.locked = false;
  mock.desktop = true;
  mock.managed = true;
  mock.saved = {
    connections: [
      {
        id: "host",
        name: "before",
        protocol: "ssh",
        hostname: "fixture.invalid",
        port: 22,
        isGroup: false,
        createdAt: "2026-09-10",
        updatedAt: "2026-09-10",
        password: "CONNECTION_LOCAL_UNTOUCHED",
      },
    ],
    settings: { retained: true },
    timestamp: 1,
  };
  mock.save.mockReset().mockImplementation(async (data: StorageData) => {
    mock.saved = structuredClone(data);
  });
  mock.status.mockReset().mockResolvedValue({
    kind: "managed",
    unlocked: true,
    securityRevision: "revision",
  });
  mock.verify.mockReset().mockResolvedValue(undefined);
  mock.choose.mockReset().mockResolvedValue("SYNTHETIC_ENCRYPTED_ARCHIVE");
  mock.decrypt.mockReset().mockImplementation(async () => archive());
  mock.manager = {
    getCurrentDatabase: () =>
      mock.owner
        ? {
            id: mock.owner,
            ...(mock.managed ? { protectionFormat: "sorng-db" } : {}),
            securityRevision: "revision",
          }
        : null,
    getDatabaseAccessState: () => ({
      status: mock.locked ? "suspended" : "ready",
    }),
    getDatabaseProtectionStatus: mock.status,
    onCurrentDatabaseChange: () => () => {},
    onDatabaseAccessChange: (listener: typeof mock.access) => {
      mock.access = listener;
      return () => {
        mock.access = null;
      };
    },
    registerBeforeDatabaseTransition: () => () => {},
    captureCurrentDatabaseDataTarget: (): DatabaseDataTarget => {
      const owner = mock.owner;
      let baseline: StorageData | null = null;
      return {
        databaseId: owner,
        assertAccessible: () => {
          if (mock.locked || mock.owner !== owner)
            throw Error("Access changed");
        },
        load: async () => {
          baseline = structuredClone(mock.saved);
          return structuredClone(mock.saved);
        },
        save: async (data) => {
          await mock.save(data);
          baseline = structuredClone(data);
        },
        verifyCurrent: async () => {
          await mock.verify();
          if (JSON.stringify(baseline) !== JSON.stringify(mock.saved))
            throw Error("Database changed in another window");
        },
      };
    },
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function mount() {
  const hook = renderHook(() => useConnections(), { wrapper });
  await act(() => hook.result.current.loadData("db-a"));
  return hook;
}
async function add(hook: Awaited<ReturnType<typeof mount>>) {
  const api = hook.result.current.credentialVault!;
  const snapshot = await api.list(api.scope!);
  await act(() =>
    api.compareAndSwap(snapshot, [{ operation: "put", entry: entry() }]),
  );
  return hook.result.current.credentialVault!.list(api.scope!);
}

const archive = (): DatabaseVaultArchive => ({
  format: "sorng-vault-archive",
  version: 1,
  createdAt: "2026-09-10T00:00:00.000Z",
  credentials: [entry()],
  connections: [
    {
      id: "imported-host",
      name: "Imported NAS",
      protocol: "ssh",
      hostname: "archive.invalid",
      port: 22,
      isGroup: false,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      credentialSource: { kind: "vault", credentialId: id, totpId: id },
    },
  ],
});

describe("native global encryption proof for vault access", () => {
  it.each(["none", "legacy-password"])(
    "supports %s only with actual global encryption proof and owner access",
    async (kind) => {
      mock.managed = false;
      mock.status.mockResolvedValue({
        kind,
        unlocked: kind === "none",
        securityRevision: "revision",
        globalEncryptionProtected: true,
      });
      const hook = await mount();
      expect(hook.result.current.documents!.scope).toBeNull();
      const snapshot = await add(hook);
      const api = hook.result.current.credentialVault!;
      expect(await api.resolve(snapshot, id, ["password"])).toEqual({
        password: "PRIVATE_PASSWORD",
      });
      mock.locked = true;
      await expect(api.resolve(snapshot, id, ["password"])).rejects.toThrow(
        /owning|changed|protected/,
      );
    },
  );

  it.each([undefined, false, "true", 1, null])(
    "does not accept malformed or absent global proof %s",
    async (proof) => {
      mock.managed = false;
      mock.status.mockResolvedValue({
        kind: "none",
        unlocked: true,
        securityRevision: "revision",
        globalEncryptionProtected: proof,
      });
      const hook = await mount();
      const api = hook.result.current.credentialVault!;
      await expect(api.list(api.scope!)).rejects.toThrow(/Merely unlocking/);
      expect(mock.save).not.toHaveBeenCalled();
    },
  );

  it("rejects replaced native security revisions even when global encryption remains enabled", async () => {
    mock.managed = false;
    mock.status.mockResolvedValue({
      kind: "none",
      unlocked: true,
      securityRevision: "replaced",
      globalEncryptionProtected: true,
    });
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    await expect(api.list(api.scope!)).rejects.toThrow(/lease changed/);
    expect(mock.save).not.toHaveBeenCalled();
  });
});

describe("database-owned vault archives", () => {
  it("keeps actual parent import success through Provider publication and refreshed vault receipts", async () => {
    const hook = renderHook(() => useConnections(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ConnectionProvider>
          {children}
          <DatabaseCredentialVault />
        </ConnectionProvider>
      ),
    });
    await act(() => hook.result.current.loadData("db-a"));
    const importButton = await screen.findByRole("button", {
      name: /Import archive/,
    });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    fireEvent.change(await screen.findByLabelText("Archive password"), {
      target: { value: "synthetic archive password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open and review archive" }),
    );
    const commit = await screen.findByRole("button", {
      name: "Import reviewed records",
    });
    expect(mock.save).not.toHaveBeenCalled();
    fireEvent.click(commit);
    await waitFor(() =>
      expect(
        screen.getByText(/Imported 1 credentials and 1 linked connections/),
      ).toBeInTheDocument(),
    );
    expect(mock.save).toHaveBeenCalledOnce();
    expect(hook.result.current.state.connections).toHaveLength(2);
    const api = hook.result.current.credentialVault!;
    expect(api.changeRevision).toBeGreaterThan(0);
    const snapshot = await api.list(api.scope!);
    expect(snapshot.entries).toHaveLength(1);
    await act(async () => hook.rerender());
    expect(
      screen.getByText(/Imported 1 credentials and 1 linked connections/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import reviewed records" }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("PRIVATE_PASSWORD");
    expect(document.body.textContent).not.toContain("JBSWY3DPEHPK3PXP");
    expect(mock.save).toHaveBeenCalledOnce();
  });
  it("exports only reviewed entries and linked connections, stripping ignored local credentials", async () => {
    mock.saved!.credentialVault = {
      version: 1,
      revision: 1,
      entries: [entry()],
    };
    mock.saved!.connections[0].credentialSource = {
      kind: "vault",
      credentialId: id,
    };
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    const snapshot = await api.list(api.scope!);
    expect(await api.archiveConnections!(snapshot)).toEqual([
      {
        id: "host",
        name: "before",
        protocol: "ssh",
        hostname: "fixture.invalid",
        credentialId: id,
      },
    ]);
    const output = await api.exportArchive!(snapshot, [id], ["host"]);
    expect(output.credentials).toEqual([entry()]);
    expect(output.connections[0].credentialSource).toEqual({
      kind: "vault",
      credentialId: id,
    });
    expect(output.connections[0].password).toBeUndefined();
    expect(mock.saved!.connections[0].password).toBe(
      "CONNECTION_LOCAL_UNTOUCHED",
    );
    await expect(api.exportArchive!(snapshot, [], ["host"])).rejects.toThrow(
      /archive/,
    );
    await expect(api.exportArchive!(snapshot, [id, id], [])).rejects.toThrow(
      /once/,
    );
    await expect(
      api.exportArchive!(snapshot, [id], ["missing"]),
    ).rejects.toThrow(/unavailable/);
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("rejects exported connection selections after any reviewed connection edit", async () => {
    mock.saved!.credentialVault = {
      version: 1,
      revision: 1,
      entries: [entry()],
    };
    mock.saved!.connections[0].credentialSource = {
      kind: "vault",
      credentialId: id,
    };
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    const snapshot = await api.list(api.scope!);
    act(() =>
      hook.result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...mock.saved!.connections[0], hostname: "changed.invalid" },
      }),
    );
    await expect(api.exportArchive!(snapshot, [id], ["host"])).rejects.toThrow(
      /Connections changed/,
    );
    await expect(api.archiveConnections!(snapshot)).rejects.toThrow(
      /Connections changed/,
    );
  });

  it("fences export and import before disclosure/save after owner changes", async () => {
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    const snapshot = await api.list(api.scope!);
    const gate = deferred<void>();
    mock.verify.mockImplementationOnce(() => gate.promise);
    const output = api.exportArchive!(snapshot, [], []);
    const rejected = expect(output).rejects.toThrow(/owning|changed/);
    await waitFor(() => expect(mock.verify).toHaveBeenCalledTimes(2));
    mock.owner = "db-b";
    gate.resolve();
    await rejected;
    await expect(api.importArchive!(snapshot, archive())).rejects.toThrow(
      /owning|changed/,
    );
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("imports vault entries and fresh connection references in one durable write before publishing", async () => {
    mock.saved!.documents = {
      version: 1,
      revision: 0,
      documents: [],
      attachments: [],
      people: [],
      tickets: [],
    };
    const original = structuredClone(mock.saved);
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    const snapshot = await api.list(api.scope!);
    const gate = deferred<void>();
    mock.save.mockImplementationOnce(async (data: StorageData) => {
      await gate.promise;
      mock.saved = structuredClone(data);
    });
    const input = archive();
    const pending = api.importArchive!(snapshot, input);
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    expect(hook.result.current.state.connections).toHaveLength(1);
    expect(mock.saved!.credentialVault).toBeUndefined();
    expect(hook.result.current.credentialVault!.changeRevision).toBe(
      api.changeRevision,
    );
    const proposed = mock.save.mock.calls[0][0] as StorageData;
    const newCredential = proposed.credentialVault!.entries[0];
    expect(proposed.connections).toHaveLength(2);
    expect(newCredential.id).not.toBe(id);
    expect(proposed.connections[1].id).not.toBe(input.connections[0].id);
    expect(proposed.connections[1].credentialSource).toEqual({
      kind: "vault",
      credentialId: newCredential.id,
      totpId: newCredential.facets.totp![0].id,
    });
    expect(proposed.documents).toEqual(original!.documents);
    expect(proposed.settings).toEqual(original!.settings);
    await act(async () => {
      gate.resolve();
      expect(await pending).toEqual({ credentialCount: 1, connectionCount: 1 });
    });
    expect(mock.save).toHaveBeenCalledOnce();
    expect(hook.result.current.state.connections).toHaveLength(2);
    expect(JSON.stringify(hook.result.current.state)).not.toContain(
      "PRIVATE_PASSWORD",
    );
    const next = hook.result.current.credentialVault!;
    const reviewed = await next.list(next.scope!);
    expect(
      await next.resolve(reviewed, newCredential.id, ["password"]),
    ).toEqual({ password: "PRIVATE_PASSWORD" });
  });

  it("preserves ordinary concurrent edits while committing the imported pair", async () => {
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    const snapshot = await api.list(api.scope!);
    const gate = deferred<void>();
    mock.save.mockImplementationOnce(async (data: StorageData) => {
      await gate.promise;
      mock.saved = structuredClone(data);
    });
    const pending = api.importArchive!(snapshot, archive());
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    act(() =>
      hook.result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...mock.saved!.connections[0],
          name: "edited during import",
        },
      }),
    );
    await act(async () => {
      gate.resolve();
      await pending;
      await hook.result.current.flushPendingSave();
    });
    expect(mock.saved!.connections).toHaveLength(2);
    expect(mock.saved!.connections[0].name).toBe("edited during import");
    expect(mock.saved!.connections[1].credentialSource).toMatchObject({
      credentialId: mock.saved!.credentialVault!.entries[0].id,
    });
    expect(mock.save).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "never publishes or retries an import with failed durable verification (committed=%s)",
    async (committed) => {
      const hook = await mount();
      const api = hook.result.current.credentialVault!;
      const snapshot = await api.list(api.scope!);
      mock.save.mockImplementationOnce(async (data: StorageData) => {
        if (committed) mock.saved = structuredClone(data);
        throw Error("SYNTHETIC_PRIVATE_BACKEND_DETAIL");
      });
      await expect(api.importArchive!(snapshot, archive())).rejects.toThrow(
        /could not be verified/,
      );
      expect(hook.result.current.state.connections).toHaveLength(1);
      expect(hook.result.current.credentialVault!.changeRevision).toBe(
        api.changeRevision,
      );
      await expect(api.list(api.scope!)).rejects.toThrow(
        /could not be verified/,
      );
      act(() =>
        hook.result.current.dispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...hook.result.current.state.connections[0],
            name: "retained draft",
          },
        }),
      );
      await expect(hook.result.current.flushPendingSave()).rejects.toThrow(
        /could not be verified/,
      );
      expect(mock.save).toHaveBeenCalledOnce();
      expect(hook.result.current.state.connections[0].name).toBe(
        "retained draft",
      );
    },
  );

  it("reports committed import with a separate warning when concurrent connection autosave fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    const snapshot = await api.list(api.scope!);
    const gate = deferred<void>();
    mock.save
      .mockImplementationOnce(async (data: StorageData) => {
        await gate.promise;
        mock.saved = structuredClone(data);
      })
      .mockRejectedValueOnce(Error("ordinary autosave failed"));
    const pending = api.importArchive!(snapshot, archive());
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    act(() =>
      hook.result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...mock.saved!.connections[0],
          name: "unsaved concurrent draft",
        },
      }),
    );
    await act(async () => {
      gate.resolve();
      expect(await pending).toEqual({
        credentialCount: 1,
        connectionCount: 1,
        warning: expect.stringContaining("do not repeat this import"),
      });
    });
    expect(mock.save).toHaveBeenCalledTimes(2);
    expect(mock.saved!.credentialVault!.entries).toHaveLength(1);
    expect(mock.saved!.connections).toHaveLength(2);
    expect(mock.saved!.connections[0].name).toBe("before");
    expect(hook.result.current.state.connections[0].name).toBe(
      "unsaved concurrent draft",
    );
    expect(hook.result.current.persistence).toMatchObject({
      dirty: true,
      error: "ordinary autosave failed",
    });
    // Retry the ordinary retained save, never the already-committed import.
    await act(() => hook.result.current.flushPendingSave());
    expect(mock.save).toHaveBeenCalledTimes(3);
    expect(mock.saved!.connections[0].name).toBe("unsaved concurrent draft");
    expect(mock.saved!.credentialVault!.entries).toHaveLength(1);
    expect(mock.saved!.connections).toHaveLength(2);
  });

  it("does not publish a completed import after losing the owning database", async () => {
    const hook = await mount();
    const api = hook.result.current.credentialVault!;
    const snapshot = await api.list(api.scope!);
    const gate = deferred<void>();
    mock.save.mockImplementationOnce(() => gate.promise);
    const pending = api.importArchive!(snapshot, archive());
    const rejected = expect(pending).rejects.toThrow(/could not be verified/);
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    mock.owner = "db-b";
    gate.resolve();
    await rejected;
    expect(hook.result.current.state.connections).toHaveLength(1);
    expect(mock.saved!.credentialVault).toBeUndefined();
  });
});

describe("managed database credential vault persistence", () => {
  it("lists empty on legacy absence without migrating local credentials or exposing secrets", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!;
    expect((await api.list(api.scope!)).entries).toEqual([]);
    expect(mock.save).not.toHaveBeenCalled();
    const snapshot = await add(hook);
    expect(snapshot.entries[0]).toMatchObject({
      id,
      name: "NAS operator",
      availableFacets: ["username", "password", "totp"],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /PRIVATE_|JBSW|CONNECTION_LOCAL/,
    );
    expect(JSON.stringify(hook.result.current.state)).not.toMatch(
      /PRIVATE_|JBSW/,
    );
    expect(mock.saved!.connections[0].password).toBe(
      "CONNECTION_LOCAL_UNTOUCHED",
    );
    expect(await api.resolve(snapshot, id, ["password"])).toEqual({
      password: "PRIVATE_PASSWORD",
    });
    const otp = await api.resolve(snapshot, id, ["totp"]);
    otp.totp![0].secret = "CHANGED";
    expect((await api.resolve(snapshot, id, ["totp"])).totp![0].secret).toBe(
      "JBSWY3DPEHPK3PXP",
    );
  });
  it("publishes only after durable commit and preserves connection edits during save", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await api.list(api.scope!);
    const gate = deferred<void>();
    mock.save.mockImplementationOnce(async (data: StorageData) => {
      await gate.promise;
      mock.saved = structuredClone(data);
    });
    let completed = false;
    const write = api
      .compareAndSwap(snapshot, [{ operation: "put", entry: entry() }])
      .then(() => {
        completed = true;
      });
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    expect(mock.saved?.credentialVault).toBeUndefined();
    expect(hook.result.current.credentialVault!.changeRevision).toBe(
      api.changeRevision,
    );
    act(() =>
      hook.result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...mock.saved!.connections[0], name: "while saving" },
      }),
    );
    await act(async () => {
      gate.resolve();
      await write;
      await hook.result.current.flushPendingSave();
    });
    expect(mock.saved!.credentialVault?.entries).toEqual([entry()]);
    expect(mock.saved!.connections[0].name).toBe("while saving");
    expect(mock.saved!.settings).toEqual({ retained: true });
    await expect(api.resolve(snapshot, id, ["password"])).rejects.toThrow(
      /review expired/,
    );
  });
  it("refuses other private writes while saving and does not discard their content", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await api.list(api.scope!);
    const documents = hook.result.current.documents!,
      prior = await documents.read(documents.scope!);
    const gate = deferred<void>();
    mock.save.mockImplementationOnce(async (data: StorageData) => {
      await gate.promise;
      mock.saved = structuredClone(data);
    });
    const write = api.compareAndSwap(snapshot, [
      { operation: "put", entry: entry() },
    ]);
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    await expect(
      documents.compareAndSwap(documents.scope!, prior, {
        ...prior,
        revision: prior.revision + 1,
      }),
    ).rejects.toThrow(/pending/);
    await expect(
      api.compareAndSwap(snapshot, [{ operation: "put", entry: entry() }]),
    ).rejects.toThrow(/pending/);
    await act(async () => {
      gate.resolve();
      await write;
    });
  });
  it("does not optimistically publish or retry a failed private save; reload recovers", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await api.list(api.scope!);
    mock.save.mockRejectedValueOnce(Error("PRIVATE_BACKEND_DETAIL"));
    await expect(
      api.compareAndSwap(snapshot, [{ operation: "put", entry: entry() }]),
    ).rejects.toThrow(/could not be verified/);
    await expect(api.list(api.scope!)).rejects.toThrow(/could not be verified/);
    await act(() => hook.result.current.flushPendingSave());
    expect(mock.save).toHaveBeenCalledOnce();
    expect(mock.saved!.credentialVault).toBeUndefined();
    await act(() => hook.result.current.loadData("db-a"));
    expect(
      (
        await hook.result.current.credentialVault!.list(
          hook.result.current.credentialVault!.scope!,
        )
      ).entries,
    ).toEqual([]);
  });
  it.each(["none", "legacy-password"])(
    "requires native encryption proof, not the renderer's %s label",
    async (kind) => {
      mock.status.mockResolvedValue({
        kind,
        unlocked: true,
        securityRevision: "revision",
      });
      const hook = await mount(),
        api = hook.result.current.credentialVault!;
      await expect(api.list(api.scope!)).rejects.toThrow(
        /Protect this database/,
      );
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
  it("rejects browser fallback, mismatched protection revisions, and forged reviews", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await add(hook);
    mock.desktop = false;
    await expect(api.list(api.scope!)).rejects.toThrow(/native desktop/);
    mock.desktop = true;
    await expect(
      api.resolve({ ...snapshot, receipt: "made-up" }, id, ["password"]),
    ).rejects.toThrow(/review expired/);
    await expect(
      api.resolve({ ...snapshot, revision: 999 }, id, ["password"]),
    ).rejects.toThrow(/review expired/);
    await expect(
      api.resolve(
        { ...snapshot, scope: { ...snapshot.scope, databaseId: "db-b" } },
        id,
        ["password"],
      ),
    ).rejects.toThrow(/review expired/);
    mock.status.mockResolvedValue({
      kind: "managed",
      unlocked: true,
      securityRevision: "replaced",
    });
    await expect(api.resolve(snapshot, id, ["password"])).rejects.toThrow(
      /lease changed/,
    );
  });
  it("fences owner switches and unmount while secret disclosure awaits native verification", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await add(hook);
    const gate = deferred<void>();
    mock.verify.mockClear();
    mock.verify.mockImplementationOnce(() => gate.promise);
    const result = api.resolve(snapshot, id, ["password"]);
    const rejected = expect(result).rejects.toThrow(/owning|changed/);
    await waitFor(() => expect(mock.verify).toHaveBeenCalled());
    mock.owner = "db-b";
    gate.resolve();
    await rejected;
    mock.owner = "db-a";
    const later = deferred<void>();
    mock.verify.mockClear();
    mock.verify.mockImplementationOnce(() => later.promise);
    const pending = api.resolve(snapshot, id, ["password"]);
    const unmounted = expect(pending).rejects.toThrow(/no longer open/);
    await waitFor(() => expect(mock.verify).toHaveBeenCalled());
    hook.unmount();
    later.resolve();
    await unmounted;
  });
  it("revokes same-database receipts after lock/unlock and reload, even when IDs match", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await add(hook);
    act(() => {
      mock.locked = true;
      mock.access!({ databaseId: "db-a", status: "suspended" });
    });
    expect(hook.result.current.credentialVault!.scope).toBeNull();
    act(() => {
      mock.locked = false;
      mock.access!({ databaseId: "db-a", status: "ready" });
    });
    await expect(api.resolve(snapshot, id, ["password"])).rejects.toThrow(
      /review expired/,
    );
    await act(() => hook.result.current.loadData("db-a"));
    const next = hook.result.current.credentialVault!;
    expect((await next.list(next.scope!)).entries).toHaveLength(1);
  });
  it("does not release secrets after a delayed native protection check loses its owner", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await add(hook);
    const gate = deferred<unknown>();
    mock.status.mockClear();
    mock.status.mockImplementationOnce(() => gate.promise);
    const pending = api.resolve(snapshot, id, ["password"]);
    const rejected = expect(pending).rejects.toThrow(/owning|changed/);
    await waitFor(() => expect(mock.status).toHaveBeenCalledOnce());
    act(() => {
      mock.locked = true;
      mock.access!({ databaseId: "db-a", status: "suspended" });
    });
    gate.resolve({
      kind: "managed",
      unlocked: true,
      securityRevision: "revision",
    });
    await rejected;
    expect(mock.save).toHaveBeenCalledOnce();
  });
  it("never publishes a completed old-owner save into a new database", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await api.list(api.scope!);
    const gate = deferred<void>();
    // Simulate a native write already committed to the captured old owner only.
    mock.save.mockImplementationOnce(() => gate.promise);
    const pending = api.compareAndSwap(snapshot, [
      { operation: "put", entry: entry() },
    ]);
    const rejected = expect(pending).rejects.toThrow(/could not be verified/);
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    mock.owner = "db-b";
    gate.resolve();
    await rejected;
    expect(hook.result.current.credentialVault!.changeRevision).toBe(
      api.changeRevision,
    );
    expect(mock.saved!.credentialVault).toBeUndefined();
    await act(() => hook.result.current.loadData("db-b"));
    const next = hook.result.current.credentialVault!;
    expect(next.scope!.databaseId).toBe("db-b");
    expect((await next.list(next.scope!)).entries).toEqual([]);
  });
  it("rejects durable external edits before resolving cached secrets or overwriting", async () => {
    const hook = await mount(),
      api = hook.result.current.credentialVault!,
      snapshot = await add(hook);
    mock.saved!.credentialVault = { version: 1, revision: 2, entries: [] };
    await expect(api.resolve(snapshot, id, ["password"])).rejects.toThrow(
      /another window/,
    );
    await expect(
      api.compareAndSwap(snapshot, [{ operation: "put", entry: entry() }]),
    ).rejects.toThrow(/another window/);
    expect(mock.save).toHaveBeenCalledOnce();
    expect(mock.saved!.credentialVault.entries).toEqual([]);
  });
  it("preserves malformed stored vaults rather than resetting or auto-migrating them", async () => {
    mock.saved!.credentialVault = { version: 2 } as never;
    const hook = await mount(),
      api = hook.result.current.credentialVault!;
    await expect(api.list(api.scope!)).rejects.toThrow(
      /Invalid database credential vault/,
    );
    expect(mock.save).not.toHaveBeenCalled();
    expect(mock.saved!.credentialVault).toEqual({ version: 2 });
  });
});
