// t91: the e2e harness refuses to launch anything it cannot prove is isolated
// from the production profile. Everything here runs against synthetic buffers,
// temp-dir fixtures and injected exec/spawn fakes; no real app binary, driver
// or PowerShell process is ever started.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import * as iso from "../../scripts/lib/e2e-profile-isolation.mjs";
import type {
  EnvRecord,
  Exec,
  ExecResult,
  ProcessRecord,
  ProfileProbe,
  RunProfile,
  SpawnSyncLike,
} from "../../scripts/lib/e2e-profile-isolation.mjs";

const repoRoot = process.cwd();
const E2E = iso.E2E_IDENTIFIER;
const README = iso.README_CAPTURE_IDENTIFIER;
const PROD = iso.PRODUCTION_IDENTIFIER;
const PROPERTY_TRIALS = 150;

// ── fixtures ────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "sorng-e2e-iso-")),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as { code?: string }).code ?? `untyped: ${String(error)}`;
  }
  return undefined;
}

async function asyncCodeOf(
  action: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await action();
  } catch (error) {
    return (error as { code?: string }).code ?? `untyped: ${String(error)}`;
  }
  return undefined;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function randomBytesFrom(random: () => number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    buffer[index] = Math.floor(random() * 256);
  }
  return buffer;
}

interface ProbeLayout {
  platform: NodeJS.Platform;
  roaming: string;
  local: string;
  identifier?: string;
  webview2Folder?: string | null;
}

function buildProbe({
  platform,
  roaming,
  local,
  identifier = E2E,
  webview2Folder = null,
}: ProbeLayout): ProfileProbe {
  const api = platform === "win32" ? path.win32 : path.posix;
  const dirsFor = (id: string) => ({
    appData: api.join(roaming, id),
    appLocalData: api.join(local, id),
    appConfig: api.join(roaming, id),
    appCache: api.join(local, id),
    appLog: api.join(local, id, "logs"),
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
      userDataFolder: webview2Folder,
      source: webview2Folder ? "arg" : "tauri-default",
      tauriDefault: dirs.appLocalData,
      productionDefault: api.join(local, PROD),
    },
    sshHome: api.join(dirs.appData, "ssh-home"),
    pid: 4242,
  };
}

const WIN_ROAMING = "C:\\Users\\tester\\AppData\\Roaming";
const WIN_LOCAL = "C:\\Users\\tester\\AppData\\Local";
const WIN_RUN_ROOT = `${WIN_LOCAL}\\sorng-e2e-runs`;
const RUN_ID = "0123456789ab";
const WIN_WEBVIEW2 = `${WIN_RUN_ROOT}\\${RUN_ID}\\webview2`;

function winProbe(): ProfileProbe {
  return buildProbe({
    platform: "win32",
    roaming: WIN_ROAMING,
    local: WIN_LOCAL,
    webview2Folder: WIN_WEBVIEW2,
  });
}

function posixProbe(): ProfileProbe {
  return buildProbe({
    platform: "linux",
    roaming: "/home/tester/.local/share",
    local: "/home/tester/.cache",
    webview2Folder: "/tmp/sorng-e2e-runs/0123456789ab/webview2",
  });
}

const enoentFs = {
  lstatSync() {
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  },
  existsSync: () => false,
} as unknown as typeof fs;

interface ExecCall {
  file: string;
  args: readonly string[];
  script?: string;
}

function fakeExec(handler: (call: ExecCall) => ExecResult) {
  const calls: ExecCall[] = [];
  const exec: Exec = (file, args) => {
    const index = args.indexOf("-EncodedCommand");
    const call: ExecCall = {
      file,
      args,
      script:
        index >= 0 ? iso.decodePowerShellCommand(args[index + 1]) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { exec, calls };
}

const ok = (stdout = ""): ExecResult => ({ status: 0, stdout, stderr: "" });
const failed = (status: number, stderr = ""): ExecResult => ({
  status,
  stdout: "",
  stderr,
});

function markerFile(dir: string, name: string, markers: string[]): string {
  const random = mulberry32(7);
  const parts: Buffer[] = [randomBytesFrom(random, 4096)];
  for (const identifier of markers) {
    parts.push(Buffer.from(iso.profileMarkerFor(identifier), "latin1"));
    parts.push(randomBytesFrom(random, 2048));
  }
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

/** Removes a symlink or junction fixture without touching its target. */
function removeLink(link: string): void {
  if (process.platform === "win32") {
    fs.rmdirSync(link);
  } else {
    fs.unlinkSync(link);
  }
}

function readRepo(relative: string): string {
  return fs.readFileSync(path.join(repoRoot, relative), "utf8");
}

function walk(
  dir: string,
  extensions: readonly string[],
  files: string[] = [],
): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === "target" ||
      entry.name.startsWith(".next") ||
      entry.name === "screenshots"
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, files);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(full);
    }
  }
  return files;
}

// ── identifiers and repository contracts ────────────────────────────────────

describe("isolation identifiers", () => {
  it("accepts only com.sortofremote.ng.<suffix> identifiers", () => {
    expect(iso.isIsolatedIdentifier(E2E)).toBe(true);
    expect(iso.isIsolatedIdentifier(README)).toBe(true);
    for (const bad of [
      PROD,
      "com.sortofremote.ng.",
      "com.sortofremote.ngx",
      "com.sortofremote.ng.E2E",
      "com.sortofremote.ng.e2e/x",
      "com.sortofremote.ng.e2e@x",
      "com.sortofremote.ng.e2e.extra",
      "org.example.app",
      "",
      undefined,
      42,
    ]) {
      expect(iso.isIsolatedIdentifier(bad), String(bad)).toBe(false);
      expect(codeOf(() => iso.assertIsolatedIdentifier(bad))).toBe(
        "INVALID_IDENTIFIER",
      );
    }
  });

  it("matches the Tauri configs", () => {
    const base = JSON.parse(readRepo("src-tauri/tauri.conf.json"));
    expect(base.identifier).toBe(PROD);
    expect(base.productName).toBe(iso.PRODUCT_NAME);
    const readme = JSON.parse(
      readRepo("src-tauri/tauri.readme-screenshot.conf.json"),
    );
    expect(readme.identifier).toBe(README);
  });

  it("keeps tauri.e2e.conf.json isolated, window-free and unbundled", () => {
    const conf = JSON.parse(readRepo("src-tauri/tauri.e2e.conf.json"));
    expect(conf.identifier).toBe(E2E);
    expect(iso.isIsolatedIdentifier(conf.identifier)).toBe(true);
    expect(conf.app?.windows).toBeUndefined();
    expect(conf.bundle?.active).toBe(false);
  });

  it("never lets release builds reference the e2e config", () => {
    for (const file of [
      ".github/workflows/release.yml",
      "scripts/ci/run-release-native-build.mjs",
    ]) {
      expect(readRepo(file), file).not.toContain("tauri.e2e.conf.json");
    }
  });

  it("names the isolated autostart value exactly", () => {
    expect(iso.autostartNameFor(E2E)).toBe(
      "sortOfRemoteNG (com.sortofremote.ng.e2e)",
    );
    expect(iso.parseIsolatedAutostartName(iso.autostartNameFor(E2E))).toBe(E2E);
    for (const name of [
      "sortOfRemoteNG",
      `sortOfRemoteNG (${PROD})`,
      "sortOfRemoteNG (com.sortofremote.ng.e2e) ",
      "SortOfRemoteNG (com.sortofremote.ng.e2e)",
      "evil (com.sortofremote.ng.e2e)",
      "sortOfRemoteNG (com.sortofremote.ng.e2e)(x)",
    ]) {
      expect(iso.parseIsolatedAutostartName(name), name).toBeNull();
    }
    expect(codeOf(() => iso.autostartNameFor(PROD))).toBe("INVALID_IDENTIFIER");
  });
});

// ── marker scan ─────────────────────────────────────────────────────────────

describe("identity marker scan", () => {
  const random = mulberry32(91);
  const marker = (id: string) =>
    Buffer.from(iso.profileMarkerFor(id), "latin1");

  it("finds a marker across every chunk boundary", () => {
    const buffer = Buffer.concat([
      randomBytesFrom(random, 257),
      marker(E2E),
      randomBytesFrom(random, 131),
    ]);
    const window = iso.PROFILE_MARKER_PREFIX.length + E2E.length + 2;
    for (let chunkSize = 1; chunkSize <= window + 3; chunkSize += 1) {
      expect(
        iso.scanProfileMarkerBuffer(buffer, { chunkSize }),
        `chunk ${chunkSize}`,
      ).toEqual({ identifiers: [E2E], markerCount: 1 });
    }
    for (let trial = 0; trial < 50; trial += 1) {
      const chunkSize = 1 + Math.floor(random() * 600);
      expect(iso.scanProfileMarkerBuffer(buffer, { chunkSize })).toEqual({
        identifiers: [E2E],
        markerCount: 1,
      });
    }
  });

  it("counts repeated markers once per occurrence and reports mixed identities", () => {
    const repeated = Buffer.concat([marker(E2E), marker(E2E)]);
    expect(iso.scanProfileMarkerBuffer(repeated, { chunkSize: 5 })).toEqual({
      identifiers: [E2E],
      markerCount: 2,
    });
    const mixed = Buffer.concat([
      marker(E2E),
      randomBytesFrom(random, 64),
      marker(PROD),
    ]);
    expect(iso.scanProfileMarkerBuffer(mixed, { chunkSize: 9 })).toEqual({
      identifiers: [E2E, PROD],
      markerCount: 2,
    });
  });

  it("ignores incomplete or malformed markers", () => {
    const prefix = iso.PROFILE_MARKER_PREFIX;
    for (const text of [
      `${prefix}`,
      `${prefix}com.sortofremote.ng.e2e`,
      `${prefix}]`,
      `${prefix}.e2e]`,
      `${prefix}com.sortofremote ng]`,
      `${prefix}${"a".repeat(129)}]`,
      "SORNG_PROFILE_MARKER_V2[identifier=com.sortofremote.ng.e2e]",
    ]) {
      expect(
        iso.scanProfileMarkerBuffer(Buffer.from(text, "latin1"), {
          chunkSize: 3,
        }),
        text,
      ).toEqual({ identifiers: [], markerCount: 0 });
    }
    const longest = "a".repeat(128);
    expect(
      iso.scanProfileMarkerBuffer(
        Buffer.from(`${prefix}${longest}]`, "latin1"),
        { chunkSize: 7 },
      ).identifiers,
    ).toEqual([longest]);
    expect(
      iso.scanProfileMarkerBuffer(
        Buffer.from(`${prefix}${prefix}${E2E}]`, "latin1"),
        { chunkSize: 4 },
      ).identifiers,
    ).toEqual([E2E]);
  });

  it("streams files and hashes them in the same pass", async () => {
    const dir = tempDir();
    const file = markerFile(dir, "app.bin", [E2E]);
    const bytes = fs.readFileSync(file);
    const result = await iso.inspectProfileBinary(file, { chunkSize: 11 });
    expect(result.identifiers).toEqual([E2E]);
    expect(result.size).toBe(bytes.length);
    expect(result.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(await iso.scanProfileMarkers(file)).toEqual([E2E]);
  });
});

// ── binary identity refusals ────────────────────────────────────────────────

describe("assertIsolatedBinary", () => {
  it("accepts an isolated binary and reports its identity", async () => {
    const dir = tempDir();
    const binary = markerFile(dir, "bin/app.exe", [E2E, E2E]);
    const verified = await iso.assertIsolatedBinary({
      binary,
      expectedIdentifier: E2E,
      repoRoot,
    });
    expect(verified.identifiers).toEqual([E2E]);
    expect(verified.markerCount).toBe(2);
    expect(verified.manifestPath).toBeNull();
  });

  it.each([
    ["no marker", [] as string[], E2E, "MARKER_MISSING"],
    ["the production marker", [PROD], E2E, "MARKER_PRODUCTION"],
    [
      "mixed isolated and production markers",
      [E2E, PROD],
      E2E,
      "MARKER_PRODUCTION",
    ],
    ["two isolated markers", [E2E, README], E2E, "MARKER_AMBIGUOUS"],
    ["another isolated identity", [README], E2E, "MARKER_MISMATCH"],
    ["a production expectation", [PROD], PROD, "INVALID_IDENTIFIER"],
  ])("refuses %s", async (_label, markers, expected, code) => {
    const dir = tempDir();
    const binary = markerFile(dir, "bin/app.exe", markers);
    expect(
      await asyncCodeOf(() =>
        iso.assertIsolatedBinary({
          binary,
          expectedIdentifier: expected,
          repoRoot,
        }),
      ),
    ).toBe(code);
  });

  it("refuses missing, non-file and junction-reached binaries", async () => {
    const dir = tempDir();
    expect(
      await asyncCodeOf(() =>
        iso.assertIsolatedBinary({
          binary: path.join(dir, "missing.exe"),
          expectedIdentifier: E2E,
        }),
      ),
    ).toBe("BINARY_MISSING");
    expect(
      await asyncCodeOf(() =>
        iso.assertIsolatedBinary({ binary: dir, expectedIdentifier: E2E }),
      ),
    ).toBe("BINARY_MISSING");
    expect(
      await asyncCodeOf(() =>
        iso.assertIsolatedBinary({ binary: "  ", expectedIdentifier: E2E }),
      ),
    ).toBe("BINARY_NOT_CONFIGURED");

    markerFile(dir, "real/app.exe", [E2E]);
    fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"), "junction");
    expect(
      await asyncCodeOf(() =>
        iso.assertIsolatedBinary({
          binary: path.join(dir, "link", "app.exe"),
          expectedIdentifier: E2E,
        }),
      ),
    ).toBe("BINARY_MISSING");
  });

  it("refuses binaries inside any src-tauri/target", async () => {
    const dir = tempDir();
    for (const relative of [
      "repo/src-tauri/target/debug/app.exe",
      "repo/.claude/worktrees/lane/src-tauri/target/debug/app.exe",
    ]) {
      const binary = markerFile(dir, relative, [E2E]);
      expect(
        await asyncCodeOf(() =>
          iso.assertIsolatedBinary({
            binary,
            expectedIdentifier: E2E,
            repoRoot: path.join(dir, "repo"),
          }),
        ),
        relative,
      ).toBe("BINARY_IN_SHARED_TARGET");
    }
    expect(
      iso.isInSharedCargoTarget("F:\\Repo\\SRC-TAURI\\Target\\debug\\app.exe", {
        platform: "win32",
      }),
    ).toBe(true);
    expect(
      iso.isInSharedCargoTarget(
        "F:\\Repo\\.artifacts\\e2e\\bin\\20260915-abc\\app.exe",
        { repoRoot: "F:\\Repo", platform: "win32" },
      ),
    ).toBe(false);
  });

  it("verifies a build manifest beside the binary", async () => {
    const dir = tempDir();
    const binary = markerFile(dir, "bin/app.exe", [E2E]);
    const bytes = fs.readFileSync(binary);
    const manifestPath = path.join(dir, "bin", iso.E2E_BUILD_MANIFEST_FILE);
    const manifest = {
      schema: iso.E2E_BUILD_MANIFEST_SCHEMA,
      identifier: E2E,
      exe: "app.exe",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    };
    const verify = () =>
      iso.assertIsolatedBinary({ binary, expectedIdentifier: E2E });

    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect((await verify()).manifestPath).toBe(manifestPath);

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, sha256: "0".repeat(64) }),
    );
    expect(await asyncCodeOf(verify)).toBe("MANIFEST_MISMATCH");

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, identifier: README }),
    );
    expect(await asyncCodeOf(verify)).toBe("MANIFEST_MISMATCH");

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, schema: "x" }),
    );
    expect(await asyncCodeOf(verify)).toBe("MANIFEST_INVALID");

    fs.writeFileSync(manifestPath, "{not json");
    expect(await asyncCodeOf(verify)).toBe("MANIFEST_INVALID");
  });
});

// ── probe contract ──────────────────────────────────────────────────────────

describe("validateProfileProbe", () => {
  const winOptions = {
    platform: "win32" as const,
    expectedWebView2Folder: WIN_WEBVIEW2,
  };

  it("accepts well-formed isolated probes on Windows and POSIX", () => {
    expect(() =>
      iso.validateProfileProbe(winProbe(), E2E, winOptions),
    ).not.toThrow();
    expect(() =>
      iso.validateProfileProbe(posixProbe(), E2E, { platform: "linux" }),
    ).not.toThrow();
    const cased = winProbe();
    cased.productionDirs.appData = cased.productionDirs.appData.toUpperCase();
    expect(() =>
      iso.validateProfileProbe(cased, E2E, winOptions),
    ).not.toThrow();
  });

  const cases: Array<[string, (probe: any) => void, string]> = [
    ["a production kind", (p) => (p.kind = "production"), "PROBE_INVALID"],
    [
      "a missing namespace",
      (p) => (p.keychainNamespace = null),
      "PROBE_INVALID",
    ],
    [
      "a wrong schema",
      (p) => (p.schema = "sorng-profile-probe/v0"),
      "PROBE_INVALID",
    ],
    ["a foreign identifier", (p) => (p.identifier = README), "PROBE_INVALID"],
    [
      "a production marker",
      (p) => (p.marker = iso.profileMarkerFor(PROD)),
      "PROBE_INVALID",
    ],
    [
      "a production autostart name",
      (p) => (p.autostartName = "sortOfRemoteNG"),
      "PROBE_INVALID",
    ],
    ["a bad pid", (p) => (p.pid = 0), "PROBE_INVALID"],
    [
      "a dir equal to its production sibling",
      (p) => (p.dirs.appData = p.productionDirs.appData),
      "PROBE_PRODUCTION_PATH",
    ],
    [
      "a dir nested in the production profile",
      (p) => (p.dirs.appCache = `${WIN_LOCAL}\\${PROD}\\${E2E}`),
      "PROBE_PRODUCTION_PATH",
    ],
    [
      "a relative dir",
      (p) => (p.dirs.appLog = `${E2E}\\logs`),
      "PROBE_INVALID",
    ],
    [
      "a dir with ..",
      (p) => (p.dirs.appLog = `${WIN_LOCAL}\\${E2E}\\..\\${E2E}\\logs`),
      "PROBE_INVALID",
    ],
    [
      "a dir holding the identifier twice",
      (p) => (p.dirs.appLog = `${WIN_LOCAL}\\${E2E}\\${E2E}`),
      "PROBE_INVALID",
    ],
    [
      "production dirs that are not siblings",
      (p) => (p.productionDirs.appData = `D:\\Elsewhere\\${PROD}`),
      "PROBE_INVALID",
    ],
    ["a missing webview2 block", (p) => delete p.webview2, "PROBE_INVALID"],
    [
      "a WebView2 folder chosen by env",
      (p) => (p.webview2.source = "env"),
      "PROBE_INVALID",
    ],
    [
      "a WebView2 folder other than the run folder",
      (p) =>
        (p.webview2.userDataFolder = `${WIN_RUN_ROOT}\\fedcba987654\\webview2`),
      "PROBE_INVALID",
    ],
    [
      "a WebView2 folder inside productionDefault",
      (p) => (p.webview2.userDataFolder = `${WIN_LOCAL}\\${PROD}\\EBWebView`),
      "PROBE_PRODUCTION_PATH",
    ],
    [
      "a WebView2 folder equal to productionDefault",
      (p) => (p.webview2.userDataFolder = `${WIN_LOCAL}\\${PROD}`),
      "PROBE_PRODUCTION_PATH",
    ],
    [
      "a tauriDefault outside the isolated profile",
      (p) => (p.webview2.tauriDefault = `${WIN_LOCAL}\\${PROD}`),
      "PROBE_INVALID",
    ],
    ["a missing SSH home", (p) => (p.sshHome = null), "PROBE_INVALID"],
    [
      "an SSH home outside the profile",
      (p) => (p.sshHome = "C:\\Users\\tester"),
      "PROBE_INVALID",
    ],
  ];

  it.each(cases)("refuses %s", (_label, mutate, code) => {
    const probe = structuredClone(winProbe());
    mutate(probe);
    expect(codeOf(() => iso.validateProfileProbe(probe, E2E, winOptions))).toBe(
      code,
    );
  });

  it("treats path case as significant on POSIX", () => {
    const probe = posixProbe();
    probe.productionDirs.appData = probe.productionDirs.appData.toUpperCase();
    expect(
      codeOf(() => iso.validateProfileProbe(probe, E2E, { platform: "linux" })),
    ).toBe("PROBE_INVALID");
  });
});

// ── probe execution ─────────────────────────────────────────────────────────

function hostLayout(root: string) {
  return {
    roaming: path.join(root, "Roaming"),
    local: path.join(root, "Local"),
  };
}

function hostRunProfile(root: string): RunProfile {
  const env: EnvRecord = {
    [iso.E2E_RUN_ROOT_ENV]: path.join(root, "runs"),
    [iso.E2E_RUN_ID_ENV]: RUN_ID,
  };
  return iso.resolveRunProfile({ env, identifier: E2E });
}

function hostProbe(root: string, runProfile: RunProfile): ProfileProbe {
  return buildProbe({
    platform: process.platform,
    ...hostLayout(root),
    webview2Folder: runProfile.webview2Dir,
  });
}

function probeSpawn(produce: (outFile: string) => unknown, status = 0) {
  const calls: Array<{ file: string; args: readonly string[]; env: any }> = [];
  const spawnSync: SpawnSyncLike = (file, args, options) => {
    const env = options.env as EnvRecord;
    calls.push({ file, args, env });
    const body = produce(env[iso.PROFILE_PROBE_OUT_ENV] as string);
    if (body !== undefined) {
      fs.writeFileSync(
        env[iso.PROFILE_PROBE_OUT_ENV] as string,
        JSON.stringify(body),
      );
    }
    return { status, signal: null, stdout: "", stderr: "refused", pid: 4242 };
  };
  return { spawnSync, calls };
}

describe("runProfileProbe", () => {
  async function verified(root: string) {
    const binary = markerFile(root, "bin/app.exe", [E2E]);
    return iso.assertIsolatedBinary({ binary, expectedIdentifier: E2E });
  }

  it("spawns the verified binary with the exact run inputs", async () => {
    const root = tempDir();
    const runProfile = hostRunProfile(root);
    const probe = hostProbe(root, runProfile);
    const { spawnSync, calls } = probeSpawn(() => probe);
    const result = iso.runProfileProbe({
      verifiedBinary: await verified(root),
      expectedIdentifier: E2E,
      runProfile,
      spawnSync,
      env: { [iso.WEBVIEW2_USER_DATA_FOLDER_ENV]: "C:\\somewhere\\else" },
    });
    expect(result).toEqual(probe);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      iso.PROFILE_PROBE_ARG,
      `${iso.WEBVIEW2_FOLDER_ARG}=${runProfile.webview2Dir}`,
    ]);
    expect(calls[0].env[iso.WEBVIEW2_USER_DATA_FOLDER_ENV]).toBe(
      runProfile.webview2Dir,
    );
    expect(calls[0].env[iso.EXPECT_ISOLATED_PROFILE_ENV]).toBe(E2E);
  });

  it("never spawns an unverified or modified binary", async () => {
    const root = tempDir();
    const { spawnSync, calls } = probeSpawn(() => undefined);
    const verifiedBinary = await verified(root);
    expect(
      codeOf(() =>
        iso.runProfileProbe({
          verifiedBinary: { ...verifiedBinary, identifiers: [] },
          expectedIdentifier: E2E,
          spawnSync,
        }),
      ),
    ).toBe("PROBE_FAILED");
    fs.appendFileSync(verifiedBinary.binary, "tampered");
    expect(
      codeOf(() =>
        iso.runProfileProbe({
          verifiedBinary,
          expectedIdentifier: E2E,
          spawnSync,
        }),
      ),
    ).toBe("BINARY_CHANGED");
    expect(calls).toHaveLength(0);
  });

  it("refuses failed, silent, mismatched and production-resolving probes", async () => {
    const root = tempDir();
    const runProfile = hostRunProfile(root);
    const probe = hostProbe(root, runProfile);
    const verifiedBinary = await verified(root);
    const run = (spawnSync: SpawnSyncLike) =>
      codeOf(() =>
        iso.runProfileProbe({
          verifiedBinary,
          expectedIdentifier: E2E,
          runProfile,
          spawnSync,
        }),
      );

    expect(run(probeSpawn(() => probe, 78).spawnSync)).toBe("PROBE_FAILED");
    expect(
      run(() => ({
        status: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      })),
    ).toBe("PROBE_FAILED");
    expect(run(probeSpawn(() => undefined).spawnSync)).toBe("PROBE_INVALID");
    expect(
      run(probeSpawn(() => ({ ...probe, identifier: README })).spawnSync),
    ).toBe("PROBE_INVALID");
    expect(run(probeSpawn(() => ({ ...probe, pid: 7 })).spawnSync)).toBe(
      "PROBE_INVALID",
    );
    const production = structuredClone(probe);
    production.dirs.appData = production.productionDirs.appData;
    expect(run(probeSpawn(() => production).spawnSync)).toBe(
      "PROBE_PRODUCTION_PATH",
    );
    const defaultWebView = structuredClone(probe);
    defaultWebView.webview2 = {
      ...defaultWebView.webview2,
      source: "tauri-default",
      userDataFolder: null,
    };
    expect(run(probeSpawn(() => defaultWebView).spawnSync)).toBe(
      "PROBE_INVALID",
    );
  });
});

// ── wipe safety ─────────────────────────────────────────────────────────────

describe("wipe target safety", () => {
  it("derives the Roaming and Local roots from the probe", () => {
    expect(iso.profileRoots(winProbe(), { platform: "win32" })).toEqual([
      `${WIN_ROAMING}\\${E2E}`,
      `${WIN_LOCAL}\\${E2E}`,
    ]);
  });

  it.each([
    ["the production roaming root", `${WIN_ROAMING}\\${PROD}`],
    ["the production local root", `${WIN_LOCAL}\\${PROD}`],
    ["a relative path", `AppData\\Roaming\\${E2E}`],
    ["a drive root", "C:\\"],
    ["a drive-root child", `C:\\${E2E}`],
    ["a wrong parent", `D:\\Elsewhere\\${E2E}`],
    ["a non-canonical path", `${WIN_ROAMING}\\x\\..\\${E2E}`],
    ["a trailing separator", `${WIN_ROAMING}\\${E2E}\\`],
    ["a case-changed basename", `${WIN_ROAMING}\\COM.SORTOFREMOTE.NG.E2E`],
    ["the isolated logs dir", `${WIN_LOCAL}\\${E2E}\\logs`],
    ["the parent folder", WIN_ROAMING],
  ])("rejects %s", (_label, root) => {
    expect(
      codeOf(() =>
        iso.assertSafeWipeTarget(root, winProbe(), {
          platform: "win32",
          fs: enoentFs,
        }),
      ),
    ).toBe("WIPE_TARGET_UNSAFE");
  });

  it("rejects every root of a probe that resolves production paths", () => {
    const probe = winProbe();
    probe.dirs.appData = probe.productionDirs.appData;
    for (const root of [`${WIN_ROAMING}\\${E2E}`, `${WIN_LOCAL}\\${E2E}`]) {
      expect(
        codeOf(() =>
          iso.assertSafeWipeTarget(root, probe, {
            platform: "win32",
            fs: enoentFs,
          }),
        ),
      ).toBe("WIPE_TARGET_UNSAFE");
    }
  });

  it("refuses junctions and files, and wipes only real isolated roots", () => {
    const root = tempDir();
    const runProfile = hostRunProfile(root);
    const probe = hostProbe(root, runProfile);
    const { roaming, local } = hostLayout(root);
    const productionFiles = [
      path.join(roaming, PROD, "databases", "index.json"),
      path.join(local, PROD, "EBWebView", "Local State"),
    ];
    for (const file of [
      ...productionFiles,
      path.join(roaming, E2E, "databases", "index.json"),
      path.join(root, "outside", "keep.txt"),
    ]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "x");
    }

    fs.symlinkSync(
      path.join(root, "outside"),
      path.join(local, E2E),
      "junction",
    );
    expect(codeOf(() => iso.wipeIsolatedProfile(probe))).toBe(
      "WIPE_TARGET_UNSAFE",
    );
    expect(fs.existsSync(path.join(roaming, E2E, "databases"))).toBe(true);
    expect(fs.existsSync(path.join(root, "outside", "keep.txt"))).toBe(true);

    removeLink(path.join(local, E2E));
    fs.writeFileSync(path.join(local, E2E), "file");
    expect(codeOf(() => iso.wipeIsolatedProfile(probe))).toBe(
      "WIPE_TARGET_UNSAFE",
    );
    fs.rmSync(path.join(local, E2E));

    fs.mkdirSync(path.join(local, E2E, "EBWebView"), { recursive: true });
    const result = iso.wipeIsolatedProfile(probe);
    expect(result.removed).toHaveLength(2);
    expect(fs.existsSync(path.join(roaming, E2E))).toBe(false);
    expect(fs.existsSync(path.join(local, E2E))).toBe(false);
    for (const file of productionFiles) {
      expect(fs.existsSync(file), file).toBe(true);
    }
    expect(fs.existsSync(path.join(root, "outside", "keep.txt"))).toBe(true);
  });

  it("property: no generated candidate that touches production is ever accepted", () => {
    const random = mulberry32(0x7391);
    const flipCase = (value: string) =>
      [...value]
        .map((char) => (random() < 0.5 ? char.toUpperCase() : char))
        .join("");
    let acceptedCount = 0;
    for (let trial = 0; trial < PROPERTY_TRIALS; trial += 1) {
      const windows = random() < 0.6;
      const platform: NodeJS.Platform = windows ? "win32" : "linux";
      const api = windows ? path.win32 : path.posix;
      const user = pick(random, ["tester", "Mariana", "a b", "ci"]);
      const identifier = pick(random, [
        E2E,
        README,
        `com.sortofremote.ng.slot-${Math.floor(random() * 100)}`,
      ]);
      const roaming = windows
        ? `${pick(random, ["C", "D", "F"])}:\\Users\\${user}\\${flipCase("AppData")}\\Roaming`
        : `/home/${user}/.local/share`;
      const local = windows
        ? api.join(api.dirname(roaming), "Local")
        : pick(random, [`/home/${user}/.cache`, `/home/${user}/.local/share`]);
      const probe = buildProbe({
        platform,
        roaming,
        local,
        identifier,
        webview2Folder: null,
      });
      const productionRoots = [api.join(roaming, PROD), api.join(local, PROD)];
      const isolatedRoots = iso.profileRoots(probe, { platform });

      const productionCandidates = [
        ...productionRoots,
        ...Object.values(probe.productionDirs),
        ...productionRoots.map((root) => flipCase(root)),
        ...productionRoots.map((root) => api.join(root, identifier)),
        ...productionRoots.map((root) => api.join(root, "..", PROD)),
        ...productionRoots.map((root) => `${root}${api.sep}`),
      ];
      const otherCandidates = [
        ...isolatedRoots,
        ...isolatedRoots.map((root) => api.join(root, PROD)),
        ...isolatedRoots.map((root) => flipCase(root)),
        roaming,
        local,
        api.parse(roaming).root,
        api.join(roaming, `${identifier}x`),
        api.join(api.parse(roaming).root, identifier),
      ];

      for (const candidate of [...productionCandidates, ...otherCandidates]) {
        const accepted =
          codeOf(() =>
            iso.assertSafeWipeTarget(candidate, probe, {
              platform,
              fs: enoentFs,
            }),
          ) === undefined;
        if (!accepted) continue;
        acceptedCount += 1;
        expect(
          productionCandidates.some((production) =>
            iso.samePath(production, candidate, platform),
          ),
        ).toBe(false);
        expect(
          isolatedRoots.some((root) => iso.samePath(root, candidate, platform)),
        ).toBe(true);
        expect(api.basename(candidate)).toBe(identifier);
        for (const productionRoot of productionRoots) {
          expect(iso.isSameOrInside(candidate, productionRoot, platform)).toBe(
            false,
          );
          expect(iso.isSameOrInside(productionRoot, candidate, platform)).toBe(
            false,
          );
        }
      }

      // A probe that points any directory at production yields no target.
      const hostile = structuredClone(probe);
      const key = pick(random, iso.PROFILE_DIRECTORY_KEYS);
      hostile.dirs[key] = pick(random, [
        hostile.productionDirs[key],
        api.join(productionRoots[0], identifier),
      ]);
      for (const candidate of [...isolatedRoots, ...productionCandidates]) {
        expect(
          codeOf(() =>
            iso.assertSafeWipeTarget(candidate, hostile, {
              platform,
              fs: enoentFs,
            }),
          ),
        ).toBe("WIPE_TARGET_UNSAFE");
      }
    }
    // Non-vacuous: the genuine isolated roots were accepted along the way.
    expect(acceptedCount).toBeGreaterThanOrEqual(PROPERTY_TRIALS);
  }, 60_000);
});

// ── keychain ────────────────────────────────────────────────────────────────

function productionKeychainServices(): string[] {
  const services = new Set<string>();
  const files = [
    ...walk(path.join(repoRoot, "src-tauri", "src"), [".rs"]),
    ...walk(path.join(repoRoot, "src-tauri", "crates"), [".rs"]),
    ...walk(path.join(repoRoot, "src"), [".ts", ".tsx"]),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const pattern = /["'`]((?:com\.)?sortofremoteng\.[A-Za-z0-9._-]*)/g;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      services.add(match[1]);
    }
  }
  return [...services];
}

describe("keychain cleanup", () => {
  it("matches only namespaced targets of the given identifier", () => {
    const target = `com.sortofremoteng.vault@${E2E}/master-dek`;
    expect(iso.isIsolatedKeychainTarget(target, E2E)).toBe(true);
    for (const bad of [
      "com.sortofremoteng.vault/master-dek",
      `com.sortofremoteng.vault@${PROD}/master-dek`,
      `com.sortofremoteng.vault@${README}/master-dek`,
      `com.sortofremoteng.vault@${E2E}-other/master-dek`,
      `com.sortofremoteng.vault@${E2E}/`,
      `com.sortofremoteng.vault@${E2E}/*`,
      `a/b@${E2E}/c`,
      `@${E2E}/c`,
      `x@y@${E2E}/c`,
    ]) {
      expect(iso.isIsolatedKeychainTarget(bad, E2E), bad).toBe(false);
    }
    expect(iso.isIsolatedKeychainTarget(target, PROD)).toBe(false);
  });

  it("never matches a production service found in the Rust or TS sources", () => {
    const services = productionKeychainServices();
    for (const known of [
      "com.sortofremoteng.vault",
      "sortofremoteng.internal.rest-api",
      "sortofremoteng.internal.database-protection.v1",
      "com.sortofremoteng.vpn",
      "com.sortofremoteng.integrations",
      "sortofremoteng.connection-notes",
      "sortofremoteng.ssh-command-history",
    ]) {
      expect(services).toContain(known);
    }
    const accounts = [
      "master-dek",
      "storage-encryption-key",
      "db-1",
      "a/b",
      "user@example.com",
      `@${E2E}/x`,
    ];
    for (const service of services) {
      for (const account of accounts) {
        for (const identifier of [E2E, README]) {
          expect(
            iso.isIsolatedKeychainTarget(`${service}/${account}`, identifier),
            `${service}/${account}`,
          ).toBe(false);
        }
        expect(
          iso.isIsolatedKeychainTarget(`${service}@${E2E}/${account}`, E2E),
        ).toBe(service.length > 0 && !service.includes("/"));
      }
    }
  }, 60_000);

  it("property: a target whose service has no '@' never matches", () => {
    const random = mulberry32(42);
    const alphabet = "abc.-_/@*: 12ZÅ";
    const text = (length: number) =>
      Array.from({ length }, () => pick(random, [...alphabet])).join("");
    for (let trial = 0; trial < 2000; trial += 1) {
      const service = text(1 + Math.floor(random() * 12)).replace(/[@/]/g, "");
      const account = text(Math.floor(random() * 30));
      expect(iso.isIsolatedKeychainTarget(`${service}/${account}`, E2E)).toBe(
        false,
      );
    }
  });

  it("is a no-op with a warning off Windows", () => {
    const { exec, calls } = fakeExec(() => ok());
    const warnings: string[] = [];
    const log = {
      info() {},
      warn: (m: string) => warnings.push(m),
      error() {},
    };
    expect(
      iso.cleanupIsolatedKeychain(E2E, { platform: "linux", exec, log }),
    ).toEqual({ supported: false, deleted: [], missing: [] });
    expect(calls).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("lists names only, re-validates them, then deletes the exact matches", () => {
    const target = `com.sortofremoteng.vault@${E2E}/master-dek`;
    const gone = `sortofremoteng.internal.rest-api@${E2E}/token`;
    const { exec, calls } = fakeExec((call) =>
      call.script?.includes("$targets")
        ? ok(
            JSON.stringify([
              { target, error: 0 },
              { target: gone, error: 1168 },
            ]),
          )
        : ok(JSON.stringify({ matched: [target, gone] })),
    );
    expect(
      iso.cleanupIsolatedKeychain(E2E, { platform: "win32", exec }),
    ).toEqual({ supported: true, deleted: [target], missing: [gone] });
    expect(calls.map((call) => call.file)).toEqual([
      "powershell.exe",
      "powershell.exe",
    ]);
    for (const call of calls) {
      expect(call.args).toEqual(
        expect.arrayContaining(["-NoProfile", "-NonInteractive"]),
      );
      expect(call.script).toContain("CredEnumerateW");
      expect(call.script).not.toMatch(
        /CredentialBlob|CredReadW|CryptUnprotectData/,
      );
      expect(call.script).toContain(iso.keychainTargetPattern(E2E).source);
    }
    expect(calls[1].script).toContain(`'${target}'`);
  });

  it("refuses a listing that selects a production entry and deletes nothing", () => {
    const { exec, calls } = fakeExec(() =>
      ok(JSON.stringify({ matched: ["com.sortofremoteng.vault/master-dek"] })),
    );
    expect(
      codeOf(() =>
        iso.cleanupIsolatedKeychain(E2E, { platform: "win32", exec }),
      ),
    ).toBe("KEYCHAIN_TARGET_UNSAFE");
    expect(calls).toHaveLength(1);
  });

  it("reports listing and deletion failures", () => {
    const target = `com.sortofremoteng.vault@${E2E}/master-dek`;
    expect(
      codeOf(() =>
        iso.cleanupIsolatedKeychain(E2E, {
          platform: "win32",
          exec: fakeExec(() => failed(1, "boom")).exec,
        }),
      ),
    ).toBe("KEYCHAIN_CLEANUP_FAILED");
    expect(
      codeOf(() =>
        iso.cleanupIsolatedKeychain(E2E, {
          platform: "win32",
          exec: fakeExec((call) =>
            call.script?.includes("$targets")
              ? ok(JSON.stringify([{ target, error: 5 }]))
              : ok(JSON.stringify({ matched: [target] })),
          ).exec,
        }),
      ),
    ).toBe("KEYCHAIN_CLEANUP_FAILED");
    expect(
      codeOf(() =>
        iso.cleanupIsolatedKeychain(E2E, {
          platform: "win32",
          exec: fakeExec((call) =>
            call.script?.includes("$targets")
              ? ok(JSON.stringify([{ target: "other", error: 0 }]))
              : ok(JSON.stringify({ matched: [target] })),
          ).exec,
        }),
      ),
    ).toBe("KEYCHAIN_TARGET_UNSAFE");
    const empty = fakeExec(() => ok(JSON.stringify({ matched: [] })));
    iso.cleanupIsolatedKeychain(E2E, { platform: "win32", exec: empty.exec });
    expect(empty.calls).toHaveLength(1);
  });

  it("escapes quotes and refuses unsafe names when building the delete script", () => {
    const quoted = `svc'x@${E2E}/it's`;
    expect(iso.buildKeychainDeleteScript(E2E, [quoted])).toContain(
      "'svc''x@com.sortofremote.ng.e2e/it''s'",
    );
    expect(
      codeOf(() =>
        iso.buildKeychainDeleteScript(E2E, [
          "com.sortofremoteng.vault/master-dek",
        ]),
      ),
    ).toBe("KEYCHAIN_TARGET_UNSAFE");
  });
});

// ── autostart ───────────────────────────────────────────────────────────────

describe("autostart cleanup", () => {
  const name = iso.autostartNameFor(E2E);
  const [runKey, approvedKey] = iso.AUTOSTART_REGISTRY_KEYS;

  it("deletes the exact value from Run and StartupApproved\\Run via reg.exe", () => {
    const { exec, calls } = fakeExec((call) =>
      call.args[0] === "query" && call.args[1] === approvedKey
        ? failed(1)
        : ok(),
    );
    expect(
      iso.cleanupIsolatedAutostart(name, {
        expectedIdentifier: E2E,
        platform: "win32",
        exec,
      }),
    ).toEqual({ supported: true, removed: [runKey] });
    expect(calls.map(({ file, args }) => [file, ...args])).toEqual([
      ["reg.exe", "query", runKey, "/v", name],
      ["reg.exe", "delete", runKey, "/v", name, "/f"],
      ["reg.exe", "query", approvedKey, "/v", name],
    ]);
  });

  it("refuses any other name without running anything", () => {
    const { exec, calls } = fakeExec(() => ok());
    for (const unsafe of ["sortOfRemoteNG", `sortOfRemoteNG (${PROD})`]) {
      expect(
        codeOf(() =>
          iso.cleanupIsolatedAutostart(unsafe, { platform: "win32", exec }),
        ),
      ).toBe("AUTOSTART_NAME_UNSAFE");
    }
    expect(
      codeOf(() =>
        iso.cleanupIsolatedAutostart(iso.autostartNameFor(README), {
          expectedIdentifier: E2E,
          platform: "win32",
          exec,
        }),
      ),
    ).toBe("AUTOSTART_NAME_UNSAFE");
    expect(calls).toHaveLength(0);
  });

  it("reports reg failures and skips non-Windows hosts", () => {
    expect(
      codeOf(() =>
        iso.cleanupIsolatedAutostart(name, {
          platform: "win32",
          exec: fakeExec((call) =>
            call.args[0] === "delete" ? failed(1, "denied") : ok(),
          ).exec,
        }),
      ),
    ).toBe("AUTOSTART_CLEANUP_FAILED");
    expect(
      codeOf(() =>
        iso.cleanupIsolatedAutostart(name, {
          platform: "win32",
          exec: fakeExec(() => failed(2)).exec,
        }),
      ),
    ).toBe("AUTOSTART_CLEANUP_FAILED");
    const { exec, calls } = fakeExec(() => ok());
    expect(
      iso.cleanupIsolatedAutostart(name, {
        platform: "darwin",
        exec,
        log: { info() {}, warn() {}, error() {} },
      }).supported,
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

// ── running processes ───────────────────────────────────────────────────────

describe("production process detection", () => {
  it("recognises tauri dev launchers by command line", () => {
    for (const command of [
      '"C:\\Program Files\\nodejs\\node.exe" ./scripts/tauri.mjs dev',
      "node ./scripts/tauri-dev.mjs",
      "node F:\\repo\\node_modules\\@tauri-apps\\cli\\tauri.js dev -c {}",
      '"C:\\nodejs\\node.exe" "C:\\npm\\npm-cli.js" run tauri dev',
      "npm run tauri:dev",
      "cargo-tauri.exe tauri dev",
      "cargo tauri dev",
    ]) {
      expect(iso.TAURI_DEV_COMMAND_PATTERN.test(command), command).toBe(true);
    }
    for (const command of [
      "node node_modules/@tauri-apps/cli/tauri.js build --debug --config src-tauri/tauri.e2e.conf.json",
      "node ./scripts/e2e-build.mjs",
      "node node_modules/@wdio/cli/bin/wdio.js run e2e/wdio.conf.ts",
      "node ./scripts/dev-server.mjs",
      "node tauri.js devtools",
    ]) {
      expect(iso.TAURI_DEV_COMMAND_PATTERN.test(command), command).toBe(false);
    }
  });

  it("classifies app images and launchers on Windows", () => {
    const binary = "F:\\Repo\\.artifacts\\e2e\\bin\\x\\app.exe";
    const records: ProcessRecord[] = [
      {
        pid: 10,
        name: "app.exe",
        executablePath: "F:\\Repo\\src-tauri\\target\\debug\\app.exe",
        commandLine: null,
      },
      {
        pid: 11,
        name: "sortOfRemoteNG.exe",
        executablePath: "C:\\Program Files\\sortOfRemoteNG\\sortOfRemoteNG.exe",
        commandLine: null,
      },
      {
        pid: 12,
        name: "APP.EXE",
        executablePath: binary.toUpperCase(),
        commandLine: null,
      },
      { pid: 13, name: "app.exe", executablePath: null, commandLine: null },
      {
        pid: 14,
        name: "node.exe",
        executablePath: "C:\\nodejs\\node.exe",
        commandLine: "node ./scripts/tauri-dev.mjs",
      },
      {
        pid: 15,
        name: "node.exe",
        executablePath: "C:\\nodejs\\node.exe",
        commandLine: "node wdio.js run e2e/wdio.conf.ts",
      },
      {
        pid: 16,
        name: "msedgewebview2.exe",
        executablePath: "C:\\x\\msedgewebview2.exe",
        commandLine: null,
      },
      {
        pid: 99,
        name: "app.exe",
        executablePath: "C:\\other\\app.exe",
        commandLine: null,
      },
    ];
    const { production, sameBinary } = iso.classifyProcesses(records, {
      binary,
      platform: "win32",
      selfPid: 99,
    });
    expect(production.map((entry) => entry.pid)).toEqual([10, 11, 13, 14]);
    expect(sameBinary.map((entry) => entry.pid)).toEqual([12]);
    expect(JSON.stringify(production)).not.toContain("tauri-dev.mjs");
  });

  it("parses the CIM listing and fails closed on bad output", () => {
    const row = {
      pid: 5,
      name: "app.exe",
      executablePath: "C:\\a\\app.exe",
      commandLine: null,
    };
    const single = fakeExec(() => ok(JSON.stringify(row)));
    expect(
      iso.listCandidateProcesses({ platform: "win32", exec: single.exec }),
    ).toEqual([row]);
    expect(single.calls[0].script).toContain(
      "Get-CimInstance -ClassName Win32_Process",
    );
    expect(
      iso
        .listProductionProcesses("C:\\e2e\\app.exe", {
          platform: "win32",
          exec: single.exec,
        })
        .map((entry) => entry.pid),
    ).toEqual([5]);
    for (const response of [
      failed(1, "cim"),
      ok("{nope"),
      ok('[{"pid":"x"}]'),
    ]) {
      expect(
        codeOf(() =>
          iso.listCandidateProcesses({
            platform: "win32",
            exec: fakeExec(() => response).exec,
          }),
        ),
      ).toBe("PROCESS_CHECK_FAILED");
    }
  });

  it("parses ps output on POSIX", () => {
    const { exec, calls } = fakeExec(() =>
      ok(
        [
          "  1 /sbin/init",
          " 20 /home/dev/repo/src-tauri/target/debug/app --flag",
          " 21 node ./scripts/tauri-dev.mjs",
        ].join("\n"),
      ),
    );
    const production = iso.listProductionProcesses("/e2e/bin/app", {
      platform: "linux",
      exec,
      selfPid: 1,
    });
    expect(calls[0].file).toBe("ps");
    expect(production.map((entry) => entry.pid)).toEqual([20, 21]);
  });
});

// ── run lock ────────────────────────────────────────────────────────────────

describe("run lock", () => {
  const quiet = { info() {}, warn() {}, error() {} };

  it("serialises runs and treats a lock as stale only when its pid is dead", () => {
    const lockDir = tempDir();
    const alive = new Set([100]);
    const isAlive = (pid: number) => alive.has(pid);
    const lock = iso.acquireRunLock(E2E, {
      lockDir,
      pid: 100,
      runId: RUN_ID,
      isAlive,
      log: quiet,
    });
    expect(lock.inherited).toBe(false);
    expect(iso.readRunLock(E2E, { lockDir })).toMatchObject({
      pid: 100,
      runId: RUN_ID,
      token: lock.token,
    });
    expect(
      codeOf(() =>
        iso.acquireRunLock(E2E, { lockDir, pid: 200, isAlive, log: quiet }),
      ),
    ).toBe("LOCK_HELD");

    alive.delete(100);
    const warnings: string[] = [];
    const next = iso.acquireRunLock(E2E, {
      lockDir,
      pid: 200,
      isAlive: () => false,
      log: { ...quiet, warn: (m: string) => warnings.push(m) },
    });
    expect(next.pid).toBe(200);
    expect(warnings[0]).toContain("stale");
  });

  it("refuses unreadable locks", () => {
    const lockDir = tempDir();
    fs.writeFileSync(iso.runLockPath(E2E, { lockDir }), "{half");
    expect(codeOf(() => iso.acquireRunLock(E2E, { lockDir, log: quiet }))).toBe(
      "LOCK_UNREADABLE",
    );
  });

  it("hands a lock to a child only for the same token and run id", () => {
    const lockDir = tempDir();
    const isAlive = () => true;
    const parent = iso.acquireRunLock(E2E, {
      lockDir,
      runId: RUN_ID,
      isAlive,
      log: quiet,
    });
    const env = { [iso.RUN_LOCK_TOKEN_ENV]: parent.token };
    const child = iso.acquireRunLock(E2E, {
      lockDir,
      runId: RUN_ID,
      env,
      isAlive,
      log: quiet,
    });
    expect(child.inherited).toBe(true);
    expect(iso.releaseRunLock(child)).toBe(false);
    expect(fs.existsSync(parent.path)).toBe(true);
    expect(
      codeOf(() =>
        iso.acquireRunLock(E2E, {
          lockDir,
          runId: "fedcba987654",
          env,
          isAlive,
          log: quiet,
        }),
      ),
    ).toBe("LOCK_HELD");
  });

  it("releases only its own lock and clears the run abort", () => {
    const lockDir = tempDir();
    const lock = iso.acquireRunLock(E2E, {
      lockDir,
      runId: RUN_ID,
      log: quiet,
    });
    const abortPath = iso.markRunAborted({
      identifier: E2E,
      runId: RUN_ID,
      reason: "test",
      lockDir,
    });
    expect(iso.releaseRunLock({ ...lock, token: "someone-else" })).toBe(false);
    expect(fs.existsSync(lock.path)).toBe(true);
    expect(iso.releaseRunLock(lock)).toBe(true);
    expect(fs.existsSync(lock.path)).toBe(false);
    expect(fs.existsSync(abortPath)).toBe(false);
  });
});

// ── per-run WebView2 folder ─────────────────────────────────────────────────

describe("run profile and WebView2 folder", () => {
  it("resolves once and publishes to env so workers reuse the launcher's run", () => {
    const env: EnvRecord = { LOCALAPPDATA: WIN_LOCAL };
    const first = iso.resolveRunProfile({
      env,
      identifier: E2E,
      platform: "win32",
      createRunId: () => RUN_ID,
    });
    expect(first).toEqual({
      runId: RUN_ID,
      runRoot: WIN_RUN_ROOT,
      runDir: `${WIN_RUN_ROOT}\\${RUN_ID}`,
      webview2Dir: WIN_WEBVIEW2,
    });
    expect(env[iso.E2E_RUN_ID_ENV]).toBe(RUN_ID);
    const workerEnv = { ...env };
    expect(
      iso.resolveRunProfile({
        env: workerEnv,
        identifier: E2E,
        platform: "win32",
        createRunId: () => "ffffffffffff",
      }),
    ).toEqual(first);

    const generated = iso.resolveRunProfile({
      env: {},
      identifier: E2E,
      platform: "linux",
      tmpDir: "/tmp",
    });
    expect(generated.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(generated.runRoot).toBe("/tmp/sorng-e2e-runs");
  });

  it.each([
    ["an invalid pinned run id", { [iso.E2E_RUN_ID_ENV]: "ABC" }],
    [
      "a pinned run dir that is not derived",
      { [iso.E2E_RUN_ID_ENV]: RUN_ID, [iso.E2E_RUN_DIR_ENV]: "C:\\elsewhere" },
    ],
    [
      "a pinned WebView2 dir that is not derived",
      {
        [iso.E2E_RUN_ID_ENV]: RUN_ID,
        [iso.E2E_WEBVIEW2_DIR_ENV]: `${WIN_LOCAL}\\${PROD}\\EBWebView`,
      },
    ],
    [
      "a runs root inside the production profile",
      { [iso.E2E_RUN_ROOT_ENV]: `${WIN_LOCAL}\\${PROD}\\runs` },
    ],
    [
      "a runs root inside the isolated profile",
      { [iso.E2E_RUN_ROOT_ENV]: `${WIN_LOCAL}\\${E2E}` },
    ],
    ["a relative runs root", { [iso.E2E_RUN_ROOT_ENV]: "runs" }],
    ["a drive root", { [iso.E2E_RUN_ROOT_ENV]: "C:\\" }],
    [
      "an 8.3 short-name runs root",
      { [iso.E2E_RUN_ROOT_ENV]: "C:\\Users\\MARIAN~1\\AppData\\Local\\Temp" },
    ],
    [
      "a component Windows would rewrite",
      { [iso.E2E_RUN_ROOT_ENV]: "C:\\Users\\tester\\runs. " },
    ],
  ])("refuses %s", (_label, overrides) => {
    expect(
      codeOf(() =>
        iso.resolveRunProfile({
          env: { LOCALAPPDATA: WIN_LOCAL, ...overrides },
          identifier: E2E,
          platform: "win32",
        }),
      ),
    ).toBe("RUN_DIR_UNSAFE");
  });

  it("yields matching env and flag and requires that flag in launch args", () => {
    const runProfile = iso.resolveRunProfile({
      env: { LOCALAPPDATA: WIN_LOCAL, [iso.E2E_RUN_ID_ENV]: RUN_ID },
      identifier: E2E,
      platform: "win32",
    });
    const launch = iso.webview2Launch(runProfile, { platform: "win32" });
    expect(launch).toEqual({
      env: { WEBVIEW2_USER_DATA_FOLDER: WIN_WEBVIEW2 },
      args: [`--sorng-webview2-user-data-folder=${WIN_WEBVIEW2}`],
    });
    const check = (args: unknown) =>
      codeOf(() =>
        iso.assertWebView2LaunchArgs(args, runProfile, { platform: "win32" }),
      );
    expect(check(["--collection=x", ...launch.args])).toBeUndefined();
    expect(check([])).toBe("INVALID_OPTIONS");
    expect(check(undefined)).toBe("INVALID_OPTIONS");
    expect(check([...launch.args, ...launch.args])).toBe("INVALID_OPTIONS");
    expect(
      check([`--sorng-webview2-user-data-folder=${WIN_LOCAL}\\${PROD}`]),
    ).toBe("INVALID_OPTIONS");
  });

  it("creates, verifies and wipes marker-owned run dirs only", () => {
    const root = tempDir();
    const runProfile = hostRunProfile(root);
    const first = iso.createRunDir(runProfile);
    expect(first.created).toBe(true);
    expect(
      fs.readFileSync(
        path.join(runProfile.runDir, iso.RUN_DIR_MARKER_FILE),
        "utf8",
      ),
    ).toBe(RUN_ID);
    expect(fs.readdirSync(runProfile.webview2Dir)).toEqual([]);
    expect(iso.createRunDir(runProfile).created).toBe(false);

    const { runRoot } = runProfile;
    const assertDir = (dir: string) =>
      codeOf(() => iso.assertSafeRunDir(dir, { runRoot }));
    expect(assertDir(runProfile.runDir)).toBeUndefined();

    const unmarked = path.join(runRoot, "aaaaaaaaaaaa");
    fs.mkdirSync(unmarked);
    expect(assertDir(unmarked)).toBe("RUN_DIR_UNSAFE");
    fs.writeFileSync(
      path.join(unmarked, iso.RUN_DIR_MARKER_FILE),
      "bbbbbbbbbbbb",
    );
    expect(assertDir(unmarked)).toBe("RUN_DIR_UNSAFE");

    const named = path.join(runRoot, "not-a-run");
    fs.mkdirSync(named);
    fs.writeFileSync(path.join(named, iso.RUN_DIR_MARKER_FILE), "not-a-run");
    expect(assertDir(named)).toBe("RUN_DIR_UNSAFE");

    const elsewhere = path.join(root, "elsewhere", "cccccccccccc");
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(
      path.join(elsewhere, iso.RUN_DIR_MARKER_FILE),
      "cccccccccccc",
    );
    expect(assertDir(elsewhere)).toBe("RUN_DIR_UNSAFE");

    const junction = path.join(runRoot, "dddddddddddd");
    const target = path.join(root, "target-dir");
    fs.mkdirSync(target);
    fs.writeFileSync(
      path.join(target, iso.RUN_DIR_MARKER_FILE),
      "dddddddddddd",
    );
    fs.symlinkSync(target, junction, "junction");
    expect(assertDir(junction)).toBe("RUN_DIR_UNSAFE");
    expect(codeOf(() => iso.wipeRunDir(junction, { runRoot }))).toBe(
      "RUN_DIR_UNSAFE",
    );
    expect(fs.existsSync(path.join(target, iso.RUN_DIR_MARKER_FILE))).toBe(
      true,
    );

    expect(codeOf(() => iso.wipeRunDir(unmarked, { runRoot }))).toBe(
      "RUN_DIR_UNSAFE",
    );
    expect(fs.existsSync(unmarked)).toBe(true);
    expect(iso.wipeRunDir(runProfile.runDir, { runRoot })).toBe(true);
    expect(fs.existsSync(runProfile.runDir)).toBe(false);
    expect(iso.wipeRunDir(runProfile.runDir, { runRoot })).toBe(false);
  });

  it("sweeps stale unreferenced run dirs and keeps live or fresh ones", () => {
    const root = tempDir();
    const runRoot = path.join(root, "runs");
    const lockDir = path.join(root, "locks");
    fs.mkdirSync(lockDir);
    const make = (runId: string) =>
      iso.createRunDir(
        iso.resolveRunProfile({
          env: {
            [iso.E2E_RUN_ROOT_ENV]: runRoot,
            [iso.E2E_RUN_ID_ENV]: runId,
          },
          identifier: E2E,
        }),
      );
    make("111111111111");
    make("222222222222");
    make("333333333333");
    fs.mkdirSync(path.join(runRoot, "444444444444"));
    fs.writeFileSync(
      iso.runLockPath(README, { lockDir }),
      JSON.stringify({ pid: 5, token: "t", runId: "222222222222" }),
    );
    const removed = iso.sweepStaleRunDirs({
      runRoot,
      keepRunIds: ["333333333333"],
      lockDir,
      isAlive: (pid) => pid === 5,
      now: () => new Date(Date.now() + 7 * 60 * 60 * 1000),
      log: { info() {}, warn() {}, error() {} },
    });
    expect(removed).toEqual([path.join(runRoot, "111111111111")]);
    expect(fs.readdirSync(runRoot).sort()).toEqual([
      "222222222222",
      "333333333333",
      "444444444444",
    ]);
    expect(
      iso.sweepStaleRunDirs({
        runRoot,
        lockDir,
        isAlive: () => false,
        log: { info() {}, warn() {}, error() {} },
      }),
    ).toEqual([]);
  });

  it("flags WebView2 UserDataFolder policies that apply to the app", () => {
    const output = [
      "",
      "HKEY_LOCAL_MACHINE\\Software\\Policies\\Microsoft\\Edge\\WebView2\\UserDataFolder",
      "    app.exe    REG_SZ    D:\\shared",
      "    sortOfRemoteNG.exe    REG_EXPAND_SZ    %TEMP%\\x",
      "    *    REG_SZ    E:\\all",
      "    other.exe    REG_SZ    F:\\other",
      "    (Default)    REG_SZ",
      "",
    ].join("\r\n");
    const names = iso.parseRegQueryValueNames(output);
    expect(names).toEqual([
      "app.exe",
      "sortOfRemoteNG.exe",
      "*",
      "other.exe",
      "(Default)",
    ]);
    expect(iso.findWebView2PolicyOverrides(names)).toEqual([
      "app.exe",
      "sortOfRemoteNG.exe",
      "*",
    ]);
    expect(
      iso.findWebView2PolicyOverrides(names, { binary: "C:\\e2e\\OTHER.exe" }),
    ).toContain("other.exe");

    const absent = fakeExec(() => failed(1));
    expect(
      iso.checkWebView2PolicyOverride({ platform: "win32", exec: absent.exec }),
    ).toEqual({ supported: true, overrides: [] });
    expect(absent.calls.map((call) => call.args)).toEqual(
      iso.WEBVIEW2_POLICY_KEYS.map((key) => ["query", key]),
    );
    expect(
      codeOf(() =>
        iso.checkWebView2PolicyOverride({
          platform: "win32",
          exec: fakeExec(() => ok(output)).exec,
        }),
      ),
    ).toBe("WEBVIEW2_POLICY_OVERRIDE");
    expect(
      codeOf(() =>
        iso.checkWebView2PolicyOverride({
          platform: "win32",
          exec: fakeExec(() => failed(5)).exec,
        }),
      ),
    ).toBe("WEBVIEW2_POLICY_CHECK_FAILED");
    expect(
      iso.checkWebView2PolicyOverride({ platform: "linux" }).supported,
    ).toBe(false);
  });

  it("requires positive WebView2 evidence in the run folder", async () => {
    const root = tempDir();
    const runProfile = hostRunProfile(root);
    iso.createRunDir(runProfile);
    const probe = hostProbe(root, runProfile);
    const runFolder = path.join(runProfile.webview2Dir, "EBWebView");
    const defaultFolder = path.join(probe.webview2.tauriDefault, "EBWebView");
    let clock = 0;
    const now = () => clock;

    let polls = 0;
    await expect(
      iso.assertWebView2Evidence({
        probe,
        runProfile,
        now,
        sleep: async (ms) => {
          clock += ms;
          polls += 1;
          if (polls === 3) fs.mkdirSync(runFolder);
        },
      }),
    ).resolves.toEqual({ runFolder, defaultFolder });

    fs.rmSync(runFolder, { recursive: true });
    clock = 0;
    expect(
      await asyncCodeOf(() =>
        iso.assertWebView2Evidence({
          probe,
          runProfile,
          now,
          timeoutMs: 1_000,
          sleep: async (ms) => {
            clock += ms;
          },
        }),
      ),
    ).toBe("WEBVIEW2_EVIDENCE_MISSING");

    fs.mkdirSync(runFolder);
    fs.mkdirSync(defaultFolder, { recursive: true });
    expect(
      await asyncCodeOf(() =>
        iso.assertWebView2Evidence({
          probe,
          runProfile,
          now,
          sleep: async () => {},
        }),
      ),
    ).toBe("WEBVIEW2_EVIDENCE_MISSING");
  });
});

// ── launcher preflight refusal matrix ───────────────────────────────────────

interface ScenarioOptions {
  markers?: string[];
  probe?: (probe: ProfileProbe) => unknown;
  processes?: ProcessRecord[];
  env?: EnvRecord;
  lockHeldBy?: number;
}

async function scenario(options: ScenarioOptions = {}) {
  const root = tempDir();
  const { roaming, local } = hostLayout(root);
  const binary = markerFile(
    root,
    process.platform === "win32" ? "bin/app.exe" : "bin/app",
    options.markers ?? [E2E],
  );
  const lockDir = path.join(root, "locks");
  fs.mkdirSync(lockDir);
  const runProfile = hostRunProfile(root);
  const probe = hostProbe(root, runProfile);
  const knownHostsPath = path.join(root, "home", ".ssh", "known_hosts");
  fs.mkdirSync(path.dirname(knownHostsPath), { recursive: true });
  fs.writeFileSync(knownHostsPath, "github.com ssh-ed25519 AAAA\n");

  const stale = path.join(roaming, E2E, "databases", "stale.json");
  const production = [
    path.join(roaming, PROD, "databases", "index.json"),
    path.join(local, PROD, "EBWebView", "Default", "Local Storage", "x"),
  ];
  for (const file of [stale, ...production]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");
  }
  if (options.lockHeldBy) {
    fs.writeFileSync(
      iso.runLockPath(E2E, { lockDir }),
      JSON.stringify({ pid: options.lockHeldBy, token: "other", runId: null }),
    );
  }

  const records = options.processes ?? [];
  const { exec, calls: execCalls } = fakeExec((call) => {
    if (call.file === "ps") {
      return ok(
        records
          .map((r) => `${r.pid} ${r.commandLine ?? r.executablePath ?? r.name}`)
          .join("\n"),
      );
    }
    if (call.script?.includes("Win32_Process")) {
      return ok(JSON.stringify(records));
    }
    if (call.script?.includes("GenericTargetNames")) {
      return ok(JSON.stringify({ matched: [] }));
    }
    return failed(1);
  });
  const spawn = probeSpawn(() =>
    options.probe ? options.probe(probe) : probe,
  );
  const warnings: string[] = [];
  const log = { info() {}, warn: (m: string) => warnings.push(m), error() {} };
  const isAlive = (pid: number) => pid === 1 || pid === options.lockHeldBy;

  const prepare = () =>
    iso.prepareIsolatedE2eRun({
      binary,
      expectedIdentifier: E2E,
      wipe: "before-and-after",
      runProfile,
      repoRoot,
      env: { ...options.env },
      exec,
      spawnSync: spawn.spawnSync,
      lockDir,
      isAlive,
      selfPid: 1,
      knownHostsPath,
      log,
    });

  return {
    root,
    binary,
    lockDir,
    runProfile,
    probe,
    knownHostsPath,
    stale,
    production,
    execCalls,
    spawnCalls: spawn.calls,
    warnings,
    isAlive,
    prepare,
  };
}

const productionProcess: ProcessRecord =
  process.platform === "win32"
    ? {
        pid: 777,
        name: "app.exe",
        executablePath: "F:\\Projects\\repo\\src-tauri\\target\\debug\\app.exe",
        commandLine: null,
      }
    : {
        pid: 777,
        name: "app",
        executablePath: "/home/dev/repo/src-tauri/target/debug/app",
        commandLine: null,
      };

describe("prepareIsolatedE2eRun", () => {
  it("proves isolation, wipes only e2e state and publishes the run", async () => {
    const s = await scenario();
    const run = await s.prepare();

    expect(run.env).toEqual({
      [iso.EXPECT_ISOLATED_PROFILE_ENV]: E2E,
      [iso.WEBVIEW2_USER_DATA_FOLDER_ENV]: s.runProfile.webview2Dir,
      [iso.E2E_PROFILE_JSON_ENV]: JSON.stringify(s.probe),
      [iso.E2E_PREFLIGHT_ENV]: `ok:${RUN_ID}`,
    });
    expect(s.spawnCalls).toHaveLength(1);
    expect(fs.existsSync(s.stale)).toBe(false);
    for (const file of s.production) {
      expect(fs.existsSync(file), file).toBe(true);
    }
    expect(iso.readRunLock(E2E, { lockDir: s.lockDir })?.runId).toBe(RUN_ID);
    expect(
      fs.existsSync(path.join(s.runProfile.runDir, iso.RUN_DIR_MARKER_FILE)),
    ).toBe(true);

    const workerEnv: EnvRecord = {
      [iso.E2E_RUN_ROOT_ENV]: s.runProfile.runRoot,
      [iso.E2E_RUN_ID_ENV]: RUN_ID,
      ...run.env,
    };
    const worker = iso.verifyWorkerPreflight({
      env: workerEnv,
      lockDir: s.lockDir,
      isAlive: s.isAlive,
    });
    expect(worker.runId).toBe(RUN_ID);
    expect(
      iso.assertResolvedProfileDirectories(worker.probe, { ...s.probe.dirs }),
    ).toEqual(s.probe.dirs);

    fs.mkdirSync(path.join(s.probe.dirs.appData, "databases"), {
      recursive: true,
    });
    expect(run.teardown()).toEqual({ errors: [], warnings: [] });
    expect(run.teardown()).toEqual({ errors: [], warnings: [] });
    expect(fs.existsSync(s.probe.dirs.appData)).toBe(false);
    expect(fs.existsSync(s.runProfile.runDir)).toBe(false);
    expect(fs.existsSync(iso.runLockPath(E2E, { lockDir: s.lockDir }))).toBe(
      false,
    );
    for (const file of s.production) {
      expect(fs.existsSync(file), file).toBe(true);
    }
    expect(
      codeOf(() =>
        iso.verifyWorkerPreflight({
          env: workerEnv,
          lockDir: s.lockDir,
          isAlive: s.isAlive,
        }),
      ),
    ).toBe("PREFLIGHT_MISSING");
  });

  it.each([
    ["the marker is missing", { markers: [] }, "MARKER_MISSING"],
    ["the marker is production", { markers: [PROD] }, "MARKER_PRODUCTION"],
  ])("refuses before any launch when %s", async (_label, options, code) => {
    const s = await scenario(options);
    expect(await asyncCodeOf(s.prepare)).toBe(code);
    expect(s.spawnCalls).toHaveLength(0);
    expect(s.execCalls).toHaveLength(0);
    expect(fs.existsSync(s.stale)).toBe(true);
    expect(fs.readdirSync(s.lockDir)).toEqual([]);
  });

  it("refuses while a production-identifier app runs (strict by default)", async () => {
    const processes = [productionProcess];
    const s = await scenario({ processes });
    expect(await asyncCodeOf(s.prepare)).toBe("PRODUCTION_PROCESS_RUNNING");
    expect(s.spawnCalls).toHaveLength(0);
    expect(fs.readdirSync(s.lockDir)).toEqual([]);

    const dev = await scenario({
      processes: [
        {
          pid: 778,
          name: process.platform === "win32" ? "node.exe" : "node",
          executablePath:
            process.platform === "win32"
              ? "C:\\nodejs\\node.exe"
              : "/usr/bin/node",
          commandLine: "node ./scripts/tauri-dev.mjs",
        },
      ],
    });
    expect(await asyncCodeOf(dev.prepare)).toBe("PRODUCTION_PROCESS_RUNNING");

    for (const value of ["true", "yes", "0", ""]) {
      const loose = await scenario({
        processes,
        env: { [iso.ALLOW_RUNNING_PRODUCTION_ENV]: value },
      });
      expect(await asyncCodeOf(loose.prepare), value).toBe(
        "PRODUCTION_PROCESS_RUNNING",
      );
    }
  });

  describe(`with ${iso.ALLOW_RUNNING_PRODUCTION_ENV}=1 (U1)`, () => {
    const allow = { [iso.ALLOW_RUNNING_PRODUCTION_ENV]: "1" };
    const processes = [productionProcess];

    it("warns loudly and proceeds past the production-process check", async () => {
      const s = await scenario({ processes, env: allow });
      const run = await s.prepare();
      const warning = s.warnings.join("\n");
      expect(warning).toContain(
        `WARNING: ${iso.ALLOW_RUNNING_PRODUCTION_ENV}=1`,
      );
      expect(warning).toContain(`pid ${productionProcess.pid}`);
      expect(warning).toContain("t91-g2");
      expect(s.spawnCalls).toHaveLength(1);
      expect(run.productionProcesses.map((entry) => entry.pid)).toEqual([
        productionProcess.pid,
      ]);
      expect(run.teardown().errors).toEqual([]);
    });

    it.each([
      ["a missing marker", { markers: [] }, "MARKER_MISSING"],
      ["a production marker", { markers: [PROD] }, "MARKER_PRODUCTION"],
      [
        "a probe resolving production paths",
        {
          probe: (p: ProfileProbe) => ({
            ...p,
            dirs: { ...p.dirs, appLocalData: p.productionDirs.appLocalData },
          }),
        },
        "PROBE_PRODUCTION_PATH",
      ],
      [
        "a probe for another identity",
        { probe: (p: ProfileProbe) => ({ ...p, identifier: README }) },
        "PROBE_INVALID",
      ],
      ["a held lock", { lockHeldBy: 4321 }, "LOCK_HELD"],
    ] as Array<[string, ScenarioOptions, string]>)(
      "still refuses %s",
      async (_label, options, code) => {
        const s = await scenario({ ...options, processes, env: allow });
        expect(await asyncCodeOf(s.prepare)).toBe(code);
        expect(fs.existsSync(s.stale)).toBe(true);
        for (const file of s.production) {
          expect(fs.existsSync(file), file).toBe(true);
        }
      },
    );

    it("still refuses an unsafe wipe target and deletes nothing", async () => {
      const s = await scenario({ processes, env: allow });
      const outside = path.join(s.root, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "keep.txt"), "x");
      fs.symlinkSync(outside, s.probe.dirs.appLocalData, "junction");
      expect(await asyncCodeOf(s.prepare)).toBe("WIPE_TARGET_UNSAFE");
      expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
      expect(fs.existsSync(s.stale)).toBe(true);
      expect(fs.existsSync(iso.runLockPath(E2E, { lockDir: s.lockDir }))).toBe(
        false,
      );
      expect(fs.existsSync(s.runProfile.runDir)).toBe(false);
      removeLink(s.probe.dirs.appLocalData);
    });

    it("downgrades a known_hosts change to a warning only while production runs", async () => {
      const s = await scenario({ processes, env: allow });
      const run = await s.prepare();
      fs.appendFileSync(s.knownHostsPath, "changed\n");
      const report = run.teardown();
      expect(report.errors).toEqual([]);
      expect(report.warnings.join("\n")).toContain(
        `pid ${productionProcess.pid}`,
      );
    });
  });

  it("refuses when the e2e binary itself is already running", async () => {
    const records: ProcessRecord[] = [];
    const s = await scenario({ processes: records });
    records.push({
      pid: 900,
      name: path.basename(s.binary),
      executablePath: s.binary,
      commandLine: null,
    });
    expect(await asyncCodeOf(s.prepare)).toBe("E2E_BINARY_RUNNING");
    expect(s.spawnCalls).toHaveLength(0);
  });

  it("refuses while another run holds the lock", async () => {
    const s = await scenario({ lockHeldBy: 4321 });
    expect(await asyncCodeOf(s.prepare)).toBe("LOCK_HELD");
    expect(s.spawnCalls).toHaveLength(0);
    expect(fs.existsSync(s.stale)).toBe(true);
  });

  it.each([
    [
      "the probe reports another identity",
      (p: ProfileProbe) => ({ ...p, identifier: README }),
      "PROBE_INVALID",
    ],
    [
      "the probe resolves production paths",
      (p: ProfileProbe) => ({
        ...p,
        dirs: { ...p.dirs, appData: p.productionDirs.appData },
      }),
      "PROBE_PRODUCTION_PATH",
    ],
    [
      "WebView2 does not use the run folder",
      (p: ProfileProbe) => ({
        ...p,
        webview2: { ...p.webview2, source: "env" },
      }),
      "PROBE_INVALID",
    ],
  ])(
    "refuses, releases the lock and wipes nothing when %s",
    async (_label, mutate, code) => {
      const s = await scenario({ probe: mutate });
      expect(await asyncCodeOf(s.prepare)).toBe(code);
      expect(s.spawnCalls).toHaveLength(1);
      expect(fs.existsSync(s.stale)).toBe(true);
      expect(fs.existsSync(iso.runLockPath(E2E, { lockDir: s.lockDir }))).toBe(
        false,
      );
      for (const file of s.production) {
        expect(fs.existsSync(file), file).toBe(true);
      }
    },
  );

  it("refuses incomplete options", async () => {
    const s = await scenario();
    const base = {
      binary: s.binary,
      expectedIdentifier: E2E,
      wipe: "before-and-after" as const,
      runProfile: s.runProfile,
    };
    expect(
      await asyncCodeOf(() =>
        iso.prepareIsolatedE2eRun({ ...base, wipe: "always" as never }),
      ),
    ).toBe("INVALID_OPTIONS");
    expect(
      await asyncCodeOf(() =>
        iso.prepareIsolatedE2eRun({ ...base, runProfile: undefined as never }),
      ),
    ).toBe("INVALID_OPTIONS");
    expect(
      await asyncCodeOf(() =>
        iso.prepareIsolatedE2eRun({ ...base, expectedIdentifier: PROD }),
      ),
    ).toBe("INVALID_IDENTIFIER");
  });

  it("fails the teardown when the real known_hosts changed", async () => {
    const s = await scenario();
    const run = await s.prepare();
    fs.appendFileSync(s.knownHostsPath, "[127.0.0.1]:2222 ssh-ed25519 BBBB\n");
    const { errors } = run.teardown();
    expect(errors.join("\n")).toContain("KNOWN_HOSTS_CHANGED");
    expect(fs.existsSync(iso.runLockPath(E2E, { lockDir: s.lockDir }))).toBe(
      false,
    );
  });
});

// ── worker checks ───────────────────────────────────────────────────────────

describe("worker verification", () => {
  it("refuses missing or foreign preflight proof and aborted runs", async () => {
    const s = await scenario();
    const run = await s.prepare();
    const env: EnvRecord = {
      [iso.E2E_RUN_ROOT_ENV]: s.runProfile.runRoot,
      [iso.E2E_RUN_ID_ENV]: RUN_ID,
      ...run.env,
    };
    const verify = (overrides: EnvRecord) =>
      codeOf(() =>
        iso.verifyWorkerPreflight({
          env: { ...env, ...overrides },
          lockDir: s.lockDir,
          isAlive: s.isAlive,
        }),
      );
    expect(verify({})).toBeUndefined();
    expect(verify({ [iso.E2E_PREFLIGHT_ENV]: undefined })).toBe(
      "PREFLIGHT_MISSING",
    );
    expect(verify({ [iso.E2E_PREFLIGHT_ENV]: "ok:fedcba987654" })).toBe(
      "PREFLIGHT_MISSING",
    );
    expect(verify({ [iso.WEBVIEW2_USER_DATA_FOLDER_ENV]: "C:\\x" })).toBe(
      "PREFLIGHT_MISSING",
    );
    expect(verify({ [iso.EXPECT_ISOLATED_PROFILE_ENV]: PROD })).toBe(
      "PREFLIGHT_MISSING",
    );
    expect(verify({ [iso.E2E_PROFILE_JSON_ENV]: "{" })).toBe(
      "PREFLIGHT_MISSING",
    );
    iso.markRunAborted({
      identifier: E2E,
      runId: RUN_ID,
      reason: "profile mismatch",
      lockDir: s.lockDir,
    });
    expect(verify({})).toBe("RUN_ABORTED");
    run.teardown();
  });

  it("compares app-resolved directories with the probe", () => {
    const probe = winProbe();
    const cased: Record<string, string> = {};
    for (const [key, value] of Object.entries(probe.dirs)) {
      cased[key] = value.toLowerCase();
    }
    expect(() =>
      iso.assertResolvedProfileDirectories(probe, cased, { platform: "win32" }),
    ).not.toThrow();
    expect(
      codeOf(() =>
        iso.assertResolvedProfileDirectories(
          probe,
          { ...probe.dirs, appData: probe.productionDirs.appData },
          { platform: "win32" },
        ),
      ),
    ).toBe("WORKER_PROFILE_MISMATCH");
    expect(
      codeOf(() =>
        iso.assertResolvedProfileDirectories(
          probe,
          { ...probe.dirs, appLog: undefined },
          { platform: "win32" },
        ),
      ),
    ).toBe("WORKER_PROFILE_MISMATCH");
  });
});

// ── metadata-only observation ───────────────────────────────────────────────

describe("metadata snapshots", () => {
  it("lists names, sizes and mtimes without contents, bounded by depth and count", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "secret.txt"), "top-secret-value");
    fs.writeFileSync(path.join(root, "a", "b", "deep.txt"), "x");
    const full = iso.snapshotFileMetadata(root);
    expect(full.entries.map((entry) => entry.path)).toEqual([
      "a",
      "a/b",
      "a/b/deep.txt",
      "a/secret.txt",
    ]);
    expect(JSON.stringify(full)).not.toContain("top-secret-value");
    expect(
      iso.snapshotFileMetadata(root, { depth: 1 }).entries.map((e) => e.path),
    ).toEqual(["a"]);
    expect(iso.snapshotFileMetadata(root, { maxEntries: 2 }).truncated).toBe(
      true,
    );
    expect(iso.snapshotFileMetadata(path.join(root, "none")).exists).toBe(
      false,
    );
  });

  it("hashes files without returning contents", () => {
    const root = tempDir();
    const file = path.join(root, "known_hosts");
    expect(iso.hashFileIfExists(file)).toBeNull();
    fs.writeFileSync(file, "host key");
    expect(iso.hashFileIfExists(file)).toBe(
      createHash("sha256").update("host key").digest("hex"),
    );
  });
});

// ── source contracts for the WDIO wiring ────────────────────────────────────

describe("WDIO wiring", () => {
  it("launches both configs with the WebView2 flag and worker guards first", () => {
    for (const [file, identifier, wipe] of [
      ["e2e/wdio.conf.ts", "E2E_IDENTIFIER", "before-and-after"],
      [
        "e2e/wdio.readme-screenshot.conf.ts",
        "README_CAPTURE_IDENTIFIER",
        "none",
      ],
    ] as const) {
      const conf = readRepo(file);
      expect(conf, file).toMatch(/webview2Launch\(runProfile\)\.args/);
      expect(conf, file).toMatch(
        new RegExp(`resolveRunProfile\\(\\{ identifier: ${identifier} \\}\\)`),
      );
      expect(conf, file).toMatch(
        new RegExp(
          `expectedIdentifier: ${identifier},\\s*wipe: "${wipe}",\\s*runProfile,`,
        ),
      );
      expect(conf, file).toMatch(
        /async beforeSession\(\) \{[\s\S]*?enforceWorkerPreflight\(\);/,
      );
      const before = conf.slice(conf.indexOf("async before()"));
      const guard = before.indexOf("await enforceWorkerProfileIsolation()");
      expect(guard, file).toBeGreaterThan(-1);
      expect(guard, file).toBeLessThan(before.indexOf("waitForAppReady()"));
    }
  });

  it("runs the preflight before the driver is spawned", () => {
    const service = readRepo("e2e/helpers/tauri-service.ts");
    const onPrepare = service.slice(service.indexOf("async onPrepare("));
    const preflight = onPrepare.indexOf("prepareIsolatedE2eRun(");
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(onPrepare.indexOf("spawn(driverCommand"));
    expect(service).toMatch(/this\.finishIsolation\(\);/);
  });

  it("keeps profile paths, WebView2 env and the real ~/.ssh out of e2e sources", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(repoRoot, "e2e"), [
      ".ts",
      ".mts",
      ".mjs",
      ".js",
      ".cjs",
    ])) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      const text = fs.readFileSync(file, "utf8");
      if (/com\.sortofremote\.ng(?![.\w-])/.test(text)) {
        offenders.push(`${relative}: production identifier literal`);
      }
      const profileEnv =
        /\b(APPDATA|LOCALAPPDATA|XDG_DATA_HOME)\b|Application Support/g;
      for (
        let match = profileEnv.exec(text);
        match;
        match = profileEnv.exec(text)
      ) {
        const allowed =
          relative === "e2e/helpers/tauri-service.ts" &&
          match[0] === "LOCALAPPDATA";
        if (!allowed) {
          offenders.push(`${relative}: ${match[0]}`);
        }
      }
      if (text.includes("WEBVIEW2_USER_DATA_FOLDER")) {
        offenders.push(`${relative}: sets WEBVIEW2_USER_DATA_FOLDER`);
      }
      if (/homedir\(\)/.test(text) && /["'`]\.ssh["'`]/.test(text)) {
        offenders.push(`${relative}: resolves the real ~/.ssh`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
