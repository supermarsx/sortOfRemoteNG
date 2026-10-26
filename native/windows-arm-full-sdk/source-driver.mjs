// Closed Windows ARM source/GN adapter. Import is inert; no compiler entry.
import fs from "node:fs/promises";
import {
  constants,
  openSync,
  writeSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const TARGET = "aarch64-pc-windows-msvc";
let sourceCloseFailure = false;
let sourceReportingFailure = false;
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const need = (ok, code) => {
  if (!ok) throw new Error(code);
};
const keys = (value, expected) =>
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
    "FULL_DRIVER_FIELDS",
  );

export function sourceBudget(
  context,
  p,
  now = Date.now,
  mono = performance.now.bind(performance),
) {
  const started = mono(),
    initial = Math.min(
      p.sourceGn.limits.wholeSeconds * 1000,
      context.wallWorkEnd * 1000 - now(),
    );
  need(Number.isFinite(initial) && initial > 0, "FULL_DRIVER_CLOCK");
  return {
    remaining() {
      const value = Math.min(
        context.wallWorkEnd * 1000 - now(),
        initial - (mono() - started),
      );
      need(Number.isFinite(value) && value > 0, "FULL_DRIVER_DEADLINE");
      return value;
    },
  };
}

export function reviewedHostTools(p) {
  keys(p.sourceGn.hostTools, ["node", "git"]);
  for (const role of ["node", "git"]) {
    const pin = p.sourceGn.hostTools[role];
    need(pin !== null, "FULL_HOST_TOOL_PIN_MISSING");
    keys(pin, ["path", "bytes", "sha256", "nlink"]);
    need(
      typeof pin.path === "string" &&
        /^C:\/[A-Za-z0-9 ./_-]+\/(?:node|git)\.exe$/.test(pin.path) &&
        !pin.path.split("/").some((x) => x === "." || x === "..") &&
        pin.path.endsWith(`/${role}.exe`) &&
        Number.isSafeInteger(pin.bytes) &&
        pin.bytes > 0 &&
        pin.bytes <= 256 * 1024 ** 2 &&
        /^[a-f0-9]{64}$/.test(pin.sha256) &&
        Number.isInteger(pin.nlink) &&
        pin.nlink >= 1 &&
        pin.nlink <= 8,
      "FULL_HOST_TOOL_PIN",
    );
  }
  return structuredClone(p.sourceGn.hostTools);
}

const signature = (s) =>
  [
    s.dev,
    s.ino,
    s.size,
    s.mtimeNs,
    s.ctimeNs,
    s.birthtimeNs,
    s.mode,
    s.nlink,
  ].join(":");
const shared = (s) =>
  [s.dev, s.ino, s.size, s.mtimeNs, s.birthtimeNs, s.nlink].join(":");
async function physical(file) {
  need(
    path.isAbsolute(file) &&
      !file
        .replaceAll("\\", "/")
        .split("/")
        .some((x) => x === "." || x === ".."),
    "FULL_DRIVER_PATH",
  );
  const resolved = await fs.realpath(file);
  need(
    resolved.replaceAll("\\", "/").toLowerCase() ===
      file.replaceAll("\\", "/").toLowerCase(),
    "FULL_DRIVER_ALIAS",
  );
  for (let at = file; ; at = path.dirname(at)) {
    need(!(await fs.lstat(at)).isSymbolicLink(), "FULL_DRIVER_LINK");
    if (path.dirname(at) === at) break;
  }
  return resolved;
}
async function held(file, cap, budget, pin) {
  budget.remaining();
  await physical(file);
  const before = await fs.lstat(file, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === BigInt(pin?.nlink ?? 1) &&
      before.size >= 0n &&
      before.size <= BigInt(cap),
    "FULL_DRIVER_FILE",
  );
  const fd = await fs.open(file, constants.O_RDONLY);
  let failed = false;
  try {
    const fdBefore = await fd.stat({ bigint: true });
    need(shared(before) === shared(fdBefore), "FULL_DRIVER_IDENTITY");
    const chunks = [],
      buffer = Buffer.alloc(65536);
    let total = 0;
    while (true) {
      budget.remaining();
      const { bytesRead } = await fd.read(
        buffer,
        0,
        Math.min(buffer.length, cap + 1 - total),
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
      need(total <= cap, "FULL_DRIVER_BOUND");
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const raw = Buffer.concat(chunks, total);
    need(
      signature(await fs.lstat(file, { bigint: true })) === signature(before) &&
        signature(await fd.stat({ bigint: true })) === signature(fdBefore) &&
        shared(before) === shared(fdBefore),
      "FULL_DRIVER_CHANGED",
    );
    if (pin)
      need(
        raw.length === pin.bytes && sha(raw) === pin.sha256,
        "FULL_DRIVER_PIN",
      );
    return raw;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      sourceCloseFailure = true;
      if (!failed) throw error;
    }
  }
}

export function sourcePaths(root, p) {
  need(
    p.sourceGn.mode === "source-gn" &&
      p.sourceGn.sourceId ===
        "b04bd747863065cb2cd5a52088ac36d24427b1e505b269c234d4ee5f444077be" &&
      p.sourceGn.namespace ===
        "native/cef-build-inputs/20261026-r5-capsule23-windows-arm64-cross-x64-external-webview/" &&
      p.sourceGn.compilerAllowed === false &&
      p.sourceGn.checkpointAllowed === false &&
      p.sourceGn.restoreAllowed === false &&
      p.sourceGn.sdkAllowed === false,
    "FULL_SOURCE_POLICY",
  );
  need(path.isAbsolute(root) && !/\s/.test(root), "FULL_SOURCE_WORKSPACE");
  const workspace = path.join(root, "source-checkout");
  return {
    workspace,
    chromium: path.join(workspace, "src"),
    cef: path.join(workspace, "src/cef"),
    depot: path.join(workspace, "depot_tools"),
    logs: path.join(root, "source-gn-logs"),
    inputs: path.join(REPO, p.sourceGn.namespace),
  };
}

// All top-level subprocesses are constructed here; callers cannot supply argv,
// cwd, target, compiler target, extra GN flags or environment overrides.
export function sourceCommands(root, p, hooks, contextPin) {
  const files = sourcePaths(root, p),
    tools = reviewedHostTools(p),
    python = p.python.path;
  need(
    Array.isArray(hooks) &&
      hooks.length === 5 &&
      hooks[0] === "-B" &&
      hooks[1] === "-c" &&
      typeof hooks[2] === "string" &&
      hooks[3] === path.join(files.cef, "tools/gclient_hook.py") &&
      hooks[4] === path.join(files.depot, "gn.py"),
    "FULL_HOOK_COMMAND",
  );
  need(/^[a-f0-9]{64}$/.test(contextPin), "FULL_CONTEXT_PIN");
  return Object.freeze(
    [
      {
        role: "sync",
        executable: python,
        cwd: files.workspace,
        args: [
          "-B",
          path.join(files.depot, "gclient.py"),
          "sync",
          "--jobs",
          "2",
          "--nohooks",
          "--no-history",
          "--revision",
          `src@${p.sourceChromium}`,
        ],
      },
      {
        role: "dependency-hooks",
        executable: python,
        cwd: files.workspace,
        args: [
          "-B",
          path.join(files.depot, "gclient.py"),
          "runhooks",
          "--jobs",
          "2",
        ],
      },
      ...["x86", "x64", "arm64"].map((cpu) => ({
        role: `setup-${cpu}`,
        executable: python,
        cwd: root,
        args: [
          "-I",
          "-B",
          path.join(files.chromium, "build/toolchain/win/setup_toolchain.py"),
          path.join(root, "custom-vs"),
          path.join(root, "Windows Kits/10"),
          path.join(root, "runtime/x64"),
          "win",
          cpu,
          `environment.${cpu}`,
        ],
      })),
      {
        role: "verify-setup",
        executable: python,
        cwd: root,
        args: [
          "-I",
          "-B",
          path.join(HERE, "producer.py"),
          "--verify-source-setup",
          root,
          contextPin,
          "--execute",
        ],
      },
      {
        role: "cef-gn",
        executable: python,
        cwd: files.chromium,
        args: [...hooks],
      },
    ].map((value) =>
      Object.freeze({
        ...value,
        args: Object.freeze(value.args),
        gitAuthority: tools.git.sha256,
      }),
    ),
  );
}

export function sourceEnvironment(root, p, recipe) {
  const files = sourcePaths(root, p),
    tools = reviewedHostTools(p);
  need(
    recipe.requiredHost === "win32" &&
      recipe.target === TARGET &&
      recipe.commands.length === 3 &&
      recipe.commands[0].args.length === 1 &&
      recipe.commands[0].args[0] === "cef/tools/gclient_hook.py",
    "FULL_RECIPE",
  );
  return {
    SystemRoot: "C:/Windows",
    WINDIR: "C:/Windows",
    ComSpec: "C:/Windows/System32/cmd.exe",
    PATH: [
      files.depot,
      path.dirname(p.python.path),
      path.dirname(tools.git.path),
      path.join(root, "llvm/bin"),
      path.join(root, "Windows Kits/10/bin", p.sdkVersion, "x64"),
      path.join(root, "runtime/x64"),
      "C:/Windows/System32/WindowsPowerShell/v1.0",
      "C:/Windows/System32",
      "C:/Windows",
    ].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    USERPROFILE: path.join(root, "home"),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPYCACHEPREFIX: "",
    DEPOT_TOOLS_UPDATE: "0",
    DEPOT_TOOLS_WIN_TOOLCHAIN: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GYP_MSVS_OVERRIDE_PATH: path.join(root, "custom-vs"),
    LOCALAPPDATA: path.join(root, "source-caches/local"),
    APPDATA: path.join(root, "source-caches/roaming"),
    XDG_CACHE_HOME: path.join(root, "source-caches/xdg"),
    CIPD_CACHE_DIR: path.join(root, "source-caches/cipd"),
    VPYTHON_VIRTUALENV_ROOT: path.join(root, "source-caches/vpython"),
    CIPD_CONFIG_FILE: path.join(root, "source-caches/cipd.cfg"),
    GYP_MSVS_VERSION: "2026",
    CEF_VCVARS: "none",
    CEF_ENABLE_ARM64: "1",
    WIN_CUSTOM_TOOLCHAIN: "1",
    VS_CRT_ROOT: path.join(root, "runtime/x64"),
    SDK_ROOT: path.join(root, "Windows Kits/10"),
    SDK_VERSION: p.sdkVersion,
    ...recipe.environment,
  };
}

export function validateGeneratedArguments(raw) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 1024 ** 2,
    "FULL_GN_ARGS_BOUND",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  need(!text.includes("\0"), "FULL_GN_ARGS_ENCODING");
  const expected = {
    target_cpu: '"arm64"',
    host_cpu: '"x64"',
    is_clang: "true",
    use_lld: "true",
    use_remoteexec: "false",
    use_siso: "true",
    is_component_build: "false",
    is_debug: "false",
    enable_backup_ref_ptr_instance_tracer: "false",
  };
  const seen = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([a-z][a-z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    if (Object.hasOwn(expected, match[1])) {
      need(
        !seen.has(match[1]) && match[2] === expected[match[1]],
        "FULL_GN_CRITICAL_ARGUMENT",
      );
      seen.set(match[1], match[2]);
    }
    if (/sandbox/.test(match[1]))
      need(match[2] === "true", "FULL_GN_SANDBOX_ARGUMENT");
  }
  need(seen.size === Object.keys(expected).length, "FULL_GN_CRITICAL_ARGUMENT");
  return {
    targetCpu: "arm64",
    hostCpu: "x64",
    criticalArgumentsVerified: true,
    instanceTracer: false,
    remoteExecution: false,
    generatedSecurityHeadersVerified: false,
    compilerAdmission: false,
  };
}

async function sourceStage(root, budget, stage, maximumSeconds, action) {
  need(
    (stage === "source-acquisition" && maximumSeconds === 4500) ||
      (stage === "source-hooks-gn" && maximumSeconds === 1800),
    "FULL_SOURCE_STAGE",
  );
  const allowed = Math.min(maximumSeconds * 1000, budget.remaining() - 120000);
  need(allowed > 0, "FULL_SOURCE_RESERVE");
  const began = performance.now();
  const timer = setTimeout(
    () => {
      const report = {
        kind: "windows-arm-source-stage-deadline",
        success: false,
        stage,
        firstFailure: "FULL_SOURCE_STAGE_DEADLINE",
        compilerExecuted: null,
        engineCompilationRequested: false,
        sdkBuilt: false,
        cleanupNotInferred: true,
      };
      try {
        writeFileSync(
          path.join(root, "source-deadline-result.json"),
          JSON.stringify(report) + "\n",
          { flag: "wx" },
        );
      } catch {
        sourceReportingFailure = true;
        try {
          writeSync(
            2,
            Buffer.from(
              JSON.stringify({
                ...report,
                reportingFailure: "FULL_SOURCE_REPORT",
              }) + "\n",
            ),
          );
        } catch {
          /* Preserve the deadline. */
        }
      }
      process.exit(124); // Actual enclosing Job terminates/reaps only this owned cohort.
    },
    Math.max(1, allowed),
  );
  try {
    const result = await action();
    budget.remaining();
    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function executeCommand(
  command,
  expected,
  env,
  files,
  budget,
  limits,
  capture,
) {
  need(expected.includes(command), "FULL_COMMAND_IDENTITY");
  budget.remaining();
  const descriptors = [];
  let child,
    timer,
    primary,
    failed = false,
    bytes = 0;
  try {
    const output = openSync(
      path.join(files.logs, `${command.role}.stdout.log`),
      "wx",
    );
    descriptors.push(output);
    const errorOutput = openSync(
      path.join(files.logs, `${command.role}.stderr.log`),
      "wx",
    );
    descriptors.push(errorOutput);
    const text = [];
    const outcome = await new Promise((resolve, reject) => {
      const deny = (error) => {
        if (!failed) {
          failed = true;
          primary = error;
        }
        reject(primary);
      };
      child = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const [stream, fd] of [
        [child.stdout, output],
        [child.stderr, errorOutput],
      ]) {
        stream.once("error", deny);
        stream.on("data", (chunk) => {
          try {
            budget.remaining();
            limits.bytes += chunk.length;
            bytes += chunk.length;
            need(
              limits.bytes <= limits.cap &&
                (!capture || bytes <= 4 * 1024 ** 2),
              "FULL_SOURCE_OUTPUT_BOUND",
            );
            need(
              writeSync(fd, chunk) === chunk.length,
              "FULL_SOURCE_LOG_WRITE",
            );
            if (capture && stream === child.stdout)
              text.push(Buffer.from(chunk));
          } catch (error) {
            deny(error);
          }
        });
      }
      child.once("error", deny);
      child.once("close", (code, signal) =>
        failed
          ? reject(primary)
          : code === 0 && signal === null
            ? resolve(code)
            : deny(new Error("FULL_SOURCE_CHILD_FAILED")),
      );
      timer = setTimeout(
        () => deny(new Error("FULL_DRIVER_DEADLINE")),
        Math.max(1, budget.remaining() - 120000),
      );
    });
    need(outcome === 0, "FULL_SOURCE_CHILD_FAILED");
    budget.remaining();
    return Buffer.concat(text).toString("utf8");
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    clearTimeout(timer);
    let closeError;
    for (const fd of descriptors)
      try {
        closeSync(fd);
      } catch (error) {
        sourceCloseFailure = true;
        closeError ??= error;
      }
    // No PID-name or root-only tree cleanup: failure exits this Node root and
    // the actual creation-bound enclosing Job terminates/reaps its own cohort.
    if (closeError && !failed) throw closeError;
  }
}

export async function main(argv = process.argv.slice(2)) {
  need(
    process.platform === "win32" &&
      process.arch === "x64" &&
      argv.length === 4 &&
      argv[0] === "--source-gn" &&
      /^[a-f0-9]{64}$/.test(argv[2]) &&
      argv[3] === "--execute",
    "FULL_DRIVER_ARGV",
  );
  const root = await physical(argv[1]);
  need(
    path.dirname(root) === path.join(REPO, ".artifacts") &&
      /^windows-arm-full-sdk-[a-f0-9-]{36}$/.test(path.basename(root)),
    "FULL_DRIVER_ROOT",
  );
  const provisional = { remaining: () => 1 };
  const raw = await held(path.join(root, "context.json"), 131072, provisional);
  need(sha(raw) === argv[2], "FULL_CONTEXT_PIN");
  const c = JSON.parse(raw);
  need(
    c.mode === "source-gn" &&
      c.ref === "refs/heads/codex/windows-arm-source-gn-20261026" &&
      c.repositoryId === "1010282954" &&
      c.visibility === "public" &&
      c.event === "workflow_dispatch",
    "FULL_DRIVER_AUTHORITY",
  );
  const profileRow = c.sources.find(
    (row) => row.path === "native/windows-arm-full-sdk/profile.json",
  );
  const p = JSON.parse(
    await held(path.join(HERE, "profile.json"), 65536, provisional, profileRow),
  );
  const budget = sourceBudget(c, p),
    tools = reviewedHostTools(p),
    files = sourcePaths(root, p);
  keys(p.sourceGn.executionPolicy, [
    "hostLoaderClosureApproved",
    "gitConfigurationApproved",
    "sourceHookCommandClosureApproved",
  ]);
  need(
    Object.values(p.sourceGn.executionPolicy).every((value) => value === true),
    "FULL_EXECUTION_POLICY_UNAVAILABLE",
  );
  need(
    p.phaseAdmission["source-gn"] === true,
    "FULL_SOURCE_ADMISSION_UNAVAILABLE",
  );
  need(
    c.sources.length === 11 && p.sourcePaths.length === 11,
    "FULL_DRIVER_SOURCES",
  );
  for (let i = 0; i < c.sources.length; i++) {
    const row = c.sources[i];
    need(row.path === p.sourcePaths[i], "FULL_DRIVER_SOURCES");
    await held(path.join(REPO, row.path), 2 * 1024 ** 2, budget, row);
  }
  for (const row of [...p.sourceGn.helpers, ...p.sourceGn.sourceData])
    await held(path.join(REPO, row.path), 2 * 1024 ** 2, budget, row);
  for (const pin of Object.values(tools))
    await held(pin.path, 256 * 1024 ** 2, budget, pin);
  need(
    (await fs.realpath(process.execPath)).toLowerCase() ===
      (await fs.realpath(tools.node.path)).toLowerCase(),
    "FULL_DRIVER_NODE",
  );
  const custom = await import(
    pathToFileURL(path.join(REPO, "scripts/lib/browser-custom-runtime.mjs"))
  );
  const patched = await import(
    pathToFileURL(path.join(REPO, "scripts/cef-patched-runtime.mjs"))
  );
  const runtime = await import(
    pathToFileURL(path.join(REPO, "scripts/cef-runtime-ci.mjs"))
  );
  const checkpoint = await import(
    pathToFileURL(path.join(REPO, "scripts/lib/cef-engineering-checkpoint.mjs"))
  );
  const lock = custom.validateSourceLock(
    JSON.parse(
      await held(path.join(files.inputs, "source-lock.json"), 65536, budget),
    ),
  );
  need(
    custom.identitySha256(lock) === p.sourceGn.sourceId,
    "FULL_SOURCE_IDENTITY",
  );
  const recipe = await custom.customRuntimeBuildRecipe({
    sourceLock: lock,
    target: TARGET,
    inputsRoot: files.inputs,
    checkouts: {
      chromium: files.chromium,
      cef: files.cef,
      depotTools: files.depot,
    },
  });
  await fs.mkdir(path.join(root, "source-caches"));
  for (const name of ["local", "roaming", "xdg", "cipd", "vpython"])
    await fs.mkdir(path.join(root, "source-caches", name));
  await fs.writeFile(path.join(root, "source-caches/cipd.cfg"), "", {
    flag: "wx",
  });
  const gitPolicy = await custom.prepareSourceGitIsolation(
    path.join(root, "cef-source-git-policy"),
  );
  const env = await custom.sourceGitEnvironment(
      gitPolicy,
      sourceEnvironment(root, p, recipe),
    ),
    commands = sourceCommands(
      root,
      p,
      runtime.cefHookArguments(files.cef, files.depot),
      argv[2],
    );
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  await fs.mkdir(files.logs);
  await fs.writeFile(
    path.join(files.logs, "command-plan.json"),
    JSON.stringify(
      {
        kind: "windows-arm-source-command-plan",
        sourceId: p.sourceGn.sourceId,
        helperSourceCommit: p.sourceGn.helpersSourceCommit,
        commands,
        acquisition: patched.acquisitionSourcePlan(files.workspace, TARGET),
        compilerAllowed: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  const limits = { bytes: 0, cap: p.sourceGn.limits.outputBytes };
  let stage = "source-acquire",
    primary,
    failed = false,
    success = false,
    graph = null,
    generatedArguments = null;
  const checked = async (action) => {
    await custom.sourceGitEnvironment(gitPolicy, env);
    let rejected = false;
    try {
      return await action();
    } catch (error) {
      rejected = true;
      throw error;
    } finally {
      try {
        await custom.sourceGitEnvironment(gitPolicy, env);
      } catch (error) {
        if (!rejected) throw error;
      }
    }
  };
  try {
    await sourceStage(root, budget, "source-acquisition", 4500, async () => {
      budget.remaining();
      await patched.acquireSources(
        files.workspace,
        TARGET,
        tools.git.path,
        gitPolicy,
      );
      budget.remaining();
      await runtime.prepareWindowsGitLauncher({
        depot: files.depot,
        gitExecutable: tools.git.path,
        logs: files.logs,
      });
      stage = commands[0].role;
      await checked(() =>
        executeCommand(
          commands[0],
          commands,
          env,
          files,
          budget,
          limits,
          false,
        ),
      );
    });
    await sourceStage(root, budget, "source-hooks-gn", 1800, async () => {
      stage = commands[1].role;
      await checked(() =>
        executeCommand(
          commands[1],
          commands,
          env,
          files,
          budget,
          limits,
          false,
        ),
      );
      await custom.verifySourceBuildIsolation(files.chromium);
      const checkouts = {
        chromium: files.chromium,
        cef: files.cef,
        depotTools: files.depot,
      };
      stage = "source-apply";
      await custom.applySourcePatches({
        sourceLock: lock,
        inputsRoot: files.inputs,
        checkouts,
        gitExecutable: tools.git.path,
        gitIsolation: gitPolicy,
      });
      for (const command of commands.slice(2, 5)) {
        stage = command.role;
        await checked(() =>
          executeCommand(command, commands, env, files, budget, limits, true),
        );
      }
      stage = "verify-setup";
      await checked(() =>
        executeCommand(
          commands[5],
          commands,
          env,
          files,
          budget,
          limits,
          false,
        ),
      );
      stage = "source-version";
      await checked(() =>
        custom.verifySourceCheckoutVersion(
          p.python.path,
          files.chromium,
          lock.upstream.cef.version,
        ),
      );
      await held(
        path.join(files.chromium, "buildtools/win/gn.exe"),
        16 * 1024 ** 2,
        budget,
        p.cipd[0].members.find((row) => row.name === "gn.exe"),
      );
      stage = "cef-gn";
      await checked(() =>
        executeCommand(
          commands[6],
          commands,
          env,
          files,
          budget,
          limits,
          false,
        ),
      );
      await held(
        path.join(files.chromium, "out/Release_GN_arm64/build.ninja"),
        16 * 1024 ** 2,
        budget,
      );
      generatedArguments = validateGeneratedArguments(
        await held(
          path.join(files.chromium, "out/Release_GN_arm64/args.gn"),
          1024 ** 2,
          budget,
        ),
      );
      stage = "graph-inventory";
      let snapshot;
      const maximum = Math.min(180000, Math.floor(budget.remaining() - 120000));
      need(maximum > 0, "FULL_SOURCE_RESERVE");
      graph = await checkpoint.graphInventory(
        path.join(files.chromium, "out/Release_GN_arm64"),
        {
          timeoutMs: maximum,
          observePins: (value) => {
            snapshot = checkpoint.graphPinSnapshot(value);
          },
        },
      );
      need(snapshot !== undefined, "FULL_GRAPH_PINS");
      budget.remaining();
      await fs.writeFile(
        path.join(files.logs, "fresh-graph-pins.json"),
        JSON.stringify(snapshot) + "\n",
        { flag: "wx" },
      );
      budget.remaining();
    });
    success = true;
  } catch (error) {
    failed = true;
    primary = error;
    throw error;
  } finally {
    const code =
      typeof primary?.message === "string" &&
      /^(?:FULL|SOURCE_GIT)_[A-Z_]{1,56}$/.test(primary.message)
        ? primary.message
        : failed
          ? "FULL_SOURCE_FAILED"
          : null;
    const report = {
      kind: "windows-arm-source-gn",
      success,
      stage,
      firstFailure: code,
      target: TARGET,
      sourceId: p.sourceGn.sourceId,
      graph,
      generatedArguments,
      compilerExecuted: null,
      engineCompilationRequested: false,
      engineCheckpointImplemented: false,
      sdkBuilt: false,
      nativeAcceptance: false,
      sourceCloseFailure,
      gitPolicy: custom.sourceGitIsolationEvidence(gitPolicy),
      outerJobCleanupNotInferred: true,
    };
    try {
      await fs.writeFile(
        path.join(root, "source-gn-result.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx" },
      );
    } catch (error) {
      sourceReportingFailure = true;
      if (!failed) throw error;
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const code = /^(?:FULL|SOURCE_GIT)_[A-Z_]{1,56}$/.test(error?.message ?? "")
      ? error.message
      : "FULL_SOURCE_UNAVAILABLE";
    console.error(
      JSON.stringify({
        success: false,
        firstFailure: code,
        sourceCloseFailure,
        sourceReportingFailure,
        sdkBuilt: false,
      }),
    );
    // Enclosing actual Job owns/reaps all descendants, including a command
    // whose pipes remain open after an earlier stream/log/clock failure.
    process.exit(1);
  });
}
