#!/usr/bin/env node
// Local byte inventory, not a build attestation, source authentication, or Ready.
// Never downloads, extracts archives, loads libraries, or executes native code.
import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_V2,
  identitySha256,
  inspectCustomRuntimeExports,
  preflightCustomRuntime,
  validateCustomRuntimeManifest,
  validateSourceLock,
} from "./lib/browser-custom-runtime.mjs";
import {
  CEF_PIN,
  TARGETS,
  inspectNativeBinary,
} from "./browser-runtime-package.mjs";

export const HELP = `Inventory an already-built custom CEF SDK (offline; no execution):
  node scripts/cef-custom-artifact-inventory.mjs --lock JSON --target TRIPLE
    --artifact-root DIR --sdk DIR --archive FILE --manifest NEW_JSON --receipt NEW_JSON
    [--library SDK_RELATIVE_PATH] [--sandbox SDK_RELATIVE_PATH]

Archive, manifest and receipt paths are relative to artifact-root, or absolute
paths beneath it. Output parent directories must already exist. Both output
filenames must be new, distinct and outside the SDK; nothing is overwritten.
The archive must have a distinct sorng-cef-custom-*.tar.bz2 basename. The supplied
SDK must already contain its bridge header, archive.json, version/API headers,
and matching native library and sandbox payload. Ambiguous layouts require the
explicit library/sandbox paths. This does not prepare or modify the SDK.

Outputs use the existing reviewed-artifact manifest/build-receipt schemas, but
still require human review. Hashes bind bytes and the lock's declared build-input
pins, not proof that a build used those inputs. Source authenticity is not
established by hashes; archive/SDK extraction equivalence is not tested.
Native acceptance: not-tested. Runtime capability: not-probed. productionReady=false.
An interruption may leave incomplete output files; use new filenames to retry.
`;

export function parseArguments(argv) {
  if (!argv.length || (argv.length === 1 && ["--help", "-h"].includes(argv[0])))
    return { help: true };
  const names = [
    "lock",
    "target",
    "artifact-root",
    "sdk",
    "archive",
    "manifest",
    "receipt",
    "library",
    "sandbox",
  ];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!match || !names.includes(match[1]))
      throw new Error(`Unknown option: ${argv[i]}`);
    const key = match[1];
    if (Object.hasOwn(options, key))
      throw new Error(`Duplicate option: --${key}`);
    const value = match[2] ?? argv[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`--${key} requires a value`);
    options[key] = value;
  }
  for (const name of names.slice(0, 7))
    if (!options[name]) throw new Error(`--${name} is required`);
  return options;
}

function within(root, location) {
  const rel = path.relative(root, location);
  return (
    rel === "" ||
    (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
  );
}

function relative(name) {
  if (
    typeof name !== "string" ||
    !name ||
    /[\\:\x00-\x1f<>"|?*]/.test(name) ||
    name
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
    throw new Error(`Unsafe relative path: ${name}`);
  return name;
}

async function directory(location) {
  if (!(await lstat(location)).isDirectory())
    throw new Error("A real directory is required");
  return realpath(location);
}

async function contained(root, name) {
  const file = path.join(root, relative(name));
  if (!within(root, await realpath(file)))
    throw new Error(`Path escapes supplied root: ${name}`);
  return file;
}

function sameFile(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

async function measure(root, name) {
  const file = await contained(root, name);
  const before = await lstat(file);
  if (!before.isFile()) throw new Error(`Regular file required: ${name}`);
  const handle = await open(file, "r");
  try {
    if (!sameFile(before, await handle.stat()))
      throw new Error(`File changed while opening: ${name}`);
    const hash = createHash("sha256");
    let size = 0;
    for await (const bytes of handle.createReadStream({ autoClose: false })) {
      hash.update(bytes);
      size += bytes.length;
    }
    if (
      size !== before.size ||
      !sameFile(before, await handle.stat()) ||
      !sameFile(before, await lstat(file))
    )
      throw new Error(`File changed during inventory: ${name}`);
    return { path: name, type: "file", size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function inventory(root) {
  const entries = [];
  const seen = new Set();
  async function visit(prefix = "") {
    for (const leaf of (await readdir(path.join(root, prefix))).sort()) {
      const name = relative(prefix ? `${prefix}/${leaf}` : leaf);
      if (seen.has(name.toLowerCase()))
        throw new Error(`Case-colliding SDK paths: ${name}`);
      seen.add(name.toLowerCase());
      const file = await contained(root, name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) {
        const target = await readlink(file);
        if (!target || /[\\:\x00-\x1f]/.test(target) || target.startsWith("/"))
          throw new Error(`Unsafe SDK symlink target: ${name}`);
        relative(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(name), target),
          ),
        );
        entries.push({ path: name, type: "symlink", target });
      } else if (info.isDirectory()) await visit(name);
      else if (info.isFile()) entries.push(await measure(root, name));
      else throw new Error(`Unsupported SDK entry: ${name}`);
    }
  }
  await visit();
  return entries.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

async function textFile(root, entries, name) {
  const pin = entries.find(
    (entry) => entry.path === name && entry.type === "file",
  );
  if (!pin || !pin.size || pin.size > 4 * 1024 * 1024)
    throw new Error(`Missing/invalid SDK header or metadata: ${name}`);
  const bytes = await readFile(await contained(root, name));
  if (
    bytes.length !== pin.size ||
    createHash("sha256").update(bytes).digest("hex") !== pin.sha256
  )
    throw new Error(`SDK file changed: ${name}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
    throw new Error(`Malformed SDK text: ${name}`);
  return text;
}

// Parse only generated header guards/platform branches, not arbitrary C or a
// preprocessor. Unknown conditional expressions around identity macros fail.
function definitions(text, guard) {
  const clean = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
  if (clean.includes("/*") || /\\\r?\n/.test(clean))
    throw new Error("Malformed/continued SDK header");
  const result = new Map();
  const stack = [];
  for (const line of clean.split(/\r?\n/)) {
    const directive = /^\s*#\s*(\w+)\b(.*)$/.exec(line);
    if (!directive) continue;
    const [, command, raw] = directive;
    const value = raw.trim();
    const condition = () =>
      /^defined\((OS_WIN|OS_LINUX|OS_MAC)\)$/.exec(value)?.[1] ?? "unknown";
    if (["if", "ifdef", "ifndef"].includes(command)) {
      stack.push(
        command === "ifndef" && value === guard && !stack.length
          ? "guard"
          : command === "if"
            ? condition()
            : "unknown",
      );
    } else if (command === "elif" || command === "else") {
      if (!stack.length || stack.at(-1) === "guard")
        throw new Error("Malformed SDK header conditional");
      stack[stack.length - 1] = command === "elif" ? condition() : "unknown";
    } else if (command === "endif") {
      if (!stack.length || value)
        throw new Error("Malformed SDK header conditional");
      stack.pop();
    } else if (command === "define" || command === "undef") {
      const macro = /^(\w+)\b(.*)$/.exec(value);
      if (!macro) throw new Error("Malformed SDK header macro");
      const contexts = stack.filter((entry) => entry !== "guard");
      const context =
        contexts.length === 0
          ? "all"
          : contexts.length === 1
            ? contexts[0]
            : "unknown";
      const list = result.get(macro[1]) ?? [];
      list.push({
        value: command === "define" ? macro[2].trim() : "undefined",
        context,
      });
      result.set(macro[1], list);
    }
  }
  if (stack.length) throw new Error("Unclosed SDK header conditional");
  return { macros: result, clean };
}

function exact(macros, name, expected) {
  const values = macros.get(name) ?? [];
  if (
    values.length !== 1 ||
    values[0].context !== "all" ||
    values[0].value !== expected
  )
    throw new Error(`SDK header mismatch: ${name}`);
}

async function headers(root, entries, lock, target) {
  const windows = target.includes("windows");
  const { macros } = definitions(
    await textFile(root, entries, "include/cef_version.h"),
    "CEF_INCLUDE_CEF_VERSION_H_",
  );
  const sandboxCompat = windows ? CEF_PIN.sandboxCompat : "";
  exact(macros, "CEF_VERSION", JSON.stringify(CEF_PIN.version));
  exact(macros, "CEF_COMMIT_HASH", JSON.stringify(lock.upstream.cef.commit));
  exact(macros, "CEF_SANDBOX_COMPAT_HASH", JSON.stringify(sandboxCompat));
  CEF_PIN.chromium
    .split(".")
    .forEach((value, index) =>
      exact(
        macros,
        `CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][index]}`,
        value,
      ),
    );
  const api = definitions(
    await textFile(root, entries, "include/cef_api_versions.h"),
    "CEF_INCLUDE_CEF_API_VERSIONS_H_",
  ).macros;
  exact(api, "CEF_API_VERSION_LAST", "CEF_API_VERSION_15400");
  exact(api, "CEF_API_VERSION_15400", "15400");
  const os = windows
    ? "OS_WIN"
    : target.includes("linux")
      ? "OS_LINUX"
      : "OS_MAC";
  const values = api.get("CEF_API_HASH_15400") ?? [];
  if (
    values.some(
      (entry) =>
        !["OS_WIN", "OS_LINUX", "OS_MAC"].includes(entry.context) ||
        !/^"[a-f0-9]{40}"$/.test(entry.value),
    ) ||
    new Set(values.map((entry) => entry.context)).size !== values.length
  )
    throw new Error("Malformed/duplicate SDK API hash definitions");
  const selected = values.filter((entry) => entry.context === os);
  if (selected.length !== 1 || /^"0+"$/.test(selected[0].value))
    throw new Error("Missing/invalid target SDK API hash");
  const bridge = definitions(
    await textFile(root, entries, lock.bridge.header.path),
    "CEF_SORNG_TLS_BRIDGE_H_",
  );
  exact(bridge.macros, "CEF_SORNG_TLS_ABI_V2", "2u");
  for (const symbol of [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol]) {
    const declarations = [
      ...bridge.clean.matchAll(
        new RegExp(`\\b${symbol}\\s*\\([^;{}]*\\)\\s*;`, "g"),
      ),
    ];
    if (declarations.length !== 1)
      throw new Error(`Missing/invalid bridge declaration: ${symbol}`);
  }
  const metadata = JSON.parse(await textFile(root, entries, "archive.json"));
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error("SDK archive.json must be an object");
  return {
    cefCommit: lock.upstream.cef.commit,
    cefVersion: CEF_PIN.version,
    cefApiVersion: 15400,
    cefApiHash: selected[0].value.slice(1, -1),
    sandboxCompat,
  };
}

async function payload(root, entries, basename, explicit) {
  const names = explicit
    ? [relative(explicit)]
    : entries
        .filter((entry) => path.posix.basename(entry.path) === basename)
        .map((entry) => entry.path);
  const candidates = new Map();
  for (const name of names) {
    if (
      !entries.some((entry) => entry.path === name) ||
      path.posix.basename(name) !== basename
    )
      throw new Error(`Invalid runtime payload: ${name}`);
    const resolved = await realpath(await contained(root, name));
    if (!(await lstat(resolved)).isFile())
      throw new Error(`Runtime payload must resolve to a file: ${name}`);
    candidates.set(resolved, name);
  }
  if (candidates.size !== 1)
    throw new Error(
      `Missing/ambiguous ${basename}; supply an explicit --library/--sandbox path`,
    );
  return [...candidates.values()][0];
}

async function artifactPath(root, input, output = false) {
  const file = path.resolve(root, input);
  if (!within(root, file))
    throw new Error("Artifact path escapes supplied root");
  const name = relative(path.relative(root, file).split(path.sep).join("/"));
  const parent = await realpath(path.dirname(file));
  if (!within(root, parent))
    throw new Error("Artifact parent escapes supplied root");
  const resolved = path.join(parent, path.basename(file));
  if (!output) await contained(root, name);
  else {
    try {
      await lstat(resolved);
      throw new Error(`Output already exists: ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { name, file: resolved };
}

export async function inventoryCustomArtifact(options) {
  const lock = validateSourceLock(
    JSON.parse(await readFile(path.resolve(options.lock), "utf8")),
  );
  const target = options.target;
  if (
    !TARGETS.includes(target) ||
    !lock.builds.some((build) => build.target === target)
  )
    throw new Error("Target must have pinned source-lock build inputs");
  const root = await directory(path.resolve(options["artifact-root"]));
  const sdk = await directory(path.resolve(options.sdk));
  const archivePath = await artifactPath(root, options.archive);
  const manifestPath = await artifactPath(root, options.manifest, true);
  const receiptPath = await artifactPath(root, options.receipt, true);
  if (manifestPath.file.toLowerCase() === receiptPath.file.toLowerCase())
    throw new Error("Manifest and receipt require distinct filenames");
  for (const item of [archivePath, manifestPath, receiptPath])
    if (within(sdk, item.file))
      throw new Error("Archive/outputs must be outside the supplied SDK");
  if (
    !/^sorng-cef-custom-.+\.tar\.bz2$/.test(
      path.posix.basename(archivePath.name),
    )
  )
    throw new Error(
      "Custom archive requires a distinct sorng-cef-custom-*.tar.bz2 name",
    );
  const sdkFiles = await inventory(sdk);
  const runtime = await headers(sdk, sdkFiles, lock, target);
  const windows = target.includes("windows"),
    linux = target.includes("linux");
  runtime.library = await payload(
    sdk,
    sdkFiles,
    windows
      ? "libcef.dll"
      : linux
        ? "libcef.so"
        : "Chromium Embedded Framework",
    options.library,
  );
  runtime.sandbox = await payload(
    sdk,
    sdkFiles,
    windows
      ? "bootstrap.exe"
      : linux
        ? "chrome-sandbox"
        : "libcef_sandbox.dylib",
    options.sandbox,
  );
  const nativeExports = await inspectCustomRuntimeExports(
    await contained(sdk, runtime.library),
    target,
  );
  const sandbox = await contained(sdk, runtime.sandbox);
  if (windows || linux) await inspectNativeBinary(sandbox, target);
  else {
    // inspectNativeBinary targets Mach-O applications, not sandbox dylibs.
    const handle = await open(sandbox, "r");
    try {
      const bytes = Buffer.alloc(32);
      const read = await handle.read(bytes, 0, bytes.length, 0);
      if (
        read.bytesRead !== 32 ||
        bytes.readUInt32LE(0) !== 0xfeedfacf ||
        bytes.readUInt32LE(4) !==
          (target.startsWith("aarch64") ? 0x100000c : 0x1000007) ||
        bytes.readUInt32LE(12) !== 6
      )
        throw new Error("Sandbox Mach-O architecture/type mismatch");
    } finally {
      await handle.close();
    }
  }
  const measuredArchive = await measure(root, archivePath.name);
  const { type: _type, ...archive } = measuredArchive;
  const sourceLockSha256 = identitySha256(lock);
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-build-receipt",
    target,
    sourceLockSha256,
    archiveSha256: archive.sha256,
    sdkInventorySha256: identitySha256(sdkFiles),
    buildInputsSha256: identitySha256(
      lock.builds.find((build) => build.target === target),
    ),
  };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  const manifest = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-runtime",
    sourceLockSha256,
    artifacts: [
      {
        target,
        archive,
        provenance: {
          path: receiptPath.name,
          size: Buffer.byteLength(receiptBytes),
          sha256: createHash("sha256").update(receiptBytes).digest("hex"),
        },
        sdkFiles,
        runtime,
      },
    ],
  };
  validateCustomRuntimeManifest(manifest, lock);
  // Reserve both names exclusively before writing. Remove only this invocation's
  // own files on failure; never replace/unlink an existing output or input.
  const owned = [];
  try {
    for (const item of [manifestPath, receiptPath]) {
      const handle = await open(item.file, "wx");
      owned.push({ ...item, handle, identity: await handle.stat() });
    }
    await owned[1].handle.writeFile(receiptBytes, "utf8");
    await owned[1].handle.sync();
    const checked = await preflightCustomRuntime({
      manifest,
      sourceLock: lock,
      target,
      artifactRoot: root,
      sdkRoot: sdk,
    });
    await owned[0].handle.writeFile(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await owned[0].handle.sync();
    return {
      manifest: manifestPath.file,
      receipt: receiptPath.file,
      target,
      filesInventoried: sdkFiles.length,
      exports: nativeExports.exports,
      reviewRequired: true,
      sourceAuthenticity: "not-established-by-hashes",
      buildInputs: "source-lock-bound-not-build-execution-attestation",
      archiveSdkRelationship: checked.archiveSdkRelationship,
      runtimeCapability: "not-probed",
      nativeAcceptance: "not-tested",
      productionReady: false,
    };
  } catch (error) {
    for (const item of owned) {
      await item.handle.close();
      item.handle = null;
      const current = await lstat(item.file).catch(() => null);
      if (
        current?.dev === item.identity.dev &&
        current?.ino === item.identity.ino
      )
        await unlink(item.file);
    }
    throw error;
  } finally {
    for (const item of owned) await item.handle?.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  return options.help ? HELP : inventoryCustomArtifact(options);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((result) =>
      process.stdout.write(
        typeof result === "string"
          ? result
          : `${JSON.stringify(result, null, 2)}\n`,
      ),
    )
    .catch((error) => {
      console.error(`[cef-custom-artifact-inventory] ${error.message}`);
      process.exitCode = 1;
    });
}
