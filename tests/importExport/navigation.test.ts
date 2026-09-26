import { describe, expect, it } from "vitest";
import {
  createImportExportSession,
  createToolSession,
} from "../../src/components/app/toolSession";

describe("database tool navigation", () => {
  it("carries explicit locked/bulk IDs and encryption choice without database data", () => {
    const source = createToolSession("database");
    const target = createImportExportSession(
      {
        tab: "export",
        format: "json",
        databaseIds: ["locked", "side", "locked"],
        encrypted: true,
      },
      source,
    );
    expect(target.protocol).toBe("tool:importExport");
    expect(target.importExportNavigation).toEqual({
      tab: "export",
      format: "json",
      databaseIds: ["locked", "side"],
      encrypted: true,
      requestId: expect.any(String),
    });
    expect(target).not.toHaveProperty("password");
    expect(target).not.toHaveProperty("connections");
  });

  it("reuses the same window's tool with a new navigation request", () => {
    const source = {
      ...createToolSession("database"),
      layout: {
        isDetached: true,
        windowId: "child",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 1,
      },
    };
    const first = createImportExportSession(
      { tab: "import", format: "json" },
      source,
    );
    const second = createImportExportSession(
      { tab: "export", format: "json", databaseIds: ["side"] },
      source,
      first,
    );
    expect(second.id).toBe(first.id);
    expect(second.layout).toEqual(source.layout);
    expect(second.importExportNavigation?.requestId).not.toBe(
      first.importExportNavigation?.requestId,
    );
  });
});
