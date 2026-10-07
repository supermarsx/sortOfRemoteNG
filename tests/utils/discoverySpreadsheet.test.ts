import { describe, expect, it, vi } from "vitest";
import {
  createDiscoverySpreadsheet,
  saveDiscoverySpreadsheet,
} from "../../src/utils/discovery/discoverySpreadsheet";
import {
  DOCUMENT_LIMITS,
  emptyDatabaseDocuments,
} from "../../src/utils/documents/validation";
import { registerDocumentDraft } from "../../src/utils/documents/documentDrafts";
import { toUniverWorkbook } from "../../src/utils/documents/spreadsheetUniverAdapter";
import type {
  DatabaseDocumentStore,
  DatabaseDocuments,
} from "../../src/types/documents/document";
import {
  spreadsheetScan,
  deferred,
} from "../network/discoverySpreadsheetFixtures";

const create = () =>
  createDiscoverySpreadsheet({
    scan: spreadsheetScan(),
    name: "Office inventory",
  });
function setup() {
  let data = emptyDatabaseDocuments();
  const store: DatabaseDocumentStore = {
    scope: { databaseId: "db-a", generation: 7 },
    changeRevision: 0,
    read: vi.fn(async () => structuredClone(data)),
    compareAndSwap: vi.fn(async (_scope, expected, replacement) => {
      expect(expected).toEqual(data);
      data = structuredClone(replacement);
    }),
  };
  const options = {
    document: create(),
    scope: { ...store.scope! },
    getStore: () => store,
    assertCurrent: vi.fn(),
    verifyPolicy: vi.fn(async () => {}),
  };
  return { store, options, data: () => data };
}

describe("discovery spreadsheet serialization", () => {
  it("preserves hosts, service evidence, probes and configuration as literal cells", () => {
    const scan = spreadsheetScan();
    const original = structuredClone(scan);
    const document = createDiscoverySpreadsheet({
      scan,
      name: "  My inventory  ",
      parentFolderId: "folder-office",
    });
    expect(document.name).toBe("My inventory");
    expect(document.parentFolderId).toBe("folder-office");
    const block = document.blocks[0];
    if (block.type !== "spreadsheet") throw Error("Expected spreadsheet");
    expect(block.workbook.sheets.map((sheet) => sheet.name)).toEqual([
      "Scan",
      "Hosts",
      "Services",
      "Probes",
    ]);
    expect(block.workbook.sheets[1].cells.B2.value).toBe(
      scan.hosts[0].hostname,
    );
    expect(block.workbook.sheets[1].cells.F2.value).toBe("22, 443");
    expect(block.workbook.sheets[2].cells.G2.value).toBe("9.0");
    expect(block.workbook.sheets[2].cells.I2.value).toBe(
      scan.hosts[0].services[0].banner,
    );
    expect(block.workbook.sheets[3].cells.F3.value).toBe("Permission denied");
    const values = block.workbook.sheets.flatMap((sheet) =>
      Object.values(sheet.cells),
    );
    expect(
      values.every(
        (cell) =>
          !Object.prototype.hasOwnProperty.call(cell, "formula") &&
          !Object.prototype.hasOwnProperty.call(cell, "reference"),
      ),
    ).toBe(true);
    expect(values.map((cell) => cell.value)).toContain("192.0.2.0/24");
    const engine = toUniverWorkbook(block.workbook, "exported-scan");
    expect(engine.sheets.hosts.cellData?.[1]?.[1]).toMatchObject({
      v: scan.hosts[0].hostname,
      t: 1,
    });
    expect(engine.sheets.hosts.cellData?.[1]?.[1]).not.toHaveProperty("f");
    expect(scan).toEqual(original);
  });
  it("labels filtered snapshots, including an intentionally empty selection", () => {
    const scan = spreadsheetScan();
    const document = createDiscoverySpreadsheet({
      scan,
      hosts: [],
      filtered: true,
      filterText: "=remote",
      name: "Filtered",
    });
    const block = document.blocks[0];
    if (block.type !== "spreadsheet") throw Error("Expected spreadsheet");
    expect(block.workbook.sheets[1].rows).toBe(1);
    const values = Object.values(block.workbook.sheets[0].cells).map(
      (cell) => cell.value,
    );
    expect(values).toContain(
      "Filtered hosts (all services for each matching host)",
    );
    expect(values).toContain("=remote");
    expect(scan.hosts).toHaveLength(2);
  });
  it("rejects oversized text and cell counts without truncation, allowing a smaller filtered export", () => {
    const scan = spreadsheetScan();
    scan.hosts[0].services[0].banner = "x".repeat(32769);
    expect(() =>
      createDiscoverySpreadsheet({ scan, name: "Too long" }),
    ).toThrow(/nothing is truncated/);
    scan.hosts = Array.from({ length: 8000 }, () => ({
      ...scan.hosts[1],
      discoveryProbes: [],
    }));
    expect(() =>
      createDiscoverySpreadsheet({ scan, name: "Too many" }),
    ).toThrow(/nothing is truncated/);
    expect(
      createDiscoverySpreadsheet({
        scan,
        hosts: [scan.hosts[0]],
        filtered: true,
        name: "Small",
      }).blocks,
    ).toHaveLength(1);
  });
});

describe("discovery document durable save", () => {
  it("appends with one receipt-bound CAS and waits for durability", async () => {
    const { store, options, data } = setup();
    await saveDiscoverySpreadsheet(options);
    const first = structuredClone(data().documents[0]);
    const done = deferred<void>();
    const original = store.compareAndSwap;
    store.compareAndSwap = vi.fn(async (scope, expected, replacement) => {
      await done.promise;
      await original(scope, expected, replacement);
    });
    let complete = false;
    const saving = saveDiscoverySpreadsheet({
      ...options,
      document: create(),
    }).then(() => {
      complete = true;
    });
    await vi.waitFor(() => expect(store.compareAndSwap).toHaveBeenCalledOnce());
    expect(complete).toBe(false);
    done.resolve();
    await saving;
    expect(data().documents).toHaveLength(2);
    expect(data().documents[0]).toEqual(first);
    expect(data().revision).toBe(2);
  });
  it.each(["dirty", "busy"] as const)(
    "blocks %s drafts, including drafts created during a read",
    async (field) => {
      const { store, options } = setup();
      const pending = deferred<DatabaseDocuments>();
      store.read = vi.fn(() => pending.promise);
      const promise = saveDiscoverySpreadsheet(options);
      const unregister = registerDocumentDraft("documents-tab", () => ({
        databaseId: "db-a",
        [field]: true,
        dirty: field === "dirty",
        busy: field === "busy",
        revision: 0,
      }));
      try {
        pending.resolve(emptyDatabaseDocuments());
        await expect(promise).rejects.toThrow(/unsaved changes/);
        await expect(saveDiscoverySpreadsheet(options)).rejects.toThrow(
          /unsaved changes/,
        );
        expect(store.compareAndSwap).not.toHaveBeenCalled();
      } finally {
        unregister();
      }
    },
  );
  it.each([
    null,
    { databaseId: "db-b", generation: 8 },
    { databaseId: "db-a", generation: 8 },
  ])(
    "rejects a lock or changed owner epoch during a read (%j)",
    async (scope) => {
      const { store, options } = setup();
      const pending = deferred<DatabaseDocuments>();
      store.read = vi.fn(() => pending.promise);
      const promise = saveDiscoverySpreadsheet(options);
      store.scope = scope;
      pending.resolve(emptyDatabaseDocuments());
      await expect(promise).rejects.toThrow(/unavailable|changed|locked/);
      expect(store.compareAndSwap).not.toHaveBeenCalled();
    },
  );
  it("rechecks lifecycle and draft protection after policy verification", async () => {
    const { store, options } = setup();
    const pending = deferred<void>();
    options.verifyPolicy = vi.fn(() => pending.promise);
    const promise = saveDiscoverySpreadsheet(options);
    await vi.waitFor(() => expect(options.verifyPolicy).toHaveBeenCalledOnce());
    options.assertCurrent.mockImplementation(() => {
      throw Error("Dialog closed");
    });
    pending.resolve();
    await expect(promise).rejects.toThrow("Dialog closed");
    expect(store.compareAndSwap).not.toHaveBeenCalled();
  });
  it("refuses disabled policy, full libraries, and CAS conflicts without retries", async () => {
    const { store, options } = setup();
    options.verifyPolicy.mockRejectedValueOnce(
      Error("Spreadsheets are disabled"),
    );
    await expect(saveDiscoverySpreadsheet(options)).rejects.toThrow("disabled");
    expect(store.compareAndSwap).not.toHaveBeenCalled();
    const full = {
      ...emptyDatabaseDocuments(),
      documents: Array.from(
        { length: DOCUMENT_LIMITS.documents },
        (_, index) => ({ ...create(), id: `doc-${index}`, blocks: [] }),
      ),
    };
    store.read = vi.fn(async () => full);
    await expect(saveDiscoverySpreadsheet(options)).rejects.toThrow(
      /oversized/,
    );
    expect(store.compareAndSwap).not.toHaveBeenCalled();
    store.read = vi.fn(async () => emptyDatabaseDocuments());
    store.compareAndSwap = vi.fn(async () => {
      throw Error("Documents changed since review");
    });
    await expect(saveDiscoverySpreadsheet(options)).rejects.toThrow(
      "changed since review",
    );
    expect(store.compareAndSwap).toHaveBeenCalledOnce();
  });
  it("keeps app scope distinct even with a matching database owner ID", async () => {
    const { store, options } = setup();
    store.scope = { ...options.scope, kind: "app" };
    await expect(saveDiscoverySpreadsheet(options)).rejects.toThrow(
      /changed|locked/,
    );
    expect(store.read).not.toHaveBeenCalled();
  });
});
