import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
describe("Icon Explorer native file permissions", () => {
  it("permits the exact selected-file operations without expanding window or filesystem scope", () => {
    const capability = JSON.parse(
      readFileSync(resolve("src-tauri/capabilities/default.json"), "utf8"),
    );
    expect(capability.windows).toEqual(["main", "detached-*"]);
    const ids = capability.permissions.map(
      (entry: string | { identifier: string }) =>
        typeof entry === "string" ? entry : entry.identifier,
    );
    for (const id of [
      "dialog:default",
      "fs:default",
      "fs:allow-stat",
      "fs:allow-write-text-file",
    ])
      expect(ids).toContain(id);
    expect(
      capability.permissions.find(
        (entry: unknown) => entry === "fs:allow-stat",
      ),
    ).toBe("fs:allow-stat");
    expect(
      capability.permissions.find(
        (entry: unknown) => entry === "fs:allow-write-text-file",
      ),
    ).toBe("fs:allow-write-text-file");
    // No added path scope: Open/Save dynamically authorize only the user's choice.
    expect(ids).not.toContain("fs:scope");
    expect(ids).not.toContain("fs:allow-all");
    const source = readFileSync(
      resolve("src/hooks/icons/useIconExplorer.ts"),
      "utf8",
    );
    for (const call of [
      "await stat(path)",
      "await readTextFile(path)",
      "await writeTextFile(path, contents)",
    ])
      expect(source).toContain(call);
  });
});
