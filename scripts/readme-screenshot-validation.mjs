#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const README_SCREENSHOT_WIDTH = 1280;
export const README_SCREENSHOT_HEIGHT = 720;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export async function validateReadmeScreenshot({
  filePath,
  expectedWidth = README_SCREENSHOT_WIDTH,
  expectedHeight = README_SCREENSHOT_HEIGHT,
  freshSinceMs,
}) {
  const resolvedPath = path.resolve(filePath);
  const [bytes, metadata] = await Promise.all([
    readFile(resolvedPath),
    stat(resolvedPath),
  ]);

  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${resolvedPath} is not a PNG file (invalid signature)`);
  }

  if (bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${resolvedPath} does not start with a PNG IHDR chunk`);
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `${resolvedPath} is ${width}x${height}; expected ${expectedWidth}x${expectedHeight}`,
    );
  }

  if (freshSinceMs !== undefined && metadata.mtimeMs < freshSinceMs) {
    throw new Error(
      `${resolvedPath} is stale (mtime ${metadata.mtimeMs} is before ${freshSinceMs})`,
    );
  }

  return {
    filePath: resolvedPath,
    width,
    height,
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
  };
}

function parseCliArgs(args) {
  const options = {
    filePath: path.resolve("docs/assets/readme-screenshot.png"),
    freshSinceMs: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fresh-since") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--fresh-since requires a millisecond timestamp");
      }

      options.freshSinceMs = Number(value);
      if (!Number.isFinite(options.freshSinceMs)) {
        throw new Error(`Invalid --fresh-since value: ${value}`);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.filePath = path.resolve(arg);
  }

  return options;
}

async function main() {
  const result = await validateReadmeScreenshot(
    parseCliArgs(process.argv.slice(2)),
  );
  console.log(
    `[readme-screenshot] valid ${result.width}x${result.height} PNG: ${result.filePath}`,
  );
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
