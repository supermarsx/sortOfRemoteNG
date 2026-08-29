#!/usr/bin/env node

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

export const VCPKG_BASELINE = "b9b668c1de09b065f53a3943939801b901b585ef";
export const MINIMUM_RDKAFKA_VERSION = "2.12.1";
export const OPENH264_VERSION = "2.6.0";
export const STAGED_RUNTIME_DIRECTORY = path.join(
  "src-tauri",
  "resources",
  "native-runtime",
);
export const STAGED_LICENSE_DIRECTORY = path.join(
  "src-tauri",
  "resources",
  "native-runtime-licenses",
);
export const COMMON_RUNTIME_DLLS = Object.freeze([
  "libssh2.dll",
  "lz4.dll",
  "openh264-8.dll",
  "rdkafka.dll",
  "sqlite3.dll",
  "z.dll",
  "zstd.dll",
]);
export const OPENSSL_RUNTIME_DLLS = Object.freeze({
  x64: Object.freeze(["libcrypto-3-x64.dll", "libssl-3-x64.dll"]),
  arm64: Object.freeze(["libcrypto-3-arm64.dll", "libssl-3-arm64.dll"]),
});
export const REQUIRED_LICENSE_PORTS = Object.freeze([
  "librdkafka",
  "libssh2",
  "lz4",
  "openh264",
  "openssl",
  "sqlite3",
  "zlib",
  "zstd",
]);

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), "..");
export const WINDOWS_NATIVE_TAURI_CONFIG = path.join(
  repoRoot,
  "src-tauri",
  "tauri.windows-native.conf.json",
);
const manifestRoot = path.join(repoRoot, "src-tauri", "native");
const portsRoot = path.join(manifestRoot, "ports");
const tripletsRoot = path.join(manifestRoot, "triplets");
const defaultStageRoot = path.join(repoRoot, STAGED_RUNTIME_DIRECTORY);
const defaultLicenseStageRoot = path.join(repoRoot, STAGED_LICENSE_DIRECTORY);
const bootstrapRoot = path.join(repoRoot, ".cache", "vcpkg-tool");
const kafkaProbeScript = path.join(
  repoRoot,
  "scripts",
  "probe-rdkafka-runtime.ps1",
);

function fail(message) {
  throw new Error(`[windows-native-runtime] ${message}`);
}

function log(message) {
  process.stdout.write(`[windows-native-runtime] ${message}\n`);
}

function validateKafkaRuntimeFeatures(stageRoot, architecture) {
  if (process.arch !== architecture) {
    log(
      `skipping executable librdkafka feature probe while staging ${architecture} from ${process.arch}`,
    );
    return;
  }

  const existingPath = process.env.Path ?? process.env.PATH ?? "";
  const probePath = [stageRoot, existingPath]
    .filter(Boolean)
    .join(path.delimiter);
  run(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", kafkaProbeScript],
    {
      cwd: stageRoot,
      env: {
        ...process.env,
        PATH: probePath,
        Path: probePath,
        SORNG_RDKAFKA_DLL: path.join(stageRoot, "rdkafka.dll"),
      },
    },
  );
}

export function runtimeDllsForArchitecture(architecture) {
  const opensslDlls = OPENSSL_RUNTIME_DLLS[architecture];
  if (!opensslDlls)
    fail(`unsupported Windows runtime architecture ${architecture}`);
  return [...opensslDlls, ...COMMON_RUNTIME_DLLS].sort();
}

export function windowsNativeTauriConfig(
  runtimeDlls = runtimeDllsForArchitecture(process.arch),
) {
  const resources = {
    "crates/sorng-opkssh-vendor/bundle/opkssh/": "opkssh/",
    "../src/i18n/locales/": "locales/",
    "resources/native-runtime-licenses/": "native-runtime-licenses/",
  };
  for (const filename of runtimeDlls) {
    resources[`resources/native-runtime/${filename}`] = filename;
  }
  return { bundle: { resources } };
}

export function writeWindowsNativeTauriConfig(
  outputPath = WINDOWS_NATIVE_TAURI_CONFIG,
  runtimeDlls,
) {
  writeFileSync(
    outputPath,
    `${JSON.stringify(windowsNativeTauriConfig(runtimeDlls), null, 2)}\n`,
    "utf8",
  );
  return outputPath;
}

function run(executable, args, options = {}) {
  log(`${path.basename(executable)} ${args.join(" ")}`);
  execFileSync(executable, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
    windowsHide: true,
  });
}

export function targetSpec(target) {
  switch (target) {
    case "x86_64-pc-windows-msvc":
      return {
        triplet: "x64-windows-sorng",
        machine: 0x8664,
        architecture: "x64",
      };
    case "aarch64-pc-windows-msvc":
      return {
        triplet: "arm64-windows-sorng",
        machine: 0xaa64,
        architecture: "arm64",
      };
    default:
      fail(`unsupported Windows Rust target ${target}`);
  }
}

export function hostTriplet(architecture = process.arch) {
  switch (architecture) {
    case "x64":
      return "x64-windows";
    case "arm64":
      return "arm64-windows";
    default:
      fail(`unsupported Windows build-host architecture ${architecture}`);
  }
}

export function rustTargetFromArgs(argv, environment = process.env) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--target") {
      const target = argv[index + 1];
      if (!target || target.startsWith("-")) {
        fail("--target requires a Rust target triple");
      }
      return target;
    }
    if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (!target) fail("--target requires a Rust target triple");
      return target;
    }
  }
  return environment.CARGO_BUILD_TARGET || undefined;
}

export function readPeMachine(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) {
    fail(`${filePath} does not start with an MZ header`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset > bytes.length - 6 || bytes.readUInt32LE(peOffset) !== 0x4550) {
    fail(`${filePath} does not contain a valid PE signature`);
  }
  return bytes.readUInt16LE(peOffset + 4);
}

function peLayout(bytes, filePath) {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) {
    fail(`${filePath} does not start with an MZ header`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset > bytes.length - 24 || bytes.readUInt32LE(peOffset) !== 0x4550) {
    fail(`${filePath} does not contain a valid PE signature`);
  }

  const coffOffset = peOffset + 4;
  const sectionCount = bytes.readUInt16LE(coffOffset + 2);
  const optionalHeaderSize = bytes.readUInt16LE(coffOffset + 16);
  const optionalOffset = coffOffset + 20;
  const sectionTableOffset = optionalOffset + optionalHeaderSize;
  if (sectionTableOffset + sectionCount * 40 > bytes.length) {
    fail(`${filePath} has a truncated PE section table`);
  }

  const magic = bytes.readUInt16LE(optionalOffset);
  let dataDirectoryOffset;
  let directoryCountOffset;
  if (magic === 0x20b) {
    dataDirectoryOffset = optionalOffset + 112;
    directoryCountOffset = optionalOffset + 108;
  } else if (magic === 0x10b) {
    dataDirectoryOffset = optionalOffset + 96;
    directoryCountOffset = optionalOffset + 92;
  } else {
    fail(
      `${filePath} has unsupported PE optional-header magic 0x${magic.toString(16)}`,
    );
  }
  if (directoryCountOffset + 4 > sectionTableOffset) {
    fail(`${filePath} has a truncated PE optional header`);
  }

  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTableOffset + index * 40;
    sections.push({
      virtualSize: bytes.readUInt32LE(offset + 8),
      virtualAddress: bytes.readUInt32LE(offset + 12),
      rawSize: bytes.readUInt32LE(offset + 16),
      rawOffset: bytes.readUInt32LE(offset + 20),
    });
  }
  return {
    dataDirectoryOffset,
    directoryCount: bytes.readUInt32LE(directoryCountOffset),
    sections,
  };
}

function rvaToFileOffset(bytes, layout, rva, filePath) {
  for (const section of layout.sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
      const offset = section.rawOffset + (rva - section.virtualAddress);
      if (offset >= bytes.length) break;
      return offset;
    }
  }
  fail(`${filePath} contains an unmapped PE RVA 0x${rva.toString(16)}`);
}

function readAsciiZ(bytes, offset, filePath) {
  const end = bytes.indexOf(0, offset);
  if (offset < 0 || offset >= bytes.length || end < 0) {
    fail(`${filePath} contains an unterminated PE import name`);
  }
  return bytes.toString("ascii", offset, end);
}

function importDirectory(
  bytes,
  layout,
  directoryIndex,
  descriptorSize,
  nameOffset,
  filePath,
) {
  if (layout.directoryCount <= directoryIndex) return [];
  const directoryOffset = layout.dataDirectoryOffset + directoryIndex * 8;
  if (directoryOffset + 8 > bytes.length) {
    fail(`${filePath} has a truncated PE data directory`);
  }
  const directoryRva = bytes.readUInt32LE(directoryOffset);
  const directorySize = bytes.readUInt32LE(directoryOffset + 4);
  if (directoryRva === 0 || directorySize === 0) return [];

  const firstDescriptor = rvaToFileOffset(
    bytes,
    layout,
    directoryRva,
    filePath,
  );
  const descriptorLimit = Math.min(
    Math.ceil(directorySize / descriptorSize) + 1,
    4096,
  );
  const imports = [];
  for (let index = 0; index < descriptorLimit; index += 1) {
    const offset = firstDescriptor + index * descriptorSize;
    if (offset + descriptorSize > bytes.length) {
      fail(`${filePath} has a truncated PE import descriptor`);
    }
    let allZero = true;
    for (let cursor = 0; cursor < descriptorSize; cursor += 4) {
      if (bytes.readUInt32LE(offset + cursor) !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) return imports;

    // Modern delay-import descriptors use RVA-based fields (grAttrs bit 0).
    // Reject legacy VA-based descriptors rather than interpreting an address
    // with the wrong image base.
    if (directoryIndex === 13 && (bytes.readUInt32LE(offset) & 1) === 0) {
      fail(`${filePath} uses an unsupported VA-based delay-import descriptor`);
    }
    const nameRva = bytes.readUInt32LE(offset + nameOffset);
    imports.push(
      readAsciiZ(
        bytes,
        rvaToFileOffset(bytes, layout, nameRva, filePath),
        filePath,
      ),
    );
  }
  fail(`${filePath} has no terminating PE import descriptor`);
}

export function readPeImports(filePath) {
  const bytes = readFileSync(filePath);
  const layout = peLayout(bytes, filePath);
  const imports = [
    ...importDirectory(bytes, layout, 1, 20, 12, filePath),
    ...importDirectory(bytes, layout, 13, 32, 4, filePath),
  ];
  return [...new Set(imports.map((name) => name.toLowerCase()))].sort();
}

const WINDOWS_SYSTEM_DLLS = new Set([
  "advapi32.dll",
  "bcrypt.dll",
  "cfgmgr32.dll",
  "crypt32.dll",
  "dnsapi.dll",
  "gdi32.dll",
  "iphlpapi.dll",
  "kernel32.dll",
  "ncrypt.dll",
  "normaliz.dll",
  "ntdll.dll",
  "ole32.dll",
  "oleaut32.dll",
  "rpcrt4.dll",
  "secur32.dll",
  "shell32.dll",
  "shlwapi.dll",
  "user32.dll",
  "userenv.dll",
  "version.dll",
  "winhttp.dll",
  "wininet.dll",
  "winmm.dll",
  "ws2_32.dll",
]);

function isWindowsSystemDll(name) {
  return (
    WINDOWS_SYSTEM_DLLS.has(name) ||
    name.startsWith("api-ms-win-") ||
    name.startsWith("ext-ms-win-")
  );
}

function isDynamicMsvcRuntime(name) {
  return (
    /^vcruntime\d+(?:_\d+)?d?\.dll$/u.test(name) ||
    /^msvcp\d+(?:_\d+)?d?\.dll$/u.test(name) ||
    /^concrt\d+d?\.dll$/u.test(name) ||
    /^ucrtbased?\.dll$/u.test(name) ||
    name.startsWith("api-ms-win-crt-")
  );
}

export function validateRuntimeDependencyClosure(stageRoot, runtimeDlls) {
  if (!runtimeDlls?.length) fail("the native runtime DLL contract is empty");
  const staged = new Set(runtimeDlls.map((name) => name.toLowerCase()));
  const importsByFile = {};
  for (const filename of runtimeDlls) {
    const imports = readPeImports(path.join(stageRoot, filename));
    importsByFile[filename] = imports;
    for (const imported of imports) {
      if (isDynamicMsvcRuntime(imported)) {
        fail(
          `${filename} imports ${imported}; the packaged DLL closure must use the static MSVC runtime`,
        );
      }
      if (!staged.has(imported) && !isWindowsSystemDll(imported)) {
        fail(`${filename} imports unstaged non-system dependency ${imported}`);
      }
    }
  }
  return importsByFile;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function commandPath(command) {
  try {
    return execFileSync("where.exe", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

function usableVcpkgRoot(candidate) {
  if (!candidate) return undefined;
  const root = path.resolve(candidate);
  const executable = path.join(root, "vcpkg.exe");
  return existsSync(executable) && statSync(executable).isFile()
    ? { root, executable }
    : undefined;
}

function bootstrapVcpkg() {
  const gitDirectory = path.join(bootstrapRoot, ".git");
  if (!existsSync(gitDirectory)) {
    mkdirSync(path.dirname(bootstrapRoot), { recursive: true });
    run("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "https://github.com/microsoft/vcpkg.git",
      bootstrapRoot,
    ]);
  }

  run("git", [
    "-C",
    bootstrapRoot,
    "fetch",
    "--depth=1",
    "origin",
    VCPKG_BASELINE,
  ]);
  run("git", ["-C", bootstrapRoot, "checkout", "--detach", VCPKG_BASELINE]);

  const executable = path.join(bootstrapRoot, "vcpkg.exe");
  if (!existsSync(executable)) {
    // Node cannot execute .bat files directly with shell=false. Keep command
    // parsing inside cmd.exe and pass only the fixed, repository-owned path.
    run(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "call bootstrap-vcpkg.bat -disableMetrics"],
      { cwd: bootstrapRoot },
    );
  }
  if (!existsSync(executable))
    fail("the pinned vcpkg bootstrap produced no vcpkg.exe");
  return { root: bootstrapRoot, executable };
}

function resolveVcpkg() {
  for (const candidate of [
    process.env.SORNG_VCPKG_ROOT,
    process.env.VCPKG_INSTALLATION_ROOT,
    process.env.VCPKG_ROOT,
  ]) {
    const installation = usableVcpkgRoot(candidate);
    if (installation) return installation;
  }

  const executable = commandPath("vcpkg.exe") ?? commandPath("vcpkg");
  if (executable) {
    return { root: path.dirname(executable), executable };
  }
  return bootstrapVcpkg();
}

function findPkgconf(installRoot, buildHostTriplet) {
  const toolsRoot = path.join(
    installRoot,
    buildHostTriplet,
    "tools",
    "pkgconf",
  );
  for (const filename of ["pkgconf.exe", "pkg-config.exe"]) {
    const candidate = path.join(toolsRoot, filename);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  fail(`pkgconf host tool was not installed under ${toolsRoot}`);
}

function compareNumericVersions(left, right) {
  const a = left.split(".").map((part) => Number.parseInt(part, 10));
  const b = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

function pkgConfigEnvironment(pkgconf, packageRoot) {
  const pkgConfigPath = [
    path.join(packageRoot, "lib", "pkgconfig"),
    path.join(packageRoot, "share", "pkgconfig"),
  ].join(path.delimiter);
  return {
    ...process.env,
    PKG_CONFIG: pkgconf,
    PKG_CONFIG_PATH: pkgConfigPath,
    PKG_CONFIG_ALLOW_CROSS: "1",
  };
}

function pkgConfigVersion(pkgconf, packageName, env) {
  return execFileSync(pkgconf, ["--modversion", packageName], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  }).trim();
}

function clearPreviouslyStagedDlls(stageRoot) {
  mkdirSync(stageRoot, { recursive: true });
  for (const entry of readdirSync(stageRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll")) {
      rmSync(path.join(stageRoot, entry.name));
    }
  }
}

function stageRuntimeLicenses(packageRoot, licenseStageRoot) {
  mkdirSync(licenseStageRoot, { recursive: true });
  for (const entry of readdirSync(licenseStageRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
      rmSync(path.join(licenseStageRoot, entry.name));
    }
  }

  const staged = [];
  for (const port of REQUIRED_LICENSE_PORTS) {
    const source = path.join(packageRoot, "share", port, "copyright");
    if (!existsSync(source) || !statSync(source).isFile()) {
      fail(`vcpkg copyright file is missing for ${port}: ${source}`);
    }
    const filename = `${port}.txt`;
    const destination = path.join(licenseStageRoot, filename);
    copyFileSync(source, destination);
    if (sha256(source) !== sha256(destination)) {
      fail(`${filename} did not survive license staging byte-for-byte`);
    }
    staged.push(filename);
  }
  return staged;
}

function stageRuntimeDlls(
  packageRoot,
  stageRoot,
  expectedMachine,
  requiredRuntimeDlls,
) {
  const binRoot = path.join(packageRoot, "bin");
  if (!existsSync(binRoot) || !statSync(binRoot).isDirectory()) {
    fail(`vcpkg runtime directory does not exist: ${binRoot}`);
  }

  clearPreviouslyStagedDlls(stageRoot);
  const availableDlls = readdirSync(binRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dll"),
    )
    .map((entry) => entry.name);
  const availableByLowercaseName = new Map(
    availableDlls.map((entry) => [entry.toLowerCase(), entry]),
  );

  const stagedNames = [];
  for (const destinationName of requiredRuntimeDlls) {
    const originalName = availableByLowercaseName.get(
      destinationName.toLowerCase(),
    );
    if (!originalName) {
      fail(
        `required runtime DLL ${destinationName} was not produced in ${binRoot}; ` +
          `available DLLs: ${availableDlls.sort().join(", ") || "(none)"}`,
      );
    }
    const source = path.join(binRoot, originalName);
    const destination = path.join(stageRoot, destinationName);
    const machine = readPeMachine(source);
    if (machine !== expectedMachine) {
      fail(
        `${originalName} has PE Machine 0x${machine.toString(16)}, expected 0x${expectedMachine.toString(16)}`,
      );
    }
    copyFileSync(source, destination);
    if (sha256(source) !== sha256(destination)) {
      fail(`${destinationName} did not survive staging byte-for-byte`);
    }
    stagedNames.push(destinationName);
  }
  return stagedNames;
}

export function nativeBuildEnvironment({ pkgconf, packageRoot, stageRoot }) {
  const pkgConfigPath = [
    path.join(packageRoot, "lib", "pkgconfig"),
    path.join(packageRoot, "share", "pkgconfig"),
  ].join(path.delimiter);
  const existingPath = process.env.Path ?? process.env.PATH ?? "";
  return {
    LIBSSH2_SYS_USE_PKG_CONFIG: "1",
    PKG_CONFIG: pkgconf,
    PKG_CONFIG_ALLOW_CROSS: "1",
    PKG_CONFIG_PATH: pkgConfigPath,
    OPENH264_LIB_DIR: path.join(packageRoot, "lib"),
    SQLITE3_INCLUDE_DIR: path.join(packageRoot, "include"),
    SQLITE3_LIB_DIR: path.join(packageRoot, "lib"),
    // libssh2-sys probes vcpkg before pkg-config and incorrectly assumes that
    // every Windows vcpkg build uses OpenSSL. Disable only that port probe so
    // the pkg-config path selects our WinCNG DLL; other vcpkg probes stay live.
    VCPKGRS_NO_LIBSSH2: "1",
    PATH: [stageRoot, path.join(packageRoot, "bin"), existingPath]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

function appendGithubEnvironment(filePath, environment) {
  const lines = Object.entries(environment).map(([name, value]) => {
    if (/\r|\n/u.test(value)) fail(`${name} cannot be exported with a newline`);
    return `${name}=${value}`;
  });
  appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

export function stageWindowsNativeRuntime({
  target,
  stageRoot = defaultStageRoot,
  licenseStageRoot = defaultLicenseStageRoot,
  githubEnvironmentFile,
} = {}) {
  if (process.platform !== "win32") {
    return { skipped: true, reason: "host is not Windows", environment: {} };
  }
  const resolvedTarget =
    target ??
    (process.arch === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc");
  const targetConfiguration = targetSpec(resolvedTarget);
  const requiredRuntimeDlls = runtimeDllsForArchitecture(
    targetConfiguration.architecture,
  );
  const buildHostTriplet = hostTriplet();
  const vcpkg = resolveVcpkg();
  const installRoot = path.join(
    repoRoot,
    ".cache",
    "vcpkg-installed",
    resolvedTarget,
  );
  mkdirSync(installRoot, { recursive: true });

  run(
    vcpkg.executable,
    [
      "install",
      `--triplet=${targetConfiguration.triplet}`,
      `--host-triplet=${buildHostTriplet}`,
      `--overlay-ports=${portsRoot}`,
      `--overlay-triplets=${tripletsRoot}`,
      `--x-install-root=${installRoot}`,
      `--vcpkg-root=${vcpkg.root}`,
      "--disable-metrics",
    ],
    { cwd: manifestRoot },
  );

  const packageRoot = path.join(installRoot, targetConfiguration.triplet);
  const pkgconf = findPkgconf(installRoot, buildHostTriplet);
  const probeEnvironment = pkgConfigEnvironment(pkgconf, packageRoot);
  const rdkafkaVersion = pkgConfigVersion(pkgconf, "rdkafka", probeEnvironment);
  if (compareNumericVersions(rdkafkaVersion, MINIMUM_RDKAFKA_VERSION) < 0) {
    fail(
      `librdkafka ${rdkafkaVersion} is older than required ${MINIMUM_RDKAFKA_VERSION}`,
    );
  }
  for (const packageName of ["libssh2", "sqlite3"]) {
    log(
      `${packageName} ${pkgConfigVersion(pkgconf, packageName, probeEnvironment)}`,
    );
  }
  const openh264Version = pkgConfigVersion(
    pkgconf,
    "openh264",
    probeEnvironment,
  );
  if (openh264Version !== OPENH264_VERSION) {
    fail(
      `OpenH264 pkg-config version ${openh264Version} does not match required ${OPENH264_VERSION}`,
    );
  }
  const openh264ImportLibrary = path.join(packageRoot, "lib", "openh264.lib");
  if (
    !existsSync(openh264ImportLibrary) ||
    !statSync(openh264ImportLibrary).isFile()
  ) {
    fail(`OpenH264 import library is missing: ${openh264ImportLibrary}`);
  }
  log(`openh264 ${openh264Version}`);

  const files = stageRuntimeDlls(
    packageRoot,
    path.resolve(stageRoot),
    targetConfiguration.machine,
    requiredRuntimeDlls,
  );
  const imports = validateRuntimeDependencyClosure(
    path.resolve(stageRoot),
    files,
  );
  validateKafkaRuntimeFeatures(
    path.resolve(stageRoot),
    targetConfiguration.architecture,
  );
  const licenses = stageRuntimeLicenses(
    packageRoot,
    path.resolve(licenseStageRoot),
  );
  const environment = nativeBuildEnvironment({
    pkgconf,
    packageRoot,
    stageRoot: path.resolve(stageRoot),
  });
  if (githubEnvironmentFile) {
    appendGithubEnvironment(githubEnvironmentFile, environment);
  }
  log(
    `staged ${files.length} ${targetConfiguration.architecture} DLLs and ${licenses.length} license notices: ${files.join(", ")}`,
  );
  return {
    skipped: false,
    target: resolvedTarget,
    triplet: targetConfiguration.triplet,
    machine: targetConfiguration.machine,
    files,
    imports,
    licenses,
    environment,
  };
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--target") {
      options.target = argv[++index];
    } else if (argument === "--github-env") {
      options.githubEnvironmentFile = argv[++index] ?? process.env.GITHUB_ENV;
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  if (argv.includes("--github-env") && !options.githubEnvironmentFile) {
    fail("--github-env requires a path or GITHUB_ENV");
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const result = stageWindowsNativeRuntime(parseCli(process.argv.slice(2)));
    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          environment: Object.keys(result.environment).sort(),
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  }
}
