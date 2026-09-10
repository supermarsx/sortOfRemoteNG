#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { opksshTarget } from "./stage-opkssh-vendor.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export function verifyViewerExecutable(filename, architecture) {
  const bytes = readFileSync(filename);
  if (bytes.length < 256 || bytes.toString("ascii", 0, 2) !== "MZ")
    throw new Error("Viewer helper is not a Windows executable.");
  const pe = bytes.readUInt32LE(0x3c);
  const machine =
    architecture === "amd64"
      ? 0x8664
      : architecture === "arm64"
        ? 0xaa64
        : null;
  if (
    !machine ||
    pe > bytes.length - 6 ||
    bytes.toString("ascii", pe, pe + 4) !== "PE\0\0" ||
    bytes.readUInt16LE(pe + 4) !== machine
  )
    throw new Error(
      "Viewer helper architecture does not match the application.",
    );
  return { bytes: bytes.length, machine };
}

/** Match the application's optional release signing policy before packaging. */
export function signViewerExecutable(
  filename,
  {
    env = process.env,
    run = spawnSync,
    platform = process.platform,
    arch = process.arch,
  } = {},
) {
  if (!env.WINDOWS_CERT_THUMBPRINT?.trim()) return false;
  const thumbprint = env.WINDOWS_CERT_THUMBPRINT.replace(
    /[^0-9a-f]/gi,
    "",
  ).toUpperCase();
  if (platform !== "win32" || !/^[0-9A-F]{40}$/.test(thumbprint))
    throw new Error(
      "Viewer signing requires Windows and a valid certificate thumbprint.",
    );
  const sdkArch = env.WINDOWS_SDK_ARCH || (arch === "arm64" ? "arm64" : "x64");
  if (!["x64", "arm64"].includes(sdkArch) || !env["ProgramFiles(x86)"])
    throw new Error("The Windows SDK signing location is unavailable.");
  const sdkRoot = path.join(
    env["ProgramFiles(x86)"],
    "Windows Kits",
    "10",
    "bin",
  );
  const sdkVersions = readdirSync(sdkRoot)
    .filter((version) => /^10\.\d+\.\d+\.\d+$/.test(version))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const signtool = sdkVersions
    .map((version) => path.join(sdkRoot, version, sdkArch, "signtool.exe"))
    .find(existsSync);
  if (!signtool)
    throw new Error(
      "The Windows SDK signtool.exe was not found; the viewer was not staged.",
    );
  for (const args of [
    [
      "sign",
      "/sha1",
      thumbprint,
      "/fd",
      "SHA256",
      "/td",
      "SHA256",
      "/tr",
      "http://timestamp.digicert.com",
      filename,
    ],
    ["verify", "/pa", "/tw", filename],
  ]) {
    const result = run(signtool, args, {
      env: { ...env },
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        "Viewer Authenticode signing or verification failed; the viewer was not staged.",
      );
  }
  return true;
}

/** Always rebuild incrementally against the pinned source. Never launch an
 * arbitrary executable from PATH or silently keep a stale helper after failure. */
export function stageFileViewerHost({
  argv = process.argv.slice(2),
  env = process.env,
  root = repoRoot,
  platform = process.platform,
  arch = process.arch,
  run = spawnSync,
  log = console.log,
} = {}) {
  const target = opksshTarget(argv, env, platform, arch);
  if (target.osKey !== "windows") {
    log(
      "OS-isolated file viewing is not available on this platform; no unsandboxed fallback is bundled.",
    );
    return { unsupported: true };
  }
  const triple =
    target.triple ??
    (target.archKey === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc");
  if (!triple.endsWith("-pc-windows-msvc"))
    throw new Error("The isolated Windows viewer requires the MSVC target.");
  const release = argv.includes("--release");
  const targetDir = path.resolve(
    root,
    "src-tauri",
    env.CARGO_TARGET_DIR || "target",
  );
  const args = [
    path.join(root, "scripts", "native-build-env.mjs"),
    "cargo",
    "build",
    "--locked",
    "-p",
    "sorng-file-viewer-host",
    "--bin",
    "sorng-file-viewer-host",
    "--target",
    triple,
    "--target-dir",
    targetDir,
    ...(release ? ["--release"] : []),
  ];
  const result = run(process.execPath, args, {
    cwd: path.join(root, "src-tauri"),
    env: { ...env },
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "The isolated viewer failed to build. Native startup is stopped; no unprotected fallback will be used.",
    );
  const executable = path.join(
    targetDir,
    triple,
    release ? "release" : "debug",
    "sorng-file-viewer-host.exe",
  );
  let info = verifyViewerExecutable(executable, target.archKey);
  const destination = path.join(
    root,
    "src-tauri",
    "crates",
    "sorng-file-viewer-host",
    "bundle",
    `windows-${target.archKey}`,
    "sorng-file-viewer-host.exe",
  );
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.staging`;
  try {
    copyFileSync(executable, temporary);
    signViewerExecutable(temporary, { env, run, platform, arch });
    info = verifyViewerExecutable(temporary, target.archKey);
    // Ship the notice as a readable resource as well as the embedded asset.
    const pdfNotice = path.join(root, "node_modules", "pdfjs-dist", "LICENSE");
    if (!existsSync(pdfNotice))
      throw new Error(
        "The bundled PDF viewer license is missing. Run npm ci before staging.",
      );
    copyFileSync(
      pdfNotice,
      path.join(
        root,
        "src-tauri",
        "crates",
        "sorng-file-viewer-host",
        "bundle",
        "PDFJS-LICENSE.txt",
      ),
    );
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
  log(`Staged isolated viewer (${target.archKey}, ${info.bytes} bytes).`);
  return { destination, ...info };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    stageFileViewerHost();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
