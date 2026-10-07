import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CEF_PIN,
  TARGETS,
  inspectBindingAlignment,
  inspectBundle,
  inspectMatrix,
  inspectRuntime,
  packageManifest,
  verifyArtifact,
  verifyPackage,
  helperPlist,
  inspectNativeBinary,
  stagePackage,
  clientBuildArguments,
  downloadArchive,
} from "../../scripts/browser-runtime-package.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const script = path.join(repo, "scripts/browser-runtime-package.mjs");
const windows = "x86_64-pc-windows-msvc";
const linux = "x86_64-unknown-linux-gnu";
const mac = "aarch64-apple-darwin";
const digest = (text, algorithm) =>
  createHash(algorithm).update(text).digest("hex");

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sorng-cef-package-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("sorng-cef-package-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function put(root, file, content = `synthetic fixture: ${file}\n`) {
  const location = path.join(root, file);
  await mkdir(path.dirname(location), { recursive: true });
  await writeFile(location, content);
  await chmod(location, 0o755);
}

const versionHeader = (target = windows) =>
  [
    `#define CEF_VERSION "${CEF_PIN.version}"`,
    `#define CEF_SANDBOX_COMPAT_HASH "${target.includes("windows") ? CEF_PIN.sandboxCompat : ""}"`,
    ...CEF_PIN.chromium
      .split(".")
      .map(
        (part, index) =>
          `#define CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][index]} ${part}`,
      ),
  ].join("\n");

// These intentionally are NOT browsers or executable binaries. They exercise
// layout/adversarial validation only; no fixture may establish releaseReady.
async function fixture(t, target = windows) {
  const temporaryRoot = await temporary(t);
  const root = path.join(temporaryRoot, "runtime");
  const bundle = path.join(temporaryRoot, "bundle");
  const manifest = packageManifest(target);
  for (const file of [
    ...manifest.runtimeFiles,
    ...manifest.metadataFiles,
    manifest.defaultLocale,
  ])
    await put(root, file);
  await put(
    root,
    "archive.json",
    JSON.stringify({
      type: "minimal",
      name: manifest.artifact.name,
      sha1: manifest.artifact.sha1,
    }),
  );
  await put(root, "include/cef_version.h", versionHeader(target));
  for (const file of [...manifest.runtimeFiles, manifest.defaultLocale]) {
    const destination =
      target.includes("windows") && file === "bootstrap.exe"
        ? "sortofremoteng.exe"
        : `${manifest.bundlePrefix}${file}`;
    await put(bundle, destination, await readFile(path.join(root, file)));
  }
  await put(
    bundle,
    manifest.creditDestination,
    await readFile(path.join(root, "CREDITS.html")),
  );
  for (const file of manifest.applicationFiles) {
    if (file !== "sortofremoteng.exe") await put(bundle, file);
  }
  return { temporaryRoot, root, bundle, manifest };
}

test("default manifest covers the entire six-target release matrix", () => {
  const output = spawnSync(process.execPath, [script, "manifest"], {
    encoding: "utf8",
    cwd: repo,
  });
  assert.equal(output.status, 0, output.stderr);
  const manifests = JSON.parse(output.stdout);
  assert.equal(manifests.length, 6);
  assert.deepEqual(
    new Set(manifests.map((entry) => entry.platform)),
    new Set(["windows", "linux", "macos"]),
  );
  assert.equal(
    manifests.filter((entry) => entry.target.startsWith("aarch64")).length,
    3,
  );
  for (const { artifact } of manifests) {
    assert.match(artifact.sha1, /^[a-f0-9]{40}$/);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(artifact.url.startsWith("https://cef-builds.spotifycdn.com/"));
    assert.ok(artifact.name.includes(CEF_PIN.version));
  }
});

test("explicit acquisition rejects a changed official index before touching output", async (t) => {
  const root = await temporary(t);
  const output = path.join(root, "not-created.tar.bz2");
  const manifest = packageManifest(windows);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "error");
    return new Response(
      JSON.stringify({
        windows64: {
          versions: [
            {
              cef_version: CEF_PIN.version,
              files: [{ ...manifest.artifact, sha1: "0".repeat(40) }],
            },
          ],
        },
      }),
      { status: 200 },
    );
  });
  await assert.rejects(
    downloadArchive({ target: windows, output }),
    /index disagrees/,
  );
  assert.deepEqual(calls, [CEF_PIN.index]);
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("explicit acquisition refuses an existing mismatched archive without overwriting", async (t) => {
  const root = await temporary(t);
  const output = path.join(root, "existing.tar.bz2");
  await writeFile(output, "keep these original bytes");
  const manifest = packageManifest(windows);
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, CEF_PIN.index); // No artifact request is permitted.
    return new Response(
      JSON.stringify({
        windows64: {
          versions: [
            {
              cef_version: CEF_PIN.version,
              files: [manifest.artifact],
            },
          ],
        },
      }),
      { status: 200 },
    );
  });
  await assert.rejects(
    downloadArchive({ target: windows, output }),
    /refusing to overwrite/,
  );
  assert.equal(await readFile(output, "utf8"), "keep these original bytes");
});

test("sandbox manifests use CEF 154 bootstrap/dylib files, all mac helpers and architecture-specific resources", () => {
  const win = packageManifest(windows);
  assert.ok(win.runtimeFiles.includes("bootstrap.exe"));
  assert.ok(win.applicationFiles.includes("sortofremoteng.dll"));
  assert.ok(win.runtimeFiles.includes("dxcompiler.dll"));
  assert.ok(
    !packageManifest("aarch64-pc-windows-msvc").runtimeFiles.includes(
      "dxcompiler.dll",
    ),
  );
  assert.ok(packageManifest(linux).runtimeFiles.includes("chrome-sandbox"));
  const apple = packageManifest(mac);
  assert.ok(
    apple.runtimeFiles.some((file) =>
      file.endsWith("Libraries/libcef_sandbox.dylib"),
    ),
  );
  assert.ok(
    apple.runtimeFiles.some((file) =>
      file.endsWith("v8_context_snapshot.arm64.bin"),
    ),
  );
  for (const suffix of [
    "",
    " (Alerts)",
    " (GPU)",
    " (Plugin)",
    " (Renderer)",
  ]) {
    assert.ok(
      apple.applicationFiles.includes(
        `Contents/Frameworks/sortofremoteng Helper${suffix}.app/Contents/MacOS/sortofremoteng Helper${suffix}`,
      ),
    );
  }
  assert.equal(apple.constraints.minimumMacOS, "14.0");
  assert.equal(packageManifest(linux).constraints.linuxBackend, "X11/XWayland");
});

test("unsupported targets, argument typos and path-like app names are rejected", () => {
  for (const target of [
    "win32",
    "i686-pc-windows-msvc",
    "x86_64-unknown-linux-musl",
    "__proto__",
  ]) {
    assert.throws(() => packageManifest(target), /Unsupported/);
  }
  for (const name of [
    "../escape",
    "foo/bar",
    "foo\\bar",
    "x:stream",
    "",
    "-app",
    "app.",
    "app ",
    "CON",
    "nul.client",
    "COM1.exe",
  ])
    assert.throws(() => packageManifest(windows, name));
  for (const args of [
    ["verify"],
    ["manifest", "--download", "yes"],
    ["manifest", "--target", windows, "--target", windows],
  ]) {
    assert.equal(
      spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
        .status,
      2,
    );
  }
});

test("normal release reverse-DNS binary names preserve the full helper stem", () => {
  for (const target of TARGETS) {
    const manifest = packageManifest(target, "com.sortofremote.ng");
    assert.ok(
      manifest.applicationFiles.some((file) =>
        file.includes("com.sortofremote.ng"),
      ),
    );
    if (manifest.platform === "macos")
      assert.ok(
        manifest.applicationFiles.includes(
          "Contents/Frameworks/com.sortofremote.ng Helper.app/Contents/MacOS/com.sortofremote.ng Helper",
        ),
      );
    if (manifest.platform === "linux")
      assert.ok(
        manifest.applicationFiles.includes("com.sortofremote.ng.helper"),
      );
  }
});

test("archive verification reads bytes and detects same-size corruption", async (t) => {
  const root = await temporary(t);
  const archive = path.join(root, "synthetic.archive");
  const original = "synthetic archive bytes";
  const expected = {
    size: Buffer.byteLength(original),
    sha1: digest(original, "sha1"),
    sha256: digest(original, "sha256"),
  };
  await writeFile(archive, original);
  const valid = await verifyArtifact(archive, expected);
  assert.equal(valid.ok, true);
  assert.equal(valid.strongDigestPinned, true);
  await writeFile(archive, original.replace("bytes", "BYTES"));
  assert.equal((await verifyArtifact(archive, expected)).status, "mismatch");
  await writeFile(archive, "short");
  assert.equal((await verifyArtifact(archive, expected)).ok, false);
  assert.equal((await verifyArtifact(undefined, expected)).status, "missing");
  assert.equal(
    (await verifyArtifact(path.join(root, "absent"), expected)).ok,
    false,
  );
  await assert.rejects(
    verifyArtifact(archive, { ...expected, sha1: "invalid" }),
    /Invalid artifact/,
  );
});

test("a matching upstream SHA-1 does not conceal a conflicting strong digest", async (t) => {
  const root = await temporary(t);
  const archive = path.join(root, "artifact");
  await writeFile(archive, "fixture");
  const expected = {
    size: 7,
    sha1: digest("fixture", "sha1"),
    sha256: "0".repeat(64),
  };
  assert.equal((await verifyArtifact(archive, expected)).ok, false);
  const weak = await verifyArtifact(archive, { ...expected, sha256: null });
  assert.equal(weak.ok, true);
  assert.equal(weak.strongDigestPinned, false);
});

for (const target of TARGETS) {
  test(`${target}: inspect complete synthetic layout and staged copies`, async (t) => {
    const { root, bundle } = await fixture(t, target);
    const runtime = await inspectRuntime(root, target);
    assert.equal(runtime.ok, true, runtime.errors.join("\n"));
    assert.equal(runtime.sourceBytesMatchArchive, "not-verified");
    const packaged = await inspectBundle(bundle, root, target);
    assert.equal(packaged.ok, true, packaged.errors.join("\n"));
    assert.equal(packaged.executableArchitecture, "not-verified");
    assert.equal(packaged.stage, "before-signing");
  });
}

test("missing bootstrap and empty ICU data fail even with matching archive metadata", async (t) => {
  const { root } = await fixture(t);
  await rm(path.join(root, "bootstrap.exe"));
  await writeFile(path.join(root, "icudtl.dat"), "");
  const result = await inspectRuntime(root, windows);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("bootstrap.exe")));
  assert.ok(result.errors.some((error) => error.includes("icudtl.dat")));
});

test("matching version with wrong architecture metadata is rejected", async (t) => {
  const { root } = await fixture(t);
  const other = packageManifest("aarch64-pc-windows-msvc");
  await put(
    root,
    "archive.json",
    JSON.stringify({
      type: "minimal",
      name: other.artifact.name,
      sha1: other.artifact.sha1,
    }),
  );
  assert.equal((await inspectRuntime(root, windows)).ok, false);
});

test("real Unix header convention requires an empty Windows sandbox ABI hash", async (t) => {
  for (const target of [linux, mac]) {
    const { root } = await fixture(t, target);
    assert.equal((await inspectRuntime(root, target)).ok, true);
    await put(root, "include/cef_version.h", versionHeader(windows));
    assert.equal((await inspectRuntime(root, target)).ok, false);
  }
});

test("older runtime, altered sandbox ABI, duplicate defines and forged checksum are rejected", async (t) => {
  const { root, manifest } = await fixture(t);
  for (const header of [
    versionHeader().replace("154.0.32+", "154.0.31+"),
    versionHeader().replace(CEF_PIN.sandboxCompat, "0000000000000000"),
    `${versionHeader()}\n#define CHROME_VERSION_PATCH 1`,
  ]) {
    await put(root, "include/cef_version.h", header);
    assert.equal((await inspectRuntime(root, windows)).ok, false);
  }
  await put(root, "include/cef_version.h", versionHeader());
  await put(
    root,
    "archive.json",
    JSON.stringify({
      type: "minimal",
      name: manifest.artifact.name,
      sha1: "0".repeat(40),
    }),
  );
  assert.equal((await inspectRuntime(root, windows)).ok, false);
});

test("all installed locales must survive packaging and retain their bytes", async (t) => {
  const { root, bundle } = await fixture(t);
  await put(root, "locales/pt-PT.pak");
  assert.equal((await inspectBundle(bundle, root, windows)).ok, false);
  await copyFile(
    path.join(root, "locales/pt-PT.pak"),
    path.join(bundle, "locales/pt-PT.pak"),
  );
  assert.equal((await inspectBundle(bundle, root, windows)).ok, true);
  await put(bundle, "locales/pt-PT.pak", "damaged locale");
  const altered = await inspectBundle(bundle, root, windows);
  assert.ok(altered.errors.some((error) => error.includes("differs")));
  await rm(path.join(root, "locales/en-US.pak"));
  assert.equal((await inspectRuntime(root, windows)).ok, false);
});

test("missing mac renderer helper or sandbox dylib fails", async (t) => {
  const { root, bundle } = await fixture(t, mac);
  await rm(
    path.join(
      bundle,
      "Contents/Frameworks/sortofremoteng Helper (Renderer).app/Contents/MacOS/sortofremoteng Helper (Renderer)",
    ),
  );
  assert.equal((await inspectBundle(bundle, root, mac)).ok, false);
  await rm(
    path.join(
      root,
      "Chromium Embedded Framework.framework/Libraries/libcef_sandbox.dylib",
    ),
  );
  assert.equal((await inspectRuntime(root, mac)).ok, false);
});

test("whole framework contents and optional Linux library must survive staging", async (t) => {
  for (const [target, extra] of [
    [
      mac,
      "Chromium Embedded Framework.framework/Resources/en.lproj/locale_FEMININE.pak",
    ],
    [linux, "libminigbm.so"],
  ]) {
    const { root, bundle, manifest } = await fixture(t, target);
    await put(root, extra);
    assert.equal((await inspectBundle(bundle, root, target)).ok, false);
    await put(
      bundle,
      `${manifest.bundlePrefix}${extra}`,
      await readFile(path.join(root, extra)),
    );
    assert.equal((await inspectBundle(bundle, root, target)).ok, true);
  }
});

test("runtime symlink/junction escape is rejected", async (t) => {
  const { root, temporaryRoot } = await fixture(t);
  const external = path.join(temporaryRoot, "external");
  await put(external, "en-US.pak");
  const locales = path.join(root, "locales");
  await rm(path.join(locales, "en-US.pak"));
  await rmdir(locales);
  await symlink(
    external,
    locales,
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = await inspectRuntime(root, windows);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /escapes/.test(error)));
});

test(
  "Unix executable permissions are checked without changing them",
  { skip: process.platform === "win32" },
  async (t) => {
    const { root } = await fixture(t, linux);
    await chmod(path.join(root, "chrome-sandbox"), 0o644);
    const result = await inspectRuntime(root, linux);
    assert.ok(
      result.errors.some((error) => /Executable permission/.test(error)),
    );
  },
);

test("Cargo version/feature alignment rejects newer sys bindings and disabled sandbox", async () => {
  const lock = await readFile(path.join(repo, "src-tauri/Cargo.lock"), "utf8");
  const host = await readFile(
    path.join(repo, "src-tauri/crates/sorng-browser-host/Cargo.toml"),
    "utf8",
  );
  assert.equal(inspectBindingAlignment(lock, host).ok, true);
  assert.equal(
    inspectBindingAlignment(
      lock.replace(
        'name = "cef-dll-sys"\nversion = "154.3.0+154.0.32"',
        'name = "cef-dll-sys"\nversion = "154.4.0+154.0.33"',
      ),
      host,
    ).ok,
    false,
  );
  assert.equal(
    inspectBindingAlignment(lock, host.replace('"sandbox", ', "")).ok,
    false,
  );
  assert.equal(
    inspectBindingAlignment(
      `${lock}\n[[package]]\nname = "cef"\nversion = "154.3.0+154.0.32"\n`,
      host,
    ).ok,
    false,
  );
});

test("a fabricated complete runtime cannot pass archive or release acceptance", async (t) => {
  const { root, bundle, temporaryRoot } = await fixture(t);
  const before = await readdir(temporaryRoot);
  const report = await verifyPackage({
    target: windows,
    runtimeRoot: root,
    bundleRoot: bundle,
  });
  assert.equal(report.runtime.ok, true);
  assert.equal(report.bundle.ok, true);
  assert.equal(report.artifact.ok, false);
  assert.equal(report.ok, false);
  assert.equal(report.releaseReady, false);
  assert.equal(report.signing, "not-checked");
  assert.equal(report.browserReadiness, "not-established");
  assert.ok(
    report.outstanding.includes("archive-to-extracted-tree-provenance"),
  );
  assert.deepEqual(await readdir(temporaryRoot), before);
  const cli = spawnSync(
    process.execPath,
    [script, "verify", "--target", windows, "--runtime", root],
    { encoding: "utf8" },
  );
  assert.equal(cli.status, 1, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).releaseReady, false);
});

test("matrix aggregation cannot pass Windows alone or duplicate target reports", () => {
  const reports = TARGETS.map((target) => ({
    target,
    ok: true,
    schemaVersion: 1,
    pin: CEF_PIN,
    artifact: { ok: true },
    runtime: { ok: true },
    bindings: { ok: true },
    bundle: { ok: true },
  }));
  assert.equal(inspectMatrix(reports).ok, true);
  assert.equal(inspectMatrix(reports).releaseReady, false);
  assert.equal(
    inspectMatrix(reports.filter((report) => report.target.includes("windows")))
      .ok,
    false,
  );
  assert.equal(inspectMatrix([...reports, reports[0]]).ok, false);
  assert.equal(
    inspectMatrix(
      reports.map((report, index) => ({ ...report, ok: index !== 2 })),
    ).ok,
    false,
  );
  assert.equal(
    inspectMatrix(
      reports.map((report) => ({
        ...report,
        pin: { ...CEF_PIN, version: "old" },
      })),
    ).ok,
    false,
  );
  assert.equal(
    inspectMatrix(TARGETS.map((target) => ({ target, ok: true }))).ok,
    false,
  );
});

test("client build uses explicit Windows cdylib output with locked offline dependencies", () => {
  const args = clientBuildArguments(windows, "/build-output", "debug");
  assert.deepEqual(args.slice(0, 2), ["cargo", "rustc"]);
  assert.ok(args.includes("--locked"));
  assert.ok(args.includes("--offline"));
  assert.ok(args.includes("--lib"));
  assert.equal(args[args.indexOf("--crate-type") + 1], "cdylib");
  assert.equal(args[args.indexOf("--features") + 1], "native-browser");
  assert.ok(!args.includes("--release"));
  assert.ok(
    clientBuildArguments(windows, "/build-output").includes("--release"),
  );
  assert.throws(() => clientBuildArguments(linux, "/build-output"), /Windows/);
  assert.throws(
    () => clientBuildArguments(windows, "/build-output", "custom"),
    /profile/,
  );
});

test("native stage rejects synthetic layout text before creating a destination", async (t) => {
  const { temporaryRoot, bundle } = await fixture(t);
  const output = path.join(temporaryRoot, "must-not-be-created");
  await assert.rejects(
    stagePackage({
      target: windows,
      application: path.join(bundle, "sortofremoteng.dll"),
      output,
    }),
    /Native binary/,
  );
  await assert.rejects(readdir(output), { code: "ENOENT" });
});

test("ELF architecture is inspected and opposite CPU is rejected", async (t) => {
  const root = await temporary(t);
  const file = path.join(root, "synthetic-elf-header");
  const header = Buffer.alloc(64);
  header.writeUInt32LE(0x464c457f);
  header[4] = 2;
  header[5] = 1;
  header.writeUInt16LE(3, 16);
  header.writeUInt16LE(62, 18);
  await writeFile(file, header);
  assert.equal((await inspectNativeBinary(file, linux)).ok, true);
  await assert.rejects(
    inspectNativeBinary(file, "aarch64-unknown-linux-gnu"),
    /Native binary/,
  );
  header[4] = 1;
  await writeFile(file, header);
  await assert.rejects(inspectNativeBinary(file, linux), /Native binary/);
});

test("Mach-O deployment floor and architecture must match the application contract", async (t) => {
  const root = await temporary(t);
  const file = path.join(root, "synthetic-mach-header");
  const header = Buffer.alloc(56);
  header.writeUInt32LE(0xfeedfacf);
  header.writeUInt32LE(0x100000c, 4);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(0x32, 32);
  header.writeUInt32LE(24, 36);
  header.writeUInt32LE(1, 40);
  header.writeUInt32LE(0xe0000, 44);
  await writeFile(file, header);
  assert.equal((await inspectNativeBinary(file, mac)).ok, true);
  await assert.rejects(
    inspectNativeBinary(file, "x86_64-apple-darwin"),
    /Native binary/,
  );
  header.writeUInt32LE(0xf0000, 44);
  await writeFile(file, header);
  await assert.rejects(inspectNativeBinary(file, mac), /macOS 14/);
});

test("Windows client must have a real export table containing the C ABI entry", async (t) => {
  const root = await temporary(t);
  const file = path.join(root, "synthetic-pe-header");
  const header = Buffer.alloc(1024);
  header.write("MZ");
  header.writeUInt32LE(64, 60);
  header.writeUInt32LE(0x4550, 64);
  header.writeUInt16LE(0x8664, 68);
  header.writeUInt16LE(1, 70);
  header.writeUInt16LE(240, 84);
  header.writeUInt16LE(0x2000, 86);
  header.writeUInt16LE(0x20b, 88);
  header.writeUInt32LE(0x1000, 200);
  // One section maps RVA 0x1000 to file offset 512.
  header.writeUInt32LE(0x1000, 340);
  header.writeUInt32LE(512, 344);
  header.writeUInt32LE(512, 348);
  header.writeUInt32LE(1, 536);
  header.writeUInt32LE(0x1040, 544);
  header.writeUInt32LE(0x1080, 576);
  header.write("RunWinMain\0", 640);
  await writeFile(file, header);
  assert.equal(
    (await inspectNativeBinary(file, windows, { clientDll: true })).ok,
    true,
  );
  header.write("BadWinMain\0", 640);
  await writeFile(file, header);
  await assert.rejects(
    inspectNativeBinary(file, windows, { clientDll: true }),
    /export RunWinMain/,
  );
  await assert.rejects(
    inspectNativeBinary(file, "aarch64-pc-windows-msvc"),
    /Native binary/,
  );
});

test("helper plists distinguish all roles, set the deployment floor and reject markup", () => {
  const identifiers = new Set();
  for (const suffix of [
    "",
    " (Alerts)",
    " (GPU)",
    " (Plugin)",
    " (Renderer)",
  ]) {
    const plist = helperPlist("sortofremoteng", suffix);
    assert.ok(
      plist.includes(`<string>sortofremoteng Helper${suffix}</string>`),
    );
    assert.match(
      plist,
      /<key>LSMinimumSystemVersion<\/key><string>14.0<\/string>/,
    );
    identifiers.add(plist.match(/CFBundleIdentifier<\/key><string>([^<]+)/)[1]);
  }
  assert.equal(identifiers.size, 5);
  assert.throws(() => helperPlist("<evil>"), /Invalid/);
  assert.throws(() => helperPlist("sortofremoteng", "../../escape"), /Invalid/);
});
