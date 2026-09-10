import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAutomationCatalog,
  catalogFromFile,
  fetchAutomationCatalog,
  previewAutomationCatalog,
  applyAutomationCatalogPreview,
  discardAutomationCatalogPreview,
  exportAutomationCatalog,
  MAX_AUTOMATION_CATALOG_BYTES,
} from "../../src/utils/recording/automationCatalog";
import type {
  AutomationEntry,
  AutomationFamily,
  AutomationLibraryApi,
  AutomationLibraryChange,
  AutomationLibrarySnapshot,
} from "../../src/types/recording/automationLibrary";
import { normalizeAutomationEntry } from "../../src/utils/recording/automationLibraryValidation";
const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
const timestamp = "2026-09-10T10:00:00Z";
const metadata = {
  id: "fixture",
  name: "Fixture",
  description: "Test only",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const entries: AutomationEntry[] = [
  {
    family: "terminal-script",
    payload: {
      ...metadata,
      script: "printf 'hello'",
      language: "sh",
      category: "System",
      osTags: ["linux"],
    },
  },
  {
    family: "terminal-macro",
    payload: {
      ...metadata,
      steps: [{ command: "uname -a", delayMs: 100, sendNewline: true }],
    },
  },
  {
    family: "website-script",
    payload: { ...metadata, kind: "script", code: "document.title" },
  },
  {
    family: "website-macro",
    payload: {
      ...metadata,
      kind: "macro",
      steps: [{ kind: "fill", selector: "html > body > input:nth-of-type(1)" }],
    },
  },
];
const pack = () =>
  JSON.parse(exportAutomationCatalog({ name: "Fixture pack", entries }));
const snapshot = (
  family: AutomationFamily,
  current: AutomationEntry[] = [],
): AutomationLibrarySnapshot => ({
  scope: { kind: "database", databaseId: "database-a" },
  family,
  receipt: "owned-receipt",
  entries: current,
});
beforeEach(() => h.invoke.mockReset());
describe("bounded portable automation catalogs", () => {
  it("the documented synthetic index is accepted by the real portable and storage validators", () => {
    const example = parseAutomationCatalog(
      readFileSync("docs/examples/automation-index.json", "utf8"),
    );
    expect(example.entries).toHaveLength(1);
    const item = example.entries[0];
    expect(
      normalizeAutomationEntry({ family: item.kind, payload: item.payload })
        .payload.id,
    ).toBe("synthetic-uname");
  });
  it("every parsed family imports through the real shared validator, including empty descriptions", async () => {
    const raw = pack();
    for (const entry of raw.entries) entry.description = "";
    const document = await catalogFromFile(JSON.stringify(raw));
    for (const entry of document.manifest.entries) {
      expect(
        normalizeAutomationEntry({
          family: entry.kind,
          payload: entry.payload,
        }),
      ).toEqual({ family: entry.kind, payload: entry.payload });
      const apply = vi.fn(
        async (
          _snapshot: AutomationLibrarySnapshot,
          changes: readonly AutomationLibraryChange[],
        ) => {
          for (const change of changes) {
            if (change.operation === "put")
              expect(normalizeAutomationEntry(change.entry)).toEqual(
                change.entry,
              );
          }
          return snapshot(entry.kind);
        },
      );
      const preview = previewAutomationCatalog(
        document,
        [entry.id],
        snapshot(entry.kind),
      );
      await applyAutomationCatalogPreview(
        { apply } as unknown as AutomationLibraryApi,
        preview,
        { [entry.id]: "copy" },
      );
      expect(apply).toHaveBeenCalledOnce();
    }
    raw.entries[0].provenance = { description: "" };
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow();
    raw.entries[0].provenance = {
      sourceUrl: `https://example.com/${"a".repeat(2048)}`,
    };
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow();
  });
  it("roundtrips all four native payload types and preserves website value-free steps", () => {
    const parsed = parseAutomationCatalog(
      exportAutomationCatalog({ name: "Four families", entries }),
    );
    expect(
      parsed.entries.map((entry) => ({
        family: entry.kind,
        payload: entry.payload,
      })),
    ).toEqual(entries);
    expect(parsed.entries[3].payload).not.toHaveProperty("script");
    expect(parsed.entries[3].payload).not.toHaveProperty("code");
  });
  it("preserves informational provenance on export without granting official status", () => {
    const exported = exportAutomationCatalog({
      name: "History",
      entries: [
        {
          ...entries[0],
          provenance: {
            publisher: "Claimed publisher",
            sourceUrl: "https://example.com/index.json",
            sourceSha256: "a".repeat(64),
            license: "MIT",
          },
        },
      ],
    });
    expect(
      parseAutomationCatalog(exported).entries[0].provenance,
    ).toMatchObject({ publisher: "Claimed publisher", license: "MIT" });
    const raw = JSON.parse(exported);
    raw.entries[0].provenance.official = true;
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow();
    delete raw.entries[0].provenance.official;
    raw.publisher = { name: "Self-claimed", verified: true };
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow();
  });
  it("rejects unknown formats, duplicate family IDs, malformed metadata and oversize manifests", () => {
    const raw = pack();
    raw.entries.push(raw.entries[0]);
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow(
      /Duplicate/,
    );
    expect(() =>
      parseAutomationCatalog(" ".repeat(MAX_AUTOMATION_CATALOG_BYTES + 1)),
    ).toThrow(/2 MiB/);
    raw.entries = Array.from({ length: 129 }, () => pack().entries[0]);
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow(/128/);
    expect(() =>
      parseAutomationCatalog('{"format":"other","version":1}'),
    ).toThrow(/format/);
  });
  it("enforces native family shapes, UTF-8 source bounds, and no stored website fill values", () => {
    for (const mutate of [
      (raw: ReturnType<typeof pack>) => {
        raw.entries[0].payload.language = "invented-shell";
      },
      (raw: ReturnType<typeof pack>) => {
        raw.entries[0].payload.script = "é".repeat(32769);
      },
      (raw: ReturnType<typeof pack>) => {
        raw.entries[1].payload.steps[0].delayMs = -1;
      },
      (raw: ReturnType<typeof pack>) => {
        raw.entries[1].payload.steps = Array.from({ length: 201 }, () => ({
          command: "echo x",
          delayMs: 0,
          sendNewline: true,
        }));
      },
      (raw: ReturnType<typeof pack>) => {
        raw.entries[3].payload.steps[0].value = "must-not-persist";
      },
      (raw: ReturnType<typeof pack>) => {
        raw.entries[2].kind = "website-macro";
      },
    ]) {
      const raw = pack();
      mutate(raw);
      expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow();
    }
  });
  it("does not include rejected secret-bearing input in errors", () => {
    const raw = pack();
    raw.entries[0].payload.script = 'password="fixture-secret-value"';
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow(
      /literal credentials/,
    );
    try {
      parseAutomationCatalog(JSON.stringify(raw));
    } catch (error) {
      expect(String(error)).not.toContain("fixture-secret-value");
    }
    raw.entries[0].payload.script = "echo harmless";
    raw.entries[1].payload.steps[0].command = 'password="fixture-secret-value"';
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow(
      /credentials/,
    );
  });
  it.each([
    "https://user:pass@example.com/a",
    "https://example.com/a?token=private",
    "https://example.com/a#private",
    "http://example.com/a",
  ])("rejects portable provenance URL %s", (url) => {
    const raw = pack();
    raw.repository = { url, ref: "main", path: "scripts/index.json" };
    expect(() => parseAutomationCatalog(JSON.stringify(raw))).toThrow();
  });
  it("manual native refresh verifies exact body hash and source, without library writes", async () => {
    const body = exportAutomationCatalog({ name: "Remote", entries });
    const file = await catalogFromFile(body);
    h.invoke.mockResolvedValue({
      url: "https://example.com/index.json",
      body,
      sha256: file.source.sha256,
      fetchedAt: timestamp,
    });
    const result = await fetchAutomationCatalog(
      "https://example.com/index.json",
    );
    expect(result.source).toMatchObject({
      kind: "remote",
      sha256: file.source.sha256,
    });
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("script_catalog_fetch", {
      url: "https://example.com/index.json",
    });
    h.invoke.mockResolvedValue({
      url: "https://example.com/index.json",
      body,
      sha256: "0".repeat(64),
      fetchedAt: timestamp,
    });
    await expect(
      fetchAutomationCatalog("https://example.com/index.json"),
    ).rejects.toThrow(/integrity/);
  });
  it("requires reviewed choices and imports copies with new IDs into the original snapshot", async () => {
    const document = await catalogFromFile(
      exportAutomationCatalog({ name: "Copies", entries }),
    );
    const original = snapshot("terminal-script", [entries[0]]);
    const preview = previewAutomationCatalog(document, ["fixture"], original);
    const apply = vi.fn(
      async (
        _snapshot: AutomationLibrarySnapshot,
        _changes: readonly AutomationLibraryChange[],
      ) => original,
    );
    const api = { read: vi.fn(), apply } as AutomationLibraryApi;
    await expect(
      applyAutomationCatalogPreview(api, preview, {}),
    ).rejects.toThrow(/Choose/);
    preview.snapshot.scope = { kind: "database", databaseId: "database-b" };
    document.manifest.entries[0].payload.name = "Mutated after review";
    await applyAutomationCatalogPreview(api, preview, { fixture: "copy" });
    expect(apply.mock.calls[0][0]).toEqual(original);
    const change = apply.mock.calls[0][1][0];
    if (change.operation !== "put") throw new Error("Expected reviewed put");
    expect(change.entry.payload.id).not.toBe("fixture");
    expect(change.entry.payload.name).toBe("Fixture");
    expect(change.entry.provenance?.sourceSha256).toBe(document.source.sha256);
    await expect(
      applyAutomationCatalogPreview(api, preview, { fixture: "copy" }),
    ).rejects.toThrow(/expired/);
  });
  it("replace carries exact expected entry; default IDs and discarded reviews cannot overwrite", async () => {
    const document = await catalogFromFile(
      exportAutomationCatalog({ name: "Replace", entries }),
    );
    const original = snapshot("website-script", [entries[2]]);
    const apply = vi.fn(
      async (
        _snapshot: AutomationLibrarySnapshot,
        _changes: readonly AutomationLibraryChange[],
      ) => original,
    );
    const api = { read: vi.fn(), apply } as AutomationLibraryApi;
    const review = previewAutomationCatalog(document, ["fixture"], original);
    await applyAutomationCatalogPreview(api, review, { fixture: "replace" });
    expect(apply.mock.calls[0][1][0]).toMatchObject({
      operation: "put",
      expected: entries[2],
    });
    const expired = previewAutomationCatalog(document, ["fixture"], original);
    discardAutomationCatalogPreview(expired);
    await expect(
      applyAutomationCatalogPreview(api, expired, { fixture: "copy" }),
    ).rejects.toThrow(/expired/);
    document.manifest.entries[0].id = "default-1";
    document.manifest.entries[0].payload.id = "default-1";
    const builtin = {
      ...entries[0],
      payload: { ...entries[0].payload, id: "default-1" },
    } as AutomationEntry;
    const defaults = previewAutomationCatalog(
      document,
      ["default-1"],
      snapshot("terminal-script", [builtin]),
    );
    expect(defaults.rows[0].canReplace).toBe(false);
    await expect(
      applyAutomationCatalogPreview(api, defaults, { "default-1": "replace" }),
    ).rejects.toThrow(/copy/);
  });
});
