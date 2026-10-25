import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
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
