import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COMMON_RUNTIME_DLLS,
  OPENH264_VERSION,
  OPENSSL_RUNTIME_DLLS,
  REQUIRED_LICENSE_PORTS,
  VCPKG_BASELINE,
  nativeBuildEnvironment,
  readPeImports,
  readPeMachine,
  runtimeDllsForArchitecture,
  rustTargetFromArgs,
  targetSpec,
  usablePinnedVcpkgRoot,
  validateRuntimeDependencyClosure,
  windowsNativeTauriConfig,
} from "../../scripts/stage-windows-native-runtime.mjs";

const nativeManifest = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/native/vcpkg.json", import.meta.url),
    "utf8",
  ),
);
const packageManifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const cargoManifest = readFileSync(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const nativeBuildWrapper = readFileSync(
  new URL("../../scripts/native-build-env.mjs", import.meta.url),
  "utf8",
);
const releaseWorkflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const appBuildScript = readFileSync(
  new URL("../../src-tauri/build.rs", import.meta.url),
  "utf8",
);
const windowsTriplets = [
  "x64-windows-sorng.cmake",
  "arm64-windows-sorng.cmake",
].map((filename) =>
  readFileSync(
    new URL(`../../src-tauri/native/triplets/${filename}`, import.meta.url),
    "utf8",
  ),
);
const kafkaOverlayPort = readFileSync(
  new URL(
    "../../src-tauri/native/ports/librdkafka/portfile.cmake",
    import.meta.url,
  ),
  "utf8",
);
const openh264OverlayManifest = JSON.parse(
  readFileSync(
    new URL(
      "../../src-tauri/native/ports/openh264/vcpkg.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const openh264OverlayPort = readFileSync(
  new URL(
    "../../src-tauri/native/ports/openh264/portfile.cmake",
    import.meta.url,
  ),
  "utf8",
);
const openh264AbiPatch = readFileSync(
  new URL(
    "../../src-tauri/native/ports/openh264/002-abi-major-8.patch",
    import.meta.url,
  ),
  "utf8",
);
const nativeRuntimeStager = readFileSync(
  new URL("../../scripts/stage-windows-native-runtime.mjs", import.meta.url),
  "utf8",
);
const kafkaRuntimeProbe = readFileSync(
  new URL("../../scripts/probe-rdkafka-runtime.ps1", import.meta.url),
  "utf8",
);
const kafkaStateRegistry = readFileSync(
  new URL("../../src-tauri/src/state_registry/ops.rs", import.meta.url),
  "utf8",
);

function dependencyName(dependency) {
  return typeof dependency === "string" ? dependency : dependency.name;
}

function minimalPe(machine) {
  const peOffset = 0x80;
  const bytes = Buffer.alloc(peOffset + 6);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(peOffset, 0x3c);
  bytes.writeUInt32LE(0x4550, peOffset);
  bytes.writeUInt16LE(machine, peOffset + 4);
  return bytes;
}

function peWithImports(machine, imports) {
  const peOffset = 0x80;
  const optionalHeaderSize = 0xf0;
  const optionalOffset = peOffset + 24;
  const sectionOffset = optionalOffset + optionalHeaderSize;
  const rawOffset = 0x200;
  const virtualAddress = 0x1000;
  const bytes = Buffer.alloc(0x800);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(peOffset, 0x3c);
  bytes.writeUInt32LE(0x4550, peOffset);
  bytes.writeUInt16LE(machine, peOffset + 4);
  bytes.writeUInt16LE(1, peOffset + 6);
  bytes.writeUInt16LE(optionalHeaderSize, peOffset + 20);
  bytes.writeUInt16LE(0x20b, optionalOffset);
  bytes.writeUInt32LE(16, optionalOffset + 108);

  const descriptorSize = (imports.length + 1) * 20;
  bytes.writeUInt32LE(virtualAddress, optionalOffset + 120);
  bytes.writeUInt32LE(descriptorSize, optionalOffset + 124);
  bytes.write(".rdata\0\0", sectionOffset, "ascii");
  bytes.writeUInt32LE(0x600, sectionOffset + 8);
  bytes.writeUInt32LE(virtualAddress, sectionOffset + 12);
  bytes.writeUInt32LE(0x600, sectionOffset + 16);
  bytes.writeUInt32LE(rawOffset, sectionOffset + 20);

  let nameOffset = rawOffset + descriptorSize;
  imports.forEach((name, index) => {
    bytes.writeUInt32LE(
      virtualAddress + (nameOffset - rawOffset),
      rawOffset + index * 20 + 12,
    );
    bytes.write(`${name}\0`, nameOffset, "ascii");
    nameOffset += Buffer.byteLength(name, "ascii") + 1;
  });
  return bytes;
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

test("rejects stale runner vcpkg roots that do not match the pinned baseline", (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "sorng-vcpkg-root-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  git(fixtureRoot, ["init", "--quiet"]);
  git(fixtureRoot, ["config", "user.name", "Release Test"]);
  git(fixtureRoot, ["config", "user.email", "release@test.invalid"]);
  mkdirSync(path.join(fixtureRoot, "versions"), { recursive: true });
  writeFileSync(path.join(fixtureRoot, "versions", "baseline.json"), "{}\n");
  writeFileSync(path.join(fixtureRoot, "vcpkg.exe"), "fixture\n");
  git(fixtureRoot, ["add", "."]);
  git(fixtureRoot, ["commit", "--quiet", "-m", "pinned baseline"]);
  const baseline = git(fixtureRoot, ["rev-parse", "HEAD"]);

  assert.deepEqual(usablePinnedVcpkgRoot(fixtureRoot, "vcpkg.exe", baseline), {
    root: path.resolve(fixtureRoot),
    executable: path.join(path.resolve(fixtureRoot), "vcpkg.exe"),
  });

  writeFileSync(path.join(fixtureRoot, "stale-runner.txt"), "newer checkout\n");
  git(fixtureRoot, ["add", "."]);
  git(fixtureRoot, ["commit", "--quiet", "-m", "stale runner head"]);
  assert.equal(
    usablePinnedVcpkgRoot(fixtureRoot, "vcpkg.exe", baseline),
    undefined,
  );
});

test("maps the supported Windows Rust targets to their exact vcpkg and PE identities", () => {
  assert.deepEqual(targetSpec("x86_64-pc-windows-msvc"), {
    triplet: "x64-windows-sorng",
    machine: 0x8664,
    architecture: "x64",
  });
  assert.deepEqual(targetSpec("aarch64-pc-windows-msvc"), {
    triplet: "arm64-windows-sorng",
    machine: 0xaa64,
    architecture: "arm64",
  });
  assert.throws(
    () => targetSpec("i686-pc-windows-msvc"),
    /unsupported Windows Rust target/,
  );
});

test("selects cross-target runtime staging from command arguments or Cargo", () => {
  assert.equal(
    rustTargetFromArgs([
      "tauri",
      "build",
      "--target",
      "aarch64-pc-windows-msvc",
    ]),
    "aarch64-pc-windows-msvc",
  );
  assert.equal(
    rustTargetFromArgs(["cargo", "build", "--target=x86_64-pc-windows-msvc"]),
    "x86_64-pc-windows-msvc",
  );
  assert.equal(
    rustTargetFromArgs(["cargo", "build"], {
      CARGO_BUILD_TARGET: "aarch64-pc-windows-msvc",
    }),
    "aarch64-pc-windows-msvc",
  );
  assert.throws(
    () => rustTargetFromArgs(["cargo", "build", "--target"]),
    /requires/,
  );
});

test("reads x64 and ARM64 PE machine values and rejects malformed files", (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "sorng-native-pe-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const x64Path = path.join(fixtureRoot, "x64.dll");
  const arm64Path = path.join(fixtureRoot, "arm64.dll");
  const missingMzPath = path.join(fixtureRoot, "missing-mz.dll");
  const missingPePath = path.join(fixtureRoot, "missing-pe.dll");
  writeFileSync(x64Path, minimalPe(0x8664));
  writeFileSync(arm64Path, minimalPe(0xaa64));
  writeFileSync(missingMzPath, Buffer.alloc(0x86));
  const missingPe = minimalPe(0x8664);
  missingPe.writeUInt32LE(0, 0x80);
  writeFileSync(missingPePath, missingPe);

  assert.equal(readPeMachine(x64Path), 0x8664);
  assert.equal(readPeMachine(arm64Path), 0xaa64);
  assert.throws(() => readPeMachine(missingMzPath), /MZ header/);
  assert.throws(() => readPeMachine(missingPePath), /valid PE signature/);
});

test("reads PE imports and rejects unstaged or dynamic-CRT dependencies", (t) => {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "sorng-native-imports-"),
  );
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const rdkafka = path.join(fixtureRoot, "rdkafka.dll");
  const zlib = path.join(fixtureRoot, "z.dll");
  writeFileSync(rdkafka, peWithImports(0x8664, ["KERNEL32.dll", "z.dll"]));
  writeFileSync(zlib, peWithImports(0x8664, ["KERNEL32.dll"]));

  assert.deepEqual(readPeImports(rdkafka), ["kernel32.dll", "z.dll"]);
  assert.deepEqual(
    validateRuntimeDependencyClosure(fixtureRoot, ["rdkafka.dll", "z.dll"]),
    {
      "rdkafka.dll": ["kernel32.dll", "z.dll"],
      "z.dll": ["kernel32.dll"],
    },
  );

  writeFileSync(rdkafka, peWithImports(0x8664, ["VCRUNTIME140.dll"]));
  assert.throws(
    () =>
      validateRuntimeDependencyClosure(fixtureRoot, ["rdkafka.dll", "z.dll"]),
    /static MSVC runtime/,
  );
  writeFileSync(rdkafka, peWithImports(0x8664, ["unexpected.dll"]));
  assert.throws(
    () =>
      validateRuntimeDependencyClosure(fixtureRoot, ["rdkafka.dll", "z.dll"]),
    /unstaged non-system dependency/,
  );
});

test("pins the all-platform OpenH264 dependency and Windows-only native closure", () => {
  assert.match(VCPKG_BASELINE, /^[0-9a-f]{40}$/u);
  assert.equal(nativeManifest["builtin-baseline"], VCPKG_BASELINE);

  const names = nativeManifest.dependencies.map(dependencyName).sort();
  assert.deepEqual(names, [
    "librdkafka",
    "libssh2",
    "openh264",
    "pkgconf",
    "sqlite3",
  ]);

  const librdkafka = nativeManifest.dependencies.find(
    (dependency) => dependencyName(dependency) === "librdkafka",
  );
  const libssh2 = nativeManifest.dependencies.find(
    (dependency) => dependencyName(dependency) === "libssh2",
  );
  const pkgconf = nativeManifest.dependencies.find(
    (dependency) => dependencyName(dependency) === "pkgconf",
  );
  const sqlite = nativeManifest.dependencies.find(
    (dependency) => dependencyName(dependency) === "sqlite3",
  );
  assert.deepEqual(librdkafka, {
    name: "librdkafka",
    "default-features": false,
    features: ["ssl", "zlib", "zstd"],
    platform: "windows",
  });
  assert.deepEqual(libssh2, {
    name: "libssh2",
    "default-features": false,
    features: ["zlib"],
    platform: "windows",
  });
  assert.ok(nativeManifest.dependencies.includes("openh264"));
  assert.deepEqual(pkgconf, { name: "pkgconf", host: true });
  assert.deepEqual(sqlite, {
    name: "sqlite3",
    features: ["dbstat", "fts3", "fts4", "fts5", "rtree", "soundex"],
    platform: "windows",
  });
});

test("pins OpenH264 2.6.0 and corrects the upstream port to ABI 8", () => {
  assert.equal(openh264OverlayManifest.name, "openh264");
  assert.equal(openh264OverlayManifest.version, OPENH264_VERSION);
  assert.equal(openh264OverlayManifest["port-version"], 4);
  assert.equal(openh264OverlayManifest.license, "BSD-2-Clause");
  assert.match(openh264OverlayPort, /REPO cisco\/openh264/u);
  assert.match(openh264OverlayPort, /REF v\$\{VERSION\}/u);
  assert.match(openh264OverlayPort, /001-add-bsds-to-meson\.patch/u);
  assert.match(openh264OverlayPort, /002-abi-major-8\.patch/u);
  assert.match(openh264AbiPatch, /-major_version = '7'/u);
  assert.match(openh264AbiPatch, /\+major_version = '8'/u);
});

test("custom Windows triplets keep DLLs while preserving the bundled SQLite contract", () => {
  for (const triplet of windowsTriplets) {
    assert.match(triplet, /VCPKG_CRT_LINKAGE static/u);
    assert.match(triplet, /VCPKG_LIBRARY_LINKAGE dynamic/u);
    assert.match(triplet, /VCPKG_BUILD_TYPE release/u);
    for (const option of [
      "SQLITE_DEFAULT_FOREIGN_KEYS=1",
      "SQLITE_ENABLE_API_ARMOR",
      "SQLITE_ENABLE_COLUMN_METADATA",
      "SQLITE_ENABLE_FTS3_PARENTHESIS",
      "SQLITE_ENABLE_LOAD_EXTENSION=1",
      "SQLITE_ENABLE_MEMORY_MANAGEMENT",
      "SQLITE_ENABLE_STAT4",
      "SQLITE_SOUNDEX",
      "SQLITE_USE_URI",
    ]) {
      assert.ok(triplet.includes(option));
    }
  }
  assert.match(releaseWorkflow, /native\/triplets\/\*/u);
});

test("the pinned librdkafka overlay retains all supported Kafka codecs", () => {
  assert.match(kafkaOverlayPort, /-DWITH_SNAPPY=ON/u);
  assert.match(nativeRuntimeStager, /--overlay-ports=\$\{portsRoot\}/u);
  assert.match(nativeRuntimeStager, /validateKafkaRuntimeFeatures/u);
  for (const feature of [
    "gzip",
    "snappy",
    "ssl",
    "sasl",
    "lz4",
    "sasl_gssapi",
    "sasl_plain",
    "sasl_scram",
    "zstd",
    "sasl_oauthbearer",
  ]) {
    assert.ok(kafkaRuntimeProbe.includes(`"${feature}"`));
  }
  assert.match(kafkaRuntimeProbe, /rd_kafka_conf_get/u);
  assert.match(kafkaRuntimeProbe, /rd_kafka_conf_set/u);
  assert.match(kafkaRuntimeProbe, /LoadLibraryEx\(\$dllPath/u);
  assert.match(nativeRuntimeStager, /SORNG_RDKAFKA_DLL/u);
  assert.match(nativeRuntimeStager, /cwd: stageRoot/u);
  assert.match(releaseWorkflow, /src-tauri\/native\/ports\/\*\*\/\*/u);
  assert.match(releaseWorkflow, /scripts\/probe-rdkafka-runtime\.ps1/u);
});

test("requires the exact architecture-specific native DLL closure", () => {
  assert.equal(Object.isFrozen(COMMON_RUNTIME_DLLS), true);
  assert.equal(Object.isFrozen(OPENSSL_RUNTIME_DLLS), true);
  assert.deepEqual(COMMON_RUNTIME_DLLS, [
    "libssh2.dll",
    "lz4.dll",
    "openh264-8.dll",
    "rdkafka.dll",
    "sqlite3.dll",
    "z.dll",
    "zstd.dll",
  ]);
  assert.deepEqual(runtimeDllsForArchitecture("x64"), [
    "libcrypto-3-x64.dll",
    "libssh2.dll",
    "libssl-3-x64.dll",
    "lz4.dll",
    "openh264-8.dll",
    "rdkafka.dll",
    "sqlite3.dll",
    "z.dll",
    "zstd.dll",
  ]);
  assert.deepEqual(runtimeDllsForArchitecture("arm64"), [
    "libcrypto-3-arm64.dll",
    "libssh2.dll",
    "libssl-3-arm64.dll",
    "lz4.dll",
    "openh264-8.dll",
    "rdkafka.dll",
    "sqlite3.dll",
    "z.dll",
    "zstd.dll",
  ]);
  assert.deepEqual(REQUIRED_LICENSE_PORTS, [
    "librdkafka",
    "libssh2",
    "lz4",
    "openh264",
    "openssl",
    "sqlite3",
    "zlib",
    "zstd",
  ]);
});

test("exports only controlled dynamic-link probes", () => {
  const environment = nativeBuildEnvironment({
    pkgconf: "C:\\native\\pkgconf.exe",
    packageRoot: "C:\\native\\x64-windows",
    stageRoot: "C:\\native\\runtime",
  });

  assert.equal(environment.LIBSSH2_SYS_USE_PKG_CONFIG, "1");
  assert.equal(environment.VCPKGRS_NO_LIBSSH2, "1");
  // pkg-config treats the mere presence of SQLITE3_STATIC as a static-link
  // request on Windows, including the seemingly false value "0".
  assert.equal(environment.SQLITE3_STATIC, undefined);
  assert.equal(environment.VCPKGRS_DYNAMIC, undefined);
  assert.equal(
    environment.OPENH264_LIB_DIR,
    path.join("C:\\native\\x64-windows", "lib"),
  );
  assert.match(environment.PKG_CONFIG_PATH, /lib[\\/]pkgconfig/u);
});

test("normal Windows Tauri builds select the staged dynamic feature set", () => {
  assert.match(
    packageManifest.scripts["tauri:build"],
    /--dynamic-native-runtime[\s\S]*--features full/u,
  );
  assert.match(
    nativeBuildWrapper,
    /target: rustTargetFromArgs\(args, env\)[\s\S]*full-windows-dynamic/u,
  );
  assert.match(
    cargoManifest,
    /^full-windows-dynamic = \[[^\r\n]*"db-sqlite-dynamic"[^\r\n]*"kafka-dynamic"[^\r\n]*\]$/mu,
  );
  assert.match(cargoManifest, /^kafka-dynamic = \["kafka"\]$/mu);
  assert.match(
    kafkaStateRegistry,
    /#\[cfg\(feature = "kafka"\)\][\s\S]*KafkaServiceState/u,
  );

  const runtimeDlls = runtimeDllsForArchitecture("x64");
  const resources = windowsNativeTauriConfig(runtimeDlls).bundle.resources;
  assert.deepEqual(
    Object.keys(resources).sort(),
    [
      "../src/i18n/locales/",
      "crates/sorng-opkssh-vendor/bundle/opkssh/",
      "resources/native-runtime-licenses/",
      ...runtimeDlls.map((filename) => `resources/native-runtime/${filename}`),
    ].sort(),
  );
  for (const filename of runtimeDlls) {
    assert.equal(resources[`resources/native-runtime/${filename}`], filename);
  }
  assert.match(
    nativeBuildWrapper,
    /tauri[\s\S]*build[\s\S]*--config[\s\S]*writeWindowsNativeTauriConfig/u,
  );
  assert.match(
    nativeBuildWrapper,
    /@tauri-apps\/cli\/tauri\.js[\s\S]*executable = process\.execPath/u,
  );
});

test("Windows runtime-closure checks stay explicit", () => {
  assert.match(
    releaseWorkflow,
    /NativeLibrary\]::Load[\s\S]*NativeLibrary\]::Free/u,
  );
});

test("Windows release linker size controls stay explicit", () => {
  assert.match(
    appBuildScript,
    /CARGO_CFG_TARGET_OS[\s\S]*windows[\s\S]*PROFILE[\s\S]*release/u,
  );
  for (const linkerArgument of [
    "/OPT:REF",
    "/OPT:ICF",
    "/INCREMENTAL:NO",
    "/Brepro",
  ]) {
    assert.ok(appBuildScript.includes(`"${linkerArgument}"`));
  }
});
