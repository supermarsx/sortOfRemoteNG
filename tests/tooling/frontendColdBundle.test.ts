import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeColdBundle,
  assertTypeScriptCompilerLazy,
  collectColdChunkPaths,
} from "../../scripts/ci/check-frontend-cold-bundle.mjs";

const html = `
  <link rel="preload" as="script" href="/_next/static/chunks/preload.js" />
  <script src="/_next/static/chunks/bootstrap.js"></script>
`;

const manifest = {
  app: {
    id: 1,
    files: ["static/chunks/app.js", "static/chunks/styles.css"],
  },
};

const compilerImplementation = [
  "versionMajorMinor",
  "createProgram",
  "getDefaultLibFileName",
].join(";");

const chunks = () =>
  new Map<string, string | Buffer>([
    ["static/chunks/preload.js", "preload"],
    ["static/chunks/bootstrap.js", "bootstrap"],
    ["static/chunks/app.js", "typescript.transpileModule(source)"],
    ["static/chunks/compiler.js", compilerImplementation],
  ]);

describe("frontend cold bundle assertion", () => {
  it("runs the real-artifact guard after the dedicated production build", () => {
    const packageManifest = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "frontend-build.yml"),
      "utf8",
    );

    expect(packageManifest.scripts?.["build:cold:check"]).toBe(
      "node ./scripts/ci/check-frontend-cold-bundle.mjs",
    );
    const buildStep = workflow.indexOf("run: npm run build");
    const guardStep = workflow.indexOf("run: npm run build:cold:check");
    expect(buildStep).toBeGreaterThan(-1);
    expect(guardStep).toBeGreaterThan(buildStep);
  });

  it("unions HTML and App-manifest JavaScript chunks", () => {
    expect(collectColdChunkPaths({ html, loadableManifest: manifest })).toEqual(
      [
        "static/chunks/app.js",
        "static/chunks/bootstrap.js",
        "static/chunks/preload.js",
      ],
    );
  });

  it("accepts the compiler implementation only in an async chunk", () => {
    const result = analyzeColdBundle({
      html,
      loadableManifest: manifest,
      chunks: chunks(),
    });

    expect(result.coldChunkCount).toBe(3);
    expect(result.coldRawBytes).toBeGreaterThan(0);
    expect(result.coldGzipBytes).toBeGreaterThan(0);
    expect(result.compilerChunkPaths).toEqual(["static/chunks/compiler.js"]);
    expect(result.compilerRawBytes).toBe(
      Buffer.byteLength(compilerImplementation),
    );
    expect(result.coldCompilerChunkPaths).toEqual([]);
    expect(() => assertTypeScriptCompilerLazy(result)).not.toThrow();
  });

  it("rejects a compiler implementation in the cold App manifest", () => {
    const coldManifest = {
      app: {
        id: 1,
        files: [...manifest.app.files, "static/chunks/compiler.js"],
      },
    };

    const result = analyzeColdBundle({
      html,
      loadableManifest: coldManifest,
      chunks: chunks(),
    });

    expect(() => assertTypeScriptCompilerLazy(result)).toThrow(
      /TypeScript compiler implementation leaked into the cold bundle/u,
    );
  });

  it("fails closed when the compiler fingerprint cannot be found", () => {
    const withoutCompiler = chunks();
    withoutCompiler.delete("static/chunks/compiler.js");

    expect(() =>
      analyzeColdBundle({
        html,
        loadableManifest: manifest,
        chunks: withoutCompiler,
      }),
    ).toThrow(/lazy-load assertion would be inconclusive/u);
  });

  it("rejects missing cold chunks", () => {
    const incomplete = chunks();
    incomplete.delete("static/chunks/app.js");

    expect(() =>
      analyzeColdBundle({
        html,
        loadableManifest: manifest,
        chunks: incomplete,
      }),
    ).toThrow(/Cold frontend chunks are missing/u);
  });
});
