import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

const deleteHandlerStart = appSource.indexOf(
  "const handleDeleteConnection = (connection: Connection) => {",
);
const deleteHandlerEnd = appSource.indexOf(
  "const handleOpenSettings = useCallback",
  deleteHandlerStart,
);
const deleteHandlerSource = appSource.slice(
  deleteHandlerStart,
  deleteHandlerEnd,
);

describe("normal tree connection deletion policy wiring", () => {
  it("uses only confirmDeleteConnection and never overloads close warnings", () => {
    expect(deleteHandlerStart).toBeGreaterThan(-1);
    expect(deleteHandlerEnd).toBeGreaterThan(deleteHandlerStart);
    expect(deleteHandlerSource).toMatch(
      /resolveConnectionDeleteConfirmation\(\s*settings\.confirmDeleteConnection/,
    );
    expect(deleteHandlerSource).not.toContain("connection.warnOnClose");
    expect(deleteHandlerSource).not.toContain("settings.warnOnClose");
    expect(deleteHandlerSource).toContain(
      "const confirmMessage = shouldConfirmDelete",
    );
    expect(deleteHandlerSource).toContain("showConfirm(confirmMessage");
    expect(deleteHandlerSource).toMatch(
      /if \(!confirmMessage\) \{\s*void performDelete\(\[connection\.id\], noun\)/,
    );
  });

  it("directly cascades a folder deletion when confirmation is disabled", () => {
    expect(deleteHandlerSource).toContain("if (!shouldConfirmDelete)");
    expect(deleteHandlerSource).toContain(
      "performDelete([connection.id, ...descendants], noun)",
    );
  });
  it("routes real deletion through one provider archive and keeps children atomically", () => {
    expect(deleteHandlerSource).toContain(
      "recycleBin.archive([connection.id],",
    );
    expect(deleteHandlerSource).toMatch(
      /\{\s*keepChildren,\s*expectedScope: archiveScope,/,
    );
    expect(deleteHandlerSource).toContain(
      "const archiveScope = recycleBin?.snapshot?.scope",
    );
    expect(deleteHandlerSource).toContain("if (!recycleBin || !archiveScope)");
    expect(deleteHandlerSource).toContain(
      "performDelete([connection.id], noun, true)",
    );
    expect(deleteHandlerSource).toContain(
      "collectConnectionSubtreeIds(state.connections, [rootId])",
    );
    expect(deleteHandlerSource).not.toContain("const stack:");
    expect(deleteHandlerSource).not.toContain('type: "DELETE_CONNECTION"');
    expect(deleteHandlerSource).not.toContain('type: "UPDATE_CONNECTION"');
    expect(deleteHandlerSource).toContain("configured retention expires");
    expect(deleteHandlerSource).not.toContain("This action cannot be undone");
  });
  it("does not relabel committed archiving as a persistence failure when notification throws", () => {
    const committedStart = deleteHandlerSource.indexOf(
      "A notification failure cannot change the completed durable result",
    );
    const committedEnd = deleteHandlerSource.indexOf(
      "// ── Folder with descendants",
      committedStart,
    );
    const notification = deleteHandlerSource.slice(
      committedStart,
      committedEnd,
    );
    expect(committedStart).toBeGreaterThan(
      deleteHandlerSource.indexOf("return false;"),
    );
    expect(notification).toContain("post-save notification failed");
    expect(notification).toContain("return true;");
    expect(notification).not.toContain("recyclePersistenceFailed");
  });
});
