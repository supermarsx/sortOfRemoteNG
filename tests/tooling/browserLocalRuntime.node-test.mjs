import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  lstat,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_RUNTIME_SELECTION_FILE,
  main,
  registerLocalRuntime,
  validateLocalRuntimeSelection,
  verifyLocalRuntimeSelection,
} from "../../scripts/lib/browser-local-runtime.mjs";
import {
  parseArguments,
  loadCustomRuntimeInputs,
  runCargo,
  prepare,
} from "../../scripts/browser-app-build.mjs";
import {
  BRIDGE_V2,
  BRIDGE_PATCH_ID,
  UPSTREAM_CEF_COMMIT,
  UPSTREAM_CHROMIUM_COMMIT,
  UPSTREAM_DEPOT_TOOLS_COMMIT,
  identitySha256,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  CEF_PIN,
  TARGETS,
  packageManifest,
} from "../../scripts/browser-runtime-package.mjs";

// Synthetic structural binaries and measured fixture digests, NEVER runnable
// engines, production pins, build attestations or native acceptance evidence.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const pin = (name, bytes) => ({
  path: name,
  sha256: hash(bytes),
  size: Buffer.byteLength(bytes),
});
const inputPin = (name) => ({ path: name, sha256: hash(`synthetic ${name}`) });
const script = fileURLToPath(
  new URL("../../scripts/lib/browser-local-runtime.mjs", import.meta.url),
);

function native(target) {
  const bytes = Buffer.alloc(2048);
  const symbols = [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol];
  const arm = target.startsWith("aarch64");
  if (target.includes("windows")) {
    bytes.write("MZ");
    bytes.writeUInt32LE(128, 60);
    bytes.writeUInt32LE(0x4550, 128);
    bytes.writeUInt16LE(arm ? 0xaa64 : 0x8664, 132);
    bytes.writeUInt16LE(1, 134);
    bytes.writeUInt16LE(240, 148);
    bytes.writeUInt16LE(0x2000, 150);
    bytes.writeUInt16LE(0x20b, 152);
    bytes.writeUInt32LE(512, 264);
    bytes.writeUInt32LE(256, 268);
    bytes.writeUInt32LE(512, 404);
    bytes.writeUInt32LE(1536, 408);
    bytes.writeUInt32LE(512, 412);
    bytes.writeUInt32LE(2, 532);
    bytes.writeUInt32LE(2, 536);
    bytes.writeUInt32LE(560, 540);
    bytes.writeUInt32LE(600, 544);
    bytes.writeUInt32LE(640, 548);
    symbols.forEach((symbol, i) => {
      bytes.writeUInt32LE(1800 + i, 560 + i * 4);
      bytes.writeUInt32LE(800 + i * 128, 600 + i * 4);
      bytes.writeUInt16LE(i, 640 + i * 2);
      bytes.write(symbol, 800 + i * 128);
    });
  } else if (target.includes("linux")) {
    bytes.writeUInt32LE(0x464c457f);
    bytes[4] = 2;
    bytes[5] = 1;
    bytes.writeUInt16LE(3, 16);
    bytes.writeUInt16LE(arm ? 183 : 62, 18);
    bytes.writeBigUInt64LE(128n, 40);
    bytes.writeUInt16LE(64, 58);
    bytes.writeUInt16LE(3, 60);
    bytes.writeUInt32LE(11, 196);
    bytes.writeBigUInt64LE(512n, 216);
    bytes.writeBigUInt64LE(48n, 224);
    bytes.writeUInt32LE(2, 232);
    bytes.writeBigUInt64LE(24n, 248);
    bytes.writeUInt32LE(3, 260);
    bytes.writeBigUInt64LE(800n, 280);
    bytes.writeBigUInt64LE(512n, 288);
    symbols.forEach((symbol, i) => {
      bytes.writeUInt32LE(i * 128, 512 + i * 24);
      bytes[516 + i * 24] = 0x12;
      bytes.writeUInt16LE(1, 518 + i * 24);
      bytes.writeBigUInt64LE(1800n, 520 + i * 24);
      bytes.write(symbol, 800 + i * 128);
    });
  } else {
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(arm ? 0x100000c : 0x1000007, 4);
    bytes.writeUInt32LE(6, 12);
    bytes.writeUInt32LE(1, 16);
    bytes.writeUInt32LE(24, 20);
    bytes.writeUInt32LE(2, 32);
    bytes.writeUInt32LE(24, 36);
    bytes.writeUInt32LE(512, 40);
    bytes.writeUInt32LE(2, 44);
    bytes.writeUInt32LE(800, 48);
    bytes.writeUInt32LE(512, 52);
    symbols.forEach((symbol, i) => {
      bytes.writeUInt32LE(i * 128, 512 + i * 16);
      bytes[516 + i * 16] = 0xf;
      bytes[517 + i * 16] = 1;
      bytes.writeBigUInt64LE(1800n, 520 + i * 16);
      bytes.write(`_${symbol}`, 800 + i * 128);
    });
  }
  return bytes;
}

async function put(root, name, bytes) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return file;
}

async function fixture(t, target = TARGETS[0]) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "cef-local-selection-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = path.join(root, "sdk");
  const artifacts = path.join(root, "artifacts");
  const selectionFile = path.join(root, ".artifacts/cef-local-selection.json");
  const library = target.includes("windows")
    ? "Release/libcef.dll"
    : target.includes("linux")
      ? "Release/libcef.so"
      : "Release/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework";
  const sandbox = target.includes("windows")
    ? "Release/bootstrap.exe"
    : target.includes("linux")
      ? "Release/chrome-sandbox"
      : "Release/libcef_sandbox.dylib";
  const bridge = "synthetic bridge-header byte identity";
  const lock = {
    schemaVersion: 1,
    kind: "sorng-cef-source-lock",
    upstream: {
      cef: {
        repository: "https://github.com/chromiumembedded/cef.git",
        commit: UPSTREAM_CEF_COMMIT,
        version: CEF_PIN.version,
      },
      chromium: {
        repository: "https://chromium.googlesource.com/chromium/src.git",
        commit: UPSTREAM_CHROMIUM_COMMIT,
      },
      depotTools: {
        repository:
          "https://chromium.googlesource.com/chromium/tools/depot_tools.git",
        commit: UPSTREAM_DEPOT_TOOLS_COMMIT,
      },
    },
    patches: [{ repository: "cef", ...inputPin("patches/fixture.patch") }],
    bridge: {
      ...BRIDGE_V2,
      patchId: BRIDGE_PATCH_ID,
      header: { path: "include/cef_sorng_tls_bridge.h", sha256: hash(bridge) },
    },
    builds: [
      {
        target,
        gnArgs: inputPin("gn/fixture.gn"),
        toolchainLock: inputPin("tools/fixture.json"),
      },
    ],
  };
  const sandboxCompat = target.includes("windows") ? CEF_PIN.sandboxCompat : "";
  const files = {
    "archive.json": json({ name: "synthetic local SDK" }),
    "CREDITS.html": "synthetic credits",
    "include/cef_sorng_tls_bridge.h": bridge,
    "include/cef_version.h": `#define CEF_VERSION "${CEF_PIN.version}"\n#define CEF_COMMIT_HASH "${UPSTREAM_CEF_COMMIT}"\n#define CEF_SANDBOX_COMPAT_HASH "${sandboxCompat}"\n`,
    [library]: native(target),
    [sandbox]: "synthetic sandbox bytes; never executed",
  };
  for (const [name, bytes] of Object.entries(files))
    await put(sdk, name, bytes);
  const archive = pin(
    "sorng-cef-custom-fixture.tar.bz2",
    "synthetic archive bytes",
  );
  await put(artifacts, archive.path, "synthetic archive bytes");
  const sdkFiles = Object.entries(files).map(([name, bytes]) => ({
    ...pin(name, bytes),
    type: "file",
  }));
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-build-receipt",
    target,
    sourceLockSha256: identitySha256(lock),
    archiveSha256: archive.sha256,
    sdkInventorySha256: identitySha256(sdkFiles),
    buildInputsSha256: identitySha256(lock.builds[0]),
  };
  await put(artifacts, "receipt.json", json(receipt));
  const manifest = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-runtime",
    sourceLockSha256: identitySha256(lock),
    artifacts: [
      {
        target,
        archive,
        provenance: pin("receipt.json", json(receipt)),
        sdkFiles,
        runtime: {
          library,
          sandbox,
          cefCommit: UPSTREAM_CEF_COMMIT,
          cefVersion: CEF_PIN.version,
          cefApiVersion: 15400,
          cefApiHash: hash("fixture API").slice(0, 40),
          sandboxCompat,
        },
      },
    ],
  };
  const manifestFile = await put(artifacts, "manifest.json", json(manifest));
  const lockFile = await put(root, "source-lock.json", json(lock));
  const options = {
    selectionFile,
    target,
    manifest: manifestFile,
    sourceLock: lockFile,
    sdk,
    artifactRoot: artifacts,
    reviewedManifestSha256: identitySha256(manifest),
    reviewedSourceLockSha256: identitySha256(lock),
  };
  const parse = (args = ["build"], env = {}) =>
    parseArguments([args[0], "--target", target, ...args.slice(1)], env, {
      selectionFile,
    });
  return {
    root,
    sdk,
    artifacts,
    selectionFile,
    library,
    files,
    lock,
    manifest,
    manifestFile,
    lockFile,
    options,
    parse,
    target,
  };
}

async function stored(f) {
  return JSON.parse(await readFile(f.selectionFile, "utf8"));
}

test("default selection is repository-anchored and already ignored", async () => {
  assert.equal(
    LOCAL_RUNTIME_SELECTION_FILE,
    fileURLToPath(
      new URL("../../.artifacts/cef-local-selection.json", import.meta.url),
    ),
  );
  assert.match(
    await readFile(new URL("../../.gitignore", import.meta.url), "utf8"),
    /^\/\.artifacts\/$/m,
  );
});

for (const target of TARGETS)
  test(`registers and selects ${target} without environment or stock fallback`, async (t) => {
    const f = await fixture(t, target);
    const report = await registerLocalRuntime(f.options);
    assert.equal(report.productionReady, false);
    assert.equal(report.nativeAcceptance, "not-tested");
    assert.equal(report.sourceAuthenticity, "not-established-by-hashes");
    const selection = validateLocalRuntimeSelection(await stored(f));
    const entry = selection.targets[target];
    for (const field of ["manifest", "sourceLock", "sdk", "artifactRoot"]) {
      assert.equal(path.isAbsolute(entry[field]), false);
      assert.ok(!entry[field].includes("\\"));
    }
    assert.equal(entry.manifestSha256, identitySha256(f.manifest));
    assert.equal(entry.sourceLockSha256, identitySha256(f.lock));
    for (const mode of ["build", "dev"]) {
      const options = f.parse([mode]);
      assert.equal(options.runtimeKind, "custom");
      assert.equal(options.download, false);
      assert.equal(options.sdk, f.sdk);
      assert.equal(options.customManifest, f.manifestFile);
      assert.equal(options.sourceLock, f.lockFile);
      assert.equal(options.artifactRoot, f.artifacts);
      assert.equal(
        (await loadCustomRuntimeInputs(options)).preflight.filesVerified,
        Object.keys(f.files).length,
      );
    }
    assert.deepEqual(await readdir(path.dirname(f.selectionFile)), [
      "cef-local-selection.json",
    ]);
  });

test("ordinary builds fail closed with no selector even when an official SDK/env is supplied", async (t) => {
  const f = await fixture(t);
  for (const env of [
    {},
    { CEF_PATH: "stock-sdk" },
    { SORNG_CEF_SDK: "stock-sdk", SORNG_CEF_ARCHIVE: "stock.tar.bz2" },
    { SORNG_CEF_ACQUIRE: "1" },
  ])
    assert.throws(
      () => f.parse(["build"], env),
      /Patched CEF selection is required/,
    );
  assert.throws(
    () => f.parse(["build"], { SORNG_CEF_RUNTIME_KIND: "official" }),
    /explicit --cef-runtime-kind official/,
  );
  assert.throws(
    () => f.parse(["build", "--cef-download"]),
    /reviewed release catalog.*--cef-download is unavailable/,
  );
  await assert.rejects(
    prepare({ target: f.target, runtimeKind: undefined }, {}),
    /no official fallback/,
  );
  await assert.rejects(lstat(f.selectionFile), { code: "ENOENT" });
});

test("complete supplied custom flags/env still work without a selector", async (t) => {
  const f = await fixture(t);
  const env = {
    SORNG_CEF_CUSTOM_MANIFEST: f.manifestFile,
    SORNG_CEF_SOURCE_LOCK: f.lockFile,
    SORNG_CEF_SDK: f.sdk,
  };
  const options = f.parse(["build"], env);
  assert.equal(options.runtimeKind, "custom");
  assert.equal(options.localRuntimeSelection, undefined);
  assert.equal(
    (await loadCustomRuntimeInputs(options)).preflight.productionReady,
    false,
  );
  assert.throws(
    () => f.parse(["build"], { SORNG_CEF_CUSTOM_MANIFEST: f.manifestFile }),
    /requires manifest, source lock and SDK/,
  );
});

test("file/env/flag conflicts are rejected rather than merged", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  for (const key of [
    "SORNG_CEF_CUSTOM_MANIFEST",
    "SORNG_CEF_SOURCE_LOCK",
    "SORNG_CEF_SDK",
    "SORNG_CEF_ARTIFACT_ROOT",
    "SORNG_CEF_ARCHIVE",
    "CEF_PATH",
  ])
    assert.throws(
      () => f.parse(["build"], { [key]: path.join(f.root, "other") }),
      /conflicts/,
    );
  assert.throws(
    () =>
      f.parse(["build", "--cef-sdk", f.sdk], { SORNG_CEF_SDK: "different" }),
    /Conflicting/,
  );
  assert.throws(
    () => f.parse(["build"], { SORNG_CEF_SDK: f.sdk, CEF_PATH: "different" }),
    /Conflicting/,
  );
  assert.throws(() => f.parse(["build", "--cef-download"]), /acquisition/);
  const matching = f.parse(["build"], {
    SORNG_CEF_SDK: f.sdk,
    SORNG_CEF_SOURCE_LOCK: f.lockFile,
  });
  assert.equal(matching.customManifest, f.manifestFile);
  assert.equal(matching.sourceLock, f.lockFile);
  assert.equal(matching.artifactRoot, f.artifacts);
});

test("explicit official development override remains separate, never native admission", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  const options = f.parse([
    "build",
    "--cef-runtime-kind=official",
    "--cef-sdk=development-sdk",
    "--cef-no-download",
  ]);
  assert.equal(options.runtimeKind, "official");
  assert.equal(options.officialRuntimeExplicit, true);
  assert.equal(options.localRuntimeSelection, undefined);
  assert.equal(options.download, false);
  assert.throws(
    () =>
      f.parse(["build", "--cef-runtime-kind=official"], {
        SORNG_CEF_CUSTOM_MANIFEST: f.manifestFile,
      }),
    /conflict/,
  );
});

for (const [name, mutate] of [
  [
    "unknown schema",
    (s) => {
      s.schemaVersion = 2;
    },
  ],
  [
    "empty targets",
    (s) => {
      s.targets = {};
    },
  ],
  [
    "missing selected target",
    (s) => {
      s.targets[TARGETS[1]] = s.targets[TARGETS[0]];
      delete s.targets[TARGETS[0]];
    },
  ],
  [
    "unexpected readiness claim",
    (s) => {
      s.productionReady = true;
    },
  ],
  [
    "absolute path",
    (s) => {
      s.targets[TARGETS[0]].sdk = "/sdk";
    },
  ],
  [
    "Windows absolute path",
    (s) => {
      s.targets[TARGETS[0]].sdk = "C:\\sdk";
    },
  ],
  [
    "null identity",
    (s) => {
      s.targets[TARGETS[0]].manifestSha256 = null;
    },
  ],
  [
    "stale manifest identity",
    (s) => {
      s.targets[TARGETS[0]].manifestSha256 = hash("stale");
    },
  ],
])
  test(`fails closed for ${name}, even with a complete custom environment`, async (t) => {
    const f = await fixture(t);
    await registerLocalRuntime(f.options);
    const selection = await stored(f);
    mutate(selection);
    await writeFile(f.selectionFile, json(selection));
    assert.throws(() => f.parse());
    assert.throws(() =>
      f.parse(["build"], {
        SORNG_CEF_CUSTOM_MANIFEST: f.manifestFile,
        SORNG_CEF_SOURCE_LOCK: f.lockFile,
        SORNG_CEF_SDK: f.sdk,
      }),
    );
  });

test("corrupt selector and missing manifest/lock never silently fall back", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  const before = await readFile(f.selectionFile);
  await writeFile(f.selectionFile, "{broken");
  assert.throws(() => f.parse(), /Corrupt runtime JSON/);
  await writeFile(f.selectionFile, before);
  await rm(f.manifestFile);
  assert.throws(() => f.parse(), { code: "ENOENT" });
  await writeFile(f.manifestFile, json(f.manifest));
  await rm(f.lockFile);
  assert.throws(() => f.parse(), { code: "ENOENT" });
});

test("selection identities survive JSON formatting but not reviewed input changes", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  await writeFile(f.manifestFile, JSON.stringify(f.manifest));
  const options = f.parse();
  assert.ok(verifyLocalRuntimeSelection(options.localRuntimeSelection));
  f.lock.builds[0].gnArgs.sha256 = hash("changed build input");
  await writeFile(f.lockFile, json(f.lock));
  assert.throws(() => f.parse(), /Stale local runtime/);
  await assert.rejects(loadCustomRuntimeInputs(options), /Stale local runtime/);
});

test("preparation still checks every current SDK/archive byte after selection", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  const options = f.parse();
  await put(f.sdk, "CREDITS.html", "changed bytes");
  await assert.rejects(
    loadCustomRuntimeInputs(options),
    /Digest\/size mismatch/,
  );
  await put(f.sdk, "CREDITS.html", f.files["CREDITS.html"]);
  await put(
    f.artifacts,
    f.manifest.artifacts[0].archive.path,
    "changed archive",
  );
  await assert.rejects(
    loadCustomRuntimeInputs(options),
    /Digest\/size mismatch/,
  );
});

test("registration requires independent identities and preflight before any selector is created", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    registerLocalRuntime({
      ...f.options,
      reviewedManifestSha256: hash("not reviewed"),
    }),
    /Stale local runtime/,
  );
  await put(f.sdk, "CREDITS.html", "wrong bytes");
  await assert.rejects(
    registerLocalRuntime(f.options),
    /Digest\/size mismatch/,
  );
  await assert.rejects(lstat(path.dirname(f.selectionFile)), {
    code: "ENOENT",
  });
});

test("registration does not accept symbol text without defined V2 exports", async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from(`${BRIDGE_V2.symbol}\n${BRIDGE_V2.factorySymbol}`);
  await put(f.sdk, f.library, bytes);
  const sdkFiles = f.manifest.artifacts[0].sdkFiles;
  Object.assign(
    sdkFiles.find((entry) => entry.path === f.library),
    pin(f.library, bytes),
  );
  const receiptFile = path.join(f.artifacts, "receipt.json");
  const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  receipt.sdkInventorySha256 = identitySha256(sdkFiles);
  await writeFile(receiptFile, json(receipt));
  f.manifest.artifacts[0].provenance = pin("receipt.json", json(receipt));
  await writeFile(f.manifestFile, json(f.manifest));
  await assert.rejects(
    registerLocalRuntime({
      ...f.options,
      reviewedManifestSha256: identitySha256(f.manifest),
    }),
    /PE DLL/,
  );
  await assert.rejects(lstat(f.selectionFile), { code: "ENOENT" });
});

test("target additions preserve existing entries and replacement requires explicit review", async (t) => {
  const first = await fixture(t, TARGETS[0]);
  const second = await fixture(t, TARGETS[1]);
  await registerLocalRuntime(first.options);
  const original = await stored(first);
  await registerLocalRuntime({
    ...second.options,
    selectionFile: first.selectionFile,
  });
  assert.deepEqual(
    (await stored(first)).targets[TARGETS[0]],
    original.targets[TARGETS[0]],
  );
  const before = await readFile(first.selectionFile);
  await assert.rejects(registerLocalRuntime(first.options), /--replace/);
  assert.deepEqual(await readFile(first.selectionFile), before);
  await registerLocalRuntime({ ...first.options, replace: true });
  assert.deepEqual(await readFile(first.selectionFile), before);
  const parsed = parseArguments(
    ["build", "--target", second.target],
    {},
    { selectionFile: first.selectionFile },
  );
  assert.equal(parsed.sdk, second.sdk);
});

test("failed replacement, corrupt registry, and another writer's lock preserve existing bytes", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  const before = await readFile(f.selectionFile);
  await put(f.sdk, "CREDITS.html", "changed bytes");
  await assert.rejects(registerLocalRuntime({ ...f.options, replace: true }));
  assert.deepEqual(await readFile(f.selectionFile), before);
  await put(f.sdk, "CREDITS.html", f.files["CREDITS.html"]);
  await writeFile(`${f.selectionFile}.lock`, "other writer");
  await assert.rejects(registerLocalRuntime({ ...f.options, replace: true }), {
    code: "EEXIST",
  });
  assert.equal(
    await readFile(`${f.selectionFile}.lock`, "utf8"),
    "other writer",
  );
  await rm(`${f.selectionFile}.lock`);
  await writeFile(f.selectionFile, "{broken");
  await assert.rejects(
    registerLocalRuntime({ ...f.options, replace: true }),
    /Corrupt/,
  );
  assert.equal(await readFile(f.selectionFile, "utf8"), "{broken");
  assert.deepEqual(await readdir(path.dirname(f.selectionFile)), [
    "cef-local-selection.json",
  ]);
});

test("selector writes cannot contaminate the verified SDK", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    registerLocalRuntime({
      ...f.options,
      selectionFile: path.join(f.sdk, "selection.json"),
    }),
    /outside the SDK/,
  );
  await assert.rejects(lstat(path.join(f.sdk, "selection.json")), {
    code: "ENOENT",
  });
});

test("watcher runner rechecks local identities before prepared verification or Cargo", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  const options = f.parse();
  const binding = options.localRuntimeSelection;
  const selection = await stored(f);
  selection.targets[f.target].sdk = "../other-sdk";
  await writeFile(f.selectionFile, json(selection));
  assert.throws(
    () => verifyLocalRuntimeSelection(binding),
    /selection changed/,
  );
  const planFile = await put(
    f.root,
    "plan.json",
    json({
      target: f.target,
      platform: packageManifest(f.target).platform,
      cargoTarget: f.root,
      sdk: f.sdk,
      localRuntimeSelection: binding,
      customRuntime: {},
    }),
  );
  // Even a regression in the local check meets an invalid prepared fixture,
  // which fails before any child process; this test never runs Cargo.
  await assert.rejects(
    runCargo(["build"], { SORNG_CEF_BUILD_PLAN: planFile }),
    /selection changed/,
  );
});

test("registration CLI is deliberate and rejects incomplete/ambiguous input", async (t) => {
  const f = await fixture(t);
  assert.match(await main(["--help"]), /independently reviewed/);
  for (const args of [
    ["register"],
    ["register", "--replace=yes"],
    ["register", "--target=x", "--target=y"],
    ["register", "--execute"],
  ])
    await assert.rejects(main(args));
  const args = [
    "register",
    "--selection",
    f.selectionFile,
    "--target",
    f.target,
    "--manifest",
    f.manifestFile,
    "--lock",
    f.lockFile,
    "--sdk",
    f.sdk,
    "--artifact-root",
    f.artifacts,
    "--reviewed-manifest-sha256",
    f.options.reviewedManifestSha256,
    "--reviewed-source-lock-sha256",
    f.options.reviewedSourceLockSha256,
  ];
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [script, ...args],
    { windowsHide: true },
  );
  assert.equal(JSON.parse(stdout).productionReady, false);
  assert.equal(f.parse().runtimeKind, "custom");
});

test("concurrent registration cannot publish partial JSON or discard a completed target", async (t) => {
  const first = await fixture(t, TARGETS[0]);
  const second = await fixture(t, TARGETS[1]);
  const results = await Promise.allSettled([
    registerLocalRuntime(first.options),
    registerLocalRuntime({
      ...second.options,
      selectionFile: first.selectionFile,
    }),
  ]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  const selection = validateLocalRuntimeSelection(await stored(first));
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled")
      assert.ok(selection.targets[TARGETS[index]]);
    else assert.equal(result.reason.code, "EEXIST");
  }
  assert.deepEqual(await readdir(path.dirname(first.selectionFile)), [
    "cef-local-selection.json",
  ]);
});

test("runner refuses a missing custom-runtime record rather than entering stock Cargo path", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  const planFile = await put(
    f.root,
    "incomplete-plan.json",
    json({
      target: f.target,
      localRuntimeSelection: f.parse().localRuntimeSelection,
      runtimeKind: "custom",
    }),
  );
  // Failure precedes command construction and all subprocess execution.
  await assert.rejects(
    runCargo(["build"], { SORNG_CEF_BUILD_PLAN: planFile }),
    /no verified custom runtime/,
  );
});

test("reviewed identity changes during asynchronous preflight are rejected", async (t) => {
  const f = await fixture(t);
  await registerLocalRuntime(f.options);
  const pending = loadCustomRuntimeInputs(f.parse());
  // The first synchronous identity read has finished, but byte preflight has
  // yielded. A newly edited manifest must not be accepted as reviewed input.
  f.manifest.artifacts[0].runtime.cefApiHash = hash("changed API").slice(0, 40);
  writeFileSync(f.manifestFile, json(f.manifest));
  await assert.rejects(pending, /Stale local runtime/);
});
