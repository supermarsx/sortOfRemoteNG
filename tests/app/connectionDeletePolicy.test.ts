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
});
