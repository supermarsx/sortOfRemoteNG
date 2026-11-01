import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authority,
  LIMITS,
  ROOTS,
  observeDirectory,
} from "../fixtures/cef/linux_capacity_inventory.mjs";

const root = "/fixture";
function fixture({
  unstable = false,
  alias = false,
  missing = false,
  closeFails = false,
  badName = false,
} = {}) {
  let next = 10,
    passes = 0;
  const held = new Map(),
    opened = [],
    closed = [];
  const info = (kind, ino, size = 0n, nlink = 1n) => ({
    dev: 1n,
    ino,
    mode:
      kind === "directory" ? 0o40755n : kind === "link" ? 0o120777n : 0o100644n,
    nlink,
    size,
    mtimeNs: 2n,
    ctimeNs: 3n,
    uid: 1001n,
    gid: 1001n,
    blocks: 8n,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "link",
  });
  const rows = new Map([
    [root, info("directory", 1n)],
    [root + "/file", info("file", 2n, 25n, 2n)],
    [root + "/alias", info("file", 2n, 25n, 2n)],
    [root + "/link", info("link", 3n, 8n)],
    [root + "/dir", info("directory", 4n)],
    [root + "/dir/child", info("file", 5n, 7n)],
  ]);
  const resolve = (file) =>
    file.replace(/^\/proc\/self\/fd\/(\d+)/, (_, fd) => {
      assert.ok(held.has(Number(fd)), "descriptor must remain held");
      return held.get(Number(fd));
    });
  const io = {
    async lstat(file) {
      if (missing)
        throw Object.assign(new Error("PRIVATE_PATH"), { code: "ENOENT" });
      const resolved = resolve(file);
      const row = rows.get(resolved);
      assert.ok(row, resolved);
      if (unstable && passes > 1 && resolved === root + "/file")
        return { ...row, mtimeNs: 99n };
      return row;
    },
    async realpath(file) {
      return alias ? "/OTHER_PRIVATE_PATH" : file;
    },
    async open(file) {
      const resolved = resolve(file);
      assert.equal(rows.get(resolved).isDirectory(), true);
      const fd = next++;
      held.set(fd, resolved);
      opened.push(resolved);
      if (resolved === root) passes++;
      return {
        fd,
        async stat() {
          return rows.get(resolved);
        },
        async close() {
          held.delete(fd);
          closed.push(resolved);
          if (closeFails) throw new Error("PRIVATE_CLOSE");
        },
      };
    },
    async opendir(file, options) {
      assert.equal(options.bufferSize, LIMITS.directoryBuffer);
      const resolved = resolve(file);
      const names = [...rows.keys()]
        .filter(
          (key) =>
            key.startsWith(resolved + "/") &&
            !key.slice(resolved.length + 1).includes("/"),
        )
        .map((key) => key.slice(resolved.length + 1));
      if (badName) names.unshift("\ufffd");
      return {
        async read() {
          const name = names.shift();
          return name === undefined ? null : { name };
        },
        async close() {},
      };
    },
  };
  return { io, held, opened, closed };
}

test("fixed manual Ubuntu carrier has no cleanup, compiler or download path", async () => {
  assert.deepEqual(ROOTS, [
    { role: "swift", root: "/usr/share/swift" },
    { role: "powershell", root: "/usr/local/share/powershell" },
  ]);
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/cef-linux-capacity-inventory.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /repository_id == '1010282954'/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(workflow, /node-version-file: "\.node-version"/);
  assert.match(
    workflow,
    /run: node tests\/fixtures\/cef\/linux_capacity_inventory\.mjs/,
  );
  assert.doesNotMatch(
    workflow,
    /inputs:|strategy:|sudo|\brm\b|\bdu\b|curl|wget|provision|--execute/,
  );
  const source = await readFile(
    new URL("../fixtures/cef/linux_capacity_inventory.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /child_process|readFile\(|\.readFile\(|\.unlink\(|\.rm\(|\.rmdir\(/,
  );
  assert.match(source, /constants\.O_NOFOLLOW \| constants\.O_DIRECTORY/);
  assert.match(source, /process\.exit\(1\)/);
  assert.match(source, /flag: "wx"/);
});

test("authority binds actual hosted Linux, manual main and exact workflow source", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    ImageOS: "ubuntu24",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-linux-capacity-inventory.yml@refs/heads/main",
  };
  authority(env, "linux", "x64");
  for (const [key, value] of Object.entries({
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REF: "refs/heads/other",
    GITHUB_REPOSITORY_ID: "0",
    GITHUB_REPOSITORY_VISIBILITY: "private",
    ImageOS: "ubuntu22",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_REF: "other",
    RUNNER_ENVIRONMENT: "self-hosted",
  }))
    assert.throws(() => authority({ ...env, [key]: value }, "linux", "x64"));
  assert.throws(() => authority(env, "darwin", "x64"));
  assert.throws(() => authority(env, "linux", "arm64"));
});

test("two pinned passes count metadata, never follow candidate links and deduplicate hardlinks", async () => {
  const f = fixture();
  const result = await observeDirectory(root, { io: f.io });
  assert.equal(result.qualified, true);
  assert.equal(result.entries, 6);
  assert.equal(result.directories, 2);
  assert.equal(result.regularFiles, 3);
  assert.equal(result.symlinksNotFollowed, 1);
  assert.equal(result.hardlinkedObjects, 1);
  assert.equal(result.logicalFileBytes, "57");
  assert.equal(result.allocatedUniqueBytes, "20480");
  assert.equal(result.potentiallySharedAllocatedBytes, "4096");
  assert.deepEqual(f.opened, [root, root + "/dir", root, root + "/dir"]);
  assert.equal(f.held.size, 0);
  assert.equal(f.closed.length, 4);
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture|"child"|"file"|"alias"|"link"/,
  );
});

for (const [options, status] of [
  [{ missing: true }, "missing"],
  [{ alias: true }, "alias-or-nondirectory"],
  [{ unstable: true }, "unstable"],
  [{ badName: true }, "entry-name"],
  [{ closeFails: true }, "cleanup-failed"],
]) {
  test(`unqualified ${status} stays closed and releases descriptors`, async () => {
    const f = fixture(options);
    const result = await observeDirectory(root, { io: f.io });
    assert.equal(result.qualified, false);
    assert.equal(result.status, status);
    assert.equal(f.held.size, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|OTHER|fixture/);
  });
}

test("entry, depth and deadline bounds fail without leaving held directories", async () => {
  for (const [limits, status] of [
    [{ ...LIMITS, entries: 2 }, "entry-limit"],
    [{ ...LIMITS, depth: 1 }, "depth-limit"],
  ]) {
    const f = fixture();
    const result = await observeDirectory(root, { io: f.io, limits });
    assert.equal(result.status, status);
    assert.equal(result.qualified, false);
    assert.equal(f.held.size, 0);
  }
  const f = fixture();
  const result = await observeDirectory(root, {
    io: f.io,
    now: () => 5,
    deadline: 5,
  });
  assert.equal(result.status, "deadline");
  assert.equal(f.opened.length, 0);
});
