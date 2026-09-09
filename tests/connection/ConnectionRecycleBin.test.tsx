import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionRecycleBinApi,
  RecycleBinReview,
  RecycleBinRow,
} from "../../src/types/connection/recycleBin";

const fixture = vi.hoisted(() => ({
  api: undefined as ConnectionRecycleBinApi | undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ recycleBin: fixture.api }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "db-a", name: "Demo database" }),
    }),
  },
}));
import ConnectionRecycleBinTab from "../../src/components/connection/ConnectionRecycleBinTab";
import ConnectionRecycleBinSection from "../../src/components/SettingsDialog/sections/security/ConnectionRecycleBinSection";
import { useConnectionRecycleBin } from "../../src/hooks/connection/useConnectionRecycleBin";
import { SECURITY_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/security";

const scope = { databaseId: "db-a", generation: 1, revision: "revision-1" };
const outcome = {
  committed: true as const,
  archived: 0,
  restored: 1,
  purged: 0,
  skipped: 0,
  warnings: [],
};
const row = (
  id: string,
  overrides: Partial<RecycleBinRow> = {},
): RecycleBinRow => ({
  id,
  batchId: "batch",
  connectionId: `connection-${id}`,
  name: `Deleted ${id}`,
  protocol: "ssh",
  isGroup: false,
  deletedAt: Date.UTC(2026, 8, 1),
  expiresAt: Date.UTC(2026, 8, 16),
  parentName: "Lab",
  descendantCount: 0,
  ...overrides,
});
function review(overrides: Partial<RecycleBinReview> = {}): RecycleBinReview {
  return {
    token: "review-1",
    kind: "purge",
    scope,
    entryCount: 1,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}
function makeApi(): ConnectionRecycleBinApi {
  return {
    snapshot: {
      scope,
      policy: { mode: "days", days: 15 },
      entries: [
        row("alpha"),
        row("beta", { protocol: "rdp", parentName: "Office" }),
      ],
    },
    busy: false,
    archive: vi.fn().mockResolvedValue(outcome),
    restore: vi.fn().mockResolvedValue(outcome),
    reviewPurge: vi.fn().mockResolvedValue(review()),
    reviewRetention: vi
      .fn()
      .mockImplementation(async (policy) =>
        review({ kind: "retention", policy, entryCount: 2 }),
      ),
    commitReview: vi
      .fn()
      .mockResolvedValue({ ...outcome, restored: 0, purged: 1 }),
    cancelReview: vi.fn(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
beforeEach(() => {
  fixture.api = makeApi();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("database-owned recycle-bin explorer", () => {
  it("selects all matching rows across pages without adding filtered-out entries", async () => {
    fixture.api!.snapshot!.entries = Array.from({ length: 110 }, (_, index) =>
      row(String(index), { protocol: index < 80 ? "ssh" : "rdp" }),
    );
    render(<ConnectionRecycleBinTab databaseId="db-a" />);
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "ssh" },
    });
    fireEvent.click(screen.getByText("Select all matching"));
    expect(screen.getByText(/80 selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next page"));
    expect(screen.getByLabelText("Select Deleted 79")).toBeChecked();
    fireEvent.click(screen.getByText("Restore selected"));
    await waitFor(() =>
      expect(fixture.api!.restore).toHaveBeenCalledWith(
        Array.from({ length: 80 }, (_, index) => String(index)),
        scope,
      ),
    );
    fireEvent.click(screen.getByText("Clear selection"));
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
  });
  it("renders only redacted metadata, no redundant close, and searches original folder/type", () => {
    render(<ConnectionRecycleBinTab databaseId="db-a" />);
    expect(screen.getByText("Demo database")).toBeInTheDocument();
    expect(screen.getByText("Deleted alpha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    expect(screen.getByText("Restore selected")).toHaveClass(
      "sor-btn",
      "sor-btn-secondary",
    );
    expect(screen.queryByLabelText(/password|username/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Search deleted connections"), {
      target: { value: "office" },
    });
    expect(screen.queryByText("Deleted alpha")).toBeNull();
    expect(screen.getByText("Deleted beta")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear filters"));
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "ssh" },
    });
    expect(screen.queryByText("Deleted beta")).toBeNull();
  });
  it("bounds mounted rows and selects only the current page", async () => {
    fixture.api!.snapshot!.entries = Array.from({ length: 105 }, (_, index) =>
      row(String(index)),
    );
    render(<ConnectionRecycleBinTab databaseId="db-a" />);
    expect(screen.getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByLabelText("Select this page"));
    fireEvent.click(screen.getByText("Restore selected"));
    await waitFor(() =>
      expect(fixture.api!.restore).toHaveBeenCalledWith(
        Array.from({ length: 50 }, (_, index) => String(index)),
        scope,
      ),
    );
    fireEvent.click(screen.getByText("Next page"));
    expect(screen.getByText("Deleted 50")).toBeInTheDocument();
    expect(screen.queryByText("Deleted 0")).toBeNull();
  });
  it("restores an individual item through the scoped provider and reports skipped collisions", async () => {
    vi.mocked(fixture.api!.restore).mockResolvedValue({
      ...outcome,
      skipped: 1,
      warnings: ["Original folder unavailable; restored at root."],
    });
    render(<ConnectionRecycleBinTab databaseId="db-a" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore Deleted alpha" }),
    );
    await screen.findByText(/1 restored.*1 skipped/);
    expect(fixture.api!.restore).toHaveBeenCalledWith(["alpha"], scope);
    expect(screen.getByText(/Original folder unavailable/)).toBeInTheDocument();
  });
  it("requires review before permanent deletion and cancellation performs no mutation", async () => {
    render(<ConnectionRecycleBinTab databaseId="db-a" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Permanently delete Deleted alpha" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(fixture.api!.reviewPurge).toHaveBeenCalledWith(["alpha"], scope);
    expect(fixture.api!.commitReview).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fixture.api!.cancelReview).toHaveBeenCalledWith("review-1");
    expect(fixture.api!.commitReview).not.toHaveBeenCalled();
  });
  it("empty-bin review includes hidden rows and commits its reviewed token once", async () => {
    render(<ConnectionRecycleBinTab databaseId="db-a" />);
    fireEvent.change(screen.getByLabelText("Search deleted connections"), {
      target: { value: "alpha" },
    });
    fireEvent.click(screen.getByText("Empty recycle bin"));
    const dialog = await screen.findByRole("dialog");
    expect(fixture.api!.reviewPurge).toHaveBeenCalledWith(null, scope);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Permanently delete" }),
    );
    await waitFor(() =>
      expect(fixture.api!.commitReview).toHaveBeenCalledExactlyOnceWith(
        "review-1",
      ),
    );
  });
  it("masks a pinned tab immediately on database switch and clears its review and selection", async () => {
    const view = render(<ConnectionRecycleBinTab databaseId="db-a" />);
    fireEvent.click(screen.getByLabelText("Select Deleted alpha"));
    fireEvent.click(screen.getByText("Delete selected permanently"));
    await screen.findByRole("dialog");
    fixture.api = {
      ...fixture.api!,
      snapshot: {
        ...fixture.api!.snapshot!,
        scope: { ...scope, databaseId: "db-b" },
      },
    };
    view.rerender(<ConnectionRecycleBinTab databaseId="db-a" />);
    expect(screen.getByText("Recycle bin unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Deleted alpha")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.api.cancelReview).toHaveBeenCalledWith("review-1");
    fixture.api = {
      ...fixture.api,
      snapshot: {
        scope: { ...scope, generation: 3 },
        policy: { mode: "days", days: 15 },
        entries: [row("alpha")],
      },
    };
    view.rerender(<ConnectionRecycleBinTab databaseId="db-a" />);
    expect(screen.getByLabelText("Select Deleted alpha")).not.toBeChecked();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("uses honest empty and locked/unavailable states", () => {
    fixture.api!.snapshot!.entries = [];
    const view = render(<ConnectionRecycleBinTab databaseId="db-a" />);
    expect(screen.getByText(/The recycle bin is empty/)).toBeInTheDocument();
    expect(screen.getByText("Empty recycle bin")).toBeDisabled();
    fixture.api!.snapshot = null;
    view.rerender(<ConnectionRecycleBinTab databaseId="db-a" />);
    expect(
      screen.getByText(/Open and unlock this database/),
    ).toBeInTheDocument();
  });
});

describe("recycle-bin review lifecycle", () => {
  it("cancels a late review returned after unmount", async () => {
    const pending = deferred<RecycleBinReview>();
    vi.mocked(fixture.api!.reviewPurge).mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() =>
      useConnectionRecycleBin("db-a"),
    );
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.reviewPurge(["alpha"]);
    });
    unmount();
    await act(async () => {
      pending.resolve(review());
      await operation;
    });
    expect(fixture.api!.cancelReview).toHaveBeenCalledWith("review-1");
  });
  it("rejects captured confirmation callbacks after replacement and lock/unlock ABA", async () => {
    const { result, rerender } = renderHook(() =>
      useConnectionRecycleBin("db-a"),
    );
    await act(async () => {
      await result.current.reviewPurge(["alpha"]);
    });
    const oldConfirm = result.current.confirm;
    fixture.api = {
      ...fixture.api!,
      snapshot: {
        ...fixture.api!.snapshot!,
        scope: { ...scope, revision: "new-art", generation: 2 },
      },
    };
    rerender();
    act(() => oldConfirm());
    expect(fixture.api.commitReview).not.toHaveBeenCalled();
    expect(result.current.review).toBeNull();
    expect(fixture.api.cancelReview).toHaveBeenCalledWith("review-1");
  });
  it("expires reviews without waiting for another render or leaving a live token", async () => {
    vi.useFakeTimers();
    vi.mocked(fixture.api!.reviewPurge).mockResolvedValue(
      review({ expiresAt: Date.now() + 1000 }),
    );
    const { result } = renderHook(() => useConnectionRecycleBin("db-a"));
    await act(async () => {
      await result.current.reviewPurge(["alpha"]);
    });
    act(() => vi.advanceTimersByTime(1001));
    expect(result.current.review).toBeNull();
    expect(result.current.error).toMatch(/expired/);
    expect(fixture.api!.cancelReview).toHaveBeenCalledWith("review-1");
  });
  it("does not duplicate an in-flight operation and shows persistence failure", async () => {
    const pending = deferred<typeof outcome>();
    vi.mocked(fixture.api!.restore).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useConnectionRecycleBin("db-a"));
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.restore(["alpha"]);
      void result.current.restore(["alpha"]);
    });
    expect(fixture.api!.restore).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(outcome);
      await operation;
    });
    vi.mocked(fixture.api!.restore).mockRejectedValue(
      new Error("Database save failed"),
    );
    await act(async () => {
      await result.current.restore(["alpha"]);
    });
    expect(result.current.error).toBe("Database save failed");
  });
  it("keeps a failed-save diagnostic visible after the provider advances its recoverable dirty revision", async () => {
    let reject!: (error: Error) => void;
    const failure = new Promise<typeof outcome>((_resolve, fail) => {
      reject = fail;
    });
    vi.mocked(fixture.api!.restore).mockReturnValue(failure);
    const { result, rerender } = renderHook(() =>
      useConnectionRecycleBin("db-a"),
    );
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.restore(["alpha"]);
    });
    fixture.api = {
      ...fixture.api!,
      snapshot: {
        ...fixture.api!.snapshot!,
        scope: { ...scope, revision: "dirty-revision" },
      },
    };
    rerender();
    await act(async () => {
      reject(new Error("Disk save failed; changes remain recoverable"));
      await operation;
    });
    expect(result.current.error).toBe(
      "Disk save failed; changes remain recoverable",
    );
    fixture.api = {
      ...fixture.api,
      snapshot: {
        ...fixture.api.snapshot!,
        scope: { ...scope, databaseId: "db-b" },
      },
    };
    rerender();
    expect(result.current.error).toBeUndefined();
  });
});

describe("current-database retention settings", () => {
  it("describes a zero-item retention review without a misleading destruction warning", async () => {
    vi.mocked(fixture.api!.reviewRetention).mockResolvedValue(
      review({ kind: "retention", entryCount: 0, policy: { mode: "forever" } }),
    );
    render(<ConnectionRecycleBinSection />);
    fireEvent.click(screen.getByLabelText("Keep indefinitely"));
    fireEvent.click(screen.getByText("Review retention change"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("No existing items will be deleted."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/cannot be restored/)).toBeNull();
    expect(within(dialog).getByText("Database: Demo database")).toHaveAttribute(
      "title",
      "db-a",
    );
  });
  it("defaults to 15 days and reviews affected expired entries before shortening", async () => {
    render(<ConnectionRecycleBinSection />);
    expect(screen.getByLabelText("Retention in days")).toHaveValue(15);
    expect(screen.getByText("Demo database")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Retention in days"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByText("Review retention change"));
    const dialog = await screen.findByRole("dialog");
    expect(fixture.api!.reviewRetention).toHaveBeenCalledWith(
      { mode: "days", days: 3 },
      scope,
    );
    expect(
      within(dialog).getByText(/2 items will be permanently deleted/),
    ).toBeInTheDocument();
    expect(fixture.api!.commitReview).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("Apply retention"));
    await waitFor(() =>
      expect(fixture.api!.commitReview).toHaveBeenCalledOnce(),
    );
  });
  it("offers indefinite retention without using a global setting and validates custom days", async () => {
    render(<ConnectionRecycleBinSection />);
    fireEvent.change(screen.getByLabelText("Retention in days"), {
      target: { value: "0" },
    });
    expect(screen.getByText("Review retention change")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Keep indefinitely"));
    expect(screen.getByLabelText("Retention in days")).toBeDisabled();
    fireEvent.click(screen.getByText("Review retention change"));
    await screen.findByRole("dialog");
    expect(fixture.api!.reviewRetention).toHaveBeenCalledWith(
      { mode: "forever" },
      scope,
    );
  });
  it("drops a stale draft/review when the database changes, never editing the next database", async () => {
    const view = render(<ConnectionRecycleBinSection />);
    fireEvent.change(screen.getByLabelText("Retention in days"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("Review retention change"));
    await screen.findByRole("dialog");
    fixture.api = {
      ...fixture.api!,
      snapshot: {
        scope: { ...scope, databaseId: "db-b" },
        policy: { mode: "days", days: 40 },
        entries: [],
      },
    };
    view.rerender(<ConnectionRecycleBinSection />);
    expect(screen.getByLabelText("Retention in days")).toHaveValue(40);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.api.commitReview).not.toHaveBeenCalled();
  });
  it("keeps unavailable settings explicit and searchable in Security", () => {
    fixture.api = undefined;
    render(<ConnectionRecycleBinSection />);
    expect(
      screen.getByText(/This is not a global setting/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Retention in days")).toBeNull();
    expect(
      SECURITY_SEARCH_ENTRIES.find(
        (entry) => entry.key === "currentDatabaseRecycleBin",
      )?.section,
    ).toBe("security");
  });
});
