#!/usr/bin/env node
// Closed, manual engineering checkpoint path. Never an application publisher.
import { execFileSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  build,
  plan,
  releaseIdentity,
  verifyBundle,
  validateRunnerMap,
  assertHostedBuildIdentity,
} from "./cef-runtime-ci.mjs";
import { verifyToolchainFiles } from "./lib/browser-custom-runtime.mjs";
import {
  LIMITS,
  INPUTS,
  TARGET,
  SOURCE_ID,
  WORKFLOW,
  authority,
  sha,
  canonical,
  codeTreeDigest,
  workspace,
  filePin,
  validateIdentity,
  graphDigest,
  withVerifiedGraph,
  restoreVerifiedGraph,
  validateManifest,
  archiveCommand,
  compileSlice,
  apiClient,
  restoreDownload,
  uploadCheckpoint,
  executionOptions,
  hostRemaining,
  sliceBudget,
  createSdkCompletion,
  validateSdkCompletion,
  uploadSdkBundle,
  noLinks,
} from "./lib/cef-engineering-checkpoint.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELPER = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
const fail = (ok, message) => {
  if (!ok) throw new Error(message);
};
const json = async (p) => JSON.parse(await readFile(p, "utf8"));
export function argumentsFor(argv) {
  const [mode, ...args] = argv;
  fail(
    ["download", "compile", "upload", "outcome"].includes(mode),
    "Unknown checkpoint command",
  );
  const result = { mode };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    fail(
      value &&
        !Object.hasOwn(result, key) &&
        ((mode === "download" && key === "--restore-run") ||
          (mode === "compile" && ["--mode", "--slice-minutes"].includes(key))),
      "Unknown checkpoint argument",
    );
    if (key === "--restore-run") {
      fail(
        /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)),
        "Run id bound",
      );
      result[key] = Number(value);
    } else result[key] = value;
  }
  if (mode === "compile")
    executionOptions(
      result["--mode"] ?? "checkpoint",
      result["--slice-minutes"] ?? "15",
    );
  return result;
}
async function tools(env) {
  const reviewed = await plan({
    inputs: INPUTS,
    target: TARGET,
    checkout: ROOT,
    runnerMode: "hosted",
  });
  fail(
    releaseIdentity(reviewed.sourceLock, TARGET).sourceLockSha256 === SOURCE_ID,
    "Unreviewed checkpoint inputs",
  );
  const buildPin = reviewed.sourceLock.builds.find((b) => b.target === TARGET);
  const toolchain = await json(
    path.join(reviewed.inputsRoot, buildPin.toolchainLock.path),
  );
  const map = validateRunnerMap(
    await json(path.join(reviewed.inputsRoot, `cef-ci-runner-${TARGET}.json`)),
    TARGET,
  );
  assertHostedBuildIdentity(map, TARGET, env);
  const toolsRoot = await realpath(env.SORNG_CEF_TOOLS_ROOT ?? "/");
  const python = path.join(toolsRoot, map.python);
  await verifyToolchainFiles({
    sourceLock: reviewed.sourceLock,
    target: TARGET,
    inputsRoot: reviewed.inputsRoot,
    toolsRoot,
    python,
    runnerMapFromInputs: true,
  });
  return { python, toolchain, map };
}
async function codeDigest() {
  const lines = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "HEAD",
      "--",
      "scripts",
      "native/cef-hosted-recipe.json",
      ".node-version",
      WORKFLOW,
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 ** 2 },
  )
    .trim()
    .split("\n");
  const entries = lines.map((line) => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    fail(match, "Committed regular source required");
    return { mode: match[1], type: "blob", sha: match[2], path: match[3] };
  });
  for (const row of entries) {
    const actual = execFileSync("git", ["hash-object", "--", row.path], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    fail(
      actual === row.sha,
      "Working producer source differs from committed head",
    );
  }
  return codeTreeDigest(entries);
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = argumentsFor(argv),
    producer = authority(env);
  fail(
    process.platform === "darwin" && process.arch === "x64",
    "Reviewed native Mac Intel checkpoint only",
  );
  const temp = await noLinks(env.RUNNER_TEMP),
    download = path.join(temp, "cef-engineering-download"),
    state = path.join(temp, "cef-engineering-state.json"),
    bundle = path.join(temp, "cef-engineering-checkpoint-bundle");
  if (options.mode === "download") {
    if (!options["--restore-run"])
      return { restore: false, nativeAcceptance: false };
    const verified = await tools(env);
    const result = await restoreDownload(
      apiClient(producer.repository, env.GH_TOKEN, fetch, { readOnly: true }),
      {
        repository: producer.repository,
        token: env.GH_TOKEN,
        runId: options["--restore-run"],
        destination: download,
        python: verified.python,
        helper: HELPER,
      },
    );
    if (env.GITHUB_OUTPUT)
      await appendFile(
        env.GITHUB_OUTPUT,
        `manifest_sha=${sha(await readFile(path.join(download, "manifest.json")))}\n`,
      );
    await writeFile(
      path.join(download, "download-proof.json"),
      `${canonical(result)}\n`,
      { flag: "wx" },
    );
    return { restoreDownloaded: true, nativeAcceptance: false };
  }
  if (options.mode === "compile") {
    fail(
      !env.GH_TOKEN && !env.GITHUB_TOKEN,
      "Compiler step must not receive a GitHub token",
    );
    const execution = executionOptions(
      options["--mode"] ?? "checkpoint",
      options["--slice-minutes"] ?? "15",
    );
    hostRemaining(env);
    const verified = await tools(env),
      code = await codeDigest();
    const work = await workspace(temp, SOURCE_ID);
    const result = await build(
      {
        inputs: INPUTS,
        target: TARGET,
        repository: producer.repository,
        execute: true,
        checkout: ROOT,
        runnerMode: "hosted",
        engineering: {
          completeSdk: execution.mode === "complete-sdk",
          packagingMilliseconds: () =>
            Math.floor(Math.min(40 * 60_000, hostRemaining(env) - 20 * 60_000)),
          workspace: work,
          async afterGn(context) {
            const out = path.join(context.chromium, "out", "Release_GN_x64");
            const siso = await filePin(
              path.join(context.chromium, "third_party/siso/cipd/siso"),
              256 * 1024 ** 2,
            );
            const developer = await realpath(context.env.DEVELOPER_DIR),
              sdk = await realpath(context.env.SDKROOT);
            fail(
              sdk.startsWith(
                `${developer}/Platforms/MacOSX.platform/Developer/SDKs/`,
              ),
              "SDK outside verified Developer path",
            );
            const linkRecipe = {};
            for (const target of [
              sdk,
              path.join(developer, "Platforms/MacOSX.platform"),
              path.join(developer, "Toolchains/XcodeDefault.xctoolchain"),
            ]) {
              const canonicalTarget = await realpath(target),
                name = `sdk/xcode_links/${path.basename(canonicalTarget)}`;
              fail(
                (await readlink(path.join(out, name))) === canonicalTarget,
                "Fresh GN link differs from exact verified SDK recipe",
              );
              linkRecipe[name] = canonicalTarget;
            }
            const recipePath = path.join(
              context.logs,
              "generated-sdk-links.json",
            );
            await writeFile(recipePath, canonical(linkRecipe), { flag: "wx" });
            const identity = {
              target: TARGET,
              source: SOURCE_ID,
              producer: code,
              canonicalRoot: work,
              image: env.ImageVersion,
              tools: sha(
                canonical({
                  toolchain: verified.toolchain,
                  linkRecipe,
                  nodeVersion: process.version,
                  nodeExecutable: await filePin(
                    await realpath(process.execPath),
                    256 * 1024 ** 2,
                  ),
                }),
              ),
              graph: await graphDigest(out),
              siso: siso.sha256,
            };
            const digest = validateIdentity(identity);
            context.checkpoint = { out, identity, digest, recipePath };
            let prior;
            try {
              prior = await json(path.join(download, "download-proof.json"));
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
            if (prior) {
              const manifestBytes = await readFile(
                path.join(download, "manifest.json"),
              );
              fail(
                /^[a-f0-9]{64}$/.test(env.CEF_RESTORE_MANIFEST_SHA ?? "") &&
                  sha(manifestBytes) === env.CEF_RESTORE_MANIFEST_SHA,
                "Manifest differs from trusted download-step output",
              );
              fail(
                canonical(JSON.parse(manifestBytes)) ===
                  canonical(prior.manifest),
                "Restore proof differs from pinned manifest",
              );
              validateManifest(prior.manifest, digest);
              const free = await statfs(path.dirname(out));
              fail(
                free.bavail * free.bsize >=
                  prior.manifest.archive.rawBytes + 2 * 1024 ** 3,
                "Restore disk capacity",
              );
              const restored = path.join(
                path.dirname(out),
                "checkpoint-restored",
              );
              const result = await archiveCommand(verified.python, HELPER, [
                "restore",
                "--input",
                download,
                "--output",
                restored,
                "--manifest",
                path.join(download, "manifest.json"),
                "--generated-links",
                recipePath,
              ]);
              fail(
                result.complete === true && result.linksExtracted === false,
                "Incomplete verified restore",
              );
              await restoreVerifiedGraph({
                fresh: out,
                restored,
                expectedGraph: identity.graph,
                revalidateGn: context.revalidateGn,
                verifyGenerated: async () => {
                  for (const [name, target] of Object.entries(linkRecipe))
                    fail(
                      (await readlink(path.join(out, name))) === target,
                      "Post-GN SDK link differs from verified recipe",
                    );
                },
              });
            }
          },
          async compile(context) {
            const compile = await compileSlice(
              context.executable,
              context.args,
              {
                cwd: context.cwd,
                env: context.env,
                logs: context.logs,
                milliseconds: sliceBudget(
                  execution,
                  Math.floor(hostRemaining(env)),
                ),
              },
            );
            const { out, identity, digest, recipePath } = context.checkpoint;
            if (
              execution.mode === "complete-sdk" &&
              compile.outcome === "compiler-complete" &&
              compile.exitCode === 0
            ) {
              await withVerifiedGraph(out, identity.graph, async () => {});
              return { kind: "continue-sdk", compile };
            }
            const free = await statfs(temp);
            fail(
              free.bavail * free.bsize >= LIMITS.compressed + 2 * 1024 ** 3,
              "Full checkpoint output capacity",
            );
            const archive = await withVerifiedGraph(out, identity.graph, () =>
              archiveCommand(verified.python, HELPER, [
                "pack",
                "--input",
                out,
                "--output",
                bundle,
                "--generated-links",
                recipePath,
              ]),
            );
            const manifest = {
              schemaVersion: 1,
              kind: "sorng-cef-engineering-checkpoint",
              identity,
              identitySha256: digest,
              producer,
              archive,
              compile,
              nativeAcceptance: false,
              runtimeReady: false,
            };
            validateManifest(manifest, digest);
            await writeFile(
              state,
              `${canonical({ kind: "checkpoint", manifest, bundle, logs: context.logs })}\n`,
              { flag: "wx" },
            );
            return {
              checkpoint: true,
              compile,
              identitySha256: digest,
              nativeAcceptance: false,
              runtimeReady: false,
            };
          },
        },
      },
      env,
    );
    if (result.sdkCompletion) {
      fail(
        execution.mode === "complete-sdk",
        "Checkpoint-only intent cannot publish SDK completion",
      );
      const checked = await verifyBundle(result.bundle, producer.repository);
      const completion = createSdkCompletion({
        producer,
        ...result.sdkCompletion,
        checked,
      });
      await writeFile(
        state,
        canonical({
          kind: "sdk",
          completion,
          bundle: result.bundle,
          logs: result.logs,
        }) + "\n",
        { flag: "wx" },
      );
      if (env.GITHUB_OUTPUT)
        await appendFile(env.GITHUB_OUTPUT, "sdk_complete=true\n");
      return {
        sdkComplete: true,
        nativeAcceptance: false,
        runtimeReady: false,
      };
    }
    if (env.GITHUB_OUTPUT)
      await appendFile(env.GITHUB_OUTPUT, "sdk_complete=false\n");
    return result;
  }
  const saved = await json(state);
  if (saved.kind === "sdk") {
    validateSdkCompletion(saved.completion);
    fail(
      saved.bundle ===
        path.join(temp, "sorng-cef-engineering", TARGET, SOURCE_ID, "bundle") &&
        canonical(saved.completion.producer) === canonical(producer),
      "Foreign SDK state",
    );
    if (options.mode === "outcome")
      return {
        sdkComplete: true,
        nativeAcceptance: false,
        runtimeReady: false,
      };
    await verifyBundle(saved.bundle, producer.repository);
    const seal = await uploadSdkBundle(
      apiClient(producer.repository, env.GH_TOKEN, fetch, { sdk: true }),
      { bundle: saved.bundle, completion: saved.completion, producer },
    );
    const sealRoot = path.join(temp, "cef-engineering-sdk-seal");
    await mkdir(sealRoot);
    const data = canonical(seal) + "\n";
    fail(Buffer.byteLength(data) < LIMITS.seal, "SDK seal size bound");
    await writeFile(path.join(sealRoot, "seal.json"), data, { flag: "wx" });
    return {
      sdkDraftUploaded: true,
      sealPending: true,
      nativeAcceptance: false,
      runtimeReady: false,
    };
  }
  fail(saved.kind === "checkpoint", "Unknown engineering state");
  validateManifest(saved.manifest);
  fail(
    saved.bundle === bundle &&
      canonical(saved.manifest.producer) === canonical(producer),
    "Foreign checkpoint state",
  );
  if (options.mode === "outcome") {
    fail(
      saved.manifest.compile.outcome !== "compiler-failed",
      "Compiler failed; checkpoint retained only as diagnostics",
    );
    return {
      outcome: saved.manifest.compile.outcome,
      checkpointOnly: true,
      nativeAcceptance: false,
      runtimeReady: false,
    };
  }
  const seal = await uploadCheckpoint(
    apiClient(producer.repository, env.GH_TOKEN),
    { bundle, manifest: saved.manifest, producer },
  );
  const sealRoot = path.join(temp, "cef-engineering-seal");
  await mkdir(sealRoot);
  const data = `${canonical(seal)}\n`;
  fail(Buffer.byteLength(data) < LIMITS.seal, "Seal size bound");
  await writeFile(path.join(sealRoot, "seal.json"), data, { flag: "wx" });
  // It is usable only AFTER the workflow uploads this independent small artifact.
  return {
    draftUploaded: true,
    sealPending: true,
    checkpointOnly: true,
    nativeAcceptance: false,
    runtimeReady: false,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((result) => console.log(canonical(result)))
    .catch(() => {
      console.error(
        "[cef-engineering-checkpoint] operation failed; retained logs and partial bytes are not acceptance",
      );
      process.exitCode = 1;
    });
