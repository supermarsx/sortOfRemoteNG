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
import {
  OPENH264_VERSION,
  STAGED_LICENSE_DIRECTORY,
  STAGED_RUNTIME_DIRECTORY,
  VCPKG_BASELINE,
  usablePinnedVcpkgRoot,
} from "./stage-windows-native-runtime.mjs";

export const OPENH264_ABI_MAJOR = 8;
export const OPENH264_LICENSE_FILENAME = "openh264.txt";
export const OPENH264_ELF_RUNTIME = `libopenh264.so.${OPENH264_ABI_MAJOR}`;
export const OPENH264_MACH_RUNTIME = `libopenh264.${OPENH264_ABI_MAJOR}.dylib`;
export const OPENH264_MACH_INSTALL_NAME = `@rpath/${OPENH264_MACH_RUNTIME}`;

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), "..");
const manifestRoot = path.join(repoRoot, "src-tauri", "native");
const portsRoot = path.join(manifestRoot, "ports");
const tripletsRoot = path.join(manifestRoot, "triplets");
const defaultStageRoot = path.join(repoRoot, STAGED_RUNTIME_DIRECTORY);
const defaultLicenseStageRoot = path.join(repoRoot, STAGED_LICENSE_DIRECTORY);
export const OPENH264_NATIVE_TAURI_CONFIG = path.join(
  repoRoot,
  "src-tauri",
  "tauri.openh264-native.conf.json",
);
const bootstrapRoot = path.join(repoRoot, ".cache", "vcpkg-tool");

const TARGETS = Object.freeze({
  "x86_64-unknown-linux-gnu": Object.freeze({
    platform: "linux",
    architecture: "x64",
    triplet: "x64-linux-sorng",
    format: "elf",
    machine: 0x3e,
    runtime: OPENH264_ELF_RUNTIME,
    versionedRuntime: `libopenh264.so.${OPENH264_VERSION}`,
    loaderVariable: "LD_LIBRARY_PATH",
  }),
  "aarch64-unknown-linux-gnu": Object.freeze({
    platform: "linux",
    architecture: "arm64",
    triplet: "arm64-linux-sorng",
    format: "elf",
    machine: 0xb7,
    runtime: OPENH264_ELF_RUNTIME,
    versionedRuntime: `libopenh264.so.${OPENH264_VERSION}`,
    loaderVariable: "LD_LIBRARY_PATH",
  }),
  "x86_64-apple-darwin": Object.freeze({
    platform: "darwin",
    architecture: "x64",
    triplet: "x64-osx-sorng",
    format: "mach-o",
    machine: 0x01000007,
    runtime: OPENH264_MACH_RUNTIME,
    loaderVariable: "DYLD_LIBRARY_PATH",
  }),
  "aarch64-apple-darwin": Object.freeze({
    platform: "darwin",
    architecture: "arm64",
    triplet: "arm64-osx-sorng",
    format: "mach-o",
    machine: 0x0100000c,
    runtime: OPENH264_MACH_RUNTIME,
    loaderVariable: "DYLD_LIBRARY_PATH",
  }),
});

function fail(message) {
  throw new Error(`[openh264-native-runtime] ${message}`);
}

function log(message) {
  process.stdout.write(`[openh264-native-runtime] ${message}\n`);
}

function run(executable, args, options = {}) {
  log(`${path.basename(executable)} ${args.join(" ")}`);
  execFileSync(executable, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
}

function capture(executable, args, options = {}) {
  return execFileSync(executable, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function targetSpec(target) {
  const configuration = TARGETS[target];
  if (!configuration) {
    fail(`unsupported OpenH264 Rust target ${target}`);
  }
  return configuration;
}

export function defaultRustTarget(
  platform = process.platform,
  architecture = process.arch,
) {
  const key = `${platform}/${architecture}`;
  switch (key) {
    case "linux/x64":
      return "x86_64-unknown-linux-gnu";
    case "linux/arm64":
      return "aarch64-unknown-linux-gnu";
    case "darwin/x64":
      return "x86_64-apple-darwin";
    case "darwin/arm64":
      return "aarch64-apple-darwin";
    default:
      fail(`unsupported OpenH264 build host ${key}`);
  }
}

export function readElfMachine(filePath) {
  const bytes = readFileSync(filePath);
  if (
    bytes.length < 20 ||
    bytes[0] !== 0x7f ||
    bytes.toString("ascii", 1, 4) !== "ELF"
  ) {
    fail(`${filePath} does not contain a valid ELF header`);
  }
  if (bytes[4] !== 2) fail(`${filePath} is not a 64-bit ELF library`);
  if (bytes[5] !== 1) fail(`${filePath} is not a little-endian ELF library`);
  return bytes.readUInt16LE(18);
}

export function readMachCpuType(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf) {
    fail(`${filePath} is not a thin little-endian Mach-O 64-bit library`);
  }
  return bytes.readUInt32LE(4);
}

export function readNativeMachine(filePath, format) {
  if (format === "elf") return readElfMachine(filePath);
  if (format === "mach-o") return readMachCpuType(filePath);
  fail(`unsupported native library format ${format}`);
}

function commandPath(command) {
  try {
    return capture("which", [command]).split(/\r?\n/u).find(Boolean);
  } catch {
    return undefined;
  }
}

function vcpkgExecutableName() {
  return process.platform === "win32" ? "vcpkg.exe" : "vcpkg";
}

function bootstrapVcpkg() {
  const gitDirectory = path.join(bootstrapRoot, ".git");
  if (!existsSync(gitDirectory)) {
    mkdirSync(path.dirname(bootstrapRoot), { recursive: true });
    run("git", [
      "clone",
      "--depth=1",
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

  const executable = path.join(bootstrapRoot, vcpkgExecutableName());
  if (!existsSync(executable)) {
    run("sh", ["bootstrap-vcpkg.sh", "-disableMetrics"], {
      cwd: bootstrapRoot,
    });
  }
  if (!existsSync(executable)) {
    fail(`the pinned vcpkg bootstrap produced no ${vcpkgExecutableName()}`);
  }
  return { root: bootstrapRoot, executable };
}

function resolveVcpkg() {
  for (const candidate of [
    process.env.SORNG_VCPKG_ROOT,
    process.env.VCPKG_INSTALLATION_ROOT,
    process.env.VCPKG_ROOT,
  ]) {
    const installation = usablePinnedVcpkgRoot(
      candidate,
      vcpkgExecutableName(),
    );
    if (installation) return installation;
  }

  const executable = commandPath(vcpkgExecutableName());
  if (executable) {
    const installation = usablePinnedVcpkgRoot(
      path.dirname(executable),
      vcpkgExecutableName(),
    );
    if (installation) return installation;
  }
  return bootstrapVcpkg();
}

function hostTriplet(platform = process.platform, architecture = process.arch) {
  const key = `${platform}/${architecture}`;
  switch (key) {
    case "linux/x64":
      return "x64-linux";
    case "linux/arm64":
      return "arm64-linux";
    case "darwin/x64":
      return "x64-osx";
    case "darwin/arm64":
      return "arm64-osx";
    default:
      fail(`unsupported vcpkg build host ${key}`);
  }
}

function findPkgconf(installRoot, buildHostTriplet) {
  const toolsRoot = path.join(
    installRoot,
    buildHostTriplet,
    "tools",
    "pkgconf",
  );
  for (const filename of ["pkgconf", "pkg-config"]) {
    const candidate = path.join(toolsRoot, filename);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  fail(`pkgconf host tool was not installed under ${toolsRoot}`);
}

function pkgConfigEnvironment(pkgconf, packageRoot) {
  const pkgConfigPath = [
    path.join(packageRoot, "lib", "pkgconfig"),
    path.join(packageRoot, "share", "pkgconfig"),
  ].join(path.delimiter);
  return {
    ...process.env,
    PKG_CONFIG: pkgconf,
    PKG_CONFIG_ALLOW_CROSS: "1",
    PKG_CONFIG_LIBDIR: pkgConfigPath,
    PKG_CONFIG_PATH: pkgConfigPath,
  };
}

function validatePkgConfig(pkgconf, packageRoot) {
  const environment = pkgConfigEnvironment(pkgconf, packageRoot);
  const version = capture(pkgconf, ["--modversion", "openh264"], {
    env: environment,
  });
  if (version !== OPENH264_VERSION) {
    fail(
      `OpenH264 pkg-config version ${version} does not match required ${OPENH264_VERSION}`,
    );
  }
  const libraries = capture(pkgconf, ["--libs-only-l", "openh264"], {
    env: environment,
  })
    .split(/\s+/u)
    .filter(Boolean);
  if (!libraries.includes("-lopenh264")) {
    fail(
      `OpenH264 pkg-config link flags omit -lopenh264: ${libraries.join(" ")}`,
    );
  }
  return { environment, version };
}

function clearPreviouslyStagedOpenH264(stageRoot) {
  mkdirSync(stageRoot, { recursive: true });
  for (const entry of readdirSync(stageRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^libopenh264(?:\.|-)/u.test(entry.name)) {
      rmSync(path.join(stageRoot, entry.name));
    }
  }
}

export function parseElfSoname(output) {
  return output.match(
    /^\s*[^\r\n]*\(SONAME\)[^\r\n]*\[([^\]\r\n]+)\]\s*$/mu,
  )?.[1];
}

function readElfSoname(filePath) {
  return parseElfSoname(capture("readelf", ["-d", filePath]));
}

function readMachInstallName(filePath) {
  const lines = capture("otool", ["-D", filePath])
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[1];
}

function validateAndNormalizeLoaderIdentity(filePath, configuration) {
  if (configuration.format === "elf") {
    const soname = readElfSoname(filePath);
    if (soname !== OPENH264_ELF_RUNTIME) {
      fail(
        `${path.basename(filePath)} has SONAME ${soname ?? "(missing)"}, expected ${OPENH264_ELF_RUNTIME}`,
      );
    }
    return soname;
  }

  let installName = readMachInstallName(filePath);
  if (installName !== OPENH264_MACH_INSTALL_NAME) {
    run("install_name_tool", ["-id", OPENH264_MACH_INSTALL_NAME, filePath]);
    installName = readMachInstallName(filePath);
  }
  if (installName !== OPENH264_MACH_INSTALL_NAME) {
    fail(
      `${path.basename(filePath)} has install name ${installName ?? "(missing)"}, expected ${OPENH264_MACH_INSTALL_NAME}`,
    );
  }
  return installName;
}

function stageLicense(packageRoot, licenseStageRoot) {
  const source = path.join(packageRoot, "share", "openh264", "copyright");
  if (!existsSync(source) || !statSync(source).isFile()) {
    fail(`vcpkg OpenH264 copyright file is missing: ${source}`);
  }
  mkdirSync(licenseStageRoot, { recursive: true });
  const destination = path.join(licenseStageRoot, OPENH264_LICENSE_FILENAME);
  copyFileSync(source, destination);
  if (sha256(source) !== sha256(destination)) {
    fail(`${OPENH264_LICENSE_FILENAME} did not survive staging byte-for-byte`);
  }
  return OPENH264_LICENSE_FILENAME;
}

export function openh264BuildEnvironment({
  pkgconf,
  packageRoot,
  stageRoot,
  loaderVariable,
}) {
  const pkgConfigPath = [
    path.join(packageRoot, "lib", "pkgconfig"),
    path.join(packageRoot, "share", "pkgconfig"),
  ].join(path.delimiter);
  const existingLoaderPath = process.env[loaderVariable] ?? "";
  return {
    OPENH264_LIB_DIR: path.join(packageRoot, "lib"),
    PKG_CONFIG: pkgconf,
    PKG_CONFIG_ALLOW_CROSS: "1",
    PKG_CONFIG_LIBDIR: pkgConfigPath,
    PKG_CONFIG_PATH: pkgConfigPath,
    [loaderVariable]: [
      stageRoot,
      path.join(packageRoot, "lib"),
      existingLoaderPath,
    ]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

export function openh264GithubEnvironment(environment, loaderVariable) {
  const githubEnvironment = { ...environment };
  // Loader variables would outrank the packaged ELF RUNPATH and macOS rpaths
  // during artifact verification, allowing a staging/cache copy to mask a
  // broken package. They are useful only for an immediate local child process.
  delete githubEnvironment[loaderVariable];
  return githubEnvironment;
}

export function openh264NativeTauriConfig(platform, runtime) {
  const resources = {
    "crates/sorng-opkssh-vendor/bundle/opkssh/": "opkssh/",
    "../src/i18n/locales/": "locales/",
    "resources/native-runtime-licenses/": "native-runtime-licenses/",
  };
  const source = `resources/native-runtime/${runtime}`;

  if (platform === "linux") {
    if (runtime !== OPENH264_ELF_RUNTIME) {
      fail(
        `Linux Tauri config requires ${OPENH264_ELF_RUNTIME}, got ${runtime}`,
      );
    }
    resources[source] = runtime;
    return { bundle: { resources } };
  }

  if (platform === "darwin") {
    if (runtime !== OPENH264_MACH_RUNTIME) {
      fail(
        `macOS Tauri config requires ${OPENH264_MACH_RUNTIME}, got ${runtime}`,
      );
    }
    return {
      bundle: {
        resources,
        macOS: { frameworks: [source] },
      },
    };
  }

  fail(`unsupported OpenH264 Tauri platform ${platform}`);
}

export function writeOpenH264NativeTauriConfig(
  platform,
  runtime,
  outputPath = OPENH264_NATIVE_TAURI_CONFIG,
) {
  writeFileSync(
    outputPath,
    `${JSON.stringify(openh264NativeTauriConfig(platform, runtime), null, 2)}\n`,
    "utf8",
  );
  return outputPath;
}

function appendGithubEnvironment(filePath, environment) {
  const lines = Object.entries(environment).map(([name, value]) => {
    if (/\r|\n/u.test(value)) fail(`${name} cannot be exported with a newline`);
    return `${name}=${value}`;
  });
  appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

export function stageOpenH264Runtime({
  target,
  stageRoot = defaultStageRoot,
  licenseStageRoot = defaultLicenseStageRoot,
  githubEnvironmentFile,
} = {}) {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return {
      skipped: true,
      reason: `host is ${process.platform}`,
      environment: {},
    };
  }

  const resolvedTarget = target ?? defaultRustTarget();
  const configuration = targetSpec(resolvedTarget);
  if (configuration.platform !== process.platform) {
    fail(
      `target ${resolvedTarget} requires ${configuration.platform}, but the build host is ${process.platform}`,
    );
  }

  const vcpkg = resolveVcpkg();
  const buildHostTriplet = hostTriplet();
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
      `--triplet=${configuration.triplet}`,
      `--host-triplet=${buildHostTriplet}`,
      `--overlay-ports=${portsRoot}`,
      `--overlay-triplets=${tripletsRoot}`,
      `--x-install-root=${installRoot}`,
      `--vcpkg-root=${vcpkg.root}`,
      "--disable-metrics",
    ],
    { cwd: manifestRoot },
  );

  const packageRoot = path.join(installRoot, configuration.triplet);
  const pkgconf = findPkgconf(installRoot, buildHostTriplet);
  const pkgConfig = validatePkgConfig(pkgconf, packageRoot);
  const libraryRoot = path.join(packageRoot, "lib");
  const source = path.join(libraryRoot, configuration.runtime);
  if (!existsSync(source) || !statSync(source).isFile()) {
    fail(`required OpenH264 runtime was not produced: ${source}`);
  }
  if (configuration.versionedRuntime) {
    const versionedSource = path.join(
      libraryRoot,
      configuration.versionedRuntime,
    );
    if (!existsSync(versionedSource) || !statSync(versionedSource).isFile()) {
      fail(
        `versioned OpenH264 ${OPENH264_VERSION} library is missing: ${versionedSource}`,
      );
    }
  }

  const sourceMachine = readNativeMachine(source, configuration.format);
  if (sourceMachine !== configuration.machine) {
    fail(
      `${configuration.runtime} has machine 0x${sourceMachine.toString(16)}, expected 0x${configuration.machine.toString(16)}`,
    );
  }

  const resolvedStageRoot = path.resolve(stageRoot);
  clearPreviouslyStagedOpenH264(resolvedStageRoot);
  const destination = path.join(resolvedStageRoot, configuration.runtime);
  copyFileSync(source, destination);
  const destinationMachine = readNativeMachine(
    destination,
    configuration.format,
  );
  if (destinationMachine !== configuration.machine) {
    fail(`${configuration.runtime} changed architecture while staging`);
  }
  const loaderIdentity = validateAndNormalizeLoaderIdentity(
    destination,
    configuration,
  );
  const license = stageLicense(packageRoot, path.resolve(licenseStageRoot));
  const environment = openh264BuildEnvironment({
    pkgconf,
    packageRoot,
    stageRoot: resolvedStageRoot,
    loaderVariable: configuration.loaderVariable,
  });
  if (githubEnvironmentFile) {
    appendGithubEnvironment(
      githubEnvironmentFile,
      openh264GithubEnvironment(environment, configuration.loaderVariable),
    );
  }
  log(
    `staged OpenH264 ${pkgConfig.version} for ${resolvedTarget}: ${configuration.runtime} (${loaderIdentity}) and ${license}`,
  );
  return {
    skipped: false,
    target: resolvedTarget,
    triplet: configuration.triplet,
    machine: configuration.machine,
    files: [configuration.runtime],
    licenses: [license],
    loaderIdentity,
    environment,
  };
}

export function parseOpenH264Cli(argv, environment = process.env) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--target") {
      const target = argv[++index];
      if (!target || target.startsWith("-")) {
        fail("--target requires a Rust target triple");
      }
      options.target = target;
    } else if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (!target) fail("--target requires a Rust target triple");
      options.target = target;
    } else if (argument === "--github-env") {
      const githubEnvironmentFile = argv[++index] ?? environment.GITHUB_ENV;
      if (!githubEnvironmentFile || githubEnvironmentFile.startsWith("-")) {
        fail("--github-env requires a path or GITHUB_ENV");
      }
      options.githubEnvironmentFile = githubEnvironmentFile;
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const result = stageOpenH264Runtime(
      parseOpenH264Cli(process.argv.slice(2)),
    );
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
