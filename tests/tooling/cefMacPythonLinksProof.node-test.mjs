import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  authority,
  witness,
  PATHS,
  LINKS,
} from "../fixtures/cef/mac_python_links_proof.mjs";

function fixture({
  unknown = null,
  cellarDirectory = false,
  ancestorAlias = false,
  unstable = false,
  closeFails = false,
} = {}) {
  const stats = new Map(),
    calls = [],
    held = new Set(),
    reads = new Map();
  const info = (file, link = false) => {
    if (!stats.has(file))
      stats.set(file, {
        dev: 1n,
        ino: BigInt(stats.size + 10),
        mode: link ? 0o120777n : 0o40755n,
        nlink: 1n,
        uid: 501n,
        gid: 20n,
        size: 64n,
        mtimeNs: 2n,
        ctimeNs: 3n,
        birthtimeNs: 1n,
        isDirectory: () => !link,
        isSymbolicLink: () => link,
      });
    return stats.get(file);
  };
  const row = (file) =>
    info(
      file,
      file === PATHS.framework ||
        (file === PATHS.cellar && !cellarDirectory) ||
        (ancestorAlias && file === "/usr/local/Cellar"),
    );
  const io = {
    async lstat(file) {
      calls.push(file);
      const count = (reads.get(file) ?? 0) + 1;
      reads.set(file, count);
      const result = row(file);
      return unstable && file === PATHS.framework && count > 1
        ? { ...result, ino: result.ino + 1n }
        : result;
    },
    async readlink(file) {
      assert([PATHS.framework, PATHS.cellar].includes(file));
      return file === PATHS[unknown]
        ? "/PRIVATE/SECRET_TOKEN"
        : file === PATHS.framework
          ? LINKS.framework
          : LINKS.cellar[0];
    },
    async open(file, flags) {
      assert(row(file).isDirectory());
      assert(Number.isSafeInteger(flags));
      const token = {};
      held.add(token);
      return {
        async stat() {
          return row(file);
        },
        async close() {
          held.delete(token);
          if (closeFails) throw new Error("PRIVATE_CLOSE");
        },
      };
    },
    async readdir() {
      throw new Error("must not inspect children");
    },
    async readFile() {
      throw new Error("must not read content");
    },
  };
  return { io, calls, held };
}

test("metadata witness follows only the exact recognized public chain and releases held ancestors", async () => {
  const f = fixture(),
    report = await witness({ io: f.io });
  assert.equal(report.qualified, true);
  assert.equal(report.chainShape, "framework-cellar-shared");
  assert.deepEqual(
    report.nodes.map((n) => [n.role, n.kind]),
    [
      ["framework", "symlink"],
      ["cellar", "symlink"],
      ["shared", "directory"],
    ],
  );
  assert.equal(report.handlesClosed, true);
  assert.equal(f.held.size, 0);
  assert.equal(report.contentRead, false);
  assert.equal(report.childrenRead, false);
  assert.equal(report.fullClosureVerified, false);
  assert.equal(report.sourceWriteAdmitted, false);
  assert.doesNotMatch(JSON.stringify(report), /\/usr\/|site-packages|PRIVATE/);
});

test("an actual package-owned directory is distinguished from a shared-root chain", async () => {
  const f = fixture({ cellarDirectory: true }),
    report = await witness({ io: f.io });
  assert.equal(report.chainShape, "framework-cellar-directory");
  assert.equal(report.nodes.length, 2);
  assert(!f.calls.includes(PATHS.shared));
  assert.equal(f.held.size, 0);
});

for (const unknown of ["framework", "cellar"])
  test(`unknown ${unknown} link is hashed and rejected without target traversal`, async () => {
    const f = fixture({ unknown }),
      report = await witness({ io: f.io });
    assert.equal(report.qualified, false);
    assert.equal(report.status, "unrecognized-link");
    assert.match(report.nodes.at(-1).literalSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.nodes.at(-1).targetRole, "unrecognized");
    assert(!f.calls.some((file) => file.includes("PRIVATE")));
    assert(!f.calls.includes(PATHS.shared));
    if (unknown === "framework") assert(!f.calls.includes(PATHS.cellar));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|SECRET/);
    assert.equal(f.held.size, 0);
  });

test("ancestor aliases, changed identities, close failures and deadline stay unqualified", async () => {
  for (const [options, status] of [
    [{ ancestorAlias: true }, "ancestor-not-ordinary"],
    [{ unstable: true }, "unstable"],
    [{ closeFails: true }, "handle-close-failed"],
  ]) {
    const f = fixture(options),
      report = await witness({ io: f.io });
    assert.equal(report.qualified, false);
    assert.equal(report.status, status);
    assert.equal(f.held.size, 0);
    if (options.closeFails) assert.equal(report.handlesClosed, false);
  }
  const f = fixture(),
    report = await witness({ io: f.io, now: () => 10, deadline: 10 });
  assert.equal(report.status, "deadline");
  assert.equal(f.calls.length, 0);
});

test("main witness uses no child process, directory listing or content reader", async () => {
  const source = await readFile(
    new URL("../fixtures/cef/mac_python_links_proof.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /child_process|\.readdir\(|\.opendir\(|\.readFile\(/,
  );
  assert.match(source, /constants\.O_NOFOLLOW \| constants\.O_DIRECTORY/);
  assert.match(source, /process\.exit\(1\)/);
  assert.match(source, /flag: "wx"/);
});

test("authority rejects foreign image, event, source and host before metadata", () => {
  const env = {
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-process-census-proof.yml@refs/heads/main",
  };
  authority(env, "darwin", "x64");
  for (const [key, value] of Object.entries({
    ImageVersion: "other",
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_REPOSITORY_ID: "0",
    RUNNER_ENVIRONMENT: "self-hosted",
  }))
    assert.throws(() => authority({ ...env, [key]: value }, "darwin", "x64"));
  assert.throws(() => authority(env, "linux", "x64"));
  assert.throws(() => authority(env, "darwin", "arm64"));
});
