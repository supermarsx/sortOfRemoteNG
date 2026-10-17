import { describe, expect, it, vi } from "vitest";
import {
  connection,
  fullData,
  collection,
  NOW,
} from "../fixtures/fullDatabaseArchive";
import {
  prepareArchiveDependencyRepair,
  applyArchiveDependencyRepair,
  repairSafeArchiveDependencies,
} from "../../src/utils/connection/archiveDependencyResolution";
import type {
  AutomationEntry,
  AutomationFamily,
  AutomationScope,
} from "../../src/types/recording/automationLibrary";
import { inspectDatabaseArchiveDependencies } from "../../src/utils/connection/fullDatabaseArchive";
import { formatArchiveDependencyDiagnostics } from "../../src/utils/connection/archiveDependencyDiagnostics";

function externalEntry(family: AutomationFamily): AutomationEntry {
  const metadata = {
    id: "external-action",
    name: "External action",
    description: "Fixture action",
    createdAt: NOW,
    updatedAt: NOW,
  };
  if (family === "terminal-script")
    return {
      family,
      payload: {
        ...metadata,
        script: "uptime",
        language: "bash",
        category: "Test",
        osTags: ["linux"],
      },
    };
  if (family === "terminal-macro")
    return {
      family,
      payload: {
        ...metadata,
        steps: [{ command: "uptime", delayMs: 0, sendNewline: true }],
      },
    };
  if (family === "website-script")
    return {
      family,
      payload: { ...metadata, kind: "script", code: "document.title" },
    };
  return {
    family,
    payload: {
      ...metadata,
      kind: "macro",
      steps: [
        { kind: "click", selector: "html > body > button:nth-of-type(1)" },
      ],
    },
  };
}

describe("archive dependency resolution", () => {
  it("persists only reference and library changes without materializing omitted archive defaults", async () => {
    const data = await fullData();
    delete data.databaseSettings;
    delete data.colorTags;
    delete data.documents;
    delete data.recycleBin;
    data.connections[1].sshQuickActions = {
      version: 1,
      items: [{ kind: "script", id: "external-action" }],
    };
    const before = structuredClone(data);
    const result = await repairSafeArchiveDependencies(
      collection.id,
      data,
      async () => externalEntry("terminal-script"),
    );
    expect(result.repaired).toBe(1);
    expect(Object.keys(result.data)).toEqual(Object.keys(before));
    const actual = structuredClone(result.data);
    actual.automationLibrary = before.automationLibrary;
    actual.connections[1].sshQuickActions =
      before.connections[1].sshQuickActions;
    expect(actual).toEqual(before);
    expect(data).toEqual(before);
  });

  it.each([
    "terminal-script",
    "terminal-macro",
    "website-script",
    "website-macro",
  ] as const)(
    "automatically copies a readable %s once, preserving source, credentials and trust",
    async (family) => {
      const data = await fullData();
      const entry = externalEntry(family);
      entry.provenance = { publisher: "Fixture publisher" };
      const field = family.startsWith("terminal-")
        ? "sshQuickActions"
        : "httpAutomation";
      const scope = { kind: "database" as const, databaseId: "other-db" };
      const config = {
        version: 1,
        items: [
          {
            kind: family.endsWith("script") ? "script" : "macro",
            id: entry.payload.id,
            scope,
          },
        ],
      } as const;
      if (field === "sshQuickActions")
        data.connections[1].sshQuickActions = {
          ...config,
          items: [...config.items],
        };
      else
        data.connections[1].httpAutomation = {
          ...config,
          items: [...config.items],
          interactionMacrosEnabled: false,
          scriptInjectionEnabled: false,
          forceDark: false,
        };
      const before = structuredClone(data);
      const sourceBefore = structuredClone(entry);
      const read = vi.fn().mockResolvedValue(entry);
      const result = await repairSafeArchiveDependencies(
        collection.id,
        data,
        read,
      );
      expect(result.repaired).toBe(1);
      expect(result.remaining.totalIssues).toBe(0);
      expect(read).toHaveBeenCalledExactlyOnceWith(
        scope,
        family,
        entry.payload.id,
      );
      const ref = result.data.connections[1][field]!.items[0];
      expect(ref.id).not.toBe(entry.payload.id);
      expect(ref.scope).toEqual({
        kind: "database",
        databaseId: collection.id,
      });
      expect(
        result.data.automationLibrary!.provenance[`${family}:${ref.id}`],
      ).toEqual(entry.provenance);
      expect(
        result.data.connections.map((row) => row.credentialSource),
      ).toEqual(before.connections.map((row) => row.credentialSource));
      expect(result.data.credentialVault).toEqual(before.credentialVault);
      expect(result.data.settings).toEqual(before.settings);
      expect(result.data.recycleBin).toEqual(before.recycleBin);
      expect(data).toEqual(before);
      expect(entry).toEqual(sourceBefore);

      read.mockClear();
      const again = await repairSafeArchiveDependencies(
        collection.id,
        result.data,
        read,
      );
      expect(again.repaired).toBe(0);
      expect(again.data).toEqual(result.data);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("does not rebind a recycled alias when repairing the live owner", async () => {
    const data = await fullData();
    const shared = data.connections[1].sshQuickActions!;
    expect(data.recycleBin!.entries[0].connection.sshQuickActions).toBe(shared);
    shared.items = [{ kind: "script", id: "external-action" }];
    const recycledBefore = structuredClone(data.recycleBin);
    const read = vi.fn().mockResolvedValue(externalEntry("terminal-script"));
    const result = await repairSafeArchiveDependencies(
      collection.id,
      data,
      read,
    );
    expect(result.repaired).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.data.connections[1].sshQuickActions!.items[0].scope).toEqual({
      kind: "database",
      databaseId: collection.id,
    });
    expect(result.data.recycleBin).toEqual(recycledBefore);
    expect(result.remaining.issues).toEqual([
      expect.objectContaining({
        reason: "external-script",
        recordId: "archived",
      }),
    ]);
  });

  it("distinguishes identical IDs in different source scopes and rebinds raw duplicates without removing them", async () => {
    const data = await fullData();
    data.connections[1].sshQuickActions = {
      version: 1,
      items: [
        { kind: "script", id: "external-action" },
        { kind: "script", id: "external-action", scope: { kind: "app" } },
        {
          kind: "script",
          id: "external-action",
          scope: { kind: "database", databaseId: "foreign" },
        },
      ],
    };
    const read = vi.fn(async (scope: AutomationScope) => {
      const entry = externalEntry("terminal-script");
      if (entry.family !== "terminal-script") throw new Error("fixture");
      entry.payload.script = scope.kind === "app" ? "uptime" : "whoami";
      return entry;
    });
    const result = await repairSafeArchiveDependencies(
      collection.id,
      data,
      read,
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.repaired).toBe(2);
    expect(result.remaining.totalIssues).toBe(0);
    const refs = result.data.connections[1].sshQuickActions!.items;
    expect(refs).toHaveLength(3);
    expect(refs[0].id).toBe(refs[1].id);
    expect(refs[2].id).not.toBe(refs[0].id);
    expect(
      refs.every(
        (ref) =>
          ref.scope?.kind === "database" &&
          ref.scope.databaseId === collection.id,
      ),
    ).toBe(true);
  });

  it("does not reuse a script with different execution metadata even when its text matches", async () => {
    const data = await fullData();
    const original = data.automationLibrary!.terminalScripts.customScripts[0];
    const entry: AutomationEntry<"terminal-script"> = {
      family: "terminal-script",
      payload: { ...original, id: "external-action", language: "sh" },
    };
    data.connections[1].sshQuickActions = {
      version: 1,
      items: [{ kind: "script", id: entry.payload.id }],
    };
    const result = await repairSafeArchiveDependencies(
      collection.id,
      data,
      async () => entry,
    );
    const ref = result.data.connections[1].sshQuickActions!.items[0];
    expect(ref.id).not.toBe(original.id);
    expect(
      result.data.automationLibrary!.terminalScripts.customScripts.find(
        (script) => script.id === ref.id,
      )?.language,
    ).toBe("sh");
    expect(original.language).toBe("bash");
  });

  it("uses the reviewed source snapshot even if the caller mutates its entry later", async () => {
    const data = await fullData();
    const entry = externalEntry("terminal-macro");
    data.connections[1].sshQuickActions = {
      version: 1,
      items: [{ kind: "macro", id: entry.payload.id }],
    };
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => entry,
    );
    if (entry.family !== "terminal-macro") throw new Error("fixture");
    entry.payload.steps[0].command = "changed after review";
    const result = applyArchiveDependencyRepair(
      review,
      review.issues.filter((row) => row.safe).map((row) => row.id),
    );
    expect(
      result.data.automationLibrary!.terminalMacros[0].steps[0].command,
    ).toBe("uptime");
  });

  it("does not automatically delete missing references, alter organization or credentials, or read recycled sources", async () => {
    const data = await fullData();
    data.connections[1].parentId = "missing-folder";
    data.connections[1].defaultTabGroupId = "missing-group";
    data.connections[1].sshQuickActions!.items.push({
      kind: "macro",
      id: "missing",
      scope: { kind: "database", databaseId: collection.id },
    });
    data.connections[1].scripts = { onConnect: ["legacy-script"] };
    data.recycleBin!.entries[0].connection.sshQuickActions = {
      version: 1,
      items: [{ kind: "script", id: "recycled-only" }],
    };
    const credentials = data.connections[1].credentialSource;
    if (credentials?.kind !== "vault") throw new Error("fixture");
    credentials.totpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const before = structuredClone(data);
    const read = vi.fn();
    const result = await repairSafeArchiveDependencies(
      collection.id,
      data,
      read,
    );
    expect(result.repaired).toBe(0);
    expect(result.remaining.totalIssues).toBeGreaterThan(0);
    expect(result.data).toEqual(before);
    expect(data).toEqual(before);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "wrong-family", "wrong-id", "invalid-payload"])(
    "preserves an external action when the source is %s",
    async (problem) => {
      const data = await fullData();
      data.connections[1].sshQuickActions = {
        version: 1,
        items: [{ kind: "script", id: "external-action" }],
      };
      const entry = externalEntry(
        problem === "wrong-family" ? "website-script" : "terminal-script",
      );
      if (problem === "wrong-id") entry.payload.id = "different-action";
      if (problem === "invalid-payload") entry.payload.name = "";
      const before = structuredClone(data);
      const read = vi.fn(async () => {
        if (problem === "unavailable") throw new Error("unavailable source");
        return entry;
      });
      const result = await repairSafeArchiveDependencies(
        collection.id,
        data,
        read,
      );
      expect(result.repaired).toBe(0);
      expect(result.remaining.totalIssues).toBe(1);
      expect(result.data).toEqual(before);
    },
  );

  it("keeps cyclic relationships manual and refuses a nested tab-group repair that would clear another setting", async () => {
    const data = await fullData();
    data.tabGroups = [{ id: "kept-group", name: "Kept", color: "#123456" }];
    data.connections[0].parentId = data.connections[0].id;
    const row = data.connections[1] as (typeof data.connections)[number] & {
      importedMetadata: { defaultTabGroupId: string };
    };
    row.defaultTabGroupId = data.tabGroups![0].id;
    row.importedMetadata = { defaultTabGroupId: "missing-nested" };
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => undefined,
    );
    expect(
      review.issues.find((issue) => issue.issue.reason === "cycle")?.safe,
    ).toBe(false);
    const nested = review.issues.find(
      (issue) => issue.issue.reason === "tab-group",
    )!;
    expect(nested.action).toBe("manual");
    expect(nested.safe).toBe(false);
    expect(() => applyArchiveDependencyRepair(review, [nested.id])).toThrow(
      "Unknown dependency repair choice",
    );
    expect(
      applyArchiveDependencyRepair(review, []).data.connections[1]
        .defaultTabGroupId,
    ).toBe(row.defaultTabGroupId);
  });

  it("keeps additional capped dependency issues visible after a bounded automatic pass", async () => {
    const data = await fullData();
    data.connections[1].sshQuickActions = {
      version: 1,
      items: Array.from({ length: 15 }, (_, index) => ({
        kind: "script" as const,
        id: `unavailable-${index}`,
      })),
    };
    const result = await repairSafeArchiveDependencies(
      collection.id,
      data,
      async () => undefined,
    );
    expect(result.repaired).toBe(0);
    expect(result.remaining.totalIssues).toBe(15);
    expect(result.remaining.issues).toHaveLength(12);
  });

  it("finds readable actions behind twelve manual issues while keeping displayed diagnostics capped", async () => {
    const data = await fullData();
    for (let i = 0; i < 12; i++)
      data.connections.unshift({
        ...connection(`manual-${i}`),
        parentId: "absent-folder",
      });
    data.connections.push({
      ...connection("copy-owner"),
      sshQuickActions: {
        version: 1,
        items: [{ kind: "script", id: "external-action" }],
      },
    });
    const before = structuredClone(data);
    const ordinary = inspectDatabaseArchiveDependencies(collection.id, data);
    expect(ordinary.totalIssues).toBe(13);
    expect(ordinary.issues).toHaveLength(12);
    const extended = inspectDatabaseArchiveDependencies(collection.id, data, {
      maximumIssues: 4096,
    });
    expect(extended.issues).toHaveLength(13);
    const text = formatArchiveDependencyDiagnostics(extended);
    expect(text).toContain("1 more issues.");
    expect(text).not.toContain("13. ");
    expect(() =>
      inspectDatabaseArchiveDependencies(collection.id, data, {
        maximumIssues: 4097,
      }),
    ).toThrow("Invalid archive dependency diagnostic limit");
    const result = await repairSafeArchiveDependencies(
      collection.id,
      data,
      async () => externalEntry("terminal-script"),
    );
    expect(result.repaired).toBe(1);
    expect(result.remaining.totalIssues).toBe(12);
    expect(result.remaining.issues).toHaveLength(12);
    expect(result.data.connections.slice(0, 12)).toEqual(
      before.connections.slice(0, 12),
    );
  });

  it("maps normalized diagnostic indices back to stored actions after a partial deduplicating repair", async () => {
    const data = await fullData();
    data.connections[1].sshQuickActions = {
      version: 1,
      items: Array.from({ length: 15 }, (_, i) => ({
        kind: "script" as const,
        id: `source-${i}`,
      })),
    };
    const read = vi.fn(
      async (
        _scope: AutomationScope,
        _family: AutomationFamily,
        id: string,
      ): Promise<AutomationEntry> => {
        const entry = externalEntry("terminal-script");
        entry.payload.id = id;
        return entry;
      },
    );
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      read,
    );
    expect(review.issues).toHaveLength(12);
    const partial = applyArchiveDependencyRepair(
      review,
      review.issues.filter((row) => row.safe).map((row) => row.id),
    );
    expect(partial.remaining.totalIssues).toBe(3);
    const result = await repairSafeArchiveDependencies(
      collection.id,
      partial.data,
      read,
    );
    expect(result.repaired).toBe(3);
    expect(result.remaining.totalIssues).toBe(0);
    expect(result.data.connections[1].sshQuickActions!.items).toHaveLength(15);
    expect(
      result.data.connections[1].sshQuickActions!.items.every(
        (ref) =>
          ref.scope?.kind === "database" &&
          ref.scope.databaseId === collection.id,
      ),
    ).toBe(true);
    expect(
      result.data.automationLibrary!.terminalScripts.customScripts,
    ).toHaveLength(2);
  });

  it.each(["document", "external-document", "cell"])(
    "offers explicit removal of a broken %s link without losing neighboring document content",
    async (kind) => {
      const data = await fullData();
      const block = data.documents!.documents[0].blocks[2];
      if (block.type !== "reference") throw new Error("fixture");
      block.reference =
        kind === "cell"
          ? {
              databaseId: collection.id,
              kind: "cell",
              id: "document",
              blockId: "absent",
              sheetId: "absent",
              address: "A1",
            }
          : {
              databaseId:
                kind === "external-document" ? "other-db" : collection.id,
              kind: "document",
              id: "absent",
            };
      const review = await prepareArchiveDependencyRepair(
        collection.id,
        data,
        async () => undefined,
      );
      const issue = review.issues.find((row) => row.issue.reason === kind)!;
      expect(issue.action).toBe("remove-reference");
      expect(issue.safe).toBe(false);
      const fixed = applyArchiveDependencyRepair(review, [issue.id]);
      expect(fixed.data.documents!.documents[0].blocks[0]).toEqual(
        data.documents!.documents[0].blocks[0],
      );
      expect(fixed.remaining.totalIssues).toBe(0);
    },
  );

  it("moves a document with a missing parent to the root without deleting it", async () => {
    const data = await fullData();
    data.documents!.documents[0].parentFolderId = "absent";
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => undefined,
    );
    const issue = review.issues.find((row) => row.issue.reason === "folder")!;
    expect(issue.safe).toBe(true);
    const fixed = applyArchiveDependencyRepair(review, [issue.id]);
    expect(fixed.data.documents!.documents[0].parentFolderId).toBeNull();
    expect(fixed.remaining.totalIssues).toBe(0);
  });

  it("detaches a missing TOTP selection only after an explicit choice, preserving its credential", async () => {
    const data = await fullData();
    const source = data.connections[1].credentialSource!;
    if (source.kind !== "vault") throw new Error("fixture");
    source.totpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => undefined,
    );
    const issue = review.issues.find((row) => row.issue.reason === "totp")!;
    expect(issue.action).toBe("remove-reference");
    expect(issue.safe).toBe(false);
    const fixed = applyArchiveDependencyRepair(review, [issue.id]);
    expect(fixed.data.connections[1].credentialSource).toEqual({
      kind: "vault",
      credentialId: source.credentialId,
    });
    expect(fixed.data.credentialVault).toEqual(data.credentialVault);
  });

  it("removes legacy lifecycle script references explicitly and leaves route configuration intact", async () => {
    const data = await fullData();
    data.connections[1].scripts = {
      onConnect: ["app-script"],
      onDisconnect: ["another-script"],
    };
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => undefined,
    );
    const issue = review.issues.find(
      (row) => row.issue.reason === "legacy-script",
    )!;
    expect(issue.action).toBe("remove-reference");
    expect(issue.safe).toBe(false);
    const fixed = applyArchiveDependencyRepair(review, [issue.id]);
    expect(fixed.data.connections[1].scripts).toBeUndefined();
    expect(fixed.data.connections[2].security).toEqual(
      data.connections[2].security,
    );
  });
  it("copies an app-wide quick action into its owning database without changing its source", async () => {
    const data = await fullData();
    const source = structuredClone(
      data.automationLibrary!.terminalScripts.customScripts[0],
    );
    source.id = "7ab9d8a5-7d1d-4772-afae-d74d15f31c1b";
    data.connections.push({
      ...connection("bc3ca39f-ce50-48a8-a0a9-72cf3577331b"),
      sshQuickActions: {
        version: 1,
        items: [{ kind: "script", id: source.id }],
      },
    });
    const before = structuredClone(data);
    const read = vi
      .fn()
      .mockResolvedValue({ family: "terminal-script", payload: source });
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      read,
    );
    const fix = review.issues.find(
      (row) => row.issue.recordId === "bc3ca39f-ce50-48a8-a0a9-72cf3577331b",
    )!;
    const result = applyArchiveDependencyRepair(review, [fix.id]);
    expect(
      result.data.connections[result.data.connections.length - 1]
        .sshQuickActions!.items[0],
    ).toEqual({
      kind: "script",
      id: "script",
      scope: { kind: "database", databaseId: collection.id },
    });
    expect(
      result.data.automationLibrary!.terminalScripts.customScripts,
    ).toHaveLength(1);
    expect(data).toEqual(before);
    expect(source.id).toBe("7ab9d8a5-7d1d-4772-afae-d74d15f31c1b");
  });

  it("deduplicates names and creates a fresh identity for changed content", async () => {
    const data = await fullData();
    const source = {
      ...data.automationLibrary!.terminalScripts.customScripts[0],
      script: "uptime",
    };
    data.connections[1].sshQuickActions = {
      version: 1,
      items: [{ kind: "script", id: source.id }],
    };
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => ({ family: "terminal-script", payload: source }),
    );
    const result = applyArchiveDependencyRepair(
      review,
      review.issues.filter((row) => row.safe).map((row) => row.id),
    );
    const copied =
      result.data.automationLibrary!.terminalScripts.customScripts[1];
    expect(copied.id).not.toBe(source.id);
    expect(copied.name).toBe("Check host (2)");
    expect(result.data.connections[1].sshQuickActions!.items[0].id).toBe(
      copied.id,
    );
    expect(result.remaining.totalIssues).toBe(0);
  });

  it("does not remove an unavailable script during Fix all safe issues", async () => {
    const data = await fullData();
    data.connections[1].sshQuickActions = {
      version: 1,
      items: [
        ...data.connections[1].sshQuickActions!.items,
        { kind: "macro", id: "missing" },
      ],
    };
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => undefined,
    );
    const row = review.issues[0];
    expect(row.safe).toBe(false);
    expect(row.action).toBe("remove-reference");
    expect(applyArchiveDependencyRepair(review, []).data).toEqual(review.data);
    expect(
      applyArchiveDependencyRepair(review, [row.id]).remaining.totalIssues,
    ).toBe(0);
  });

  it("requires an explicit restore-and-fix choice for a recycled connection", async () => {
    const data = await fullData();
    const recycled = data.recycleBin!.entries[0].connection;
    recycled.sshQuickActions = {
      version: 1,
      items: [{ kind: "script", id: "missing" }],
    };
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => undefined,
    );
    const row = review.issues.find(
      (item) => item.issue.recordId === recycled.id,
    )!;
    expect(row.safe).toBe(false);
    const result = applyArchiveDependencyRepair(review, [row.id]);
    expect(result.data.recycleBin!.entries).toHaveLength(0);
    expect(
      result.data.connections.find((item) => item.id === recycled.id)!
        .sshQuickActions!.items,
    ).toEqual([]);
    const detached = applyArchiveDependencyRepair(review, [row.id], {
      restoreRecycled: false,
    });
    expect(detached.data.recycleBin!.entries).toHaveLength(1);
    expect(
      detached.data.recycleBin!.entries[0].connection.sshQuickActions!.items,
    ).toEqual([]);
    expect(
      detached.data.connections.some((item) => item.id === recycled.id),
    ).toBe(false);
  });

  it("fails atomically when the review is altered or a choice is unknown", async () => {
    const data = await fullData();
    const review = await prepareArchiveDependencyRepair(
      collection.id,
      data,
      async () => undefined,
    );
    expect(() => applyArchiveDependencyRepair(review, ["unknown"])).toThrow();
    review.data.connections[0].name = "altered";
    expect(() => applyArchiveDependencyRepair(review, [])).toThrow();
  });
});
