import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  readlink,
  lstat,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  backUpPublished,
  bundleConfiguration,
  cargoPlan,
  copyTreeExclusive,
  hostTarget,
  linuxLauncher,
  locateArchive,
  mergeConfig,
  parseArguments,
  immutableDevCache,
  prepareDevSdkCache,
  prepareDevRunnerCache,
  reuseDevInputs,
  stableDevConfiguration,
} from "../../scripts/browser-app-build.mjs";
import {
  TARGETS,
  CEF_PIN,
  packageManifest,
} from "../../scripts/browser-runtime-package.mjs";
import { identitySha256 } from "../../scripts/lib/browser-custom-runtime.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function devCacheFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-dev-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheRoot = path.join(root, "cache");
  const sdkRoot = path.join(root, "source-sdk");
  const artifactRoot = path.join(root, "artifacts");
  await mkdir(path.join(sdkRoot, "Release"), { recursive: true });
  await mkdir(path.join(sdkRoot, "include"));
  await mkdir(artifactRoot);
  await writeFile(path.join(sdkRoot, "Release/libcef.dll"), "binary A");
  await writeFile(path.join(sdkRoot, "include/cef_api_versions.h"), "header A");
  const archivePath = path.join(artifactRoot, "runtime.tar.bz2");
  await writeFile(archivePath, "archive A");
  const sourceLock = { fixture: "not a production source lock" };
  const inputs = {
    sdkRoot,
    artifactRoot,
    sourceLock,
    target: "x86_64-pc-windows-msvc",
  };
  const preflight = {
    archivePath,
    sourceLockSha256: identitySha256(sourceLock),
    archiveSdkRelationship: "synthetic-fixture",
  };
  const refresh = async () => {
    const pin = async (root, relative) => {
      const bytes = await readFile(path.join(root, relative));
      return { path: relative, size: bytes.length, sha256: sha256(bytes) };
    };
    inputs.manifest = {
      artifacts: [
        {
          target: inputs.target,
          archive: await pin(artifactRoot, "runtime.tar.bz2"),
          sdkFiles: await Promise.all(
            ["Release/libcef.dll", "include/cef_api_versions.h"].map(
              async (name) => ({ ...(await pin(sdkRoot, name)), type: "file" }),
            ),
          ),
        },
      ],
    };
  };
  await refresh();
  let preparations = 0;
  let verifications = 0;
  // Synthetic I/O collaborators isolate cache policy, never execute CEF/Rust.
  // Production defaults remain the full provenance/export validators.
  const dependencies = {
    prepareSdk: async ({ output }) => {
      preparations++;
      const artifact = inputs.manifest.artifacts[0];
      const metadata = JSON.stringify({
        type: "minimal",
        name: `cef_binary_${CEF_PIN.version}_sorng-custom-${artifact.archive.sha256}.tar.bz2`,
        sha1: createHash("sha1")
          .update(await readFile(archivePath))
          .digest("hex"),
      });
      const sdkFiles = [];
      for (const entry of artifact.sdkFiles) {
        const normalized = entry.path.replace(/^Release\//, "");
        const destination = path.join(output, normalized);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(
          destination,
          await readFile(path.join(sdkRoot, entry.path)),
          { flag: "wx" },
        );
        sdkFiles.push({ ...entry, path: normalized });
      }
      await writeFile(path.join(output, "archive.json"), metadata, {
        flag: "wx",
      });
      sdkFiles.push({
        path: "archive.json",
        type: "file",
        size: Buffer.byteLength(metadata),
        sha256: sha256(metadata),
      });
      return {
        sdk: output,
        customRuntime: {
          manifest: inputs.manifest,
          sourceLock,
          artifactRoot: await realpath(artifactRoot),
          sourceSdk: await realpath(sdkRoot),
          sdkFiles,
          sourceLockSha256: preflight.sourceLockSha256,
          archiveSdkRelationship: preflight.archiveSdkRelationship,
        },
      };
    },
    verifySdk: async ({ sdk, customRuntime }) => {
      verifications++;
      const artifact = inputs.manifest.artifacts[0];
      assert.equal(
        sha256(await readFile(archivePath)),
        artifact.archive.sha256,
        "source archive changed",
      );
      for (const entry of artifact.sdkFiles)
        assert.equal(
          sha256(await readFile(path.join(sdkRoot, entry.path))),
          entry.sha256,
          "source SDK changed",
        );
      for (const entry of customRuntime.sdkFiles)
        assert.equal(
          sha256(await readFile(path.join(sdk, entry.path))),
          entry.sha256,
          "prepared SDK changed",
        );
      // This also proves the cache cannot invent its own trusted manifest.
      assert.deepEqual(customRuntime.manifest, inputs.manifest);
    },
  };
  const prepare = () =>
    prepareDevSdkCache({ inputs, preflight, cacheRoot }, dependencies);
  return {
    root,
    cacheRoot,
    sdkRoot,
    archivePath,
    inputs,
    preflight,
    refresh,
    dependencies,
    prepare,
    counts: () => ({ preparations, verifications }),
  };
}

test("default dev alone reuses inputs; custom output and build/bundle stay private", () => {
  assert.equal(reuseDevInputs({ mode: "dev" }), true);
  for (const mode of ["dev", "build"]) {
    assert.equal(reuseDevInputs({ mode, output: "custom-output" }), false);
    assert.equal(
      reuseDevInputs(
        parseFixtureArguments([mode, "--cef-output=custom-output"], {}),
      ),
      false,
    );
    assert.equal(
      reuseDevInputs(
        parseFixtureArguments([mode], { SORNG_CEF_OUTPUT: "env-output" }),
      ),
      false,
    );
  }
  assert.equal(reuseDevInputs({ mode: "build" }), false);
});

test("identical dev launches retain CEF_PATH, runner/config bytes and SDK mtimes without recompiling", async (t) => {
  const f = await devCacheFixture(t);
  const source = path.join(f.root, "runner.rs");
  await writeFile(source, "synthetic runner source");
  let builds = 0;
  const build = async (_command, args) => {
    builds++;
    await writeFile(args.at(-1), "synthetic runner binary");
  };
  const runnerOptions = {
    cacheRoot: f.cacheRoot,
    source,
    compilerIdentity: "rustc fixture 1",
    env: {},
    platform: "win32",
    arch: "x64",
  };
  const first = await f.prepare();
  const before = await lstat(path.join(first.sdk, "libcef.dll"));
  const runner = await prepareDevRunnerCache(runnerOptions, build);
  const second = await f.prepare();
  const secondRunner = await prepareDevRunnerCache(runnerOptions, build);
  const config = {
    identifier: "isolated.profile",
    build: { devUrl: "http://localhost:3001" },
    app: { security: { csp: "strict", capabilities: ["unchanged"] } },
    bundle: { resources: { "native/": "native/" } },
  };
  assert.deepEqual(
    { CEF_PATH: first.sdk, config: stableDevConfiguration(config, runner) },
    {
      CEF_PATH: second.sdk,
      config: stableDevConfiguration(config, secondRunner),
    },
  );
  assert.equal(
    (await lstat(path.join(second.sdk, "libcef.dll"))).mtimeMs,
    before.mtimeMs,
  );
  assert.equal(f.counts().preparations, 1);
  assert.ok(
    f.counts().verifications >= 3,
    "verification must run on creation, publication and reuse",
  );
  assert.equal(builds, 1);
  assert.deepEqual(stableDevConfiguration(config, runner).app, config.app);
});

for (const changed of [
  "Release/libcef.dll",
  "include/cef_api_versions.h",
  "archive",
]) {
  test(`changed reviewed ${changed} gets a new SDK without overwriting the previous one`, async (t) => {
    const f = await devCacheFixture(t);
    const first = await f.prepare();
    const original = await readFile(path.join(first.sdk, "libcef.dll"));
    const file =
      changed === "archive" ? f.archivePath : path.join(f.sdkRoot, changed);
    const bytes = await readFile(file, "utf8");
    await writeFile(file, bytes.replace(" A", " B")); // same size, different content
    await f.refresh(); // stands for the newly reviewed and preflighted manifest
    const second = await f.prepare();
    assert.notEqual(second.sdk, first.sdk);
    assert.deepEqual(
      await readFile(path.join(first.sdk, "libcef.dll")),
      original,
    );
    assert.equal(f.counts().preparations, 2);
  });
}

test("SDK recipe changes invalidate reuse, but unrelated driver edits retain the verified SDK", async (t) => {
  const f = await devCacheFixture(t);
  // A miniature script checkout exercises the actual recipe hashes without
  // changing the shared working tree or any live cache/target directory.
  const scripts = path.join(f.root, "checkout", "scripts");
  await mkdir(path.join(scripts, "lib"), { recursive: true });
  const recipes = [
    "lib/browser-dev-sdk-cache.mjs",
    "lib/browser-custom-runtime.mjs",
    "browser-runtime-package.mjs",
  ];
  for (const relative of recipes)
    await copyFile(
      new URL(`../../scripts/${relative}`, import.meta.url),
      path.join(scripts, relative),
    );
  const launcher = path.join(scripts, "browser-app-build.mjs");
  await writeFile(launcher, "// original launcher\n");
  const { prepareDevSdkCache: isolatedPrepare } = await import(
    pathToFileURL(path.join(scripts, recipes[0])).href
  );
  const prepare = () =>
    isolatedPrepare(
      { inputs: f.inputs, preflight: f.preflight, cacheRoot: f.cacheRoot },
      f.dependencies,
    );
  const first = await prepare();
  const original = await lstat(path.join(first.sdk, "libcef.dll"));
  const checks = f.counts().verifications;
  await writeFile(launcher, "// changed launcher and resource staging\n");
  assert.equal((await prepare()).sdk, first.sdk);
  assert.equal(f.counts().preparations, 1);
  assert.equal(
    f.counts().verifications,
    checks + 1,
    "a reused SDK still undergoes fresh validation",
  );
  assert.equal(
    (await lstat(path.join(first.sdk, "libcef.dll"))).mtimeMs,
    original.mtimeMs,
  );
  let prior = first.sdk;
  for (const relative of recipes) {
    const file = path.join(scripts, relative);
    await writeFile(
      file,
      `${await readFile(file, "utf8")}\n// changed preparation recipe\n`,
    );
    const current = (await prepare()).sdk;
    assert.notEqual(current, prior, `${relative} must invalidate the cache`);
    prior = current;
  }
  assert.equal(f.counts().preparations, 4);
  assert.equal(
    await readFile(path.join(first.sdk, "libcef.dll"), "utf8"),
    "binary A",
  );
});

test("source drift and corrupt cached SDK fail closed without repair", async (t) => {
  const f = await devCacheFixture(t);
  const first = await f.prepare();
  await writeFile(path.join(first.sdk, "libcef.dll"), "corrupt cached bytes");
  await assert.rejects(f.prepare(), /prepared SDK changed/);
  assert.equal(f.counts().preparations, 1);
  assert.equal(
    await readFile(path.join(first.sdk, "libcef.dll"), "utf8"),
    "corrupt cached bytes",
  );
  await writeFile(
    path.join(f.sdkRoot, "Release/libcef.dll"),
    "unreviewed source",
  );
  await assert.rejects(f.prepare(), /source SDK changed/);
});

test("cache reuse cannot substitute a symlink or partial entry", async (t) => {
  const f = await devCacheFixture(t);
  const first = await f.prepare();
  const entry = path.dirname(first.sdk);
  await rm(path.join(entry, "cache-key.json"));
  await assert.rejects(f.prepare(), { code: "ENOENT" });
  assert.equal(f.counts().preparations, 1);
  const otherCache = path.join(f.root, "junction-cache");
  await symlink(
    f.cacheRoot,
    otherCache,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    prepareDevSdkCache({ ...f, cacheRoot: otherCache }, f.dependencies),
    /real directory/,
  );
});

test("concurrent publication exposes only complete entries and never overwrites the winner", async (t) => {
  const f = await devCacheFixture(t);
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const created = [];
  const create = async (temporary) => {
    created.push(temporary);
    await writeFile(path.join(temporary, "payload"), `candidate ${++arrived}`);
    if (arrived === 2) release();
    await gate;
  };
  let checked = 0;
  const verify = async (entry) => {
    assert.match(
      await readFile(path.join(entry, "payload"), "utf8"),
      /^candidate [12]$/,
    );
    checked++;
  };
  const options = {
    cacheRoot: f.cacheRoot,
    kind: "fixture",
    key: sha256("same key"),
    create,
    verify,
  };
  const [first, second] = await Promise.all([
    immutableDevCache(options),
    immutableDevCache(options),
  ]);
  assert.equal(first, second);
  const bytes = await readFile(path.join(first, "payload"));
  const info = await lstat(path.join(first, "payload"));
  await immutableDevCache({
    ...options,
    create: () => assert.fail("must reuse the winner"),
  });
  assert.deepEqual(await readFile(path.join(first, "payload")), bytes);
  assert.equal(
    (await lstat(path.join(first, "payload"))).mtimeMs,
    info.mtimeMs,
  );
  assert.ok(checked >= 5);
  assert.equal(created.length, 2);
  assert.deepEqual(await readdir(f.cacheRoot), [path.basename(first)]);
});

test("failed preparation is not published and cannot replace a prior live entry", async (t) => {
  const f = await devCacheFixture(t);
  const first = await f.prepare();
  await writeFile(f.archivePath, "new archive");
  await f.refresh();
  await assert.rejects(
    prepareDevSdkCache(f, {
      ...f.dependencies,
      prepareSdk: async ({ output }) => {
        await mkdir(output);
        await writeFile(path.join(output, "partial"), "incomplete");
        throw new Error("preparation failed");
      },
    }),
    /preparation failed/,
  );
  assert.deepEqual(await readdir(f.cacheRoot), [
    path.basename(path.dirname(first.sdk)),
  ]);
});

test("runner source/toolchain changes invalidate while cache corruption fails closed", async (t) => {
  const f = await devCacheFixture(t);
  const source = path.join(f.root, "runner.rs");
  await writeFile(source, "runner source A");
  const options = {
    cacheRoot: f.cacheRoot,
    source,
    compilerIdentity: "compiler A",
    env: {},
    platform: "win32",
    arch: "x64",
  };
  let builds = 0;
  const build = async (_command, args) => {
    builds++;
    await writeFile(args.at(-1), `runner ${builds}`);
  };
  const first = await prepareDevRunnerCache(options, build);
  const toolchain = await prepareDevRunnerCache(
    { ...options, compilerIdentity: "compiler B" },
    build,
  );
  await writeFile(source, "runner source B");
  const changed = await prepareDevRunnerCache(options, build);
  assert.equal(new Set([first, toolchain, changed]).size, 3);
  assert.equal(await readFile(first, "utf8"), "runner 1");
  await writeFile(changed, "corrupt runner");
  await assert.rejects(
    prepareDevRunnerCache(options, build),
    /integrity changed/,
  );
  assert.equal(builds, 3);
});

test("semantic config ordering is stable; profile, origin, security and resource changes are retained", () => {
  const config = {
    identifier: "profile A",
    build: { devUrl: "http://localhost:3001" },
    app: { security: { csp: "strict", capabilities: ["one", "two"] } },
    bundle: { resources: { source: "destination" } },
  };
  const canonical = JSON.stringify(
    stableDevConfiguration(config, "stable-runner"),
  );
  assert.equal(
    JSON.stringify(
      stableDevConfiguration(
        Object.fromEntries(Object.entries(config).reverse()),
        "stable-runner",
      ),
    ),
    canonical,
  );
  for (const change of [
    (c) => {
      c.identifier = "profile B";
    },
    (c) => {
      c.build.devUrl = "http://localhost:3002";
    },
    (c) => {
      c.app.security.csp = "different";
    },
    (c) => {
      c.app.security.capabilities.reverse();
    },
    (c) => {
      c.bundle.resources.source = "new-destination";
    },
  ]) {
    const updated = structuredClone(config);
    change(updated);
    assert.notEqual(
      JSON.stringify(stableDevConfiguration(updated, "stable-runner")),
      canonical,
    );
  }
  assert.equal(config.build.runner, undefined);
});

// These argument/packaging tests deliberately use official SDK fixtures. Normal
// no-env patched selection is tested separately, not silently defaulted here.
const parseFixtureArguments = (args, env = {}) =>
  parseArguments(
    [args[0], "--cef-runtime-kind=official", ...args.slice(1)],
    env,
  );

test("managed dev arguments retain frontend config, HMR and explicit features", () => {
  const override = JSON.stringify({
    identifier: "com.sortofremote.ng.driver",
    build: { devUrl: "http://localhost:3105" },
  });
  const args = parseFixtureArguments(
    [
      "dev",
      "-c",
      override,
      "--features",
      "lean",
      "--no-watch",
      "--",
      "--jobs",
      "3",
      "--",
      "--sorng-profile-probe",
    ],
    {},
  );
  assert.deepEqual(args.configs, [override]);
  assert.deepEqual(args.features, ["lean", "native-browser"]);
  assert.deepEqual(args.tauriArgs, ["--no-watch"]);
  assert.deepEqual(args.cargoArgs, [
    "--no-default-features",
    "--jobs",
    "3",
    "--",
    "--sorng-profile-probe",
  ]);
  assert.equal(args.download, true);
});

test("configured custom runtime is mandatory for build and dev across all six targets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-app-arguments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // A developer's registered runtime must not supply or conflict with fixture inputs.
  const selectionFile = path.join(root, "cef-local-selection.json");
  const parseCustomArguments = (args, env) =>
    parseArguments(args, env, { selectionFile });
  const env = {
    SORNG_CEF_CUSTOM_MANIFEST: "custom.json",
    SORNG_CEF_SOURCE_LOCK: "source.json",
    SORNG_CEF_SDK: "sdk",
  };
  for (const target of TARGETS)
    for (const mode of ["dev", "build"]) {
      const options = parseCustomArguments([mode, "--target", target], env);
      assert.equal(options.runtimeKind, "custom");
      assert.equal(options.localRuntimeSelection, undefined);
      assert.equal(options.download, false);
      assert.equal(options.sdk, "sdk");
      assert.equal(options.customManifest, "custom.json");
      assert.equal(options.sourceLock, "source.json");
      assert.equal(
        options.artifactRoot,
        path.dirname(path.resolve("custom.json")),
      );
      assert.ok(options.features.includes("native-browser"));
    }
  assert.throws(
    () => parseCustomArguments(["build", "--cef-download"], env),
    /acquisition/,
  );
  assert.throws(
    () => parseCustomArguments(["build", "--cef-runtime-kind=official"], env),
    /conflict/,
  );
  assert.throws(
    () =>
      parseCustomArguments(
        ["build", "--features", "rdp", "--", "--no-default-features"],
        env,
      ),
    /browser-disabled/,
  );
  const cli = parseCustomArguments(
    [
      "dev",
      "--cef-runtime-kind=custom",
      "--cef-custom-manifest=custom.json",
      "--cef-source-lock=source.json",
      "--cef-sdk=sdk",
      "--cef-artifact-root=artifacts",
      "--cef-offline",
    ],
    {},
  );
  assert.equal(cli.runtimeKind, "custom");
  assert.equal(cli.artifactRoot, "artifacts");
  assert.equal(cli.offline, true);
  assert.deepEqual(cli.tauriArgs, []);
  await assert.rejects(lstat(selectionFile), { code: "ENOENT" });
});

test("normal Windows build selects one dynamic family without default static overlap", () => {
  const result = parseFixtureArguments(
    ["build", "--target", "x86_64-pc-windows-msvc"],
    {},
  );
  assert.deepEqual(result.features, ["full-windows-dynamic", "native-browser"]);
  assert.ok(result.cargoArgs.includes("--no-default-features"));
  const prepared = parseFixtureArguments(
    ["build", "--features", "full-windows-dynamic"],
    { SORNG_CEF_NATIVE_PREPARED: "1" },
  );
  assert.equal(prepared.nativePrepared, true);
});

test("raw Cargo cache stays short, separate from published output and overridable", () => {
  for (const target of TARGETS) {
    const result = parseFixtureArguments(["dev", "--target", target], {});
    assert.equal(
      result.cargoTarget,
      path.resolve(import.meta.dirname, "../../.cache/cef-target"),
    );
    assert.notEqual(
      result.cargoTarget,
      path.resolve(import.meta.dirname, "../../src-tauri/target"),
    );
    assert.ok(!result.cargoTarget.includes(target));
    const commands = cargoPlan(["build"], result);
    assert.ok(commands.application.includes(result.cargoTarget));
  }
  const environment = { SORNG_CEF_CARGO_TARGET_DIR: "custom-cache" };
  assert.equal(
    parseFixtureArguments(["build"], environment).cargoTarget,
    "custom-cache",
  );
  assert.equal(
    parseFixtureArguments(
      ["build", "--cef-cargo-target-dir", "cli-cache"],
      environment,
    ).cargoTarget,
    "cli-cache",
  );
});

test("equals forms and Cargo-side features select the same target/linkage", () => {
  const result = parseFixtureArguments(
    [
      "build",
      "--target=aarch64-apple-darwin",
      '--config={"identifier":"isolated.test"}',
      "--features=native-browser",
      "--bundles=app",
      "--",
      "--features=full-unix-dynamic",
      "--no-default-features",
    ],
    {},
  );
  assert.equal(result.target, "aarch64-apple-darwin");
  assert.deepEqual(result.features, ["native-browser", "full-unix-dynamic"]);
  assert.deepEqual(result.tauriArgs, ["--bundles", "app"]);
  assert.deepEqual(result.cargoArgs, ["--no-default-features"]);
  assert.equal(result.configs[0], '{"identifier":"isolated.test"}');
  assert.throws(
    () => parseArguments(["build", "--", "--features"], {}),
    /feature list/,
  );
  assert.throws(
    () => parseArguments(["build", "--", "--target=other"], {}),
    /driver/,
  );
  assert.throws(
    () => parseArguments(["build", "--", "--all-features"], {}),
    /incompatible/,
  );
});

test("explicit reduced no-default builds stay non-CEF without affecting normal builds", () => {
  const lean = parseArguments(
    [
      "dev",
      "--features=lean",
      "--",
      "--no-default-features",
      "--",
      "--features=full",
    ],
    {},
  );
  assert.equal(lean.cef, false);
  assert.deepEqual(lean.features, ["lean"]);
  assert.equal(
    parseFixtureArguments(
      ["build", "--features=full", "--", "--no-default-features"],
      {},
    ).cef,
    true,
  );
  assert.equal(
    parseFixtureArguments(
      ["build", "--features=native-browser", "--", "--no-default-features"],
      {},
    ).cef,
    true,
  );
});

test("publication backs up only its exact file and refuses an outside target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-publish-"));
  const publicTarget = path.join(root, "target");
  await mkdir(publicTarget);
  const artifact = path.join(publicTarget, "app.exe");
  const neighbor = path.join(publicTarget, "unrelated.dll");
  await writeFile(artifact, "previous executable");
  await writeFile(neighbor, "unrelated");
  await backUpPublished(artifact, { root, publicTarget });
  assert.equal(
    await readFile(path.join(root, "previous-output/app.exe"), "utf8"),
    "previous executable",
  );
  assert.equal(await readFile(neighbor, "utf8"), "unrelated");
  await assert.rejects(
    backUpPublished(path.join(root, "outside"), { root, publicTarget }),
    /escapes/,
  );
});

test("dev payload merges pre-created directories without overwriting real files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-dev-copy-"));
  const payload = path.join(root, "payload");
  const output = path.join(root, "target", "debug");
  await mkdir(path.join(payload, "locales"), { recursive: true });
  await writeFile(path.join(payload, "app.dll"), "compiled fixture");
  await writeFile(path.join(payload, "locales", "en-US.pak"), "CEF locale");
  await mkdir(output, { recursive: true });
  await copyTreeExclusive(payload, output);
  assert.equal(
    await readFile(path.join(output, "app.dll"), "utf8"),
    "compiled fixture",
  );
  const appResources = path.join(root, "app-locales");
  await mkdir(appResources);
  await writeFile(path.join(appResources, "en.json"), "app locale");
  await copyTreeExclusive(appResources, path.join(output, "locales"));
  assert.equal(
    await readFile(path.join(output, "locales", "en.json"), "utf8"),
    "app locale",
  );
  assert.equal(
    await readFile(path.join(output, "locales", "en-US.pak"), "utf8"),
    "CEF locale",
  );
  await writeFile(path.join(appResources, "en-US.pak"), "must not overwrite");
  await assert.rejects(
    copyTreeExclusive(appResources, path.join(output, "locales")),
    { code: "ERR_FS_CP_EEXIST" },
  );
  assert.equal(
    await readFile(path.join(output, "locales", "en-US.pak"), "utf8"),
    "CEF locale",
  );
  await writeFile(path.join(payload, "app.dll"), "must not overwrite");
  await assert.rejects(copyTreeExclusive(payload, output), {
    code: "ERR_FS_CP_EEXIST",
  });
  assert.equal(
    await readFile(path.join(output, "app.dll"), "utf8"),
    "compiled fixture",
  );
  const occupied = path.join(root, "occupied");
  await writeFile(occupied, "existing file");
  await assert.rejects(copyTreeExclusive(payload, occupied), {
    code: "EEXIST",
  });
  assert.equal(await readFile(occupied, "utf8"), "existing file");
});

test("exclusive tree merge rejects same and descendant destinations before mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-copy-containment-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "original"), "preserved");
  const containmentError = /must not be the source or its descendant/;
  await assert.rejects(copyTreeExclusive(source, source), containmentError);
  const descendant = path.join(source, "new", "nested");
  await assert.rejects(copyTreeExclusive(source, descendant), containmentError);
  await assert.rejects(lstat(path.join(source, "new")), { code: "ENOENT" });
  const existing = path.join(source, "existing");
  await mkdir(existing);
  await assert.rejects(copyTreeExclusive(source, existing), containmentError);
  const alias = path.join(root, "alias");
  await symlink(
    source,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(copyTreeExclusive(source, alias), containmentError);
  await assert.rejects(
    copyTreeExclusive(source, path.join(alias, "new", "nested")),
    containmentError,
  );
  await assert.rejects(lstat(path.join(source, "new")), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(source, "original"), "utf8"),
    "preserved",
  );
  // A common string prefix is not directory containment.
  const sibling = path.join(root, "source-sibling");
  await copyTreeExclusive(source, sibling);
  assert.equal(
    await readFile(path.join(sibling, "original"), "utf8"),
    "preserved",
  );
});

test("exclusive tree merge refuses file/directory collisions and destination junctions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-copy-collision-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  const outside = path.join(root, "outside");
  await mkdir(source);
  await mkdir(destination);
  await mkdir(outside);
  await writeFile(path.join(source, "leaf"), "new file");
  await mkdir(path.join(destination, "leaf"));
  await assert.rejects(copyTreeExclusive(source, destination));
  assert.ok((await lstat(path.join(destination, "leaf"))).isDirectory());
  await writeFile(path.join(outside, "leaf"), "untouched");
  const linkedDestination = path.join(root, "linked-destination");
  await symlink(
    outside,
    linkedDestination,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(copyTreeExclusive(source, linkedDestination), {
    code: "EEXIST",
  });
  assert.equal(await readFile(path.join(outside, "leaf"), "utf8"), "untouched");
  assert.ok((await lstat(linkedDestination)).isSymbolicLink());
  const nestedSource = path.join(root, "nested-source");
  const nestedDestination = path.join(root, "nested-destination");
  await mkdir(path.join(nestedSource, "locales"), { recursive: true });
  await writeFile(
    path.join(nestedSource, "locales", "leaf"),
    "must not follow link",
  );
  await mkdir(nestedDestination);
  await symlink(
    outside,
    path.join(nestedDestination, "locales"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(copyTreeExclusive(nestedSource, nestedDestination), {
    code: "EEXIST",
  });
  assert.equal(await readFile(path.join(outside, "leaf"), "utf8"), "untouched");
});

test(
  "exclusive tree merge preserves relative source symlinks",
  {
    skip:
      process.platform === "win32"
        ? "creating file symlinks requires Windows privilege"
        : false,
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cef-copy-symlink-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await mkdir(path.join(source, "Versions", "A"), { recursive: true });
    await writeFile(
      path.join(source, "Versions", "A", "binary"),
      "framework fixture",
    );
    await symlink("A", path.join(source, "Versions", "Current"));
    await symlink("Versions/Current/binary", path.join(source, "binary"));
    await copyTreeExclusive(source, destination);
    assert.equal(
      await readlink(path.join(destination, "Versions", "Current")),
      "A",
    );
    assert.equal(
      await readlink(path.join(destination, "binary")),
      "Versions/Current/binary",
    );
    assert.equal(
      await readFile(path.join(destination, "binary"), "utf8"),
      "framework fixture",
    );
    await assert.rejects(
      copyTreeExclusive(
        path.join(source, "binary"),
        path.join(destination, "binary"),
      ),
    );
  },
);

test("six Cargo plans compile the real app and sandbox helper, never cargo run", () => {
  for (const target of TARGETS) {
    const plan = {
      target,
      platform: packageManifest(target).platform,
      cargoTarget: path.resolve(".artifacts/test/compile/target"),
      offline: true,
    };
    const result = cargoPlan(
      [
        "run",
        "--features",
        "native-browser",
        "--no-default-features",
        "--target",
        target,
        "--color",
        "always",
        "--",
        "--sorng-profile-probe",
      ],
      plan,
    );
    assert.deepEqual(result.runArgs, ["--sorng-profile-probe"]);
    assert.equal(result.profile, "debug");
    assert.ok(result.application.includes("--offline"));
    assert.ok(result.application.includes("--locked"));
    assert.equal(result.application.filter((x) => x === "--target").length, 1);
    assert.ok(!result.application.includes("run"));
    assert.ok(!result.application.includes("--sorng-profile-probe"));
    if (plan.platform === "windows") {
      assert.equal(result.application[0], "rustc");
      assert.ok(result.application.includes("cdylib"));
      assert.ok(result.application.includes("--lib"));
    } else {
      assert.equal(result.application[0], "build");
      assert.ok(result.application.includes("app"));
      assert.ok(result.helper.includes("sorng-cef-helper"));
    }
  }
});

test("release profile and compile/publication paths remain distinct", () => {
  const plan = {
    target: hostTarget(),
    platform: "windows",
    cargoTarget: path.resolve("compile/target"),
    offline: true,
  };
  const build = cargoPlan(
    [
      "build",
      "--release",
      "--target-dir",
      "must-not-publish-here",
      "--features",
      "full-dev",
    ],
    plan,
  );
  assert.equal(build.profile, "release");
  assert.ok(!build.application.includes("must-not-publish-here"));
  assert.ok(build.application.includes(plan.cargoTarget));
  assert.ok(
    !cargoPlan(["build", "--bins"], plan).application.includes("--bins"),
  );
  assert.throws(
    () => cargoPlan(["build", "--profile", "custom"], plan),
    /debug\/release/,
  );
  assert.throws(() => cargoPlan(["run", "--workspace"], plan), /Unsupported/);
});

test("unsafe runner substitution and implicit archive acquisition are rejected", () => {
  assert.throws(
    () => parseArguments(["dev", "--runner", "cargo"], {}),
    /owns the Cargo runner/,
  );
  assert.throws(
    () => parseArguments(["build", "--cef-download", "--cef-offline"], {}),
    /cannot acquire/,
  );
  assert.throws(
    () => parseArguments(["build", "--cef-archive"], {}),
    /requires a value/,
  );
  assert.throws(() => hostTarget("darwin", "ia32"), /supported native/);
});

test("only explicit official SDK fixtures allow pinned acquisition; offline and opt-outs prohibit it", () => {
  assert.equal(parseFixtureArguments(["build"], {}).download, true);
  assert.equal(
    parseFixtureArguments(["build", "--cef-offline"], {}).download,
    false,
  );
  assert.equal(
    parseFixtureArguments(["build"], { CARGO_NET_OFFLINE: "true" }).download,
    false,
  );
  assert.equal(
    parseFixtureArguments(["build", "--", "--offline"], {}).download,
    false,
  );
  assert.equal(
    parseFixtureArguments(["build", "--cef-no-download"], {}).download,
    false,
  );
  assert.equal(
    parseFixtureArguments(["build"], { SORNG_CEF_ACQUIRE: "0" }).download,
    false,
  );
});

test("config merges retain consent/security settings, resources and selected dev origin", () => {
  const base = {
    build: { frontendDist: "../out" },
    app: { security: { csp: "strict" } },
    bundle: { resources: { "locales/": "locales/" } },
  };
  const result = mergeConfig(base, {
    build: { devUrl: "http://localhost:3111" },
    bundle: { resources: { "native/openh264.dll": "openh264.dll" } },
  });
  assert.equal(result.app.security.csp, "strict");
  assert.equal(result.build.frontendDist, "../out");
  assert.equal(result.build.devUrl, "http://localhost:3111");
  assert.equal(Object.keys(result.bundle.resources).length, 2);
  assert.equal(Object.keys(base.bundle.resources).length, 1);
});

test("Windows/Linux bundler retains app resources and complete private CEF payload", () => {
  for (const target of ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"]) {
    const manifest = packageManifest(target, "com.sortofremote.ng");
    const plan = {
      target,
      platform: manifest.platform,
      appName: manifest.appName,
      payload: path.resolve("payload"),
    };
    const base = {
      build: {
        runner: "owned",
        beforeBundleCommand: "check-existing-resources",
      },
      bundle: {
        resources: { "app-locales/": "locales/", "opkssh/": "opkssh/" },
      },
    };
    const files = [
      ...manifest.applicationFiles,
      "locales/en-US.pak",
      "cef-LICENSE.txt",
    ];
    const config = bundleConfiguration(base, plan, files);
    assert.equal(config.build.runner, undefined);
    assert.equal(config.build.beforeBundleCommand, "check-existing-resources");
    assert.equal(config.bundle.resources["app-locales/"], "locales/");
    assert.equal(
      config.bundle.resources[path.join(plan.payload, "locales/en-US.pak")],
      "locales/en-US.pak",
    );
    assert.equal(
      config.bundle.resources[
        path.join(plan.payload, manifest.applicationFiles[0])
      ],
      undefined,
    );
    assert.equal(
      config.bundle.resources[
        path.join(plan.payload, manifest.applicationFiles[1])
      ],
      manifest.applicationFiles[1],
    );
  }
});

test("macOS bundles all five helpers alongside framework without replacing app plist/signing", () => {
  const target = "aarch64-apple-darwin";
  const plan = {
    target,
    platform: "macos",
    appName: "com.sortofremote.ng",
    payload: path.resolve("payload"),
  };
  const base = {
    build: { runner: "owned" },
    bundle: {
      resources: {},
      macOS: {
        infoPlist: "Info.plist",
        entitlements: "entitlements.plist",
        signingIdentity: "configured",
        frameworks: ["libopenh264.8.dylib"],
        files: { "Resources/existing": "source" },
      },
    },
  };
  const config = bundleConfiguration(base, plan, []);
  const mac = config.bundle.macOS;
  assert.equal(mac.minimumSystemVersion, "14.0");
  assert.equal(mac.infoPlist, "Info.plist");
  assert.equal(mac.entitlements, "entitlements.plist");
  assert.equal(mac.signingIdentity, "configured");
  assert.equal(mac.frameworks.length, 2);
  assert.equal(Object.keys(mac.files).length, 6);
  assert.ok(mac.files["Frameworks/com.sortofremote.ng Helper (Renderer).app"]);
});

test("Linux launcher selects X11 and only the packaged binary in dev or installed layout", () => {
  const launcher = linuxLauncher("com.sortofremote.ng", "sortOfRemoteNG");
  assert.match(launcher, /export GDK_BACKEND=x11/);
  assert.match(launcher, /\.\.\/lib\/sortOfRemoteNG\/com.sortofremote.ng.bin/);
  assert.ok(!launcher.includes("LD_LIBRARY_PATH"));
  assert.ok(!launcher.includes("no-sandbox"));
  assert.throws(() => linuxLauncher("name", "../../escape"), /Invalid/);
});

test("archive discovery is local and target-specific; explicit bad input never falls back", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-driver-discovery-"));
  const target = "x86_64-pc-windows-msvc";
  const folder = path.join(root, ".cache/cef", target);
  await mkdir(folder, { recursive: true });
  const archive = path.join(folder, packageManifest(target).artifact.name);
  await writeFile(archive, "fixture only, not a real archive");
  const official = { runtimeKind: "official", officialRuntimeExplicit: true };
  await assert.rejects(locateArchive(target, {}, root), /explicit SDK/);
  assert.equal(await locateArchive(target, official, root), archive);
  assert.equal(
    await locateArchive("aarch64-apple-darwin", official, root),
    undefined,
  );
  assert.equal(
    await locateArchive(
      target,
      { ...official, archive: "missing-explicit.tar.bz2" },
      root,
    ),
    path.resolve("missing-explicit.tar.bz2"),
  );
});

test("driver retains native exit safety without admission/security toggles", async () => {
  const source = await readFile(
    new URL("../../scripts/browser-app-build.mjs", import.meta.url),
    "utf8",
  );
  const runner = await readFile(
    new URL("../../scripts/native/browser-cargo-runner.rs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(source, /SORNG_CEF_RUNNER_PARENT/);
  assert.match(source, /inspectBundle\(\s*plan.payload/);
  assert.ok(!source.includes("append_switch"));
  assert.ok(!source.includes("install(runtime, true)"));
});
