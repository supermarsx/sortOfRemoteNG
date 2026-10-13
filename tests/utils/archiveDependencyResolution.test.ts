import { describe, expect, it, vi } from "vitest";
import {
  connection,
  fullData,
  collection,
} from "../fixtures/fullDatabaseArchive";
import {
  prepareArchiveDependencyRepair,
  applyArchiveDependencyRepair,
} from "../../src/utils/connection/archiveDependencyResolution";

describe("archive dependency resolution", () => {
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
    data.connections[1].sshQuickActions!.items = [
      { kind: "script", id: source.id },
    ];
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
    data.connections[1].sshQuickActions!.items.push({
      kind: "macro",
      id: "missing",
    });
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
