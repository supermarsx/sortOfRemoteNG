// t91: the isolated e2e build script, the §7 isolation self-test and the
// README capture isolation. Every process, OS query and clock is injected;
// no cargo, app binary, WDIO, PowerShell, reg.exe or taskkill process starts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import * as build from "../../scripts/e2e-build.mjs";
import * as selftest from "../../scripts/e2e-isolation-selftest.mjs";
import * as iso from "../../scripts/lib/e2e-profile-isolation.mjs";
import type {
  ClassifiedProcess,
  EnvRecord,
  Exec,
  ExecResult,
  ProfileProbe,
  SpawnSyncLike,
} from "../../scripts/lib/e2e-profile-isolation.mjs";
import * as readme from "../../scripts/readme-screenshot.mjs";

const repoRoot = process.cwd();
const E2E = iso.E2E_IDENTIFIER;
const README = iso.README_CAPTURE_IDENTIFIER;
const PROD = iso.PRODUCTION_IDENTIFIER;
const EXE = process.platform === "win32" ? "app.exe" : "app";

// ── fixtures ────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "sorng-e2e-scripts-")),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeFile(file: string, content: string | Buffer = "x"): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function markerBinary(file: string, markers: string[]): string {
  const parts: Buffer[] = [Buffer.alloc(2048, 7)];
  for (const identifier of markers) {
    parts.push(Buffer.from(iso.profileMarkerFor(identifier), "latin1"));
    parts.push(Buffer.alloc(1024, 3));
  }
  return writeFile(file, Buffer.concat(parts));
}

async function writeManifest(binary: string, identifier = E2E) {
  const { sha256, size } = await iso.inspectProfileBinary(binary);
  writeFile(
    path.join(path.dirname(binary), iso.E2E_BUILD_MANIFEST_FILE),
    JSON.stringify({
      schema: iso.E2E_BUILD_MANIFEST_SCHEMA,
      identifier,
      exe: path.basename(binary),
      sha256,
      size,
    }),
  );
}

function captureLog() {
  const lines: { level: string; message: string }[] = [];
  return {
    lines,
    text: () => lines.map(({ message }) => message).join("\n"),
    log: {
      info: (message: string) => lines.push({ level: "info", message }),
      warn: (message: string) => lines.push({ level: "warn", message }),
      error: (message: string) => lines.push({ level: "error", message }),
    },
  };
}

function flagValue(args: readonly string[]): string | null {
  const prefix = `${iso.WEBVIEW2_FOLDER_ARG}=`;
  const flag = args.find((arg) => arg.startsWith(prefix));
  return flag ? flag.slice(prefix.length) : null;
}

interface Layout {
  roaming: string;
  local: string;
  home: string;
}

function buildProbe(
  layout: Layout,
  {
    identifier = E2E,
    folder = null,
    source = "tauri-default",
  }: {
    identifier?: string;
    folder?: string | null;
    source?: "arg" | "env" | "tauri-default";
  } = {},
): ProfileProbe {
  const dirsFor = (id: string) => ({
    appData: path.join(layout.roaming, id),
    appLocalData: path.join(layout.local, id),
    appConfig: path.join(layout.roaming, id),
    appCache: path.join(layout.local, id),
    appLog: path.join(layout.local, id, "logs"),
  });
  const dirs = dirsFor(identifier);
  return {
    schema: "sorng-profile-probe/v1",
    marker: iso.profileMarkerFor(identifier),
    identifier,
    kind: "isolated",
    keychainNamespace: `@${identifier}`,
    autostartName: `sortOfRemoteNG (${identifier})`,
    dirs,
    productionDirs: dirsFor(PROD),
    webview2: {
      userDataFolder: folder,
      source,
      tauriDefault: dirs.appLocalData,
      productionDefault: path.join(layout.local, PROD),
    },
    sshHome: path.join(dirs.appData, "ssh-home"),
    pid: 4242,
  };
}

/**
 * The launch-input decisions of `src-tauri/src/app_profile.rs` (expectation,
 * then WebView2 folder), so refusal controls meet a faithful guard.
 */
function fakeGuard(
  args: readonly string[],
  env: EnvRecord,
  layout: Layout,
  identifier: string = E2E,
):
  | { refused: true; message: string }
  | {
      refused: false;
      folder: string | null;
      source: "arg" | "env" | "tauri-default";
    } {
  const expect = env[iso.EXPECT_ISOLATED_PROFILE_ENV];
  if (expect !== undefined && expect !== identifier) {
    return { refused: true, message: "expectation mismatch" };
  }
  const production = [
    path.join(layout.local, PROD),
    path.join(layout.roaming, PROD),
  ];
  const unsafe = (folder: string) =>
    production.some((root) => iso.isSameOrInside(folder, root));
  const flag = flagValue(args);
  const inherited = env[iso.WEBVIEW2_USER_DATA_FOLDER_ENV];
  if (flag !== null) {
    if (unsafe(flag)) {
      return { refused: true, message: "inside the production profile" };
    }
    if (inherited && !iso.samePath(flag, inherited)) {
      return { refused: true, message: "flag disagrees with the env" };
    }
    return { refused: false, folder: flag, source: "arg" };
  }
  if (inherited) {
    return unsafe(inherited)
      ? { refused: true, message: "inside the production profile" }
      : { refused: false, folder: inherited, source: "env" };
  }
  if (expect !== undefined) {
    return {
      refused: true,
      message: "harness runs require a per-run WebView2 folder",
    };
  }
  return { refused: false, folder: null, source: "tauri-default" };
}

// ── e2e-build: arguments and plan ───────────────────────────────────────────

describe("e2e-build arguments", () => {
  it("parses its own flags and passes tauri arguments through", () => {
    expect(build.parseBuildArgs([])).toEqual({
      help: false,
      reuseFrontend: false,
      dryRun: false,
      passthrough: [],
    });
    expect(
      build.parseBuildArgs([
        "--reuse-frontend",
        "--dry-run",
        "--",
        "--features",
        "full",
        "--",
        "--locked",
      ]),
    ).toEqual({
      help: false,
      reuseFrontend: true,
      dryRun: true,
      passthrough: ["--features", "full", "--", "--locked"],
    });
    expect(build.parseBuildArgs(["-h"]).help).toBe(true);
  });

  it("refuses unknown flags as usage errors", () => {
    let error: unknown;
    try {
      build.parseBuildArgs(["--features", "full"]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(build.E2eBuildError);
    expect((error as { usage: boolean }).usage).toBe(true);
  });

  it.each([
    ["--config", "identity"],
    ["-c", "identity"],
    ['--config={"identifier":"com.sortofremote.ng"}', "identity"],
    ["-csrc-tauri/tauri.conf.json", "identity"],
    ["--release", "debug build"],
    ["-r", "debug build"],
    ["--target-dir", build.E2E_CARGO_TARGET_DIR_ENV],
    ["--target-dir=src-tauri/target", build.E2E_CARGO_TARGET_DIR_ENV],
    ["--bundles", "never bundles"],
    ["-b", "never bundles"],
  ])("refuses the passthrough argument %s", (arg, why) => {
    expect(() => build.parseBuildArgs(["--", arg])).toThrow(why);
    expect(() => build.parseBuildArgs(["--", "--", arg])).toThrow(why);
  });

  it("finds the target triple that changes the executable location", () => {
    expect(build.targetTripleFrom([])).toBeNull();
    expect(build.targetTripleFrom(["--target", "x86_64-pc-windows-msvc"])).toBe(
      "x86_64-pc-windows-msvc",
    );
    expect(build.targetTripleFrom(["-t", "aarch64-apple-darwin"])).toBe(
      "aarch64-apple-darwin",
    );
    expect(build.targetTripleFrom(["--target=wasm"])).toBe("wasm");
    expect(build.targetTripleFrom(["--", "--target", "cargo-only"])).toBeNull();
    expect(() => build.targetTripleFrom(["--target"])).toThrow("triple");
  });
});

describe("e2e-build target and command", () => {
  it("defaults to the dedicated .artifacts/e2e/target", () => {
    const root = tempDir();
    expect(build.resolveE2eTargetDir({ repoRoot: root, env: {} })).toBe(
      path.join(root, ".artifacts", "e2e", "target"),
    );
    expect(
      build.resolveE2eTargetDir({
        repoRoot: root,
        env: { [build.E2E_CARGO_TARGET_DIR_ENV]: "custom/target" },
      }),
    ).toBe(path.join(root, "custom", "target"));
    const outside = path.join(tempDir(), "t");
    expect(
      build.resolveE2eTargetDir({
        repoRoot: root,
        env: { [build.E2E_CARGO_TARGET_DIR_ENV]: outside },
      }),
    ).toBe(outside);
  });

  it.each([
    ["the shared src-tauri/target", ["src-tauri", "target"]],
    ["a sub folder of src-tauri/target", ["src-tauri", "target", "e2e"]],
    ["another folder inside src-tauri", ["src-tauri", "target-e2e"]],
    [
      "a worktree's src-tauri/target",
      [".claude", "worktrees", "w1", "src-tauri", "target"],
    ],
  ])("refuses %s", (_label, segments) => {
    const root = tempDir();
    expect(() =>
      build.resolveE2eTargetDir({
        repoRoot: root,
        env: { [build.E2E_CARGO_TARGET_DIR_ENV]: path.join(root, ...segments) },
      }),
    ).toThrow(/refusing Cargo target[\s\S]*tauri dev/);
  });

  it("builds the e2e config in debug without bundling", () => {
    const root = tempDir();
    const { command, args } = build.buildTauriCommand({
      repoRoot: root,
      nodePath: "node-bin",
    });
    expect(command).toBe("node-bin");
    expect(args).toEqual([
      path.join(root, "scripts", "native-build-env.mjs"),
      "node-bin",
      path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "build",
      "--debug",
      "--no-bundle",
      "--config",
      "src-tauri/tauri.e2e.conf.json",
    ]);
    const reuse = build.buildTauriCommand({
      repoRoot: root,
      nodePath: "node-bin",
      reuseFrontend: true,
      passthrough: ["--features", "full"],
    });
    expect(reuse.args.slice(6)).toEqual([
      "--config",
      "src-tauri/tauri.e2e.conf.json",
      "--config",
      '{"build":{"beforeBuildCommand":""}}',
      "--features",
      "full",
    ]);
    expect(JSON.parse(build.REUSE_FRONTEND_CONFIG)).toEqual({
      build: { beforeBuildCommand: "" },
    });
  });

  it("sets the dedicated target and drops an inherited TAURI_CONFIG", () => {
    const env = { PATH: "p", TAURI_CONFIG: '{"identifier":"x"}' };
    expect(build.buildEnvironment({ env, targetDir: "T" })).toEqual({
      PATH: "p",
      CARGO_TARGET_DIR: "T",
    });
    expect(env.TAURI_CONFIG).toBeDefined();
  });

  it("uses the e2e overlay that the harness expects", () => {
    const overlay = JSON.parse(
      fs.readFileSync(path.join(repoRoot, build.E2E_TAURI_CONFIG), "utf8"),
    );
    expect(overlay.identifier).toBe(E2E);
    expect(overlay.bundle.active).toBe(false);
  });
});

describe("e2e-build frontend preflight", () => {
  it("requires out/index.html for --reuse-frontend and warns when it predates HEAD", () => {
    const root = tempDir();
    expect(() =>
      build.frontendPreflight({ repoRoot: root, reuseFrontend: true }),
    ).toThrow("npm run build");
    const index = writeFile(path.join(root, "out", "index.html"));
    const mtime = fs.statSync(index).mtimeMs;
    expect(
      build.frontendPreflight({
        repoRoot: root,
        reuseFrontend: true,
        headCommitTimeMs: mtime - 60_000,
      }).warnings,
    ).toEqual([]);
    expect(
      build.frontendPreflight({
        repoRoot: root,
        reuseFrontend: true,
        headCommitTimeMs: mtime + 60_000,
      }).warnings[0],
    ).toContain("older than the HEAD commit");
  });

  it("refuses npm run build while a browser dev server holds .next, not for managed tauri dev", () => {
    const root = tempDir();
    writeFile(path.join(root, ".next-tauri-dev", "dev", "lock"));
    expect(
      build.frontendPreflight({ repoRoot: root, reuseFrontend: false }),
    ).toEqual({ warnings: [] });
    writeFile(path.join(root, ".next", "dev", "lock"));
    expect(() =>
      build.frontendPreflight({ repoRoot: root, reuseFrontend: false }),
    ).toThrow("--reuse-frontend");
    writeFile(path.join(root, "out", "index.html"));
    expect(
      build.frontendPreflight({ repoRoot: root, reuseFrontend: true }).warnings,
    ).toEqual([]);
  });

  it("warns about resources only the production beforeBuildCommand stages", () => {
    const root = tempDir();
    expect(build.stagedResourceWarnings({ repoRoot: root })).toHaveLength(2);
    for (const { source } of build.STAGED_RESOURCE_SOURCES) {
      fs.mkdirSync(path.join(root, source), { recursive: true });
    }
    expect(build.stagedResourceWarnings({ repoRoot: root })).toEqual([]);
  });
});

describe("e2e-build copy plan", () => {
  it("selects the newest built executable", () => {
    const root = tempDir();
    const candidates = build.builtExecutableCandidates({
      targetDir: root,
      platform: "win32",
    });
    expect(candidates).toEqual([
      path.join(root, "debug", "app.exe"),
      path.join(root, "debug", "sortOfRemoteNG.exe"),
    ]);
    expect(
      build.builtExecutableCandidates({
        targetDir: root,
        triple: "aarch64-unknown-linux-gnu",
        platform: "linux",
      }),
    ).toEqual([
      path.join(root, "aarch64-unknown-linux-gnu", "debug", "app"),
      path.join(root, "aarch64-unknown-linux-gnu", "debug", "sortOfRemoteNG"),
    ]);
    expect(() => build.selectBuiltExecutable(candidates)).toThrow(
      "without an executable",
    );
    const older = writeFile(candidates[0]);
    const newer = writeFile(candidates[1]);
    fs.utimesSync(older, new Date(1_000_000), new Date(1_000_000));
    expect(build.selectBuiltExecutable(candidates)).toBe(newer);
    fs.utimesSync(newer, new Date(500_000), new Date(500_000));
    expect(build.selectBuiltExecutable(candidates)).toBe(older);
  });

  it("copies the executable, runtime resource folders and libraries only", () => {
    const root = tempDir();
    const debug = path.join(root, "target", "debug");
    const exe = writeFile(path.join(debug, "app.exe"), "exe");
    writeFile(path.join(debug, "opkssh", "opkssh.exe"));
    writeFile(path.join(debug, "file-viewer", "windows-amd64", "host.exe"));
    writeFile(path.join(debug, "locales", "en.json"));
    writeFile(path.join(debug, "wintun.dll"));
    writeFile(path.join(debug, "sorng_opkssh_vendor.dll"));
    writeFile(path.join(debug, "app.pdb"));
    writeFile(path.join(debug, "deps", "libx.rlib"));
    writeFile(path.join(debug, "build", "out.txt"));

    const plan = build.planArtifactCopy({
      sourceExe: exe,
      repoRoot: root,
      now: new Date("2026-09-15T17:30:12.345Z"),
      shortSha: "0123456789ab",
      platform: "win32",
    });
    const binDir = path.join(
      root,
      ".artifacts",
      "e2e",
      "bin",
      "20260915T173012Z-0123456789ab",
    );
    expect(plan.binDir).toBe(binDir);
    expect(plan.exe).toEqual({ from: exe, to: path.join(binDir, "app.exe") });
    expect(plan.directories.map(({ to }) => path.basename(to))).toEqual([
      "file-viewer",
      "locales",
      "opkssh",
    ]);
    expect(plan.libraries.map(({ to }) => path.basename(to))).toEqual([
      "sorng_opkssh_vendor.dll",
      "wintun.dll",
    ]);

    const created: string[] = [];
    const copied = build.executeArtifactCopy(plan, {
      onCreated: () => created.push(plan.binDir),
    });
    expect(created).toEqual([binDir]);
    expect(copied).toBe(path.join(binDir, "app.exe"));
    expect(fs.readdirSync(binDir).sort()).toEqual([
      "app.exe",
      "file-viewer",
      "locales",
      "opkssh",
      "sorng_opkssh_vendor.dll",
      "wintun.dll",
    ]);
    expect(
      fs.existsSync(
        path.join(binDir, "file-viewer", "windows-amd64", "host.exe"),
      ),
    ).toBe(true);

    const again: string[] = [];
    expect(() =>
      build.executeArtifactCopy(plan, { onCreated: () => again.push("x") }),
    ).toThrow("cannot create");
    expect(again).toEqual([]);
    expect(build.utcStamp(new Date("2026-01-02T03:04:05.006Z"))).toBe(
      "20260102T030405Z",
    );
  });

  it("writes a manifest the harness validates", async () => {
    const root = tempDir();
    const binary = markerBinary(path.join(root, "bin", "app.exe"), [E2E]);
    const verified = await iso.assertIsolatedBinary({
      binary,
      expectedIdentifier: E2E,
    });
    const manifest = build.createBuildManifest({
      verifiedBinary: verified,
      builtAt: new Date("2026-09-15T00:00:00Z"),
      git: { head: "a".repeat(40), dirty: true },
      targetDir: "T",
      args: ["node", "tauri.js"],
      sourceExe: "S",
      plan: {
        directories: [{ to: "x/opkssh" }],
        libraries: [{ to: "x/a.dll" }],
      },
    });
    expect(manifest).toMatchObject({
      schema: "sorng-e2e-build-manifest/v1",
      identifier: E2E,
      exe: "app.exe",
      sha256: verified.sha256,
      size: verified.size,
      builtAt: "2026-09-15T00:00:00.000Z",
      gitHead: "a".repeat(40),
      gitDirty: true,
      targetDir: "T",
      resources: ["opkssh"],
      libraries: ["a.dll"],
    });
    expect(
      iso.validateBuildManifest(manifest, {
        expectedIdentifier: E2E,
        binary,
        sha256: verified.sha256,
        size: verified.size,
      }),
    ).toBe(manifest);
  });

  it("reads git state without failing outside a repository", () => {
    const calls: string[][] = [];
    const exec: Exec = (_file, args) => {
      calls.push([...args]);
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: `${"b".repeat(40)}\n` };
      }
      if (args[0] === "log") {
        return { status: 0, stdout: "1757937600\n" };
      }
      return { status: 0, stdout: " M src/x.ts\n" };
    };
    expect(build.readGitState({ repoRoot, exec })).toEqual({
      head: "b".repeat(40),
      shortSha: "b".repeat(12),
      commitTimeMs: 1_757_937_600_000,
      dirty: true,
    });
    expect(calls.map((args) => args[0])).toEqual([
      "rev-parse",
      "log",
      "status",
    ]);
    expect(
      build.readGitState({ repoRoot, exec: () => ({ status: 128 }) }),
    ).toEqual({ head: null, shortSha: null, commitTimeMs: null, dirty: null });
  });
});

describe("e2e-build main", () => {
  function buildScenario(markers: string[] = [E2E]) {
    const root = tempDir();
    writeFile(path.join(root, "out", "index.html"));
    for (const { source } of build.STAGED_RESOURCE_SOURCES) {
      fs.mkdirSync(path.join(root, source), { recursive: true });
    }
    const runs: { command: string; args: string[]; env: EnvRecord }[] = [];
    let buildExit = 0;
    const run = async (
      command: string,
      args: string[],
      { env }: { env: EnvRecord },
    ) => {
      runs.push({ command, args, env });
      const debug = path.join(env.CARGO_TARGET_DIR as string, "debug");
      markerBinary(path.join(debug, EXE), markers);
      writeFile(path.join(debug, "locales", "en.json"));
      writeFile(path.join(debug, "app.d"));
      return { code: buildExit, signal: null };
    };
    const exec: Exec = (_file, args) =>
      args[0] === "rev-parse"
        ? { status: 0, stdout: `${"c".repeat(40)}\n` }
        : args[0] === "log"
          ? { status: 0, stdout: "1\n" }
          : { status: 0, stdout: "" };
    const logs = captureLog();
    const deps = {
      repoRoot: root,
      env: { PATH: "p", TAURI_CONFIG: "{}" } as EnvRecord,
      nodePath: "node-bin",
      run,
      exec,
      now: () => new Date("2026-09-15T12:00:00Z"),
      log: logs.log,
    };
    const binRoot = path.join(root, ".artifacts", "e2e", "bin");
    return {
      root,
      runs,
      logs,
      deps,
      binRoot,
      failBuild: (code: number) => {
        buildExit = code;
      },
    };
  }

  it("builds into the dedicated target, copies, verifies and records the binary", async () => {
    const s = buildScenario();
    expect(await build.main(["--reuse-frontend"], s.deps)).toBe(0);

    expect(s.runs).toHaveLength(1);
    const [invocation] = s.runs;
    expect(invocation.command).toBe("node-bin");
    expect(invocation.args).toContain("src-tauri/tauri.e2e.conf.json");
    expect(invocation.args).toContain(build.REUSE_FRONTEND_CONFIG);
    expect(invocation.env.CARGO_TARGET_DIR).toBe(
      path.join(s.root, ".artifacts", "e2e", "target"),
    );
    expect(invocation.env.TAURI_CONFIG).toBeUndefined();

    const binDir = path.join(s.binRoot, "20260915T120000Z-cccccccccccc");
    const binary = path.join(binDir, EXE);
    expect(fs.readdirSync(binDir).sort()).toEqual(
      [EXE, iso.E2E_BUILD_MANIFEST_FILE, "locales"].sort(),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(binDir, iso.E2E_BUILD_MANIFEST_FILE), "utf8"),
    );
    expect(manifest).toMatchObject({
      identifier: E2E,
      exe: EXE,
      gitHead: "c".repeat(40),
      gitDirty: false,
      targetDir: path.join(s.root, ".artifacts", "e2e", "target"),
    });
    const verified = await iso.assertIsolatedBinary({
      binary,
      expectedIdentifier: E2E,
      manifestPath: path.join(binDir, iso.E2E_BUILD_MANIFEST_FILE),
    });
    expect(verified.manifestPath).not.toBeNull();
    expect(s.logs.text()).toContain(`TAURI_BINARY_PATH=${binary}`);
    expect(s.logs.text()).toContain("e2e:isolation:selftest -- --binary");
  });

  it.each([
    [[PROD], "MARKER_PRODUCTION"],
    [[], "MARKER_MISSING"],
    [[E2E, README], "MARKER_AMBIGUOUS"],
  ])(
    "removes the copy and fails when the build carries markers %j",
    async (markers, code) => {
      const s = buildScenario(markers);
      expect(await build.main([], s.deps)).toBe(1);
      expect(s.logs.text()).toContain(code);
      expect(fs.readdirSync(s.binRoot)).toEqual([]);
    },
  );

  it("never builds into a shared target, on a dry run or after a failed build", async () => {
    const shared = buildScenario();
    expect(
      await build.main([], {
        ...shared.deps,
        env: {
          [build.E2E_CARGO_TARGET_DIR_ENV]: path.join(
            shared.root,
            "src-tauri",
            "target",
          ),
        },
      }),
    ).toBe(1);
    expect(shared.runs).toHaveLength(0);

    const dry = buildScenario();
    expect(await build.main(["--dry-run"], dry.deps)).toBe(0);
    expect(dry.runs).toHaveLength(0);
    expect(dry.logs.text()).toContain("--no-bundle");

    const failing = buildScenario();
    failing.failBuild(101);
    expect(await build.main([], failing.deps)).toBe(1);
    expect(failing.logs.text()).toContain("exit code 101");
    expect(fs.existsSync(failing.binRoot)).toBe(false);

    const usage = buildScenario();
    expect(await build.main(["--nope"], usage.deps)).toBe(2);
    expect(usage.runs).toHaveLength(0);
  });
});

// ── self-test: arguments and pure helpers ───────────────────────────────────

describe("self-test arguments", () => {
  it("requires --binary and applies defaults", () => {
    expect(selftest.parseSelftestArgs(["--binary", "a.exe"])).toEqual({
      help: false,
      binary: "a.exe",
      reportPath: null,
      keepE2eState: false,
      launchTimeoutMs: 60_000,
      wdioGroups: [],
    });
    expect(() => selftest.parseSelftestArgs([])).toThrow("--binary");
    expect(selftest.parseSelftestArgs(["--help"]).help).toBe(true);
    expect(
      selftest.parseSelftestArgs([
        "--binary=b.exe",
        "--report",
        "r.json",
        "--keep-e2e-state",
        "--launch-timeout-ms=90000",
      ]),
    ).toMatchObject({
      binary: "b.exe",
      reportPath: "r.json",
      keepE2eState: true,
      launchTimeoutMs: 90_000,
    });
  });

  it("orders WDIO groups as plan §7 does", () => {
    const groups = (arg: string) =>
      selftest.parseSelftestArgs(["--binary", "a", arg]).wdioGroups;
    expect(groups("--wdio")).toEqual(["startup", "mutating"]);
    expect(groups("--wdio=dsm,startup,ssh")).toEqual(["startup", "ssh", "dsm"]);
    expect(groups("--wdio=all")).toEqual(["startup", "mutating", "ssh", "dsm"]);
    expect(() => groups("--wdio=smoke")).toThrow("unknown WDIO group");
    expect(() => groups("--wdio=")).toThrow("at least one");
  });

  it.each([
    [["--binary"], "needs a value"],
    [["--binary", "--report", "x"], "needs a value"],
    [["--binary", "a", "--keep-e2e-state=1"], "takes no value"],
    [["--binary", "a", "--launch-timeout-ms", "10"], "between 1000"],
    [["--binary", "a", "--launch-timeout-ms", "1e4"], "between 1000"],
    [["--binary", "a", "--probe"], "unknown option"],
  ])("refuses %j", (argv, message) => {
    expect(() => selftest.parseSelftestArgs(argv)).toThrow(message);
  });

  it("resolves the Windows known folders from the environment only", () => {
    expect(
      selftest.resolveKnownFolders({
        platform: "win32",
        env: { APPDATA: "C:\\U\\Roaming", LOCALAPPDATA: "C:\\U\\Local" },
        homeDir: "C:\\U",
      }),
    ).toEqual({
      roaming: "C:\\U\\Roaming",
      local: "C:\\U\\Local",
      home: "C:\\U",
    });
    expect(() =>
      selftest.resolveKnownFolders({
        platform: "win32",
        env: { APPDATA: "Roaming" },
        homeDir: "C:\\U",
      }),
    ).toThrow("APPDATA and LOCALAPPDATA");
  });
});

describe("self-test OS adapter", () => {
  function recordingExec(
    handler: (file: string, args: readonly string[]) => ExecResult,
  ) {
    const calls: { file: string; args: readonly string[]; script?: string }[] =
      [];
    const exec: Exec = (file, args) => {
      const index = args.indexOf("-EncodedCommand");
      calls.push({
        file,
        args,
        script:
          index >= 0 ? iso.decodePowerShellCommand(args[index + 1]) : undefined,
      });
      return handler(file, args);
    };
    return { exec, calls };
  }

  it("reads credential metadata without the credential blob", () => {
    const script = selftest.CREDENTIAL_METADATA_SCRIPT;
    expect(script).not.toMatch(
      /CredentialBlob|CredReadW|CredWriteW|CredDeleteW/,
    );
    expect(script).toContain(
      "public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public UInt32 LastWrittenLow; public UInt32 LastWrittenHigh; }",
    );
    for (const prefix of selftest.PRODUCTION_CREDENTIAL_PREFIXES) {
      expect(script).toContain(`'${prefix}'`);
    }

    const stdout = JSON.stringify({
      entries: [
        {
          TargetName: "sortofremoteng.internal.rest-api/token",
          Type: 1,
          LastWritten: "20",
        },
        {
          TargetName: "com.sortofremoteng.vault/master-dek",
          Type: 1,
          LastWritten: "10",
        },
        {
          TargetName: `com.sortofremoteng.vault@${E2E}/master-dek`,
          Type: 1,
          LastWritten: "30",
        },
        { TargetName: "git:https://github.com", Type: 1, LastWritten: "40" },
      ],
    });
    expect(selftest.parseCredentialMetadata(stdout)).toEqual([
      {
        target: "com.sortofremoteng.vault/master-dek",
        type: 1,
        lastWritten: "10",
      },
      {
        target: "sortofremoteng.internal.rest-api/token",
        type: 1,
        lastWritten: "20",
      },
    ]);
    expect(
      selftest.parseCredentialMetadata(
        JSON.stringify({
          entries: {
            TargetName: "com.sortofremoteng.vpn/x",
            Type: 1,
            LastWritten: "5",
          },
        }),
      ),
    ).toHaveLength(1);
    expect(selftest.parseCredentialMetadata('{"entries":null}')).toEqual([]);
    expect(() =>
      selftest.parseCredentialMetadata(
        JSON.stringify({
          entries: [{ TargetName: "com.sortofremoteng.vault/x" }],
        }),
      ),
    ).toThrow("malformed");
  });

  it("queries Credential Manager, Run values and processes through exec on Windows", () => {
    const { exec, calls } = recordingExec((file, args) => {
      if (file === "reg.exe") {
        return {
          status: 0,
          stdout: `\r\n${selftest.RUN_REGISTRY_KEY}\r\n    OneDrive    REG_SZ    "C:\\x.exe"\r\n    sortOfRemoteNG (${E2E})    REG_SZ    "C:\\a.exe"\r\n`,
        };
      }
      const script = iso.decodePowerShellCommand(
        args[args.indexOf("-EncodedCommand") + 1],
      );
      if (script.includes("SorngE2eCredentialMetadata")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            entries: [
              {
                TargetName: "com.sortofremoteng.vault/master-dek",
                Type: 1,
                LastWritten: "7",
              },
            ],
          }),
        };
      }
      if (script.includes("GenericTargetNames")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            matched: `com.sortofremoteng.vault@${E2E}/master-dek`,
          }),
        };
      }
      return { status: 1 };
    });
    const adapter = selftest.createSystemAdapter({ platform: "win32", exec });
    expect(adapter.supported).toBe(true);
    expect(adapter.listRunValueNames()).toEqual({
      supported: true,
      names: ["OneDrive", `sortOfRemoteNG (${E2E})`],
    });
    expect(adapter.listProductionCredentials().entries).toEqual([
      {
        target: "com.sortofremoteng.vault/master-dek",
        type: 1,
        lastWritten: "7",
      },
    ]);
    expect(adapter.listIsolatedCredentialTargets(E2E)).toEqual({
      supported: true,
      targets: [`com.sortofremoteng.vault@${E2E}/master-dek`],
    });
    adapter.killTree(4321);
    expect(calls[calls.length - 1]).toMatchObject({
      file: "taskkill.exe",
      args: ["/PID", "4321", "/T", "/F"],
    });
    expect(calls.every(({ args }) => !args.includes("/IM"))).toBe(true);
  });

  it("refuses a listing that selects a non-isolated target and reports failures", () => {
    const rogue = selftest.createSystemAdapter({
      platform: "win32",
      exec: () => ({
        status: 0,
        stdout: JSON.stringify({
          matched: ["com.sortofremoteng.vault/master-dek"],
        }),
      }),
    });
    expect(() => rogue.listIsolatedCredentialTargets(E2E)).toThrow(
      "isolated credential listing returned",
    );
    const missingKey = selftest.createSystemAdapter({
      platform: "win32",
      exec: () => ({ status: 1 }),
    });
    expect(missingKey.listRunValueNames()).toEqual({
      supported: true,
      names: [],
    });
    const broken = selftest.createSystemAdapter({
      platform: "win32",
      exec: () => ({ status: 2, stderr: "denied" }),
    });
    expect(() => broken.listRunValueNames()).toThrow("denied");
    expect(() => broken.listProductionCredentials()).toThrow("failed");

    const posix = selftest.createSystemAdapter({
      platform: "linux",
      exec: () => {
        throw new Error("no exec off Windows");
      },
    });
    expect(posix.supported).toBe(false);
    expect(posix.listProductionCredentials()).toEqual({
      supported: false,
      entries: [],
    });
    expect(posix.listRunValueNames()).toEqual({ supported: false, names: [] });
  });
});

type Snapshot = ReturnType<typeof selftest.captureProductionSnapshot>;

function baseSnapshot(): Snapshot {
  return {
    capturedAt: "t",
    appData: {
      root: "R",
      exists: true,
      truncated: false,
      entries: [
        { path: "databases", type: "dir", size: 0, mtimeMs: 1 },
        { path: "databases/index.json", type: "file", size: 10, mtimeMs: 2 },
      ],
    },
    localData: { root: "L", exists: true, truncated: false, entries: [] },
    webview2Storage: [
      {
        path: "EBWebView/Default/Local Storage",
        exists: true,
        type: "dir",
        mtimeMs: 5,
      },
      {
        path: "EBWebView/Default/IndexedDB",
        exists: false,
        type: null,
        mtimeMs: null,
      },
    ],
    knownFolderNames: { roaming: [PROD, "Code"], local: [PROD, "Temp"] },
    ssh: {
      root: "S",
      exists: true,
      truncated: false,
      entries: [{ path: "known_hosts", type: "file", size: 3, mtimeMs: 9 }],
    },
    opk: { root: "O", exists: false, truncated: false, entries: [] },
    knownHostsSha256: "a".repeat(64),
    credentials: {
      supported: true,
      entries: [
        {
          target: "com.sortofremoteng.vault/master-dek",
          type: 1,
          lastWritten: "10",
        },
      ],
    },
    runValues: { supported: true, names: ["OneDrive"] },
  } as unknown as Snapshot;
}

describe("snapshot diff", () => {
  const allowed = {
    allowedKnownFolderNames: {
      roaming: [E2E],
      local: [E2E, iso.RUNS_ROOT_NAME],
    },
    allowedRunValues: [`sortOfRemoteNG (${E2E})`],
  };

  it("reports nothing for identical snapshots", () => {
    expect(
      selftest.diffSnapshots(baseSnapshot(), baseSnapshot(), allowed),
    ).toEqual({
      changes: [],
      expected: [],
    });
  });

  it.each<[string, (after: Snapshot) => void, string]>([
    [
      "a changed profile file",
      (after) => {
        (after.appData.entries[1] as { mtimeMs: number }).mtimeMs = 3;
      },
      "appData: changed databases/index.json (file 10 B mtime 2 -> file 10 B mtime 3)",
    ],
    [
      "a new profile file",
      (after) => {
        after.appData.entries.push({
          path: "databases/new.json",
          type: "file",
          size: 1,
          mtimeMs: 4,
        });
      },
      "appData: added databases/new.json",
    ],
    [
      "a removed profile file",
      (after) => {
        after.appData.entries.pop();
      },
      "appData: removed databases/index.json",
    ],
    [
      "a truncated listing",
      (after) => {
        (after.appData as { truncated: boolean }).truncated = true;
      },
      "appData: incomplete <root>",
    ],
    [
      "a vanished profile",
      (after) => {
        (after.localData as { exists: boolean }).exists = false;
      },
      "localData: removed <root>",
    ],
    [
      "a production WebView2 storage mtime",
      (after) => {
        (after.webview2Storage[0] as { mtimeMs: number }).mtimeMs = 6;
      },
      "webview2Storage: changed EBWebView/Default/Local Storage (mtime 5 -> mtime 6)",
    ],
    [
      "a created production WebView2 folder",
      (after) => {
        Object.assign(after.webview2Storage[1], {
          exists: true,
          type: "dir",
          mtimeMs: 1,
        });
      },
      "webview2Storage: changed EBWebView/Default/IndexedDB (absent -> mtime 1)",
    ],
    [
      "an unexpected known-folder entry",
      (after) => {
        after.knownFolderNames.local = [
          ...(after.knownFolderNames.local ?? []),
          "sorng",
        ];
      },
      "knownFolderNames: added <local>/sorng",
    ],
    [
      "a changed known_hosts",
      (after) => {
        after.knownHostsSha256 = "b".repeat(64);
      },
      "knownHosts: changed ~/.ssh/known_hosts (hashed -> hashed (different))",
    ],
    [
      "an ~/.ssh listing change",
      (after) => {
        after.ssh.entries.push({
          path: "id_ed25519",
          type: "file",
          size: 1,
          mtimeMs: 1,
        });
      },
      "ssh: added id_ed25519",
    ],
    [
      "a created ~/.opk",
      (after) => {
        (after.opk as { exists: boolean }).exists = true;
      },
      "opk: added <root>",
    ],
    [
      "a rewritten production DEK",
      (after) => {
        after.credentials.entries[0] = {
          ...after.credentials.entries[0],
          lastWritten: "11",
        };
      },
      "credentials: changed com.sortofremoteng.vault/master-dek (LastWritten 10 -> LastWritten 11)",
    ],
    [
      "a new production credential",
      (after) => {
        after.credentials.entries.push({
          target: "sortofremoteng.internal.database-protection.v1/db",
          type: 1,
          lastWritten: "12",
        });
      },
      "credentials: added sortofremoteng.internal.database-protection.v1/db",
    ],
    [
      "a deleted production credential",
      (after) => {
        after.credentials.entries.length = 0;
      },
      "credentials: removed com.sortofremoteng.vault/master-dek",
    ],
    [
      "an unrelated Run value",
      (after) => {
        after.runValues.names.push("sortOfRemoteNG");
      },
      "runValues: added sortOfRemoteNG",
    ],
  ])("flags %s", (_label, mutate, line) => {
    const after = baseSnapshot();
    mutate(after);
    const { changes } = selftest.diffSnapshots(baseSnapshot(), after, allowed);
    expect(changes.map(selftest.formatChange)).toEqual([line]);
  });

  it("accepts only the e2e names under the known folders and the e2e Run value", () => {
    const after = baseSnapshot();
    after.knownFolderNames.roaming = [
      ...(after.knownFolderNames.roaming ?? []),
      E2E,
    ];
    after.knownFolderNames.local = [
      ...(after.knownFolderNames.local ?? []).filter((name) => name !== "Temp"),
      E2E.toUpperCase(),
      iso.RUNS_ROOT_NAME,
      "Temp",
    ];
    after.runValues.names.push(`sortOfRemoteNG (${E2E})`);
    const before = baseSnapshot();
    before.knownFolderNames.roaming = [
      ...(before.knownFolderNames.roaming ?? []),
    ];
    const diff = selftest.diffSnapshots(before, after, allowed);
    expect(diff.changes).toEqual([]);
    expect(diff.expected.map(selftest.formatChange)).toEqual([
      `knownFolderNames: added ${E2E}`,
      `knownFolderNames: added ${E2E.toUpperCase()}`,
      `knownFolderNames: added ${iso.RUNS_ROOT_NAME}`,
      `runValues: added sortOfRemoteNG (${E2E})`,
    ]);
    const unsupported = baseSnapshot();
    unsupported.credentials = { supported: false, entries: [] };
    expect(
      selftest
        .diffSnapshots(baseSnapshot(), unsupported, allowed)
        .changes.map(selftest.formatChange),
    ).toEqual(["credentials: incomplete <credential manager>"]);
  });

  it("summarises counts without copying production listings and names gaps", () => {
    const snapshot = baseSnapshot();
    const summary = selftest.summarizeSnapshot(snapshot);
    expect(summary).toEqual({
      appDataEntries: 2,
      localDataEntries: 0,
      webview2StorageDirs: 1,
      sshEntries: 1,
      opkEntries: null,
      knownHosts: "hashed",
      credentials: 1,
      runValues: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("index.json");
    expect(selftest.snapshotGaps(snapshot)).toEqual([]);
    (snapshot.appData as { truncated: boolean }).truncated = true;
    snapshot.runValues = { supported: false, names: [] };
    expect(selftest.snapshotGaps(snapshot)).toEqual([
      "appData listing was truncated",
      "HKCU Run values are unavailable on this host",
    ]);
  });
});

describe("negative controls", () => {
  it("covers the four §7.9 refusals and never launches the production folder", () => {
    const runProfile = {
      runId: "0123456789ab",
      runRoot: "/runs",
      runDir: path.join("/runs", "0123456789ab"),
      webview2Dir: path.join("/runs", "0123456789ab", "webview2"),
    };
    const locations = selftest.snapshotLocations({
      knownFolders: { roaming: "/r", local: "/l", home: "/h" },
    });
    const controls = selftest.negativeControls({ runProfile, locations });
    expect(controls.map(({ id, modes }) => [id, modes])).toEqual([
      ["a-identifier-mismatch", ["probe", "launch"]],
      ["b-harness-without-webview2-folder", ["probe", "launch"]],
      ["c-webview2-flag-production-folder", ["probe"]],
      ["d-webview2-flag-env-mismatch", ["probe", "launch"]],
    ]);
    const [a, b, c, d] = controls;
    const layout = { roaming: "/r", local: "/l", home: "/h" };
    for (const control of controls) {
      expect(
        fakeGuard(
          [iso.PROFILE_PROBE_ARG, ...control.args],
          control.env,
          layout,
        ),
        control.id,
      ).toMatchObject({ refused: true });
    }
    expect(a.env[iso.EXPECT_ISOLATED_PROFILE_ENV]).toBe(
      selftest.MISMATCH_IDENTIFIER,
    );
    expect(flagValue(a.args)).toBe(runProfile.webview2Dir);
    expect(b.args).toEqual([]);
    expect(b.env[iso.WEBVIEW2_USER_DATA_FOLDER_ENV]).toBeUndefined();
    expect(flagValue(c.args)).toBe(path.join("/l", PROD, "EBWebView"));
    expect(flagValue(d.args)).toBe(runProfile.webview2Dir);
    expect(d.env[iso.WEBVIEW2_USER_DATA_FOLDER_ENV]).toBe(
      path.join(runProfile.runDir, "other"),
    );
    expect(d.mustNotExist).toEqual([path.join(runProfile.runDir, "other")]);
  });
});

// ── self-test: the runner ───────────────────────────────────────────────────

interface SelftestHarnessOptions {
  markers?: string[];
  manifest?: boolean;
  production?: ClassifiedProcess[];
  env?: EnvRecord;
  wdioGroups?: string[];
  keepE2eState?: boolean;
  /** Mutates the probe JSON the fake binary prints. */
  mutateProbe?: (probe: ProfileProbe) => unknown;
  /** Runs inside each probe the fake binary answers. */
  onProbe?: (count: number) => void;
  /** Overrides the fake guard for a control launch. */
  control?: (
    args: readonly string[],
    env: EnvRecord,
  ) => "exit-0" | "hang" | undefined;
  /** The direct launch's side effects. */
  launch?:
    | "default"
    | "webview2-fallback"
    | "no-credential"
    | "exit-early"
    | "touch-production";
  wdioExit?: (spec: string) => number;
}

const productionProcess: ClassifiedProcess = {
  pid: 777,
  name: "app.exe",
  executablePath: "F:\\repo\\src-tauri\\target\\debug\\app.exe",
  reason: "app image outside the verified e2e binary",
};

async function selftestHarness(options: SelftestHarnessOptions = {}) {
  const root = tempDir();
  const layout: Layout = {
    roaming: path.join(root, "Roaming"),
    local: path.join(root, "Local"),
    home: path.join(root, "home"),
  };
  const production = {
    database: writeFile(
      path.join(layout.roaming, PROD, "databases", "index.json"),
      "{}",
    ),
    webview: writeFile(
      path.join(
        layout.local,
        PROD,
        "EBWebView",
        "Default",
        "Local Storage",
        "leveldb",
        "CURRENT",
      ),
    ),
    knownHosts: writeFile(
      path.join(layout.home, ".ssh", "known_hosts"),
      "github.com ssh-ed25519 AAAA\n",
    ),
  };
  fs.mkdirSync(
    path.join(layout.local, PROD, "EBWebView", "Default", "IndexedDB"),
    {
      recursive: true,
    },
  );
  const stale = writeFile(
    path.join(layout.roaming, E2E, "databases", "stale.json"),
  );
  const binary = markerBinary(
    path.join(root, "bin", EXE),
    options.markers ?? [E2E],
  );
  if (options.manifest !== false) {
    await writeManifest(binary);
  }
  const lockDir = path.join(root, "locks");
  const tmp = path.join(root, "tmp");
  fs.mkdirSync(lockDir);
  fs.mkdirSync(tmp);

  const events: string[] = [];
  const store = {
    isolated: new Set<string>(),
    production: new Map([["com.sortofremoteng.vault/master-dek", "100"]]),
    runValues: new Set(["OneDrive"]),
  };
  const running = new Map<
    number,
    (result: { code: number; signal: null }) => void
  >();
  let nextPid = 5000;
  const startedEnvs: EnvRecord[] = [];
  let probes = 0;
  let clockMs = Date.parse("2026-09-15T12:00:00Z");

  const answerProbe = (args: readonly string[], env: EnvRecord) => {
    probes += 1;
    options.onProbe?.(probes);
    const decision = fakeGuard(args, env, layout);
    if (decision.refused) {
      return { status: 78, message: decision.message };
    }
    const probe = buildProbe(layout, {
      folder: decision.folder,
      source: decision.source,
    });
    const body = options.mutateProbe ? options.mutateProbe(probe) : probe;
    writeFile(
      env[iso.PROFILE_PROBE_OUT_ENV] as string,
      JSON.stringify(body ?? probe),
    );
    return { status: 0, message: "" };
  };

  const spawnSync: SpawnSyncLike = (_file, args, spawnOptions) => {
    const env = spawnOptions.env as EnvRecord;
    events.push(`probe ${probes + 1}`);
    const { status, message } = answerProbe(args, env);
    return { status, signal: null, stdout: "", stderr: message, pid: 4242 };
  };

  const startProcess = (
    _file: string,
    args: readonly string[],
    { env }: { env: EnvRecord },
  ) => {
    const pid = nextPid++;
    let resolveExit!: (result: { code: number; signal: null }) => void;
    const exited = new Promise<{ code: number; signal: null }>((resolve) => {
      resolveExit = resolve;
    });
    const probeMode = args.includes(iso.PROFILE_PROBE_ARG);
    startedEnvs.push({ ...env });
    const override = options.control?.(args, env);
    const decision = fakeGuard(args, env, layout);
    if (override === "exit-0" || override === "hang") {
      events.push(`start ${probeMode ? "probe" : "launch"} regressed`);
      if (override === "exit-0") {
        if (probeMode) {
          writeFile(env[iso.PROFILE_PROBE_OUT_ENV] as string, "{}");
        }
        resolveExit({ code: 0, signal: null });
      } else {
        running.set(pid, resolveExit);
      }
      return { pid, exited, stderrTail: () => "" };
    }
    if (decision.refused) {
      events.push(`start ${probeMode ? "probe" : "launch"} refused`);
      resolveExit({ code: 78, signal: null });
      return {
        pid,
        exited,
        stderrTail: () => `sortOfRemoteNG profile guard: ${decision.message}\n`,
      };
    }
    events.push("start launch");
    const behaviour = options.launch ?? "default";
    if (behaviour === "exit-early") {
      resolveExit({ code: 1, signal: null });
      return { pid, exited, stderrTail: () => "" };
    }
    fs.mkdirSync(path.join(layout.roaming, E2E, "databases"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(layout.local, E2E, "logs"), { recursive: true });
    if (behaviour === "webview2-fallback") {
      fs.mkdirSync(path.join(layout.local, E2E, "EBWebView", "Default"), {
        recursive: true,
      });
    } else if (decision.folder) {
      writeFile(path.join(decision.folder, "EBWebView", "Local State"));
    }
    if (behaviour !== "no-credential") {
      store.isolated.add(selftest.VAULT_MASTER_DEK_TARGET);
    }
    store.runValues.add(`sortOfRemoteNG (${E2E})`);
    if (behaviour === "touch-production") {
      fs.writeFileSync(production.database, '{"changed":true}');
    }
    running.set(pid, resolveExit);
    return { pid, exited, stderrTail: () => "" };
  };

  const adapter = {
    supported: true,
    checkWebView2Policy: () => {
      events.push("policy");
      return { supported: true, overrides: [] };
    },
    inspectProcesses: () => {
      events.push("processes");
      return { production: options.production ?? [], sameBinary: [] };
    },
    listProductionCredentials: () => ({
      supported: true,
      entries: [...store.production].map(([target, lastWritten]) => ({
        target,
        type: 1,
        lastWritten,
      })),
    }),
    listIsolatedCredentialTargets: () => ({
      supported: true,
      targets: [...store.isolated].sort(),
    }),
    listRunValueNames: () => ({
      supported: true,
      names: [...store.runValues].sort(),
    }),
    cleanupKeychain: () => {
      events.push("keychain cleanup");
      const deleted = [...store.isolated];
      store.isolated.clear();
      return { supported: true, deleted, missing: [] };
    },
    cleanupAutostart: (name: string) => {
      events.push("autostart cleanup");
      const removed = store.runValues.delete(name)
        ? [selftest.RUN_REGISTRY_KEY]
        : [];
      return { supported: true, removed };
    },
    killTree: (pid: number) => {
      events.push(`kill ${pid}`);
      running.get(pid)?.({ code: 1, signal: null });
      running.delete(pid);
    },
  };

  const wdioRuns: { spec: string; env: EnvRecord }[] = [];
  const logs = captureLog();
  const deps = {
    repoRoot,
    env: {
      [iso.E2E_RUN_ROOT_ENV]: path.join(root, "runs"),
      [iso.E2E_RUN_ID_ENV]: "ffffffffffff",
      [iso.RUN_LOCK_TOKEN_ENV]: "inherited-token",
      [iso.WEBVIEW2_USER_DATA_FOLDER_ENV]: path.join(root, "inherited"),
      ...options.env,
    } as EnvRecord,
    platform: process.platform,
    adapter,
    spawnSync,
    startProcess,
    runWdio: async ({ spec, env }: { spec: string; env: EnvRecord }) => {
      events.push(`wdio ${spec}`);
      wdioRuns.push({ spec, env });
      return { code: options.wdioExit?.(spec) ?? 0, signal: null };
    },
    now: () => new Date(clockMs),
    sleep: async (ms: number) => {
      clockMs += ms;
    },
    log: logs.log,
    lockDir,
    tmpDir: tmp,
    isAlive: (pid: number) => pid === 1,
    selfPid: 1,
    knownFolders: layout,
    createRunId: () => "0123456789ab",
  };
  const run = () =>
    selftest.runSelftest(
      {
        binary,
        wdioGroups: options.wdioGroups ?? [],
        keepE2eState: options.keepE2eState ?? false,
      },
      deps,
    );
  return {
    root,
    layout,
    production,
    stale,
    binary,
    lockDir,
    events,
    store,
    wdioRuns,
    startedEnvs,
    logs,
    run,
    runDir: path.join(root, "runs", "0123456789ab"),
  };
}

type Report = Awaited<ReturnType<typeof selftest.runSelftest>>;
type PhaseRecord = Report["phases"][number] & {
  problems?: string[];
  warnings?: string[];
  evidence?: Record<string, unknown>;
};

function phase(report: Report, id: string): PhaseRecord {
  const found = report.phases.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`no phase ${id}`);
  }
  return found as PhaseRecord;
}

function statuses(report: Report) {
  return report.phases.map(({ id, status }) => `${id}:${status}`);
}

const CORE_IDS = selftest.CORE_PHASES.map(({ id }) => id);

function expectCleanTeardown(s: Awaited<ReturnType<typeof selftestHarness>>) {
  expect(fs.readdirSync(s.lockDir)).toEqual([]);
  expect(fs.existsSync(s.runDir)).toBe(false);
  expect(fs.readFileSync(s.production.database, "utf8")).toBe("{}");
  expect(fs.existsSync(s.production.webview)).toBe(true);
  expect(fs.existsSync(s.production.knownHosts)).toBe(true);
  expect(s.store.production.get("com.sortofremoteng.vault/master-dek")).toBe(
    "100",
  );
}

describe("runSelftest", () => {
  it("passes every §7 phase in order and tears down only e2e state", async () => {
    const s = await selftestHarness();
    const report = await s.run();

    expect(report.outcome, JSON.stringify(report.phases, null, 2)).toBe(
      "passed",
    );
    expect(report.phases.map(({ id }) => id)).toEqual([
      ...CORE_IDS,
      "teardown",
    ]);
    expect(CORE_IDS).toEqual([
      "host",
      "binary-identity",
      "webview2-policy",
      "production-processes",
      "run-lock",
      "production-snapshot",
      "run-dir",
      "identity-probe",
      "pre-run-wipe",
      "probe",
      "negative-controls",
      "direct-launch",
      "post-check",
    ]);
    expect(report.productionComparison).toBe("strict");
    expect(report.runId).toBe("0123456789ab");

    // The probe runs before anything is wiped and before any real launch; the
    // exact-input probe then sees the wiped profile.
    expect(s.events.indexOf("probe 1")).toBeLessThan(
      s.events.indexOf("keychain cleanup"),
    );
    expect(s.events.indexOf("probe 2")).toBeGreaterThan(
      s.events.indexOf("keychain cleanup"),
    );
    expect(s.events.indexOf("probe 2")).toBeLessThan(
      s.events.findIndex((event) => event.startsWith("start")),
    );
    expect(s.events.filter((event) => event === "start launch")).toHaveLength(
      1,
    );
    expect(s.events.filter((event) => event.endsWith("refused"))).toEqual([
      "start probe refused",
      "start launch refused",
      "start probe refused",
      "start launch refused",
      "start probe refused",
      "start probe refused",
      "start launch refused",
    ]);

    const controls = phase(report, "negative-controls").evidence?.controls as {
      exitCode: number;
      stderr: string;
    }[];
    expect(controls).toHaveLength(7);
    expect(controls.every(({ exitCode }) => exitCode === 78)).toBe(true);
    expect(controls[0].stderr).toContain("profile guard");

    const launch = phase(report, "direct-launch").evidence as Record<
      string,
      unknown
    >;
    expect(launch).toMatchObject({
      roamingCreated: true,
      runWebView2Populated: true,
      defaultWebView2Absent: true,
      vaultDekCreated: true,
      isolatedCredentials: [selftest.VAULT_MASTER_DEK_TARGET],
    });
    expect(s.events).toContain(`kill ${launch.pid}`);
    expect(
      (phase(report, "post-check").evidence as { expected: string[] }).expected,
    ).toContain(`runValues: added sortOfRemoteNG (${E2E})`);

    expect(fs.existsSync(s.stale)).toBe(false);
    expect(fs.existsSync(path.join(s.layout.roaming, E2E))).toBe(false);
    expect(fs.existsSync(path.join(s.layout.local, E2E))).toBe(false);
    expect(s.store.isolated.size).toBe(0);
    expect(s.store.runValues.has(`sortOfRemoteNG (${E2E})`)).toBe(false);
    expectCleanTeardown(s);
    expect(phase(report, "teardown").evidence).toMatchObject({
      wipedProfile: true,
      wipedRunDir: true,
      lockReleased: true,
      production: "unchanged",
    });

    const text = selftest.formatHumanReport(report, { jsonPath: "r.json" });
    expect(text).toContain("t91 e2e isolation self-test: PASSED");
    expect(text).toContain("PASS  §7.9 negative-controls");
    expect(text).toContain("DONE  §7.12 teardown");
    expect(text).toContain("JSON report: r.json");
  });

  it("never inherits the caller's run, lock token or WebView2 folder", async () => {
    const s = await selftestHarness();
    const report = await s.run();
    expect(report.outcome).toBe("passed");
    expect(report.runDir).toBe(s.runDir);
    expect(fs.existsSync(path.join(s.root, "inherited"))).toBe(false);
  });

  it("stops at a missing manifest or a production marker before any launch", async () => {
    for (const options of [{ manifest: false }, { markers: [PROD] }]) {
      const s = await selftestHarness(options);
      const report = await s.run();
      expect(report.outcome).toBe("stopped");
      expect(report.stoppedAt).toBe("binary-identity");
      expect(s.events).toEqual([]);
      expect(phase(report, "post-check").status).toBe("not-run");
      expect(fs.existsSync(s.stale)).toBe(true);
      expectCleanTeardown(s);
    }
  });

  it("stops while production runs (strict) and never takes the lock", async () => {
    const s = await selftestHarness({ production: [productionProcess] });
    const report = await s.run();
    expect(report.stoppedAt).toBe("production-processes");
    expect(phase(report, "production-processes").problems?.[0]).toContain(
      "never stop the user's `tauri dev`",
    );
    expect(s.events).toEqual(["policy", "processes"]);
    expect(fs.existsSync(path.join(s.root, "runs"))).toBe(false);
    expectCleanTeardown(s);
  });

  it(`downgrades production differences to warnings with ${iso.ALLOW_RUNNING_PRODUCTION_ENV}=1`, async () => {
    const s = await selftestHarness({
      production: [productionProcess],
      env: { [iso.ALLOW_RUNNING_PRODUCTION_ENV]: "1" },
      launch: "touch-production",
    });
    const report = await s.run();
    expect(report.outcome).toBe("passed");
    expect(report.productionComparison).toBe("informational");
    expect(phase(report, "post-check").warnings?.join("\n")).toContain(
      "appData: changed databases/index.json",
    );
  });

  it("hard-fails a production change when no production process runs", async () => {
    const s = await selftestHarness({ launch: "touch-production" });
    const report = await s.run();
    expect(report.stoppedAt).toBe("post-check");
    expect(phase(report, "post-check").problems?.[0]).toMatch(
      /HARD FAIL; delete nothing\): appData: changed databases\/index\.json/,
    );
    expect(fs.readFileSync(s.production.database, "utf8")).toBe(
      '{"changed":true}',
    );
    expect(fs.readdirSync(s.lockDir)).toEqual([]);
    expect(fs.existsSync(s.runDir)).toBe(false);
  });

  it("stops at a probe that writes into the run folder before any launch", async () => {
    const s = await selftestHarness({
      onProbe: () => {
        const webview = path.join(s.runDir, "webview2", "EBWebView");
        fs.mkdirSync(webview, { recursive: true });
      },
    });
    const report = await s.run();
    expect(report.stoppedAt).toBe("identity-probe");
    expect(phase(report, "identity-probe").problems).toContain(
      `the probe wrote into ${path.join(s.runDir, "webview2")}`,
    );
    expect(s.events).not.toContain("start launch");
    expect(fs.existsSync(s.runDir)).toBe(false);
    expect(fs.readdirSync(s.lockDir)).toEqual([]);
  });

  it("stops when the exact-input probe after the wipe creates profile state", async () => {
    const s = await selftestHarness({
      onProbe: (count) => {
        if (count === 2) {
          fs.mkdirSync(path.join(s.layout.local, E2E, "logs"), {
            recursive: true,
          });
        }
      },
    });
    const report = await s.run();
    expect(report.stoppedAt).toBe("probe");
    expect(phase(report, "probe").problems).toContain(
      `${path.join(s.layout.local, E2E)} exists`,
    );
    expect(s.events.some((event) => event.startsWith("start"))).toBe(false);
    expect(fs.existsSync(path.join(s.layout.local, E2E))).toBe(false);
    expectCleanTeardown(s);
  });

  it("never passes the caller's harness variables to a launched process", async () => {
    const s = await selftestHarness({
      env: {
        [iso.E2E_PREFLIGHT_ENV]: "ok:ffffffffffff",
        [iso.EXPECT_ISOLATED_PROFILE_ENV]: README,
        [iso.PROFILE_PROBE_OUT_ENV]: "inherited.json",
      },
    });
    const report = await s.run();
    expect(report.outcome, JSON.stringify(report.phases, null, 2)).toBe(
      "passed",
    );
    expect(s.startedEnvs).toHaveLength(8);
    for (const env of s.startedEnvs) {
      expect(env[iso.E2E_PREFLIGHT_ENV]).toBeUndefined();
      expect(env[iso.RUN_LOCK_TOKEN_ENV]).toBeUndefined();
      expect(env[iso.PROFILE_PROBE_OUT_ENV]).not.toBe("inherited.json");
      expect(env[iso.EXPECT_ISOLATED_PROFILE_ENV]).not.toBe(README);
    }
    expect(
      s.startedEnvs.filter(
        (env) => env[iso.EXPECT_ISOLATED_PROFILE_ENV] === undefined,
      ),
    ).toHaveLength(0);
  });

  it("stops at a probe that resolves production paths and never wipes", async () => {
    const s = await selftestHarness({
      mutateProbe: (probe) => ({
        ...probe,
        dirs: { ...probe.dirs, appData: probe.productionDirs.appData },
      }),
    });
    const report = await s.run();
    expect(report.stoppedAt).toBe("identity-probe");
    expect(phase(report, "identity-probe").code).toBe("PROBE_PRODUCTION_PATH");
    expect(s.events).not.toContain("keychain cleanup");
    expect(fs.existsSync(s.stale)).toBe(true);
    expectCleanTeardown(s);
  });

  it("stops when a refusal control regresses and ends the launched tree", async () => {
    const hang = await selftestHarness({
      control: (args, env) =>
        !args.includes(iso.PROFILE_PROBE_ARG) &&
        env[iso.EXPECT_ISOLATED_PROFILE_ENV] === E2E &&
        flagValue(args) === null
          ? "hang"
          : undefined,
    });
    const hung = await hang.run();
    expect(hung.stoppedAt).toBe("negative-controls");
    expect(phase(hung, "negative-controls").problems?.[0]).toContain(
      "control b-harness-without-webview2-folder (launch): did not exit within 15000 ms",
    );
    expect(hang.events.some((event) => event.startsWith("kill "))).toBe(true);
    expect(hang.events).not.toContain("start launch");
    expect(phase(hung, "direct-launch").status).toBe("not-run");
    expectCleanTeardown(hang);

    const printed = await selftestHarness({
      control: (args) =>
        args.includes(iso.PROFILE_PROBE_ARG) &&
        (flagValue(args) ?? "").includes(PROD)
          ? "exit-0"
          : undefined,
    });
    const report = await printed.run();
    expect(report.stoppedAt).toBe("negative-controls");
    expect(phase(report, "negative-controls").problems).toEqual(
      expect.arrayContaining([
        "control c-webview2-flag-production-folder (probe): exited with code 0, expected 78",
        "control c-webview2-flag-production-folder (probe): wrote a probe report",
      ]),
    );
  });

  it("stops on the WebView2 fallback (§7.13) and still wipes the isolated default folder", async () => {
    const s = await selftestHarness({ launch: "webview2-fallback" });
    const report = await s.run();
    expect(report.stoppedAt).toBe("direct-launch");
    expect(report.webview2Fallback).toBe(true);
    expect(phase(report, "direct-launch").problems?.[0]).toContain(
      "the WebView2 override did not take effect (§7.13)",
    );
    expect(fs.existsSync(path.join(s.layout.local, E2E))).toBe(false);
    expect(s.store.isolated.size).toBe(0);
    expect(selftest.formatHumanReport(report)).toContain(
      "WebView2 fallback (§7.13)",
    );
    expectCleanTeardown(s);
  });

  it("stops when the namespaced DEK never appears or the app exits early", async () => {
    const missing = await selftestHarness({ launch: "no-credential" });
    const report = await missing.run();
    expect(report.stoppedAt).toBe("direct-launch");
    expect(phase(report, "direct-launch").problems?.[0]).toBe(
      `missing evidence after 60000 ms: credential ${selftest.VAULT_MASTER_DEK_TARGET}`,
    );
    expectCleanTeardown(missing);

    const early = await selftestHarness({ launch: "exit-early" });
    const exited = await early.run();
    expect(exited.stoppedAt).toBe("direct-launch");
    expect(phase(exited, "direct-launch").problems?.[0]).toContain(
      "the app exited (code 1) before all evidence appeared",
    );
  });

  it("keeps e2e state on request but still releases the lock", async () => {
    const s = await selftestHarness({ keepE2eState: true });
    const report = await s.run();
    expect(report.outcome).toBe("passed");
    expect(fs.existsSync(path.join(s.layout.roaming, E2E))).toBe(true);
    expect(fs.existsSync(s.runDir)).toBe(true);
    expect(fs.readdirSync(s.lockDir)).toEqual([]);
    expect(phase(report, "teardown").warnings?.[0]).toContain(
      "--keep-e2e-state",
    );
  });

  it("hands off to WDIO in §7 order only after a pass, with a fresh run environment", async () => {
    const s = await selftestHarness({
      wdioGroups: ["startup", "mutating", "ssh", "dsm"],
    });
    const report = await s.run();
    expect(report.outcome).toBe("passed");
    expect(s.wdioRuns.map(({ spec }) => spec)).toEqual([
      "e2e/specs/01-startup/app-launch.spec.ts",
      "e2e/specs/02-collections/collection-create.spec.ts",
      "e2e/specs/34-security-extended/trust-center-database.spec.ts",
      "e2e/specs/06-ssh/ssh-connect.spec.ts",
      "e2e/specs/26-synology/dsm-web-autofill.spec.ts",
    ]);
    expect(s.events.indexOf(`wdio ${s.wdioRuns[0].spec}`)).toBeGreaterThan(
      s.events.lastIndexOf("keychain cleanup"),
    );
    for (const { env } of s.wdioRuns) {
      expect(env.TAURI_BINARY_PATH).toBe(s.binary);
      for (const key of [
        iso.E2E_RUN_ID_ENV,
        iso.E2E_RUN_DIR_ENV,
        iso.E2E_WEBVIEW2_DIR_ENV,
        iso.RUN_LOCK_TOKEN_ENV,
        ...iso.PREFLIGHT_ENV_KEYS,
      ]) {
        expect(env[key], key).toBeUndefined();
      }
      expect(env[iso.E2E_RUN_ROOT_ENV]).toBe(path.join(s.root, "runs"));
    }
    for (const spec of s.wdioRuns) {
      expect(spec.spec.startsWith("e2e/specs/")).toBe(true);
      expect(fs.existsSync(path.join(repoRoot, spec.spec)), spec.spec).toBe(
        true,
      );
    }
  });

  it("stops the WDIO hand-off at the first failing spec and skips it after a stop", async () => {
    const failing = await selftestHarness({
      wdioGroups: ["startup", "mutating"],
      wdioExit: (spec) => (spec.includes("app-launch") ? 1 : 0),
    });
    const report = await failing.run();
    expect(report.stoppedAt).toBe("wdio-startup-app-launch");
    expect(failing.wdioRuns).toHaveLength(1);
    expect(statuses(report).slice(-1)[0]).toBe(
      "wdio-mutating-collection-create:not-run",
    );

    const stopped = await selftestHarness({
      production: [productionProcess],
      wdioGroups: ["startup"],
    });
    const skipped = await stopped.run();
    expect(stopped.wdioRuns).toEqual([]);
    expect(statuses(skipped).slice(-1)[0]).toBe(
      "wdio-startup-app-launch:not-run",
    );
  });

  it("refuses to run on a host without Credential Manager access", async () => {
    const report = await selftest.runSelftest(
      { binary: "app.exe" },
      {
        adapter: selftest.createSystemAdapter({ platform: "linux" }),
        platform: "linux",
        log: captureLog().log,
        runWdio: async () => {
          throw new Error("never");
        },
      },
    );
    expect(report.stoppedAt).toBe("host");
    expect(statuses(report).slice(1, 3)).toEqual([
      "binary-identity:not-run",
      "webview2-policy:not-run",
    ]);
  });
});

describe("self-test main", () => {
  it("writes a JSON and a human-readable report and exits by outcome", async () => {
    const s = await selftestHarness({ production: [productionProcess] });
    const reportPath = path.join(s.root, "out", "selftest.json");
    const logs = captureLog();
    const code = await selftest.main(
      ["--binary", s.binary, "--report", reportPath],
      {
        repoRoot,
        env: { [iso.E2E_RUN_ROOT_ENV]: path.join(s.root, "runs") },
        platform: process.platform,
        adapter: {
          supported: true,
          checkWebView2Policy: () => ({ supported: true, overrides: [] }),
          inspectProcesses: () => ({
            production: [productionProcess],
            sameBinary: [],
          }),
        },
        log: logs.log,
        lockDir: s.lockDir,
        knownFolders: s.layout,
      },
    );
    expect(code).toBe(1);
    const json = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(json.schema).toBe("sorng-e2e-isolation-selftest/v1");
    expect(json.stoppedAt).toBe("production-processes");
    const text = fs.readFileSync(
      path.join(s.root, "out", "selftest.txt"),
      "utf8",
    );
    expect(text).toContain("STOPPED at production-processes");
    expect(logs.text()).toContain(`JSON report: ${reportPath}`);

    expect(await selftest.main([], { log: logs.log })).toBe(2);
    expect(await selftest.main(["--help"], { log: logs.log })).toBe(0);
    expect(
      selftest.defaultReportPath("R", new Date("2026-09-15T01:02:03.004Z")),
    ).toBe(
      path.join("R", ".artifacts", "e2e", "selftest-20260915T010203Z.json"),
    );
  });

  it("never kills by image name or reads credential blobs", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "scripts", "e2e-isolation-selftest.mjs"),
      "utf8",
    );
    expect(source).not.toMatch(/\/IM\b|Stop-Process|pkill|killall/);
    expect(source).not.toMatch(/CredReadW|CredWriteW|\.CredentialBlob/);
    expect(source).not.toMatch(
      /readFileSync\([^)]*(?:known_?[hH]osts|productionRoaming|productionLocal)/,
    );
  });
});

// ── README capture isolation ────────────────────────────────────────────────

describe("readme-screenshot isolation", () => {
  async function captureScenario() {
    const root = tempDir();
    const layout: Layout = {
      roaming: path.join(root, "Roaming"),
      local: path.join(root, "Local"),
      home: path.join(root, "home"),
    };
    const production = writeFile(
      path.join(layout.roaming, PROD, "databases", "index.json"),
    );
    const staleRoaming = writeFile(
      path.join(layout.roaming, README, "databases", "seed.json"),
    );
    const staleWebView = writeFile(
      path.join(layout.local, README, "EBWebView", "Local State"),
    );
    const binary = markerBinary(path.join(root, "capture", EXE), [README]);
    const lockDir = path.join(root, "locks");
    fs.mkdirSync(lockDir);
    const env: EnvRecord = {
      [iso.E2E_RUN_ROOT_ENV]: path.join(root, "runs"),
      [iso.E2E_RUN_ID_ENV]: "eeeeeeeeeeee",
    };
    const probes: string[][] = [];
    const spawnSync: SpawnSyncLike = (_file, args, options) => {
      probes.push([...args]);
      const probeEnv = options.env as EnvRecord;
      const decision = fakeGuard(args, probeEnv, layout, README);
      if (decision.refused) {
        return {
          status: 78,
          signal: null,
          stdout: "",
          stderr: decision.message,
          pid: 4242,
        };
      }
      writeFile(
        probeEnv[iso.PROFILE_PROBE_OUT_ENV] as string,
        JSON.stringify(
          buildProbe(layout, {
            identifier: README,
            folder: decision.folder,
            source: decision.source,
          }),
        ),
      );
      return { status: 0, signal: null, stdout: "", stderr: "", pid: 4242 };
    };
    // Windows: CIM process list, WebView2 policy, keychain and autostart
    // queries; POSIX: the ps listing. Nothing is found or deleted.
    const exec: Exec = (file, args) => {
      if (file === "ps") {
        return { status: 0, stdout: "" };
      }
      if (file === "reg.exe") {
        return { status: 1 };
      }
      const index = args.indexOf("-EncodedCommand");
      const script =
        index >= 0 ? iso.decodePowerShellCommand(args[index + 1]) : "";
      if (script.includes("Win32_Process")) {
        return { status: 0, stdout: "[]" };
      }
      if (script.includes("GenericTargetNames")) {
        return { status: 0, stdout: JSON.stringify({ matched: [] }) };
      }
      return { status: 1 };
    };
    const logs = captureLog();
    const deps = {
      applicationPath: binary,
      env,
      repoRoot,
      exec,
      spawnSync,
      lockDir,
      tmpDir: root,
      isAlive: (pid: number) => pid === 1,
      selfPid: 1,
      log: logs.log,
    };
    return {
      root,
      layout,
      production,
      staleRoaming,
      staleWebView,
      env,
      probes,
      deps,
      lockDir,
    };
  }

  it("pins one run for both phases, hands over the lock and wipes the capture profile before seeding", async () => {
    const s = await captureScenario();
    const state = await readme.prepareCaptureIsolation(s.deps);

    expect(state.runProfile.runId).not.toBe("eeeeeeeeeeee");
    expect(s.env[iso.E2E_RUN_ID_ENV]).toBe(state.runProfile.runId);
    expect(s.env[iso.E2E_RUN_DIR_ENV]).toBe(state.runProfile.runDir);
    expect(s.env[iso.E2E_WEBVIEW2_DIR_ENV]).toBe(state.runProfile.webview2Dir);
    expect(s.env[iso.RUN_LOCK_TOKEN_ENV]).toBe(state.lock?.token);
    expect(s.probes).toEqual([
      [
        iso.PROFILE_PROBE_ARG,
        `${iso.WEBVIEW2_FOLDER_ARG}=${state.runProfile.webview2Dir}`,
      ],
    ]);
    expect(fs.existsSync(s.staleRoaming)).toBe(false);
    expect(fs.existsSync(s.staleWebView)).toBe(false);
    expect(fs.existsSync(s.production)).toBe(true);

    // A capture phase resolves the same run and inherits the lock.
    const phaseEnv = { ...s.env };
    expect(
      iso.resolveRunProfile({ env: phaseEnv, identifier: README }),
    ).toEqual(state.runProfile);
    const inherited = iso.acquireRunLock(README, {
      runId: state.runProfile.runId,
      lockDir: s.lockDir,
      env: phaseEnv,
      pid: 2,
      isAlive: (pid: number) => pid === 1,
    });
    expect(inherited.inherited).toBe(true);

    expect(
      readme.cleanupCaptureIsolation(state, {
        exec: s.deps.exec,
        log: captureLog().log,
      }),
    ).toEqual([]);
    expect(fs.existsSync(state.runProfile.runDir)).toBe(false);
    expect(fs.readdirSync(s.lockDir)).toEqual([]);
    for (const key of readme.CAPTURE_RUN_ENV_KEYS) {
      expect(s.env[key], key).toBeUndefined();
    }
    expect(fs.existsSync(s.production)).toBe(true);
  });

  it("refuses a binary without the capture identity before creating a run", async () => {
    const s = await captureScenario();
    const wrong = markerBinary(path.join(s.root, "wrong", EXE), [E2E]);
    await expect(
      readme.prepareCaptureIsolation({ ...s.deps, applicationPath: wrong }),
    ).rejects.toMatchObject({ code: "MARKER_MISMATCH" });
    expect(s.probes).toEqual([]);
    expect(fs.existsSync(path.join(s.root, "runs"))).toBe(false);
    expect(fs.existsSync(s.staleRoaming)).toBe(true);
  });

  it("releases the lock and removes the run when the probe fails", async () => {
    const s = await captureScenario();
    const failingSpawn: SpawnSyncLike = () => ({
      status: 70,
      signal: null,
      stdout: "",
      stderr: "identity failure",
      pid: 4242,
    });
    await expect(
      readme.prepareCaptureIsolation({ ...s.deps, spawnSync: failingSpawn }),
    ).rejects.toMatchObject({ code: "PROBE_FAILED" });
    expect(fs.readdirSync(s.lockDir)).toEqual([]);
    expect(fs.readdirSync(path.join(s.root, "runs"))).toEqual([]);
    expect(fs.existsSync(s.staleRoaming)).toBe(true);
    for (const key of readme.CAPTURE_RUN_ENV_KEYS) {
      expect(s.env[key], key).toBeUndefined();
    }
  });

  it("no longer derives a wipe target from APPDATA", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "scripts", "readme-screenshot.mjs"),
      "utf8",
    );
    expect(source).not.toMatch(
      /process\.env\.(?:APPDATA|LOCALAPPDATA|XDG_DATA_HOME)/,
    );
    expect(source).toContain("prepareCaptureIsolation({ applicationPath })");
    expect(source.indexOf("await buildCaptureApplication()")).toBeLessThan(
      source.indexOf("prepareCaptureIsolation({ applicationPath })"),
    );
    expect(
      source.indexOf("prepareCaptureIsolation({ applicationPath })"),
    ).toBeLessThan(source.indexOf("await startSshFixture()"));
  });
});

// ── wiring and docs ─────────────────────────────────────────────────────────

describe("package scripts and runbook", () => {
  it("exposes the build and self-test scripts", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    );
    expect(pkg.scripts["e2e:build"]).toBe("node ./scripts/e2e-build.mjs");
    expect(pkg.scripts["e2e:isolation:selftest"]).toBe(
      "node ./scripts/e2e-isolation-selftest.mjs",
    );
  });

  it("documents every refusal code, the override and the safe run procedure", () => {
    const runbook = fs.readFileSync(
      path.join(repoRoot, "docs", "testing", "e2e-runbook.md"),
      "utf8",
    );
    const declarations = fs.readFileSync(
      path.join(repoRoot, "scripts", "lib", "e2e-profile-isolation.d.mts"),
      "utf8",
    );
    const union =
      /export type RefusalCode =([\s\S]*?);/.exec(declarations)?.[1] ?? "";
    const codes = [...union.matchAll(/"([A-Z0-9_]+)"/g)].map(
      (match) => match[1],
    );
    expect(codes.length).toBeGreaterThan(30);
    for (const code of codes) {
      expect(runbook, code).toContain(`\`${code}\``);
    }
    for (const phrase of [
      "### Profile isolation",
      "### Dev and packaged profiles",
      "### Safe run procedure",
      "npm run e2e:build",
      "npm run e2e:isolation:selftest",
      iso.ALLOW_RUNNING_PRODUCTION_ENV,
      iso.E2E_RUN_ROOT_ENV,
      iso.KEEP_RUN_DIR_ENV,
      build.E2E_CARGO_TARGET_DIR_ENV,
      "--isolated-profile",
      "ssh-home",
    ]) {
      expect(runbook, phrase).toContain(phrase);
    }
    expect(runbook).not.toContain("### What per-run ports do not isolate");
  });
});
