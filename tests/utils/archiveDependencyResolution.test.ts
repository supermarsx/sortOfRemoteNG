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
