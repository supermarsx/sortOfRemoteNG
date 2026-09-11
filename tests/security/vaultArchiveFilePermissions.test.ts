import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("bounded vault archive file permissions", () => {
  it("grants streamingcommands only to existingappwindows withoutaddingpathscope", () => {
    const capability = JSON.parse(
      readFileSync("src-tauri/capabilities/default.json", "utf8"),
    );
    expect(capability.windows).toEqual(["main", "detached-*"]);
    for (const command of [
      "fs:allow-open",
      "fs:allow-read",
      "core:default",
      "dialog:default",
    ])
      expect(capability.permissions).toContain(command);
    expect(capability.permissions).not.toContain("fs:allow-all");
    expect(capability.permissions).not.toContain("fs:scope");
    const source = readFileSync(
      "src/utils/security/vaultArchiveFiles.ts",
      "utf8",
    );
    expect(source).toContain("await open(path, { read: true })");
    expect(source).toContain("await file.read(buffer)");
    expect(source).toContain("await file.close()");
    expect(source).not.toContain("readFile(path)");
    // FileHandle uses core Resource.close, already granted by core:default.
    expect(
      readFileSync(
        "node_modules/@tauri-apps/plugin-fs/dist-js/index.js",
        "utf8",
      ),
    ).toContain("class FileHandle extends Resource");
    expect(
      readFileSync("node_modules/@tauri-apps/api/core.js", "utf8"),
    ).toContain("plugin:resources|close");
  });
});
