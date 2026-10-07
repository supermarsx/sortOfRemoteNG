import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CACHE_ROOT,
  DEFAULT_PYTHON,
  downloadPinned,
  fetchRuntime,
  main,
  parseArguments,
} from "../../scripts/cef-runtime-fetch.mjs";
import {
  RELEASE_LIMITS,
  bindRuntimeRelease,
  releaseAssetUrl,
  validateRuntimeReleaseDescriptor,
} from "../../scripts/lib/browser-runtime-release.mjs";
import {
  BRIDGE_V2,
  BRIDGE_PATCH_ID,
  UPSTREAM_CEF_COMMIT,
  UPSTREAM_CHROMIUM_COMMIT,
  UPSTREAM_DEPOT_TOOLS_COMMIT,
  identitySha256,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { CEF_PIN, TARGETS } from "../../scripts/browser-runtime-package.mjs";

// All native/archive/build bytes and pins here are SYNTHETIC measured fixtures,
// not executable engines, production pins, source attestations or acceptance.
const exec = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const pin = (name, bytes) => ({
  path: name,
  sha256: hash(bytes),
  size: Buffer.byteLength(bytes),
});
const inputPin = (name) => ({ path: name, sha256: hash(`synthetic ${name}`) });
const release =
  "https://github.com/synthetic-fixture/cef/releases/download/cef-fixture-v1";
const descriptorUrl = `${release}/descriptor.json`;
const script = fileURLToPath(
  new URL("../../scripts/cef-runtime-fetch.mjs", import.meta.url),
);

async function temporary(t) {
  const parent = await realpath(os.tmpdir());
  const root = await realpath(
    await mkdtemp(path.join(parent, "cef-runtime-fetch-test-")),
  );
  t.after(async () => {
    if (
      !path.isAbsolute(root) ||
      path.dirname(root) !== parent ||
      !path.basename(root).startsWith("cef-runtime-fetch-test-") ||
      (await realpath(root)) !== root
    )
      throw new Error("Unsafe test cleanup path");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function native(target, omitExport = false) {
  const bytes = Buffer.alloc(2048);
  const symbols = [
    BRIDGE_V2.symbol,
    omitExport ? "synthetic_not_the_factory" : BRIDGE_V2.factorySymbol,
  ];
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

const PACK = String.raw`
import io, sys, tarfile
source, output, mode = sys.argv[1:]
def select(member):
    if mode == "missing" and member.name == "sdk/CREDITS.html": return None
    if mode == "hardlink" and member.name == "sdk/CREDITS.html":
        member.type = tarfile.LNKTYPE; member.size = 0; member.linkname = "sdk/archive.json"
    return member
with tarfile.open(output, "w:bz2") as archive:
    archive.add(source, arcname="sdk", filter=select)
    if mode in ("traversal", "extra", "duplicate", "huge-pax", "special", "link"):
        name = {"traversal":"../escape", "extra":"sdk/extra", "duplicate":"sdk/CREDITS.html", "huge-pax":"pax", "special":"sdk/extra", "link":"sdk/escape"}[mode]
        member = tarfile.TarInfo(name)
        if mode == "huge-pax":
            member.type = tarfile.XHDTYPE; data = b"x" * (1024 * 1024 + 1)
        else: data = b"x"
        if mode == "special": member.type = tarfile.FIFOTYPE; data = b""
        if mode == "link": member.type = tarfile.SYMTYPE; member.linkname = "../../escape"; data = b""
        member.size = len(data); archive.addfile(member, io.BytesIO(data))
`;

async function fixture(
  t,
  target = TARGETS[0],
  {
    mode = "normal",
    omitExport = false,
    badVersion = false,
    nativeTarget = target,
    withSymlink = false,
  } = {},
) {
  const root = await temporary(t);
  const sdk = path.join(root, "source-sdk");
  const library = target.includes("windows")
    ? "libcef.dll"
    : target.includes("linux")
      ? "libcef.so"
      : "Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework";
  const sandbox = target.includes("windows")
    ? "bootstrap.exe"
    : target.includes("linux")
      ? "chrome-sandbox"
      : "libcef_sandbox.dylib";
  const bridge = "synthetic bridge contract";
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
    patches: [{ repository: "cef", ...inputPin("patches/synthetic.patch") }],
    bridge: {
      ...BRIDGE_V2,
      patchId: BRIDGE_PATCH_ID,
      header: { path: "include/cef_sorng_tls_bridge.h", sha256: hash(bridge) },
    },
    builds: [
      {
        target,
        gnArgs: inputPin("gn/synthetic.gn"),
        toolchainLock: inputPin("tools/synthetic.json"),
      },
    ],
  };
  const sandboxCompat = target.includes("windows") ? CEF_PIN.sandboxCompat : "";
  const files = {
    "archive.json": json({
      name: "synthetic prepared SDK metadata preserved byte-for-byte",
    }),
    "CREDITS.html": "synthetic credits",
    "include/cef_sorng_tls_bridge.h": bridge,
    "include/cef_version.h": `#define CEF_VERSION "${badVersion ? "HEAD.3631" : CEF_PIN.version}"\n#define CEF_COMMIT_HASH "${UPSTREAM_CEF_COMMIT}"\n#define CEF_SANDBOX_COMPAT_HASH "${sandboxCompat}"\n`,
    [library]: native(nativeTarget, omitExport),
    [sandbox]: "synthetic sandbox; never executed",
  };
  for (const [name, bytes] of Object.entries(files))
    await put(sdk, name, bytes);
  if (withSymlink) {
    try {
      await symlink("include", path.join(sdk, "Headers"), "dir");
    } catch (error) {
      if (process.platform === "win32" && error.code === "EPERM") {
        t.skip(
          "Windows relative symlink fixture requires Developer Mode or symlink privilege",
        );
        return null;
      }
      throw error;
    }
  }
  const archivePath = path.join(root, "sorng-cef-custom-fixture.tar.bz2");
  await exec(DEFAULT_PYTHON, ["-I", "-c", PACK, sdk, archivePath, mode], {
    windowsHide: true,
  });
  const archiveBytes = await readFile(archivePath);
  const archive = pin(path.basename(archivePath), archiveBytes);
  const sdkFiles = Object.entries(files).map(([name, bytes]) => ({
    ...pin(name, bytes),
    type: "file",
  }));
  if (withSymlink)
    sdkFiles.push({ path: "Headers", type: "symlink", target: "include" });
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-build-receipt",
    target,
    sourceLockSha256: identitySha256(lock),
    archiveSha256: archive.sha256,
    sdkInventorySha256: identitySha256(sdkFiles),
    buildInputsSha256: identitySha256(lock.builds[0]),
  };
  const manifest = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-runtime",
    sourceLockSha256: identitySha256(lock),
    artifacts: [
      {
        target,
        archive,
        provenance: pin("metadata/receipt.json", json(receipt)),
        sdkFiles,
        runtime: {
          library,
          sandbox,
          cefCommit: UPSTREAM_CEF_COMMIT,
          cefVersion: CEF_PIN.version,
          cefApiVersion: 15400,
          cefApiHash: hash("synthetic API").slice(0, 40),
          sandboxCompat,
        },
      },
    ],
  };
  const paths = {
    sourceLock: "source-lock.json",
    manifest: "metadata/manifest.json",
    receipt: "metadata/receipt.json",
    archive: archive.path,
  };
  const f = {
    root,
    target,
    files,
    lock,
    manifest,
    receipt,
    archiveBytes,
    paths,
    library,
    calls: [],
  };
  f.publish = () => {
    const bytes = {
      sourceLock: json(f.lock),
      manifest: json(f.manifest),
      receipt: json(f.receipt),
      archive: f.archiveBytes,
    };
    f.descriptor = {
      schemaVersion: 1,
      kind: "sorng-cef-runtime-release",
      target,
      ...Object.fromEntries(
        Object.entries(bytes).map(([field, content]) => [
          field,
          {
            url: `${release}/${path.posix.basename(paths[field])}`,
            ...pin(paths[field], content),
          },
        ]),
      ),
      sdk: { archiveRoot: "sdk" },
    };
    f.assets = new Map(
      Object.entries(bytes).map(([field, content]) => [
        f.descriptor[field].url,
        Buffer.from(content),
      ]),
    );
    f.assets.set(descriptorUrl, Buffer.from(json(f.descriptor)));
    f.options = {
      descriptorUrl,
      descriptorSha256: hash(json(f.descriptor)),
      target,
      cacheRoot: path.join(root, "cache"),
      selectionFile: path.join(root, "selection.json"),
    };
  };
  f.publish();
  f.request = async (url, options) => {
    f.calls.push({ url, options });
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.deepEqual(options.headers, { "accept-encoding": "identity" });
    const bytes = f.assets.get(url);
    assert.ok(bytes, `unexpected network URL: ${url}`);
    return new Response(bytes, {
      headers: { "content-length": String(bytes.length) },
    });
  };
  f.run = (extra = {}) =>
    fetchRuntime({ ...f.options, ...extra }, { request: f.request });
  return f;
}

test("CLI requires independent raw descriptor review and exposes stable defaults", async () => {
  assert.match(await main(["--help"]), /independently reviewed/);
  assert.equal(
    DEFAULT_CACHE_ROOT,
    fileURLToPath(
      new URL("../../.cache/cef-runtime-releases", import.meta.url),
    ),
  );
  assert.equal(
    DEFAULT_PYTHON,
    process.platform === "win32" ? "python" : "python3",
  );
  assert.equal(RELEASE_LIMITS.archive, 2 * 1024 ** 3 - 1);
  for (const argv of [
    [],
    ["--descriptor-url", descriptorUrl],
    ["--descriptor-sha256", "0".repeat(64)],
    ["--offline=true"],
    ["--unknown"],
    ["--target", "--offline"],
  ])
    assert.throws(() => parseArguments(argv));
  const parsed = parseArguments([
    "--descriptor-url",
    descriptorUrl,
    "--descriptor-sha256",
    hash("reviewed synthetic descriptor"),
    "--target",
    TARGETS[0],
    "--offline",
  ]);
  assert.equal(parsed.offline, true);
  assert.throws(
    () => parseArguments(["--target", TARGETS[0], "--target", TARGETS[0]]),
    /Duplicate/,
  );
});

test("only fixed GitHub release routes are accepted", () => {
  assert.equal(releaseAssetUrl(descriptorUrl).release, release);
  for (const url of [
    "http://github.com/a/b/releases/download/v1/f.json",
    "https://evil.example/a",
    "https://github.com/a/b/releases/latest/download/f.json",
    "https://github.com/a/b/releases/download/latest/f.json",
    `${descriptorUrl}?token=secret`,
    `${descriptorUrl}#fragment`,
    descriptorUrl.replace("github.com", "user:password@github.com"),
    descriptorUrl.replace("descriptor.json", "%2e%2e/descriptor.json"),
    "file:///tmp/descriptor.json",
  ])
    assert.throws(() => releaseAssetUrl(url));
});

test("descriptor rejects extra fields, target mismatch, collisions, escapes, foreign releases and oversized pins", async (t) => {
  const f = await fixture(t);
  validateRuntimeReleaseDescriptor(f.descriptor, {
    descriptorUrl,
    target: f.target,
  });
  for (const mutate of [
    (d) => {
      d.extra = true;
    },
    (d) => {
      d.target = "other";
    },
    (d) => {
      d.archive.size = 2 * 1024 ** 3;
    },
    (d) => {
      d.manifest.size = 0;
    },
    (d) => {
      d.sdk.archiveRoot = "../escape";
    },
    (d) => {
      d.archive.path = "../escape.tar.bz2";
    },
    (d) => {
      d.receipt.url = d.receipt.url.replace("cef-fixture-v1", "cef-fixture-v2");
    },
    (d) => {
      d.manifest = structuredClone(d.sourceLock);
    },
    (d) => {
      d.manifest.sha256 = "0".repeat(64);
    },
  ]) {
    const d = structuredClone(f.descriptor);
    mutate(d);
    assert.throws(() =>
      validateRuntimeReleaseDescriptor(d, { descriptorUrl, target: f.target }),
    );
  }
  const d = structuredClone(f.descriptor);
  d.archive.sha256 = hash("different");
  assert.throws(
    () => bindRuntimeRelease(d, f.manifest, f.lock),
    /differs from reviewed manifest/,
  );
});

for (const target of TARGETS)
  test(`real extraction/preflight/export inspection/selection with ${target} synthetic bytes`, async (t) => {
    const f = await fixture(t, target);
    const report = await f.run();
    assert.equal(report.nativeAcceptance, "not-tested");
    assert.equal(report.productionReady, false);
    assert.equal(report.sourceAuthenticity, "not-established-by-hashes");
    assert.equal(
      report.archiveSdkRelationship,
      "extracted-and-inventory-verified",
    );
    assert.equal(f.calls.length, 5);
    const before = await readFile(f.options.selectionFile, "utf8");
    const selected = JSON.parse(before).targets[target];
    const sdk = path.resolve(f.root, selected.sdk);
    assert.equal(
      await readFile(path.join(sdk, "archive.json"), "utf8"),
      f.files["archive.json"],
    );
    const again = await f.run({ offline: true });
    assert.equal(again.reusedSelection, true);
    assert.equal(f.calls.length, 5);
    assert.equal(await readFile(f.options.selectionFile, "utf8"), before);
    const other = path.join(f.root, "offline-selection.json");
    await f.run({ selectionFile: other, offline: true });
    assert.equal(f.calls.length, 5);
  });

test("offline CLI installs from cached objects without network or a prior installation", async (t) => {
  const f = await fixture(t);
  const objects = path.join(f.options.cacheRoot, "objects", f.target);
  for (const bytes of f.assets.values()) await put(objects, hash(bytes), bytes);
  const { stdout } = await exec(
    process.execPath,
    [
      script,
      "--descriptor-url",
      descriptorUrl,
      "--descriptor-sha256",
      f.options.descriptorSha256,
      "--target",
      f.target,
      "--cache-root",
      f.options.cacheRoot,
      "--selection",
      f.options.selectionFile,
      "--offline",
    ],
    { windowsHide: true },
  );
  assert.equal(JSON.parse(stdout).nativeAcceptance, "not-tested");
  assert.equal(f.calls.length, 0);
});

test("prepared SDK relative directory symlinks survive extraction unchanged", async (t) => {
  const f = await fixture(t, "x86_64-apple-darwin", { withSymlink: true });
  if (!f) return;
  const report = await f.run();
  assert.equal(
    await readlink(path.join(report.installation, "extracted/sdk/Headers")),
    "include",
  );
});

test("cold offline fetch never requests network or creates a selection", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.run({ offline: true }), /Offline/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(readFile(f.options.selectionFile), { code: "ENOENT" });
});

test("raw descriptor hash is enforced before parsing or following its asset URLs", async (t) => {
  const f = await fixture(t);
  f.assets.set(descriptorUrl, Buffer.from("unreviewed descriptor"));
  await assert.rejects(f.run(), /SHA-256/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(
    await readdir(path.join(f.options.cacheRoot, "objects", f.target)),
    [],
  );
});

for (const mode of [
  "traversal",
  "extra",
  "duplicate",
  "missing",
  "hardlink",
  "huge-pax",
  "special",
  "link",
])
  test(`rejects ${mode} tar before selection and cleans only owned staging`, async (t) => {
    const f = await fixture(t, TARGETS[0], { mode });
    const sentinel = await put(
      f.options.cacheRoot,
      `installed/${f.target}/.install-not-ours/keep`,
      "keep",
    );
    await assert.rejects(f.run(), /archive|Archive|tar extension/);
    assert.equal(await readFile(sentinel, "utf8"), "keep");
    assert.deepEqual(
      await readdir(path.join(f.options.cacheRoot, "installed", f.target)),
      [".install-not-ours"],
    );
    await assert.rejects(readFile(f.options.selectionFile), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(f.root, "escape")), {
      code: "ENOENT",
    });
  });

for (const [name, options] of [
  ["missing defined V2 export", { omitExport: true }],
  ["HEAD version", { badVersion: true }],
  [
    "wrong architecture",
    {
      nativeTarget: TARGETS.find(
        (value) => value.startsWith("aarch64") && value.includes("windows"),
      ),
    },
  ],
])
  test(`rejects ${name} after raw hashes pass`, async (t) => {
    const f = await fixture(t, "x86_64-pc-windows-msvc", options);
    await assert.rejects(
      f.run(),
      /export|version|target|architecture|machine/i,
    );
    await assert.rejects(readFile(f.options.selectionFile), { code: "ENOENT" });
  });

test("receipt mismatch fails preflight without replacing prior selection", async (t) => {
  const f = await fixture(t);
  f.receipt.buildInputsSha256 = hash("unrelated build");
  f.manifest.artifacts[0].provenance = pin(f.paths.receipt, json(f.receipt));
  f.publish();
  await writeFile(f.options.selectionFile, "previous selection sentinel");
  await assert.rejects(f.run({ replace: true }), /receipt/);
  assert.equal(
    await readFile(f.options.selectionFile, "utf8"),
    "previous selection sentinel",
  );
});

test("corrupt cache and installed bytes are preserved and fail closed", async (t) => {
  const f = await fixture(t);
  const report = await f.run();
  const before = await readFile(f.options.selectionFile, "utf8");
  const library = path.join(report.installation, "extracted/sdk", f.library);
  await writeFile(library, "corrupt installed bytes");
  await assert.rejects(f.run({ offline: true }), /mismatch/i);
  assert.equal(await readFile(library, "utf8"), "corrupt installed bytes");
  const cached = path.join(
    f.options.cacheRoot,
    "objects",
    f.target,
    f.options.descriptorSha256,
  );
  await writeFile(cached, "corrupt cached bytes");
  await assert.rejects(f.run(), /SHA-256/);
  assert.equal(await readFile(cached, "utf8"), "corrupt cached bytes");
  assert.equal(await readFile(f.options.selectionFile, "utf8"), before);
  assert.equal(f.calls.length, 5);
});

test("different registered target entry needs explicit replace; other targets survive", async (t) => {
  const f = await fixture(t);
  await f.run();
  const selection = JSON.parse(await readFile(f.options.selectionFile, "utf8"));
  selection.targets[f.target].sdk = "different-sdk";
  const other = TARGETS.find((value) => value !== f.target);
  selection.targets[other] = structuredClone(selection.targets[f.target]);
  await writeFile(f.options.selectionFile, json(selection));
  await assert.rejects(f.run({ offline: true }), /--replace/);
  assert.deepEqual(
    JSON.parse(await readFile(f.options.selectionFile, "utf8")),
    selection,
  );
  await f.run({ offline: true, replace: true });
  const after = JSON.parse(await readFile(f.options.selectionFile, "utf8"));
  assert.deepEqual(after.targets[other], selection.targets[other]);
  assert.notEqual(after.targets[f.target].sdk, "different-sdk");
});

test("corrupt selection is not repaired implicitly", async (t) => {
  const f = await fixture(t);
  await writeFile(f.options.selectionFile, "{corrupt");
  await assert.rejects(f.run({ replace: true }), /JSON/);
  assert.equal(await readFile(f.options.selectionFile, "utf8"), "{corrupt");
});

test("existing install directory is not overwritten, including an empty one", async (t) => {
  const f = await fixture(t);
  const existing = path.join(
    f.options.cacheRoot,
    "installed",
    f.target,
    f.options.descriptorSha256,
  );
  await mkdir(existing, { recursive: true });
  await assert.rejects(f.run(), /ENOENT/);
  assert.deepEqual(await readdir(existing), []);
});

test("cache ancestor aliases cannot redirect downloaded files", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await mkdir(f.options.cacheRoot);
  await symlink(
    outside,
    path.join(f.options.cacheRoot, "objects"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(f.run(), /link or alias/);
  assert.deepEqual(await readdir(outside), []);
  assert.equal(f.calls.length, 0);
});

test("credential-free manual HTTPS redirect allowlist rejects leaks, downgrades and loops", async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from("synthetic transport");
  const options = {
    url: descriptorUrl,
    sha256: hash(bytes),
    size: bytes.length,
    maximum: 128,
    output: path.join(root, "object"),
  };
  let calls = 0;
  const request = async (url, config) => {
    calls++;
    assert.equal(config.credentials, "omit");
    assert.equal(config.redirect, "manual");
    assert.deepEqual(config.headers, { "accept-encoding": "identity" });
    return url === descriptorUrl
      ? new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/test?signature=synthetic",
          },
        })
      : new Response(bytes);
  };
  await downloadPinned(options, request);
  assert.equal(calls, 2);
  for (const [i, location] of [
    "http://release-assets.githubusercontent.com/test",
    "https://evil.example/test",
    "https://secret@release-assets.githubusercontent.com/test",
    `${release.replace("v1", "v2")}/asset`,
    "https://release-assets.githubusercontent.com:444/test",
    descriptorUrl,
  ].entries())
    await assert.rejects(
      downloadPinned(
        { ...options, output: path.join(root, `bad-${i}`) },
        async () => new Response(null, { status: 302, headers: { location } }),
      ),
      /redirect/i,
    );
  assert.deepEqual(await readdir(root), ["object"]);
});

test("transport bounds enforce advertised and streamed sizes plus raw hashes", async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from("good");
  const options = {
    url: descriptorUrl,
    sha256: hash(bytes),
    size: 4,
    maximum: 8,
  };
  for (const [i, response] of [
    new Response("toolong", { headers: { "content-length": "7" } }),
    new Response("toolong"),
    new Response("bad"),
    new Response("evil"),
    new Response("good", { headers: { "content-encoding": "gzip" } }),
    new Response("no", { status: 403 }),
  ].entries())
    await assert.rejects(
      downloadPinned(
        { ...options, output: path.join(root, `bad-${i}`) },
        async () => response,
      ),
    );
  assert.deepEqual(await readdir(root), []);
});

test("interrupted streams clean partial bytes and concurrent cache publication never overwrites", async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from("verified synthetic transport");
  const options = {
    url: descriptorUrl,
    sha256: hash(bytes),
    size: bytes.length,
    maximum: 1024,
    output: path.join(root, "object"),
  };
  const broken = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 4));
    },
    pull(controller) {
      controller.error(new Error("synthetic interruption"));
    },
  });
  await assert.rejects(
    downloadPinned(options, async () => new Response(broken)),
    /interruption/,
  );
  assert.deepEqual(await readdir(root), []);
  const signals = [];
  const request = async (_url, config) => {
    signals.push(config.signal);
    return new Response(bytes);
  };
  await Promise.all([
    downloadPinned(options, request),
    downloadPinned(options, request),
  ]);
  assert.deepEqual(await readFile(options.output), bytes);
  assert.deepEqual(await readdir(root), ["object"]);
  assert.ok(signals.every((signal) => signal.aborted));
});
