import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  lstat,
  symlink,
  readlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inventoryCustomArtifact,
  main,
  parseArguments,
} from "../../scripts/cef-custom-artifact-inventory.mjs";
import {
  BRIDGE_V2,
  BRIDGE_PATCH_ID,
  UPSTREAM_CEF_COMMIT,
  UPSTREAM_CHROMIUM_COMMIT,
  UPSTREAM_DEPOT_TOOLS_COMMIT,
  identitySha256,
  preflightCustomRuntime,
  validateCustomRuntimeManifest,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { CEF_PIN, TARGETS } from "../../scripts/browser-runtime-package.mjs";

// All archive/native/build bytes below are SYNTHETIC, non-executable fixtures.
// Their measured hashes are NEVER production pins or native-acceptance evidence.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const pin = (name, bytes) => ({ path: name, sha256: hash(bytes) });
const script = fileURLToPath(
  new URL("../../scripts/cef-custom-artifact-inventory.mjs", import.meta.url),
);
const bridgeBytes = await readFile(
  new URL("../../native/cef-patches/cef_sorng_tls_bridge.h", import.meta.url),
);

// Structural tables exercise actual PE/ELF/Mach-O inspectors without loading.
function native(target, symbols = [], library = false) {
  const bytes = Buffer.alloc(2048);
  const arm = target.startsWith("aarch64");
  if (target.includes("windows")) {
    bytes.write("MZ");
    bytes.writeUInt32LE(128, 60);
    bytes.writeUInt32LE(0x4550, 128);
    bytes.writeUInt16LE(arm ? 0xaa64 : 0x8664, 132);
    bytes.writeUInt16LE(1, 134);
    bytes.writeUInt16LE(240, 148);
    bytes.writeUInt16LE(library ? 0x2000 : 0, 150);
    bytes.writeUInt16LE(0x20b, 152);
    bytes.writeUInt32LE(512, 264);
    bytes.writeUInt32LE(256, 268);
    bytes.writeUInt32LE(512, 404);
    bytes.writeUInt32LE(1536, 408);
    bytes.writeUInt32LE(512, 412);
    bytes.writeUInt32LE(symbols.length, 532);
    bytes.writeUInt32LE(symbols.length, 536);
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
    bytes.writeBigUInt64LE(BigInt(symbols.length * 24), 224);
    bytes.writeUInt32LE(2, 232);
    bytes.writeBigUInt64LE(24n, 248);
    bytes.writeUInt32LE(3, 260);
    bytes.writeBigUInt64LE(800n, 280);
    bytes.writeBigUInt64LE(512n, 288);
    symbols.forEach((symbol, i) => {
      const entry = 512 + i * 24;
      bytes.writeUInt32LE(i * 128, entry);
      bytes[entry + 4] = 0x12;
      bytes.writeUInt16LE(1, entry + 6);
      bytes.writeBigUInt64LE(1800n, entry + 8);
      bytes.write(symbol, 800 + i * 128);
    });
  } else {
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(arm ? 0x100000c : 0x1000007, 4);
    bytes.writeUInt32LE(library ? 6 : 2, 12);
    bytes.writeUInt32LE(1, 16);
    bytes.writeUInt32LE(24, 20);
    bytes.writeUInt32LE(2, 32);
    bytes.writeUInt32LE(24, 36);
    bytes.writeUInt32LE(512, 40);
    bytes.writeUInt32LE(symbols.length, 44);
    bytes.writeUInt32LE(800, 48);
    bytes.writeUInt32LE(512, 52);
    symbols.forEach((symbol, i) => {
      const entry = 512 + i * 16;
      bytes.writeUInt32LE(i * 128, entry);
      bytes[entry + 4] = 0xf;
      bytes[entry + 5] = 1;
      bytes.writeBigUInt64LE(1800n, entry + 8);
      bytes.write(`_${symbol}`, 800 + i * 128);
    });
  }
  return bytes;
}

async function put(root, name, bytes) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

async function fixture(t, target = TARGETS[0]) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sorng-cef-inventory-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = path.join(root, "sdk");
  const artifacts = path.join(root, "artifacts");
  await mkdir(artifacts);
  const windows = target.includes("windows"),
    linux = target.includes("linux");
  const library = windows
    ? "Release/libcef.dll"
    : linux
      ? "Release/libcef.so"
      : "Release/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework";
  const sandbox = windows
    ? "Release/bootstrap.exe"
    : linux
      ? "Release/chrome-sandbox"
      : "Release/Chromium Embedded Framework.framework/Versions/A/Libraries/libcef_sandbox.dylib";
  const files = {
    "include/cef_version.h": `#ifndef CEF_INCLUDE_CEF_VERSION_H_\n#define CEF_INCLUDE_CEF_VERSION_H_\n#define CEF_VERSION "${CEF_PIN.version}"\n#define CEF_COMMIT_HASH "${UPSTREAM_CEF_COMMIT}"\n#define CEF_SANDBOX_COMPAT_HASH "${windows ? CEF_PIN.sandboxCompat : ""}"\n${CEF_PIN.chromium
      .split(".")
      .map(
        (v, i) =>
          `#define CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][i]} ${v}`,
      )
      .join("\n")}\n#endif\n`,
    "include/cef_api_versions.h": `#ifndef CEF_INCLUDE_CEF_API_VERSIONS_H_\n#define CEF_INCLUDE_CEF_API_VERSIONS_H_\n#define CEF_API_VERSION_15400 15400\n#define CEF_API_VERSION_LAST CEF_API_VERSION_15400\n#if defined(OS_WIN)\n#define CEF_API_HASH_15400 "${hash("fixture Windows API").slice(0, 40)}"\n#elif defined(OS_MAC)\n#define CEF_API_HASH_15400 "${hash("fixture macOS API").slice(0, 40)}"\n#elif defined(OS_LINUX)\n#define CEF_API_HASH_15400 "${hash("fixture Linux API").slice(0, 40)}"\n#endif\n#endif\n`,
    "include/cef_sorng_tls_bridge.h": bridgeBytes,
    "archive.json": json({ type: "minimal", name: "synthetic custom fixture" }),
    "CREDITS.html": "synthetic test credits",
    "Resources/empty-file": Buffer.alloc(0),
    [library]: native(
      target,
      [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol],
      true,
    ),
    [sandbox]: native(target, [], target.includes("apple")),
  };
  for (const [name, bytes] of Object.entries(files))
    await put(sdk, name, bytes);
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
    patches: [
      {
        repository: "cef",
        ...pin("patches/fixture.patch", "synthetic patch bytes"),
      },
    ],
    bridge: {
      ...BRIDGE_V2,
      patchId: BRIDGE_PATCH_ID,
      header: pin("include/cef_sorng_tls_bridge.h", bridgeBytes),
    },
    builds: [
      {
        target,
        gnArgs: pin("gn/fixture.gn", "synthetic args"),
        toolchainLock: pin("tools/fixture.json", "synthetic tools"),
      },
    ],
  };
  const archive = "sorng-cef-custom-fixture.tar.bz2";
  const archiveBytes = Buffer.from(
    "synthetic archive bytes; not an extracted/runnable distribution",
  );
  await put(artifacts, archive, archiveBytes);
  await put(root, "lock.json", json(lock));
  const options = {
    lock: path.join(root, "lock.json"),
    target,
    "artifact-root": artifacts,
    sdk,
    archive,
    manifest: "reviewed-artifact.json",
    receipt: "build-receipt.json",
  };
  return {
    root,
    sdk,
    artifacts,
    files,
    lock,
    library,
    sandbox,
    options,
    archiveBytes,
  };
}

async function outputs(f) {
  const manifest = JSON.parse(
    await readFile(path.join(f.artifacts, f.options.manifest), "utf8"),
  );
  const receipt = JSON.parse(
    await readFile(path.join(f.artifacts, f.options.receipt), "utf8"),
  );
  return { manifest, receipt };
}

async function noOutputs(f) {
  for (const name of [f.options.manifest, f.options.receipt])
    await assert.rejects(lstat(path.join(f.artifacts, name)), {
      code: "ENOENT",
    });
}

for (const target of TARGETS)
  test(`measures ${target} bytes/headers/exports and emits schema-compatible pins`, async (t) => {
    const f = await fixture(t, target);
    const result = await inventoryCustomArtifact(f.options);
    const { manifest, receipt } = await outputs(f);
    validateCustomRuntimeManifest(manifest, f.lock);
    const artifact = manifest.artifacts[0];
    assert.equal(artifact.archive.sha256, hash(f.archiveBytes));
    assert.equal(artifact.archive.size, f.archiveBytes.length);
    assert.equal(
      artifact.provenance.sha256,
      hash(await readFile(path.join(f.artifacts, f.options.receipt))),
    );
    for (const entry of artifact.sdkFiles) {
      assert.equal(entry.type, "file");
      const bytes = Buffer.from(f.files[entry.path]);
      assert.equal(entry.sha256, hash(bytes));
      assert.equal(entry.size, bytes.length);
    }
    assert.deepEqual(
      artifact.sdkFiles.map((entry) => entry.path),
      Object.keys(f.files).sort(),
    );
    assert.equal(artifact.runtime.library, f.library);
    assert.equal(artifact.runtime.sandbox, f.sandbox);
    const platform = target.includes("windows")
      ? "Windows"
      : target.includes("linux")
        ? "Linux"
        : "macOS";
    assert.equal(
      artifact.runtime.cefApiHash,
      hash(`fixture ${platform} API`).slice(0, 40),
    );
    assert.equal(receipt.sourceLockSha256, identitySha256(f.lock));
    assert.equal(receipt.sdkInventorySha256, identitySha256(artifact.sdkFiles));
    assert.equal(receipt.buildInputsSha256, identitySha256(f.lock.builds[0]));
    const preflight = await preflightCustomRuntime({
      manifest,
      sourceLock: f.lock,
      target,
      artifactRoot: f.artifacts,
      sdkRoot: f.sdk,
    });
    assert.equal(preflight.productionReady, false);
    assert.deepEqual(result.exports, [
      BRIDGE_V2.symbol,
      BRIDGE_V2.factorySymbol,
    ]);
    assert.equal(result.reviewRequired, true);
    assert.equal(result.sourceAuthenticity, "not-established-by-hashes");
    assert.equal(result.nativeAcceptance, "not-tested");
    assert.equal(result.productionReady, false);
    assert.equal(result.runtimeCapability, "not-probed");
    assert.match(result.archiveSdkRelationship, /not-extraction-tested/);
    assert.match(result.buildInputs, /not-build-execution-attestation/);
  });

test("CLI is explicit, local-only, and rejects duplicate/unknown/missing options", async () => {
  assert.match(await main(["--help"]), /Source authenticity is not/);
  for (const args of [
    ["--target", "x", "--target", "y"],
    ["--execute"],
    ["--lock"],
    ["--archive=stock.tar.bz2"],
    ["--help", "--target=x"],
  ])
    assert.throws(() => parseArguments(args));
});

test("standalone CLI emits JSON report and never overwrites on retry", async (t) => {
  const f = await fixture(t);
  const args = Object.entries(f.options).flatMap(([key, value]) => [
    `--${key}`,
    value,
  ]);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [script, ...args],
    { windowsHide: true },
  );
  assert.equal(JSON.parse(stdout).nativeAcceptance, "not-tested");
  const before = await outputs(f);
  await assert.rejects(
    promisify(execFile)(process.execPath, [script, ...args], {
      windowsHide: true,
    }),
    /already exists/,
  );
  assert.deepEqual(await outputs(f), before);
});

const invalidHeaders = [
  [
    "HEAD version",
    "include/cef_version.h",
    (s) =>
      s.replace(
        CEF_PIN.version,
        "154.0.0-HEAD.3631+g682c378+chromium-154.0.8037.58",
      ),
  ],
  [
    "wrong commit",
    "include/cef_version.h",
    (s) => s.replace(UPSTREAM_CEF_COMMIT, "1".repeat(40)),
  ],
  [
    "wrong Chromium",
    "include/cef_version.h",
    (s) => s.replace("CHROME_VERSION_BUILD 8037", "CHROME_VERSION_BUILD 8038"),
  ],
  [
    "sandbox ABI",
    "include/cef_version.h",
    (s) => s.replace(CEF_PIN.sandboxCompat, "0000000000000000"),
  ],
  [
    "duplicate version",
    "include/cef_version.h",
    (s) => `${s}\n#define CEF_VERSION "${CEF_PIN.version}"\n`,
  ],
  [
    "inactive identity",
    "include/cef_version.h",
    (s) => `#if 0\n${s}\n#endif\n`,
  ],
  ["comment-only identity", "include/cef_version.h", (s) => `/*\n${s}\n*/`],
  [
    "undef identity",
    "include/cef_version.h",
    (s) => `${s}\n#undef CEF_VERSION\n`,
  ],
  [
    "unterminated guard",
    "include/cef_version.h",
    (s) => s.replace("#endif", ""),
  ],
  [
    "API selection",
    "include/cef_api_versions.h",
    (s) =>
      s.replace("LAST CEF_API_VERSION_15400", "LAST CEF_API_VERSION_15401"),
  ],
  [
    "API numeric version",
    "include/cef_api_versions.h",
    (s) => s.replace("VERSION_15400 15400", "VERSION_15400 15300"),
  ],
  [
    "missing platform API",
    "include/cef_api_versions.h",
    (s) => s.replace("OS_WIN", "OS_OTHER"),
  ],
  [
    "duplicate platform API",
    "include/cef_api_versions.h",
    (s) =>
      `${s}\n#if defined(OS_WIN)\n#define CEF_API_HASH_15400 "${hash("fixture").slice(0, 40)}"\n#endif\n`,
  ],
  [
    "unscoped API",
    "include/cef_api_versions.h",
    (s) =>
      `${s}\n#define CEF_API_HASH_15400 "${hash("fixture").slice(0, 40)}"\n`,
  ],
  [
    "invalid API hash",
    "include/cef_api_versions.h",
    (s) => s.replace(hash("fixture Windows API").slice(0, 40), "x".repeat(40)),
  ],
  [
    "zero API hash",
    "include/cef_api_versions.h",
    (s) => s.replace(hash("fixture Windows API").slice(0, 40), "0".repeat(40)),
  ],
  ["invalid metadata", "archive.json", () => "not JSON"],
  ["array metadata", "archive.json", () => "[]"],
];
for (const [label, name, mutate] of invalidHeaders)
  test(`rejects ${label} before emitting outputs`, async (t) => {
    const f = await fixture(t);
    await put(f.sdk, name, mutate(f.files[name].toString()));
    await assert.rejects(inventoryCustomArtifact(f.options));
    await noOutputs(f);
  });

test("rejects changed bridge bytes even with plausible macros/declarations", async (t) => {
  const f = await fixture(t);
  await put(
    f.sdk,
    f.lock.bridge.header.path,
    `${bridgeBytes.toString()}\n// changed\n`,
  );
  await assert.rejects(
    inventoryCustomArtifact(f.options),
    /bridge header differs/,
  );
  await noOutputs(f);
});

for (const [label, mutate] of [
  [
    "wrong ABI",
    (s) => s.replace("CEF_SORNG_TLS_ABI_V2 2u", "CEF_SORNG_TLS_ABI_V2 1u"),
  ],
  [
    "missing declaration",
    (s) =>
      s.replace(
        "cef_sorng_tls_get_api_v2(void);",
        "cef_sorng_tls_get_api_v2(void)",
      ),
  ],
])
  test(`rejects pinned malformed bridge: ${label}`, async (t) => {
    const f = await fixture(t);
    const bytes = mutate(bridgeBytes.toString());
    f.lock.bridge.header.sha256 = hash(bytes);
    await put(f.root, "lock.json", json(f.lock));
    await put(f.sdk, f.lock.bridge.header.path, bytes);
    await assert.rejects(
      inventoryCustomArtifact(f.options),
      /bridge declaration|header mismatch/,
    );
    await noOutputs(f);
  });

for (const target of TARGETS)
  test(`rejects missing defined exports and wrong sandbox architecture on ${target}`, async (t) => {
    const f = await fixture(t, target);
    // Symbol text alone, without a defined native export, must not qualify.
    const bytes = native(target, [BRIDGE_V2.symbol], true);
    bytes.write(BRIDGE_V2.factorySymbol, 1500);
    await put(f.sdk, f.library, bytes);
    await assert.rejects(
      inventoryCustomArtifact(f.options),
      /missing defined V2 export/,
    );
    await put(f.sdk, f.library, f.files[f.library]);
    const other = target.startsWith("aarch64")
      ? target.replace("aarch64", "x86_64")
      : target.replace("x86_64", "aarch64");
    await put(
      f.sdk,
      f.library,
      native(other, [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol], true),
    );
    await assert.rejects(
      inventoryCustomArtifact(f.options),
      /architecture\/type mismatch/,
    );
    await put(f.sdk, f.library, Buffer.from("truncated native header"));
    await assert.rejects(inventoryCustomArtifact(f.options));
    await put(f.sdk, f.library, f.files[f.library]);
    await put(f.sdk, f.sandbox, native(other, [], target.includes("apple")));
    await assert.rejects(
      inventoryCustomArtifact(f.options),
      /Native binary does not match|Sandbox Mach-O/,
    );
    await noOutputs(f);
  });

test("rejects unsupported/unpinned target and stock archive names", async (t) => {
  const f = await fixture(t);
  for (const target of ["i686-pc-windows-msvc", TARGETS[1]])
    await assert.rejects(
      inventoryCustomArtifact({ ...f.options, target }),
      /pinned source-lock/,
    );
  await put(f.artifacts, "cef_binary_stock.tar.bz2", f.archiveBytes);
  await assert.rejects(
    inventoryCustomArtifact({
      ...f.options,
      archive: "cef_binary_stock.tar.bz2",
    }),
    /distinct sorng-cef-custom/,
  );
  await noOutputs(f);
});

test("requires explicit selection for duplicate native payloads", async (t) => {
  const f = await fixture(t);
  await put(f.sdk, "Debug/libcef.dll", f.files[f.library]);
  await assert.rejects(inventoryCustomArtifact(f.options), /ambiguous/);
  await inventoryCustomArtifact({
    ...f.options,
    library: f.library,
    sandbox: f.sandbox,
  });
  assert.equal(
    (await outputs(f)).manifest.artifacts[0].runtime.library,
    f.library,
  );
});

test("refuses existing, colliding and input-directory outputs without changing bytes", async (t) => {
  const f = await fixture(t);
  await put(f.artifacts, f.options.receipt, "existing user data");
  await assert.rejects(inventoryCustomArtifact(f.options), /already exists/);
  assert.equal(
    await readFile(path.join(f.artifacts, f.options.receipt), "utf8"),
    "existing user data",
  );
  await assert.rejects(lstat(path.join(f.artifacts, f.options.manifest)), {
    code: "ENOENT",
  });
  await assert.rejects(
    inventoryCustomArtifact({
      ...f.options,
      receipt: "different.json",
      manifest: "DIFFERENT.json",
    }),
    /distinct filenames/,
  );
  await assert.rejects(
    inventoryCustomArtifact({
      ...f.options,
      "artifact-root": f.root,
      archive: `artifacts/${f.options.archive}`,
      receipt: "receipt.json",
      manifest: "sdk/output.json",
    }),
    /outside the supplied SDK/,
  );
});

test("rejects artifact escapes and reserved portable path names", async (t) => {
  const f = await fixture(t);
  for (const manifest of [
    "../outside.json",
    path.join(f.root, "absolute-outside.json"),
    "CON.json",
  ])
    await assert.rejects(
      inventoryCustomArtifact({ ...f.options, manifest }),
      /escapes|Unsafe relative path/,
    );
  await noOutputs(f);
});

test("rejects output parent junction/symlink escape", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    path.join(f.artifacts, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    inventoryCustomArtifact({ ...f.options, receipt: "escape/receipt.json" }),
    /escapes/,
  );
  await assert.rejects(lstat(path.join(outside, "receipt.json")), {
    code: "ENOENT",
  });
  await noOutputs(f);
});

test("rejects SDK junction/symlink escape without following external files", async (t) => {
  const f = await fixture(t);
  await symlink(
    f.artifacts,
    path.join(f.sdk, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(inventoryCustomArtifact(f.options), /escapes/);
  await noOutputs(f);
});

test("preserves relative link text and rejects escaping links", async (t) => {
  const f = await fixture(t, "x86_64-apple-darwin");
  const link = path.join(f.sdk, "credits-link");
  try {
    await symlink("CREDITS.html", link, "file");
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EPERM", "EACCES"].includes(error.code)
    ) {
      t.skip("Windows host does not permit relative symlink creation");
      return;
    }
    throw error;
  }
  await inventoryCustomArtifact(f.options);
  const { manifest } = await outputs(f);
  assert.deepEqual(
    manifest.artifacts[0].sdkFiles.find(
      (entry) => entry.path === "credits-link",
    ),
    { path: "credits-link", type: "symlink", target: "CREDITS.html" },
  );
  assert.equal(await readlink(link), "CREDITS.html");
  await symlink("../artifacts", path.join(f.sdk, "escape-link"), "dir");
  await assert.rejects(
    inventoryCustomArtifact({
      ...f.options,
      manifest: "second.json",
      receipt: "second-receipt.json",
    }),
    /escapes/,
  );
});

test("rejects broken SDK links", async (t) => {
  const f = await fixture(t);
  await symlink(
    path.join(f.root, "missing"),
    path.join(f.sdk, "broken-link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(inventoryCustomArtifact(f.options), { code: "ENOENT" });
  await noOutputs(f);
});

test("shared preflight refusal cleans up only the reserved new outputs", async (t) => {
  const f = await fixture(t);
  // The shared validator intentionally accepts only its exact generated format.
  // Exercise a late refusal, after the receipt has been exclusively written.
  const header = f.files["include/cef_version.h"].replace(
    `#define CEF_VERSION "${CEF_PIN.version}"`,
    `#define CEF_VERSION "${CEF_PIN.version}" // trailing comment`,
  );
  await put(f.sdk, "include/cef_version.h", header);
  await assert.rejects(
    inventoryCustomArtifact(f.options),
    /SDK version header mismatch/,
  );
  await noOutputs(f);
  assert.equal(
    await readFile(path.join(f.sdk, "include/cef_version.h"), "utf8"),
    header,
  );
  assert.deepEqual(
    await readFile(path.join(f.artifacts, f.options.archive)),
    f.archiveBytes,
  );
});

test("explicit absolute output paths stay rooted and SDK pins are deterministic", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.options.lock);
  await inventoryCustomArtifact(f.options);
  const first = await outputs(f);
  const manifest = path.join(f.artifacts, "second-manifest.json");
  const receipt = path.join(f.artifacts, "second-receipt.json");
  await inventoryCustomArtifact({
    ...f.options,
    archive: path.join(f.artifacts, f.options.archive),
    manifest,
    receipt,
  });
  const second = JSON.parse(await readFile(manifest, "utf8"));
  assert.deepEqual(
    second.artifacts[0].sdkFiles,
    first.manifest.artifacts[0].sdkFiles,
  );
  assert.deepEqual(JSON.parse(await readFile(receipt, "utf8")), first.receipt);
  assert.deepEqual(await readFile(f.options.lock), before);
});

test("concurrent writers cannot replace another inventory's outputs", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    inventoryCustomArtifact(f.options),
    inventoryCustomArtifact(f.options),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const { manifest } = await outputs(f);
  await preflightCustomRuntime({
    manifest,
    sourceLock: f.lock,
    target: f.options.target,
    artifactRoot: f.artifacts,
    sdkRoot: f.sdk,
  });
});
