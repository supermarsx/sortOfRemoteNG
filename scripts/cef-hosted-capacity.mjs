#!/usr/bin/env node
// Read-only hosted-runner assessment. No downloads, cleanup, or build claims.
import os from "node:os";
import path from "node:path";
import { statfs } from "node:fs/promises";

const gib = (bytes) => Math.round((bytes / 1024 ** 3) * 100) / 100;
const roots = [
  ...new Set([process.cwd(), process.env.RUNNER_TEMP].filter(Boolean)),
];
const disks = await Promise.all(
  roots.map(async (root) => {
    const stats = await statfs(root);
    return {
      path: path.resolve(root),
      availableGiB: gib(stats.bavail * stats.bsize),
      totalGiB: gib(stats.blocks * stats.bsize),
    };
  }),
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: "cef-hosted-capacity-observation",
      observedAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      availableCpus: os.availableParallelism(),
      totalMemoryGiB: gib(os.totalmem()),
      freeMemoryGiB: gib(os.freemem()),
      disks,
      engineBuildAttempted: false,
      note: "Capacity snapshot only. Paths can share a volume; do not sum free space. No engine, toolchain, sandbox or platform acceptance is attested.",
    },
    null,
    2,
  ),
);
