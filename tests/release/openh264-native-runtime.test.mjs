import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OPENH264_ABI_MAJOR,
  OPENH264_ELF_RUNTIME,
  OPENH264_LICENSE_FILENAME,
  OPENH264_MACH_INSTALL_NAME,
  OPENH264_MACH_RUNTIME,
  defaultRustTarget,
  openh264BuildEnvironment,
  openh264GithubEnvironment,
  openh264NativeTauriConfig,
  parseElfSoname,
  parseOpenH264Cli,
  readElfMachine,
  readMachCpuType,
  targetSpec,
} from "../../scripts/stage-openh264-runtime.mjs";
import { OPENH264_VERSION } from "../../scripts/stage-windows-native-runtime.mjs";

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
const nativeReadme = readFileSync(
  new URL("../../src-tauri/native/README.md", import.meta.url),
  "utf8",
);
const nativeBuildWrapper = readFileSync(
  new URL("../../scripts/native-build-env.mjs", import.meta.url),
  "utf8",
);
const runtimeStager = readFileSync(
  new URL("../../scripts/stage-openh264-runtime.mjs", import.meta.url),
  "utf8",
);
const openh264Port = readFileSync(
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

const targetTriplets = new Map([
  ["x86_64-unknown-linux-gnu", "x64-linux-sorng"],
  ["aarch64-unknown-linux-gnu", "arm64-linux-sorng"],
  ["x86_64-apple-darwin", "x64-osx-sorng"],
  ["aarch64-apple-darwin", "arm64-osx-sorng"],
]);
const releaseTriplets = new Map(
  [...targetTriplets.values()].map((triplet) => [
    triplet,
    readFileSync(
      new URL(
        `../../src-tauri/native/triplets/${triplet}.cmake`,
        import.meta.url,
      ),
      "utf8",
    ),
  ]),
);

function minimalElf(machine) {
  const bytes = Buffer.alloc(20);
  bytes[0] = 0x7f;
  bytes.write("ELF", 1, "ascii");
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}

function minimalMach(cpuType) {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpuType, 4);
  return bytes;
}

test("maps all four supported Unix Rust targets to dynamic release triplets", () => {
  for (const [target, triplet] of targetTriplets) {
    const configuration = targetSpec(target);
    assert.equal(configuration.triplet, triplet);
    assert.equal(configuration.runtime.includes("openh264"), true);
  }
  assert.equal(defaultRustTarget("linux", "x64"), "x86_64-unknown-linux-gnu");
  assert.equal(
    defaultRustTarget("linux", "arm64"),
    "aarch64-unknown-linux-gnu",
  );
  assert.equal(defaultRustTarget("darwin", "x64"), "x86_64-apple-darwin");
  assert.equal(defaultRustTarget("darwin", "arm64"), "aarch64-apple-darwin");
  assert.throws(() => targetSpec("i686-unknown-linux-gnu"), /unsupported/u);
  assert.throws(() => defaultRustTarget("linux", "ia32"), /unsupported/u);

  for (const triplet of releaseTriplets.values()) {
    assert.match(triplet, /VCPKG_LIBRARY_LINKAGE dynamic/u);
    assert.match(triplet, /VCPKG_BUILD_TYPE release/u);
  }
  assert.match(releaseTriplets.get("x64-linux-sorng"), /SYSTEM_NAME Linux/u);
  assert.match(releaseTriplets.get("arm64-linux-sorng"), /ARCHITECTURE arm64/u);
  assert.match(
    releaseTriplets.get("x64-osx-sorng"),
    /OSX_ARCHITECTURES x86_64/u,
  );
  assert.match(
    releaseTriplets.get("arm64-osx-sorng"),
    /OSX_ARCHITECTURES arm64/u,
  );
});

test("keeps the exact OpenH264 2.6.0 ABI-8 loader names", () => {
  assert.equal(OPENH264_VERSION, "2.6.0");
  assert.equal(OPENH264_ABI_MAJOR, 8);
  assert.equal(OPENH264_ELF_RUNTIME, "libopenh264.so.8");
  assert.equal(OPENH264_MACH_RUNTIME, "libopenh264.8.dylib");
  assert.equal(OPENH264_MACH_INSTALL_NAME, "@rpath/libopenh264.8.dylib");
  assert.equal(OPENH264_LICENSE_FILENAME, "openh264.txt");
  assert.match(openh264Port, /REF v\$\{VERSION\}/u);
  assert.match(openh264Port, /002-abi-major-8\.patch/u);
  assert.match(openh264AbiPatch, /-major_version = '7'/u);
  assert.match(openh264AbiPatch, /\+major_version = '8'/u);
});

test("reads x64 and ARM64 ELF and Mach-O headers", (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "sorng-openh264-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const x64Elf = path.join(fixtureRoot, "x64.so");
  const arm64Elf = path.join(fixtureRoot, "arm64.so");
  const x64Mach = path.join(fixtureRoot, "x64.dylib");
  const arm64Mach = path.join(fixtureRoot, "arm64.dylib");
  const invalid = path.join(fixtureRoot, "invalid.bin");
  writeFileSync(x64Elf, minimalElf(0x3e));
  writeFileSync(arm64Elf, minimalElf(0xb7));
  writeFileSync(x64Mach, minimalMach(0x01000007));
  writeFileSync(arm64Mach, minimalMach(0x0100000c));
  writeFileSync(invalid, Buffer.alloc(20));

  assert.equal(readElfMachine(x64Elf), 0x3e);
  assert.equal(readElfMachine(arm64Elf), 0xb7);
  assert.equal(readMachCpuType(x64Mach), 0x01000007);
  assert.equal(readMachCpuType(arm64Mach), 0x0100000c);
  assert.throws(() => readElfMachine(invalid), /valid ELF header/u);
  assert.throws(() => readMachCpuType(invalid), /Mach-O 64-bit/u);
});

test("reads the SONAME from GNU readelf dynamic-section output", () => {
  const output = `
Dynamic section at offset 0x123 contains 3 entries:
  Tag        Type                         Name/Value
 0x0000000000000001 (NEEDED)             Shared library: [libstdc++.so.6]
 0x000000000000000e (SONAME)             Library soname: [libopenh264.so.8]
 0x0000000000000000 (NULL)               0x0
`;

  assert.equal(parseElfSoname(output), OPENH264_ELF_RUNTIME);
  assert.equal(parseElfSoname(output.replace("SONAME", "NEEDED")), undefined);
});

test("parses the release workflow CLI and exports link and loader paths", () => {
  assert.deepEqual(
    parseOpenH264Cli([
      "--target",
      "aarch64-unknown-linux-gnu",
      "--github-env",
      "/tmp/github-env",
    ]),
    {
      target: "aarch64-unknown-linux-gnu",
      githubEnvironmentFile: "/tmp/github-env",
    },
  );
  assert.deepEqual(
    parseOpenH264Cli(["--target=x86_64-apple-darwin", "--github-env"], {
      GITHUB_ENV: "/tmp/from-environment",
    }),
    {
      target: "x86_64-apple-darwin",
      githubEnvironmentFile: "/tmp/from-environment",
    },
  );
  assert.throws(() => parseOpenH264Cli(["--target"]), /requires/u);
  assert.throws(() => parseOpenH264Cli(["--target="]), /requires/u);
  assert.throws(() => parseOpenH264Cli(["--unknown"]), /unknown argument/u);

  const packageRoot = path.resolve("native", "arm64-linux-sorng");
  const stageRoot = path.resolve("runtime");
  const environment = openh264BuildEnvironment({
    packageRoot,
    stageRoot,
    loaderVariable: "LD_LIBRARY_PATH",
  });
  assert.equal(environment.OPENH264_LIB_DIR, path.join(packageRoot, "lib"));
  for (const name of [
    "PKG_CONFIG",
    "PKG_CONFIG_ALLOW_CROSS",
    "PKG_CONFIG_LIBDIR",
    "PKG_CONFIG_PATH",
  ]) {
    assert.equal(environment[name], undefined);
  }
  assert.deepEqual(
    environment.LD_LIBRARY_PATH.split(path.delimiter).slice(0, 2),
    [stageRoot, path.join(packageRoot, "lib")],
  );
  const githubEnvironment = openh264GithubEnvironment(
    environment,
    "LD_LIBRARY_PATH",
  );
  assert.equal(githubEnvironment.LD_LIBRARY_PATH, undefined);
  assert.equal(
    githubEnvironment.OPENH264_LIB_DIR,
    path.join(packageRoot, "lib"),
  );
  for (const name of [
    "PKG_CONFIG",
    "PKG_CONFIG_ALLOW_CROSS",
    "PKG_CONFIG_LIBDIR",
    "PKG_CONFIG_PATH",
  ]) {
    assert.equal(githubEnvironment[name], undefined);
  }
});

test("the source-build stager validates version, architecture, and loader identity", () => {
  assert.ok(nativeManifest.dependencies.includes("openh264"));
  for (const name of ["librdkafka", "libssh2", "sqlite3"]) {
    const dependency = nativeManifest.dependencies.find(
      (candidate) => candidate?.name === name,
    );
    assert.equal(dependency.platform, "windows");
  }
  assert.match(runtimeStager, /--overlay-ports=\$\{portsRoot\}/u);
  assert.match(runtimeStager, /--overlay-triplets=\$\{tripletsRoot\}/u);
  assert.match(runtimeStager, /usablePinnedVcpkgRoot/u);
  assert.match(runtimeStager, /--modversion[\s\S]*openh264/u);
  assert.match(runtimeStager, /readNativeMachine/u);
  assert.match(runtimeStager, /readelf[\s\S]*SONAME/u);
  assert.match(runtimeStager, /install_name_tool/u);
  assert.match(runtimeStager, /OPENH264_LIB_DIR/u);
  assert.match(runtimeStager, /appendGithubEnvironment/u);
  assert.match(
    nativeBuildWrapper,
    /stageOpenH264Runtime\([\s\S]*rustTargetFromArgs\(args, env\)/u,
  );
});

test("normal Unix Tauri builds hard-link and package OpenH264", () => {
  assert.match(
    packageManifest.scripts["tauri:build"],
    /--dynamic-native-runtime[\s\S]*--features full/u,
  );
  assert.match(nativeBuildWrapper, /full-unix-dynamic/u);
  assert.match(nativeBuildWrapper, /writeOpenH264NativeTauriConfig/u);
  assert.match(
    cargoManifest,
    /^full-unix-dynamic = \[[^\r\n]*"rdp-software-decode-dynamic"[^\r\n]*\]$/mu,
  );

  const linux = openh264NativeTauriConfig("linux", OPENH264_ELF_RUNTIME);
  assert.equal(
    linux.bundle.resources[`resources/native-runtime/${OPENH264_ELF_RUNTIME}`],
    OPENH264_ELF_RUNTIME,
  );
  assert.equal(linux.bundle.macOS, undefined);

  const macos = openh264NativeTauriConfig("darwin", OPENH264_MACH_RUNTIME);
  assert.deepEqual(macos.bundle.macOS.frameworks, [
    `resources/native-runtime/${OPENH264_MACH_RUNTIME}`,
  ]);
  assert.equal(
    macos.bundle.resources["resources/native-runtime-licenses/"],
    "native-runtime-licenses/",
  );
});

test("documents the required hard import and source-build licensing caveat", () => {
  assert.match(nativeReadme, /hard-link OpenH264/u);
  assert.match(nativeReadme, /openh264-8\.dll/u);
  assert.match(nativeReadme, /libopenh264\.so\.8/u);
  assert.match(nativeReadme, /libopenh264\.8\.dylib/u);
  assert.match(nativeReadme, /source-built OpenH264/u);
  assert.match(
    nativeReadme,
    /responsible for any applicable patent royalties/u,
  );
  assert.match(nativeReadme, /not legal advice/u);
});
