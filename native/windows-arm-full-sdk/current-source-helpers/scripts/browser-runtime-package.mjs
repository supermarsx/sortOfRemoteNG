#!/usr/bin/env node
// Explicit acquisition, offline inspection/build/staging. Never grants Ready.
import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
export const CEF_PIN = Object.freeze({
  bindings: "154.3.0+154.0.32",
  version: "154.0.32+g682c378+chromium-154.0.8037.58",
  chromium: "154.0.8037.58",
  sandboxCompat: "265fca9293e6b6ef",
  index: "https://cef-builds.spotifycdn.com/index.json",
  reviewed: "2026-10-06",
});

// Exact minimal archives from the upstream index, not a latest-version lookup.
// All six archive bytes were downloaded/rechecked against the official index
// on 2026-10-06 before recording the measured SHA-256 values below.
// SHA-1 pins are upstream transport checksums, not signature verification.
const artifacts = {
  "x86_64-pc-windows-msvc": [
    "windows64",
    "9131b9d7a464202b9274beec1f24569599524cca",
    172827308,
    "aa1f7ab28005307edcc13f95e3ce5cd9d221894b00458fb5e368c00603204a2a",
  ],
  "aarch64-pc-windows-msvc": [
    "windowsarm64",
    "8676a10b2fd2425eb1412f3a7633a90c2d6ce014",
    169051045,
    "805825d3ad7304e945205b818811806eb34b5226b91fa6c483cb6212eef44812",
  ],
  "x86_64-unknown-linux-gnu": [
    "linux64",
    "943abce909ca07b96abc9258266629b4fac616d4",
    326397696,
    "9b6a82e04506d5e1af560e031e718c89af5f96760413fd16380358784545d153",
  ],
  "aarch64-unknown-linux-gnu": [
    "linuxarm64",
    "7139f92aac35073de63bc4731308f984d4998513",
    424005444,
    "65829646cad7223c68bbcc659257e41ec282741adf2570d000722d201c3ccf1e",
  ],
  "x86_64-apple-darwin": [
    "macosx64",
    "324da7f24e498af0f6c5abcb45b3cb8cc2641f08",
    138660944,
    "e7e17e6c899ffe6c4cb16065d6dcaf16f9735d9cd0861099558f578d40714552",
  ],
  "aarch64-apple-darwin": [
    "macosarm64",
    "2e9df1077c097e450d30f26804b7c4b1820da4e3",
    132224904,
    "0adf18dc3c4dadf0fecdb3ce2b9d558989fa264743cdcd46e89b1b3b118dd85f",
  ],
};
export const TARGETS = Object.freeze(Object.keys(artifacts));

// Explicit acquisition only; verify/stage/build never silently download.
// HTTPS and the exact official index record establish the download source;
// digests do not claim a publisher signature or native acceptance.
export async function downloadArchive({ target, output }) {
  const manifest = packageManifest(target);
  const indexResponse = await fetch(CEF_PIN.index, { redirect: "error" });
  if (!indexResponse.ok)
    throw new Error(`CEF index HTTP ${indexResponse.status}`);
  const index = await indexResponse.json();
  const matches = Object.values(index).flatMap((platform) =>
    (platform.versions ?? [])
      .filter((version) => version.cef_version === CEF_PIN.version)
      .flatMap((version) => version.files ?? [])
      .filter((file) => file.name === manifest.artifact.name),
  );
  if (
    matches.length !== 1 ||
    matches[0].sha1 !== manifest.artifact.sha1 ||
    matches[0].size !== manifest.artifact.size
  )
    throw new Error("Official CEF index disagrees with the reviewed pin");
  const destination = path.resolve(output);
  try {
    await lstat(destination);
    const existing = await verifyArtifact(destination, manifest.artifact);
    if (!existing.ok)
      throw new Error("Existing archive differs; refusing to overwrite it");
    return {
      target,
      path: destination,
      source: manifest.artifact.url,
      ...existing,
      reused: true,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const response = await fetch(manifest.artifact.url, { redirect: "error" });
  if (!response.ok || !response.body)
    throw new Error(`CEF archive HTTP ${response.status}`);
  const pending = `${destination}.part`;
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(pending, { flags: "wx" }),
  );
  const result = await verifyArtifact(pending, manifest.artifact);
  if (!result.ok)
    throw new Error(`Downloaded archive rejected: ${result.errors.join("; ")}`);
  // Exclusive reservation prevents rename from overwriting a concurrent result.
  await writeFile(destination, "", { flag: "wx" });
  await rename(pending, destination);
  const receipt = {
    target,
    path: destination,
    source: manifest.artifact.url,
    index: CEF_PIN.index,
    upstream: matches[0],
    downloadedAt: new Date().toISOString(),
    ...result,
    reused: false,
  };
  await writeFile(
    `${destination}.provenance.json`,
    JSON.stringify(receipt, null, 2),
    { flag: "wx" },
  );
  return receipt;
}
const framework = "Chromium Embedded Framework.framework";
const resources = [
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "resources.pak",
  "icudtl.dat",
];
const helperSuffixes = ["", " (Alerts)", " (GPU)", " (Plugin)", " (Renderer)"];

function platformOf(target) {
  if (!TARGETS.includes(target))
    throw new Error(`Unsupported CEF target: ${target}`);
  return target.includes("windows")
    ? "windows"
    : target.includes("linux")
      ? "linux"
      : "macos";
}

function safeName(name) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(name) ||
    /[ .]$/.test(name) ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error("Invalid application name");
  return name;
}

export function packageManifest(target, appName = "sortofremoteng") {
  const platform = platformOf(target);
  safeName(appName);
  const [distribution, sha1, size, sha256 = null] = artifacts[target];
  const name = `cef_binary_${CEF_PIN.version}_${distribution}_minimal.tar.bz2`;
  let runtimeFiles;
  let executableFiles;
  let localeDirectory;
  let defaultLocale;
  if (platform === "macos") {
    const arch = target.startsWith("aarch64") ? "arm64" : "x86_64";
    runtimeFiles = [
      `${framework}/Chromium Embedded Framework`,
      ...resources.map((file) => `${framework}/Resources/${file}`),
      `${framework}/Resources/Info.plist`,
      `${framework}/Resources/v8_context_snapshot.${arch}.bin`,
      `${framework}/Libraries/libcef_sandbox.dylib`,
      `${framework}/Libraries/libvk_swiftshader.dylib`,
      `${framework}/Libraries/vk_swiftshader_icd.json`,
    ];
    executableFiles = [`${framework}/Chromium Embedded Framework`];
    localeDirectory = `${framework}/Resources`;
    defaultLocale = `${localeDirectory}/en.lproj/locale.pak`;
  } else {
    runtimeFiles = [
      ...resources,
      "v8_context_snapshot.bin",
      "vk_swiftshader_icd.json",
      ...(platform === "windows"
        ? [
            "libcef.dll",
            "chrome_elf.dll",
            "d3dcompiler_47.dll",
            "vk_swiftshader.dll",
            "vulkan-1.dll",
            "bootstrap.exe",
            ...(target.startsWith("x86_64")
              ? ["dxil.dll", "dxcompiler.dll"]
              : []),
          ]
        : [
            "libcef.so",
            "libvk_swiftshader.so",
            "libvulkan.so.1",
            "chrome-sandbox",
          ]),
    ];
    executableFiles = platform === "linux" ? ["chrome-sandbox"] : [];
    localeDirectory = "locales";
    defaultLocale = "locales/en-US.pak";
  }
  const bundlePrefix = platform === "macos" ? "Contents/Frameworks/" : "";
  const helpers =
    platform === "macos"
      ? helperSuffixes.map((suffix) => `${appName} Helper${suffix}`)
      : [];
  const applicationFiles =
    platform === "windows"
      ? [`${appName}.exe`, `${appName}.dll`]
      : platform === "linux"
        ? [appName, `${appName}.bin`, `${appName}.helper`]
        : [
            "Contents/Info.plist",
            `Contents/MacOS/${appName}`,
            ...helpers.flatMap((helper) => [
              `Contents/Frameworks/${helper}.app/Contents/Info.plist`,
              `Contents/Frameworks/${helper}.app/Contents/MacOS/${helper}`,
            ]),
          ];
  return {
    schemaVersion: 1,
    target,
    platform,
    appName,
    pin: CEF_PIN,
    artifact: {
      name,
      url: `https://cef-builds.spotifycdn.com/${name}`,
      size,
      sha1,
      sha256,
    },
    runtimeFiles,
    executableFiles,
    localeDirectory,
    defaultLocale,
    bundlePrefix,
    applicationFiles,
    metadataFiles: ["archive.json", "include/cef_version.h", "CREDITS.html"],
    creditDestination:
      platform === "macos"
        ? "Contents/Resources/cef-CREDITS.html"
        : "cef-CREDITS.html",
    constraints: {
      minimumMacOS: platform === "macos" ? "14.0" : null,
      linuxBackend: platform === "linux" ? "X11/XWayland" : null,
      sandbox:
        platform === "windows"
          ? "bootstrap-exe-and-client-dll"
          : platform === "macos"
            ? "sandbox-dylib-before-framework-load"
            : "namespace-or-root-owned-4755-suid-helper",
    },
  };
}

// Public helper also permits tiny synthetic artifacts in tooling tests. The CLI
// only uses the immutable target pins above, never a pin from archive.json.
export async function verifyArtifact(file, expected) {
  const errors = [];
  if (
    !expected ||
    !Number.isSafeInteger(expected.size) ||
    expected.size <= 0 ||
    !/^[a-f0-9]{40}$/.test(expected.sha1) ||
    (expected.sha256 != null && !/^[a-f0-9]{64}$/.test(expected.sha256))
  ) {
    throw new Error("Invalid artifact pin");
  }
  const result = {
    ok: false,
    status: "missing",
    sha1: null,
    sha256: null,
    strongDigestPinned: Boolean(expected.sha256),
    errors,
  };
  if (!file) {
    errors.push("Archive path is required; no download was attempted");
    return result;
  }
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size !== expected.size) {
      errors.push("Archive must be a regular file with the pinned byte length");
      result.status = "mismatch";
      return result;
    }
    const hashes = [createHash("sha1"), createHash("sha256")];
    for await (const chunk of createReadStream(file))
      for (const hash of hashes) hash.update(chunk);
    [result.sha1, result.sha256] = hashes.map((hash) => hash.digest("hex"));
    if (
      result.sha1 !== expected.sha1 ||
      (expected.sha256 && result.sha256 !== expected.sha256)
    ) {
      errors.push("Archive digest differs from the pinned artifact");
    }
    result.ok = errors.length === 0;
    result.status = result.ok ? "digest-verified" : "mismatch";
  } catch (error) {
    errors.push(`Archive unreadable (${error.code ?? "read-error"})`);
  }
  return result;
}

function isWithin(root, file) {
  const rel = path.relative(root, file);
  return (
    rel === "" ||
    (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
  );
}

// Framework version links are allowed only when their resolved bytes stay in
// the selected root. Broken links, device files, empty files and escapes fail.
async function checkedFile(root, relative, executable = false) {
  if (
    typeof relative !== "string" ||
    relative.includes("\\") ||
    relative.includes(":") ||
    relative.startsWith("/") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid relative package path");
  }
  const location = path.join(root, ...relative.split("/"));
  const resolved = await realpath(location);
  if (!isWithin(root, resolved))
    throw new Error("Symlink escapes package root");
  const info = await stat(resolved);
  if (!info.isFile() || info.size === 0)
    throw new Error("Expected a nonempty regular file");
  if (executable && process.platform !== "win32" && !(info.mode & 0o111))
    throw new Error("Executable permission missing");
  return { location: resolved, info };
}

async function inspectFiles(root, files, executableFiles = []) {
  const errors = [];
  let canonical;
  try {
    canonical = await realpath(root);
  } catch {
    return { ok: false, errors: ["Package root is missing"], checked: 0 };
  }
  let checked = 0;
  for (const file of [...new Set(files)]) {
    try {
      await checkedFile(canonical, file, executableFiles.includes(file));
      checked++;
    } catch (error) {
      errors.push(`${file}: ${error.code ?? error.message}`);
    }
  }
  return { ok: errors.length === 0, errors, checked };
}

async function readChecked(root, relative) {
  const canonical = await realpath(root);
  const file = await checkedFile(canonical, relative);
  if (file.info.size > 2 * 1024 * 1024)
    throw new Error("Metadata exceeds size limit");
  return readFile(file.location, "utf8");
}

async function localeFiles(root, manifest) {
  const canonical = await realpath(root);
  const directory = await realpath(
    path.join(canonical, manifest.localeDirectory),
  );
  if (!isWithin(canonical, directory))
    throw new Error("Locale directory escapes package root");
  const names = (await readdir(directory)).sort();
  const matches =
    manifest.platform === "macos"
      ? names
          .filter((name) => /^[A-Za-z0-9_-]+\.lproj$/.test(name))
          .map((name) => `${manifest.localeDirectory}/${name}/locale.pak`)
      : names
          .filter((name) => /^[A-Za-z0-9_-]+\.pak$/.test(name))
          .map((name) => `${manifest.localeDirectory}/${name}`);
  return [...new Set([manifest.defaultLocale, ...matches])];
}

async function retainedRuntimeFiles(root, manifest) {
  const files = new Set(manifest.runtimeFiles);
  const canonical = await realpath(root);
  // Preserve the complete macOS framework, including gender-specific locale
  // packs, shader caches and internal framework version links when present.
  async function walk(relative, ancestors = []) {
    const resolved = await realpath(path.join(canonical, relative));
    if (!isWithin(canonical, resolved))
      throw new Error("Framework link escapes package root");
    if (
      ancestors.includes(resolved) ||
      ancestors.length > 24 ||
      files.size > 4096
    )
      throw new Error("Invalid framework traversal");
    const info = await stat(resolved);
    if (info.isDirectory()) {
      for (const name of (await readdir(resolved)).sort())
        await walk(`${relative}/${name}`, [...ancestors, resolved]);
    } else {
      await checkedFile(canonical, relative);
      files.add(relative);
    }
  }
  if (manifest.platform === "macos") await walk(framework);
  if (manifest.platform === "linux") {
    // Conditional in the pinned distribution's Linux copy contract.
    try {
      await lstat(path.join(canonical, "libminigbm.so"));
      files.add("libminigbm.so");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return [...files];
}

export async function inspectRuntime(root, target) {
  const manifest = packageManifest(target);
  let locales = [manifest.defaultLocale];
  const extraErrors = [];
  try {
    locales = await localeFiles(root, manifest);
  } catch (error) {
    extraErrors.push(`Locales unavailable (${error.code ?? error.message})`);
  }
  let retained = manifest.runtimeFiles;
  try {
    retained = await retainedRuntimeFiles(root, manifest);
  } catch (error) {
    extraErrors.push(
      `Runtime inventory unavailable (${error.code ?? error.message})`,
    );
  }
  const result = await inspectFiles(
    root,
    [...retained, ...manifest.metadataFiles, ...locales],
    manifest.executableFiles,
  );
  result.errors.push(...extraErrors);
  try {
    const archive = JSON.parse(await readChecked(root, "archive.json"));
    if (
      archive.type !== "minimal" ||
      archive.name !== manifest.artifact.name ||
      archive.sha1 !== manifest.artifact.sha1
    ) {
      result.errors.push(
        "archive.json does not match the exact target/version/digest pin",
      );
    }
  } catch {
    result.errors.push("archive.json is missing or invalid");
  }
  try {
    const header = await readChecked(root, "include/cef_version.h");
    const defines = (name) =>
      [
        ...header.matchAll(
          new RegExp(`^#define\\s+${name}\\s+([^\\r\\n]+)`, "gm"),
        ),
      ].map((match) => match[1].trim());
    const equal = (name, expected) => {
      const found = defines(name);
      return found.length === 1 && found[0] === expected;
    };
    if (
      !equal("CEF_VERSION", `"${CEF_PIN.version}"`) ||
      // Official Unix archive headers leave this Windows bootstrap ABI hash
      // empty. Requiring Windows' value incorrectly rejects genuine Unix SDKs.
      !equal(
        "CEF_SANDBOX_COMPAT_HASH",
        `"${manifest.platform === "windows" ? CEF_PIN.sandboxCompat : ""}"`,
      ) ||
      !CEF_PIN.chromium
        .split(".")
        .every((value, index) =>
          equal(
            `CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][index]}`,
            value,
          ),
        )
    ) {
      result.errors.push(
        "CEF header version/Chromium version/sandbox ABI does not match the pin",
      );
    }
  } catch {
    result.errors.push("CEF version header is missing or invalid");
  }
  result.ok = result.errors.length === 0;
  return { ...result, locales, sourceBytesMatchArchive: "not-verified" };
}

export function inspectBindingAlignment(lockText, hostText) {
  const errors = [];
  for (const name of ["cef", "cef-dll-sys"]) {
    const packages = lockText
      .split(/\[\[package\]\]/)
      .filter((block) => new RegExp(`^name = "${name}"$`, "m").test(block));
    if (
      packages.length !== 1 ||
      !new RegExp(
        `^version = "${CEF_PIN.bindings.replace(/[.+]/g, "\\$&")}"$`,
        "m",
      ).test(packages[0])
    ) {
      errors.push(
        `Cargo.lock must contain exactly one ${name} at ${CEF_PIN.bindings}`,
      );
    }
    const line = hostText
      .split(/\r?\n/)
      .find((value) => value.startsWith(`${name} = `));
    if (
      !line ||
      !/version\s*=\s*"=154\.3\.0"/.test(line) ||
      !/optional\s*=\s*true/.test(line) ||
      !/default-features\s*=\s*false/.test(line)
    ) {
      errors.push(
        `${name} must remain an exact optional pin with default features disabled`,
      );
    }
    if (
      name === "cef" &&
      (!line?.includes('"sandbox"') || !line?.includes('"resources"'))
    ) {
      errors.push("CEF sandbox and resources features must be enabled");
    }
  }
  return { ok: errors.length === 0, errors };
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function inspectBundle(
  root,
  runtimeRoot,
  target,
  appName = "sortofremoteng",
) {
  const manifest = packageManifest(target, appName);
  let locales = [manifest.defaultLocale];
  const discoveryErrors = [];
  try {
    locales = await localeFiles(runtimeRoot, manifest);
  } catch {
    discoveryErrors.push("Cannot enumerate source locales");
  }
  let retained = manifest.runtimeFiles;
  try {
    retained = await retainedRuntimeFiles(runtimeRoot, manifest);
  } catch {
    discoveryErrors.push("Cannot enumerate complete runtime inventory");
  }
  const copies = [...new Set([...retained, ...locales])].map((source) => ({
    source,
    destination:
      manifest.platform === "windows" && source === "bootstrap.exe"
        ? `${appName}.exe`
        : `${manifest.bundlePrefix}${source}`,
  }));
  copies.push({
    source: "CREDITS.html",
    destination: manifest.creditDestination,
  });
  const executables =
    manifest.platform === "macos"
      ? manifest.applicationFiles.filter((name) => name.includes("/MacOS/"))
      : manifest.platform === "linux"
        ? [appName, `${appName}.bin`, `${appName}.helper`, "chrome-sandbox"]
        : [];
  const result = await inspectFiles(
    root,
    [...manifest.applicationFiles, ...copies.map((entry) => entry.destination)],
    executables,
  );
  result.errors.push(...discoveryErrors);
  let compared = 0;
  for (const { source, destination } of copies) {
    try {
      const sourceFile = await checkedFile(await realpath(runtimeRoot), source);
      const destinationFile = await checkedFile(
        await realpath(root),
        destination,
      );
      if (
        sourceFile.info.size !== destinationFile.info.size ||
        (await sha256File(sourceFile.location)) !==
          (await sha256File(destinationFile.location))
      ) {
        result.errors.push(
          `${destination}: differs from the inspected runtime source`,
        );
      } else compared++;
    } catch {
      result.errors.push(
        `${destination}: unable to compare with runtime source`,
      );
    }
  }
  result.ok = result.errors.length === 0;
  return {
    ...result,
    compared,
    stage: "before-signing",
    executableArchitecture: "not-verified",
  };
}

// Native-file inspection is deliberately separate from synthetic layout tests.
// Reject wrong architecture and absent Windows bootstrap exports before staging.
export async function inspectNativeBinary(
  file,
  target,
  { clientDll = false } = {},
) {
  const platform = platformOf(target);
  const data = await readFile(file);
  const arm = target.startsWith("aarch64");
  const fail = () => {
    throw new Error(
      `Native binary does not match ${target}: ${path.basename(file)}`,
    );
  };
  if (platform === "windows") {
    if (data.length < 64 || data.toString("ascii", 0, 2) !== "MZ") fail();
    const pe = data.readUInt32LE(60);
    if (
      pe + 264 > data.length ||
      data.readUInt32LE(pe) !== 0x4550 ||
      data.readUInt16LE(pe + 4) !== (arm ? 0xaa64 : 0x8664) ||
      data.readUInt16LE(pe + 24) !== 0x20b
    )
      fail();
    if (clientDll) {
      if (!(data.readUInt16LE(pe + 22) & 0x2000)) fail();
      const sections = pe + 24 + data.readUInt16LE(pe + 20);
      const rvaOffset = (rva) => {
        for (let i = 0; i < data.readUInt16LE(pe + 6); ++i) {
          const section = sections + i * 40;
          const start = data.readUInt32LE(section + 12);
          const size = data.readUInt32LE(section + 16);
          if (rva >= start && rva - start < size) {
            const offset = data.readUInt32LE(section + 20) + rva - start;
            if (offset >= data.length) fail();
            return offset;
          }
        }
        fail();
      };
      const exports = rvaOffset(data.readUInt32LE(pe + 24 + 112));
      const names = rvaOffset(data.readUInt32LE(exports + 32));
      const count = data.readUInt32LE(exports + 24);
      if (count > 100000) fail();
      let found = false;
      for (let i = 0; i < count; ++i) {
        const offset = rvaOffset(data.readUInt32LE(names + i * 4));
        const end = data.indexOf(0, offset);
        if (end < offset || end - offset > 4096) fail();
        if (data.toString("ascii", offset, end) === "RunWinMain") found = true;
      }
      if (!found) throw new Error("Windows client DLL must export RunWinMain");
    }
  } else if (platform === "linux") {
    if (
      data.length < 64 ||
      data.readUInt32LE(0) !== 0x464c457f ||
      data[4] !== 2 ||
      data[5] !== 1 ||
      data.readUInt16LE(18) !== (arm ? 183 : 62) ||
      ![2, 3].includes(data.readUInt16LE(16))
    )
      fail();
  } else {
    if (
      data.length < 32 ||
      data.readUInt32LE(0) !== 0xfeedfacf ||
      data.readUInt32LE(4) !== (arm ? 0x100000c : 0x1000007) ||
      data.readUInt32LE(12) !== 2
    )
      fail();
    let offset = 32;
    let minimum;
    for (let i = 0; i < data.readUInt32LE(16); ++i) {
      const command = data.readUInt32LE(offset);
      const size = data.readUInt32LE(offset + 4);
      if (size < 8 || offset + size > data.length) fail();
      if (command === 0x32 && size >= 24 && data.readUInt32LE(offset + 8) === 1)
        minimum = data.readUInt32LE(offset + 12);
      if (command === 0x24 && size >= 16)
        minimum = data.readUInt32LE(offset + 8);
      offset += size;
    }
    if (minimum !== 0x000e0000)
      throw new Error("Application and helper must target macOS 14.0 exactly");
  }
  return {
    ok: true,
    target,
    sha256: createHash("sha256").update(data).digest("hex"),
    clientDll,
  };
}

function runTool(
  executable,
  args,
  { env = process.env, progress = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (progress) process.stderr.write(chunk);
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (progress) process.stderr.write(chunk);
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(
              `${path.basename(executable)} exited ${code}: ${stderr.slice(-4000)}`,
            ),
          ),
    );
  });
}

const nativeSources = path.join(
  repo,
  "src-tauri/crates/sorng-browser-host/native",
);

export function clientBuildArguments(
  target,
  cargoTargetDir,
  profile = "release",
) {
  if (platformOf(target) !== "windows")
    throw new Error(
      "build-client is the Windows bootstrap DLL build; Unix uses the app and helper binaries",
    );
  if (!["debug", "release"].includes(profile))
    throw new Error("Expected debug or release profile");
  return [
    "cargo",
    "rustc",
    "--manifest-path",
    path.join(repo, "src-tauri/Cargo.toml"),
    "--locked",
    "--offline",
    "--target",
    target,
    "--target-dir",
    path.resolve(cargoTargetDir),
    ...(profile === "release" ? ["--release"] : []),
    "--features",
    "native-browser",
    "--lib",
    "--crate-type",
    "cdylib",
  ];
}

export async function buildClient({
  target,
  archivePath,
  output,
  cargoTargetDir,
  profile = "release",
  python,
}) {
  const directory = path.resolve(output);
  const buildDirectory = path.resolve(
    cargoTargetDir ?? path.join(directory, "cargo"),
  );
  const args = clientBuildArguments(target, buildDirectory, profile);
  if (process.platform !== "win32")
    throw new Error("Windows client requires a native Windows MSVC runner");
  await mkdir(directory, { recursive: false });
  const sdk = await extractRuntime({
    target,
    archivePath,
    output: path.join(directory, "sdk"),
    python,
  });
  const buildEnvironment = { ...process.env, CEF_PATH: sdk.runtime };
  // These cef-dll-sys escape hatches supersede CEF_PATH. The explicit package
  // build must use the inspected SDK, not an inherited system/Nix installation.
  delete buildEnvironment.FLATPAK;
  delete buildEnvironment.NIX_CEF_BINARY;
  // CEF_PATH is an exact, inspected SDK. cef-dll-sys otherwise can perform its
  // own download even when Cargo is offline; no missing/older SDK is supplied.
  await runTool(
    process.execPath,
    [path.join(repo, "scripts/native-build-env.mjs"), ...args],
    {
      env: buildEnvironment,
      progress: true,
    },
  );
  const compiled = path.join(buildDirectory, target, profile, "app_lib.dll");
  const native = await inspectNativeBinary(compiled, target, {
    clientDll: true,
  });
  const application = path.join(directory, "app_lib.dll");
  await copyFile(compiled, application, constants.COPYFILE_EXCL);
  if ((await sha256File(application)) !== native.sha256)
    throw new Error("Client DLL changed while copying");
  return {
    ok: true,
    target,
    application,
    sdk: sdk.runtime,
    native,
    releaseReady: false,
    browserReadiness: "not-established",
    sandboxExecution: "not-tested",
  };
}

export async function extractRuntime({
  target,
  archivePath,
  output,
  python = process.platform === "win32" ? "python" : "python3",
}) {
  const manifest = packageManifest(target);
  const artifact = await verifyArtifact(archivePath, manifest.artifact);
  if (!artifact.ok)
    throw new Error(`Archive rejected: ${artifact.errors.join("; ")}`);
  const extracted = JSON.parse(
    await runTool(python, [
      path.join(nativeSources, "extract_runtime.py"),
      path.resolve(archivePath),
      path.resolve(output),
    ]),
  );
  const after = await verifyArtifact(archivePath, manifest.artifact);
  if (!after.ok) throw new Error("Archive changed during extraction");
  await writeFile(
    path.join(extracted.runtime, "archive.json"),
    JSON.stringify({
      type: "minimal",
      name: manifest.artifact.name,
      sha1: manifest.artifact.sha1,
    }),
    { flag: "wx" },
  );
  const runtime = await inspectRuntime(extracted.runtime, target);
  if (!runtime.ok)
    throw new Error(`Extracted runtime rejected: ${runtime.errors.join("; ")}`);
  return { ...extracted, artifact, inspection: runtime, target };
}

// Plists are generated from validated component names; none originate in pages.
export function helperPlist(
  appName,
  suffix = "",
  bundleIdentifier = "com.sortofremote.ng",
) {
  safeName(appName);
  if (!helperSuffixes.includes(suffix)) throw new Error("Invalid helper role");
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier))
    throw new Error("Invalid bundle identifier");
  const name = `${appName} Helper${suffix}`;
  const role = suffix ? `.${suffix.slice(2, -1).toLowerCase()}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>${name}</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundleIdentifier</key><string>${bundleIdentifier}.helper${role}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSCameraUsageDescription</key><string>sortOfRemoteNG uses your camera for video on websites when you approve a camera request.</string>
<key>NSMicrophoneUsageDescription</key><string>sortOfRemoteNG uses your microphone for audio on websites when you approve a microphone request.</string>
</dict></plist>\n`;
}

// Output must not exist. Inputs remain available for audit; no cleanup/deletion.
export async function stagePackage({
  target,
  archivePath,
  application,
  helper,
  output,
  appName = "sortofremoteng",
  appPlist,
  python,
}) {
  const manifest = packageManifest(target, appName);
  const native = {
    application: await inspectNativeBinary(application, target, {
      clientDll: manifest.platform === "windows",
    }),
  };
  if (manifest.platform !== "windows")
    native.helper = await inspectNativeBinary(helper, target);
  if (manifest.platform === "macos" && !appPlist)
    throw new Error("macOS staging requires the application Info.plist");
  const plist =
    manifest.platform === "macos"
      ? JSON.parse(
          await runTool(
            python ?? (process.platform === "win32" ? "python" : "python3"),
            [
              path.join(nativeSources, "extract_runtime.py"),
              "plist",
              path.resolve(appPlist),
              appName,
            ],
          ),
        )
      : null;
  // Creating the final directory fails before extraction if it already exists.
  const destination = path.resolve(output);
  await mkdir(destination, { recursive: false });
  const inputs = await mkdtemp(
    path.join(path.dirname(destination), ".sorng-cef-inputs-"),
  );
  const extracted = await extractRuntime({
    target,
    archivePath,
    output: path.join(inputs, "verified"),
    python,
  });
  const runtimeRoot = await realpath(extracted.runtime);
  const copy = async (source, relative, executable = false) => {
    const dest = path.join(destination, relative);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest, constants.COPYFILE_EXCL);
    if (executable && process.platform !== "win32") await chmod(dest, 0o755);
  };
  if (manifest.platform === "macos") {
    // inspectRuntime walked every link and rejected escapes before copying.
    await mkdir(path.join(destination, "Contents/Frameworks"), {
      recursive: true,
    });
    await cp(
      path.join(runtimeRoot, framework),
      path.join(destination, manifest.bundlePrefix, framework),
      {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        errorOnExist: true,
        force: false,
      },
    );
  } else {
    const inventory = new Set([
      ...(await retainedRuntimeFiles(runtimeRoot, manifest)),
      ...(await localeFiles(runtimeRoot, manifest)),
    ]);
    for (const file of inventory) {
      const source = await checkedFile(runtimeRoot, file);
      await copy(
        source.location,
        file === "bootstrap.exe" ? `${appName}.exe` : file,
        manifest.executableFiles.includes(file),
      );
    }
  }
  await copy(
    path.join(runtimeRoot, "CREDITS.html"),
    manifest.creditDestination,
  );
  const license = path.join(extracted.distribution, "LICENSE.txt");
  await copy(
    license,
    manifest.platform === "macos"
      ? "Contents/Resources/cef-LICENSE.txt"
      : "cef-LICENSE.txt",
  );
  if (manifest.platform === "windows") {
    await copy(application, `${appName}.dll`);
  } else if (manifest.platform === "linux") {
    await copy(application, `${appName}.bin`, true);
    await copy(helper, `${appName}.helper`, true);
    await writeFile(
      path.join(destination, appName),
      `#!/bin/sh\nset -eu\napp_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport GDK_BACKEND=x11\nexec "$app_dir/${appName}.bin" "$@"\n`,
      { flag: "wx", mode: 0o755 },
    );
  } else {
    await copy(application, `Contents/MacOS/${appName}`, true);
    await copy(appPlist, "Contents/Info.plist");
    for (const suffix of helperSuffixes) {
      const name = `${appName} Helper${suffix}`;
      const prefix = `Contents/Frameworks/${name}.app/Contents`;
      await copy(helper, `${prefix}/MacOS/${name}`, true);
      await writeFile(
        path.join(destination, prefix, "Info.plist"),
        helperPlist(appName, suffix, plist.identifier),
        { flag: "wx" },
      );
    }
  }
  // Detect mutated compiler outputs instead of certifying earlier input bytes.
  const packagedApplication =
    manifest.platform === "windows"
      ? `${appName}.dll`
      : manifest.platform === "linux"
        ? `${appName}.bin`
        : `Contents/MacOS/${appName}`;
  if (
    (await sha256File(path.join(destination, packagedApplication))) !==
    native.application.sha256
  )
    throw new Error("Application changed while staging");
  if (native.helper) {
    const helperFiles =
      manifest.platform === "linux"
        ? [`${appName}.helper`]
        : helperSuffixes.map(
            (suffix) =>
              `Contents/Frameworks/${appName} Helper${suffix}.app/Contents/MacOS/${appName} Helper${suffix}`,
          );
    for (const file of helperFiles)
      if (
        (await sha256File(path.join(destination, file))) !==
        native.helper.sha256
      )
        throw new Error("Helper changed while staging");
  }
  const report = await verifyPackage({
    target,
    archivePath,
    runtimeRoot,
    bundleRoot: destination,
    appName,
  });
  return {
    ...report,
    runtime: {
      ...report.runtime,
      sourceBytesMatchArchive: "fresh-verified-extraction",
    },
    native,
    staging: {
      bundle: destination,
      runtime: runtimeRoot,
      source: "fresh-extraction-of-pinned-archive",
      inputsRetained: inputs,
    },
    outstanding: report.outstanding.filter(
      (item) => item !== "archive-to-extracted-tree-provenance",
    ),
  };
}

export async function verifyPackage({
  target,
  runtimeRoot,
  archivePath,
  bundleRoot,
  appName = "sortofremoteng",
  cargoLock = path.join(repo, "src-tauri/Cargo.lock"),
  hostManifest = path.join(
    repo,
    "src-tauri/crates/sorng-browser-host/Cargo.toml",
  ),
}) {
  const manifest = packageManifest(target, appName);
  const artifact = await verifyArtifact(archivePath, manifest.artifact);
  const runtime = await inspectRuntime(runtimeRoot, target);
  let bindings;
  try {
    bindings = inspectBindingAlignment(
      await readFile(cargoLock, "utf8"),
      await readFile(hostManifest, "utf8"),
    );
  } catch {
    bindings = { ok: false, errors: ["Cargo binding manifests unreadable"] };
  }
  const bundle = bundleRoot
    ? await inspectBundle(bundleRoot, runtimeRoot, target, appName)
    : {
        ok: false,
        errors: [
          "Application bundle path is required for package verification",
        ],
      };
  return {
    schemaVersion: 1,
    target,
    pin: CEF_PIN,
    ok: artifact.ok && runtime.ok && bindings.ok && bundle.ok,
    artifact,
    runtime,
    bindings,
    bundle,
    // File presence, checksum matching and synthetic fixtures cannot grant any
    // of these claims. Native release jobs must establish them independently.
    releaseReady: false,
    outstanding: [
      ...(!manifest.artifact.sha256
        ? ["independently-reviewed-sha256-pin"]
        : []),
      "archive-to-extracted-tree-provenance",
      "binary-architecture-and-linkage",
      "platform-sandbox-launch",
      "signed-package-validation",
      ...(manifest.platform === "macos"
        ? ["macos-14-deployment-target", "notarization-and-stapling"]
        : []),
      ...(manifest.platform === "linux"
        ? [
            "x11-xwayland-native-launch",
            "linux-sandbox-owner-mode-or-user-namespace",
          ]
        : []),
      "all-platform-native-acceptance",
      "full-app-acceptance",
      "provider-login-acceptance",
    ],
    signing: "not-checked",
    notarization:
      manifest.platform === "macos" ? "not-checked" : "not-applicable",
    sandboxExecution: "not-tested",
    browserReadiness: "not-established",
  };
}

export function inspectMatrix(reports) {
  const missing = TARGETS.filter(
    (target) => !reports.some((report) => report.target === target),
  );
  const duplicate = TARGETS.filter(
    (target) => reports.filter((report) => report.target === target).length > 1,
  );
  const failed = reports
    .filter(
      (report) =>
        !TARGETS.includes(report.target) ||
        report.ok !== true ||
        report.schemaVersion !== 1 ||
        report.pin?.version !== CEF_PIN.version ||
        report.pin?.bindings !== CEF_PIN.bindings ||
        [report.artifact, report.runtime, report.bindings, report.bundle].some(
          (check) => check?.ok !== true,
        ),
    )
    .map((report) => report.target);
  return {
    ok: missing.length === 0 && duplicate.length === 0 && failed.length === 0,
    missing,
    duplicate,
    failed,
    releaseReady: false,
  };
}

const help = `Usage:
  node scripts/browser-runtime-package.mjs manifest [--target RUST_TRIPLE] [--app-name NAME]
  node scripts/browser-runtime-package.mjs download --target RUST_TRIPLE --output ARCHIVE_FILE
  node scripts/browser-runtime-package.mjs verify --target RUST_TRIPLE --runtime DIR --archive FILE --bundle DIR [--app-name NAME]
  node scripts/browser-runtime-package.mjs extract --target RUST_TRIPLE --archive FILE --output NEW_DIR [--python PYTHON]
  node scripts/browser-runtime-package.mjs stage --target RUST_TRIPLE --archive FILE --application FILE --output NEW_DIR [--helper FILE] [--app-plist FILE] [--app-name NAME] [--python PYTHON]
  node scripts/browser-runtime-package.mjs build-client --target WINDOWS_TRIPLE --archive FILE --output NEW_DIR [--profile debug|release] [--cargo-target-dir DIR] [--python PYTHON]

The default manifest includes all six Windows/Linux/macOS x64/arm64 targets.
Runtime DIR is the flattened download-cef layout; macOS bundle DIR is the .app.
Verification is offline and read-only. JSON goes to stdout. Exit 1 means missing
or mismatched packaging inputs; exit 2 means invalid arguments. Success checks
only the listed packaging properties, never browser Ready, signing or release.
Extract/stage require Python 3.12+ and new destinations, keep inputs for audit,
and never download, sign, install, launch browsers or change sandbox privileges.
`;

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help")) {
    console.log(help);
    return 0;
  }
  const [command, ...args] = argv;
  if (
    ![
      "manifest",
      "verify",
      "extract",
      "stage",
      "build-client",
      "download",
    ].includes(command)
  )
    throw new Error(
      "Expected manifest, verify, extract, stage, build-client or download",
    );
  const options = {};
  const allowed =
    command === "manifest"
      ? ["--target", "--app-name"]
      : command === "download"
        ? ["--target", "--output"]
        : command === "build-client"
          ? [
              "--target",
              "--archive",
              "--output",
              "--profile",
              "--cargo-target-dir",
              "--python",
            ]
          : command === "extract"
            ? ["--target", "--archive", "--output", "--python"]
            : command === "stage"
              ? [
                  "--target",
                  "--archive",
                  "--output",
                  "--application",
                  "--helper",
                  "--app-plist",
                  "--app-name",
                  "--python",
                ]
              : [
                  "--target",
                  "--runtime",
                  "--archive",
                  "--bundle",
                  "--app-name",
                ];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !allowed.includes(key) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(options, key)
    )
      throw new Error(`Invalid option: ${key}`);
    options[key] = value;
  }
  if (command === "download") {
    if (!options["--target"] || !options["--output"])
      throw new Error("download requires --target and --output");
    console.log(
      JSON.stringify(
        await downloadArchive({
          target: options["--target"],
          output: options["--output"],
        }),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "manifest") {
    const targets = options["--target"] ? [options["--target"]] : TARGETS;
    console.log(
      JSON.stringify(
        targets.map((target) => packageManifest(target, options["--app-name"])),
        null,
        2,
      ),
    );
    return 0;
  }
  if (["extract", "stage", "build-client"].includes(command)) {
    if (!["--target", "--archive", "--output"].every((key) => options[key]))
      throw new Error(`${command} requires --target, --archive and --output`);
    const request = {
      target: options["--target"],
      archivePath: options["--archive"],
      output: options["--output"],
      python: options["--python"],
    };
    if (command === "build-client") {
      console.log(
        JSON.stringify(
          await buildClient({
            ...request,
            profile: options["--profile"],
            cargoTargetDir: options["--cargo-target-dir"],
          }),
          null,
          2,
        ),
      );
      return 0;
    }
    if (command === "extract") {
      console.log(JSON.stringify(await extractRuntime(request), null, 2));
      return 0;
    }
    if (!options["--application"])
      throw new Error("stage requires --application");
    if (platformOf(request.target) !== "windows" && !options["--helper"])
      throw new Error("Unix stage requires --helper");
    const result = await stagePackage({
      ...request,
      application: options["--application"],
      helper: options["--helper"],
      appPlist: options["--app-plist"],
      appName: options["--app-name"],
    });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (!options["--target"] || !options["--runtime"])
    throw new Error("verify requires explicit --target and --runtime");
  const report = await verifyPackage({
    target: options["--target"],
    runtimeRoot: options["--runtime"],
    archivePath: options["--archive"],
    bundleRoot: options["--bundle"],
    appName: options["--app-name"],
  });
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`browser-runtime-package: ${error.message}`);
      process.exitCode = 2;
    });
}
