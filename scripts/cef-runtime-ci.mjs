#!/usr/bin/env node
// Trusted, explicit engine producer. Never used by ordinary application builds.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import { TARGETS } from "./browser-runtime-package.mjs";
import { inventoryCustomArtifact } from "./cef-custom-artifact-inventory.mjs";
import {
  customRuntimeBuildRecipe,
  identitySha256,
  preflightCustomRuntime,
  sourceAcquisitionPlan,
  validateSourceLock,
  verifySourceBuildIsolation,
  verifySourceCheckoutVersion,
  verifyToolchainFiles,
} from "./lib/browser-custom-runtime.mjs";
import {
  bindRuntimeRelease,
  RELEASE_LIMITS,
  releaseRelativePath,
  validateRuntimeReleaseDescriptor,
} from "./lib/browser-runtime-release.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const MAX_RELEASE_ASSET = 2 * 1024 ** 3 - 1; // GitHub requires < 2 GiB.
const FIELDS = ["sourceLock", "manifest", "receipt", "archive"];
export const RUNNERS = Object.freeze(
  Object.fromEntries(
    TARGETS.map((target) => {
      const arch = target.startsWith("aarch64") ? "ARM64" : "X64";
      const platform = target.includes("windows")
        ? "Windows"
        : target.includes("linux")
          ? "Linux"
          : "macOS";
      return [
        target,
        ["self-hosted", "sorng-cef-engine", platform, arch, `cef-${target}`],
      ];
    }),
  ),
);

export const HELP = `Explicit patched CEF engineering producer (no admission grant):
  plan --inputs CHECKOUT_RELATIVE_DIR --target all|TRIPLE
  build --inputs CHECKOUT_RELATIVE_DIR --target TRIPLE --repository OWNER/REPO --execute
  publish --bundle DIR --repository OWNER/REPO --execute

plan validates every lock-referenced file before dispatching expensive runners.
build requires native dedicated runners, RUNNER_TEMP outside the checkout and all
node_modules ancestors, and provisioned SORNG_CEF_TOOLS_ROOT. It fetches/syncs
pinned source, runs upstream hooks/build, packages a flat minimal SDK, inventories
real bytes, and round-trips extraction. No system packages are installed.

Each target's existing toolchain-lock files array must pin (size + SHA-256):
  cef-ci-runner-<target>.json
at the tools root. That reviewed JSON has EXACT fields:
  schemaVersion: 1, kind: "sorng-cef-ci-runner", target: TRIPLE,
  python: "relative/path/to/python", path: ["relative/tool/bin"],
  syncJobs: 1..8, buildJobs: 1..32, environment: { ... }
Python itself must be in the same toolchain inventory (Python >= 3.12 required).
Environment permits GYP_MSVS_OVERRIDE_PATH, GYP_MSVS_VERSION, WINDOWSSDKDIR,
WDK_DIR, SDKROOT, DEVELOPER_DIR, MACOSX_DEPLOYMENT_TARGET. Values are literals
or @TOOLS@/relative, @SOURCE@/relative, @DEPOT@/relative; never private absolute
paths. path entries are additional provisioned directories beneath tools root.
All map bytes affect the full source-lock identity through the toolchain pin.
Provisioned system/SDK dependencies still require review; this is not a hermetic
toolchain attestation. No six-target production locks are supplied or invented.

publish is a separate protected-environment job on the default branch, with
GH_TOKEN granted contents:write only there. It creates an engineering prerelease,
compares existing asset bytes, never overwrites, and uploads runtime.json last.
Each asset must be under 2 GiB. Raw runtime.json SHA-256 requires independent
review before adding descriptorUrl/descriptorSha256 to the consumer catalog.
Source/build logs stay in RUNNER_TEMP; partial outputs are preserved on failure.
`;

const fail = (message) => {
  throw new Error(message);
};
function shape(value, fields, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    fail(`${label}: exact fields required (${fields.join(", ")})`);
}
export function stableJson(value) {
  const sort = (item) =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, sort(item[key])]),
          )
        : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const exists = async (file) => {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return (
    rel === "" ||
    (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
  );
};

export async function measure(file, maximum = MAX_RELEASE_ASSET) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    !Number.isSafeInteger(info.size) ||
    info.size <= 0 ||
    info.size > maximum
  )
    fail(
      `Invalid/oversized regular asset: ${path.basename(file)} (release assets must be under 2 GiB)`,
    );
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return { sha256: digest.digest("hex"), size: info.size };
}
async function pinned(root, pin) {
  releaseRelativePath(pin.path);
  const file = path.resolve(root, pin.path);
  if (!inside(await realpath(root), await realpath(file)))
    fail("Pinned input escapes its root");
  const actual = await measure(file);
  if (
    actual.sha256 !== pin.sha256 ||
    (pin.size !== undefined && actual.size !== pin.size)
  )
    fail(`Reviewed input mismatch: ${pin.path}`);
  return file;
}
export function releaseIdentity(sourceLock, target) {
  validateSourceLock(sourceLock);
  if (!sourceLock.builds.some((item) => item.target === target))
    fail("Target has no reviewed build pin");
  const sourceLockSha256 = identitySha256(sourceLock);
  const key = `${sourceLockSha256}-${target}`;
  return {
    key,
    sourceLockSha256,
    tag: `cef-patched-${key}`,
    archive: `sorng-cef-custom-${key}.tar.bz2`,
  };
}
const mapName = (target) => `cef-ci-runner-${target}.json`;
function toolchainShape(value, target) {
  shape(value, ["schemaVersion", "kind", "target", "files"], "toolchain lock");
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "sorng-cef-toolchain-lock" ||
    value.target !== target ||
    !Array.isArray(value.files) ||
    !value.files.length
  )
    fail("Invalid target toolchain inventory");
  const names = new Set();
  for (const item of value.files) {
    shape(item, ["path", "size", "sha256"], "toolchain pin");
    releaseRelativePath(item.path);
    if (
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      /^0+$/.test(item.sha256) ||
      !Number.isSafeInteger(item.size) ||
      item.size <= 0 ||
      names.has(item.path.toLowerCase())
    )
      fail("Invalid/duplicate toolchain pin");
    names.add(item.path.toLowerCase());
  }
  if (!value.files.some((pin) => pin.path === mapName(target)))
    fail(`Missing reviewed runner map pin: ${mapName(target)}`);
  return value;
}

export async function plan({ inputs, target = "all", checkout = ROOT }) {
  releaseRelativePath(inputs);
  const base = await realpath(checkout);
  const inputsRoot = await realpath(path.resolve(base, inputs));
  if (!inside(base, inputsRoot))
    fail("Reviewed inputs must be inside the trusted checkout");
  const sourceLock = validateSourceLock(
    await json(path.join(inputsRoot, "source-lock.json")),
  );
  const selected = target === "all" ? TARGETS : [target];
  if (selected.some((item) => !TARGETS.includes(item)))
    fail("Unknown engine target");
  for (const item of selected) releaseIdentity(sourceLock, item); // Missing target fails before any fetch.
  for (const pin of [...sourceLock.patches, sourceLock.bridge.header])
    await pinned(inputsRoot, pin);
  // Validate ALL lock inputs, not just the selected target: identity covers all pins.
  for (const item of sourceLock.builds) {
    const toolchain = await json(await pinned(inputsRoot, item.toolchainLock));
    toolchainShape(toolchain, item.target);
    await customRuntimeBuildRecipe({
      sourceLock,
      inputsRoot,
      target: item.target,
      checkouts: { cef: base, chromium: base, depotTools: base },
    });
  }
  return {
    sourceLock,
    inputsRoot,
    matrix: {
      include: selected.map((item) => ({
        target: item,
        runners: RUNNERS[item],
        key: releaseIdentity(sourceLock, item).key,
      })),
    },
  };
}

const ENV_NAMES = new Set([
  "GYP_MSVS_OVERRIDE_PATH",
  "GYP_MSVS_VERSION",
  "WINDOWSSDKDIR",
  "WDK_DIR",
  "SDKROOT",
  "DEVELOPER_DIR",
  "MACOSX_DEPLOYMENT_TARGET",
]);
export function validateRunnerMap(value, target) {
  shape(
    value,
    [
      "schemaVersion",
      "kind",
      "target",
      "python",
      "path",
      "syncJobs",
      "buildJobs",
      "environment",
    ],
    "runner map",
  );
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "sorng-cef-ci-runner" ||
    value.target !== target
  )
    fail("Runner map target/schema mismatch");
  releaseRelativePath(value.python);
  if (!Array.isArray(value.path) || value.path.length > 32)
    fail("Invalid runner PATH additions");
  value.path.forEach(releaseRelativePath);
  for (const [key, max] of [
    ["syncJobs", 8],
    ["buildJobs", 32],
  ])
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > max)
      fail(`Bounded ${key} required`);
  if (
    !value.environment ||
    typeof value.environment !== "object" ||
    Array.isArray(value.environment)
  )
    fail("Invalid runner environment");
  for (const [key, val] of Object.entries(value.environment)) {
    if (!ENV_NAMES.has(key) || typeof val !== "string")
      fail(`Unreviewable runner environment: ${key}`);
    const templated = /^@(TOOLS|SOURCE|DEPOT)@\/(.+)$/.exec(val);
    if (templated) releaseRelativePath(templated[2]);
    else if (!/^[A-Za-z0-9_.-]+$/.test(val))
      fail("Runner environment must be relocatable, not host-absolute");
  }
  return value;
}

export function buildEnvironment(
  map,
  { toolsRoot, source, depot, python },
  inherited = process.env,
) {
  const env = { ...inherited };
  // Credentials belong to the read/publish client, never upstream build hooks.
  for (const key of Object.keys(env))
    if (
      /^(GH_|GITHUB_|ACTIONS_|RUNNER_|INPUT_|RBE_|RECLIENT_|SISO_|NINJA_|GN_|GYP_|CEF_|DEPOT_TOOLS_|PYTHON|NODE_OPTIONS$|CC$|CXX$|CFLAGS$|CXXFLAGS$|LDFLAGS$|SDKROOT$|DEVELOPER_DIR$|WINDOWSSDKDIR$|WDK_DIR$|MACOSX_DEPLOYMENT_TARGET$|GIT_CONFIG|GIT_DIR$|GIT_WORK_TREE$)/i.test(
        key,
      )
    )
      delete env[key];
  const inheritedPath = inherited.PATH ?? inherited.Path ?? "";
  for (const key of Object.keys(env))
    if (key.toLowerCase() === "path") delete env[key];
  const locations = { TOOLS: toolsRoot, SOURCE: source, DEPOT: depot };
  for (const [key, val] of Object.entries(map.environment))
    env[key] = val.replace(
      /^@(TOOLS|SOURCE|DEPOT)@\//,
      (_, name) => `${locations[name]}${path.sep}`,
    );
  env.PATH = [
    depot,
    path.dirname(python),
    ...map.path.map((entry) => path.join(toolsRoot, entry)),
    inheritedPath,
  ].join(path.delimiter);
  return {
    ...env,
    DEPOT_TOOLS_UPDATE: "0",
    DEPOT_TOOLS_WIN_TOOLCHAIN: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export async function sourceWorkspace(temp, checkout = ROOT) {
  if (!temp) fail("RUNNER_TEMP is required");
  const root = await realpath(temp);
  const repo = await realpath(checkout);
  if (inside(repo, root) || inside(root, repo))
    fail("RUNNER_TEMP must be outside and independent of the checkout");
  await verifySourceBuildIsolation(root);
  // Acquisition itself rejects spaces. Fail now, before fetching Chromium.
  sourceAcquisitionPlan(path.join(root, "cef-ci-probe", "source"));
  return mkdtemp(path.join(root, "cef-ci-"));
}

async function run(
  executable,
  args,
  { cwd, env, logs, name, capture = false },
) {
  const stdout = createWriteStream(path.join(logs, `${name}.stdout.log`), {
    flags: "wx",
  });
  const stderr = createWriteStream(path.join(logs, `${name}.stderr.log`), {
    flags: "wx",
  });
  let text = "";
  const child = spawn(executable, args, {
    cwd,
    env,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    if (capture) {
      text += chunk;
      if (text.length > 1024 * 1024) child.kill();
    }
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  // Avoid flooding CI with compiler progress; full streams remain artifacts.
  process.stderr.write(`[cef-runtime-ci] ${name}; logs: ${logs}\n`);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(`${name} failed (${code}); inspect retained logs`),
            ),
      );
    });
  } finally {
    stdout.end();
    stderr.end();
    await Promise.all([finished(stdout), finished(stderr)]);
  }
  if (capture && text.length > 1024 * 1024)
    fail("Command output exceeded capture bound");
  return text.trim();
}
async function output(key, value) {
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export function boundedBuildCommands(recipe, jobs) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32)
    fail("Bounded buildJobs required");
  let count = 0;
  const commands = recipe.commands.map((step) => {
    if (path.basename(step.args[0]) !== "autoninja.py") return step;
    count++;
    // use_siso=true bypasses NINJA_CORE_ADDITION/LIMIT. Explicit -j is converted
    // by pinned autoninja to Siso's bounded local job flags, including offline.
    return {
      ...step,
      args: [step.args[0], "-j", String(jobs), ...step.args.slice(1)],
    };
  });
  if (count !== 1)
    fail("Reviewed recipe must contain exactly one autoninja build");
  return commands;
}

export async function flattenSdk(
  distribution,
  destination,
  sourceLock,
  inputsRoot,
) {
  if (await exists(destination)) fail("Flat SDK destination must be new");
  const source = await realpath(distribution);
  await mkdir(destination);
  const names = new Set();
  const copy = async (from, name) => {
    releaseRelativePath(name);
    if (names.has(name.toLowerCase()))
      fail(`SDK flattening collision: ${name}`);
    names.add(name.toLowerCase());
    if (!inside(source, await realpath(from)))
      fail("SDK source escapes distribution");
    await cp(from, path.join(destination, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
  };
  for (const dir of ["Release", "Resources"]) {
    const location = path.join(source, dir);
    if (!(await exists(location))) {
      if (dir === "Release") fail("Missing Release SDK output");
      continue;
    }
    for (const name of (await readdir(location)).sort())
      await copy(path.join(location, name), name);
  }
  for (const name of [
    "include",
    "cmake",
    "libcef_dll",
    "CMakeLists.txt",
    "LICENSE.txt",
    "CREDITS.html",
  ])
    await copy(path.join(source, name), name);
  if (await exists(path.join(source, "README.txt")))
    await copy(path.join(source, "README.txt"), "README.txt");
  const header = await pinned(inputsRoot, sourceLock.bridge.header);
  const destinationHeader = path.join(
    destination,
    sourceLock.bridge.header.path,
  );
  if (await exists(destinationHeader)) {
    if (
      (await measure(destinationHeader)).sha256 !==
      sourceLock.bridge.header.sha256
    )
      fail("Distribution bridge header mismatch");
  } else await copyFile(header, destinationHeader, constants.COPYFILE_EXCL);
  await writeFile(
    path.join(destination, "archive.json"),
    stableJson({
      type: "minimal",
      kind: "sorng-cef-custom-sdk",
      sourceLockSha256: identitySha256(sourceLock),
    }),
    { flag: "wx" },
  );
  return destination;
}

// Stable archive metadata: no build timestamps, host user IDs or private paths.
export const PACK_PYTHON = `import pathlib, sys, tarfile
source, output = map(pathlib.Path, sys.argv[1:])
def normalize(member):
    member.uid = member.gid = 0
    member.uname = member.gname = ""
    member.mtime = 0
    member.pax_headers = {}
    return member
with tarfile.open(output, "x:bz2", format=tarfile.PAX_FORMAT, dereference=False) as archive:
    archive.add(source, arcname=source.name, recursive=False, filter=normalize)
    for entry in sorted(source.rglob("*")):
        if entry.is_symlink() or entry.is_file():
            archive.add(entry, arcname=source.name + "/" + entry.relative_to(source).as_posix(), recursive=False, filter=normalize)
`;

function repositoryName(repository) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  )
    fail("Explicit OWNER/REPO required");
  return repository;
}
export async function descriptorFor({
  bundle,
  sourceLock,
  target,
  repository,
  archiveRoot,
}) {
  const identity = releaseIdentity(sourceLock, target);
  const base = `https://github.com/${repositoryName(repository)}/releases/download/${identity.tag}`;
  const names = {
    sourceLock: "source-lock.json",
    manifest: "manifest.json",
    receipt: "receipt.json",
    archive: identity.archive,
  };
  const descriptor = {
    schemaVersion: 1,
    kind: "sorng-cef-runtime-release",
    target,
  };
  for (const field of FIELDS)
    descriptor[field] = {
      url: `${base}/${names[field]}`,
      path: names[field],
      ...(await measure(
        path.join(bundle, names[field]),
        field === "archive" ? MAX_RELEASE_ASSET : RELEASE_LIMITS.metadata,
      )),
    };
  descriptor.sdk = { archiveRoot };
  validateRuntimeReleaseDescriptor(descriptor, {
    descriptorUrl: `${base}/runtime.json`,
    target,
  });
  bindRuntimeRelease(
    descriptor,
    await json(path.join(bundle, "manifest.json")),
    sourceLock,
  );
  return descriptor;
}

export async function build(
  { inputs, target, repository, execute, checkout = ROOT },
  env = process.env,
) {
  if (!execute) fail("build requires --execute");
  repositoryName(repository);
  const { sourceLock, inputsRoot } = await plan({ inputs, target, checkout });
  const identity = releaseIdentity(sourceLock, target);
  const expectedPlatform = target.includes("windows")
    ? "win32"
    : target.includes("linux")
      ? "linux"
      : "darwin";
  const expectedArch = target.startsWith("aarch64") ? "arm64" : "x64";
  if (process.platform !== expectedPlatform || process.arch !== expectedArch)
    fail("Target requires a native matching OS/architecture runner");
  if (!env.SORNG_CEF_TOOLS_ROOT)
    fail("Provision SORNG_CEF_TOOLS_ROOT before source acquisition");
  const toolsRoot = await realpath(env.SORNG_CEF_TOOLS_ROOT);
  const buildPin = sourceLock.builds.find((item) => item.target === target);
  const toolchain = toolchainShape(
    await json(await pinned(inputsRoot, buildPin.toolchainLock)),
    target,
  );
  const runner = validateRunnerMap(
    await json(
      await pinned(
        toolsRoot,
        toolchain.files.find((item) => item.path === mapName(target)),
      ),
    ),
    target,
  );
  const python = path.join(toolsRoot, runner.python);
  await verifyToolchainFiles({
    sourceLock,
    target,
    inputsRoot,
    toolsRoot,
    python,
  });
  for (const entry of runner.path)
    if (!inside(toolsRoot, await realpath(path.join(toolsRoot, entry))))
      fail("Runner PATH escapes tools root");
  const work = await sourceWorkspace(env.RUNNER_TEMP, checkout);
  const logs = path.join(work, "logs"),
    bundle = path.join(work, "bundle");
  await mkdir(logs);
  await mkdir(bundle);
  await output("logs", logs);
  await output("bundle", bundle);
  const source = path.join(work, "source");
  const chromium = path.join(source, "src"),
    cef = path.join(chromium, "cef"),
    depot = path.join(source, "depot_tools");
  const childEnv = buildEnvironment(
    runner,
    { toolsRoot, source, depot, python },
    env,
  );
  const call = (exe, args, name, cwd = checkout, capture = false) =>
    run(exe, args, { cwd, env: childEnv, logs, name, capture });
  const patched = path.join(checkout, "scripts/cef-patched-runtime.mjs");
  const facts = JSON.parse(
    await call(
      python,
      [
        "-I",
        "-c",
        "import json,sys; print(json.dumps(list(sys.version_info[:2])))",
      ],
      "python",
      checkout,
      true,
    ),
  );
  if (facts[0] !== 3 || facts[1] < 12) fail("Provision pinned Python >= 3.12");
  if (process.platform === "win32")
    await call(
      process.execPath,
      [patched, "doctor", "--python", python],
      "doctor",
    );
  try {
    await call(
      process.execPath,
      [patched, "acquire", "--root", source, "--execute"],
      "acquire",
    );
  } finally {
    if (await exists(path.join(source, "acquisition-logs")))
      await cp(
        path.join(source, "acquisition-logs"),
        path.join(logs, "acquisition"),
        { recursive: true, errorOnExist: true, force: false },
      );
  }
  await call(
    python,
    [
      path.join(depot, "gclient.py"),
      "sync",
      "--jobs",
      String(runner.syncJobs),
      "--nohooks",
      "--no-history",
      "--revision",
      `src@${sourceLock.upstream.chromium.commit}`,
    ],
    "sync",
    source,
  );
  await call(
    python,
    [
      path.join(depot, "gclient.py"),
      "runhooks",
      "--jobs",
      String(runner.syncJobs),
    ],
    "dependency-hooks",
    source,
  );
  const recipe = await customRuntimeBuildRecipe({
    sourceLock,
    target,
    inputsRoot,
    checkouts: { cef, chromium, depotTools: depot },
  });
  await verifySourceBuildIsolation(chromium);
  await verifySourceCheckoutVersion(
    python,
    chromium,
    sourceLock.upstream.cef.version,
  );
  // The shared apply command verifies clean pinned repositories, every input,
  // and git apply --check before making any source change.
  await call(
    process.execPath,
    [
      patched,
      "apply",
      "--lock",
      path.join(inputsRoot, "source-lock.json"),
      "--inputs",
      inputsRoot,
      "--cef",
      cef,
      "--chromium",
      chromium,
      "--depot-tools",
      depot,
    ],
    "apply",
  );
  const commands = boundedBuildCommands(recipe, runner.buildJobs);
  await writeFile(
    path.join(logs, "build-recipe.json"),
    stableJson({ ...recipe, commands }),
    { flag: "wx" },
  );
  Object.assign(childEnv, recipe.environment);
  for (const [index, step] of commands.entries()) {
    if (step.executable !== "python3")
      fail("Unexpected reviewed recipe executable");
    await call(python, step.args, `build-${index}`, step.cwd);
  }
  const distributions = (
    await readdir(path.join(cef, "binary_distrib"), { withFileTypes: true })
  ).filter(
    (entry) =>
      entry.isDirectory() && /^cef_binary_.+_minimal$/.test(entry.name),
  );
  if (distributions.length !== 1)
    fail("Expected exactly one new minimal CEF SDK distribution");
  const archiveRoot = distributions[0].name;
  const sdk = await flattenSdk(
    path.join(cef, "binary_distrib", archiveRoot),
    path.join(work, archiveRoot),
    sourceLock,
    inputsRoot,
  );
  await writeFile(
    path.join(bundle, "source-lock.json"),
    stableJson(sourceLock),
    { flag: "wx" },
  );
  await call(
    python,
    ["-I", "-c", PACK_PYTHON, sdk, path.join(bundle, identity.archive)],
    "package",
  );
  await measure(path.join(bundle, identity.archive)); // Fail oversized output before any upload.
  await inventoryCustomArtifact({
    lock: path.join(bundle, "source-lock.json"),
    target,
    sdk,
    "artifact-root": bundle,
    archive: identity.archive,
    manifest: "manifest.json",
    receipt: "receipt.json",
  });
  await call(
    python,
    [
      "-I",
      path.join(checkout, "scripts/lib/extract-custom-runtime.py"),
      path.join(bundle, identity.archive),
      path.join(work, "roundtrip"),
      path.join(bundle, "manifest.json"),
      target,
      archiveRoot,
      String(RELEASE_LIMITS.expanded),
      String(RELEASE_LIMITS.members),
    ],
    "roundtrip",
  );
  await preflightCustomRuntime({
    sourceLock,
    manifest: await json(path.join(bundle, "manifest.json")),
    target,
    artifactRoot: bundle,
    sdkRoot: path.join(work, "roundtrip", archiveRoot),
  });
  const descriptor = await descriptorFor({
    bundle,
    sourceLock,
    target,
    repository,
    archiveRoot,
  });
  await writeFile(path.join(bundle, "runtime.json"), stableJson(descriptor), {
    flag: "wx",
  });
  const result = {
    target,
    key: identity.key,
    bundle,
    logs,
    descriptorSha256: (await measure(path.join(bundle, "runtime.json"))).sha256,
    archiveSdkRelationship: "extracted-and-inventory-verified",
    nativeAcceptance: "not-tested",
    productionReady: false,
  };
  await writeFile(path.join(logs, "result.json"), stableJson(result), {
    flag: "wx",
  });
  return result;
}

export async function verifyBundle(bundle, repository) {
  const descriptorFile = path.join(bundle, "runtime.json");
  const descriptorPin = await measure(
    descriptorFile,
    RELEASE_LIMITS.descriptor,
  );
  const descriptor = validateRuntimeReleaseDescriptor(
    await json(descriptorFile),
  );
  for (const field of FIELDS) await pinned(bundle, descriptor[field]);
  const sourceLock = validateSourceLock(
    await json(path.join(bundle, descriptor.sourceLock.path)),
  );
  const identity = releaseIdentity(sourceLock, descriptor.target);
  const base = `https://github.com/${repositoryName(repository)}/releases/download/${identity.tag}`;
  validateRuntimeReleaseDescriptor(descriptor, {
    descriptorUrl: `${base}/runtime.json`,
  });
  const manifest = await json(path.join(bundle, descriptor.manifest.path));
  const artifact = bindRuntimeRelease(descriptor, manifest, sourceLock);
  const receipt = await json(path.join(bundle, descriptor.receipt.path));
  const expected = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-build-receipt",
    target: descriptor.target,
    sourceLockSha256: identity.sourceLockSha256,
    archiveSha256: descriptor.archive.sha256,
    sdkInventorySha256: identitySha256(artifact.sdkFiles),
    buildInputsSha256: identitySha256(
      sourceLock.builds.find((item) => item.target === descriptor.target),
    ),
  };
  if (stableJson(receipt) !== stableJson(expected))
    fail("Build receipt does not bind complete release inventory/inputs");
  const assets = [
    ...FIELDS.map((field) => ({
      ...descriptor[field],
      file: path.join(bundle, descriptor[field].path),
      name: path.basename(descriptor[field].path),
    })),
    { ...descriptorPin, file: descriptorFile, name: "runtime.json" },
  ];
  if (assets.some((item) => item.size > MAX_RELEASE_ASSET))
    fail("Release asset exceeds GitHub 2 GiB bound");
  return {
    descriptor,
    identity,
    assets,
    descriptorUrl: `${base}/runtime.json`,
    descriptorSha256: descriptorPin.sha256,
  };
}

// An injected transport makes publication fully fixture-testable without any
// release writes. Production always uses the fixed github.com API origins below.
export function githubClient(repository, token, request = fetch) {
  repositoryName(repository);
  if (!token) fail("GH_TOKEN required for explicit release operation");
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json",
  };
  const api = async (method, route, body, allow404 = false) => {
    const response = await request(
      `https://api.github.com/repos/${repository}${route}`,
      {
        method,
        redirect: "error",
        headers: { ...headers, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (allow404 && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail(`GitHub ${method} failed: HTTP ${response.status}`);
    }
    return response.json();
  };
  return {
    get: (tag) =>
      api("GET", `/releases/tags/${encodeURIComponent(tag)}`, undefined, true),
    create: (value) => api("POST", "/releases", value),
    finalize: (id) =>
      api("PATCH", `/releases/${id}`, {
        draft: false,
        prerelease: true,
        make_latest: "false",
      }),
    async assets(id) {
      const result = [];
      for (let page = 1; page <= 10; page++) {
        const entries = await api(
          "GET",
          `/releases/${id}/assets?per_page=100&page=${page}`,
        );
        result.push(...entries);
        if (entries.length < 100) return result;
      }
      fail("Unexpected excessive release asset inventory");
    },
    async digest(asset) {
      const route = `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`;
      let response = await request(route, {
        headers: { ...headers, Accept: "application/octet-stream" },
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        const url = new URL(location);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          url.hash ||
          ![
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
          ].includes(url.hostname)
        )
          fail("Unsafe release download redirect");
        // Signed storage URL receives no repository token.
        response = await request(url.href, {
          redirect: "error",
          signal: AbortSignal.timeout(30 * 60_000),
        });
      }
      if (!response.ok) {
        await response.body?.cancel();
        fail(`Release byte comparison failed: HTTP ${response.status}`);
      }
      const digest = createHash("sha256");
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_RELEASE_ASSET || size > asset.size)
          fail("Remote asset exceeds declared size");
        digest.update(chunk);
      }
      return { size, sha256: digest.digest("hex") };
    },
    async upload(id, asset) {
      const body = createReadStream(asset.file);
      try {
        const response = await request(
          `https://uploads.github.com/repos/${repository}/releases/${id}/assets?name=${encodeURIComponent(asset.name)}`,
          {
            method: "POST",
            redirect: "error",
            headers: {
              ...headers,
              "Content-Type": "application/octet-stream",
              "Content-Length": String(asset.size),
            },
            body,
            duplex: "half",
            signal: AbortSignal.timeout(30 * 60_000),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          fail(
            `New asset upload failed: HTTP ${response.status}; existing bytes preserved`,
          );
        }
        return response.json();
      } finally {
        body.destroy();
      }
    },
  };
}

export async function publish({ bundle, repository, execute, commit }, client) {
  if (!execute) fail("publish requires --execute");
  if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
    fail("Explicit trusted workflow commit required");
  const checked = await verifyBundle(bundle, repository);
  const tag = checked.identity.tag;
  let release = await client.get(tag);
  if (release && (!release.prerelease || release.tag_name !== tag))
    fail("Existing release is not the expected engineering prerelease");
  if (!release)
    release = await client.create({
      tag_name: tag,
      target_commitish: commit,
      name: tag,
      draft: true,
      prerelease: true,
      body: "Engineering patched CEF SDK. Source/inventory hashes bind bytes, not publisher authenticity or native TLS/sandbox acceptance. No production admission grant. Review runtime.json SHA-256 independently before catalog use.",
      make_latest: "false",
    });
  const existing = await client.assets(release.id);
  const expectedNames = new Set(checked.assets.map((asset) => asset.name));
  if (
    existing.some((asset) => !expectedNames.has(asset.name)) ||
    new Set(existing.map((asset) => asset.name)).size !== existing.length
  )
    fail(
      "Unexpected/duplicate assets on immutable release; preserved for review",
    );
  const missing = [];
  // Compare ALL existing assets before writing even one new byte. Do not trust
  // filename, size, or a release-hosted digest as a substitute for actual bytes.
  for (const asset of checked.assets) {
    const previous = existing.find((item) => item.name === asset.name);
    if (!previous) {
      missing.push(asset);
      continue;
    }
    if (previous.state !== "uploaded" || previous.size !== asset.size)
      fail(`Existing immutable asset differs: ${asset.name}`);
    const actual = await client.digest(previous);
    if (actual.size !== asset.size || actual.sha256 !== asset.sha256)
      fail(`Existing immutable asset differs: ${asset.name}`);
  }
  if (!release.draft && missing.length)
    fail("Published immutable release is incomplete; will not mutate it");
  for (const asset of missing) {
    // runtime.json is last: no usable descriptor until every payload is present.
    await pinned(bundle, {
      path: path.relative(bundle, asset.file).replaceAll(path.sep, "/"),
      ...asset,
    });
    const uploaded = await client.upload(release.id, asset);
    const actual = await client.digest(uploaded);
    if (actual.size !== asset.size || actual.sha256 !== asset.sha256)
      fail(`Uploaded asset verification failed: ${asset.name}`);
  }
  if (release.draft) await client.finalize(release.id);
  return {
    descriptorUrl: checked.descriptorUrl,
    descriptorSha256: checked.descriptorSha256,
    uploaded: missing.length,
    reused: checked.assets.length - missing.length,
    prerelease: true,
    productionReady: false,
  };
}

export function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!command || command === "--help") return { command: "help" };
  if (!["plan", "build", "publish"].includes(command))
    fail("Unknown producer command");
  const options = { command };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (
      !args[i].startsWith("--") ||
      !["inputs", "target", "repository", "bundle", "execute"].includes(key) ||
      Object.hasOwn(options, key)
    )
      fail("Unknown/duplicate producer argument");
    if (key === "execute") options.execute = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail(`Missing ${key}`);
      options[key] = value;
    }
  }
  return options;
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArguments(argv);
  if (options.command === "help") return HELP;
  if (options.command === "plan") {
    const result = await plan(options);
    await output("matrix", JSON.stringify(result.matrix));
    return { matrix: result.matrix, productionReady: false };
  }
  // Defense in depth beyond workflow conditions. Local tests call pure helpers;
  // CLI source builds/publication are only explicit trusted default-branch jobs.
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== `refs/heads/${env.CEF_DEFAULT_BRANCH}` ||
    !env.CEF_DEFAULT_BRANCH ||
    env.GITHUB_REPOSITORY !== options.repository
  )
    fail("Trusted default-branch workflow_dispatch required");
  if (options.command === "build") return build(options, env);
  if (env.CEF_PUBLISH_APPROVED !== "true")
    fail("Protected publish job approval required");
  return publish(
    { ...options, commit: env.GITHUB_SHA },
    githubClient(options.repository, env.GH_TOKEN),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((result) =>
      process.stdout.write(
        typeof result === "string" ? result : stableJson(result),
      ),
    )
    .catch((error) => {
      console.error(`[cef-runtime-ci] ${error.message}`);
      process.exitCode = 1;
    });
