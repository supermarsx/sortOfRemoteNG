// Custom CEF provenance only. No downloads, library loads, or readiness grants.
// Callers must trust/review the supplied lock and manifest, not just their hashes.
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CEF_PIN,
  TARGETS,
  helperPlist,
  inspectBundle,
  inspectNativeBinary,
  packageManifest,
} from "../browser-runtime-package.mjs";

const exec = promisify(execFile);
export const CUSTOM_RUNTIME_SCHEMA = 1;
export const UPSTREAM_CEF_COMMIT = "682c378d70d5780061e96644dca16ddd8fd157a9";
// CEF's version formatter also needs release/master ancestry. These are
// metadata refs only; the checkout remains detached at UPSTREAM_CEF_COMMIT.
export const UPSTREAM_CEF_VERSION_REFERENCES = Object.freeze({
  "refs/remotes/origin/8037": "14c5a089e8452874cb1a556dc3fde26ed2d87723",
  "refs/remotes/origin/master": "ff57d4eae16d36457895f2de115a71d502e85a08",
});
// Chromium's official GitHub mirror tag and this revision's DEPS were checked
// on 2026-10-07. These are source pins, NOT custom binary artifact digests.
export const UPSTREAM_CHROMIUM_COMMIT =
  "a654841425914cbb703a2931e07b70a83aedbafd";
export const UPSTREAM_DEPOT_TOOLS_COMMIT =
  "c101dcbe0489c455fce7c2247bfee19680b116c3";
export const UPSTREAM_SISO_REVISION =
  "efbbe7f1892211b5e9512576843a3c247b6a6d7c";
export const BRIDGE_PATCH_ID = "sorng-tls-v2-682c378-1";
export const BRIDGE_V2 = Object.freeze({
  symbol: "cef_sorng_tls_get_api_v2",
  factorySymbol: "cef_sorng_tls_create_context_v2",
  abiVersion: 2,
  capabilities: Object.freeze([
    "socket-admission",
    "context-revoke",
    "http1-only",
    "scoped-exceptions",
    "custom-ca",
    "private-context",
  ]),
});
const repositories = Object.freeze({
  cef: "https://github.com/chromiumembedded/cef.git",
  chromium: "https://chromium.googlesource.com/chromium/src.git",
  depotTools:
    "https://chromium.googlesource.com/chromium/tools/depot_tools.git",
});
const fail = (message) => {
  throw new Error(message);
};
function shape(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label}: object required`);
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    fail(`${label}: exact fields required (${keys.join(", ")})`);
}
function hex(value, length, label) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[a-f0-9]{${length}}$`).test(value) ||
    /^0+$/.test(value)
  )
    fail(
      `${label}: explicit nonzero lowercase ${length}-digit digest required`,
    );
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    fail(`${label}: positive integer required`);
}
function relative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    /[\\:\x00-\x1f<>"|?*]/.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[ .]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    fail("Unsafe relative path");
  return value;
}
function within(root, location) {
  const rel = path.relative(root, location);
  return (
    rel === "" ||
    (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
  );
}
function unique(values, label) {
  if (
    new Set(values.map((value) => value.toLowerCase())).size !== values.length
  )
    fail(`${label}: duplicate/case-colliding entries`);
}
function list(value, label) {
  if (!Array.isArray(value) || !value.length)
    fail(`${label}: nonempty array required`);
}
function target(value) {
  if (!TARGETS.includes(value)) fail(`Unsupported custom CEF target: ${value}`);
}
function filePin(value, label, withSize = false) {
  shape(
    value,
    withSize ? ["path", "sha256", "size"] : ["path", "sha256"],
    label,
  );
  relative(value.path);
  hex(value.sha256, 64, label);
  if (withSize) positive(value.size, `${label}.size`);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function identitySha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/** No example production pins: callers supply reviewed full revisions and hashes. */
export function validateSourceLock(lock) {
  shape(
    lock,
    ["schemaVersion", "kind", "upstream", "patches", "bridge", "builds"],
    "source lock",
  );
  if (lock.schemaVersion !== 1 || lock.kind !== "sorng-cef-source-lock")
    fail("Unsupported source lock schema/kind");
  shape(lock.upstream, ["cef", "chromium", "depotTools"], "upstream");
  for (const name of Object.keys(repositories)) {
    const pin = lock.upstream[name];
    shape(
      pin,
      name === "cef"
        ? ["repository", "commit", "version"]
        : ["repository", "commit"],
      name,
    );
    if (pin.repository !== repositories[name])
      fail(`${name}: unexpected upstream repository`);
    hex(pin.commit, 40, `${name}.commit`);
  }
  if (
    lock.upstream.cef.commit !== UPSTREAM_CEF_COMMIT ||
    lock.upstream.cef.version !== CEF_PIN.version
  )
    fail("CEF base differs from reviewed bindings pin");
  if (
    lock.upstream.chromium.commit !== UPSTREAM_CHROMIUM_COMMIT ||
    lock.upstream.depotTools.commit !== UPSTREAM_DEPOT_TOOLS_COMMIT
  )
    fail("Chromium/depot_tools differs from reviewed source pins");
  list(lock.patches, "patches");
  for (const patch of lock.patches) {
    shape(patch, ["repository", "path", "sha256"], "patch");
    if (!["cef", "chromium"].includes(patch.repository))
      fail("Patch repository must be cef or chromium");
    relative(patch.path);
    hex(patch.sha256, 64, "patch.sha256");
  }
  unique(
    lock.patches.map((p) => p.path),
    "patch paths",
  );
  shape(
    lock.bridge,
    [
      "symbol",
      "factorySymbol",
      "abiVersion",
      "patchId",
      "header",
      "capabilities",
    ],
    "bridge",
  );
  if (
    lock.bridge.symbol !== BRIDGE_V2.symbol ||
    lock.bridge.factorySymbol !== BRIDGE_V2.factorySymbol ||
    lock.bridge.abiVersion !== BRIDGE_V2.abiVersion
  )
    fail("Unsupported bridge ABI/export");
  if (lock.bridge.patchId !== BRIDGE_PATCH_ID)
    fail("Bridge patchId differs from the frozen native contract");
  filePin(lock.bridge.header, "bridge.header");
  if (!lock.bridge.header.path.startsWith("include/"))
    fail("Bridge header must live under SDK include/");
  list(lock.bridge.capabilities, "bridge.capabilities");
  for (const capability of lock.bridge.capabilities)
    if (typeof capability !== "string" || !/^[a-z][a-z0-9-]+$/.test(capability))
      fail("Invalid bridge capability");
  unique(lock.bridge.capabilities, "bridge capabilities");
  if (
    JSON.stringify([...lock.bridge.capabilities].sort()) !==
    JSON.stringify([...BRIDGE_V2.capabilities].sort())
  )
    fail(
      "Bridge V2 capabilities must exactly match the native ABI (no unsupported trust claims)",
    );
  list(lock.builds, "builds");
  unique(
    lock.builds.map((build) => build.target),
    "build targets",
  );
  for (const build of lock.builds) {
    shape(build, ["target", "gnArgs", "toolchainLock"], "build");
    target(build.target);
    filePin(build.gnArgs, "gnArgs");
    filePin(build.toolchainLock, "toolchainLock");
  }
  return lock;
}

/** An inventory authenticates every SDK leaf, including framework link text. */
function validateInventory(files) {
  list(files, "SDK files");
  unique(
    files.map((file) => file.path),
    "SDK paths",
  );
  const entries = new Set(files.map((file) => file.path.toLowerCase()));
  for (const file of files) {
    relative(file.path);
    if (file.type === "file") {
      shape(file, ["path", "type", "size", "sha256"], "SDK file");
      if (!Number.isSafeInteger(file.size) || file.size < 0)
        fail("Invalid SDK file size");
      hex(file.sha256, 64, "SDK file hash");
    } else if (file.type === "symlink") {
      shape(file, ["path", "type", "target"], "SDK symlink");
      if (
        typeof file.target !== "string" ||
        !file.target ||
        /[\\:\x00-\x1f]/.test(file.target) ||
        file.target.startsWith("/")
      )
        fail("Unsafe SDK symlink target");
      relative(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(file.path), file.target),
        ),
      );
    } else
      fail("SDK inventory allows only regular files and relative symlinks");
    const parts = file.path.split("/");
    while (parts.length > 1) {
      parts.pop();
      if (entries.has(parts.join("/").toLowerCase()))
        fail("SDK leaf used as an ancestor");
    }
  }
}

export function validateCustomRuntimeManifest(
  manifest,
  lock,
  { requireAllTargets = false } = {},
) {
  validateSourceLock(lock);
  shape(
    manifest,
    ["schemaVersion", "kind", "sourceLockSha256", "artifacts"],
    "custom manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "sorng-cef-custom-runtime"
  )
    fail("Custom runtime kind required; official archives are distinct");
  if (manifest.sourceLockSha256 !== identitySha256(lock))
    fail("Source/patch identity mismatch");
  list(manifest.artifacts, "artifacts");
  unique(
    manifest.artifacts.map((artifact) => artifact.target),
    "artifact targets",
  );
  for (const artifact of manifest.artifacts) {
    shape(
      artifact,
      ["target", "archive", "provenance", "sdkFiles", "runtime"],
      "artifact",
    );
    target(artifact.target);
    if (!lock.builds.some((build) => build.target === artifact.target))
      fail("Artifact has no pinned build inputs");
    filePin(artifact.archive, "archive", true);
    if (
      !path.posix
        .basename(artifact.archive.path)
        .startsWith("sorng-cef-custom-") ||
      !artifact.archive.path.endsWith(".tar.bz2")
    )
      fail(
        "Custom archive requires a distinct sorng-cef-custom-*.tar.bz2 name",
      );
    filePin(artifact.provenance, "provenance", true);
    validateInventory(artifact.sdkFiles);
    for (const name of [
      "include/cef_version.h",
      "archive.json",
      "CREDITS.html",
      lock.bridge.header.path,
    ])
      if (
        !artifact.sdkFiles.some(
          (file) => file.path === name && file.type === "file" && file.size > 0,
        )
      )
        fail(`SDK inventory missing ${name}`);
    if (
      artifact.sdkFiles.find((file) => file.path === lock.bridge.header.path)
        .sha256 !== lock.bridge.header.sha256
    )
      fail("SDK bridge header differs from source ABI contract");
    const runtime = artifact.runtime;
    shape(
      runtime,
      [
        "library",
        "sandbox",
        "cefCommit",
        "cefVersion",
        "cefApiVersion",
        "cefApiHash",
        "sandboxCompat",
      ],
      "runtime",
    );
    for (const name of [runtime.library, runtime.sandbox]) {
      relative(name);
      if (!artifact.sdkFiles.some((file) => file.path === name))
        fail(`Runtime inventory missing ${name}`);
    }
    const windows = artifact.target.includes("windows");
    const linux = artifact.target.includes("linux");
    if (
      path.posix.basename(runtime.library) !==
      (windows
        ? "libcef.dll"
        : linux
          ? "libcef.so"
          : "Chromium Embedded Framework")
    )
      fail("Runtime library does not match target platform");
    if (
      path.posix.basename(runtime.sandbox) !==
      (windows
        ? "bootstrap.exe"
        : linux
          ? "chrome-sandbox"
          : "libcef_sandbox.dylib")
    )
      fail("Sandbox payload does not match target platform");
    hex(runtime.cefCommit, 40, "runtime.cefCommit");
    // Patches are applied to this base, never disguised as an unreviewed new CEF revision.
    if (
      runtime.cefCommit !== lock.upstream.cef.commit ||
      runtime.cefVersion !== lock.upstream.cef.version
    )
      fail("Runtime base identity differs from source lock");
    if (runtime.cefApiVersion !== 15400)
      fail("Runtime CEF API differs from current host selection");
    hex(runtime.cefApiHash, 40, "cefApiHash");
    if (runtime.sandboxCompat !== (windows ? CEF_PIN.sandboxCompat : ""))
      fail("Sandbox compatibility mismatch");
  }
  if (
    requireAllTargets &&
    TARGETS.some(
      (t) => !manifest.artifacts.some((artifact) => artifact.target === t),
    )
  )
    fail("All six custom runtime artifacts are required");
  return manifest;
}

async function checkedPath(root, name, { regular = true } = {}) {
  relative(name);
  // Callers may supply a relative root. Verified paths must remain anchored
  // when passed to a subprocess running in another checkout (git -C/apply).
  const location = path.resolve(root, name);
  if (!within(await realpath(root), await realpath(location)))
    fail(`Path escapes supplied root: ${name}`);
  if (regular && !(await lstat(location)).isFile())
    fail(`Regular file required: ${name}`);
  return location;
}
async function verifyFile(root, pin) {
  const file = await checkedPath(root, pin.path);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    size += chunk.length;
  }
  if (
    hash.digest("hex") !== pin.sha256 ||
    (pin.size !== undefined && size !== pin.size)
  )
    fail(`Digest/size mismatch: ${pin.path}`);
  return file;
}
async function inventory(root, prefix = "") {
  const files = [];
  for (const item of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    relative(name);
    if (item.isDirectory()) files.push(...(await inventory(root, name)));
    else if (item.isFile() || item.isSymbolicLink()) files.push(name);
    else fail(`Unsupported SDK entry: ${name}`);
  }
  return files;
}

/** Local-only, fail-closed preflight. Does not extract, install, or load the SDK. */
export async function preflightCustomRuntime({
  manifest,
  sourceLock,
  target: selectedTarget,
  artifactRoot,
  sdkRoot,
  requiredCapabilities = [],
  requireAllTargets = false,
}) {
  validateCustomRuntimeManifest(manifest, sourceLock, { requireAllTargets });
  target(selectedTarget);
  const artifact = manifest.artifacts.find(
    (item) => item.target === selectedTarget,
  );
  if (!artifact)
    fail("Selected custom runtime is missing; no official fallback");
  for (const capability of requiredCapabilities)
    if (!sourceLock.bridge.capabilities.includes(capability))
      fail(`Required capability absent: ${capability}`);
  const archivePath = await verifyFile(artifactRoot, artifact.archive);
  const provenancePath = await verifyFile(artifactRoot, artifact.provenance);
  const receipt = JSON.parse(await readFile(provenancePath, "utf8"));
  shape(
    receipt,
    [
      "schemaVersion",
      "kind",
      "target",
      "sourceLockSha256",
      "archiveSha256",
      "sdkInventorySha256",
      "buildInputsSha256",
    ],
    "build receipt",
  );
  const build = sourceLock.builds.find(
    (item) => item.target === selectedTarget,
  );
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "sorng-cef-custom-build-receipt" ||
    receipt.target !== selectedTarget ||
    receipt.sourceLockSha256 !== manifest.sourceLockSha256 ||
    receipt.archiveSha256 !== artifact.archive.sha256 ||
    receipt.sdkInventorySha256 !== identitySha256(artifact.sdkFiles) ||
    receipt.buildInputsSha256 !== identitySha256(build)
  )
    fail(
      "Build receipt does not bind archive, SDK inventory, source/patches and build inputs",
    );
  if (!(await lstat(sdkRoot)).isDirectory())
    fail("SDK root must be a real directory");
  const actual = (await inventory(sdkRoot)).sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(artifact.sdkFiles.map((file) => file.path).sort())
  )
    fail("SDK inventory mismatch (missing or additional files)");
  for (const entry of artifact.sdkFiles) {
    if (entry.type === "file") await verifyFile(sdkRoot, entry);
    else {
      const file = await checkedPath(sdkRoot, entry.path, { regular: false });
      if (
        !(await lstat(file)).isSymbolicLink() ||
        (await readlink(file)) !== entry.target
      )
        fail(`SDK symlink mismatch: ${entry.path}`);
    }
  }
  const version = await readFile(
    path.join(sdkRoot, "include/cef_version.h"),
    "utf8",
  );
  for (const [name, expected] of [
    ["CEF_VERSION", artifact.runtime.cefVersion],
    ["CEF_COMMIT_HASH", artifact.runtime.cefCommit],
    ["CEF_SANDBOX_COMPAT_HASH", artifact.runtime.sandboxCompat],
  ]) {
    const values = [
      ...version.matchAll(
        new RegExp(`^\\s*#define\\s+${name}\\s+"([^"]*)"\\s*$`, "gm"),
      ),
    ];
    if (values.length !== 1 || values[0][1] !== expected)
      fail(`SDK version header mismatch: ${name}`);
  }
  return {
    kind: "sorng-cef-custom-preflight",
    target: selectedTarget,
    sourceLockSha256: manifest.sourceLockSha256,
    cacheKey: `custom/${manifest.sourceLockSha256}/${selectedTarget}/${artifact.archive.sha256}`,
    archivePath,
    sdkRoot: await realpath(sdkRoot),
    bridge: structuredClone(sourceLock.bridge),
    filesVerified: actual.length,
    provenanceVerified: true,
    archiveSdkRelationship: "reviewed-manifest-bound-not-extraction-tested",
    runtimeCapability: "not-probed",
    nativeAcceptance: "not-tested",
    productionReady: false,
  };
}

/** Inspect defined exports, never strings in a binary or runtime execution. */
export async function inspectCustomRuntimeExports(file, selectedTarget) {
  target(selectedTarget);
  const bytes = await readFile(file);
  const range = (offset, length) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > bytes.length
    )
      fail("Invalid custom CEF binary table bounds");
    return offset;
  };
  const u16 = (offset) => bytes.readUInt16LE(range(offset, 2));
  const u32 = (offset) => bytes.readUInt32LE(range(offset, 4));
  const u64 = (offset) => {
    const value = Number(bytes.readBigUInt64LE(range(offset, 8)));
    if (!Number.isSafeInteger(value)) fail("Invalid custom CEF binary offset");
    return value;
  };
  const string = (offset, limit = bytes.length) => {
    range(offset, 1);
    const end = bytes.indexOf(0, offset);
    if (end < offset || end >= limit || end - offset > 4096)
      fail("Invalid custom CEF export name");
    return bytes.toString("ascii", offset, end);
  };
  const exports = new Set();
  const arm = selectedTarget.startsWith("aarch64");
  if (selectedTarget.includes("windows")) {
    if (u16(0) !== 0x5a4d) fail("Custom CEF requires PE DLL");
    const pe = u32(60);
    if (
      u32(pe) !== 0x4550 ||
      u16(pe + 4) !== (arm ? 0xaa64 : 0x8664) ||
      u16(pe + 24) !== 0x20b ||
      !(u16(pe + 22) & 0x2000)
    )
      fail("Custom CEF PE architecture/type mismatch");
    const sections = pe + 24 + u16(pe + 20);
    const rva = (value, length = 1) => {
      for (let i = 0; i < u16(pe + 6); i++) {
        const entry = sections + i * 40;
        const start = u32(entry + 12),
          size = u32(entry + 16);
        if (value >= start && value - start + length <= size)
          return range(u32(entry + 20) + value - start, length);
      }
      fail("Unmapped custom CEF export RVA");
    };
    const exportRva = u32(pe + 136),
      exportSize = u32(pe + 140);
    const table = rva(exportRva, 40),
      count = u32(table + 24);
    if (count > 100000) fail("Excessive custom CEF export count");
    const names = rva(u32(table + 32), count * 4),
      ordinals = rva(u32(table + 36), count * 2);
    const functions = rva(u32(table + 28), u32(table + 20) * 4);
    for (let i = 0; i < count; i++) {
      const ordinal = u16(ordinals + i * 2);
      if (ordinal >= u32(table + 20)) fail("Invalid custom CEF export ordinal");
      const address = u32(functions + ordinal * 4);
      if (
        !address ||
        (address >= exportRva && address < exportRva + exportSize)
      )
        continue;
      rva(address);
      exports.add(string(rva(u32(names + i * 4))));
    }
  } else if (selectedTarget.includes("linux")) {
    if (
      u32(0) !== 0x464c457f ||
      bytes[4] !== 2 ||
      bytes[5] !== 1 ||
      u16(16) !== 3 ||
      u16(18) !== (arm ? 183 : 62)
    )
      fail("Custom CEF ELF architecture/type mismatch");
    const sections = u64(40),
      size = u16(58),
      count = u16(60);
    if (size < 64) fail("Invalid custom CEF ELF section table");
    range(sections, size * count);
    for (let i = 0; i < count; i++) {
      const section = sections + size * i;
      if (u32(section + 4) !== 11) continue; // SHT_DYNSYM
      const link = u32(section + 40);
      if (link >= count) fail("Invalid custom CEF ELF string table");
      const strings = sections + size * link;
      const start = u64(strings + 24),
        end = start + u64(strings + 32);
      range(start, end - start);
      const offset = u64(section + 24),
        length = u64(section + 32),
        stride = u64(section + 56);
      if (stride !== 24 || length % stride)
        fail("Invalid custom CEF ELF symbols");
      range(offset, length);
      for (let cursor = offset; cursor < offset + length; cursor += stride) {
        const info = bytes[cursor + 4],
          visibility = bytes[cursor + 5] & 3;
        if (
          ![1, 2].includes(info >> 4) ||
          (info & 15) !== 2 ||
          ![0, 3].includes(visibility) ||
          !u16(cursor + 6) ||
          !u64(cursor + 8)
        )
          continue;
        exports.add(string(start + u32(cursor), end));
      }
    }
  } else {
    if (
      u32(0) !== 0xfeedfacf ||
      u32(4) !== (arm ? 0x100000c : 0x1000007) ||
      u32(12) !== 6
    )
      fail("Custom CEF Mach-O architecture/type mismatch");
    const commandsEnd = 32 + u32(20);
    range(32, commandsEnd - 32);
    let offset = 32;
    for (let i = 0; i < u32(16); i++) {
      const command = u32(offset),
        size = u32(offset + 4);
      if (size < 8 || offset + size > commandsEnd)
        fail("Invalid custom CEF Mach-O command");
      if (command === 2) {
        // LC_SYMTAB, defined external N_SECT symbols only
        if (size < 24) fail("Invalid custom CEF Mach-O symtab");
        const symbols = u32(offset + 8),
          count = u32(offset + 12),
          strings = u32(offset + 16),
          end = strings + u32(offset + 20);
        range(symbols, count * 16);
        range(strings, end - strings);
        for (let j = 0; j < count; j++) {
          const entry = symbols + j * 16,
            type = bytes[entry + 4];
          if (type !== 0x0f || !bytes[entry + 5] || !u64(entry + 8)) continue;
          exports.add(string(strings + u32(entry), end).replace(/^_/, ""));
        }
      }
      offset += size;
    }
  }
  for (const symbol of [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol])
    if (!exports.has(symbol))
      fail(`Custom CEF missing defined V2 export: ${symbol}`);
  return {
    target: selectedTarget,
    exports: [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol],
    runtimeCapability: "not-probed",
  };
}

const frameworkName = "Chromium Embedded Framework.framework";
const extractor = fileURLToPath(
  new URL(
    "../../src-tauri/crates/sorng-browser-host/native/extract_runtime.py",
    import.meta.url,
  ),
);
const normalizedPath = (name) => name.replace(/^(Release|Resources)\//, "");
async function fileDigest(file, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function customRuntimeEnvironment(environment) {
  const result = { ...environment };
  for (const key of Object.keys(result))
    if (
      ["FLATPAK", "NIX_CEF_BINARY", "CEF_DOWNLOAD_URL"].includes(
        key.toUpperCase(),
      )
    )
      delete result[key];
  result.CEF_DOWNLOAD_URL = "sorng-custom-no-download://blocked";
  return result;
}

async function verifySdkInventory(root, entries) {
  if (
    JSON.stringify((await inventory(root)).sort()) !==
    JSON.stringify(entries.map((entry) => entry.path).sort())
  )
    fail("Prepared custom SDK inventory changed");
  for (const entry of entries) {
    if (entry.type === "file") await verifyFile(root, entry);
    else {
      const file = await checkedPath(root, entry.path, { regular: false });
      if (
        !(await lstat(file)).isSymbolicLink() ||
        (await readlink(file)) !== entry.target
      )
        fail("Prepared custom SDK link changed");
    }
  }
}

/** Private flat SDK for the pinned Rust bindings, derived only from a fully
 * inventoried custom SDK. No source mutation, extraction, download or readiness.
 */
export async function prepareCustomRuntime({
  manifest,
  sourceLock,
  target: selectedTarget,
  artifactRoot,
  sdkRoot,
  output,
}) {
  const verified = await preflightCustomRuntime({
    manifest,
    sourceLock,
    target: selectedTarget,
    artifactRoot,
    sdkRoot,
  });
  const artifact = manifest.artifacts.find(
    (entry) => entry.target === selectedTarget,
  );
  await inspectCustomRuntimeExports(
    path.join(sdkRoot, artifact.runtime.library),
    selectedTarget,
  );
  const entries = artifact.sdkFiles
    .filter((entry) => entry.path !== "archive.json")
    .map((entry) => ({ ...entry, path: normalizedPath(entry.path) }));
  validateInventory(entries);
  const layout = packageManifest(selectedTarget);
  const names = new Set(entries.map((entry) => entry.path));
  for (const required of [
    "LICENSE.txt",
    "CMakeLists.txt",
    "include/cef_api_versions.h",
    ...(layout.platform === "windows" ? ["libcef.lib"] : []),
  ])
    if (!names.has(required))
      fail(`Custom SDK missing build input: ${required}`);
  for (const prefix of ["cmake/", "libcef_dll/"])
    if (!entries.some((entry) => entry.path.startsWith(prefix)))
      fail(`Custom SDK missing build input: ${prefix}`);
  const apiHeader = await readFile(
    path.join(sdkRoot, "include/cef_api_versions.h"),
    "utf8",
  );
  const apiLast = [
    ...apiHeader.matchAll(/^#define CEF_API_VERSION_LAST\s+(\S+)\s*$/gm),
  ];
  if (
    apiLast.length !== 1 ||
    apiLast[0][1] !== `CEF_API_VERSION_${artifact.runtime.cefApiVersion}`
  )
    fail("Custom SDK API selection differs from the frozen host ABI");
  const osMacro = { windows: "OS_WIN", linux: "OS_LINUX", macos: "OS_MAC" }[
    layout.platform
  ];
  const apiHashes = [
    ...apiHeader.matchAll(
      new RegExp(
        `^#(?:if|elif) defined\\(${osMacro}\\)\\r?\\n#define CEF_API_HASH_${artifact.runtime.cefApiVersion} "([a-f0-9]{40})"\\s*$`,
        "gm",
      ),
    ),
  ];
  if (apiHashes.length !== 1 || apiHashes[0][1] !== artifact.runtime.cefApiHash)
    fail("Custom SDK API hash differs from the runtime manifest");
  const versionHeader = await readFile(
    path.join(sdkRoot, "include/cef_version.h"),
    "utf8",
  );
  for (const [index, value] of CEF_PIN.chromium.split(".").entries()) {
    const name = `CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][index]}`;
    const matches = [
      ...versionHeader.matchAll(
        new RegExp(`^#define\\s+${name}\\s+(\\d+)\\s*$`, "gm"),
      ),
    ];
    if (matches.length !== 1 || matches[0][1] !== value)
      fail("Custom SDK Chromium version differs from the frozen pin");
  }
  // Do not permit the bindings' versioned-directory route to select another SDK.
  if (
    entries.some((entry) =>
      entry.path.startsWith(`${CEF_PIN.bindings.split("+")[1]}/`),
    )
  )
    fail("Custom SDK contains a fallback version directory");
  const destination = path.resolve(output);
  const source = await realpath(sdkRoot);
  // Resolve the existing parent to detect junctions and refuse recursive copies.
  const resolvedDestination = path.join(
    await realpath(path.dirname(destination)),
    path.basename(destination),
  );
  if (within(source, resolvedDestination))
    fail("Custom SDK output must be outside the source SDK");
  await mkdir(destination);
  for (const entry of entries) {
    const original = artifact.sdkFiles.find(
      (file) => normalizedPath(file.path) === entry.path,
    );
    const dest = path.join(destination, entry.path);
    await mkdir(path.dirname(dest), { recursive: true });
    if (entry.type === "symlink")
      await symlink(
        entry.target,
        dest,
        (await stat(path.join(source, original.path))).isDirectory()
          ? "dir"
          : "file",
      );
    else
      await copyFile(
        path.join(source, original.path),
        dest,
        constants.COPYFILE_EXCL,
      );
  }
  // download-cef checks the semver prefix and deserializes these three fields.
  // Keep an explicit custom name and actual custom archive SHA-1; never stamp
  // official archive metadata onto custom bytes. SHA-256 remains authoritative.
  const metadata = JSON.stringify({
    type: "minimal",
    name: `cef_binary_${CEF_PIN.version}_sorng-custom-${artifact.archive.sha256}.tar.bz2`,
    sha1: await fileDigest(verified.archivePath, "sha1"),
  });
  await writeFile(path.join(destination, "archive.json"), metadata, {
    flag: "wx",
  });
  entries.push({
    path: "archive.json",
    type: "file",
    size: Buffer.byteLength(metadata),
    sha256: createHash("sha256").update(metadata).digest("hex"),
  });
  await verifySdkInventory(destination, entries);
  for (const name of [...layout.runtimeFiles, layout.defaultLocale]) {
    const file = await checkedPath(destination, name, { regular: false });
    const info = await stat(file);
    if (!info.isFile() || !info.size)
      fail(`Custom runtime missing payload: ${name}`);
    if (
      process.platform !== "win32" &&
      layout.executableFiles.includes(name) &&
      !(info.mode & 0o111)
    )
      fail(`Custom runtime executable permission missing: ${name}`);
  }
  const library =
    layout.platform === "windows"
      ? "libcef.dll"
      : layout.platform === "linux"
        ? "libcef.so"
        : `${frameworkName}/Chromium Embedded Framework`;
  const sandbox =
    layout.platform === "windows"
      ? "bootstrap.exe"
      : layout.platform === "linux"
        ? "chrome-sandbox"
        : `${frameworkName}/Libraries/libcef_sandbox.dylib`;
  for (const [actual, declared] of [
    [library, artifact.runtime.library],
    [sandbox, artifact.runtime.sandbox],
  ])
    if (
      (await fileDigest(path.join(destination, actual))) !==
      (await fileDigest(path.join(destination, normalizedPath(declared))))
    )
      fail("Custom runtime layout differs from the declared library/sandbox");
  await preflightCustomRuntime({
    manifest,
    sourceLock,
    target: selectedTarget,
    artifactRoot,
    sdkRoot,
  });
  return {
    sdk: destination,
    archive: verified.archivePath,
    customRuntime: {
      manifest,
      sourceLock,
      artifactRoot: await realpath(artifactRoot),
      sourceSdk: source,
      sdkFiles: entries,
      sourceLockSha256: verified.sourceLockSha256,
      archiveSdkRelationship: verified.archiveSdkRelationship,
    },
    productionReady: false,
  };
}

export async function verifyPreparedCustomRuntime(plan) {
  const custom = plan.customRuntime;
  if (!custom) fail("Prepared custom runtime contract required");
  if (custom.sourceLockSha256 !== identitySha256(custom.sourceLock))
    fail("Prepared source lock identity changed");
  const preflight = await preflightCustomRuntime({
    manifest: custom.manifest,
    sourceLock: custom.sourceLock,
    target: plan.target,
    artifactRoot: custom.artifactRoot,
    sdkRoot: custom.sourceSdk,
  });
  if ((await realpath(plan.archive)) !== preflight.archivePath)
    fail("Prepared custom archive changed");
  await verifySdkInventory(plan.sdk, custom.sdkFiles);
  const artifact = custom.manifest.artifacts.find(
    (entry) => entry.target === plan.target,
  );
  await inspectCustomRuntimeExports(
    path.join(plan.sdk, normalizedPath(artifact.runtime.library)),
    plan.target,
  );
  return preflight;
}

/** All platforms share the normal app entry layout. Compiler outputs are
 * inspected before copying; every retained runtime byte is compared afterward.
 */
export async function stageCustomRuntimePackage({
  plan,
  application,
  helper,
  output,
  appPlist,
  python = process.platform === "win32" ? "python" : "python3",
}) {
  const preflight = await verifyPreparedCustomRuntime(plan);
  const layout = packageManifest(plan.target, plan.appName);
  const native = {
    application: await inspectNativeBinary(application, plan.target, {
      clientDll: layout.platform === "windows",
    }),
  };
  if (layout.platform !== "windows")
    native.helper = await inspectNativeBinary(helper, plan.target);
  let plist;
  if (layout.platform === "macos") {
    if (!appPlist) fail("macOS staging requires the application Info.plist");
    plist = JSON.parse(
      (
        await exec(
          python,
          [extractor, "plist", path.resolve(appPlist), plan.appName],
          { windowsHide: true },
        )
      ).stdout,
    );
  }
  const destination = path.resolve(output);
  const resolvedDestination = path.join(
    await realpath(path.dirname(destination)),
    path.basename(destination),
  );
  if (within(await realpath(plan.sdk), resolvedDestination))
    fail("Custom payload must be outside the prepared SDK");
  await mkdir(destination);
  const copy = async (source, name, executable = false) => {
    const dest = path.join(destination, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest, constants.COPYFILE_EXCL);
    if (executable && process.platform !== "win32") await chmod(dest, 0o755);
  };
  if (layout.platform === "macos") {
    await mkdir(path.join(destination, layout.bundlePrefix), {
      recursive: true,
    });
    await cp(
      path.join(plan.sdk, frameworkName),
      path.join(destination, layout.bundlePrefix, frameworkName),
      {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        errorOnExist: true,
        force: false,
      },
    );
  } else {
    const retained = new Set([
      ...layout.runtimeFiles,
      ...plan.customRuntime.sdkFiles
        .map((entry) => entry.path)
        .filter(
          (name) =>
            /^locales\/[A-Za-z0-9_-]+\.pak$/.test(name) ||
            (layout.platform === "linux" && name === "libminigbm.so"),
        ),
    ]);
    for (const name of retained)
      await copy(
        path.join(plan.sdk, name),
        name === "bootstrap.exe" ? `${plan.appName}.exe` : name,
        layout.executableFiles.includes(name),
      );
  }
  await copy(path.join(plan.sdk, "CREDITS.html"), layout.creditDestination);
  await copy(
    path.join(plan.sdk, "LICENSE.txt"),
    layout.platform === "macos"
      ? "Contents/Resources/cef-LICENSE.txt"
      : "cef-LICENSE.txt",
  );
  const app =
    layout.platform === "windows"
      ? `${plan.appName}.dll`
      : layout.platform === "linux"
        ? `${plan.appName}.bin`
        : `Contents/MacOS/${plan.appName}`;
  await copy(application, app, layout.platform !== "windows");
  const helpers = [];
  if (layout.platform === "linux") {
    helpers.push(`${plan.appName}.helper`);
    await writeFile(
      path.join(destination, plan.appName),
      `#!/bin/sh\nset -eu\napp_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport GDK_BACKEND=x11\nexec "$app_dir/${plan.appName}.bin" "$@"\n`,
      { flag: "wx", mode: 0o755 },
    );
  } else if (layout.platform === "macos") {
    await copy(appPlist, "Contents/Info.plist");
    for (const suffix of [
      "",
      " (Alerts)",
      " (GPU)",
      " (Plugin)",
      " (Renderer)",
    ]) {
      const name = `${plan.appName} Helper${suffix}`,
        prefix = `Contents/Frameworks/${name}.app/Contents`;
      helpers.push(`${prefix}/MacOS/${name}`);
      await mkdir(path.join(destination, prefix), { recursive: true });
      await writeFile(
        path.join(destination, prefix, "Info.plist"),
        helperPlist(plan.appName, suffix, plist.identifier),
        { flag: "wx" },
      );
    }
  }
  for (const name of helpers) await copy(helper, name, true);
  for (const [name, expected] of [
    [app, native.application.sha256],
    ...helpers.map((name) => [name, native.helper.sha256]),
  ]) {
    if (
      createHash("sha256")
        .update(await readFile(path.join(destination, name)))
        .digest("hex") !== expected
    )
      fail("Compiler output changed during custom staging");
  }
  await verifyPreparedCustomRuntime(plan);
  const inspection = await inspectBundle(
    destination,
    plan.sdk,
    plan.target,
    plan.appName,
  );
  if (!inspection.ok)
    fail(`Custom CEF package rejected: ${inspection.errors.join("; ")}`);
  const license =
    layout.platform === "macos"
      ? "Contents/Resources/cef-LICENSE.txt"
      : "cef-LICENSE.txt";
  if (
    (await fileDigest(path.join(destination, license))) !==
    (await fileDigest(path.join(plan.sdk, "LICENSE.txt")))
  )
    fail("Custom CEF license changed during staging");
  return {
    ok: true,
    kind: "sorng-cef-custom-package",
    target: plan.target,
    native,
    inspection,
    preflight,
    staging: {
      bundle: destination,
      runtime: plan.sdk,
      source: "verified-custom-sdk-inventory",
    },
    productionReady: false,
    runtimeCapability: "not-probed",
    nativeAcceptance: "not-tested",
  };
}

async function git(root, args) {
  // No shell expansion, prompts, optional index refresh, or inherited index overrides.
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  for (const key of Object.keys(env))
    if (
      /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*)$/i.test(
        key,
      )
    )
      delete env[key];
  const { stdout } = await exec("git", ["-C", root, ...args], {
    env,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

/** Raw checked-out sources, before upstream hooks or the project patch queue.
 * Chromium's nested cef checkout is checked independently and excluded from its
 * untracked scan. Dependencies must already be provisioned; nothing is fetched.
 */
export async function preflightSourceCheckout({
  sourceLock,
  inputsRoot,
  checkouts,
}) {
  validateSourceLock(sourceLock);
  shape(checkouts, ["cef", "chromium", "depotTools"], "checkouts");
  for (const name of Object.keys(repositories)) {
    const root = await realpath(checkouts[name]);
    if (
      (await realpath(await git(root, ["rev-parse", "--show-toplevel"]))) !==
      root
    )
      fail(`${name}: checkout root required`);
    if (
      (await git(root, ["rev-parse", "HEAD"])) !==
      sourceLock.upstream[name].commit
    )
      fail(`${name}: source revision mismatch`);
    const args = [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
    ];
    if (name === "chromium") args.push(":(exclude)cef");
    if (await git(root, args))
      fail(
        `${name}: clean checkout required; existing changes are never reset`,
      );
  }
  if (
    (await realpath(checkouts.cef)) !==
    (await realpath(path.join(checkouts.chromium, "cef")))
  )
    fail("CEF checkout must be chromium/cef for upstream hooks");
  for (const pin of [
    sourceLock.bridge.header,
    ...sourceLock.builds.flatMap((build) => [
      build.gnArgs,
      build.toolchainLock,
    ]),
  ])
    await verifyFile(inputsRoot, pin);
  const patchGroups = [];
  for (const name of ["cef", "chromium"]) {
    const patches = [];
    for (const patch of sourceLock.patches.filter(
      (item) => item.repository === name,
    ))
      patches.push(await verifyFile(inputsRoot, patch));
    if (patches.length) {
      await git(checkouts[name], [
        "apply",
        "--check",
        "--whitespace=error-all",
        "--",
        ...patches,
      ]);
      patchGroups.push({
        repository: name,
        cwd: await realpath(checkouts[name]),
        patches,
      });
    }
  }
  return {
    sourceLockSha256: identitySha256(sourceLock),
    patchGroups,
    sourceVerified: true,
    patchesApplied: false,
    productionReady: false,
  };
}

/** Explicit mutation only. Never runs implicitly from app build/preflight.
 * No resets/rollback: an unexpected later failure reports completed groups and
 * preserves their changes for review. Concurrent source mutation is unsupported.
 */
export async function applySourcePatches(options) {
  const result = await preflightSourceCheckout(options);
  const appliedRepositories = [];
  for (const group of result.patchGroups) {
    try {
      await git(group.cwd, [
        "apply",
        "--whitespace=error-all",
        "--",
        ...group.patches,
      ]);
      appliedRepositories.push(group.repository);
    } catch (error) {
      throw new Error(
        `Patch application failed; applied repositories: ${appliedRepositories.join(",") || "none"}. No rollback/reset performed. ${error.message}`,
      );
    }
  }
  return { ...result, patchesApplied: true, appliedRepositories };
}

/** Chromium's TS build must not resolve modules from an enclosing application. */
export async function verifySourceBuildIsolation(chromium) {
  let directory = path.resolve(chromium);
  for (;;) {
    const modules = path.join(directory, "node_modules");
    let present = false;
    try {
      present = (await stat(modules)).isDirectory();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (present)
      fail(
        `Chromium source build would inherit ${modules}. Use a dedicated source workspace outside the application directory and build from its physical path; do not change or remove the application's dependencies.`,
      );
    const parent = path.dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

/** Check upstream's own version derivation before generating or compiling. */
export async function verifySourceCheckoutVersion(python, chromium, expected) {
  const root = path.resolve(chromium);
  const { stdout } = await exec(
    python,
    [path.join(root, "cef/tools/cef_version.py"), "current", root],
    { cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  if (stdout.trim() !== expected)
    fail(
      "Upstream CEF version derivation differs from the source lock. Provision the pinned CEF release/master metadata refs before building; do not edit the generated version header.",
    );
}

/** Build-farm recipe, not an executor and never a normal app-build dependency. */
export async function customRuntimeBuildRecipe({
  sourceLock,
  target: selectedTarget,
  inputsRoot,
  checkouts,
}) {
  validateSourceLock(sourceLock);
  target(selectedTarget);
  const build = sourceLock.builds.find(
    (item) => item.target === selectedTarget,
  );
  if (!build) fail("No pinned build recipe for target");
  const gnFile = await verifyFile(inputsRoot, build.gnArgs);
  await verifyFile(inputsRoot, build.toolchainLock);
  const gnDefines = (await readFile(gnFile, "utf8")).trim();
  if (!gnDefines || /\0/.test(gnDefines)) fail("Empty/invalid GN definitions");
  const arch = selectedTarget.startsWith("aarch64") ? "arm64" : "x64";
  const windows = selectedTarget.includes("windows");
  const host = windows
    ? "win32"
    : selectedTarget.includes("linux")
      ? "linux"
      : "darwin";
  // Restrict definitions to literal assignments: no import(), exec_script(),
  // duplicate assignments or GN expressions hidden in the reviewed argument file.
  const args = {};
  const definitions = gnDefines.replace(/#[^\r\n]*/g, "");
  let cursor = 0;
  const assignment =
    /\s*([a-z][a-z0-9_]*)\s*=\s*(true|false|[0-9]+|"[a-zA-Z0-9_.-]+")\s*/gy;
  while (cursor < definitions.length) {
    assignment.lastIndex = cursor;
    const match = assignment.exec(definitions);
    if (!match || Object.hasOwn(args, match[1]))
      fail("GN arguments must be unique literal assignments");
    args[match[1]] = match[2];
    cursor = assignment.lastIndex;
  }
  for (const [name, expected] of Object.entries({
    target_cpu: `"${arch}"`,
    is_component_build: "false",
    is_debug: "false",
    use_remoteexec: "false",
    use_siso: "true",
  }))
    if (args[name] !== expected)
      fail(`GN argument ${name} must be ${expected}`);
  if (
    Object.entries(args).some(
      ([name, value]) => /sandbox/.test(name) && value !== "true",
    )
  )
    fail("Sandbox-disabling GN argument rejected");
  if (host === "darwin" && args.mac_deployment_target !== '"14.0"')
    fail("macOS deployment target must be 14.0");
  if (host === "linux" && args.ozone_platform_x11 !== "true")
    fail("Linux requires X11/XWayland support");
  return {
    kind: "sorng-cef-custom-build-recipe",
    target: selectedTarget,
    sourceLockSha256: identitySha256(sourceLock),
    requiredHost: host,
    executed: false,
    productionReady: false,
    prerequisites: [
      "Run source preflight and explicitly apply patches first",
      "Provision locked Chromium DEPS, depot_tools and native toolchain separately",
      "Review upstream hook effects and all GN args against the pinned toolchain lock",
      "Build matched sandbox/bootstrap/framework payload; inventory and archive outputs after success",
      "Run native verifier and containment acceptance; this recipe does not attest them",
    ],
    environment: {
      DEPOT_TOOLS_UPDATE: "0",
      ...(windows ? { DEPOT_TOOLS_WIN_TOOLCHAIN: "0" } : {}),
      GN_DEFINES: gnDefines,
      GN_OUT_CONFIGS: `Release_GN_${arch}`,
      CEF_USE_GN: "1",
    },
    prependPath: path.resolve(checkouts.depotTools),
    commands: [
      {
        cwd: path.resolve(checkouts.chromium),
        executable: "python3",
        args: ["cef/tools/gclient_hook.py"],
      },
      // Pinned automate-git.py also builds bootstrap/bootstrapc on Windows.
      {
        cwd: path.resolve(checkouts.chromium),
        executable: "python3",
        args: [
          path.join(path.resolve(checkouts.depotTools), "autoninja.py"),
          "-C",
          `out/Release_GN_${arch}`,
          "cef",
          ...(windows
            ? ["bootstrap", "bootstrapc"]
            : host === "linux"
              ? ["chrome_sandbox"]
              : ["cef_sandbox"]),
        ],
      },
      {
        cwd: path.resolve(checkouts.cef),
        executable: "python3",
        args: [
          "tools/make_distrib.py",
          "--output-dir",
          "binary_distrib",
          "--ninja-build",
          `--${arch}-build`,
          "--minimal",
          "--allow-partial",
        ],
      },
    ],
  };
}

/** Acquisition recipe only: never chooses latest or runs Git/network commands.
 * Use a NEW short dedicated root. No global Git/environment configuration.
 */
export function sourceAcquisitionPlan(root) {
  const checkoutRoot = path.resolve(root);
  if (checkoutRoot === path.parse(checkoutRoot).root || /\s/.test(checkoutRoot))
    fail("Choose a non-root, space-free source workspace");
  const checkouts = {
    chromium: path.join(checkoutRoot, "src"),
    cef: path.join(checkoutRoot, "src", "cef"),
    depotTools: path.join(checkoutRoot, "depot_tools"),
  };
  return {
    kind: "sorng-cef-source-acquisition-plan",
    root: checkoutRoot,
    checkouts,
    sourcePins: {
      cef: UPSTREAM_CEF_COMMIT,
      chromium: UPSTREAM_CHROMIUM_COMMIT,
      depotTools: UPSTREAM_DEPOT_TOOLS_COMMIT,
    },
    executed: false,
    environment: { DEPOT_TOOLS_UPDATE: "0", DEPOT_TOOLS_WIN_TOOLCHAIN: "0" },
    repositories: ["depotTools", "chromium", "cef"].map((name) => ({
      name,
      destination: checkouts[name],
      repository: repositories[name],
      commit: {
        cef: UPSTREAM_CEF_COMMIT,
        chromium: UPSTREAM_CHROMIUM_COMMIT,
        depotTools: UPSTREAM_DEPOT_TOOLS_COMMIT,
      }[name],
      localGitConfig: { "core.autocrlf": "false", "core.longpaths": "true" },
      versionReferences:
        name === "cef" ? { ...UPSTREAM_CEF_VERSION_REFERENCES } : {},
    })),
    gclient: {
      solutions: [
        {
          name: "src",
          url: repositories.chromium,
          managed: false,
          custom_deps: {},
          custom_vars: {
            checkout_pgo_profiles: true,
            siso_version: `git_revision:${UPSTREAM_SISO_REVISION}`,
            download_remoteexec_cfg: false,
          },
        },
      ],
      syncArgs: [
        "sync",
        "--nohooks",
        "--no-history",
        "--revision",
        `src@${UPSTREAM_CHROMIUM_COMMIT}`,
      ],
    },
    prerequisites: [
      "Native toolchain preflight must pass before downloading Chromium",
      "Never fetch into an existing checkout or substitute source tags/branches",
      "gclient sync provisions large DEPS/CIPD downloads; run only as an explicit acquisition step",
      "Run gclient runhooks for pinned dependencies before custom CEF source preflight/build",
    ],
  };
}

/** Pure assessment used by the CLI's read-only native Windows inventory. */
export function assessWindowsEnginePrerequisites({
  visualStudioVersions = [],
  sdkVersions = [],
  debuggerVersion = null,
  nativePython = false,
}) {
  const atLeast = (actual, wanted) => {
    const left = String(actual).split(".").map(Number),
      right = wanted.split(".").map(Number);
    if (left.some((part) => !Number.isFinite(part))) return false;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if ((left[i] ?? 0) > (right[i] ?? 0)) return true;
      if ((left[i] ?? 0) < (right[i] ?? 0)) return false;
    }
    return true;
  };
  const blockers = [];
  if (!visualStudioVersions.some((version) => atLeast(version, "18.0")))
    blockers.push(
      "Documented VS 2026 >=18.0 native desktop/MFC/ATL toolchain not found",
    );
  if (!sdkVersions.some((version) => atLeast(version, "10.0.28000.0")))
    blockers.push(
      "Windows SDK 10.0.28000 include/library version not found (required distribution 10.0.28000.2270)",
    );
  if (!debuggerVersion || !atLeast(debuggerVersion, "10.0.26100.3323"))
    blockers.push("Debugging Tools dbghelp.dll >=10.0.26100.3323 not found");
  if (!nativePython)
    blockers.push("Native Windows Python 3 executable not supplied/found");
  return {
    ok: blockers.length === 0,
    blockers,
    documentedPrerequisitesOnly: true,
    actualCompile: "not-tested",
    productionReady: false,
  };
}

/** Build inputs must be an explicit hash inventory, not a free-form version note.
 * This verifies installed tool bytes; it does not provision them or certify their
 * compatibility. Native prerequisite checks and actual compilation remain separate.
 */
export async function verifyToolchainFiles({
  sourceLock,
  target: selectedTarget,
  inputsRoot,
  toolsRoot,
  python,
}) {
  validateSourceLock(sourceLock);
  target(selectedTarget);
  const build = sourceLock.builds.find(
    (entry) => entry.target === selectedTarget,
  );
  if (!build) fail("No toolchain lock for target");
  const location = await verifyFile(inputsRoot, build.toolchainLock);
  const lock = JSON.parse(await readFile(location, "utf8"));
  shape(lock, ["schemaVersion", "kind", "target", "files"], "toolchain lock");
  if (
    lock.schemaVersion !== 1 ||
    lock.kind !== "sorng-cef-toolchain-lock" ||
    lock.target !== selectedTarget
  )
    fail("Toolchain target/schema mismatch");
  list(lock.files, "toolchain files");
  unique(
    lock.files.map((file) => file.path),
    "toolchain files",
  );
  let pythonVerified = false;
  for (const pin of lock.files) {
    filePin(pin, "toolchain file", true);
    const file = await verifyFile(toolsRoot, pin);
    if ((await realpath(file)) === (await realpath(python)))
      pythonVerified = true;
  }
  if (!pythonVerified)
    fail(
      "Selected Python executable is absent from pinned toolchain inventory",
    );
  return {
    filesVerified: lock.files.length,
    toolchainBytesVerified: true,
    compatibility: "not-compiled",
  };
}
