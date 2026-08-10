#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const TYPESCRIPT_COMPILER_MARKERS = Object.freeze([
  "versionMajorMinor",
  "createProgram",
  "getDefaultLibFileName",
]);

const normalizeSeparators = (path) => path.split(sep).join("/");

const normalizeChunkReference = (reference) => {
  const normalized = reference.replace(/^\//u, "").replace(/^_next\//u, "");
  if (!/^static\/chunks\/.+\.js$/u.test(normalized)) {
    throw new Error(`Unsupported frontend chunk reference: ${reference}`);
  }
  return normalized;
};

export const collectColdChunkPaths = ({ html, loadableManifest }) => {
  if (typeof html !== "string" || html.length === 0) {
    throw new Error("The static-export HTML is empty.");
  }
  if (
    typeof loadableManifest !== "object" ||
    loadableManifest === null ||
    Array.isArray(loadableManifest)
  ) {
    throw new Error("The React loadable manifest is malformed.");
  }

  const paths = new Set();
  for (const match of html.matchAll(
    /\/_next\/(static\/chunks\/[^"'\s<>]+\.js)/gu,
  )) {
    paths.add(normalizeChunkReference(match[1]));
  }

  for (const entry of Object.values(loadableManifest)) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !Array.isArray(entry.files)
    ) {
      throw new Error(
        "The React loadable manifest contains a malformed entry.",
      );
    }
    for (const file of entry.files) {
      if (typeof file === "string" && file.endsWith(".js")) {
        paths.add(normalizeChunkReference(file));
      }
    }
  }

  if (paths.size === 0) {
    throw new Error("No cold frontend JavaScript chunks were discovered.");
  }
  return [...paths].sort();
};

const hasTypeScriptCompilerFingerprint = (content) =>
  TYPESCRIPT_COMPILER_MARKERS.every((marker) => content.includes(marker));

export const analyzeColdBundle = ({ html, loadableManifest, chunks }) => {
  if (!(chunks instanceof Map) || chunks.size === 0) {
    throw new Error("The frontend chunk map is empty.");
  }

  const coldChunkPaths = collectColdChunkPaths({ html, loadableManifest });
  const missingColdChunks = coldChunkPaths.filter((path) => !chunks.has(path));
  if (missingColdChunks.length > 0) {
    throw new Error(
      `Cold frontend chunks are missing from the export: ${missingColdChunks.join(", ")}`,
    );
  }

  const compilerChunkPaths = [...chunks.entries()]
    .filter(([, content]) =>
      hasTypeScriptCompilerFingerprint(Buffer.from(content).toString("utf8")),
    )
    .map(([path]) => path)
    .sort();
  if (compilerChunkPaths.length === 0) {
    throw new Error(
      "No TypeScript compiler chunk was found; the lazy-load assertion would be inconclusive.",
    );
  }

  const coldCompilerChunkPaths = compilerChunkPaths.filter((path) =>
    coldChunkPaths.includes(path),
  );

  const coldBuffers = coldChunkPaths.map((path) =>
    Buffer.from(chunks.get(path)),
  );
  const compilerBuffers = compilerChunkPaths.map((path) =>
    Buffer.from(chunks.get(path)),
  );

  return {
    coldChunkPaths,
    coldChunkCount: coldChunkPaths.length,
    coldRawBytes: coldBuffers.reduce(
      (total, content) => total + content.length,
      0,
    ),
    coldGzipBytes: coldBuffers.reduce(
      (total, content) => total + gzipSync(content).length,
      0,
    ),
    compilerChunkPaths,
    compilerChunkCount: compilerChunkPaths.length,
    compilerRawBytes: compilerBuffers.reduce(
      (total, content) => total + content.length,
      0,
    ),
    compilerGzipBytes: compilerBuffers.reduce(
      (total, content) => total + gzipSync(content).length,
      0,
    ),
    coldCompilerChunkPaths,
  };
};

export const assertTypeScriptCompilerLazy = (result) => {
  if (result.coldCompilerChunkPaths.length > 0) {
    throw new Error(
      `TypeScript compiler implementation leaked into the cold bundle: ${result.coldCompilerChunkPaths.join(", ")}`,
    );
  }
};

const collectJavaScriptChunks = (
  directory,
  root = directory,
  chunks = new Map(),
) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScriptChunks(path, root, chunks);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const relativePath = normalizeSeparators(relative(root, path));
      chunks.set(`static/chunks/${relativePath}`, readFileSync(path));
    }
  }
  return chunks;
};

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path.`);
  }
  return value;
};

const main = () => {
  const outDirectory = resolve(argumentValue("--out-dir", "out"));
  const nextDirectory = resolve(argumentValue("--next-dir", ".next"));
  const htmlPath = join(outDirectory, "index.html");
  const manifestPath = join(
    nextDirectory,
    "server",
    "app",
    "page",
    "react-loadable-manifest.json",
  );
  const chunksDirectory = join(outDirectory, "_next", "static", "chunks");

  for (const path of [htmlPath, manifestPath, chunksDirectory]) {
    if (!existsSync(path)) {
      throw new Error(`Required frontend build artifact is missing: ${path}`);
    }
  }
  if (!statSync(chunksDirectory).isDirectory()) {
    throw new Error(
      `Frontend chunks path is not a directory: ${chunksDirectory}`,
    );
  }

  const result = analyzeColdBundle({
    html: readFileSync(htmlPath, "utf8"),
    loadableManifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    chunks: collectJavaScriptChunks(chunksDirectory),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  assertTypeScriptCompilerLazy(result);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
