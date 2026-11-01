// Read-only namespace allocation measurements. Never authorizes cleanup.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ROOTS = Object.freeze([
  Object.freeze({ role: "swift", root: "/usr/share/swift" }),
  Object.freeze({ role: "powershell", root: "/usr/local/share/powershell" }),
]);
export const LIMITS = Object.freeze({
  entries: 150000,
  depth: 64,
  pathBytes: 4096,
  milliseconds: 90000,
  directoryBuffer: 32,
});
class InventoryFault extends Error {}
const fail = (code) => {
  throw new InventoryFault(code);
};
const fields = [
  "dev",
  "ino",
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
  "uid",
  "gid",
  "blocks",
];
const stamp = (info) => fields.map((key) => String(info[key])).join(":");
function valid(info) {
  for (const key of fields)
    if (typeof info[key] !== "bigint" || info[key] < 0n)
      fail("stat-unavailable");
  if (info.nlink < 1n) fail("unstable");
  return info;
}
export function authority(env, platform, architecture) {
  assert(platform === "linux" && architecture === "x64", "INVENTORY_HOST");
  assert(
    env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted",
    "INVENTORY_RUNNER",
  );
  assert(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.CEF_DEFAULT_BRANCH === "main" &&
      env.GITHUB_REF === "refs/heads/main",
    "INVENTORY_EVENT",
  );
  assert(
    env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public",
    "INVENTORY_REPOSITORY",
  );
  assert(env.ImageOS === "ubuntu24", "INVENTORY_IMAGE");
  assert(
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF ===
        "supermarsx/sortOfRemoteNG/.github/workflows/cef-linux-capacity-inventory.yml@refs/heads/main",
    "INVENTORY_SOURCE",
  );
}
async function walk(root, { io, check, limits }) {
  const frames = [],
    objects = new Set(),
    directories = new Set();
  const hash = createHash("sha256");
  const totals = {
    entries: 0,
    directories: 0,
    regularFiles: 0,
    symlinksNotFollowed: 0,
    hardlinkedObjects: 0,
    logicalFileBytes: 0n,
    allocatedUniqueBytes: 0n,
    potentiallySharedAllocatedBytes: 0n,
  };
  let rootStamp, rootDevice, primary;
  const metadata = (relative, info) => {
    check();
    valid(info);
    if (++totals.entries > limits.entries) fail("entry-limit");
    if (info.dev !== rootDevice) fail("foreign-device");
    hash.update(
      JSON.stringify([relative, ...fields.map((key) => String(info[key]))]) +
        "\n",
    );
    const object = `${info.dev}:${info.ino}`;
    if (!objects.has(object)) {
      objects.add(object);
      const allocated = info.blocks * 512n;
      totals.allocatedUniqueBytes += allocated;
      if (!info.isDirectory() && info.nlink > 1n) {
        totals.hardlinkedObjects++;
        totals.potentiallySharedAllocatedBytes += allocated;
      }
    }
    if (info.isDirectory()) totals.directories++;
    else if (info.isFile()) {
      totals.regularFiles++;
      totals.logicalFileBytes += info.size;
    } else if (info.isSymbolicLink()) totals.symlinksNotFollowed++;
    else fail("special-entry");
  };
  const close = async (frame) => {
    let first;
    for (const key of ["directory", "handle"]) {
      if (!frame[key]) continue;
      const handle = frame[key];
      frame[key] = null;
      try {
        await handle.close();
      } catch (error) {
        first ??= error;
      }
    }
    if (first) fail("cleanup-failed");
  };
  const open = async (file, relative, before) => {
    check();
    if (frames.length >= limits.depth) fail("depth-limit");
    const key = `${before.dev}:${before.ino}`;
    if (directories.has(key)) fail("repeated-directory");
    directories.add(key);
    const frame = { handle: null, directory: null, relative, before };
    try {
      frame.handle = await io.open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
      );
      check();
      if (
        stamp(valid(await frame.handle.stat({ bigint: true }))) !==
        stamp(before)
      )
        fail("unstable");
      if (!Number.isSafeInteger(frame.handle.fd) || frame.handle.fd < 3)
        fail("descriptor-unavailable");
      // This kernel-owned descriptor path names our held directory, not a
      // candidate filesystem symlink. Candidate links are never traversed.
      frame.pinned = `/proc/self/fd/${frame.handle.fd}`;
      frame.directory = await io.opendir(frame.pinned, {
        bufferSize: limits.directoryBuffer,
      });
      check();
      frames.push(frame);
    } catch (error) {
      try {
        await close(frame);
      } catch {
        /* Preserve primary. */
      }
      throw error;
    }
  };
  try {
    check();
    const before = valid(await io.lstat(root, { bigint: true }));
    if (before.isSymbolicLink() || !before.isDirectory())
      fail("alias-or-nondirectory");
    if ((await io.realpath(root)) !== root) fail("alias-or-nondirectory");
    rootStamp = stamp(before);
    rootDevice = before.dev;
    metadata("", before);
    await open(root, "", before);
    while (frames.length) {
      check();
      const frame = frames.at(-1),
        entry = await frame.directory.read();
      check();
      if (entry === null) {
        if (
          stamp(valid(await frame.handle.stat({ bigint: true }))) !==
          stamp(frame.before)
        )
          fail("unstable");
        await close(frame);
        frames.pop();
        continue;
      }
      if (
        typeof entry.name !== "string" ||
        !entry.name ||
        entry.name === "." ||
        entry.name === ".." ||
        /[/\x00\ufffd]/.test(entry.name)
      )
        fail("entry-name");
      const relative = frame.relative
        ? frame.relative + "/" + entry.name
        : entry.name;
      if (Buffer.byteLength(relative) > limits.pathBytes) fail("path-limit");
      const file = frame.pinned + "/" + entry.name;
      const info = valid(await io.lstat(file, { bigint: true }));
      check();
      metadata(relative, info);
      if (info.isDirectory()) await open(file, relative, info);
    }
    if (
      stamp(valid(await io.lstat(root, { bigint: true }))) !== rootStamp ||
      (await io.realpath(root)) !== root
    )
      fail("unstable");
    check();
    return { ...totals, rootStamp, fingerprint: hash.digest("hex") };
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    let closeFailure;
    for (const frame of frames.reverse()) {
      try {
        await close(frame);
      } catch (error) {
        closeFailure ??= error;
      }
    }
    if (!primary && closeFailure) throw closeFailure;
  }
}
export async function observeDirectory(
  root,
  {
    io = fs,
    now = () => performance.now(),
    deadline = now() + LIMITS.milliseconds,
    limits = LIMITS,
  } = {},
) {
  const check = () => {
    if (now() >= deadline) fail("deadline");
  };
  const began = now();
  try {
    const first = await walk(root, { io, check, limits });
    const second = await walk(root, { io, check, limits });
    if (
      first.rootStamp !== second.rootStamp ||
      first.fingerprint !== second.fingerprint
    )
      fail("unstable");
    check();
    const { rootStamp, ...facts } = second;
    return {
      qualified: true,
      status: "complete",
      ...Object.fromEntries(
        Object.entries(facts).map(([key, value]) => [
          key,
          typeof value === "bigint" ? value.toString() : value,
        ]),
      ),
      elapsedMs: Math.max(0, Math.floor(now() - began)),
    };
  } catch (error) {
    return {
      qualified: false,
      status:
        error instanceof InventoryFault
          ? error.message
          : error?.code === "ENOENT"
            ? "missing"
            : "read-failed",
      elapsedMs: Math.max(0, Math.floor(now() - began)),
    };
  }
}
export async function main() {
  authority(process.env, process.platform, process.arch);
  assert(process.argv.length === 2, "INVENTORY_ARGUMENTS");
  const timer = setTimeout(() => {
    console.error(
      '{"qualified":false,"status":"deadline","cleanupAttempted":false}',
    );
    process.exit(1);
  }, LIMITS.milliseconds);
  try {
    const deadline = performance.now() + LIMITS.milliseconds;
    const disk = await fs.statfs(process.env.RUNNER_TEMP, { bigint: true });
    const candidates = [];
    for (const item of ROOTS)
      candidates.push({
        ...item,
        ...(await observeDirectory(item.root, { deadline })),
      });
    const after = await fs.statfs(process.env.RUNNER_TEMP, { bigint: true });
    const report = {
      schemaVersion: 1,
      kind: "sorng-linux-checkpoint-capacity-inventory",
      platform: process.platform,
      architecture: process.arch,
      imageOS: process.env.ImageOS,
      imageVersion: process.env.ImageVersion,
      limits: LIMITS,
      availableBeforeBytes: String(disk.bavail * disk.bsize),
      availableAfterBytes: String(after.bavail * after.bsize),
      candidates,
      cleanupAttempted: false,
      downloadsAttempted: false,
      engineBuildAttempted: false,
      qualification:
        "Two metadata passes only; no file content read, candidate symlink traversal or per-file names retained. Allocated bytes deduplicate inode aliases and are not a cleanup/reclaim guarantee.",
    };
    const file = path.join(
      process.env.RUNNER_TEMP,
      "cef-linux-capacity-inventory.json",
    );
    await fs.writeFile(file, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(JSON.stringify(report));
  } finally {
    clearTimeout(timer);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    console.error("LINUX_CAPACITY_INVENTORY_FAILED");
    process.exitCode = 1;
  }
}
