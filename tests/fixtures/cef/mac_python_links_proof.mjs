// A fixed metadata witness only: it never inventories site-packages contents.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const CELLAR = "/usr/local/Cellar/python@3.14/3.14.7";
export const PATHS = Object.freeze({
  framework:
    CELLAR +
    "/Frameworks/Python.framework/Versions/3.14/lib/python3.14/site-packages",
  cellar: CELLAR + "/lib/python3.14/site-packages",
  shared: "/usr/local/lib/python3.14/site-packages",
});
export const LINKS = Object.freeze({
  framework: "../../../../../../lib/python3.14/site-packages",
  cellar: Object.freeze([
    "../../../../../lib/python3.14/site-packages",
    PATHS.shared,
  ]),
});
const FIELDS = [
  "dev",
  "ino",
  "mode",
  "nlink",
  "uid",
  "gid",
  "size",
  "mtimeNs",
  "ctimeNs",
  "birthtimeNs",
];
const stamp = (info) => FIELDS.map((key) => String(info[key])).join(":");
const valid = (info) =>
  FIELDS.every((key) => typeof info[key] === "bigint" && info[key] >= 0n) &&
  info.nlink > 0n;
export function authority(env, platform, architecture) {
  assert(platform === "darwin" && architecture === "x64", "PYTHON_LINK_HOST");
  assert(
    env.ImageOS === "macos15" && env.ImageVersion === "20260824.0482.1",
    "PYTHON_LINK_IMAGE",
  );
  assert(
    env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted",
    "PYTHON_LINK_RUNNER",
  );
  assert(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.CEF_DEFAULT_BRANCH === "main" &&
      env.GITHUB_REF === "refs/heads/main",
    "PYTHON_LINK_EVENT",
  );
  assert(
    env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public",
    "PYTHON_LINK_REPOSITORY",
  );
  assert(
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF ===
        "supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-process-census-proof.yml@refs/heads/main",
    "PYTHON_LINK_SOURCE",
  );
}

export async function witness({
  io = fs,
  now = () => performance.now(),
  deadline = now() + 15000,
} = {}) {
  const held = new Map(),
    leaves = [],
    nodes = [];
  let status = "complete",
    primary,
    closed = true;
  const check = () => assert(now() < deadline, "deadline");
  const parents = async (file) => {
    const parts = path.posix.dirname(file).split("/").filter(Boolean);
    for (let i = 0; i <= parts.length; i++) {
      check();
      const name = i ? "/" + parts.slice(0, i).join("/") : "/";
      if (held.has(name)) continue;
      const before = await io.lstat(name, { bigint: true });
      assert(
        valid(before) && before.isDirectory() && !before.isSymbolicLink(),
        "ancestor-not-ordinary",
      );
      let handle;
      try {
        handle = await io.open(
          name,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
        );
        assert(
          stamp(await handle.stat({ bigint: true })) === stamp(before),
          "unstable",
        );
        held.set(name, { before, handle });
        handle = null;
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch (error) {
            closed = false;
            throw error;
          }
        }
      }
    }
  };
  const inspect = async (role, targetRole, expected) => {
    check();
    const file = PATHS[role];
    await parents(file);
    const before = await io.lstat(file, { bigint: true });
    assert(valid(before), "stat-unavailable");
    let node;
    if (before.isSymbolicLink()) {
      const literal = await io.readlink(file);
      assert(
        typeof literal === "string" && Buffer.byteLength(literal) <= 4096,
        "link-bound",
      );
      const recognized =
        expected.includes(literal) &&
        path.posix.resolve(path.posix.dirname(file), literal) ===
          PATHS[targetRole];
      node = {
        role,
        kind: "symlink",
        targetRole: recognized ? targetRole : "unrecognized",
        literalSha256: createHash("sha256").update(literal).digest("hex"),
        literalBytes: Buffer.byteLength(literal),
        recognized,
      };
      nodes.push(node);
      assert(recognized, "unrecognized-link");
      const after = await io.lstat(file, { bigint: true });
      assert(
        stamp(before) === stamp(after) && (await io.readlink(file)) === literal,
        "unstable",
      );
      leaves.push({ file, before, literal });
    } else {
      assert(before.isDirectory(), "leaf-not-directory");
      let handle;
      try {
        handle = await io.open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
        );
        assert(
          stamp(await handle.stat({ bigint: true })) === stamp(before),
          "unstable",
        );
        held.set(file, { before, handle });
        handle = null;
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch (error) {
            closed = false;
            throw error;
          }
        }
      }
      node = { role, kind: "directory", recognized: true };
      nodes.push(node);
    }
    check();
    return node;
  };
  try {
    const first = await inspect("framework", "cellar", [LINKS.framework]);
    assert(first.kind === "symlink", "framework-not-link");
    const second = await inspect("cellar", "shared", LINKS.cellar);
    if (second.kind === "symlink") {
      const third = await inspect("shared", null, []);
      assert(third.kind === "directory", "shared-not-directory");
    }
    for (const [file, item] of held) {
      check();
      const after = await io.lstat(file, { bigint: true });
      assert(
        stamp(after) === stamp(item.before) &&
          stamp(await item.handle.stat({ bigint: true })) ===
            stamp(item.before),
        "unstable",
      );
    }
    for (const item of leaves) {
      check();
      assert(
        stamp(await io.lstat(item.file, { bigint: true })) ===
          stamp(item.before) && (await io.readlink(item.file)) === item.literal,
        "unstable",
      );
    }
    check();
  } catch (error) {
    primary = error;
    const known = new Set([
      "deadline",
      "ancestor-not-ordinary",
      "unstable",
      "stat-unavailable",
      "link-bound",
      "unrecognized-link",
      "leaf-not-directory",
      "framework-not-link",
      "shared-not-directory",
    ]);
    status = known.has(error?.message)
      ? error.message
      : error?.code === "ENOENT"
        ? "missing"
        : "metadata-read-failed";
  } finally {
    for (const item of [...held.values()].reverse()) {
      try {
        await item.handle.close();
      } catch {
        closed = false;
      }
    }
  }
  if (!closed && !primary) status = "handle-close-failed";
  const qualified = status === "complete" && closed;
  return {
    schemaVersion: 1,
    kind: "sorng-mac-python-link-witness",
    complete: qualified,
    qualified,
    status,
    nodes,
    chainShape: qualified
      ? nodes.length === 3
        ? "framework-cellar-shared"
        : "framework-cellar-directory"
      : "unqualified",
    heldDirectories: held.size,
    handlesClosed: closed,
    childrenRead: false,
    contentRead: false,
    interpreterInvoked: false,
    fullClosureVerified: false,
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
}

export async function main() {
  authority(process.env, process.platform, process.arch);
  assert(process.argv.length === 2, "PYTHON_LINK_ARGUMENTS");
  const timer = setTimeout(() => {
    console.error("PYTHON_LINK_DEADLINE");
    process.exit(1);
  }, 20000);
  try {
    const report = await witness();
    const temp = await fs.realpath(process.env.RUNNER_TEMP);
    assert(temp === "/Users/runner/work/_temp", "PYTHON_LINK_TEMP");
    const output = path.join(
      temp,
      "cef-mac-python-links-proof-" + randomUUID(),
    );
    await fs.mkdir(output, { mode: 0o700 });
    assert((await fs.realpath(output)) === output, "PYTHON_LINK_OUTPUT");
    const directory = await fs.lstat(output, { bigint: true });
    assert(
      directory.isDirectory() &&
        !directory.isSymbolicLink() &&
        directory.uid === BigInt(process.getuid()) &&
        (directory.mode & 0o777n) === 0o700n,
      "PYTHON_LINK_OUTPUT",
    );
    await fs.writeFile(
      path.join(output, "proof.json"),
      JSON.stringify(
        {
          ...report,
          hostArchitecture: process.arch,
          image: process.env.ImageVersion,
          source: process.env.GITHUB_SHA,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    const after = await fs.lstat(output, { bigint: true });
    assert(
      after.isDirectory() &&
        !after.isSymbolicLink() &&
        after.dev === directory.dev &&
        after.ino === directory.ino &&
        after.uid === directory.uid &&
        (await fs.realpath(output)) === output,
      "PYTHON_LINK_OUTPUT_CHANGED",
    );
    console.log(JSON.stringify(report));
    if (!report.qualified) process.exitCode = 1;
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
    console.error("PYTHON_LINK_WITNESS_FAILED");
    process.exitCode = 1;
  }
}
