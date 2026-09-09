import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useDatabaseBulkActions } from "../../src/hooks/connection/useDatabaseBulkActions";
import {
  performDatabaseAction,
  type DatabaseActionContext,
  type DatabaseActionManager,
} from "../../src/utils/connection/databaseActions";
import { defaultExportSecuritySettings } from "../../src/types/settings/settings";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const saveExport = vi.hoisted(() => vi.fn(async () => "saved" as const));
vi.mock("../../src/utils/connection/databaseBulkExport", () => ({
  saveDatabaseBulkExport: saveExport,
  validateDatabaseBulkExport: () => undefined,
}));

const alpha: ConnectionDatabase = {
  id: "a",
  name: "Alpha",
  isEncrypted: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
const beta: ConnectionDatabase = {
  ...alpha,
  id: "b",
  name: "Beta",
  isEncrypted: true,
};

function fixture(current: ConnectionDatabase | null = null) {
  const collections = [alpha, beta];
  const manager = {
    getDatabase: vi.fn(
      async (id: string) => collections.find((item) => item.id === id) ?? null,
    ),
    getAllDatabases: vi.fn(async () => collections),
    getCurrentDatabase: vi.fn(() => current),
    duplicateDatabase: vi.fn(async (id: string) => ({
      ...alpha,
      id: `copy-${id}`,
      name: `Copy ${id}`,
    })),
    deleteDatabase: vi.fn(async () => undefined),
    lockDatabase: vi.fn(),
    closeCurrentDatabase: vi.fn(() => current?.id ?? null),
    unlockDatabase: vi.fn(async () => undefined),
    isDatabaseUnlocked: vi.fn(() => false),
    updateDatabase: vi.fn(async () => undefined),
    changeDatabasePassword: vi.fn(async () => ({
      committed: true,
      cleanupPending: false,
      warnings: [],
    })),
    removePasswordFromDatabase: vi.fn(async () => ({
      committed: true,
      cleanupPending: false,
      warnings: [],
    })),
    readExportableDatabaseSnapshot: vi.fn(async (id: string) => ({
      collection: { ...alpha, id, exportDate: "2026-01-01" },
      connections: [],
      settings: {},
      tabGroups: [],
      colorTags: {},
    })),
  } satisfies DatabaseActionManager;
  const context: DatabaseActionContext = {
    manager,
    flushCurrent: vi.fn(async () => undefined),
    onCurrentClosed: vi.fn(async () => undefined),
  };
  return { manager, context, collections };
}

beforeEach(() => vi.clearAllMocks());

describe("shared database action safety", () => {
  it("keeps the current database attached if a durable flush fails", async () => {
    const { context, manager } = fixture(alpha);
    context.flushCurrent = vi.fn(async () => {
      throw new Error("Disk full");
    });
    await expect(
      performDatabaseAction("a", { type: "delete" }, context),
    ).rejects.toThrow("Disk full");
    expect(manager.deleteDatabase).not.toHaveBeenCalled();
    expect(context.onCurrentClosed).not.toHaveBeenCalled();
  });

  it("flushes, closes sensitive views, flushes again, then locks and clears the host", async () => {
    const { context, manager } = fixture(beta);
    const steps: string[] = [];
    context.flushCurrent = async () => {
      steps.push("flush");
    };
    context.beforeCurrentLock = async () => {
      steps.push("views");
    };
    context.onCurrentClosed = async () => {
      steps.push("host");
    };
    manager.lockDatabase.mockImplementation(() => {
      steps.push("lock");
    });
    await performDatabaseAction("b", { type: "lock" }, context);
    expect(steps).toEqual(["flush", "views", "flush", "lock", "host"]);
  });

  it("rejects an active-database change during its flush", async () => {
    const { context, manager } = fixture(alpha);
    context.flushCurrent = async () => {
      manager.getCurrentDatabase.mockReturnValue(beta);
    };
    await expect(
      performDatabaseAction("a", { type: "lock" }, context),
    ).rejects.toThrow("active database changed");
    expect(manager.closeCurrentDatabase).not.toHaveBeenCalled();
  });

  it("does not delete the active database when sensitive-view cleanup fails", async () => {
    const { context, manager } = fixture(alpha);
    context.beforeCurrentLock = async () => {
      throw new Error("session close failed");
    };
    await expect(
      performDatabaseAction("a", { type: "delete" }, context),
    ).rejects.toThrow("session close failed");
    expect(context.flushCurrent).toHaveBeenCalledOnce();
    expect(manager.deleteDatabase).not.toHaveBeenCalled();
    expect(context.onCurrentClosed).not.toHaveBeenCalled();
  });

  it("unlocks a side database without switching, and preserves encryption on metadata edits", async () => {
    const { context, manager } = fixture(alpha);
    await performDatabaseAction(
      "b",
      { type: "unlock", password: "per-database" },
      context,
    );
    expect(manager.unlockDatabase).toHaveBeenCalledWith("b", "per-database");
    expect(context.onCurrentClosed).not.toHaveBeenCalled();
    await performDatabaseAction(
      "b",
      { type: "metadata", namePattern: "Vault {name}-{index}", index: 2 },
      context,
    );
    expect(manager.updateDatabase).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "b",
        name: "Vault Beta-2",
        isEncrypted: true,
      }),
    );
  });
});

describe("bulk database selection and outcomes", () => {
  function mount(withNotifications = false) {
    const data = fixture();
    const refresh = vi.fn(async (): Promise<void> => undefined);
    const guard = { current: false };
    const rendered = renderHook(
      ({ collections }) =>
        useDatabaseBulkActions({
          collections,
          context: data.context,
          refresh,
          transitionGuard: guard,
          blocked: false,
        }),
      {
        initialProps: { collections: data.collections },
        wrapper: withNotifications
          ? ({ children }: { children: ReactNode }) =>
              createElement(ToastProvider, null, children)
          : undefined,
      },
    );
    return { ...data, ...rendered, refresh, guard };
  }

  it("keeps hidden selections, supports filtered inversion, and prunes removed IDs", () => {
    const { result, rerender } = mount();
    act(() => result.current.select("all"));
    act(() => result.current.select("invert", ["a"]));
    expect([...result.current.selectedIds]).toEqual(["b"]);
    act(() => result.current.select("filtered", ["a"]));
    expect(result.current.selectedIds.size).toBe(2);
    rerender({ collections: [alpha] });
    expect([...result.current.selectedIds]).toEqual(["a"]);
    act(() => result.current.select("none"));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("reports a partial clone failure and keeps source credentials separate", async () => {
    const { result, manager, guard } = mount();
    manager.duplicateDatabase.mockRejectedValueOnce(new Error("Unavailable"));
    act(() => result.current.select("all"));
    await act(async () => {
      await result.current.run("clone", { passwords: { b: "vault-password" } });
    });
    expect(manager.duplicateDatabase).toHaveBeenNthCalledWith(1, "a", {
      password: undefined,
    });
    expect(manager.duplicateDatabase).toHaveBeenNthCalledWith(2, "b", {
      password: "vault-password",
    });
    expect(result.current.results.map((item) => item.status)).toEqual([
      "failed",
      "success",
    ]);
    expect(guard.current).toBe(false);
  });

  it("guards rapid re-entry and cancels only the remaining work", async () => {
    const { result, manager } = mount();
    let finish!: () => void;
    manager.duplicateDatabase.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ...alpha, id: "copy" };
    });
    act(() => result.current.select("all"));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.run("clone");
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.run("clone");
      result.current.cancel();
      finish();
      await first;
    });
    expect(manager.duplicateDatabase).toHaveBeenCalledTimes(1);
    expect(result.current.results.map((item) => item.status)).toEqual([
      "success",
      "cancelled",
    ]);
  });

  it("reports locked export separately and calls native save only with prepared items", async () => {
    const { result, manager } = mount();
    manager.readExportableDatabaseSnapshot.mockRejectedValueOnce(
      new Error("Encrypted database must be unlocked"),
    );
    act(() => result.current.select("all"));
    await act(async () => {
      await result.current.run("export", {
        passwords: { b: "secret" },
        export: {
          encrypted: false,
          password: "",
          security: defaultExportSecuritySettings,
        },
      });
    });
    expect(result.current.results.map((item) => item.status)).toEqual([
      "failed",
      "success",
    ]);
    expect(saveExport).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          collection: expect.objectContaining({ id: "b" }),
        }),
      ],
      expect.anything(),
      expect.any(Function),
    );
    expect(manager.readExportableDatabaseSnapshot).toHaveBeenNthCalledWith(
      2,
      "b",
      false,
      { collectionPassword: "secret" },
    );
  });

  it("uses one updating toast and keeps progress below completion until refresh finishes", async () => {
    const { result, manager, refresh } = mount(true);
    let releaseFirst!: () => void;
    let releaseRefresh!: () => void;
    manager.duplicateDatabase.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return { ...alpha, id: "copy-a" };
    });
    refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        }),
    );
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.run("clone", {}, ["a", "b"]);
    });
    await waitFor(() =>
      expect(manager.duplicateDatabase).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByText("Clone: Alpha — 1 of 2")).toBeTruthy();
    expect(document.querySelectorAll(".toast-item")).toHaveLength(1);
    await act(async () => releaseFirst());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(
      screen.getByText("Clone — refreshing the database list…"),
    ).toBeTruthy();
    expect(
      Number(screen.getByRole("progressbar").getAttribute("aria-valuenow")),
    ).toBeLessThan(100);
    expect(result.current.running).toBe(true);
    await act(async () => {
      releaseRefresh();
      await operation;
    });
    expect(document.querySelectorAll(".toast-item")).toHaveLength(1);
    expect(
      screen.getByText(
        "Clone finished — 2 succeeded, 0 failed, 0 skipped, 0 cancelled.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });

  it("does not report prepared exports as saved and retains redacted failure details in the final toast", async () => {
    const { result } = mount(true);
    let rejectSave!: (error: Error) => void;
    saveExport.mockImplementationOnce(
      () =>
        new Promise<"saved">((_, reject) => {
          rejectSave = reject;
        }),
    );
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.run(
        "export",
        {
          passwords: { a: "private-password" },
          export: {
            encrypted: false,
            password: "",
            security: defaultExportSecuritySettings,
          },
        },
        ["a", "b"],
      );
    });
    await waitFor(() => expect(saveExport).toHaveBeenCalledOnce());
    expect(screen.getByText(/2 prepared; not saved yet/)).toBeTruthy();
    expect(
      result.current.results.every((item) => item.status === "prepared"),
    ).toBe(true);
    expect(
      Number(screen.getByRole("progressbar").getAttribute("aria-valuenow")),
    ).toBeLessThan(100);
    await act(async () => {
      rejectSave(new Error("Cannot save private-password package"));
      await operation;
    });
    expect(
      screen.getByText(
        "Export finished — 0 succeeded, 2 failed, 0 skipped, 0 cancelled.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Alpha: failed — Cannot save [redacted] package"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-password");
    expect(screen.getByText("View details (2)")).toBeTruthy();
  });

  it("cancels remaining work and reports cancellation through the existing toast", async () => {
    const { result, manager } = mount(true);
    let release!: () => void;
    manager.duplicateDatabase.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ...alpha, id: "copy-a" };
    });
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.run("clone", {}, ["a", "b"]);
    });
    await waitFor(() =>
      expect(manager.duplicateDatabase).toHaveBeenCalledOnce(),
    );
    act(() => result.current.cancel());
    expect(
      screen.getByText("Stopping after the current database operation…"),
    ).toBeTruthy();
    await act(async () => {
      release();
      await operation;
    });
    expect(manager.duplicateDatabase).toHaveBeenCalledOnce();
    expect(
      screen.getByText(
        "Clone finished — 1 succeeded, 0 failed, 0 skipped, 1 cancelled.",
      ),
    ).toBeTruthy();
    expect(document.querySelectorAll(".toast-item")).toHaveLength(1);
  });

  it("finishes the active mutation but starts no more work or component refresh after unmount", async () => {
    const { result, manager, refresh, unmount, guard } = mount(true);
    let release!: () => void;
    manager.duplicateDatabase.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ...alpha, id: "copy-a" };
    });
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.run("clone", {}, ["a", "b"]);
    });
    await waitFor(() =>
      expect(manager.duplicateDatabase).toHaveBeenCalledOnce(),
    );
    unmount();
    await act(async () => {
      release();
      await operation;
    });
    expect(manager.duplicateDatabase).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(guard.current).toBe(false);
  });
});
