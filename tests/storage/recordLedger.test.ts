import { createHash, webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";
import {
  fullData,
  NOW,
  trust,
  VAULT_ID,
  TOTP_ID,
} from "../fixtures/fullDatabaseArchive";
import { fixture as documentFixture } from "../documents/fixtures";

const EPOCH = "1970-01-01T00:00:00.000Z";
const LATER = "2026-10-01T12:00:00.000Z";
const EARLIER = "2020-01-01T00:00:00.000Z";
const HOST = "$/connections/@host";
const write = (now = LATER) => ({ mode: "write" as const, now });
const clone = <T>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function payload() {
  return {
    timestamp: Date.parse(NOW),
    connections: [
      {
        id: "host",
        name: "Host",
        password: "PRIVATE_PASSWORD",
        createdAt: NOW,
        updatedAt: NOW,
      },
      { id: "other", name: "Other", createdAt: NOW, updatedAt: NOW },
    ],
    settings: { theme: "dark" },
  };
}
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

describe("record enumeration and private hashes", () => {
  it("covers the real full database fixture, including every private section and nested records", async () => {
    const data = await fullData();
    data.databaseSettings = {
      version: 1,
      documentTypes: { disabled: ["wifi"] },
    };
    data.documents!.people.push({
      id: "person",
      name: "Private person",
      email: "private@example.test",
      phone: "123",
      organization: "Private org",
      notes: "PRIVATE_PERSON_NOTES",
      references: [],
    });
    data.documents!.tickets.push({
      id: "ticket",
      title: "Private ticket",
      status: "open",
      priority: "normal",
      description: "PRIVATE_TICKET_BODY",
      references: [],
    });
    data.automationLibrary!.provenance["terminal-script:script"] = {
      publisher: "Private author",
    };
    data.automationLibrary!.terminalScripts.modifiedDefaults.push({
      ...data.automationLibrary!.terminalScripts.customScripts[0],
      id: "default",
    });
    data.automationLibrary!.terminalMacros.push({
      id: "terminal",
      name: "Terminal",
      description: "",
      category: "Test",
      tags: [],
      steps: [{ command: "hostname", delayMs: 0, sendNewline: true }],
      createdAt: NOW,
      updatedAt: NOW,
    });
    data.automationLibrary!.website.scripts.push({
      id: "browser",
      kind: "script",
      name: "Browser",
      description: "",
      code: "document.title",
      createdAt: NOW,
      updatedAt: NOW,
    });
    data.automationLibrary!.website.macros.push({
      id: "macro",
      kind: "macro",
      name: "Macro",
      description: "",
      steps: [{ kind: "click", selector: "button" }],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const complete = { ...data, trustRecords: clone(trust) };
    const ledger = await reconcileRecordLedger(complete);
    const keys = Object.keys(ledger.records);
    for (const section of Object.keys(complete).filter(
      (key) => key !== "timestamp",
    ))
      expect(keys).toContain(`$/${section}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        "$",
        HOST,
        "$/settings/theme",
        "$/databaseSettings/version",
        "$/databaseSettings/documentTypes",
        "$/colorTags/custom",
        "$/recycleBin/entries/@deleted-row",
        "$/documents/documents/@document",
        "$/documents/documents/@document/blocks/@secret",
        "$/documents/people/@person",
        "$/documents/tickets/@ticket",
        `$/documents/attachments/@${data.documents!.attachments[0].id}`,
        `$/credentialVault/entries/@${VAULT_ID}`,
        `$/credentialVault/entries/@${VAULT_ID}/facets/totp/@${TOTP_ID}`,
        `$/credentialVault/entries/@${VAULT_ID}/facets/deviceTrust/@${TOTP_ID}`,
        "$/automationLibrary/terminalScripts/customScripts/@script",
        "$/automationLibrary/terminalScripts/modifiedDefaults/@default",
        "$/automationLibrary/terminalMacros/@terminal",
        "$/automationLibrary/website/scripts/@browser",
        "$/automationLibrary/website/macros/@macro",
        "$/automationLibrary/provenance/terminal-script%3Ascript",
      ]),
    );
    expect(keys.some((key) => /\/(?:0|1)$/.test(key))).toBe(false);
    expect(keys).not.toContain("$/timestamp");
    expect(ledger.journal).toHaveLength(keys.length);
    expect(JSON.stringify(ledger)).not.toMatch(
      /PRIVATE_|private@example|Private author|document.title|hostname/,
    );
    for (const event of ledger.journal) {
      expect(Object.keys(event).sort()).toEqual([
        "kind",
        "record",
        "revision",
        "timestamp",
      ]);
      expect(event.kind).toBe("migrate");
    }
    expect(normalizeRecordLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(
      ledger,
    );
  });

  it("finds spreadsheet sheets but captures anonymous rich text, cells, marks and merges in their parents", async () => {
    const data = { documents: documentFixture() };
    const previous = await reconcileRecordLedger(data);
    const keys = Object.keys(previous.records);
    expect(keys).toContain(
      "$/documents/documents/@doc/blocks/@sheet/workbook/sheets/@main",
    );
    expect(
      keys.some(
        (key) =>
          key.includes("/content/") ||
          key.includes("/marks/") ||
          key.includes("/cells/"),
      ),
    ).toBe(false);
    const changed = {
      documents: {
        ...data.documents,
        documents: data.documents.documents.map((document) => ({
          ...document,
          blocks: document.blocks.map((block) =>
            block.type === "rich-text"
              ? {
                  ...block,
                  content: {
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Edited text" }],
                      },
                    ],
                  },
                }
              : block,
          ),
        })),
      },
    };
    const next = await reconcileRecordLedger(changed, previous, write());
    expect(
      next.records["$/documents/documents/@doc/blocks/@text"].revision,
    ).not.toBe(
      previous.records["$/documents/documents/@doc/blocks/@text"].revision,
    );
    expect(next.records["$/documents/documents/@doc/blocks/@sheet"]).toEqual(
      previous.records["$/documents/documents/@doc/blocks/@sheet"],
    );
    const anonymous = await reconcileRecordLedger({
      wrappers: [{ nested: [{ id: "inside", value: 1 }] }],
    });
    expect(Object.keys(anonymous.records)).toEqual(["$", "$/wrappers"]);
  });

  it("keeps individual revisions stable on ID-array reorder and key insertion order changes", async () => {
    const data = payload();
    const previous = await reconcileRecordLedger(data);
    const next = await reconcileRecordLedger(
      {
        settings: data.settings,
        connections: [...data.connections].reverse(),
        timestamp: 0,
      },
      previous,
      write(),
    );
    expect(next.records[HOST]).toEqual(previous.records[HOST]);
    expect(next.records["$/connections/@other"]).toEqual(
      previous.records["$/connections/@other"],
    );
    expect(next.records["$"].revision).not.toBe(previous.records["$"].revision);
    expect(
      next.journal.slice(previous.journal.length).map((event) => event.record),
    ).toEqual(["$", "$/connections"]);
    expect(await reconcileRecordLedger({ settings: { b: 2, a: 1 } })).toEqual(
      await reconcileRecordLedger({ settings: { a: 1, b: 2 } }),
    );
  });

  it("hashes SHA-256 canonical JSON, ignoring only ROOT metadata and timestamp", async () => {
    const data = { settings: { b: 2, a: 1 } };
    const prior = await reconcileRecordLedger(data);
    expect(prior.records["$/settings"].contentHash).toBe(
      createHash("sha256").update('{"a":1,"b":2}').digest("hex"),
    );
    expect(
      await reconcileRecordLedger(
        { timestamp: Date.parse(LATER), recordMetadata: prior, ...data },
        undefined,
        write(),
      ),
    ).toEqual(prior);
    const nested = {
      settings: { timestamp: 1, recordMetadata: { note: "content" } },
    };
    const nestedPrior = await reconcileRecordLedger(nested);
    nested.settings.timestamp++;
    nested.settings.recordMetadata.note = "changed";
    const next = await reconcileRecordLedger(nested, nestedPrior, write());
    expect(next.records["$/settings/timestamp"].revision).not.toBe(
      nestedPrior.records["$/settings/timestamp"].revision,
    );
    expect(next.records["$/settings/recordMetadata"].revision).not.toBe(
      nestedPrior.records["$/settings/recordMetadata"].revision,
    );
  });

  it("encodes property/ID boundaries, preserves literal percent signs and separates equal IDs by collection", async () => {
    const ledger = await reconcileRecordLedger({
      "odd/name": [
        { id: "a/b %@雪", nested: [{ id: "a/b %@雪" }] },
        { id: "a%2Fb" },
        { id: "a/b" },
      ],
      "odd%2Fname": [{ id: "a/b" }],
      settings: { "@a/b": true, "a/b": 1 },
      modifiedDefaults: { "default/key": { script: "private" } },
    });
    expect(Object.keys(ledger.records)).toEqual(
      expect.arrayContaining([
        "$/odd%2Fname/@a%2Fb%20%25%40%E9%9B%AA",
        "$/odd%2Fname/@a%252Fb",
        "$/odd%2Fname/@a%2Fb",
        "$/odd%252Fname/@a%2Fb",
        "$/settings/%40a%2Fb",
        "$/settings/a%2Fb",
        "$/modifiedDefaults/default%2Fkey",
      ]),
    );
    expect(normalizeRecordLedger(ledger)).toEqual(ledger);
  });

  it("omits optional undefined object fields at every depth exactly like persisted JSON", async () => {
    const data = {
      ...payload(),
      optional: undefined,
      settings: { theme: "dark", optional: undefined },
    };
    Object.assign(data.connections[0], {
      username: undefined,
      nested: { missing: undefined, retained: true },
    });
    const serialized = JSON.parse(JSON.stringify(data));
    const prior = await reconcileRecordLedger(data);
    expect(prior).toEqual(await reconcileRecordLedger(serialized));
    expect(await reconcileRecordLedger(serialized, prior, write())).toEqual(
      prior,
    );
    await expect(reconcileRecordLedger({ items: [undefined] })).rejects.toThrow(
      "non-JSON value",
    );
  });
});

describe("scoped reference regression", () => {
  it("keeps favorites in their owning connections, matching the database automation portability fixture", async () => {
    // Same references as databaseAutomationPortability.test.ts's whole database
    // import/clone case: app, owning database, foreign database.
    const refs = [
      { kind: "macro", id: "fixture" },
      {
        kind: "macro",
        id: "fixture",
        scope: { kind: "database", databaseId: "source-db" },
      },
      {
        kind: "macro",
        id: "fixture",
        scope: { kind: "database", databaseId: "foreign-db" },
      },
    ];
    const connection = {
      id: "host",
      name: "Host",
      protocol: "ssh",
      hostname: "fixture.invalid",
      port: 22,
      isGroup: false,
      createdAt: "2026-09-10",
      updatedAt: "2026-09-10",
      sshQuickActions: { version: 1, items: refs },
      httpAutomation: {
        version: 1,
        items: refs,
        interactionMacrosEnabled: false,
        scriptInjectionEnabled: false,
        forceDark: false,
      },
    };
    const data = {
      connections: [connection],
      settings: {},
      timestamp: 1,
      recycleBin: {
        version: 1,
        policy: { mode: "forever" },
        entries: [
          {
            id: "archived",
            batchId: "batch",
            deletedAt: 1,
            connection: { ...connection, id: "archived-host" },
          },
        ],
      },
      automationLibrary: {
        version: 1,
        terminalMacros: [
          {
            id: "fixture",
            name: "Safe fixture",
            steps: [
              { command: "printf fixture", delayMs: 0, sendNewline: true },
            ],
            createdAt: "2026-09-10",
            updatedAt: "2026-09-10",
          },
        ],
      },
    };
    const prior = await reconcileRecordLedger(data);
    expect(
      Object.keys(prior.records).some((key) => key.includes("/items/")),
    ).toBe(false);
    expect(
      prior.records["$/automationLibrary/terminalMacros/@fixture"],
    ).toBeDefined();
    const changed = clone(data);
    // Replace just the live connection's references; the fixture deliberately
    // shares its original reference array with the archived connection.
    changed.connections[0] = {
      ...changed.connections[0],
      sshQuickActions: {
        version: 1,
        items: changed.connections[0].sshQuickActions.items.map((ref, index) =>
          index === 1
            ? {
                ...ref,
                scope: { kind: "database", databaseId: "destination-db" },
              }
            : ref,
        ),
      },
    };
    const next = await reconcileRecordLedger(changed, prior, write());
    expect(next.records[HOST].revision).not.toBe(prior.records[HOST].revision);
    expect(next.records["$/recycleBin/entries/@archived"]).toEqual(
      prior.records["$/recycleBin/entries/@archived"],
    );
    for (const duplicate of [
      { connections: [connection, connection] },
      { documents: { documents: [{ id: "duplicate" }, { id: "duplicate" }] } },
      {
        credentialVault: {
          entries: [{ id: "duplicate" }, { id: "duplicate" }],
        },
      },
      {
        scripts: [
          { id: "duplicate", kind: "script" },
          { id: "duplicate", kind: "script" },
        ],
      },
    ])
      await expect(reconcileRecordLedger(duplicate)).rejects.toThrow(
        "duplicate stable ID",
      );
  });
});

describe("timestamps, migration and history", () => {
  it("migrates deterministically across devices without observing their clocks", async () => {
    const data = payload();
    const first = await reconcileRecordLedger(data, undefined, {
      mode: "migrate",
      now: EARLIER,
    });
    const second = await reconcileRecordLedger(data, undefined, {
      mode: "migrate",
      now: LATER,
    });
    expect(first).toEqual(second);
    expect(first.records[HOST]).toMatchObject({
      createdAt: NOW,
      updatedAt: NOW,
      createdAtSource: "record",
      updatedAtSource: "record",
    });
    expect(first.records["$/settings/theme"]).toMatchObject({
      createdAt: NOW,
      updatedAt: NOW,
      createdAtSource: "inferred",
      updatedAtSource: "inferred",
    });
    expect(first.records[HOST].revision).toMatch(/^[a-f0-9]{64}$/);
    expect(first.records[HOST].revision).not.toBe(
      first.records["$/connections/@other"].revision,
    );
  });

  it("supports snake_case, first_trusted, offsets, legacy milliseconds and enclosing dates", async () => {
    const ledger = await reconcileRecordLedger({
      timestamp: Date.parse(NOW),
      items: [
        {
          id: "snake",
          created_at: "2024-02-29T01:00:00+01:00",
          updated_at: "2024-03-01T00:00:00.123456789Z",
        },
        { id: "trust", first_trusted: EARLIER },
        { id: "calendar", createdAt: "2026-09-10", updatedAt: "2026-09-11" },
        {
          id: "millis",
          createdAt: Date.parse(EARLIER),
          updatedAt: Date.parse(NOW),
        },
        { id: "created", createdAt: LATER },
        { id: "updated", updatedAt: EARLIER },
      ],
      enclosing: { updatedAt: EARLIER, children: [{ id: "child" }] },
    });
    expect(ledger.records["$/items/@snake"]).toMatchObject({
      createdAt: "2024-02-29T00:00:00.000Z",
      updatedAt: "2024-03-01T00:00:00.123Z",
      createdAtSource: "record",
      updatedAtSource: "record",
    });
    expect(ledger.records["$/items/@trust"]).toMatchObject({
      createdAt: EARLIER,
      createdAtSource: "record",
      updatedAt: NOW,
      updatedAtSource: "inferred",
    });
    expect(ledger.records["$/items/@calendar"]).toMatchObject({
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
      createdAtSource: "record",
      updatedAtSource: "record",
    });
    expect(ledger.records["$/items/@millis"]).toMatchObject({
      createdAt: EARLIER,
      updatedAt: NOW,
    });
    expect(ledger.records["$/items/@created"]).toMatchObject({
      createdAt: LATER,
      updatedAt: LATER,
      updatedAtSource: "inferred",
    });
    expect(ledger.records["$/items/@updated"]).toMatchObject({
      createdAt: EARLIER,
      updatedAt: EARLIER,
      createdAtSource: "inferred",
    });
    expect(ledger.records["$/enclosing/children/@child"]).toMatchObject({
      createdAt: EARLIER,
      updatedAt: EARLIER,
      createdAtSource: "inferred",
      updatedAtSource: "inferred",
    });
  });

  it("uses epoch for undated records and invalid calendar dates, never migration time", async () => {
    const ledger = await reconcileRecordLedger({
      items: [
        { id: "missing" },
        {
          id: "invalid",
          createdAt: "2023-02-29T00:00:00Z",
          updatedAt: "yesterday",
        },
        {
          id: "local",
          createdAt: "2026-10-01T12:00:00",
          updatedAt: "10/01/2026",
        },
      ],
    });
    for (const stamp of Object.values(ledger.records))
      expect(stamp).toMatchObject({
        createdAt: EPOCH,
        updatedAt: EPOCH,
        createdAtSource: "inferred",
        updatedAtSource: "inferred",
      });
    await expect(
      reconcileRecordLedger({
        connections: [{ id: "bad", createdAt: LATER, updatedAt: NOW }],
      }),
    ).rejects.toThrow("timestamps out of order");
  });

  it("creates observed write records, preserves creation, and changes only affected records", async () => {
    const data = payload();
    const prior = await reconcileRecordLedger(data, undefined, write());
    expect(prior.records[HOST]).toMatchObject({
      createdAt: LATER,
      updatedAt: LATER,
      createdAtSource: "observed",
      updatedAtSource: "observed",
    });
    data.connections[0] = {
      ...data.connections[0],
      password: "NEW_PRIVATE_PASSWORD",
      createdAt: EARLIER,
    };
    const next = await reconcileRecordLedger(data, prior, write(LATER));
    expect(next.records[HOST]).toMatchObject({
      createdAt: LATER,
      createdAtSource: "observed",
      updatedAt: "2026-10-01T12:00:00.001Z",
      updatedAtSource: "observed",
    });
    expect(next.records["$/connections/@other"]).toEqual(
      prior.records["$/connections/@other"],
    );
    expect(next.records["$/settings"]).toEqual(prior.records["$/settings"]);
    expect(next.journal.slice(0, prior.journal.length)).toEqual(prior.journal);
    expect(
      [...next.journal].reverse().find((event) => event.record === HOST),
    ).toMatchObject({
      kind: "update",
      parentRevision: prior.records[HOST].revision,
    });
    expect(JSON.stringify(next)).not.toMatch(/PRIVATE_PASSWORD/);
    expect(
      await reconcileRecordLedger(data, next, write("2030-01-01T00:00:00Z")),
    ).toEqual(next);
  });

  it("creates newly added records at now even when supplied record dates are old", async () => {
    const data = payload();
    const prior = await reconcileRecordLedger(data);
    data.connections.push({ ...data.connections[0], id: "new" });
    const next = await reconcileRecordLedger(data, prior, write());
    expect(next.records["$/connections/@new"]).toMatchObject({
      createdAt: LATER,
      updatedAt: LATER,
      createdAtSource: "observed",
      updatedAtSource: "observed",
    });
    expect(next.records[HOST]).toEqual(prior.records[HOST]);
  });

  it("advances every changed record past its prior time even with a backwards clock", async () => {
    const data = payload();
    const prior = await reconcileRecordLedger(data);
    data.connections[0].name = "Changed";
    const next = await reconcileRecordLedger(data, prior, write(EARLIER));
    expect(next.records[HOST].updatedAt).toBe("2026-09-26T00:00:00.001Z");
    data.connections[0].name = "Changed again";
    const again = await reconcileRecordLedger(data, next, write(EARLIER));
    expect(again.records[HOST].updatedAt).toBe("2026-09-26T00:00:00.002Z");
    expect(again.records[HOST].createdAt).toBe(NOW);
  });

  it("preserves tombstones and restores the creation time and complete revision chain", async () => {
    const data = payload();
    const prior = await reconcileRecordLedger(data);
    const removed = { ...data, connections: [data.connections[1]] };
    const deleted = await reconcileRecordLedger(removed, prior, write());
    expect(deleted.records[HOST]).toMatchObject({
      createdAt: NOW,
      updatedAt: LATER,
      deletedAt: LATER,
      contentHash: prior.records[HOST].contentHash,
    });
    expect(await reconcileRecordLedger(removed, deleted, write())).toEqual(
      deleted,
    );
    const restored = await reconcileRecordLedger(data, deleted, write(EARLIER));
    expect(restored.records[HOST]).toMatchObject({
      createdAt: NOW,
      createdAtSource: "record",
      updatedAt: "2026-10-01T12:00:00.001Z",
    });
    expect(restored.records[HOST]).not.toHaveProperty("deletedAt");
    const history = restored.journal.filter((event) => event.record === HOST);
    expect(history.map((event) => event.kind)).toEqual([
      "migrate",
      "delete",
      "restore",
    ]);
    expect(history[2].parentRevision).toBe(history[1].revision);
    expect(restored.journal.slice(0, deleted.journal.length)).toEqual(
      deleted.journal,
    );
    const noSettings = { connections: data.connections };
    const sectionDeleted = await reconcileRecordLedger(
      noSettings,
      restored,
      write(),
    );
    expect(sectionDeleted.records["$/settings"].deletedAt).toBeDefined();
    expect(sectionDeleted.records["$/settings/theme"].deletedAt).toBeDefined();
  });

  it("reconciles older-app edits and normalized defaults deterministically as inferred migration changes", async () => {
    const data = payload();
    const prior = await reconcileRecordLedger(data);
    const old = clone(prior);
    data.connections[0].name = "Legacy edit";
    const changed = {
      ...data,
      documents: {
        version: 1,
        documents: [],
        attachments: [],
        people: [],
        tickets: [],
      },
      recordMetadata: prior,
    };
    const first = await reconcileRecordLedger(changed, undefined, {
      mode: "migrate",
      now: EARLIER,
    });
    const second = await reconcileRecordLedger(changed, prior, {
      mode: "migrate",
      now: LATER,
    });
    expect(first).toEqual(second);
    expect(first.records[HOST]).toMatchObject({
      createdAt: NOW,
      createdAtSource: "record",
      updatedAt: "2026-09-26T00:00:00.001Z",
      updatedAtSource: "inferred",
    });
    expect(first.records["$/documents"].createdAtSource).toBe("inferred");
    expect(
      [...first.journal].reverse().find((event) => event.record === HOST),
    ).toMatchObject({
      kind: "update",
      parentRevision: prior.records[HOST].revision,
    });
    expect(first.journal.slice(0, prior.journal.length)).toEqual(prior.journal);
    expect(prior).toEqual(old);
    expect(
      await reconcileRecordLedger({ ...changed, recordMetadata: first }),
    ).toEqual(first);
    const removed = { ...data, connections: [data.connections[1]] };
    const deleted = await reconcileRecordLedger(removed, first);
    expect(deleted.records[HOST].updatedAtSource).toBe("inferred");
    const restored = await reconcileRecordLedger(data, deleted);
    expect(restored.records[HOST].updatedAtSource).toBe("inferred");
    expect(
      restored.journal
        .filter((event) => event.record === HOST)
        .map((event) => event.kind),
    ).toEqual(["migrate", "update", "delete", "restore"]);
  });

  it("preserves observed creation when migrating edits to a ledger originally written by a new app", async () => {
    const data = payload();
    const prior = await reconcileRecordLedger(data, undefined, write());
    data.settings.theme = "light";
    const migrated = await reconcileRecordLedger(data, prior);
    expect(migrated.records["$/settings/theme"]).toMatchObject({
      createdAt: LATER,
      createdAtSource: "observed",
      updatedAt: "2026-10-01T12:00:00.001Z",
      updatedAtSource: "inferred",
    });
    expect(normalizeRecordLedger(migrated)).toEqual(migrated);
  });

  it("never mutates or aliases inputs, even when they change during hashing", async () => {
    const original = freeze(payload());
    const prior = freeze(await reconcileRecordLedger(original));
    const unchanged = await reconcileRecordLedger(original, prior, write());
    expect(unchanged).toEqual(prior);
    unchanged.records[HOST].createdAt = EARLIER;
    unchanged.journal[0].timestamp = EARLIER;
    expect(prior.records[HOST].createdAt).toBe(NOW);
    expect(prior.journal[0].timestamp).toBe(NOW);
    const mutable = payload();
    const mutablePrior = clone(prior);
    const pending = reconcileRecordLedger(mutable, mutablePrior, write());
    mutable.connections[0] = {
      ...mutable.connections[0],
      password: "MUTATED_AFTER_CALL",
    };
    mutablePrior.records[HOST].createdAt = EARLIER;
    mutablePrior.journal.length = 0;
    expect(await pending).toEqual(prior);
  });
});

describe("fail-closed validation", () => {
  it("allows absent metadata but rejects corrupt and future metadata, including embedded metadata with an explicit previous", async () => {
    expect(normalizeRecordLedger(undefined)).toBeUndefined();
    const prior = await reconcileRecordLedger(payload());
    for (const malformed of [
      null,
      false,
      [],
      {},
      { ...prior, version: 2 },
      { ...prior, version: "1" },
    ]) {
      expect(() => normalizeRecordLedger(malformed)).toThrow(
        "Invalid record ledger",
      );
      await expect(
        reconcileRecordLedger(
          { ...payload(), recordMetadata: malformed },
          prior,
          write(),
        ),
      ).rejects.toThrow("Invalid record ledger");
    }
    expect(
      await reconcileRecordLedger({ ...payload(), recordMetadata: undefined }),
    ).toEqual(prior);
  });

  it("rejects lost IDs in previously identified extension collections and standalone script libraries", async () => {
    const prior = await reconcileRecordLedger({
      extension: [{ id: "one", value: "retained" }],
    });
    await expect(
      reconcileRecordLedger(
        { extension: [{ value: "retained" }] },
        prior,
        write(),
      ),
    ).rejects.toThrow("stable ID");
    for (const data of [
      { scripts: [{}] },
      { macros: [{}] },
      { terminalScripts: { customScripts: [{}] } },
    ])
      await expect(reconcileRecordLedger(data)).rejects.toThrow("stable ID");
  });

  it.each([
    ["connections", { connections: [{ name: "no ID" }] }],
    ["documents", { documents: { documents: [{}] } }],
    ["attachments", { documents: { attachments: [{}] } }],
    ["people", { documents: { people: [{}] } }],
    ["tickets", { documents: { tickets: [{}] } }],
    ["blocks", { documents: { documents: [{ id: "doc", blocks: [{}] }] } }],
    ["vault", { credentialVault: { entries: [{}] } }],
    ["mixed", { items: [{ id: "one" }, {}] }],
    ["null ID", { items: [{ id: null }] }],
    ["empty ID", { items: [{ id: " " }] }],
    ["number ID", { items: [{ id: 1 }] }],
    ["duplicate ID", { items: [{ id: "same" }, { id: "same" }] }],
    [
      "nested duplicate",
      { items: [{ id: "outer", children: [{ id: "same" }, { id: "same" }] }] },
    ],
    ["encoding", { items: [{ id: "\ud800" }] }],
  ])("rejects missing/ambiguous identities: %s", async (_label, data) => {
    await expect(reconcileRecordLedger(data)).rejects.toThrow(
      "Invalid record ledger",
    );
  });

  it("rejects unsafe JSON keys in payloads and metadata without polluting prototypes", async () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const data = JSON.parse(`{"settings":{"${key}":{"polluted":true}}}`);
      await expect(reconcileRecordLedger(data)).rejects.toThrow(
        "unsafe JSON key",
      );
      expect(() => normalizeRecordLedger(data)).toThrow("unsafe JSON key");
    }
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects non-JSON/runtime objects, cycles, accessors and serialization hooks without invoking them", async () => {
    const getter = vi.fn(() => "PRIVATE_GETTER");
    const withGetter = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: getter,
    });
    const serializer = vi.fn(() => ({}));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const extraArray = Object.assign([], { privateData: true });
    const hidden = Object.defineProperty({}, "secret", {
      value: "PRIVATE_HIDDEN",
    });
    for (const value of [
      new Date(),
      new Map(),
      new Set(),
      new Uint8Array(1),
      /runtime/,
      Promise.resolve(),
      document.createElement("div"),
      withGetter,
      { toJSON: serializer },
      circular,
      hidden,
      extraArray,
      { number: NaN },
      { number: Infinity },
      { number: 1n },
      { fn: () => {} },
      { [Symbol("secret")]: 1 },
      new Array(2),
    ])
      await expect(reconcileRecordLedger({ value })).rejects.toThrow(
        "Invalid record ledger",
      );
    expect(getter).not.toHaveBeenCalled();
    expect(serializer).not.toHaveBeenCalled();
    for (const root of [undefined, null, [], 42, "data"])
      await expect(reconcileRecordLedger(root)).rejects.toThrow(
        "Invalid record ledger",
      );
  });

  it("fails on bounded depth, record count, identity length and journal size instead of discarding metadata", async () => {
    let deep: unknown = {};
    for (let i = 0; i < 66; i++) deep = { child: deep };
    await expect(reconcileRecordLedger(deep)).rejects.toThrow(
      "complexity limit",
    );
    await expect(
      reconcileRecordLedger({
        items: Array.from({ length: 200_000 }, (_, id) => ({ id: String(id) })),
      }),
    ).rejects.toThrow("record count limit");
    await expect(
      reconcileRecordLedger({ items: [{ id: "x".repeat(513) }] }),
    ).rejects.toThrow("stable ID");
    const prior = await reconcileRecordLedger({});
    const excessive = {
      ...prior,
      journal: Array.from({ length: 1_000_001 }, () => null),
    };
    expect(() => normalizeRecordLedger(excessive)).toThrow(/limit/);
    await expect(
      reconcileRecordLedger({ recordMetadata: excessive }),
    ).rejects.toThrow(/limit/);
    expect(prior.journal).toHaveLength(1);
  });

  it("rejects malformed timestamp options and clock overflow", async () => {
    for (const now of [
      "invalid",
      "2025-02-29T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T00:00:00+00:00",
    ])
      await expect(
        reconcileRecordLedger({}, undefined, write(now)),
      ).rejects.toThrow(/timestamp/);
    const prior = await reconcileRecordLedger(
      { a: 1 },
      undefined,
      write("9999-12-31T23:59:59.999Z"),
    );
    await expect(
      reconcileRecordLedger({ a: 2 }, prior, write()),
    ).rejects.toThrow("timestamp overflow");
  });

  it("rejects inconsistent stamps, revisions, transitions and extra journal content", async () => {
    const data = payload();
    const initial = await reconcileRecordLedger(data);
    data.connections[0].name = "Edit";
    const valid = await reconcileRecordLedger(data, initial, write());
    const changeIndex =
      valid.journal.length -
      1 -
      [...valid.journal].reverse().findIndex((event) => event.record === HOST);
    const firstIndex = valid.journal.findIndex(
      (event) => event.record === HOST,
    );
    const corruptions: Array<(ledger: RecordLedger) => void> = [
      (ledger) => {
        ledger.records[HOST].createdAt = "2030-01-01T00:00:00Z";
      },
      (ledger) => {
        ledger.records[HOST].updatedAt = "2026-10-01T12:00:00+00:00";
      },
      (ledger) => {
        ledger.records[HOST].revision = "unlinked";
      },
      (ledger) => {
        ledger.records[HOST].contentHash = "not-sha256";
      },
      (ledger) => {
        ledger.records[HOST].createdAtSource = "observed";
      },
      (ledger) => {
        ledger.records[HOST].updatedAtSource = "record";
      },
      (ledger) => {
        ledger.records[HOST].deletedAt = LATER;
      },
      (ledger) => {
        delete ledger.records["$"];
      },
      (ledger) => {
        delete ledger.records["$/connections"];
      },
      (ledger) => {
        ledger.journal.splice(changeIndex, 1);
      },
      (ledger) => {
        ledger.journal[changeIndex].parentRevision = "missing";
      },
      (ledger) => {
        ledger.journal[firstIndex].parentRevision = "unexpected";
      },
      (ledger) => {
        ledger.journal[changeIndex].timestamp = NOW;
      },
      (ledger) => {
        ledger.journal[changeIndex].kind = "restore";
      },
      (ledger) => {
        ledger.journal[changeIndex].kind = "create";
      },
      (ledger) => {
        ledger.journal[changeIndex].record = "$/missing";
      },
      (ledger) => {
        ledger.journal[changeIndex].record = "$/connections/@%68ost";
      },
      (ledger) => {
        ledger.journal[changeIndex].revision =
          ledger.journal[firstIndex].revision;
      },
      (ledger) => {
        Object.assign(ledger.journal[changeIndex], {
          password: "PRIVATE_PASSWORD",
        });
      },
      (ledger) => {
        Object.assign(ledger.records[HOST], { body: data.connections[0] });
      },
      (ledger) => {
        Object.assign(ledger, { snapshots: [data] });
      },
    ];
    for (const corrupt of corruptions) {
      const broken = clone(valid);
      corrupt(broken);
      expect(() => normalizeRecordLedger(broken)).toThrow(
        "Invalid record ledger",
      );
      await expect(
        reconcileRecordLedger(data, broken, write()),
      ).rejects.toThrow("Invalid record ledger");
    }
    expect(normalizeRecordLedger(valid)).toEqual(valid);
  });
});
