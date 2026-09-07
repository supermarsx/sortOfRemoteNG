import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadExportedWorker } from "../../scripts/ci/check-gif-worker-export.mjs";

const temporaryDirectories: string[] = [];
const fixture = (source: string, extension = "js") => {
  const root = mkdtempSync(join(tmpdir(), "sorng-gif-export-"));
  temporaryDirectories.push(root);
  const chunks = join(root, "_next", "static", "chunks");
  mkdirSync(chunks, { recursive: true });
  writeFileSync(join(chunks, `worker.${extension}`), source);
  return {
    root,
    url: new URL(
      `https://gif-worker.test/_next/static/chunks/worker.${extension}`,
    ),
  };
};

afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) {
    if (
      !resolve(root).startsWith(`${resolve(tmpdir())}${sep}sorng-gif-export-`)
    )
      throw new Error("Invalid fixture cleanup path");
    rmSync(root, { recursive: true, force: true });
  }
});

describe("exported GIF worker validation", () => {
  it("rejects raw TypeScript worker URLs", async () => {
    const { root, url } = fixture("let encoder: unknown;", "ts");
    await expect(loadExportedWorker(root, url)).rejects.toThrow(
      "non-JavaScript asset",
    );
  });
  it("rejects TypeScript copied into a JavaScript worker", async () => {
    const { root, url } = fixture("let encoder: unknown;");
    await expect(loadExportedWorker(root, url)).rejects.toThrow();
  });
  it("rejects unresolved worker dependencies", async () => {
    const { root, url } = fixture(
      'importScripts("/_next/static/chunks/missing.js");',
    );
    await expect(loadExportedWorker(root, url)).rejects.toThrow("ENOENT");
  });
  it("rejects untranslated module imports in the classic worker bootstrap", async () => {
    const { root, url } = fixture(
      'import { encoder } from "./gifEncodingCore";',
    );
    await expect(loadExportedWorker(root, url)).rejects.toThrow();
  });
  it("rejects an inert bundle without a recording message handler", async () => {
    const { root, url } = fixture("self.unrelated = true;");
    await expect(loadExportedWorker(root, url)).rejects.toThrow(
      "message handler",
    );
  });
  it("keeps generated output outside source checks and runs the real probe in the build gate", () => {
    const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));
    expect(tsconfig.exclude).toContain("out");
    expect(readFileSync("eslint.config.js", "utf8")).toContain('"out/**"');
    expect(
      readFileSync("scripts/ci/check-frontend-cold-bundle.mjs", "utf8"),
    ).toContain("await checkGifWorkerExport(outDirectory)");
  });
});
