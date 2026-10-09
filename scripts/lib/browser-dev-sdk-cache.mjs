// Immutable development SDK inputs. Keep this recipe separate from app staging:
// launcher/resource edits must not invalidate CEF_PATH and native compilation.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CEF_PIN } from "../browser-runtime-package.mjs";
import {
  identitySha256,
  prepareCustomRuntime,
  verifyPreparedCustomRuntime,
} from "./browser-custom-runtime.mjs";

const recipeFile = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(recipeFile), "../..");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });

export async function digestFile(file, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Publish a complete verified directory, never update an existing cache in
 * place. Racing publishers can only lose to a nonempty, verified winner. A
 * corrupt/partial entry is an error, not permission to replace a live SDK. */
export async function immutableDevCache({
  cacheRoot,
  kind,
  key,
  create,
  verify,
}) {
  if (!/^[a-z]+$/.test(kind) || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("Invalid dev cache identity");
  await mkdir(cacheRoot, { recursive: true });
  if (!(await lstat(cacheRoot)).isDirectory())
    throw new Error("Dev cache root must be a real directory");
  const parent = await realpath(cacheRoot);
  // Keep MSBuild wrapper paths short; the complete digest is checked on reuse.
  const destination = path.join(parent, `${kind}-${key.slice(0, 24)}`);
  const check = async (directory) => {
    if (!(await lstat(directory)).isDirectory())
      throw new Error("Dev cache entry must be a real directory");
    const identity = path.join(directory, "cache-key.json");
    if (!(await lstat(identity)).isFile() || (await json(identity)).key !== key)
      throw new Error(
        "Dev cache identity changed; refusing reuse or replacement",
      );
    await verify(directory);
    return directory;
  };
  const present = async () => {
    try {
      await lstat(destination);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };
  if (await present()) return check(destination);
  const temporary = await mkdtemp(path.join(parent, `.${kind}-`));
  let published = false;
  try {
    await create(temporary);
    await save(path.join(temporary, "cache-key.json"), { key });
    await check(temporary);
    if (await present()) return await check(destination);
    try {
      await rename(temporary, destination);
      published = true;
    } catch (error) {
      if (!(
        ["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(error.code) &&
        (await present())
      ))
        throw error;
    }
    return await check(destination);
  } finally {
    // Only our mkdtemp sibling is removed; published/live entries are untouched.
    if (!published) {
      const resolved = await realpath(temporary);
      if (
        !(await lstat(temporary)).isDirectory() ||
        path.dirname(resolved) !== parent ||
        resolved !== temporary ||
        !path.basename(resolved).startsWith(`.${kind}-`)
      )
        throw new Error(
          "Refusing dev cache cleanup outside its temporary sibling",
        );
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

export async function prepareDevSdkCache(
  { inputs, preflight, cacheRoot },
  {
    prepareSdk = prepareCustomRuntime,
    verifySdk = verifyPreparedCustomRuntime,
  } = {},
) {
  const artifact = inputs.manifest.artifacts.find(
    (item) => item.target === inputs.target,
  );
  // Hash the preparation implementation as well as all reviewed input pins.
  const recipe = await Promise.all([
    digestFile(recipeFile),
    digestFile(path.join(repo, "scripts/lib/browser-custom-runtime.mjs")),
    digestFile(path.join(repo, "scripts/browser-runtime-package.mjs")),
  ]);
  const key = identitySha256({
    schema: 1,
    target: inputs.target,
    manifest: inputs.manifest,
    sourceLock: inputs.sourceLock,
    recipe,
  });
  // Derive the prepared inventory from the CURRENT reviewed source, never a
  // self-asserted receipt beside cached binaries. archive.json is deterministic.
  const metadata = JSON.stringify({
    type: "minimal",
    name: `cef_binary_${CEF_PIN.version}_sorng-custom-${artifact.archive.sha256}.tar.bz2`,
    sha1: await digestFile(preflight.archivePath, "sha1"),
  });
  const customRuntime = {
    manifest: inputs.manifest,
    sourceLock: inputs.sourceLock,
    artifactRoot: await realpath(inputs.artifactRoot),
    sourceSdk: await realpath(inputs.sdkRoot),
    sdkFiles: [
      ...artifact.sdkFiles
        .filter((entry) => entry.path !== "archive.json")
        .map((entry) => ({
          ...entry,
          path: entry.path.replace(/^(Release|Resources)\//, ""),
        })),
      {
        path: "archive.json",
        type: "file",
        size: Buffer.byteLength(metadata),
        sha256: createHash("sha256").update(metadata).digest("hex"),
      },
    ],
    sourceLockSha256: preflight.sourceLockSha256,
    archiveSdkRelationship: preflight.archiveSdkRelationship,
  };
  const result = {
    archive: preflight.archivePath,
    customRuntime,
    target: inputs.target,
  };
  const directory = await immutableDevCache({
    cacheRoot,
    kind: "sdk",
    key,
    create: async (temporary) => {
      const prepared = await prepareSdk({
        ...inputs,
        output: path.join(temporary, "sdk"),
      });
      if (
        identitySha256(prepared.customRuntime) !== identitySha256(customRuntime)
      )
        throw new Error("Dev SDK preparation contract changed");
    },
    verify: async (entry) => {
      const sdk = path.join(entry, "sdk");
      if (!(await lstat(sdk)).isDirectory())
        throw new Error("Dev SDK must be a real directory");
      // Includes fresh source/archive provenance, every prepared byte and V2
      // exports on EVERY hit, and again after atomic publication.
      await verifySdk({ ...result, sdk });
    },
  });
  return { ...result, sdk: path.join(directory, "sdk") };
}
