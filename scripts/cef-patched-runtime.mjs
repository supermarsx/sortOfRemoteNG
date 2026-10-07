#!/usr/bin/env node
// Explicit source-build tooling. Normal desktop builds consume prebuilt SDKs.
// Never installs system packages, loads CEF, or grants readiness. Source fetches
// require the explicit acquire verb and a new, dedicated workspace.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySourcePatches,
  assessWindowsEnginePrerequisites,
  customRuntimeBuildRecipe,
  preflightCustomRuntime,
  preflightSourceCheckout,
  sourceAcquisitionPlan,
  validateCustomRuntimeManifest,
  validateSourceLock,
  verifySourceBuildIsolation,
  verifySourceCheckoutVersion,
  verifyToolchainFiles,
} from "./lib/browser-custom-runtime.mjs";

const exec = promisify(execFile);
export const HELP = `CEF patched-runtime tooling (no stock fallback):
  doctor [--python EXE]                       Read-only Windows prerequisite inventory
  source-plan --root NEW_SHORT_DIR             Emit pinned acquisition recipe; no fetch
  acquire --root NEW_SHORT_DIR --execute       Fetch pinned repositories only (no hooks/build)
  validate --lock JSON [--manifest JSON] [--all-targets]
  preflight --lock JSON --manifest JSON --target TRIPLE --artifacts DIR --sdk DIR
  check-source|apply|recipe|build --lock JSON --inputs DIR --cef DIR --chromium DIR --depot-tools DIR
    recipe/build also require --target TRIPLE
    build additionally requires --execute --python EXE --tools DIR --log-dir NEW_DIR

apply modifies only the explicitly supplied clean, pinned source checkouts.
build applies patches and runs upstream CEF hooks, compilation and distribution.
Dependencies/toolchain must already be provisioned; hooks may acquire pinned inputs.
Only acquire clones sources. No system installs, app launches or remote CI.
Hashes establish agreement with a REVIEWED manifest, not publisher authenticity or
native verifier enforcement. All commands retain productionReady=false.
`;

export function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h")
    return { command: "help" };
  if (
    ![
      "doctor",
      "source-plan",
      "acquire",
      "validate",
      "preflight",
      "check-source",
      "apply",
      "recipe",
      "build",
    ].includes(command)
  )
    throw new Error(`Unknown command: ${command}`);
  const result = { command };
  const flags = new Set(["all-targets", "execute"]);
  const values = new Set([
    "lock",
    "manifest",
    "target",
    "inputs",
    "cef",
    "chromium",
    "depot-tools",
    "root",
    "python",
    "tools",
    "log-dir",
    "artifacts",
    "sdk",
  ]);
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match || (!flags.has(match[1]) && !values.has(match[1])))
      throw new Error(`Unknown option: ${args[i]}`);
    const key = match[1];
    if (Object.hasOwn(result, key))
      throw new Error(`Duplicate option: --${key}`);
    if (flags.has(key)) {
      if (match[2] !== undefined) throw new Error(`--${key} takes no value`);
      result[key] = true;
    } else {
      const value = match[2] ?? args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`--${key} requires a value`);
      result[key] = value;
    }
  }
  return result;
}

export async function inspectWindowsEnginePrerequisites(python) {
  if (process.platform !== "win32")
    return {
      ok: false,
      blockers: ["Windows inventory must run on Windows"],
      productionReady: false,
    };
  const ps = String.raw`
$vswhere = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = if (Test-Path -LiteralPath $vswhere) { & $vswhere -all -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.ATLMFC -format json | ConvertFrom-Json } else { @() }
$sdkRoot = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Windows Kits/10'
$sdk = @(Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory -ErrorAction SilentlyContinue | ForEach-Object Name)
$dbg = Join-Path $sdkRoot 'Debuggers/x64/dbghelp.dll'
$debugger = if (Test-Path -LiteralPath $dbg) { (Get-Item -LiteralPath $dbg).VersionInfo.FileVersion.Split(' ')[0] } else { $null }
[pscustomobject]@{visualStudioVersions=@($vs | ForEach-Object installationVersion);sdkVersions=$sdk;debuggerVersion=$debugger} | ConvertTo-Json -Compress
`;
  const { stdout } = await exec(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ps],
    { windowsHide: true, timeout: 30_000 },
  );
  const measured = JSON.parse(stdout);
  measured.nativePython = false;
  if (python) {
    try {
      const checked = await exec(
        path.resolve(python),
        [
          "-c",
          "import sys; assert sys.platform == 'win32' and sys.version_info >= (3,9); print(sys.version)",
        ],
        { windowsHide: true, timeout: 10_000 },
      );
      measured.nativePython = true;
      measured.pythonVersion = checked.stdout.trim();
    } catch {
      /* Assessment explains the missing native Python requirement. */
    }
  }
  return { ...assessWindowsEnginePrerequisites(measured), measured };
}

function requireOption(options, name) {
  if (!options[name])
    throw new Error(`--${name} is required for ${options.command}`);
  return options[name];
}
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

async function executeStep(step, environment, logDirectory, index, python) {
  const stdoutPath = path.join(logDirectory, `${index}.stdout.log`);
  const stderrPath = path.join(logDirectory, `${index}.stderr.log`);
  const stdout = createWriteStream(stdoutPath, { flags: "wx" });
  const stderr = createWriteStream(stderrPath, { flags: "wx" });
  const executable = step.executable === "python3" ? python : step.executable;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, step.args, {
      cwd: step.cwd,
      env: environment,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stderr.write(
      `[cef-patched-runtime] child pid=${child.pid} step=${index}\n`,
    );
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.stdout.pipe(process.stderr, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.once("error", reject);
    child.once("close", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Build step ${index} failed (${code ?? signal}); see ${stdoutPath} and ${stderrPath}`,
            ),
          ),
    );
    stdout.once("error", reject);
    stderr.once("error", reject);
  });
}

/** Fetch only into a NEW workspace. No hook, package installer or global config
 * runs here. Failure preserves partial checkouts/logs; never deletes or resets.
 */
export async function acquireSources(root) {
  const plan = sourceAcquisitionPlan(root);
  await mkdir(plan.root); // Existing roots fail before spawning any process.
  const logs = path.join(plan.root, "acquisition-logs");
  await mkdir(logs);
  await writeFile(
    path.join(plan.root, "acquisition-plan.json"),
    JSON.stringify(plan, null, 2),
    { flag: "wx" },
  );
  const env = { ...process.env, ...plan.environment, GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(env))
    if (
      /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*)$/i.test(
        key,
      )
    )
      delete env[key];
  process.stderr.write(
    `[cef-patched-runtime] acquisition pid=${process.pid} root=${plan.root}\n`,
  );
  // All directories are new and task-owned. Chromium has no tracked cef tree;
  // that separately pinned nested checkout is checked independently before build.
  await mkdir(plan.checkouts.chromium);
  await mkdir(plan.checkouts.cef);
  await mkdir(plan.checkouts.depotTools);
  const outcomes = await Promise.allSettled(
    plan.repositories.map(async (repository) => {
      const commands = [
        ["init", "."],
        ...Object.entries(repository.localGitConfig).map(([key, value]) => [
          "config",
          "--local",
          key,
          value,
        ]),
        ["remote", "add", "origin", repository.repository],
        [
          "-c",
          // Chromium's server can spend several minutes preparing the pack
          // before transferring objects. Bound stalled fetches without treating
          // that preparation interval as a failed download.
          "http.lowSpeedLimit=1",
          "-c",
          "http.lowSpeedTime=900",
          "fetch",
          "--progress",
          "--no-tags",
          ...(repository.name === "cef" ? [] : ["--depth=1"]),
          "origin",
          repository.commit,
        ],
        ...Object.entries(repository.versionReferences).map(([ref, commit]) => [
          "fetch",
          "--no-tags",
          "origin",
          `${commit}:${ref}`,
        ]),
        ["checkout", "--detach", repository.commit],
      ];
      for (const [index, args] of commands.entries()) {
        await executeStep(
          { cwd: repository.destination, executable: "git", args },
          env,
          logs,
          `${repository.name}-${index}`,
        );
      }
      const { stdout } = await exec(
        "git",
        ["-C", repository.destination, "rev-parse", "HEAD"],
        { env, windowsHide: true, timeout: 30_000 },
      );
      if (stdout.trim() !== repository.commit)
        throw new Error(
          `${repository.name}: fetched revision differs from pin`,
        );
      for (const [ref, expected] of Object.entries(
        repository.versionReferences,
      )) {
        const { stdout: refCommit } = await exec(
          "git",
          ["-C", repository.destination, "rev-parse", ref],
          { env, windowsHide: true, timeout: 30_000 },
        );
        if (refCommit.trim() !== expected)
          throw new Error(
            `${repository.name}: version metadata differs from pin`,
          );
      }
      const receipt = {
        repository: repository.repository,
        commit: stdout.trim(),
        versionReferences: repository.versionReferences,
        checkout: repository.destination,
        verifiedAt: new Date().toISOString(),
        dependenciesSynced: false,
      };
      await writeFile(
        path.join(logs, `${repository.name}-verified.json`),
        JSON.stringify(receipt, null, 2),
        { flag: "wx" },
      );
      process.stderr.write(
        `[cef-patched-runtime] ${repository.name} checked out and pinned\n`,
      );
      return receipt;
    }),
  );
  const result = {
    pid: process.pid,
    root: plan.root,
    repositories: outcomes.map((outcome, index) =>
      outcome.status === "fulfilled"
        ? { ok: true, ...outcome.value }
        : {
            ok: false,
            repository: plan.repositories[index].repository,
            error: outcome.reason.message,
          },
    ),
    dependenciesSynced: false,
    hooksRun: false,
    engineBuilt: false,
    productionReady: false,
  };
  await writeFile(
    path.join(logs, "result.json"),
    JSON.stringify(result, null, 2),
    { flag: "wx" },
  );
  if (outcomes.some((outcome) => outcome.status === "rejected"))
    throw new Error(
      `Source acquisition incomplete; preserve/check ${path.join(logs, "result.json")}`,
    );
  // gclient format is Python, not JSON. This file is data for a later explicit
  // sync; writing it does not invoke depot_tools bootstrap or run hooks.
  const solution = plan.gclient.solutions[0];
  const config = `solutions = [{\n  'name': 'src',\n  'url': '${solution.url}',\n  'managed': False,\n  'custom_deps': {},\n  'custom_vars': {\n    'checkout_pgo_profiles': True,\n    'siso_version': '${solution.custom_vars.siso_version}',\n    'download_remoteexec_cfg': False,\n  },\n}]\n`;
  await writeFile(path.join(plan.root, ".gclient"), config, { flag: "wx" });
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === "help") return HELP;
  if (options.command === "doctor")
    return inspectWindowsEnginePrerequisites(options.python);
  if (options.command === "source-plan")
    return sourceAcquisitionPlan(requireOption(options, "root"));
  if (options.command === "acquire") {
    if (!options.execute)
      throw new Error("acquire requires --execute; source-plan is read-only");
    return acquireSources(requireOption(options, "root"));
  }
  const sourceLock = validateSourceLock(
    await readJson(requireOption(options, "lock")),
  );
  if (options.command === "validate") {
    if (options.manifest)
      validateCustomRuntimeManifest(
        await readJson(options.manifest),
        sourceLock,
        { requireAllTargets: !!options["all-targets"] },
      );
    return { schemaValid: true, bytesVerified: false, productionReady: false };
  }
  if (options.command === "preflight")
    return preflightCustomRuntime({
      sourceLock,
      manifest: await readJson(requireOption(options, "manifest")),
      target: requireOption(options, "target"),
      artifactRoot: requireOption(options, "artifacts"),
      sdkRoot: requireOption(options, "sdk"),
      requireAllTargets: !!options["all-targets"],
    });
  const params = {
    sourceLock,
    inputsRoot: requireOption(options, "inputs"),
    checkouts: {
      cef: requireOption(options, "cef"),
      chromium: requireOption(options, "chromium"),
      depotTools: requireOption(options, "depot-tools"),
    },
  };
  if (options.command === "check-source")
    return preflightSourceCheckout(params);
  if (options.command === "apply") return applySourcePatches(params);
  const target = requireOption(options, "target");
  const recipe = await customRuntimeBuildRecipe({ ...params, target });
  if (options.command === "recipe") return recipe;
  if (!options.execute)
    throw new Error(
      "build requires explicit --execute; recipe is the read-only alternative",
    );
  if (process.platform !== recipe.requiredHost)
    throw new Error(
      `Build requires a native ${recipe.requiredHost} runner; no cross-platform success claim`,
    );
  // Fail before applying patches or running upstream hooks. Nested app
  // node_modules can silently contaminate Chromium's TypeScript resolution.
  await verifySourceBuildIsolation(params.checkouts.chromium);
  const python = path.resolve(requireOption(options, "python"));
  if (process.platform === "win32") {
    const doctor = await inspectWindowsEnginePrerequisites(python);
    if (!doctor.ok)
      throw new Error(
        `Native toolchain blocked: ${doctor.blockers.join("; ")}`,
      );
  }
  await verifyToolchainFiles({
    ...params,
    target,
    toolsRoot: requireOption(options, "tools"),
    python,
  });
  await verifySourceCheckoutVersion(
    python,
    params.checkouts.chromium,
    sourceLock.upstream.cef.version,
  );
  await preflightSourceCheckout(params);
  const logs = path.resolve(requireOption(options, "log-dir"));
  await mkdir(logs); // Exclusive new directory; never overwrite prior build logs.
  await writeFile(
    path.join(logs, "recipe.json"),
    JSON.stringify(recipe, null, 2),
    { flag: "wx" },
  );
  await applySourcePatches(params);
  const env = { ...process.env, ...recipe.environment };
  for (const key of Object.keys(env))
    if (key.toLowerCase() === "path") delete env[key];
  env.PATH = [
    recipe.prependPath,
    path.dirname(python),
    process.env.Path ?? process.env.PATH ?? "",
  ].join(path.delimiter);
  // No inherited remote-execution service configuration for a local-only build.
  for (const key of Object.keys(env))
    if (/^(RBE_|RECLIENT_|SISO_REAPI_)/i.test(key)) delete env[key];
  for (const [index, step] of recipe.commands.entries())
    await executeStep(step, env, logs, index, python);
  return {
    buildCommandsSucceeded: true,
    logs,
    artifactManifest: "not-created",
    nativeAcceptance: "not-tested",
    productionReady: false,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((result) => {
      process.stdout.write(
        typeof result === "string"
          ? result
          : `${JSON.stringify(result, null, 2)}\n`,
      );
      if (result && typeof result === "object" && result.ok === false)
        process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`[cef-patched-runtime] ${error.message}`);
      process.exitCode = 1;
    });
}
