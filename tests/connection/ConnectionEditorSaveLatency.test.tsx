import React, { useEffect } from "react";
import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import type { Connection } from "../../src/types/connection/connection";
import { acquireCloudSyncDatabaseBarrier } from "../../src/utils/services/cloudSyncDatabaseBarrier";
import {
  reconcileRecordLedger,
  snapshotRecordPayload,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";

/**
 * Save/Connect responsiveness with a realistically large library. The storage
 * target does the renderer's real per-save record-ledger work over the whole
 * library and then waits for a simulated native encrypt + write, so the timing
 * budgets below catch both a slow save path and a click that waits for it.
 */
const LIBRARY_SIZE = 2000;
const NATIVE_WRITE_MS = 400;
// Generous for slow CI, still far below one durable write (>= NATIVE_WRITE_MS).
const OPTIMISTIC_BUDGET_MS = 300;

const fixture = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  ledger: undefined as RecordLedger | undefined,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  const manager = {
    getCurrentDatabase: () => ({ id: "latency-db" }),
    onCurrentDatabaseChange: () => () => {},
    registerBeforeDatabaseTransition: () => () => {},
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "latency-db",
      assertAccessible: () => {},
      load: fixture.load,
      save: fixture.save,
    }),
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onCurrentDatabaseChange: () => () => {},
  };
});
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: fixture.toast }),
}));

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

const connectionAt = (
  index: number,
  overrides: Partial<Connection> = {},
): Connection => ({
  id: `conn-${index}`,
  name: `Server ${String(index).padStart(4, "0")}`,
  protocol: "ssh",
  hostname: `host-${index}.example.internal`,
  port: 22,
  username: "admin",
  isGroup: false,
  // Collapsed folders keep the jsdom tree small; the provider, reducer and
  // storage snapshot still carry every row.
  parentId: index < 10 ? undefined : `conn-${index % 10}`,
  tags: ["prod"],
  description: "Rack 4, row B. ".repeat(8),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...(index < 10 ? { isGroup: true, expanded: false, hostname: "" } : {}),
  ...overrides,
});

const library = (size: number, extra: Connection[] = []) => [
  ...Array.from({ length: size }, (_, index) => connectionAt(index)),
  ...extra,
];

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mirrors DatabaseManager.saveDatabaseData: a synchronous payload snapshot,
 * the `databases_list` IPC, the real record-ledger reconciliation over every
 * record, then a simulated native encrypt + write.
 */
async function realisticSave(data: { connections: Connection[] }) {
  const payload = snapshotRecordPayload(data);
  await delay(0);
  fixture.ledger = await reconcileRecordLedger(payload, fixture.ledger, {
    mode: "write",
  });
  await delay(NATIVE_WRITE_MS);
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function Harness({
  editId,
  onClose,
  onConnect,
}: {
  editId?: string;
  onClose: () => void;
  onConnect: (connection: Connection) => void;
}) {
  const { state, loadData, persistence } = useConnections();
  useEffect(() => {
    void loadData("latency-db");
  }, [loadData]);
  const loaded = state.connections.length > 0;
  const connection = editId
    ? state.connections.find((candidate) => candidate.id === editId)
    : undefined;
  return (
    <>
      <ConnectionTree
        onConnect={() => {}}
        onDisconnect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
      <output data-testid="row-count">{state.connections.length}</output>
      <output data-testid="persistence-error">{persistence.error}</output>
      {loaded && (!editId || connection) ? (
        <ConnectionEditor
          connection={connection}
          isOpen
          onClose={onClose}
          onConnect={onConnect}
        />
      ) : null}
    </>
  );
}

function mount(
  connections: Connection[],
  editId?: string,
): {
  onClose: ReturnType<typeof vi.fn>;
  onConnect: ReturnType<typeof vi.fn>;
} {
  fixture.load.mockResolvedValue({
    connections,
    settings: {},
    timestamp: 0,
    tabGroups: [],
  });
  const onClose = vi.fn();
  const onConnect = vi.fn();
  render(
    <ConnectionProvider>
      <Harness editId={editId} onClose={onClose} onConnect={onConnect} />
    </ConnectionProvider>,
  );
  return { onClose, onConnect };
}

/**
 * Event timestamps taken inside the callbacks themselves. Polling with waitFor
 * would add the time the busy event loop needs to schedule the next poll.
 */
function createStamps() {
  const at = new Map<string, number>();
  let start = 0;
  const stamp = (name: string) => {
    if (!at.has(name)) at.set(name, performance.now());
  };
  return {
    stamp,
    begin: () => {
      at.clear();
      start = performance.now();
    },
    since: (name: string) => {
      const value = at.get(name);
      if (value === undefined) throw new Error(`No "${name}" timestamp`);
      return value - start;
    },
    has: (name: string) => at.has(name),
  };
}

/** Stamps `name` on the first DOM mutation after which `check()` is true. */
function stampWhen(
  stamps: ReturnType<typeof createStamps>,
  name: string,
  check: () => boolean,
) {
  const observer = new MutationObserver(() => {
    if (check()) {
      stamps.stamp(name);
      observer.disconnect();
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return observer;
}

function report(label: string, values: Record<string, number>) {
  process.stderr.write(
    `[save-latency] ${label}: ${Object.entries(values)
      .map(([key, value]) => `${key}=${value.toFixed(0)}ms`)
      .join(" ")}\n`,
  );
}

const rowLabel = (id: string) =>
  document.querySelector(`[data-connection-id="${id}"]`)?.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.ledger = undefined;
  fixture.save.mockReset().mockImplementation(realisticSave);
});
afterEach(() => {
  cleanup();
});

describe(`connection editor responsiveness with ${LIBRARY_SIZE} connections`, () => {
  beforeEach(async () => {
    // Seed the ledger exactly as the loaded database would carry it.
    fixture.ledger = await reconcileRecordLedger(
      snapshotRecordPayload({
        connections: library(LIBRARY_SIZE),
        settings: {},
        timestamp: 0,
        tabGroups: [],
      }),
      undefined,
      { mode: "write", now: "2026-01-01T00:00:00.000Z" },
    );
  });

  it("closes a created connection before its durable write finishes and still confirms it", async () => {
    const stamps = createStamps();
    const { onClose } = mount(library(LIBRARY_SIZE));
    onClose.mockImplementation(() => stamps.stamp("closed"));
    fixture.toast.success.mockImplementation(() => stamps.stamp("confirmed"));
    await waitFor(() =>
      expect(screen.getByTestId("row-count")).toHaveTextContent(
        String(LIBRARY_SIZE),
      ),
    );
    fireEvent.change(await screen.findByTestId("editor-name"), {
      target: { value: "Fresh server" },
    });
    fireEvent.change(screen.getByTestId("editor-hostname"), {
      target: { value: "fresh.example.internal" },
    });
    stamps.begin();
    fireEvent.click(screen.getByTestId("editor-save"));
    stamps.stamp("feedback");
    expect(screen.getByTestId("editor-save")).toBeDisabled();
    expect(screen.getByTestId("editor-save")).toHaveTextContent("Saving...");
    await waitFor(() => expect(stamps.has("confirmed")).toBe(true), {
      timeout: 15_000,
    });
    expect(fixture.toast.success).toHaveBeenCalledWith(
      '"Fresh server" created',
    );
    report("create", {
      feedback: stamps.since("feedback"),
      closed: stamps.since("closed"),
      confirmed: stamps.since("confirmed"),
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stamps.since("closed")).toBeLessThan(OPTIMISTIC_BUDGET_MS);
    expect(stamps.since("confirmed")).toBeGreaterThanOrEqual(NATIVE_WRITE_MS);
    expect(screen.getByTestId("row-count")).toHaveTextContent(
      String(LIBRARY_SIZE + 1),
    );
    expect(fixture.toast.error).not.toHaveBeenCalled();
    expect(
      fixture.save.mock.lastCall![0].connections.some(
        (row: Connection) => row.name === "Fresh server",
      ),
    ).toBe(true);
  }, 30_000);

  it("connects with the edited values before the durable write finishes", async () => {
    const stamps = createStamps();
    const { onConnect } = mount(library(LIBRARY_SIZE), "conn-1234");
    onConnect.mockImplementation(() => stamps.stamp("connected"));
    fixture.save.mockImplementation(async (data) => {
      await realisticSave(data);
      stamps.stamp("written");
    });
    const name = await screen.findByDisplayValue("Server 1234");
    fireEvent.change(name, { target: { value: "Server 1234 renamed" } });
    fireEvent.change(screen.getByTestId("editor-hostname"), {
      target: { value: "new-host.example.internal" },
    });
    stamps.begin();
    fireEvent.click(screen.getByTestId("editor-connect"));
    // A second click while the first is pending must not launch twice.
    fireEvent.click(screen.getByTestId("editor-connect"));
    await waitFor(() => expect(stamps.has("written")).toBe(true), {
      timeout: 15_000,
    });
    report("connect", {
      connected: stamps.since("connected"),
      written: stamps.since("written"),
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0][0]).toMatchObject({
      id: "conn-1234",
      name: "Server 1234 renamed",
      hostname: "new-host.example.internal",
    });
    expect(stamps.since("connected")).toBeLessThan(OPTIMISTIC_BUDGET_MS);
    expect(stamps.since("written")).toBeGreaterThanOrEqual(NATIVE_WRITE_MS);
    await waitFor(() =>
      expect(screen.getByTestId("editor-connect")).not.toBeDisabled(),
    );
    expect(fixture.toast.error).not.toHaveBeenCalled();
  }, 30_000);

  it("shows the saved name in the tree immediately and confirms after the durable write", async () => {
    const stamps = createStamps();
    mount(library(LIBRARY_SIZE), "conn-3");
    fixture.toast.success.mockImplementation(() => stamps.stamp("confirmed"));
    const name = await screen.findByDisplayValue("Server 0003");
    await waitFor(() => expect(rowLabel("conn-3")).toContain("Server 0003"));
    fireEvent.change(name, { target: { value: "Folder three renamed" } });
    const observer = stampWhen(stamps, "sidebar", () =>
      rowLabel("conn-3").includes("Folder three renamed"),
    );
    stamps.begin();
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(screen.getByTestId("editor-save")).toHaveTextContent("Saving...");
    await waitFor(() => expect(stamps.has("confirmed")).toBe(true), {
      timeout: 15_000,
    });
    observer.disconnect();
    expect(fixture.toast.success).toHaveBeenCalledWith(
      '"Folder three renamed" saved',
    );
    report("save", {
      sidebar: stamps.since("sidebar"),
      confirmed: stamps.since("confirmed"),
    });
    expect(stamps.since("sidebar")).toBeLessThan(OPTIMISTIC_BUDGET_MS);
    await waitFor(() =>
      expect(screen.getByTestId("editor-save")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("editor-save")).toHaveTextContent("Save");
  }, 30_000);
});

describe("save consistency", () => {
  const small = () => library(30);

  it("reports a failed background write after an optimistic close and keeps the row", async () => {
    fixture.save.mockReset().mockRejectedValue(new Error("Disk is full"));
    const { onClose } = mount(small());
    fireEvent.change(await screen.findByTestId("editor-name"), {
      target: { value: "Unsaved server" },
    });
    fireEvent.change(screen.getByTestId("editor-hostname"), {
      target: { value: "unsaved.example" },
    });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith(
        "Connection was not saved. Disk is full",
      ),
    );
    expect(fixture.toast.success).not.toHaveBeenCalled();
    // The edit is retained in memory (dirty) for the provider's retry.
    expect(screen.getByTestId("row-count")).toHaveTextContent("31");
    expect(screen.getByTestId("persistence-error")).toHaveTextContent(
      "Disk is full",
    );
  });

  it("launches Connect with the in-memory edit and still reports a failed durable write", async () => {
    fixture.save.mockReset().mockRejectedValue(new Error("Disk is full"));
    const { onConnect } = mount(small(), "conn-12");
    fireEvent.change(await screen.findByDisplayValue("Server 0012"), {
      target: { value: "Renamed twelve" },
    });
    fireEvent.click(screen.getByTestId("editor-connect"));
    // The edit reached memory, so Connect uses it, and the failure is surfaced.
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    expect(onConnect.mock.calls[0][0].name).toBe("Renamed twelve");
    await waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith(
        "Connection was not saved. Disk is full",
      ),
    );
    expect(screen.getByDisplayValue("Renamed twelve")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("editor-connect")).not.toBeDisabled(),
    );
  });

  it("persists rapid successive saves in order and the tree ends on the newest", async () => {
    const first = deferred();
    fixture.save
      .mockReset()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    mount(small(), "conn-5");
    const name = await screen.findByDisplayValue("Server 0005");
    fireEvent.change(name, { target: { value: "First name" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rowLabel("conn-5")).toContain("First name"));
    fireEvent.change(name, { target: { value: "Second name" } });
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("editor-save")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(rowLabel("conn-5")).toContain("Second name"));
    await waitFor(() =>
      expect(fixture.toast.success).toHaveBeenCalledWith('"Second name" saved'),
    );
    const saves = fixture.save.mock.calls.map(
      ([data]) =>
        (data.connections as Connection[]).find((row) => row.id === "conn-5")!
          .name,
    );
    expect(saves[0]).toBe("First name");
    expect(saves[saves.length - 1]).toBe("Second name");
    expect(rowLabel("conn-5")).not.toContain("First name");
  });

  it("saves then connects immediately with the newest values", async () => {
    const { onConnect } = mount(small(), "conn-16");
    const name = await screen.findByDisplayValue("Server 0016");
    fireEvent.change(name, { target: { value: "Saved first" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    fireEvent.change(screen.getByTestId("editor-hostname"), {
      target: { value: "connect-time.example" },
    });
    fireEvent.click(screen.getByTestId("editor-connect"));
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    expect(onConnect.mock.calls[0][0]).toMatchObject({
      name: "Saved first",
      hostname: "connect-time.example",
    });
    await waitFor(() =>
      expect(
        fixture.save.mock.lastCall?.[0].connections.find(
          (row: Connection) => row.id === "conn-16",
        ),
      ).toMatchObject({
        name: "Saved first",
        hostname: "connect-time.example",
      }),
    );
  });

  it("updates the tree label, icon and folder as soon as Save is clicked", async () => {
    const first = deferred();
    fixture.save.mockReset().mockImplementationOnce(() => first.promise);
    mount(small(), "conn-17");
    const name = await screen.findByDisplayValue("Server 0017");
    // conn-17 starts inside collapsed folder conn-7, so it has no tree row.
    await waitFor(() => expect(rowLabel("conn-7")).toContain("Server 0007"));
    expect(rowLabel("conn-17")).toBe("");
    fireEvent.change(name, { target: { value: "Relabelled" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Reset parent folder to Root" }),
    );
    fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "star" } },
    );
    fireEvent.click(screen.getByRole("option", { name: /Star \(star\)/ }));
    fireEvent.click(screen.getByTestId("editor-save"));
    // Visible before the durable write settles.
    await waitFor(() => expect(rowLabel("conn-17")).toContain("Relabelled"));
    const row = document.querySelector('[data-connection-id="conn-17"]')!;
    expect(
      row.querySelector("svg[aria-label]")?.getAttribute("aria-label"),
    ).toMatch(/star/i);
    expect(fixture.toast.success).not.toHaveBeenCalled();
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    await waitFor(() =>
      expect(fixture.toast.success).toHaveBeenCalledWith('"Relabelled" saved'),
    );
    const saved = fixture.save.mock.lastCall![0].connections.find(
      (row: Connection) => row.id === "conn-17",
    );
    expect(saved).toMatchObject({ name: "Relabelled", icon: "star" });
    expect(saved.parentId).toBeUndefined();
  });

  it("queues a save behind a cloud-sync capture instead of dropping it", async () => {
    mount(small(), "conn-18");
    const name = await screen.findByDisplayValue("Server 0018");
    await waitFor(() => expect(rowLabel("conn-8")).toContain("Server 0008"));
    let release!: () => Promise<void>;
    await act(async () => {
      release = await acquireCloudSyncDatabaseBarrier(["latency-db"]);
    });
    fireEvent.change(name, { target: { value: "Edited during sync" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    await act(async () => {
      await delay(50);
    });
    // Previously the fenced dispatch was dropped and still reported "saved".
    expect(fixture.toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-save")).toBeDisabled();
    await act(async () => {
      await release();
    });
    await waitFor(() =>
      expect(fixture.toast.success).toHaveBeenCalledWith(
        '"Edited during sync" saved',
      ),
    );
    expect(
      fixture.save.mock.lastCall![0].connections.find(
        (row: Connection) => row.id === "conn-18",
      ).name,
    ).toBe("Edited during sync");
    expect(fixture.toast.error).not.toHaveBeenCalled();
  });
});
