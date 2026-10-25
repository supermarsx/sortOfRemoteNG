import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  readdir,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { identitySha256 } from "../../scripts/lib/browser-custom-runtime.mjs";
import { plan } from "../../scripts/cef-runtime-ci.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PATCH_ROOT = "native/cef-patches/154.0.8037.58-682c378";
const PATCH = "0023-cef-x11-default-visual-colormap.patch";
const SOURCE = "libcef/browser/native/window_x11.cc";
const namespaces = [
  [
    "20261024-registration-retirement-owned-linux-x64",
    "20261025-registration-retirement-owned-linux-x64-default-colormap",
    "x86_64-unknown-linux-gnu",
  ],
  [
    "20261024-registration-retirement-lf-linuxarm-cross-sysroot-20261023-334-3",
    "20261025-registration-retirement-linuxarm-cross-sysroot-default-colormap",
    "aarch64-unknown-linux-gnu",
  ],
];
const bytes = (relative) => readFile(path.join(ROOT, relative));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = async (relative) => JSON.parse(await bytes(relative));
const patch = await bytes(`${PATCH_ROOT}/${PATCH}`);

function projected(after) {
  return patch
    .toString()
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith(" ") ||
        (line.startsWith(after ? "+" : "-") &&
          !line.startsWith(after ? "+++" : "---")),
    )
    .map((line) => line.slice(1))
    .join("\n");
}
function command(executable, args, cwd, timeout = 30_000) {
  return spawnSync(executable, args, {
    cwd,
    timeout,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}
async function scratch(t) {
  const parent = path.join(ROOT, ".artifacts");
  await mkdir(parent, { recursive: true });
  const base = await realpath(parent);
  const directory = await mkdtemp(path.join(base, "x11-colormap-test-"));
  const identity = await lstat(directory, { bigint: true });
  t.after(async () => {
    const current = await lstat(directory, { bigint: true });
    assert(!current.isSymbolicLink());
    assert.equal(current.dev, identity.dev);
    assert.equal(current.ino, identity.ino);
    assert.equal(await realpath(directory), directory);
    await rm(directory, { recursive: true });
  });
  return directory;
}

test("patch changes only the owned CEF child default-visual colormap before CreateWindow", async () => {
  assert.deepEqual(patch.toString().match(/^diff --git .+$/gm), [
    `diff --git a/${SOURCE} b/${SOURCE}`,
  ]);
  assert(
    !patch
      .toString()
      .split(/\r?\n/)
      .some((line) => line.startsWith("-") && !line.startsWith("---")),
  );
  const after = projected(true);
  assert(
    after.includes("ChooseVisualForWindow(\n      /*want_argb_visual=*/false"),
  );
  assert(
    after.includes(
      "if (visual == connection_->default_root_visual().visual_id &&\n      colormap == x11::ColorMap{}) {\n    colormap = connection_->default_screen().default_colormap;\n  }",
    ),
  );
  assert(
    after.indexOf("colormap = connection_->default_screen()") <
      after.indexOf("xwindow_ = connection_->GenerateId"),
  );
  assert(!projected(false).includes("default_screen().default_colormap"));
  const series = (await bytes(`${PATCH_ROOT}/series`))
    .toString()
    .split(/\r?\n/);
  assert.equal(series.filter((line) => line === `cef ${PATCH}`).length, 1);
  const pristine = (await json(`${PATCH_ROOT}/upstream-sha256.json`)).filter(
    (row) => row.project === "cef" && row.path === SOURCE,
  );
  assert.deepEqual(pristine, [
    {
      project: "cef",
      path: SOURCE,
      sha256:
        "0ccac4e8f1f8371e42bec473e2b60016f4f68370c3e072d7e44f42c50da3303a",
    },
  ]);
});

test("actual patched C++ guard changes default+zero only; old fragment leaves inherited zero", async (t) => {
  const compiler = ["clang++", "g++"].find(
    (name) => command(name, ["--version"], ROOT, 5000).status === 0,
  );
  if (!compiler)
    return t.skip("A bounded standalone C++ compiler is not installed");
  const directory = await scratch(t);
  const actual = projected(true)
    .split("/*visual_has_alpha=*/nullptr);")[1]
    ?.split("  xwindow_ =")[0];
  assert(
    actual?.includes("default_screen().default_colormap"),
    "Compile the complete intervening actual hunk, including comments",
  );
  const before = projected(false)
    .split("/*visual_has_alpha=*/nullptr);")[1]
    ?.split("  xwindow_ =")[0];
  assert.equal(
    before.trim(),
    "",
    "The pristine complete hunk has no intervening colormap correction",
  );
  const source = `namespace x11 { enum class ColorMap : unsigned {}; }
struct Connection { struct Visual { unsigned visual_id; }; struct Screen { x11::ColorMap default_colormap; }; Visual default_root_visual(){return {33};} Screen default_screen(){return {x11::ColorMap{17}};} };
unsigned current(unsigned visual, x11::ColorMap colormap) { Connection connection; auto* connection_=&connection;
${actual}
return static_cast<unsigned>(colormap); }
unsigned previous(unsigned visual, x11::ColorMap colormap) { Connection connection; auto* connection_=&connection;
${before}
return static_cast<unsigned>(colormap); }
int main(int argc,char**){
if(argc>1) return previous(33,x11::ColorMap{})==17 ? 0 : 23;
if(current(33,x11::ColorMap{})!=17) return 1;
if(current(33,x11::ColorMap{99})!=99) return 2;
if(current(463,x11::ColorMap{})!=0) return 3;
if(current(463,x11::ColorMap{99})!=99) return 4;
if(current(0,x11::ColorMap{})!=0) return 5;
if(previous(33,x11::ColorMap{})!=0) return 6;
return 0; }
`;
  const input = path.join(directory, "guard.cc"),
    output = path.join(
      directory,
      process.platform === "win32" ? "guard.exe" : "guard",
    );
  await writeFile(input, source);
  const compiled = command(
    compiler,
    ["-std=c++17", input, "-o", output],
    directory,
  );
  assert.equal(compiled.status, 0, compiled.stderr);
  const previous = command(output, ["before"], directory, 10_000);
  assert.equal(
    previous.status,
    23,
    "Pristine statements reproduce inherited-zero mismatch before the correction",
  );
  t.diagnostic(
    "actual pristine fragment RED exit23; actual patched fragment GREEN exit0 (standalone colormap contract, not X server acceptance)",
  );
  const result = command(output, [], directory, 10_000);
  assert.equal(result.status, 0, result.stderr);
});

test("new R4 namespaces preserve every inherited payload and append only the reviewed patch", async () => {
  for (const [oldName, newName, target] of namespaces) {
    const oldRoot = `native/cef-build-inputs/${oldName}`,
      nextRoot = `native/cef-build-inputs/${newName}`;
    const old = await json(`${oldRoot}/source-lock.json`),
      next = await json(`${nextRoot}/source-lock.json`),
      review = await json(`${nextRoot}/review-receipt.json`);
    assert.equal(old.patches.length, 12);
    assert.equal(next.patches.length, 13);
    const expected = structuredClone(old);
    expected.patches.push({
      path: `patches/${PATCH}`,
      repository: "cef",
      sha256: hash(patch),
    });
    assert.deepEqual(next, expected);
    assert.equal(next.bridge.abiVersion, 2);
    assert.equal(next.bridge.patchId, "sorng-tls-v2-682c378-4");
    assert.equal(next.bridge.capabilities.length, 8);
    assert.equal(review.baseIdentity, identitySha256(old));
    assert.equal(review.sourceLockIdentity, identitySha256(next));
    assert.notEqual(identitySha256(next), identitySha256(old));
    assert.equal(
      review.sourceLockRawSha256,
      hash(await bytes(`${nextRoot}/source-lock.json`)),
    );
    assert.equal(review.engineCompiled, false);
    assert.equal(review.nativeAcceptancePerformed, false);
    assert.equal(review.publicationAllowed, false);
    assert.equal(review.preservedRawFiles.length, 17);
    for (const row of review.preservedRawFiles) {
      const original = await bytes(`${oldRoot}/${row.path}`),
        current = await bytes(`${nextRoot}/${row.path}`);
      assert.deepEqual(current, original);
      assert.equal(current.length, row.size);
      assert.equal(hash(current), row.sha256);
    }
    assert.deepEqual(await bytes(`${nextRoot}/patches/${PATCH}`), patch);
    const reviewed = await plan({
      inputs: nextRoot,
      target,
      checkout: ROOT,
      runnerMode: target.startsWith("aarch64") ? "hosted" : "dedicated",
    });
    assert.deepEqual(reviewed.sourceLock, next);
  }
});

test("source admission rejects changed patch bytes for each new namespace", async (t) => {
  const directory = await scratch(t);
  for (const [, name, target] of namespaces) {
    const local = path.join(directory, target);
    await cp(path.join(ROOT, "native/cef-build-inputs", name), local, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await writeFile(
      path.join(local, "patches", PATCH),
      Buffer.concat([patch, Buffer.from("\n")]),
    );
    await assert.rejects(
      plan({
        inputs: target,
        target,
        checkout: directory,
        runnerMode: target.startsWith("aarch64") ? "hosted" : "dedicated",
      }),
      /Reviewed input mismatch|pin|SHA|bytes|hash|size/i,
    );
  }
});

const R5_NAMESPACE =
  "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap";
const OLD_LINUX_NAMESPACE =
  "native/cef-build-inputs/20261024-registration-retirement-owned-linux-x64";
const WINDOWS22_NAMESPACE =
  "native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64";
const R5_HEADER_SHA =
  "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e";

test("R5 Linux source23 has thirty exact files, LF-preserved predecessor and nine capabilities", async () => {
  const old = await json(OLD_LINUX_NAMESPACE + "/source-lock.json");
  const windows = await json(WINDOWS22_NAMESPACE + "/source-lock.json");
  const next = await json(R5_NAMESPACE + "/source-lock.json");
  const review = await json(R5_NAMESPACE + "/review-receipt.json");
  const expected = structuredClone(old);
  expected.bridge = structuredClone(windows.bridge);
  expected.bridge.header.sha256 = R5_HEADER_SHA;
  expected.patches.push(...windows.patches.slice(12), {
    path: "patches/" + PATCH,
    repository: "cef",
    sha256: hash(patch),
  });
  assert.deepEqual(next, expected);
  assert.equal(next.bridge.patchId, "sorng-tls-v2-682c378-5");
  assert.equal(next.bridge.abiVersion, 2);
  assert.equal(next.bridge.capabilities.length, 9);
  assert(next.bridge.capabilities.includes("owned-http3"));
  assert.deepEqual(old.upstream, windows.upstream);
  assert.equal(next.patches.length, 23);
  assert.equal(
    identitySha256(next),
    "f4c94e74af5ee552cf4370c459973b2298a97c68337e494f24c05dde9a8e3004",
  );
  assert.equal(review.sourceLockIdentity, identitySha256(next));
  assert.equal(
    review.sourceLockRawSha256,
    hash(await bytes(R5_NAMESPACE + "/source-lock.json")),
  );
  assert.equal(review.predecessorIdentity, identitySha256(old));
  assert.equal(review.commonSourceIdentity, identitySha256(windows));
  for (const key of [
    "engineCompiled",
    "engineBuilt",
    "nativeAcceptancePerformed",
    "nativeAcceptancePassed",
    "sdkProduced",
    "publicationAllowed",
  ])
    assert.equal(review[key], false);
  const actual = (
    await readdir(path.join(ROOT, R5_NAMESPACE), { recursive: true })
  )
    .map((p) => p.replaceAll("\\", "/"))
    .sort();
  const files = [];
  for (const name of actual)
    if ((await lstat(path.join(ROOT, R5_NAMESPACE, name))).isFile())
      files.push(name);
  const expectedNames = [
    ...next.patches.map((r) => r.path),
    next.bridge.header.path,
    next.builds[0].gnArgs.path,
    next.builds[0].toolchainLock.path,
    "source-lock.json",
    "owned-image.json",
    "cef-ci-runner-x86_64-unknown-linux-gnu.json",
    "review-receipt.json",
  ].sort();
  assert.equal(files.length, 30);
  assert.deepEqual(files, expectedNames);
  assert.equal(review.pins.length, 29);
  assert.deepEqual(
    review.pins.map((r) => r.path).sort(),
    files.filter((p) => p !== "review-receipt.json"),
  );
  for (const row of review.pins) {
    const body = await bytes(R5_NAMESPACE + "/" + row.path);
    assert.equal(body.length, row.size);
    assert.equal(hash(body), row.sha256);
  }
  for (let i = 0; i < 23; i++) {
    const row = next.patches[i],
      body = await bytes(R5_NAMESPACE + "/" + row.path);
    assert.equal(hash(body), row.sha256);
    const original = await bytes(
      (i < 12
        ? OLD_LINUX_NAMESPACE
        : i < 22
          ? WINDOWS22_NAMESPACE
          : PATCH_ROOT) +
        "/" +
        (i === 22 ? PATCH : row.path),
    );
    assert.deepEqual(body, original);
    assert(
      !body.includes(Buffer.from("\r\n")),
      "POSIX patch payload remains actual LF",
    );
  }
  for (let i = 0; i < 12; i++)
    assert.equal(
      (await bytes(OLD_LINUX_NAMESPACE + "/" + old.patches[i].path))
        .toString()
        .replaceAll("\r\n", "\n"),
      (await bytes(WINDOWS22_NAMESPACE + "/" + windows.patches[i].path))
        .toString()
        .replaceAll("\r\n", "\n"),
    );
  for (const name of review.preservedLinuxConfigurations)
    assert.deepEqual(
      await bytes(R5_NAMESPACE + "/" + name),
      await bytes(OLD_LINUX_NAMESPACE + "/" + name),
    );
  const header = await bytes(R5_NAMESPACE + "/include/cef_sorng_tls_bridge.h");
  assert.equal(header.length, 8886);
  assert.equal(hash(header), R5_HEADER_SHA);
  assert.deepEqual(
    header,
    Buffer.from(
      (await bytes(WINDOWS22_NAMESPACE + "/include/cef_sorng_tls_bridge.h"))
        .toString()
        .replaceAll("\r\n", "\n"),
    ),
  );
  assert(
    (await bytes(".gitattributes"))
      .toString()
      .includes(R5_NAMESPACE + "/** -text -whitespace"),
  );
  assert(
    (await bytes(".prettierignore"))
      .toString()
      .split(/\r?\n/)
      .includes(R5_NAMESPACE + "/"),
  );
  const reviewed = await plan({
    inputs: R5_NAMESPACE,
    target: "x86_64-unknown-linux-gnu",
    checkout: ROOT,
    runnerMode: "dedicated",
  });
  assert.deepEqual(reviewed.sourceLock, next);
});

test("R5 Linux header is an actual Git-derived LF patch14 postimage, not a copied CRLF header", async (t) => {
  const directory = await scratch(t);
  await mkdir(path.join(directory, "include"));
  const name = "include/cef_sorng_tls_bridge.h",
    original = await bytes(OLD_LINUX_NAMESPACE + "/" + name);
  await writeFile(path.join(directory, name), original);
  const p = path.join(
    ROOT,
    R5_NAMESPACE,
    "patches/0014-cef-owned-quic-datagrams.patch",
  );
  const git = (args) => {
    const r = command("git", ["-c", "core.autocrlf=false", ...args], directory);
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  git(["init", "-q"]);
  assert.notEqual(
    hash(original),
    R5_HEADER_SHA,
    "Old bridge4 reproduces the missing-H3 header pin",
  );
  git(["apply", "--check", "--include=" + name, p]);
  git(["apply", "--include=" + name, p]);
  assert.deepEqual(
    await readFile(path.join(directory, name)),
    await bytes(R5_NAMESPACE + "/" + name),
  );
  git(["apply", "--reverse", "--check", "--include=" + name, p]);
  git(["apply", "--reverse", "--include=" + name, p]);
  assert.deepEqual(await readFile(path.join(directory, name)), original);
});

test("R5 Linux source admission denies bridge capability, payload and derived-header drift", async (t) => {
  const directory = await scratch(t);
  for (const variant of ["patch", "header", "capability"]) {
    const local = path.join(directory, variant);
    await cp(path.join(ROOT, R5_NAMESPACE), local, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if (variant === "capability") {
      const lock = JSON.parse(
        await readFile(path.join(local, "source-lock.json")),
      );
      lock.bridge.capabilities.pop();
      await writeFile(
        path.join(local, "source-lock.json"),
        JSON.stringify(lock),
      );
    } else {
      const name =
        variant === "patch"
          ? "patches/0018-chromium-owned-capsule-context-lifetime.patch"
          : "include/cef_sorng_tls_bridge.h";
      await writeFile(
        path.join(local, name),
        Buffer.concat([
          await readFile(path.join(local, name)),
          Buffer.from("\n"),
        ]),
      );
    }
    await assert.rejects(
      plan({
        inputs: variant,
        target: "x86_64-unknown-linux-gnu",
        checkout: directory,
        runnerMode: "dedicated",
      }),
      /capabilit|Reviewed input mismatch|pin|SHA|bytes|hash|size|bridge/i,
    );
  }
});

// This optional real-Git oracle reads only existing pinned public object stores.
// It never reads current worktree content, invokes a hook or changes a vendor index.
test("R5 Linux complete ordered23 replay matches the derived header and reverses to pristine public blobs", async (t) => {
  const publicRoots = {
    chromium: "F:/cef-builds/sorng-20261007/src",
    cef: "F:/cef-builds/sorng-20261007/src/cef",
  };
  const lock = await json(R5_NAMESPACE + "/source-lock.json");
  for (const repo of ["chromium", "cef"])
    if (
      command(
        "git",
        [
          "-C",
          publicRoots[repo],
          "cat-file",
          "-e",
          lock.upstream[repo].commit + "^{commit}",
        ],
        ROOT,
      ).status !== 0
    )
      return t.skip("Pinned public Git objects are not available locally");
  const directory = await scratch(t),
    dirs = {};
  const pristine = [];
  for (const repo of ["chromium", "cef"]) {
    dirs[repo] = path.join(directory, repo);
    await mkdir(dirs[repo]);
    assert.equal(command("git", ["init", "-q"], dirs[repo]).status, 0);
  }
  const names = { chromium: new Set(), cef: new Set() };
  for (const row of lock.patches) {
    const text = (await bytes(R5_NAMESPACE + "/" + row.path)).toString();
    for (const m of text.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)) {
      assert.equal(m[1], m[2]);
      assert(!m[2].includes(".."));
      names[row.repository].add(m[2]);
    }
  }
  for (const repo of ["chromium", "cef"])
    for (const name of [...names[repo]].sort()) {
      const oid = lock.upstream[repo].commit + ":" + name;
      const r = spawnSync(
        "git",
        ["-C", publicRoots[repo], "cat-file", "blob", oid],
        { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      );
      if (r.status !== 0) {
        assert.equal(r.status, 128);
        continue;
      }
      const destination = path.join(dirs[repo], name);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, r.stdout);
      pristine.push({ repo, name, body: r.stdout });
    }
  for (const row of lock.patches) {
    const p = path.join(ROOT, R5_NAMESPACE, row.path);
    for (const mode of [
      ["apply", "--check", p],
      ["apply", p],
      ["apply", "--reverse", "--check", p],
    ]) {
      const r = command(
        "git",
        ["-c", "core.autocrlf=false", ...mode],
        dirs[row.repository],
      );
      assert.equal(r.status, 0, row.path + ": " + r.stderr);
    }
  }
  assert.deepEqual(
    await readFile(path.join(dirs.cef, "include/cef_sorng_tls_bridge.h")),
    await bytes(R5_NAMESPACE + "/include/cef_sorng_tls_bridge.h"),
  );
  assert.equal(
    hash(await readFile(path.join(dirs.cef, SOURCE))),
    "b9fd179fcef5c1e5755be9c9956ab7cc792ff07393ae8760e2601a1e5d9d7a82",
  );
  for (const row of [...lock.patches].reverse()) {
    const r = command(
      "git",
      [
        "-c",
        "core.autocrlf=false",
        "apply",
        "--reverse",
        path.join(ROOT, R5_NAMESPACE, row.path),
      ],
      dirs[row.repository],
    );
    assert.equal(r.status, 0, row.path + ": " + r.stderr);
  }
  for (const row of pristine)
    assert.deepEqual(
      await readFile(path.join(dirs[row.repo], row.name)),
      row.body,
    );
  t.diagnostic(
    "Real Git applies all23 ordered patches and reverses to pinned public preimages; no generator, GN or engine compiler ran",
  );
});
