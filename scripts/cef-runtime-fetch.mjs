#!/usr/bin/env node
// Explicit reviewed release consumption; no source builds, stock fallback,
// authentication headers, engine execution, or runtime admission.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  identitySha256,
  inspectCustomRuntimeExports,
  preflightCustomRuntime,
} from "./lib/browser-custom-runtime.mjs";
import {
  LOCAL_RUNTIME_SELECTION_FILE,
  registerLocalRuntime,
  sameLocalPath,
  validateLocalRuntimeSelection,
} from "./lib/browser-local-runtime.mjs";
import {
  RELEASE_LIMITS,
  bindRuntimeRelease,
  releaseAssetUrl,
  reviewedSha256,
  validateRuntimeReleaseDescriptor,
} from "./lib/browser-runtime-release.mjs";
import { TARGETS } from "./browser-runtime-package.mjs";

const exec = promisify(execFile);
export const DEFAULT_CACHE_ROOT = fileURLToPath(
  new URL("../.cache/cef-runtime-releases", import.meta.url),
);
export const DEFAULT_PYTHON =
  process.platform === "win32" ? "python" : "python3";
const extractor = fileURLToPath(
  new URL("./lib/extract-custom-runtime.py", import.meta.url),
);
const fields = ["sourceLock", "manifest", "receipt", "archive"];
const redirectHosts = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

async function exists(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function directory(root, parts = []) {
  await mkdir(root, { recursive: true });
  if (!(await lstat(root)).isDirectory())
    throw new Error("Cache root must be a real directory");
  let current = await realpath(root);
  for (const name of parts) {
    current = path.join(current, name);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (
      !(await lstat(current)).isDirectory() ||
      (await realpath(current)) !== current
    )
      throw new Error("Cache/install directory is a link or alias");
  }
  return current;
}

async function measure(file, { sha256, size }, maximum) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.size > maximum ||
    (size !== undefined && info.size !== size)
  )
    throw new Error(
      "Cached/downloaded file has an invalid type or size; existing bytes preserved",
    );
  const digest = createHash("sha256");
  let count = 0;
  for await (const chunk of createReadStream(file)) {
    count += chunk.length;
    if (count > maximum) throw new Error("File exceeds transport bound");
    digest.update(chunk);
  }
  if (digest.digest("hex") !== sha256 || (size !== undefined && count !== size))
    throw new Error("Raw SHA-256/size mismatch; existing bytes preserved");
}

function redirectUrl(value, previous, release) {
  const url = new URL(value, previous);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Unsafe release redirect");
  if (url.hostname === "github.com") {
    if (releaseAssetUrl(url.href).release !== release)
      throw new Error("Cross-release redirect rejected");
  } else if (!redirectHosts.has(url.hostname))
    throw new Error("Release redirect host rejected");
  return url.href;
}

/** Injected request is for deterministic tests, never selectable via CLI/env. */
export async function downloadPinned(
  { url, sha256, size, maximum, output, offline = false },
  request = globalThis.fetch,
) {
  reviewedSha256(sha256);
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    maximum > RELEASE_LIMITS.archive ||
    (size !== undefined &&
      (!Number.isSafeInteger(size) || size <= 0 || size > maximum))
  )
    throw new Error("Invalid transport size bound");
  const origin = releaseAssetUrl(url);
  if (await exists(output)) {
    await measure(output, { sha256, size }, maximum);
    return output;
  }
  if (offline)
    throw new Error(
      "Offline runtime asset is not cached; no download or fallback",
    );
  const pending = `${output}.${randomUUID()}.part`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELEASE_LIMITS.timeoutMs);
  let file;
  let response;
  let created = false;
  try {
    let current = url;
    for (let redirects = 0; ; redirects++) {
      try {
        response = await request(current, {
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { "accept-encoding": "identity" },
          signal: controller.signal,
        });
      } catch {
        throw new Error("Release download failed (network or deadline)");
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      if (
        redirects >= RELEASE_LIMITS.redirects ||
        !response.headers.get("location")
      )
        throw new Error("Release redirect limit or missing location");
      current = redirectUrl(
        response.headers.get("location"),
        current,
        origin.release,
      );
    }
    if (response.status !== 200 || !response.body)
      throw new Error(`Release asset HTTP ${response.status}`);
    const length = response.headers.get("content-length");
    if (
      length !== null &&
      (!/^\d+$/.test(length) ||
        Number(length) > maximum ||
        (size !== undefined && Number(length) !== size))
    )
      throw new Error("Release Content-Length disagrees with reviewed bounds");
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding !== "identity")
      throw new Error("Encoded release transport is not allowed");
    file = await open(pending, "wx");
    created = true;
    const digest = createHash("sha256");
    let count = 0;
    for await (const chunk of response.body) {
      count += chunk.length;
      if (count > maximum || (size !== undefined && count > size))
        throw new Error("Release body exceeds reviewed size bound");
      digest.update(chunk);
      await file.writeFile(chunk);
    }
    if (
      digest.digest("hex") !== sha256 ||
      (size !== undefined && count !== size)
    )
      throw new Error("Release raw SHA-256/size mismatch");
    await file.sync();
    await file.close();
    file = null;
    // A hard link publishes complete bytes exclusively, without rename's
    // overwrite semantics. Unsupported filesystems fail closed.
    try {
      await link(pending, output);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await measure(output, { sha256, size }, maximum);
    }
    return output;
  } finally {
    clearTimeout(timer);
    controller.abort();
    await file?.close();
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {});
    if (created) await unlink(pending);
  }
}

async function installedPath(root, relative) {
  let current = root;
  const parts = relative.split("/");
  for (const [index, name] of parts.entries()) {
    current = path.join(current, name);
    const info = await lstat(current);
    if (
      info.isSymbolicLink() ||
      (index < parts.length - 1 && !info.isDirectory()) ||
      (await realpath(current)) !== current
    )
      throw new Error(
        "Installed path is a link or alias; existing files preserved",
      );
  }
  return current;
}

async function removeOwnedStage(stage, parent) {
  // Never recursively delete a computed path without checking the absolute
  // target, its dedicated mkdtemp basename, and its canonical owned parent.
  if (
    !path.isAbsolute(stage) ||
    !path.isAbsolute(parent) ||
    path.dirname(stage) !== parent ||
    !/^\.install-[A-Za-z0-9]+$/.test(path.basename(stage)) ||
    (await realpath(parent)) !== parent ||
    !(await lstat(stage)).isDirectory() ||
    (await realpath(stage)) !== stage
  )
    throw new Error(
      "Unsafe staging cleanup path; directory preserved for inspection",
    );
  await rm(stage, { recursive: true, force: true });
}

async function verifyInstallation(root, descriptor, manifest, sourceLock) {
  const artifactRoot = path.join(root, "artifacts");
  if (!(await lstat(root)).isDirectory() || (await realpath(root)) !== root)
    throw new Error("Installation root is not a real directory");
  for (const field of fields) {
    const pin = descriptor[field];
    const file = await installedPath(root, `artifacts/${pin.path}`);
    await measure(
      file,
      pin,
      RELEASE_LIMITS[field === "archive" ? "archive" : "metadata"],
    );
  }
  const sdk = await installedPath(
    root,
    `extracted/${descriptor.sdk.archiveRoot}`,
  );
  const checked = await preflightCustomRuntime({
    manifest,
    sourceLock,
    target: descriptor.target,
    artifactRoot,
    sdkRoot: sdk,
  });
  await inspectCustomRuntimeExports(
    path.join(
      sdk,
      manifest.artifacts.find((entry) => entry.target === descriptor.target)
        .runtime.library,
    ),
    descriptor.target,
  );
  return { artifactRoot, sdk, checked };
}

async function registerOrReuse(options, filesVerified) {
  const file = path.resolve(options.selectionFile);
  const info = await exists(file);
  if (info) {
    if (!info.isFile() || info.size > RELEASE_LIMITS.metadata)
      throw new Error("Local selection must be a bounded regular file");
    const bytes = await readFile(file, "utf8");
    const entry = validateLocalRuntimeSelection(JSON.parse(bytes)).targets[
      options.target
    ];
    if (
      entry &&
      entry.manifestSha256 === options.reviewedManifestSha256 &&
      entry.sourceLockSha256 === options.reviewedSourceLockSha256 &&
      ["manifest", "sourceLock", "sdk", "artifactRoot"].every((field) =>
        sameLocalPath(
          path.resolve(path.dirname(file), entry[field]),
          options[field],
        ),
      )
    ) {
      if ((await readFile(file, "utf8")) !== bytes)
        throw new Error("Local selection changed during verification");
      return {
        selectionFile: file,
        target: options.target,
        manifestSha256: entry.manifestSha256,
        sourceLockSha256: entry.sourceLockSha256,
        filesVerified,
        reusedSelection: true,
        sourceAuthenticity: "not-established-by-hashes",
        nativeAcceptance: "not-tested",
        runtimeCapability: "not-probed",
        productionReady: false,
      };
    }
  }
  return registerLocalRuntime(options);
}

export async function fetchRuntime(
  {
    descriptorUrl,
    descriptorSha256,
    target,
    cacheRoot = DEFAULT_CACHE_ROOT,
    selectionFile = LOCAL_RUNTIME_SELECTION_FILE,
    offline = false,
    replace = false,
    python = DEFAULT_PYTHON,
  },
  { request = globalThis.fetch } = {},
) {
  reviewedSha256(descriptorSha256);
  releaseAssetUrl(descriptorUrl);
  if (!TARGETS.includes(target))
    throw new Error("Supported runtime target is required");
  const cache = await directory(path.resolve(cacheRoot));
  const objects = await directory(cache, ["objects", target]);
  const descriptorFile = path.join(objects, descriptorSha256);
  await downloadPinned(
    {
      url: descriptorUrl,
      sha256: descriptorSha256,
      maximum: RELEASE_LIMITS.descriptor,
      output: descriptorFile,
      offline,
    },
    request,
  );
  const descriptor = validateRuntimeReleaseDescriptor(
    JSON.parse(await readFile(descriptorFile, "utf8")),
    { descriptorUrl, target },
  );
  const cached = {};
  // Fetch and bind small metadata before spending bandwidth on the archive.
  for (const field of ["sourceLock", "manifest", "receipt"]) {
    const pin = descriptor[field];
    cached[field] = await downloadPinned(
      {
        ...pin,
        maximum: RELEASE_LIMITS.metadata,
        output: path.join(objects, pin.sha256),
        offline,
      },
      request,
    );
  }
  const sourceLock = JSON.parse(await readFile(cached.sourceLock, "utf8"));
  const manifest = JSON.parse(await readFile(cached.manifest, "utf8"));
  bindRuntimeRelease(descriptor, manifest, sourceLock);
  cached.archive = await downloadPinned(
    {
      ...descriptor.archive,
      maximum: RELEASE_LIMITS.archive,
      output: path.join(objects, descriptor.archive.sha256),
      offline,
    },
    request,
  );
  const parent = await directory(cache, ["installed", target]);
  const installation = path.join(parent, descriptorSha256);
  const guardPath = `${installation}.lock`;
  const guard = await open(guardPath, "wx");
  let stage;
  try {
    if (!(await exists(installation))) {
      stage = await mkdtemp(path.join(parent, ".install-"));
      stage = await realpath(stage);
      for (const field of fields) {
        const dest = path.join(stage, "artifacts", descriptor[field].path);
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(cached[field], dest, constants.COPYFILE_EXCL);
        await measure(
          dest,
          descriptor[field],
          RELEASE_LIMITS[field === "archive" ? "archive" : "metadata"],
        );
      }
      await exec(
        python,
        [
          "-I",
          extractor,
          path.join(stage, "artifacts", descriptor.archive.path),
          path.join(stage, "extracted"),
          path.join(stage, "artifacts", descriptor.manifest.path),
          target,
          descriptor.sdk.archiveRoot,
          String(RELEASE_LIMITS.expanded),
          String(RELEASE_LIMITS.members),
        ],
        {
          windowsHide: true,
          timeout: RELEASE_LIMITS.timeoutMs,
          maxBuffer: 1024 * 1024,
        },
      );
      await verifyInstallation(stage, descriptor, manifest, sourceLock);
      // Do not overwrite even an empty pre-existing destination.
      if (await exists(installation))
        throw new Error("Installation appeared concurrently; preserved");
      await rename(stage, installation);
      stage = null;
    }
    const verified = await verifyInstallation(
      installation,
      descriptor,
      manifest,
      sourceLock,
    );
    const registration = await registerOrReuse(
      {
        selectionFile,
        target,
        manifest: path.join(verified.artifactRoot, descriptor.manifest.path),
        sourceLock: path.join(
          verified.artifactRoot,
          descriptor.sourceLock.path,
        ),
        sdk: verified.sdk,
        artifactRoot: verified.artifactRoot,
        reviewedManifestSha256: identitySha256(manifest),
        reviewedSourceLockSha256: identitySha256(sourceLock),
        replace,
      },
      verified.checked.filesVerified,
    );
    return {
      ...registration,
      descriptorSha256,
      installation,
      archiveSdkRelationship: "extracted-and-inventory-verified",
    };
  } finally {
    // Only this invocation's mkdtemp directory is removed. Previously installed
    // or cached bytes are never overwritten/deleted on a failed verification.
    try {
      if (stage) await removeOwnedStage(stage, parent);
    } finally {
      await guard.close();
      await unlink(guardPath);
    }
  }
}

export const HELP = `Fetch/install a reviewed patched CEF release and select it locally:
  node scripts/cef-runtime-fetch.mjs --descriptor-url HTTPS_RELEASE_ASSET
    --descriptor-sha256 REVIEWED_RAW_SHA256 --target RUST_TRIPLE
    [--cache-root DIR] [--selection FILE] [--offline] [--replace] [--python PYTHON]

The independently reviewed descriptor digest is mandatory; no live/default pins.
Only same-release GitHub assets and approved credential-free HTTPS redirects.
Cached bytes are rehashed in offline mode. Python >=3.12 is needed for a new
installation. Existing target replacement requires deliberate --replace.
No engine/source builds, stock fallback, engine execution, or sandbox changes.
Hashes do not establish source authenticity. Native acceptance: not-tested.
`;

export function parseArguments(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]))
    return { help: true };
  const names = {
    "descriptor-url": "descriptorUrl",
    "descriptor-sha256": "descriptorSha256",
    target: "target",
    "cache-root": "cacheRoot",
    selection: "selectionFile",
    python: "python",
    offline: "offline",
    replace: "replace",
  };
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(argv[i]);
    if (!match || !Object.hasOwn(names, match[1]))
      throw new Error("Unknown runtime-fetch option");
    const key = names[match[1]];
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate --${match[1]}`);
    if (["offline", "replace"].includes(key)) {
      if (match[2] !== undefined)
        throw new Error(`--${match[1]} takes no value`);
      result[key] = true;
    } else {
      result[key] = match[2] ?? argv[++i];
      if (!result[key] || result[key].startsWith("--"))
        throw new Error(`--${match[1]} requires a value`);
    }
  }
  reviewedSha256(result.descriptorSha256);
  releaseAssetUrl(result.descriptorUrl);
  if (!TARGETS.includes(result.target))
    throw new Error("--target is required and must be supported");
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  return options.help ? HELP : fetchRuntime(options);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((value) =>
      process.stdout.write(
        typeof value === "string"
          ? value
          : `${JSON.stringify(value, null, 2)}\n`,
      ),
    )
    .catch((error) => {
      console.error(
        `[cef-runtime-fetch] ${error.message}; no stock fallback or source build`,
      );
      process.exitCode = 1;
    });
}
