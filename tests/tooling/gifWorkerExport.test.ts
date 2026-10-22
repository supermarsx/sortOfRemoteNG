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
import {
  loadExportedWorker,
  workerUrlFromClient,
} from "../../scripts/ci/check-gif-worker-export.mjs";

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
  const emitted = (helper = true) =>
    new Map([
      [
        "static/chunks/client.js",
        `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["client",7,e=>{e.v(e.r(42).f("static/chunks/turbopack-worker-fixture.js",["static/chunks/codec.js"]))},8,e=>{throw new Error("Unrelated application factory executed: GIF recording requires Web Worker support");e.r(7)(Worker,{type:"module"})}]);throw new Error("Unrelated top-level runtime executed");`,
      ],
      [
        "static/chunks/helper.js",
        helper
          ? `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["helper",[42,e=>{e.s(["f",0,(path)=>function(Worker,options){return new Worker(new URL("/_next/"+path,location),options)}])},99,e=>{throw new Error("Unrelated helper executed")}]]);`
          : "",
      ],
      [
        "static/chunks/codec.js",
        'throw new Error("GIF encoder is not initialized")',
      ],
      ["static/chunks/turbopack-worker-fixture.js", "// Worker bootstrap"],
    ]);
  it("resolves a worker factory through another emitted registration without executing unrelated modules", () => {
    const result = workerUrlFromClient(emitted());
    expect(result.url.href).toBe(
      "https://gif-worker.test/_next/static/chunks/turbopack-worker-fixture.js",
    );
    expect(result.client).toBe("static/chunks/client.js");
  });
  it("fails closed for missing cross-chunk worker dependencies", () => {
    expect(() => workerUrlFromClient(emitted(false))).toThrow(
      "Missing emitted worker-factory dependency 42",
    );
  });
  it("accepts byte-identical repeated module registrations from split entries", () => {
    const chunks = emitted();
    chunks.set(
      "static/chunks/another-entry.js",
      chunks.get("static/chunks/helper.js")!,
    );
    expect(workerUrlFromClient(chunks).url.pathname).toBe(
      "/_next/static/chunks/turbopack-worker-fixture.js",
    );
  });
  it("rejects duplicate reachable module IDs instead of choosing one chunk by filesystem order", () => {
    const chunks = emitted();
    chunks.set(
      "static/chunks/conflicting.js",
      '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["duplicate",42,e=>{e.v("wrong")}]);',
    );
    expect(() => workerUrlFromClient(chunks)).toThrow(
      "Duplicate emitted worker-factory module 42",
    );
  });
  it("keeps a client's own module binding separate from another entry's minified definition", () => {
    const chunks = emitted();
    const localHelper =
      '42,e=>{e.s(["f",0,(path)=>function(Worker,options){return new Worker(new URL("/_next/"+path,location),options)}])},';
    chunks.set(
      "static/chunks/client.js",
      chunks
        .get("static/chunks/client.js")!
        .replace('"client",7,', `"client",${localHelper}7,`),
    );
    chunks.set(
      "static/chunks/helper.js",
      '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["another-entry",42,e=>{throw new Error("Wrong entry binding executed")}]);',
    );
    expect(workerUrlFromClient(chunks).url.pathname).toBe(
      "/_next/static/chunks/turbopack-worker-fixture.js",
    );
  });
  it("rejects unsupported registration elements rather than evaluating arbitrary expressions", () => {
    const chunks = emitted();
    chunks.set(
      "static/chunks/unsupported.js",
      '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["bad",42,(()=>{throw new Error("Expression executed")})()]);',
    );
    expect(() => workerUrlFromClient(chunks)).toThrow(
      "Unknown Turbopack client chunk format",
    );
  });
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
