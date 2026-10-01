import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import DatabaseList from "../../src/components/database/list/DatabaseList";
import type { Mgr } from "../../src/components/database/list/types";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { DatabaseSize } from "../../src/utils/connection/databaseSize";

const mock = vi.hoisted(() => ({
  read: vi.fn<
    (ids: readonly string[]) => Promise<Record<string, DatabaseSize>>
  >(),
  format: vi.fn((bytes: number) => `${bytes} B`),
  listeners: new Set<() => void>(),
  load: vi.fn(),
  unlock: vi.fn(),
  export: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseSize", () => ({
  readDatabaseSizes: mock.read,
  formatDatabaseBytes: mock.format,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onCurrentDatabaseChange: (listener: () => void) => {
    mock.listeners.add(listener);
    return () => mock.listeners.delete(listener);
  },
  DatabaseManager: {
    getInstance: () => ({
      loadDatabaseData: mock.load,
      unlockDatabase: mock.unlock,
      exportDatabase: mock.export,
    }),
  },
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { animationsEnabled: false } }),
  default: React.createContext({ settings: { animationsEnabled: false } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

const alpha: ConnectionDatabase = {
  id: "alpha",
  name: "Alpha",
  isEncrypted: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
const locked: ConnectionDatabase = {
  ...alpha,
  id: "locked",
  name: "Locked",
  isEncrypted: true,
  protectionFormat: "sorng-db",
};
const browser: ConnectionDatabase = {
  ...alpha,
  id: "browser",
  name: "Browser",
};
const collections = [locked, browser, alpha];
const measured = (
  bytes: number,
  source: DatabaseSize["source"] = "stored-file",
): DatabaseSize => ({
  status: "measured",
  bytes,
  source,
});
function makeMgr(rows = collections): Mgr {
  return {
    collections: rows,
    loadingCollection: null,
    isCurrentDatabase: () => false,
    isDatabaseUnlocked: () => false,
    isWorking: false,
    showCreateForm: false,
    showPasswordDialog: false,
    editingCollection: null,
    handleSelectCollection: vi.fn(),
    handleEditCollection: vi.fn(),
    handleCloneCollection: vi.fn(),
    handleDeleteCollection: vi.fn(),
    setShowCreateForm: vi.fn(),
    setError: vi.fn(),
  } as unknown as Mgr;
}
function deferred() {
  let resolve!: (sizes: Record<string, DatabaseSize>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Record<string, DatabaseSize>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function sizeFor(name: string) {
  const row = screen.getByText(name).closest("[aria-busy]") as HTMLElement;
  return within(row).getByTestId("database-size");
}
async function settle() {
  await act(async () => {});
}
async function flushRefresh() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}
function saved() {
  window.dispatchEvent(new Event("sorng-database-data-saved"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.listeners.clear();
  mock.read.mockReset();
  mock.read.mockImplementation(async (ids) =>
    Object.fromEntries(ids.map((id) => [id, measured(42)])),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("database list stored sizes", () => {
  it("keeps size as plain metadata on the last-accessed line, including while opening", async () => {
    const mgr = makeMgr([alpha]);
    const view = render(<DatabaseList mgr={mgr} onClose={vi.fn()} />);
    await settle();
    const size = sizeFor("Alpha");
    const metadata = size.closest("p");
    expect(metadata).toHaveTextContent(
      `databaseCenter.collections.lastAccessed: ${new Date(alpha.lastAccessed).toLocaleDateString()} · 42 B`,
    );
    expect(metadata).toHaveClass("text-[var(--color-textMuted)]");
    expect(size).not.toHaveClass("border", "rounded", "px-1.5", "py-0.5");
    expect(size).toHaveAttribute("title", expect.stringContaining("42 bytes"));

    view.rerender(
      <DatabaseList
        mgr={{
          ...mgr,
          loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
        }}
        onClose={vi.fn()}
      />,
    );
    expect(sizeFor("Alpha").closest("p")).toHaveTextContent(
      "databaseCenter.collections.loading.open · 42 B",
    );
    expect(sizeFor("Alpha").closest("p")).not.toHaveTextContent("lastAccessed");
  });

  it("batches every database, maps by ID, and measures locked rows without opening them", async () => {
    const pending = deferred();
    mock.read.mockReturnValueOnce(pending.promise);
    const mgr = makeMgr();
    render(<DatabaseList mgr={mgr} onClose={vi.fn()} />);
    expect(mock.read).toHaveBeenCalledExactlyOnceWith([
      "alpha",
      "browser",
      "locked",
    ]);
    for (const name of ["Alpha", "Browser", "Locked"])
      expect(sizeFor(name)).toHaveTextContent("Size loading…");
    await act(async () =>
      pending.resolve({
        browser: measured(123, "browser-json"),
        alpha: measured(0),
        locked: measured(2048),
      }),
    );
    expect(sizeFor("Alpha")).toHaveTextContent(/^0 B$/);
    expect(sizeFor("Locked")).toHaveTextContent(/^2048 B$/);
    expect(sizeFor("Locked")).toHaveAttribute(
      "title",
      expect.stringContaining("2048 bytes"),
    );
    expect(sizeFor("Locked")).toHaveAttribute(
      "title",
      expect.stringContaining("stored-file"),
    );
    expect(sizeFor("Locked")).toHaveAttribute(
      "title",
      expect.stringContaining("encryption envelopes"),
    );
    expect(sizeFor("Browser")).toHaveTextContent("JSON · 123 B");
    expect(sizeFor("Browser")).toHaveAttribute(
      "title",
      expect.stringContaining(
        "browser-json: stored UTF-8 JSON size; not disk allocation",
      ),
    );
    expect(mock.format).toHaveBeenCalledWith(0);
    expect(mgr.handleSelectCollection).not.toHaveBeenCalled();
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.unlock).not.toHaveBeenCalled();
    expect(mock.export).not.toHaveBeenCalled();
  });

  it("shows missing and unavailable reasons without inventing zero, and retries the batch", async () => {
    mock.read.mockResolvedValueOnce({
      alpha: { status: "missing", reason: "The database file does not exist." },
      locked: { status: "unavailable", reason: "Permission denied." },
      // Omitted results are unavailable, never permanently loading or zero.
    });
    render(<DatabaseList mgr={makeMgr()} onClose={vi.fn()} />);
    await settle();
    expect(sizeFor("Alpha")).toHaveTextContent(
      "Database file missing · The database file does not exist.",
    );
    expect(sizeFor("Locked")).toHaveTextContent(
      "Size unavailable · Permission denied.",
    );
    expect(sizeFor("Browser")).toHaveTextContent(
      "Size unavailable · No size was returned for this database.",
    );
    expect(screen.queryByText("0 B")).toBeNull();
    expect(mock.format).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh sizes" }));
    expect(sizeFor("Locked")).toHaveTextContent("Size loading…");
    await settle();
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(sizeFor("Locked")).toHaveTextContent("42 B");
  });

  it.each([
    new Error("C:\\private\\database.json password=test-secret"),
    "C:\\private\\database.json password=test-secret",
  ])(
    "sanitizes unexpected batch failures and recovers on focus (%s)",
    async (error) => {
      mock.read.mockRejectedValueOnce(error);
      render(<DatabaseList mgr={makeMgr()} onClose={vi.fn()} />);
      await settle();
      for (const label of screen.getAllByTestId("database-size"))
        expect(label).toHaveTextContent(
          "Size unavailable · Could not read database sizes. Refresh to retry.",
        );
      expect(document.body.innerHTML).not.toContain("test-secret");
      expect(document.body.innerHTML).not.toContain("database.json");
      act(() => window.dispatchEvent(new Event("focus")));
      await flushRefresh();
      expect(mock.read).toHaveBeenCalledTimes(2);
      expect(sizeFor("Alpha")).toHaveTextContent("42 B");
    },
  );

  it("does not re-read for identical array contents, row order, filtering, or ordinary rerenders", async () => {
    const view = render(<DatabaseList mgr={makeMgr()} onClose={vi.fn()} />);
    await settle();
    for (let i = 0; i < 3; i++) {
      view.rerender(
        <DatabaseList
          mgr={makeMgr(
            [...collections].reverse().map((row) => ({
              ...row,
              name: row.id === "alpha" ? `Renamed ${i}` : row.name,
              description: `Updated description ${i}`,
              lastAccessed: `2026-10-0${i + 1}`,
            })),
          )}
          onClose={vi.fn()}
        />,
      );
      await settle();
    }
    fireEvent.change(screen.getByPlaceholderText("Search databases..."), {
      target: { value: "Locked" },
    });
    expect(screen.getAllByTestId("database-size")).toHaveLength(1);
    expect(sizeFor("Locked")).toHaveTextContent("42 B");
    act(() => saved());
    await flushRefresh();
    // A refresh while filtered still measures the entire collection list.
    expect(mock.read).toHaveBeenNthCalledWith(2, [
      "alpha",
      "browser",
      "locked",
    ]);
    fireEvent.change(screen.getByPlaceholderText("Search databases..."), {
      target: { value: "" },
    });
    await flushRefresh();
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("database-size")).toHaveLength(3);
  });

  it("refreshes on the manager subscription and coalesces bursts of saves", async () => {
    render(<DatabaseList mgr={makeMgr()} onClose={vi.fn()} />);
    await settle();
    expect(mock.listeners.size).toBe(1);
    mock.read.mockResolvedValueOnce({
      alpha: measured(100),
      locked: measured(200),
      browser: measured(300),
    });
    act(() => {
      for (const listener of mock.listeners) listener();
    });
    await flushRefresh();
    expect(sizeFor("Alpha")).toHaveTextContent("100 B");
    act(() => {
      for (let i = 0; i < 20; i++) saved();
    });
    expect(mock.read).toHaveBeenCalledTimes(2);
    await flushRefresh();
    expect(mock.read).toHaveBeenCalledTimes(3);
    expect(sizeFor("Alpha")).toHaveTextContent("42 B");
  });

  it("keeps the last measured size visible and marks it as refreshing during autosave reads", async () => {
    mock.read.mockResolvedValueOnce({ alpha: measured(0) });
    render(<DatabaseList mgr={makeMgr([alpha])} onClose={vi.fn()} />);
    await settle();
    expect(sizeFor("Alpha")).toHaveTextContent(/^0 B$/);
    const pending = deferred();
    mock.read.mockReturnValueOnce(pending.promise);
    act(() => saved());
    await flushRefresh();
    expect(sizeFor("Alpha")).toHaveTextContent("0 B · Refreshing…");
    expect(sizeFor("Alpha")).toHaveAttribute(
      "title",
      expect.stringContaining("0 bytes"),
    );
    expect(sizeFor("Alpha")).toHaveAttribute(
      "title",
      expect.stringContaining("showing the last measurement"),
    );
    expect(
      screen.getByRole("button", { name: "Refresh sizes" }),
    ).toBeDisabled();
    await act(async () => pending.resolve({ alpha: measured(512) }));
    expect(sizeFor("Alpha")).toHaveTextContent(/^512 B$/);
    expect(sizeFor("Alpha")).not.toHaveAttribute(
      "title",
      expect.stringContaining("last measurement"),
    );
  });

  it("invalidates an in-flight measurement immediately on save and queues just one refresh", async () => {
    const initial = deferred();
    mock.read.mockReturnValueOnce(initial.promise);
    render(<DatabaseList mgr={makeMgr()} onClose={vi.fn()} />);
    act(() => saved());
    // The stale result arrives before the coalescing timer has fired.
    await act(async () => initial.resolve({ alpha: measured(999) }));
    expect(sizeFor("Alpha")).toHaveTextContent("Size loading…");
    expect(screen.queryByText("999 B")).toBeNull();
    await flushRefresh();
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(sizeFor("Alpha")).toHaveTextContent("42 B");

    const slowRefresh = deferred();
    mock.read.mockReturnValueOnce(slowRefresh.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh sizes" }));
    act(() => {
      for (let i = 0; i < 5; i++) saved();
    });
    await flushRefresh();
    expect(mock.read).toHaveBeenCalledTimes(3);
    await act(async () => slowRefresh.resolve({ alpha: measured(888) }));
    expect(mock.read).toHaveBeenCalledTimes(4);
    expect(sizeFor("Alpha")).toHaveTextContent("42 B");
    expect(screen.queryByText("888 B")).toBeNull();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores obsolete list reads that %s after newer results",
    async (outcome) => {
      const stale = deferred();
      mock.read.mockReturnValueOnce(stale.promise);
      const view = render(
        <DatabaseList mgr={makeMgr([alpha])} onClose={vi.fn()} />,
      );
      view.rerender(<DatabaseList mgr={makeMgr([locked])} onClose={vi.fn()} />);
      await settle();
      expect(sizeFor("Locked")).toHaveTextContent("42 B");
      await act(async () => {
        if (outcome === "resolve")
          stale.resolve({ alpha: measured(999), locked: measured(999) });
        else stale.reject(new Error("Obsolete failure"));
      });
      expect(sizeFor("Locked")).toHaveTextContent("42 B");
      expect(screen.queryByText("Alpha")).toBeNull();
      expect(mock.read).toHaveBeenCalledTimes(2);
      // Same IDs with changed metadata must also refresh.
      view.rerender(
        <DatabaseList
          mgr={makeMgr([{ ...locked, updatedAt: "2026-10-01" }])}
          onClose={vi.fn()}
        />,
      );
      await settle();
      expect(mock.read).toHaveBeenCalledTimes(3);
    },
  );

  it("cleans up subscriptions, pending refreshes, and unresolved reads on unmount", async () => {
    const pending = deferred();
    mock.read.mockReturnValueOnce(pending.promise);
    const view = render(<DatabaseList mgr={makeMgr()} onClose={vi.fn()} />);
    act(() => saved());
    view.unmount();
    expect(mock.listeners.size).toBe(0);
    await act(async () => pending.resolve({ alpha: measured(999) }));
    act(() => {
      saved();
      window.dispatchEvent(new Event("focus"));
    });
    await flushRefresh();
    expect(mock.read).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("database-size")).toBeNull();
  });

  it("skips empty batches and starts measuring when rows arrive", async () => {
    const view = render(<DatabaseList mgr={makeMgr([])} onClose={vi.fn()} />);
    expect(mock.read).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Refresh sizes" }),
    ).toBeDisabled();
    view.rerender(<DatabaseList mgr={makeMgr([alpha])} onClose={vi.fn()} />);
    await settle();
    expect(mock.read).toHaveBeenCalledExactlyOnceWith(["alpha"]);
    expect(sizeFor("Alpha")).toHaveTextContent("42 B");
  });
});
