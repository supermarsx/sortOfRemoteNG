// Engineering checkpoints never confer runtime or SDK admission.
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify, types as utilTypes } from "node:util";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  opendir,
  mkdtemp,
  rm,
  rmdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { finished, pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, tmpdir, userInfo } from "node:os";
import {
  macSourceMetadataPlan,
  macIntelSourceMetadataPlan,
} from "./cef-mac-source-metadata.mjs";

export const LIMITS = Object.freeze({
  compressed: 32 * 1024 ** 3,
  chunk: 1024 ** 3,
  metadata: 128 * 1024 ** 2,
  seal: 1024 ** 2,
  archiveMs: 600_000,
  // Linux owned-source metadata only (record/apply/verify without a Mac
  // platform policy): it hashes the whole fetched tree. Pack, restore and
  // external observation keep archiveMs.
  linuxSourceMetadataMs: 2_400_000,
  // Mac owned-source record/apply/verify walk the complete fetched tree (and hash
  // what the stat cache cannot vouch for). Measured on hosted runners (runs
  // 41906246401 / 41906270473): each snapshot walks twice at 0.8-1.2 ks and a full
  // hash is 1.8-2.2 ks, so a restore apply needs 3.3-4.6 ks.
  macSourceMetadataMs: 5_700_000,
  macSourceMetadataHelperMs: 5_400_000,
  // Of that bound, the helper's own deadline ends this much earlier so its
  // progress diagnostic is printed before the hard kill.
  linuxSourceMetadataGraceMs: 60_000,
  macSourceMetadataGraceMs: 60_000,
  compileMs: 15 * 60_000,
  maxCompileMs: 180 * 60_000,
  hostMs: 300 * 60_000,
});
export const INPUTS =
  "native/cef-build-inputs/20261025-r5-owned-http3-macintel-sdk26-2-capture-compat";
export const TARGET = "x86_64-apple-darwin";
export const SOURCE_ID =
  "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef";
// Cross compilation never changes the native acceptance host. Adding a profile
// changes the producer code digest; checkpoints from older code cannot migrate.
const PROFILES = Object.freeze({
  [TARGET]: Object.freeze({
    target: TARGET,
    source: SOURCE_ID,
    inputs: INPUTS,
    platform: "darwin",
    architecture: "x64",
    runner: "macos-15-intel",
    provisionTarget: TARGET,
    outConfig: "Release_GN_x64",
    linkKind: "mac-sdk",
    acceptanceRunner: "macos-15-intel",
    acceptanceArchitecture: "x64",
  }),
  "aarch64-apple-darwin": Object.freeze({
    target: "aarch64-apple-darwin",
    source: "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
    inputs:
      "native/cef-build-inputs/20261025-r5-owned-http3-macarm-sdk26-2-capture-compat",
    platform: "darwin",
    architecture: "x64",
    runner: "macos-15-intel",
    provisionTarget: TARGET,
    outConfig: "Release_GN_arm64",
    linkKind: "mac-sdk",
    acceptanceRunner: "macos-15",
    acceptanceArchitecture: "arm64",
  }),
  "aarch64-unknown-linux-gnu": Object.freeze({
    target: "aarch64-unknown-linux-gnu",
    // Exact hosted images whose build-relevant contents were reviewed as equivalent (evidence:
    // native/cef-runner-images/linux-arm-accepted-images.json); the first is the runner map's pin.
    acceptedImages: Object.freeze(["20261026.354.1", "20261101.360.1"]),
    source: "8c5af5d375371adef2e1a32d872f5c55f907d26786b698e5ab2aef0fdfb9f8eb",
    inputs:
      "native/cef-build-inputs/20261028-r5-linuxarm-cross-sysroot-external-webview-char-20261026-354-1",
    platform: "linux",
    architecture: "x64",
    runner: "ubuntu-24.04",
    provisionTarget: "x86_64-unknown-linux-gnu",
    outConfig: "Release_GN_arm64",
    linkKind: "linux-arm-sysroot",
    acceptanceRunner: "ubuntu-24.04-arm",
    acceptanceArchitecture: "arm64",
  }),
});
export function checkpointProfile(target = TARGET) {
  if (!Object.hasOwn(PROFILES, target))
    throw new Error("Unknown checkpoint target");
  return PROFILES[target];
}
export function checkpointHost(target, platform, architecture) {
  const profile = checkpointProfile(target);
  if (profile.platform !== platform || profile.architecture !== architecture)
    throw new Error("Unreviewed checkpoint build host");
  return profile;
}
export function checkpointCompileArguments(target, args) {
  const p = checkpointProfile(target);
  const targets =
    p.platform === "linux" ? ["cef", "chrome_sandbox"] : ["cef", "cef_sandbox"];
  if (
    !Array.isArray(args) ||
    args.length !== 7 ||
    path.basename(args[0]) !== "autoninja.py" ||
    args[1] !== "-j" ||
    !/^[1-4]$/.test(args[2]) ||
    args[3] !== "-C" ||
    args[4] !== `out/${p.outConfig}` ||
    args[5] !== targets[0] ||
    args[6] !== targets[1]
  )
    throw new Error("Unreviewed checkpoint compile recipe");
  return args;
}
// Closed exact account IDs observed in https://api.github.com/meta
// domains.actions on 2026-10-24. This is not an Azure host wildcard.
const GITHUB_BLOB_IDS = new Set([
  ...Array.from({ length: 20 }, (_, i) => i),
  ...Array.from({ length: 20 }, (_, i) => 30 + i),
  ...Array.from({ length: 100 }, (_, i) => 100 + i),
]);
export function downloadHost(host) {
  if (
    [
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(host)
  )
    return true;
  const match =
    /^productionresultssa(0|[1-9][0-9]*)\.blob\.core\.windows\.net$/.exec(host);
  return Boolean(match && GITHUB_BLOB_IDS.has(Number(match[1])));
}
export const WORKFLOW = ".github/workflows/cef-engineering-checkpoint.yml";
export const SDK_PROBE_WORKFLOW = ".github/workflows/cef-sdk-layout-probe.yml";
const hex = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const positive = (x) => Number.isSafeInteger(x) && x > 0;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function shape(value, keys) {
  assert(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
    "Invalid checkpoint object shape",
  );
}
export function authority(env) {
  return workflowAuthority(env, WORKFLOW);
}
export function sdkProbeAuthority(env) {
  workflowAuthority(env, SDK_PROBE_WORKFLOW);
  assert(
    !env.GH_TOKEN && !env.GITHUB_TOKEN,
    "SDK probe must not receive a GitHub token",
  );
  // Never return a producer identity usable by download/upload/seal helpers.
  return { diagnosticOnly: true, nativeAcceptance: false };
}
function workflowAuthority(env, workflow) {
  assert(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public",
    "Public hosted manual checkpoint only",
  );
  assert(
    env.CEF_DEFAULT_BRANCH &&
      env.GITHUB_REF === `refs/heads/${env.CEF_DEFAULT_BRANCH}`,
    "Default branch checkpoint only",
  );
  assert(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? "") &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ""),
    "Invalid repository or head",
  );
  assert(
    /^[1-9][0-9]*$/.test(env.GITHUB_REPOSITORY_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "Invalid producer identity",
  );
  assert(
    env.GITHUB_WORKFLOW_REF ===
      `${env.GITHUB_REPOSITORY}/${workflow}@refs/heads/${env.CEF_DEFAULT_BRANCH}`,
    "Exact checkpoint workflow required",
  );
  return {
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    head: env.GITHUB_SHA,
    branch: env.CEF_DEFAULT_BRANCH,
    workflow,
  };
}
export function codeTreeDigest(entries) {
  assert(
    Array.isArray(entries) && entries.length <= 100000,
    "Producer tree bound",
  );
  const selected = entries
    .filter((row) => row.type !== "tree")
    .filter(
      (row) =>
        row.path.startsWith("scripts/") ||
        row.path === WORKFLOW ||
        row.path === "native/cef-hosted-recipe.json" ||
        row.path === ".node-version",
    )
    .map((row) => {
      assert(
        row.type === "blob" &&
          ["100644", "100755"].includes(row.mode) &&
          /^[a-f0-9]{40}$/.test(row.sha) &&
          !row.path.includes("..") &&
          !row.path.includes("\\"),
        "Producer source tree",
      );
      return { path: row.path, mode: row.mode, sha: row.sha };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assert(
    selected.length > 0 &&
      selected.length < 2048 &&
      selected.some((row) => row.path === WORKFLOW) &&
      selected.some(
        (row) => row.path === "scripts/lib/cef-checkpoint-archive.py",
      ),
    "Complete committed producer source required",
  );
  return sha(canonical(selected));
}
async function verifyProducerCode(api, producer, expected) {
  const commit = await api(`git/commits/${producer.head}`);
  assert(
    commit.sha === producer.head &&
      /^[a-f0-9]{40}$/.test(commit.tree?.sha ?? ""),
    "Producer commit tree",
  );
  const tree = await api(`git/trees/${commit.tree.sha}?recursive=1`);
  assert(
    tree.sha === commit.tree.sha &&
      tree.truncated === false &&
      codeTreeDigest(tree.tree) === expected,
    "Producer code differs from sealed checkpoint",
  );
}
export const SLICES = Object.freeze([15, 30, 60, 120, 180]);
// "auto" fills the job: the slice is whatever remains of the 300-minute host
// bound at compile start, less a fixed post-compile reserve (verify, pack,
// upload, seal, plus a 30-minute margin), within [floor, ceiling]. Measured on
// the Linux ARM restore run 40880216955: verify 4.3, pack 1.3, upload 1 min
// with a 3 GB graph; the reserve also covers the graph growing toward its
// 32 GiB archive bound.
export const AUTO_SLICE = Object.freeze({
  reserveMs: 70 * 60_000,
  floorMs: 15 * 60_000,
  ceilingMs: 180 * 60_000,
});
// macOS post-compile reserve: the final source-verify re-walks the tree once (about 8 min on x64,
// 10 min on ARM64 with every digest kept) after its external re-observation (about 8 min), then
// pack (3 min), upload and seal (2 min), plus a 45-minute margin.
export const MAC_AUTO_RESERVE_MS = 75 * 60_000;
export function executionOptions(mode = "checkpoint", minutes = "15") {
  assert(
    ["checkpoint", "complete-sdk"].includes(mode) &&
      (minutes === "auto" ||
        (/^[0-9]+$/.test(String(minutes)) &&
          String(Number(minutes)) === String(minutes) &&
          SLICES.includes(Number(minutes)))),
    "Closed engineering mode/slice required",
  );
  if (minutes === "auto") return { mode, minutes: "auto", milliseconds: null };
  return {
    mode,
    minutes: Number(minutes),
    milliseconds: Number(minutes) * 60_000,
  };
}
export function hostRemaining(env, now = Date.now()) {
  const start = Number(env.CEF_ENGINEERING_JOB_STARTED_MS);
  assert(
    Number.isSafeInteger(start) &&
      start > 0 &&
      now >= start &&
      now - start < LIMITS.hostMs,
    "Engineering host clock required",
  );
  return LIMITS.hostMs - (now - start);
}
export function sliceBudget(options, remaining, platformReserveMs = 0) {
  assert(
    Number.isSafeInteger(platformReserveMs) && platformReserveMs >= 0,
    "Platform reserve must be a bounded duration",
  );
  const reserve = Math.max(
    options.mode === "complete-sdk" ? 60 * 60_000 : 40 * 60_000,
    platformReserveMs,
  );
  if (options.minutes === "auto") {
    assert(
      options.milliseconds === null &&
        Number.isSafeInteger(remaining) &&
        remaining > 0,
      "Automatic slice requires the host clock",
    );
    const budget = Math.min(
      AUTO_SLICE.ceilingMs,
      LIMITS.maxCompileMs,
      remaining - Math.max(reserve, AUTO_SLICE.reserveMs),
    );
    assert(
      budget >= AUTO_SLICE.floorMs,
      "Requested slice leaves insufficient packaging/transfer reserve",
    );
    return Math.floor(budget / 1000) * 1000;
  }
  assert(
    Number.isSafeInteger(remaining) &&
      remaining > 0 &&
      options.milliseconds + reserve <= remaining,
    "Requested slice leaves insufficient packaging/transfer reserve",
  );
  return options.milliseconds; // Never silently shorten/retry a selected slice.
}
export function validateIdentity(value) {
  shape(value, [
    "target",
    "source",
    "producer",
    "canonicalRoot",
    "image",
    "tools",
    "graph",
    "siso",
  ]);
  assert(
    value.source === checkpointProfile(value.target).source &&
      hex(value.producer),
    "Unreviewed checkpoint source",
  );
  assert(
    typeof value.canonicalRoot === "string" &&
      path.isAbsolute(value.canonicalRoot) &&
      !/[\s\x00-\x1f]/.test(value.canonicalRoot),
    "Canonical checkpoint path required",
  );
  assert(
    typeof value.image === "string" &&
      /^[A-Za-z0-9_.-]{1,128}$/.test(value.image) &&
      hex(value.tools) &&
      hex(value.graph) &&
      hex(value.siso),
    "Exact tool/image/graph pins required",
  );
  return sha(canonical(value));
}
export async function noLinks(file) {
  const absolute = path.resolve(file);
  for (let current = absolute; ; current = path.dirname(current)) {
    const s = await lstat(current);
    assert(!s.isSymbolicLink(), "Checkpoint links are not admitted");
    if (current === path.dirname(current)) break;
  }
  assert((await realpath(absolute)) === absolute, "Checkpoint path alias");
  return absolute;
}
export async function workspace(temp, identity, target = TARGET) {
  const profile = checkpointProfile(target);
  assert(identity === profile.source, "Workspace source differs from target");
  assert(hex(identity), "Invalid source identity");
  const base = await noLinks(temp);
  const root = path.join(
    base,
    "sorng-cef-engineering",
    profile.target,
    identity,
  );
  assert(!root.includes(" "), "Space-free engineering root required");
  await mkdir(path.dirname(root), { recursive: true });
  await noLinks(path.dirname(root));
  await mkdir(root); // Never reuse a stale or foreign local workspace.
  return root;
}
export async function filePin(file, maximum) {
  await noLinks(file);
  const s = await stat(file);
  assert(
    s.isFile() && s.size > 0 && s.size <= maximum,
    "Checkpoint asset size",
  );
  const hash = createHash("sha256");
  for await (const block of createReadStream(file)) hash.update(block);
  const after = await stat(file);
  assert(
    s.size === after.size && s.mtimeMs === after.mtimeMs && s.ino === after.ino,
    "Checkpoint asset changed",
  );
  return {
    name: path.basename(file),
    bytes: s.size,
    sha256: hash.digest("hex"),
  };
}

// First-class GCS writes these markers after verifying and extracting the archive.
// This profile never invokes the legacy install-sysroot.py/.stamp route.
const LINUX_ARM_GCS = Object.freeze({
  sha256: "c7176a4c7aacbf46bda58a029f39f79a68008d3dee6518f154dcf5161a5486d8",
  bytes: 18420984,
  generation: 1770327978874031,
  directory: "debian_bullseye_arm64-sysroot",
  url: "https://commondatastorage.googleapis.com/chrome-linux-sysroot",
});
const LINUX_DEPENDENCY_ROLES = new Set([
  "sysroots-json",
  "deps-recipe",
  "sysroot-dir",
  "gcs-archive",
  "gcs-hash-marker",
  "gcs-toggle",
  "gperf",
  "generated-links",
]);
async function linuxDependency(role, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) {
      error.linuxDependencyRole = role;
      throw error;
    }
    throw Object.assign(new Error("Linux dependency check failed"), {
      linuxDependencyRole: role,
    });
  }
}
// Pure contract validators allow portable simulated observations in tests.
// The production recipe below always reads/hashes actual files; no caller adapter.
export function linuxArmGcsDeclaration(sysroots, deps) {
  const p = LINUX_ARM_GCS,
    root = sysroots?.bullseye_arm64;
  assert(
    root?.Sha256Sum === p.sha256 &&
      root.SysrootDir === p.directory &&
      root.URL === p.url &&
      root.Tarball === "debian_bullseye_arm64_sysroot.tar.xz",
    "Unreviewed Linux ARM sysroot recipe",
  );
  const declaration = `  'src/build/linux/debian_bullseye_arm64-sysroot': {
    'bucket': 'chrome-linux-sysroot',
    'condition': 'checkout_linux and checkout_arm64 and non_git_source',
    'dep_type': 'gcs',
    'objects': [
      {
        'generation': 1770327978874031,
        'object_name': '${p.sha256}',
        'sha256sum': '${p.sha256}',
        'size_bytes': 18420984,
      },
    ],
  },`;
  const blocks = [
    ...deps
      .replaceAll("\r\n", "\n")
      .matchAll(
        /^  'src\/build\/linux\/debian_bullseye_arm64-sysroot': \{[\s\S]*?^  \},/gm,
      ),
  ];
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens = declaration.match(/'[^'\n]*'|[0-9]+|[{}:[\],]/g);
  assert(
    blocks.length === 1 &&
      new RegExp("^\\s*" + tokens.map(escape).join("\\s*") + "\\s*$").test(
        blocks[0][0],
      ),
    "Unreviewed Linux ARM first-class GCS dependency",
  );
  return p;
}
export function linuxArmGcsArchive(archive) {
  const p = LINUX_ARM_GCS;
  assert(
    archive?.name === `.${p.sha256}` &&
      archive.bytes === p.bytes &&
      archive.sha256 === p.sha256,
    "Linux ARM sysroot archive pin changed",
  );
  return archive;
}
export async function linuxArmRecipe(chromium, out) {
  const readRecipe = async (file, maximum) => {
    const before = await filePin(file, maximum),
      bytes = await readFile(file);
    assert(
      bytes.length === before.bytes && sha(bytes) === before.sha256,
      "Linux dependency metadata changed",
    );
    return bytes.toString("utf8");
  };
  const sysroots = await linuxDependency("sysroots-json", async () =>
    JSON.parse(
      await readRecipe(
        path.join(chromium, "build/linux/sysroot_scripts/sysroots.json"),
        1024 ** 2,
      ),
    ),
  );
  const deps = await linuxDependency("deps-recipe", () =>
    readRecipe(path.join(chromium, "DEPS"), 2 * 1024 ** 2),
  );
  const p = await linuxDependency("deps-recipe", () =>
    linuxArmGcsDeclaration(sysroots, deps),
  );
  const sysroot = await linuxDependency("sysroot-dir", async () => {
    const location = await noLinks(
      path.join(chromium, "build/linux", p.directory),
    );
    assert(
      (await stat(location)).isDirectory(),
      "Linux ARM sysroot directory missing",
    );
    return location;
  });
  const hashMarker = await linuxDependency("gcs-hash-marker", async () => {
    const value = await readRecipe(
      path.join(sysroot, `.${p.sha256}_hash`),
      4096,
    );
    assert(value === p.sha256 + "\n", "Linux ARM GCS hash marker changed");
    return value;
  });
  const toggle = await linuxDependency("gcs-toggle", async () => {
    const value = await readRecipe(
      path.join(sysroot, `.${p.sha256}_is_first_class_gcs`),
      4096,
    );
    assert(value === "1\n", "Linux ARM GCS migration marker changed");
    return value;
  });
  const archive = await linuxDependency("gcs-archive", async () =>
    linuxArmGcsArchive(
      await filePin(path.join(sysroot, `.${p.sha256}`), 32 * 1024 ** 2),
    ),
  );
  const gperf = await linuxDependency("gperf", async () => {
    assert(
      deps.includes("infra/3pp/tools/gperf/${{platform}}") &&
        deps.includes("version:3@3.2"),
      "Unreviewed Linux host gperf recipe",
    );
    return await filePin(
      path.join(chromium, "third_party/gperf/cipd/bin/gperf"),
      16 * 1024 ** 2,
    );
  });
  // Generated Linux aliases remain forbidden, irrespective of sysroot transport.
  await linuxDependency("generated-links", () => assertNoGeneratedLinks(out));
  return {
    sysrootSha256: p.sha256,
    sysrootTransport: "first-class-gcs",
    sysrootGeneration: p.generation,
    sysrootArchive: archive,
    sysrootHashMarkerSha256: sha(Buffer.from(hashMarker)),
    sysrootMigrationMarkerSha256: sha(Buffer.from(toggle)),
    gperfPackage: "infra/3pp/tools/gperf/linux-amd64",
    gperfVersion: "version:3@3.2",
    gperf,
    generatedLinks: {},
  };
}
export async function assertNoGeneratedLinks(out) {
  const root = await noLinks(out),
    pending = [root];
  let visited = 0;
  const deadline = Date.now() + 60_000;
  while (pending.length) {
    assert(
      ++visited <= 300000 && Date.now() < deadline,
      "Linux generated-link inventory bound",
    );
    const current = pending.pop(),
      info = await lstat(current);
    assert(!info.isSymbolicLink(), "Unreviewed Linux generated link");
    if (info.isDirectory()) {
      const entries = await readdir(current);
      assert(
        visited + pending.length + entries.length <= 300000,
        "Linux generated-link inventory bound",
      );
      for (const name of entries) pending.push(path.join(current, name));
    } else assert(info.isFile(), "Unreviewed Linux generated file type");
  }
  return {};
}

// The pinned Debian bullseye sysroots ship Mesa DRI drivers as hard links
// (one inode, many names). Owned source metadata requires every source file
// to have exactly one link, because restoring metadata through one name would
// change the shared inode under its siblings. Before the source is recorded,
// each extra name inside these exact sysroot directories becomes an
// independent copy with the same bytes and mode. gclient extracts with
// extraction-time mtimes (nanoseconds) and Node sets times as doubles, so
// every name of a group, the kept one included, gets the group's mtime
// truncated to whole seconds, which is exact. A link group that reaches
// outside its sysroot fails closed; nothing else in the tree changes.
export const LINUX_SYSROOT_DIRECTORIES = Object.freeze([
  "debian_bullseye_arm64-sysroot",
  "debian_bullseye_amd64-sysroot",
  "debian_bullseye_i386-sysroot",
]);
async function sysrootFileSha(file) {
  const hash = createHash("sha256");
  for await (const block of createReadStream(file)) hash.update(block);
  return hash.digest("hex");
}
async function sysrootHardLinkGroups(root) {
  const groups = new Map(),
    pending = [root];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    visited += entries.length;
    assert(visited <= 300000, "Linux sysroot inventory bound");
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) {
        const info = await lstat(file, { bigint: true });
        assert(info.isFile(), "Linux sysroot member changed");
        if (info.nlink > 1n) {
          const key = `${info.dev}:${info.ino}`;
          const group = groups.get(key) ?? { nlink: info.nlink, files: [] };
          assert(group.nlink === info.nlink, "Linux sysroot member changed");
          group.files.push(file);
          groups.set(key, group);
        }
      }
    }
  }
  return [...groups.values()].map((group) => {
    group.files.sort();
    assert(
      BigInt(group.files.length) === group.nlink,
      "Linux sysroot hard link outside its sysroot",
    );
    return group.files;
  });
}
async function setSysrootSeconds(file, seconds) {
  await utimes(file, Number(seconds), Number(seconds));
  const info = await lstat(file, { bigint: true });
  assert(
    info.mtimeNs === seconds * 1_000_000_000n,
    "Linux sysroot time readback",
  );
}
async function separateSysrootFile(file, digest, seconds) {
  const before = await lstat(file, { bigint: true });
  assert(before.isFile() && before.nlink > 1n, "Linux sysroot member changed");
  const copy = path.join(
    path.dirname(file),
    `.${path.basename(file)}.sorng-separate`,
  );
  await copyFile(file, copy, fsConstants.COPYFILE_EXCL);
  try {
    await chmod(copy, Number(before.mode & 0o7777n));
    await setSysrootSeconds(copy, seconds);
    const made = await lstat(copy, { bigint: true });
    assert(
      made.isFile() &&
        made.nlink === 1n &&
        made.size === before.size &&
        made.mode === before.mode &&
        made.uid === before.uid &&
        (await sysrootFileSha(copy)) === digest,
      "Linux sysroot copy differs",
    );
    await rename(copy, file);
  } catch (error) {
    await rm(copy, { force: true });
    throw error;
  }
  const after = await lstat(file, { bigint: true });
  assert(
    after.isFile() &&
      after.nlink === 1n &&
      after.ino !== before.ino &&
      after.size === before.size &&
      after.mode === before.mode &&
      after.mtimeNs === seconds * 1_000_000_000n,
    "Linux sysroot copy differs",
  );
}
export async function separateLinuxSysrootHardLinks(chromium) {
  const result = [];
  for (const directory of LINUX_SYSROOT_DIRECTORIES) {
    const root = path.join(chromium, "build/linux", directory);
    let info;
    try {
      info = await lstat(root);
    } catch (error) {
      if (
        error?.code === "ENOENT" &&
        directory !== "debian_bullseye_arm64-sysroot"
      ) {
        result.push({ directory, present: false });
        continue;
      }
      throw error;
    }
    assert(
      info.isDirectory() && !info.isSymbolicLink(),
      "Linux sysroot directory kind",
    );
    await noLinks(root);
    const groups = await sysrootHardLinkGroups(root);
    let separated = 0;
    for (const files of groups) {
      const digest = await sysrootFileSha(files[0]);
      const seconds =
        (await lstat(files[0], { bigint: true })).mtimeNs / 1_000_000_000n;
      for (const file of files.slice(1)) {
        await separateSysrootFile(file, digest, seconds);
        separated++;
      }
      const first = await lstat(files[0], { bigint: true });
      assert(first.nlink === 1n, "Linux sysroot hard link remains");
      await setSysrootSeconds(files[0], seconds);
    }
    assert(
      (await sysrootHardLinkGroups(root)).length === 0,
      "Linux sysroot hard link remains",
    );
    result.push({
      directory,
      present: true,
      groups: groups.length,
      separated,
    });
  }
  return result;
}

// Evidence only: links remain forbidden by the independent archive reader.
export const LINK_DIAGNOSTIC_LIMITS = Object.freeze({
  entries: 300000,
  links: 64,
  memberBytes: 4096,
  targetBytes: 2048,
  outputBytes: 256 * 1024,
  milliseconds: 180000,
});
export async function generatedLinkInventory(out, options = {}) {
  const io = { lstat, opendir, readlink, ...options.io };
  const limits = { ...LINK_DIAGNOSTIC_LIMITS, ...options.limits };
  for (const key of Object.keys(LINK_DIAGNOSTIC_LIMITS))
    assert(
      Number.isSafeInteger(limits[key]) &&
        limits[key] > 0 &&
        limits[key] <= LINK_DIAGNOSTIC_LIMITS[key],
      "Link diagnostic limit",
    );
  assert(limits.outputBytes >= 512, "Link diagnostic error-envelope capacity");
  const result = {
    schemaVersion: 1,
    kind: "checkpoint-generated-link-diagnostic",
    complete: false,
    failure: null,
    visited: 0,
    links: [],
    authority: false,
    deadlineScope: "collection-observation",
    filesystemCallsCancellable: false,
  };
  const deadline = performance.now() + limits.milliseconds;
  const fault = (reason) => {
    throw Object.assign(new Error("Link diagnostic"), {
      linkDiagnostic: reason,
    });
  };
  const bounded = async (action, lateClose = false) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) fault("deadline");
    let timer,
      expired = false;
    const work = Promise.resolve().then(action);
    if (lateClose)
      work.then(
        (dir) => {
          if (expired) void dir.close().catch(() => {});
        },
        () => {},
      );
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(
              Object.assign(new Error("Link diagnostic"), {
                linkDiagnostic: "deadline",
              }),
            );
          }, Math.ceil(remaining));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const same = (a, b) =>
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mode === b.mode &&
    a.mtimeMs === b.mtimeMs;
  const directory = (value) =>
    value.isDirectory() &&
    !value.isSymbolicLink() &&
    !(value.fileAttributes & 0x400);
  try {
    // Validate every root ancestor without resolving a link target.
    const root = path.resolve(out);
    const ancestors = [];
    for (let current = root; ; current = path.dirname(current)) {
      ancestors.push(current);
      if (path.dirname(current) === current) break;
    }
    for (const current of ancestors.reverse())
      if (!directory(await bounded(() => io.lstat(current))))
        fault("root-link-or-type");
    const pending = [
      { file: root, member: "", stamp: await bounded(() => io.lstat(root)) },
    ];
    while (pending.length) {
      const current = pending.pop();
      const before = await bounded(() => io.lstat(current.file));
      if (!directory(before) || !same(before, current.stamp))
        fault("directory-changed");
      const dir = await bounded(
        () => io.opendir(current.file, { bufferSize: 32 }),
        true,
      );
      let pendingRead = null;
      try {
        if (!same(before, await bounded(() => io.lstat(current.file))))
          fault("directory-changed");
        for (;;) {
          pendingRead = Promise.resolve().then(() => dir.read());
          const entry = await bounded(() => pendingRead);
          pendingRead = null;
          if (!entry) break;
          if (++result.visited > limits.entries) fault("entry-bound");
          const member = current.member
            ? `${current.member}/${entry.name}`
            : entry.name;
          if (Buffer.byteLength(member) > limits.memberBytes)
            fault("member-bound");
          const file = path.join(current.file, entry.name);
          const metadata = await bounded(() => io.lstat(file));
          if (metadata.isSymbolicLink() || metadata.fileAttributes & 0x400) {
            if (result.links.length >= limits.links) fault("link-bound");
            const target = await bounded(() => io.readlink(file));
            if (!same(metadata, await bounded(() => io.lstat(file))))
              fault("link-changed");
            const bytes = Buffer.byteLength(target);
            const row = {
              member,
              target: bytes <= limits.targetBytes ? target : null,
              targetBytes: bytes,
              classification:
                path.posix.isAbsolute(target) || path.win32.isAbsolute(target)
                  ? "absolute"
                  : "relative",
            };
            result.links.push(row);
            if (
              Buffer.byteLength(canonical(result)) >
              limits.outputBytes - 256
            ) {
              result.links.pop();
              fault("output-bound");
            }
            if (bytes > limits.targetBytes) fault("target-bound");
          } else if (directory(metadata)) {
            pending.push({ file, member, stamp: metadata });
            if (pending.length + result.visited > limits.entries)
              fault("entry-bound");
          } else if (!metadata.isFile()) fault("special-entry");
        }
      } finally {
        // Dir.read is not cancellable. Closing concurrently can fail with
        // ERR_DIR_CONCURRENT_OPERATION, so queue exactly one close after that
        // read settles, even when collection has already returned its deadline.
        const close = () => dir.close().catch(() => {});
        const closing = pendingRead ? pendingRead.then(close, close) : close();
        try {
          await bounded(() => closing);
        } catch {
          /* original failure wins */
        }
      }
      if (!same(before, await bounded(() => io.lstat(current.file))))
        fault("directory-changed");
    }
    result.complete = true;
  } catch (error) {
    const known = new Set([
      "deadline",
      "root-link-or-type",
      "directory-changed",
      "entry-bound",
      "member-bound",
      "link-bound",
      "link-changed",
      "target-bound",
      "output-bound",
      "special-entry",
    ]);
    result.failure = known.has(error?.linkDiagnostic)
      ? error.linkDiagnostic
      : error?.code === "EACCES" || error?.code === "EPERM"
        ? "access-denied"
        : "io-error";
  }
  return result;
}
export async function persistGeneratedLinkInventory(out, logs) {
  const record = await generatedLinkInventory(out);
  try {
    // The 180s observation deadline does not cancel OS filesystem calls or bound
    // this small exclusive persistence operation; neither confers admission.
    await noLinks(logs);
    await writeFile(
      path.join(logs, "post-slice-generated-links.json"),
      canonical(record),
      { flag: "wx" },
    );
    return { persisted: true, complete: record.complete };
  } catch {
    return { persisted: false, complete: false };
  }
}
function pin(value, maximum) {
  shape(value, ["name", "bytes", "sha256"]);
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(value.name) &&
      positive(value.bytes) &&
      value.bytes <= maximum &&
      hex(value.sha256),
    "Invalid checkpoint asset pin",
  );
}
export function validateCompile(value) {
  shape(value, [
    "outcome",
    "exitCode",
    "quiescent",
    "groupId",
    "quiescence",
    "observed",
  ]);
  assert(
    ["slice-ended", "compiler-failed", "compiler-complete"].includes(
      value.outcome,
    ) &&
      (value.exitCode === null || Number.isInteger(value.exitCode)) &&
      value.quiescent === true &&
      positive(value.groupId),
    "Compiler outcome/quiescence required",
  );
  assert(
    value.quiescence === "observed-lineage-and-root-group" &&
      Array.isArray(value.observed) &&
      value.observed.length > 0 &&
      value.observed.length <= 4096,
    "Bounded observed lineage required",
  );
  const pids = new Set();
  const nativeIdentity =
    value.observed[0]?.start?.startsWith("darwin-v1:") === true;
  for (const row of value.observed) {
    shape(row, ["pid", "start"]);
    assert(
      positive(row.pid) &&
        !pids.has(row.pid) &&
        (nativeIdentity
          ? /^darwin-v1:[1-9][0-9]{0,11}:(?:0|[1-9][0-9]{0,5})$/
          : /^[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/
        ).test(row.start),
      "Invalid observed process",
    );
    pids.add(row.pid);
  }
  assert(pids.has(value.groupId), "Observed root missing");
  return value;
}
export function validateManifest(value, expectedIdentity) {
  shape(value, [
    "schemaVersion",
    "kind",
    "identity",
    "identitySha256",
    "producer",
    "archive",
    "compile",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  assert(
    value.schemaVersion === 1 &&
      value.kind === "sorng-cef-engineering-checkpoint" &&
      value.nativeAcceptance === false &&
      value.runtimeReady === false,
    "Checkpoint is not a runtime",
  );
  const identity = validateIdentity(value.identity);
  assert(
    identity === value.identitySha256 &&
      (!expectedIdentity || identity === expectedIdentity),
    "Checkpoint identity mismatch",
  );
  const a = value.archive;
  shape(a, [
    "complete",
    "chunks",
    "inventory",
    "rawBytes",
    "compressedBytes",
    "entries",
    "linksIncluded",
  ]);
  assert(
    a.complete === true &&
      a.linksIncluded === false &&
      Array.isArray(a.chunks) &&
      a.chunks.length > 0 &&
      a.chunks.length <= 32,
    "Incomplete checkpoint archive",
  );
  let bytes = 0;
  a.chunks.forEach((row, i) => {
    pin(row, LIMITS.chunk);
    assert(
      row.name === `checkpoint-${String(i).padStart(5, "0")}.bin`,
      "Unexpected chunk name",
    );
    bytes += row.bytes;
  });
  pin(a.inventory, LIMITS.metadata);
  assert(
    a.inventory.name === "inventory.json" &&
      bytes <= LIMITS.compressed &&
      a.compressedBytes === bytes &&
      positive(a.rawBytes) &&
      a.rawBytes <= 256 * 1024 ** 3 &&
      positive(a.entries) &&
      a.entries <= 300000,
    "Checkpoint bounds",
  );
  validateCompile(value.compile);
  shape(value.producer, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
  ]);
  assert(
    value.producer.workflow === WORKFLOW &&
      /^[a-f0-9]{40}$/.test(value.producer.head) &&
      positive(value.producer.repositoryId) &&
      positive(value.producer.runId) &&
      positive(value.producer.attempt),
    "Producer binding",
  );
  return value;
}
const CHECKPOINT_PHASES = new Set([
  "compile-result",
  "siso-log",
  "capacity",
  "graph-before",
  "pack",
  "graph-after",
  "manifest",
  "state",
]);
const CHECKPOINT_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ELOOP",
  "ENOTDIR",
  "EEXIST",
  "ENOSPC",
  "EDQUOT",
  "EIO",
  "ETIMEDOUT",
  "GRAPH_BOUND",
]);
export function checkpointLog(log, line) {
  try {
    const result = log(line);
    // Observation is synchronous and non-gating; consume rejected thenables
    // without awaiting or granting them authority over the operation.
    if (result && typeof result.then === "function")
      Promise.resolve(result).catch(() => {});
  } catch {
    /* Observation must not replace an operation result. */
  }
}
const SISO_GUARD_CODES = new Map([
  ["Genuine in-process compile result required", "SISO_COMPILE_PROOF"],
  ["Compiler wall clock moved backwards", "SISO_WALL_CLOCK"],
  ["Compile output path differs", "SISO_OUTPUT_PATH"],
  ["Siso writers must be quiescent", "SISO_WRITERS_ACTIVE"],
  ["Compile output identity changed", "SISO_OUTPUT_IDENTITY"],
  ["Owned Siso log alias required", "SISO_ALIAS_OWNERSHIP"],
  ["Bounded Siso log alias required", "SISO_ALIAS_BOUND"],
  ["Siso log outside actual temporary directory", "SISO_ALIAS_TEMP"],
  ["Foreign Siso log identity", "SISO_ALIAS_FILENAME"],
  ["Siso log PID not observed", "SISO_PID_UNOBSERVED"],
  ["Invalid Siso UTC timestamp", "SISO_TIMESTAMP_INVALID"],
  ["Siso timestamp outside actual compile window", "SISO_TIMESTAMP_WINDOW"],
  ["Siso writers returned", "SISO_WRITERS_RETURNED"],
  ["Siso log alias changed", "SISO_ALIAS_CHANGED"],
  ["Siso alias still present", "SISO_ALIAS_STILL_PRESENT"],
]);
export async function checkpointPhase(phase, operation, log = console.log) {
  assert(CHECKPOINT_PHASES.has(phase), "Closed checkpoint phase required");
  checkpointLog(
    log,
    `[cef-engineering-checkpoint] checkpoint stage=${phase} event=begin`,
  );
  try {
    const result = await operation();
    checkpointLog(
      log,
      `[cef-engineering-checkpoint] checkpoint stage=${phase} event=complete`,
    );
    return result;
  } catch (error) {
    const code = SISO_GUARD_CODES.has(error?.message)
      ? SISO_GUARD_CODES.get(error.message)
      : CHECKPOINT_CODES.has(error?.code)
        ? error.code
        : error?.message === "Checkpoint graph differs from verified fresh GN"
          ? "GRAPH_MISMATCH"
          : error?.message === "Checkpoint archive rejected"
            ? "ARCHIVE_REJECTED"
            : error?.message === "Archive deadline; partial is not admitted"
              ? "ARCHIVE_DEADLINE"
              : "CHECK_FAILED";
    checkpointLog(
      log,
      `[cef-engineering-checkpoint] checkpoint stage=${phase} event=failed code=${code}`,
    );
    throw error;
  }
}
export function checkpointCapacityRecord(availableBytes, requiredBytes) {
  const safe = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    availableBytes: safe(availableBytes),
    requiredBytes: safe(requiredBytes),
  };
}
const ARCHIVE_FAILURES = new Set([
  "member-path",
  "input-link",
  "input-alias",
  "deadline-bound",
  "archive-deadline",
  "member-alias",
  "unreviewed-generated-link",
  "special-input",
  "input-bound",
  "missing-generated-link",
  "generated-link-owner",
  "generated-link-kind",
  "generated-link-target",
  "generated-link-state",
  "output-bound",
  "compressed-bound",
  "short-write",
  "metadata-bound",
  "overlap",
  "source-changed",
  "archive-io-error",
  "source-link-kind",
  "source-link-cycle",
  "source-file-size",
  "source-repositories-changed",
  "source-json-duplicate",
  "source-required-repositories",
  "source-owner",
  "source-linux-only",
  "source-mode",
  "source-identity",
  "source-image",
  "source-root",
  "source-fixed-paths",
  "source-repositories-bound",
  "source-repositories-shape",
  "source-repository-root",
  "source-repository-value",
  "source-registry-name",
  "source-registry-kind",
  "source-registry-label",
  "source-registry-value",
  "source-unknown-git-root",
  "source-git-admin-kind",
  "source-detached-head",
  "source-repository-changed",
  "source-output-root",
  "source-file-identity",
  "source-file-changed",
  "source-sidecar-bound",
  "source-sidecar-role",
  "source-sidecar-readback",
  "source-sidecar-binding",
  "source-sidecar-shape",
  "source-repository-or-total-changed",
  "source-content-changed",
  "source-mtime",
  "source-link-changed",
  "source-mtime-readback",
  "source-write-identity",
  "source-root-changed",
  "source-root-readback",
  "source-metadata-postcheck",
  "source-metadata-read-bound",
  "source-metadata-read-changed",
  "source-context-required",
  "source-context-bound",
  "source-link",
  "source-external-link",
  "source-excluded-link",
  "source-diagnostic-root",
  "source-entry-bound",
  "source-tree-changed",
  "source-nearby-binding",
  "source-nearby-link",
  "source-nearby-absence",
  "source-nearby-changed",
  "source-platform-policy",
  "source-external-aggregate",
  "source-external-changed",
  "source-external-input-unattested",
  "source-external-link-cycle",
  "source-external-link-kind",
  "source-external-report-readback",
  "source-mac-birth-unavailable",
  "source-mac-capability-cleanup",
  "source-mac-capability-deadline",
  "source-mac-capability-exists",
  "source-mac-capability-identity",
  "source-mac-capability-io",
  "source-mac-capability-link",
  "source-mac-capability-output-bound",
  "source-mac-capability-report-readback",
  "source-mac-context-path",
  "source-mac-context",
  "source-mac-package-host",
  "source-mac-package-context",
  "source-mac-darwin-capability-unreviewed",
  "source-mac-intel-darwin-capability-unreviewed",
  "source-mac-directory-changed",
  "source-mac-directory",
  "source-mac-file-changed",
  "source-mac-file-identity",
  "source-mac-limits",
  "source-mac-nlink",
  "source-mac-only",
  "source-mac-output-owner",
  "source-mac-output",
  "source-mac-pins",
  "source-mac-required-pin",
  "source-mac-root-changed",
  "source-mac-root-kind",
  "source-mac-roots",
  "link-recipe-bound",
  "link-recipe",
]);
function sourcePathFailure(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![
      "bytes,mode,phase,predicate,sha256",
      "bytes,mode,name,phase,predicate,sha256",
    ].includes(Object.keys(value).sort().join()) ||
    !["source-record", "source-apply", "source-verify"].includes(value.mode) ||
    !["registry-key", "filesystem-member"].includes(value.phase) ||
    ![
      "type",
      "length",
      "absolute",
      "separator",
      "colon",
      "component",
      "control",
      "unclassified",
    ].includes(value.predicate)
  )
    return null;
  if (value.predicate === "type") {
    if (
      value.bytes !== null ||
      value.sha256 !== null ||
      Object.hasOwn(value, "name")
    )
      return null;
  } else if (
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    value.bytes > 4 * 1024 ** 2 ||
    typeof value.sha256 !== "string" ||
    value.sha256.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    return null;
  if (Object.hasOwn(value, "name")) {
    const name = value.name;
    if (
      typeof name !== "string" ||
      !name ||
      Buffer.byteLength(name) > 1024 ||
      /[^A-Za-z0-9_./ +@=-]/.test(name) ||
      !(
        ["src", "depot_tools", ".gclient", ".gclient_entries"].includes(name) ||
        name.startsWith("src/") ||
        name.startsWith("depot_tools/")
      ) ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      Buffer.byteLength(name) !== value.bytes ||
      createHash("sha256").update(name).digest("hex") !== value.sha256
    )
      return null;
  }
  return {
    mode: value.mode,
    phase: value.phase,
    predicate: value.predicate,
    bytes: value.bytes,
    sha256: value.sha256,
    ...(Object.hasOwn(value, "name") ? { name: value.name } : {}),
  };
}

function sourceIoFailure(value, mode) {
  const stages = [
    "unlocated",
    "context-read",
    "registry-read",
    "registry-parse",
    "repository-head",
    "root-stat",
    "directory-open",
    "directory-next",
    "member-stat",
    "link-read",
    "link-target-stat",
    "file-open",
    "file-read",
    "file-fd-stat",
    "file-path-stat",
    "file-close",
    "reader-submit",
    "reader-join",
    "sidecar-encode",
    "sidecar-open",
    "sidecar-write",
    "sidecar-flush",
    "sidecar-close",
    "sidecar-readback",
    "apply-stat",
    "apply-utime",
    "post-inventory",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["errno,kind,mode,stage", "candidate,errno,kind,mode,stage"].includes(
      Object.keys(value).sort().join(),
    ) ||
    value.mode !== mode ||
    !stages.includes(value.stage) ||
    ![
      "FileNotFound",
      "NotADirectory",
      "Permission",
      "IsADirectory",
      "FileExists",
      "OS",
      "UnicodeDecode",
      "UnicodeEncode",
      "JSONDecode",
      "Syntax",
      "Value",
      "Type",
      "Memory",
      "Runtime",
      "Key",
      "Overflow",
      "Other",
    ].includes(value.kind) ||
    !(
      value.errno === null ||
      (Number.isSafeInteger(value.errno) &&
        value.errno >= 0 &&
        value.errno <= 4095)
    ) ||
    Buffer.byteLength(JSON.stringify(value)) > 2048
  )
    return null;
  if (Object.hasOwn(value, "candidate")) {
    const candidate = value.candidate;
    // Reuse precisely the existing public-source candidate grammar/hash checks.
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      !["bytes,sha256", "bytes,name,sha256"].includes(
        Object.keys(candidate).sort().join(),
      ) ||
      !Number.isSafeInteger(candidate.bytes) ||
      candidate.bytes <= 0 ||
      !sourcePathFailure({
        mode,
        phase: "filesystem-member",
        predicate: "unclassified",
        ...candidate,
      })
    )
      return null;
  }
  return value;
}

const MAC_EXTERNAL_ROLES = ["sdk", "toolchain", "metal", "python"];
const MAC_EXTERNAL_PUBLIC_LABELS = [
  "apple-system-library",
  "apple-system-lib",
  "apple-system-share",
  "selected-xcode-developer",
  "pinned-python-cellar",
];
const diagnosticBytes = (value) =>
  Buffer.byteLength(
    JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (character) =>
        "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
    ),
  );
const diagnosticKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const diagnosticRelative = (value) =>
  typeof value === "string" &&
  !value.startsWith("/") &&
  !value.startsWith("~") &&
  !/^[A-Za-z]:/.test(value) &&
  Buffer.from(value).toString("utf8") === value &&
  !/[\\\x00-\x1f\x7f]/.test(value) &&
  !value.split("/").some((part) => part === "." || part === "..");
function externalMemberDiagnostic(value) {
  if (
    !diagnosticKeys(value, [
      "role",
      "phase",
      "site",
      "predicate",
      "subpredicate",
      "pathPrefix",
      "pathTruncated",
      "pathOmitted",
      "pathOmittedReason",
      "characterCount",
      "characterCountAtLeast",
      "utf8Bytes",
    ]) ||
    diagnosticBytes(value) > 4096 ||
    value.role !== "sdk" ||
    value.phase !== "snapshot" ||
    value.site !== "inventory-relative" ||
    typeof value.pathTruncated !== "boolean" ||
    typeof value.pathOmitted !== "boolean"
  )
    return false;
  const pairs = {
    "type-or-byte-bound": ["empty", "byte-bound"],
    "absolute-backslash-or-colon": ["absolute", "backslash", "colon"],
    "component-syntax": [
      "empty-dot-parent",
      "trailing-space-or-dot",
      "dos-reserved-component",
    ],
    "control-character": ["control"],
  };
  if (!pairs[value.predicate]?.includes(value.subpredicate)) return false;
  if (
    !["characterCount", "characterCountAtLeast", "utf8Bytes"].every(
      (key) =>
        value[key] === null ||
        (Number.isSafeInteger(value[key]) &&
          value[key] >= 0 &&
          value[key] <= 4096),
    )
  )
    return false;
  if (
    value.characterCount === null
      ? value.characterCountAtLeast !== 1025
      : value.characterCount > 1024 || value.characterCountAtLeast !== null
  )
    return false;
  if ((value.characterCount === null) !== (value.utf8Bytes === null))
    return false;
  if (value.pathOmitted)
    return (
      value.pathPrefix === null &&
      value.pathTruncated === false &&
      value.pathOmittedReason === "ABSOLUTE_OR_UNPROVEN_RELATIVE"
    );
  return (
    diagnosticRelative(value.pathPrefix) &&
    value.pathPrefix.length <= 256 &&
    value.pathOmittedReason === null &&
    value.pathTruncated ===
      (value.characterCount === null || value.characterCount > 256) &&
    Array.from(value.pathPrefix).length ===
      Math.min(256, value.characterCount ?? 1025) &&
    (value.utf8Bytes === null ||
      (value.pathTruncated
        ? value.utf8Bytes >= Buffer.byteLength(value.pathPrefix)
        : value.utf8Bytes === Buffer.byteLength(value.pathPrefix)))
  );
}
function externalLinkDiagnostic(value) {
  if (
    !diagnosticKeys(value, [
      "originRole",
      "originPath",
      "site",
      "classification",
      "attemptedDeclaredRole",
      "ancestorNavigation",
      "expansions",
      "target",
      "lastExpandedRole",
      "lastExpandedTarget",
      "attemptedAddress",
    ]) ||
    diagnosticBytes(value) > 4096 ||
    !MAC_EXTERNAL_ROLES.includes(value.originRole) ||
    !MAC_EXTERNAL_ROLES.includes(value.lastExpandedRole) ||
    ![null, ...MAC_EXTERNAL_ROLES].includes(value.attemptedDeclaredRole) ||
    typeof value.ancestorNavigation !== "boolean" ||
    !Number.isSafeInteger(value.expansions) ||
    value.expansions < 0 ||
    value.expansions > 64
  )
    return false;
  const pairs = {
    "declared-role-entry": ["declared-role-entry-missing"],
    "declared-root-boundary": [
      "outside-declared-roots",
      "verified-root-ancestor-not-final",
    ],
    "absolute-root-underflow": ["absolute-root-underflow"],
  };
  if (
    !pairs[value.site]?.includes(value.classification) ||
    (value.site === "declared-role-entry") !==
      (value.attemptedDeclaredRole !== null)
  )
    return false;
  for (const key of [
    "originPath",
    "target",
    "lastExpandedTarget",
    "attemptedAddress",
  ]) {
    const item = value[key];
    if (
      !diagnosticKeys(item, [
        "scope",
        "role",
        "publicPrefix",
        "prefix",
        "utf8Bytes",
        "sha256",
        "truncated",
        "omitted",
        "omittedReason",
      ]) ||
      ![
        "omitted",
        "declared-role",
        "public-prefix",
        "descendant-relative",
      ].includes(item.scope) ||
      ![null, ...MAC_EXTERNAL_ROLES].includes(item.role) ||
      ![null, ...MAC_EXTERNAL_PUBLIC_LABELS].includes(item.publicPrefix) ||
      typeof item.truncated !== "boolean" ||
      typeof item.omitted !== "boolean" ||
      ![null, "UNAVAILABLE", "UNKNOWN_ABSOLUTE", "UNSAFE_TARGET"].includes(
        item.omittedReason,
      )
    )
      return false;
    if (
      (item.utf8Bytes === null) !== (item.sha256 === null) ||
      (item.utf8Bytes !== null &&
        (!Number.isSafeInteger(item.utf8Bytes) ||
          item.utf8Bytes <= 0 ||
          item.utf8Bytes > 4096)) ||
      (item.sha256 !== null &&
        (typeof item.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(item.sha256))) ||
      (item.omittedReason === "UNAVAILABLE" && item.sha256 !== null) ||
      (["UNKNOWN_ABSOLUTE", "UNSAFE_TARGET"].includes(item.omittedReason) &&
        item.sha256 === null)
    )
      return false;
    if (item.omitted) {
      if (
        item.scope !== "omitted" ||
        item.prefix !== null ||
        item.role !== null ||
        item.publicPrefix !== null ||
        item.truncated ||
        item.omittedReason === null
      )
        return false;
    } else {
      if (
        !diagnosticRelative(item.prefix) ||
        item.prefix.length > 128 ||
        diagnosticBytes(item.prefix) > 512 ||
        item.omittedReason !== null ||
        item.sha256 === null ||
        (item.role !== "sdk" && item.prefix.includes(":"))
      )
        return false;
      if (["declared-role", "descendant-relative"].includes(item.scope)) {
        if (item.role === null || item.publicPrefix !== null) return false;
      } else if (
        item.scope !== "public-prefix" ||
        item.publicPrefix === null ||
        item.role !== null
      )
        return false;
    }
  }
  return (
    value.originPath.scope === "declared-role" &&
    !value.originPath.omitted &&
    Boolean(value.originPath.prefix) &&
    value.originPath.utf8Bytes <= 1024 &&
    value.originPath.role === value.originRole
  );
}

function sourceBoundFailure(value, mode) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !==
      "entries,maximumEntries,maximumRawBytes,mode,rawBytes,stage" ||
    value.mode !== mode ||
    value.stage !== "inventory-append" ||
    !Number.isSafeInteger(value.entries) ||
    value.entries < 1 ||
    value.entries > 3_000_001 ||
    !Number.isSafeInteger(value.rawBytes) ||
    value.rawBytes < 0 ||
    value.rawBytes > 264 * 1024 ** 3 ||
    value.maximumEntries !== 3_000_000 ||
    value.maximumRawBytes !== 256 * 1024 ** 3 ||
    !(
      value.entries > value.maximumEntries ||
      value.rawBytes > value.maximumRawBytes
    ) ||
    Buffer.byteLength(JSON.stringify(value)) > 512
  )
    return null;
  return {
    mode: value.mode,
    stage: value.stage,
    entries: value.entries,
    rawBytes: value.rawBytes,
    maximumEntries: value.maximumEntries,
    maximumRawBytes: value.maximumRawBytes,
  };
}

// Diagnostic only: how a fresh source namespace differs from the recorded one.
function sourceContentFailure(value, mode) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !==
      "added,changed,missing,mode,reordered,samples,stage" ||
    value.mode !== mode ||
    value.stage !== "content" ||
    ![value.changed, value.missing, value.added].every(
      (count) =>
        Number.isSafeInteger(count) && count >= 0 && count <= 3_000_000,
    ) ||
    typeof value.reordered !== "boolean" ||
    !Array.isArray(value.samples) ||
    value.samples.length > 8 ||
    Buffer.byteLength(JSON.stringify(value)) > 4096
  )
    return null;
  const samples = [];
  for (const sample of value.samples) {
    if (
      !sample ||
      typeof sample !== "object" ||
      Array.isArray(sample) ||
      Object.keys(sample).sort().join() !== "candidate,fields,kind" ||
      !["changed", "missing", "added"].includes(sample.kind) ||
      !Array.isArray(sample.fields) ||
      sample.fields.length > 16 ||
      !sample.fields.every(
        (field, index) =>
          typeof field === "string" &&
          /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(field) &&
          (index === 0 || sample.fields[index - 1] < field),
      ) ||
      (sample.kind === "changed") !== sample.fields.length > 0
    )
      return null;
    const candidate = sample.candidate;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      !["bytes,sha256", "bytes,name,sha256"].includes(
        Object.keys(candidate).sort().join(),
      ) ||
      !Number.isSafeInteger(candidate.bytes) ||
      candidate.bytes <= 0 ||
      !sourcePathFailure({
        mode,
        phase: "filesystem-member",
        predicate: "unclassified",
        ...candidate,
      })
    )
      return null;
    samples.push({
      kind: sample.kind,
      fields: [...sample.fields],
      candidate: { ...candidate },
    });
  }
  return {
    mode: value.mode,
    stage: value.stage,
    changed: value.changed,
    missing: value.missing,
    added: value.added,
    reordered: value.reordered,
    samples,
  };
}

// Diagnostic only: owned source metadata progress when its own deadline hit.
export const SOURCE_METADATA_PHASES = Object.freeze([
  "start",
  "sidecar-read",
  "stat-cache-read",
  "repositories",
  "inventory",
  "hash",
  "post-inventory",
  "compare",
  "apply-literals",
  "apply-utime",
  "postcheck",
  "sidecar-write",
  "sidecar-readback",
  "record-literals",
  "stat-cache-write",
  "done",
]);
const sourceCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 264 * 1024 ** 3;
const sourcePhases = (phases) =>
  Array.isArray(phases) &&
  phases.length <= 64 &&
  phases.every(
    (item) =>
      Array.isArray(item) &&
      item.length === 2 &&
      SOURCE_METADATA_PHASES.includes(item[0]) &&
      sourceCount(item[1]),
  );
function sourceDeadlineFailure(value, mode) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !==
      "bytes,elapsedMs,files,hashedBytes,hashedFiles,mode,phase,phaseMs,phases,reusedFiles,seconds,walked" ||
    value.mode !== mode ||
    !SOURCE_METADATA_PHASES.includes(value.phase) ||
    !sourcePhases(value.phases) ||
    ![
      value.elapsedMs,
      value.phaseMs,
      value.walked,
      value.hashedFiles,
      value.hashedBytes,
      value.reusedFiles,
    ].every(sourceCount) ||
    !Number.isSafeInteger(value.seconds) ||
    value.seconds <= 0 ||
    value.seconds >
      Math.max(LIMITS.linuxSourceMetadataMs, LIMITS.macSourceMetadataHelperMs) /
        1000 ||
    (value.files === null) !== (value.bytes === null) ||
    (value.files !== null &&
      (!sourceCount(value.files) ||
        !sourceCount(value.bytes) ||
        value.hashedFiles + value.reusedFiles > value.files ||
        value.hashedBytes > value.bytes)) ||
    Buffer.byteLength(JSON.stringify(value)) > 4096
  )
    return null;
  return {
    bytes: value.bytes,
    elapsedMs: value.elapsedMs,
    files: value.files,
    hashedBytes: value.hashedBytes,
    hashedFiles: value.hashedFiles,
    mode: value.mode,
    phase: value.phase,
    phaseMs: value.phaseMs,
    phases: value.phases.map((item) => [...item]),
    reusedFiles: value.reusedFiles,
    seconds: value.seconds,
    walked: value.walked,
  };
}

// Diagnostic only: the owned source file and predicate that failed the
// identity check, with the candidate projected like any source candidate.
function sourceFileFailure(value, mode) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "candidate,mode,predicate,stage" ||
    value.mode !== mode ||
    value.stage !== "file-identity" ||
    !["kind", "nlink", "size", "stamp", "ctime", "descriptor"].includes(
      value.predicate,
    ) ||
    Buffer.byteLength(JSON.stringify(value)) > 2048
  )
    return null;
  const candidate = value.candidate;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    !["bytes,sha256", "bytes,name,sha256"].includes(
      Object.keys(candidate).sort().join(),
    ) ||
    !Number.isSafeInteger(candidate.bytes) ||
    candidate.bytes <= 0 ||
    !sourcePathFailure({
      mode,
      phase: "filesystem-member",
      predicate: "unclassified",
      ...candidate,
    })
  )
    return null;
  return {
    mode: value.mode,
    stage: value.stage,
    predicate: value.predicate,
    candidate: { ...candidate },
  };
}

function sourceMetadataReadFailure(value, mode) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![
      "kind,maximum,mode,nlink,phase,predicate,readBytes,size,stage",
      "candidate,kind,maximum,mode,nlink,phase,predicate,readBytes,size,stage",
    ].includes(Object.keys(value).sort().join()) ||
    value.mode !== mode ||
    !["stat", "stream"].includes(value.stage) ||
    !SOURCE_METADATA_PHASES.includes(value.phase) ||
    !["kind", "nlink", "empty", "size", "growth"].includes(value.predicate) ||
    !["regular", "directory", "symlink", "other"].includes(value.kind) ||
    ![value.size, value.nlink].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    !Number.isSafeInteger(value.maximum) ||
    value.maximum <= 0 ||
    value.maximum > SOURCE_METADATA_MAX_BYTES ||
    Buffer.byteLength(JSON.stringify(value)) > 2048
  )
    return null;
  if (value.stage === "stat") {
    const expected =
      value.kind !== "regular"
        ? "kind"
        : value.nlink !== 1
          ? "nlink"
          : value.size === 0
            ? "empty"
            : value.size > value.maximum
              ? "size"
              : null;
    if (value.readBytes !== null || value.predicate !== expected) return null;
  } else if (
    value.predicate !== "growth" ||
    value.kind !== "regular" ||
    value.nlink !== 1 ||
    value.size <= 0 ||
    value.size > value.maximum ||
    !Number.isSafeInteger(value.readBytes) ||
    value.readBytes <= value.size ||
    value.readBytes > value.size + 65536
  )
    return null;
  if (Object.hasOwn(value, "candidate")) {
    const candidate = value.candidate;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      !["bytes,sha256", "bytes,name,sha256"].includes(
        Object.keys(candidate).sort().join(),
      ) ||
      !Number.isSafeInteger(candidate.bytes) ||
      candidate.bytes <= 0 ||
      !sourcePathFailure({
        mode,
        phase: "filesystem-member",
        predicate: "unclassified",
        ...candidate,
      })
    )
      return null;
  }
  return {
    mode: value.mode,
    stage: value.stage,
    phase: value.phase,
    predicate: value.predicate,
    size: value.size,
    nlink: value.nlink,
    kind: value.kind,
    maximum: value.maximum,
    readBytes: value.readBytes,
    ...(Object.hasOwn(value, "candidate")
      ? { candidate: { ...value.candidate } }
      : {}),
  };
}

export function archiveFailureRecord(
  stdout,
  exitCode,
  {
    overflow = false,
    deadline = false,
    cleanupUnknown = false,
    sourceMode = null,
  } = {},
) {
  let sourceCloseFailure = false,
    sourceJoinFailure = false,
    externalFacts,
    sourceFacts,
    sourceIoFacts,
    sourceBoundFacts,
    sourceFileFacts,
    sourceMetadataReadFacts,
    sourceDeadlineFacts,
    sourceContentFacts;
  let error = deadline
    ? "archive-deadline"
    : overflow
      ? "archive-output-bound"
      : "unknown";
  if (typeof stdout === "string" && stdout.length > LIMITS.seal)
    error = "archive-output-bound";
  else if (!deadline && !overflow && typeof stdout === "string") {
    try {
      const decoded = JSON.parse(stdout);
      let value = decoded,
        optional,
        optionalInvalid = false,
        externalOptional,
        externalInvalid = false,
        externalLinksWithoutRole = false;
      // Only these fixed read-only observer modes emit the optional ABI.
      if (
        ["mac-external-observe", "mac-python-package-observe"].includes(
          sourceMode,
        ) &&
        decoded &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        externalOptional = {};
        for (const [key, validate, matches] of [
          [
            "externalMemberFailure",
            externalMemberDiagnostic,
            value.error === "member-path" &&
              value.externalPhase === "snapshot" &&
              value.externalRole === "sdk",
          ],
          [
            "externalLinkFailure",
            externalLinkDiagnostic,
            value.error === "source-external-input-unattested" &&
              value.externalPhase === "links",
          ],
        ]) {
          if (Object.hasOwn(value, key)) {
            try {
              if (matches && validate(value[key]))
                externalOptional[key] = value[key];
              else externalInvalid = true;
            } catch {
              externalInvalid = true;
            }
            delete value[key];
          }
        }
        if (value.externalPhase === "links") {
          const origin = externalOptional.externalLinkFailure?.originRole;
          if (
            Object.hasOwn(value, "externalRole") &&
            MAC_EXTERNAL_ROLES.includes(value.externalRole) &&
            (!origin || origin !== value.externalRole)
          ) {
            if (origin) {
              delete externalOptional.externalLinkFailure;
              externalInvalid = true;
            }
            delete value.externalRole; // Never attribute a link from the old snapshot-loop scalar.
          }
          externalLinksWithoutRole = !Object.hasOwn(value, "externalRole");
        }
      }
      if (
        ["source-record", "source-apply", "source-verify"].includes(
          sourceMode,
        ) &&
        decoded?.error === "source-metadata-read-bound" &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        let read,
          invalid = false;
        if (Object.hasOwn(value, "sourceMetadataReadFailure")) {
          try {
            read = sourceMetadataReadFailure(
              value.sourceMetadataReadFailure,
              sourceMode,
            );
            invalid = read === null;
          } catch {
            invalid = true;
          }
          delete value.sourceMetadataReadFailure;
        }
        if (Object.hasOwn(value, "sourceMetadataReadFailureInvalid")) {
          invalid = true;
          delete value.sourceMetadataReadFailureInvalid;
        }
        sourceMetadataReadFacts = {
          ...(read && !invalid ? { sourceMetadataReadFailure: read } : {}),
          ...(invalid ? { sourceMetadataReadFailureInvalid: true } : {}),
        };
      }
      if (
        ["source-record", "source-apply", "source-verify"].includes(
          sourceMode,
        ) &&
        decoded?.error === "input-bound" &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        let bound,
          invalid = false;
        if (Object.hasOwn(value, "sourceBoundFailure")) {
          try {
            bound = sourceBoundFailure(value.sourceBoundFailure, sourceMode);
            invalid = bound === null;
          } catch {
            invalid = true;
          }
          delete value.sourceBoundFailure;
        }
        if (Object.hasOwn(value, "sourceBoundFailureInvalid")) {
          invalid = true;
          delete value.sourceBoundFailureInvalid;
        }
        sourceBoundFacts = {
          ...(bound && !invalid ? { sourceBoundFailure: bound } : {}),
          ...(invalid ? { sourceBoundFailureInvalid: true } : {}),
        };
      }
      if (
        ["source-record", "source-apply", "source-verify"].includes(
          sourceMode,
        ) &&
        decoded?.error === "source-content-changed" &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        let content,
          invalid = false;
        if (Object.hasOwn(value, "sourceContentFailure")) {
          try {
            content = sourceContentFailure(
              value.sourceContentFailure,
              sourceMode,
            );
            invalid = content === null;
          } catch {
            invalid = true;
          }
          delete value.sourceContentFailure;
        }
        if (Object.hasOwn(value, "sourceContentFailureInvalid")) {
          invalid = true;
          delete value.sourceContentFailureInvalid;
        }
        sourceContentFacts = {
          ...(content && !invalid ? { sourceContentFailure: content } : {}),
          ...(invalid ? { sourceContentFailureInvalid: true } : {}),
        };
      }
      if (
        ["source-record", "source-apply", "source-verify"].includes(
          sourceMode,
        ) &&
        decoded?.error === "archive-deadline" &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        let progress,
          invalid = false;
        if (Object.hasOwn(value, "sourceDeadlineFailure")) {
          try {
            progress = sourceDeadlineFailure(
              value.sourceDeadlineFailure,
              sourceMode,
            );
            invalid = progress === null;
          } catch {
            invalid = true;
          }
          delete value.sourceDeadlineFailure;
        }
        if (Object.hasOwn(value, "sourceDeadlineFailureInvalid")) {
          invalid = true;
          delete value.sourceDeadlineFailureInvalid;
        }
        sourceDeadlineFacts = {
          ...(progress && !invalid ? { sourceDeadlineFailure: progress } : {}),
          ...(invalid ? { sourceDeadlineFailureInvalid: true } : {}),
        };
      }
      if (
        ["source-record", "source-apply", "source-verify"].includes(
          sourceMode,
        ) &&
        decoded?.error === "source-file-identity" &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        let file,
          invalid = false;
        if (Object.hasOwn(value, "sourceFileFailure")) {
          try {
            file = sourceFileFailure(value.sourceFileFailure, sourceMode);
            invalid = file === null;
          } catch {
            invalid = true;
          }
          delete value.sourceFileFailure;
        }
        if (Object.hasOwn(value, "sourceFileFailureInvalid")) {
          invalid = true;
          delete value.sourceFileFailureInvalid;
        }
        sourceFileFacts = {
          ...(file && !invalid ? { sourceFileFailure: file } : {}),
          ...(invalid ? { sourceFileFailureInvalid: true } : {}),
        };
      }
      if (
        ["source-record", "source-apply", "source-verify"].includes(
          sourceMode,
        ) &&
        decoded?.error === "archive-io-error" &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        let io,
          invalid = false;
        if (Object.hasOwn(value, "sourceIoFailure")) {
          io = sourceIoFailure(value.sourceIoFailure, sourceMode);
          invalid = io === null;
          delete value.sourceIoFailure;
        }
        if (Object.hasOwn(value, "sourceIoFailureInvalid")) {
          invalid = true;
          delete value.sourceIoFailureInvalid;
        }
        sourceIoFacts = {
          ...(io && !invalid ? { sourceIoFailure: io } : {}),
          ...(invalid ? { sourceIoFailureInvalid: true } : {}),
        };
      }
      if (
        ["source-record", "source-apply", "source-verify"].includes(
          sourceMode,
        ) &&
        decoded?.error === "member-path" &&
        typeof decoded === "object" &&
        !Array.isArray(decoded)
      ) {
        value = { ...decoded };
        if (Object.hasOwn(value, "sourcePathFailure")) {
          try {
            optional = sourcePathFailure(value.sourcePathFailure);
            optionalInvalid = optional === null || optional.mode !== sourceMode;
          } catch {
            optionalInvalid = true;
          }
          delete value.sourcePathFailure;
        }
        if (Object.hasOwn(value, "sourcePathFailureInvalid")) {
          optionalInvalid = true;
          delete value.sourcePathFailureInvalid;
        }
      }
      if (
        value &&
        (Object.keys(value).sort().join() === "complete,error" ||
          (Object.keys(value).every((key) =>
            [
              "complete",
              "error",
              "sourceCloseFailure",
              "sourceJoinFailure",
              "externalRole",
              "externalPhase",
              "macReportingFailure",
            ].includes(key),
          ) &&
            (value.sourceCloseFailure === true ||
              value.sourceJoinFailure === true ||
              value.macReportingFailure === true ||
              externalLinksWithoutRole ||
              ["sdk", "toolchain", "metal", "python"].includes(
                value.externalRole,
              )) &&
            (!Object.hasOwn(value, "sourceCloseFailure") ||
              value.sourceCloseFailure === true) &&
            (!Object.hasOwn(value, "sourceJoinFailure") ||
              value.sourceJoinFailure === true) &&
            (!Object.hasOwn(value, "macReportingFailure") ||
              value.macReportingFailure === true) &&
            (!Object.hasOwn(value, "externalRole") ||
              ["sdk", "toolchain", "metal", "python"].includes(
                value.externalRole,
              )) &&
            (externalLinksWithoutRole ||
              Object.hasOwn(value, "externalRole") ===
                Object.hasOwn(value, "externalPhase")) &&
            (!Object.hasOwn(value, "externalPhase") ||
              [
                "snapshot",
                "links",
                "pins",
                "readback",
                "report",
                "complete",
              ].includes(value.externalPhase)))) &&
        value.complete === false &&
        ARCHIVE_FAILURES.has(value.error)
      ) {
        error = value.error;
        sourceCloseFailure = value.sourceCloseFailure === true;
        sourceJoinFailure = value.sourceJoinFailure === true;
        externalFacts = {
          ...(value.externalRole
            ? {
                externalRole: value.externalRole,
                externalPhase: value.externalPhase,
              }
            : {}),
          ...(externalLinksWithoutRole ? { externalPhase: "links" } : {}),
          ...externalOptional,
          ...(externalInvalid ? { externalDiagnosticInvalid: true } : {}),
          ...(value.macReportingFailure === true
            ? { macReportingFailure: true }
            : {}),
        };
        sourceFacts = {
          ...(optional && !optionalInvalid
            ? { sourcePathFailure: optional }
            : {}),
          ...(optionalInvalid ? { sourcePathFailureInvalid: true } : {}),
        };
      } else {
        sourceIoFacts = undefined;
        sourceBoundFacts = undefined;
        sourceFileFacts = undefined;
        sourceMetadataReadFacts = undefined;
        sourceDeadlineFacts = undefined;
        sourceContentFacts = undefined;
      }
    } catch {
      /* Untrusted/partial helper output never becomes a log label. */
    }
  }
  return {
    error,
    ...(cleanupUnknown ? { archiveCleanupUnknown: true } : {}),
    ...(sourceCloseFailure ? { sourceCloseFailure: true } : {}),
    ...(sourceJoinFailure ? { sourceJoinFailure: true } : {}),
    ...externalFacts,
    ...sourceFacts,
    ...sourceIoFacts,
    ...sourceBoundFacts,
    ...sourceFileFacts,
    ...sourceMetadataReadFacts,
    ...sourceDeadlineFacts,
    ...sourceContentFacts,
    exitCode:
      Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255
        ? exitCode
        : null,
  };
}

export async function archiveCommand(
  python,
  helper,
  args,
  { timeout = LIMITS.archiveMs, observeFailure } = {},
) {
  let macSourceHostFacts = false;
  if (
    Array.isArray(args) &&
    ["source-record", "source-apply", "source-verify"].includes(args[0]) &&
    args.some(
      (value) =>
        typeof value === "string" && value.startsWith("--platform-policy"),
    )
  ) {
    const flags = [
      "--input",
      "--output",
      "--manifest",
      "--seconds",
      "--platform-policy",
    ];
    assert(
      args.length === 11 &&
        flags.every((flag, index) => args[index * 2 + 1] === flag) &&
        args.filter((value) => value === "--platform-policy").length === 1 &&
        [args[2], args[4], args[6]].every(
          (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            Buffer.byteLength(value) <= 32768 &&
            !/[\x00-\x1f\x7f]/.test(value) &&
            !value.startsWith("--"),
        ) &&
        typeof args[8] === "string" &&
        /^[1-9][0-9]{0,3}$/.test(args[8]) &&
        Number(args[8]) <= LIMITS.macSourceMetadataHelperMs / 1000 &&
        ["mac-arm", "mac-intel"].includes(args[10]),
      "Fixed Mac source archive flags required",
    );
    macSourceHostFacts = true;
  }
  assert(
    path.isAbsolute(python) &&
      path.isAbsolute(helper) &&
      positive(timeout) &&
      timeout <=
        (Array.isArray(args) &&
        ["source-record", "source-apply", "source-verify"].includes(args[0]) &&
        (!args.includes("--platform-policy") || macSourceHostFacts)
          ? macSourceHostFacts
            ? LIMITS.macSourceMetadataMs
            : LIMITS.linuxSourceMetadataMs
          : LIMITS.archiveMs),
    "Verified archive tool required",
  );
  return new Promise((resolve, reject) => {
    const end = performance.now() + timeout;
    // Cleanup is reserved INSIDE the caller's original bound, never added to it.
    const reserve = Math.min(5000, Math.max(1, Math.floor(timeout / 4)));
    const captured = Buffer.alloc(LIMITS.seal);
    let child,
      bytes = 0,
      first,
      failed = false,
      settled = false,
      stopping = false;
    let rootExited = false,
      childClosed = false,
      stdoutClosed = false,
      stderrClosed = false;
    let cleanupFault = false,
      code = null,
      cause = {},
      workTimer,
      endTimer,
      cleanupTimer;
    const stdout = () => captured.subarray(0, bytes).toString("utf8");
    const pipesClosed = () => stdoutClosed && stderrClosed;
    const report = (cleanupUnknown) => {
      if (!observeFailure) return;
      try {
        Promise.resolve(
          observeFailure(
            archiveFailureRecord(stdout(), code, {
              ...cause,
              cleanupUnknown,
              sourceMode: args[0],
            }),
          ),
        ).catch(() => {});
      } catch {
        /* A diagnostic never replaces the original failure. */
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(workTimer);
      clearTimeout(endTimer);
      clearTimeout(cleanupTimer);
      const rootReaped = childClosed && (rootExited || !child?.pid);
      const cleanupUnknown = cleanupFault || !rootReaped || !pipesClosed();
      if (failed) {
        if (cleanupUnknown) {
          // No PID/group guesses: release only our own handles after denial.
          try {
            child?.unref();
          } catch {}
          for (const stream of [child?.stdout, child?.stderr])
            try {
              stream?.unref?.();
            } catch {}
        }
        report(cleanupUnknown);
        reject(first);
        return;
      }
      const deadlineFailure = () => {
        first = new Error("Archive deadline; partial is not admitted");
        failed = true;
        cause = { deadline: true };
        report(cleanupUnknown);
        reject(first);
      };
      if (performance.now() > end) return deadlineFailure();
      try {
        assert(!cleanupUnknown, "Archive ownership unconfirmed");
        const text = stdout();
        assert(
          Buffer.from(text).equals(captured.subarray(0, bytes)),
          "Malformed archive UTF8",
        );
        const value = JSON.parse(text);
        if (performance.now() > end) return deadlineFailure();
        resolve(value);
      } catch {
        first = new Error("Malformed archive result");
        failed = true;
        report(cleanupUnknown);
        reject(first);
      }
    };
    const joined = () => {
      if (childClosed && (rootExited || !child?.pid) && pipesClosed()) finish();
    };
    const stop = () => {
      if (stopping || settled) return;
      stopping = true;
      const remaining = Math.max(0, Math.min(reserve, end - performance.now()));
      cleanupTimer = setTimeout(finish, remaining);
      // This reviewed Python worker is a leaf. ChildProcess owns the exact
      // creation handle; never signal a process group or a subsequently reused PID.
      if (child?.pid && !rootExited) {
        try {
          if (!child.kill("SIGKILL")) cleanupFault = true;
        } catch {
          cleanupFault = true;
        }
      }
      for (const stream of [child?.stdout, child?.stderr]) {
        try {
          stream?.destroy();
        } catch {
          cleanupFault = true;
        }
      }
      joined();
    };
    const fail = (error, options = {}) => {
      if (settled) return;
      if (!failed) {
        failed = true;
        first = error;
        cause = options;
        clearTimeout(workTimer);
      }
      stop();
    };
    workTimer = setTimeout(
      () =>
        fail(new Error("Archive deadline; partial is not admitted"), {
          deadline: true,
        }),
      Math.max(0, timeout - reserve),
    );
    endTimer = setTimeout(() => {
      fail(new Error("Archive deadline; partial is not admitted"), {
        deadline: true,
      });
      finish();
    }, timeout);
    try {
      child = spawn(
        python,
        [
          "-I",
          "-B",
          ...(args[0] === "mac-python-package-observe" ? ["-S"] : []),
          helper,
          ...args,
        ],
        {
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          env:
            macSourceHostFacts ||
            [
              "mac-python-package-observe",
              "mac-external-observe",
              "mac-owned-capability-observe",
            ].includes(args[0])
              ? {
                  PATH: path.dirname(python),
                  ImageOS: process.env.ImageOS,
                  ImageVersion: process.env.ImageVersion,
                  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
                  RUNNER_ENVIRONMENT: process.env.RUNNER_ENVIRONMENT,
                  GITHUB_REPOSITORY_VISIBILITY:
                    process.env.GITHUB_REPOSITORY_VISIBILITY,
                  ...(process.env.RUNNER_TRACKING_ID
                    ? { RUNNER_TRACKING_ID: process.env.RUNNER_TRACKING_ID }
                    : {}),
                }
              : { PATH: path.dirname(python) },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.on("error", (error) => fail(error));
      child.once("exit", (exitCode) => {
        rootExited = true;
        code = exitCode;
        joined();
      });
      child.once("close", (exitCode) => {
        childClosed = true;
        code = exitCode;
        if (!failed && exitCode !== 0)
          fail(new Error("Checkpoint archive rejected"));
        joined();
      });
      child.stdout.once("close", () => {
        stdoutClosed = true;
        joined();
      });
      child.stderr.once("close", () => {
        stderrClosed = true;
        joined();
      });
      child.stdout.on("error", (error) => fail(error));
      child.stderr.on("error", (error) => fail(error));
      child.stdout.on("data", (data) => {
        if (failed || settled) return;
        try {
          const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const count = Math.min(raw.length, LIMITS.seal - bytes);
          raw.copy(captured, bytes, 0, count);
          bytes += count;
          if (count !== raw.length)
            fail(new Error("Checkpoint archive rejected"), { overflow: true });
        } catch (error) {
          fail(error);
        }
      });
      child.stderr.resume();
    } catch (error) {
      fail(error);
      if (!child) {
        childClosed = true;
        stdoutClosed = true;
        stderrClosed = true;
        finish();
      }
    }
  });
}
export async function groupQuiet(
  pid,
  {
    kill = process.kill,
    deadline = Infinity,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  for (let i = 0; i < 50; i++) {
    assert(performance.now() < deadline, "Owned group observation deadline");
    try {
      kill(-pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return true;
      throw error;
    }
    await wait(100);
  }
  return false;
}

// Closed, numeric monitor diagnostics; Error and row identities remain intact.
const compileMonitorMetadata = new WeakMap();
const compileMonitorCodes = new Set([
  "NONE",
  "UNKNOWN",
  "PS_DEADLINE",
  "PS_ABORT",
  "PS_SPAWN",
  "PS_STDOUT_READ",
  "PS_STDOUT_BOUND",
  "PS_EXIT_NONZERO",
  "PS_ROWS_SYNTAX",
  "PS_ROWS_IDENTITY",
  "PS_ROWS_COUNT",
  "OWN_SEED_BOUND",
  "OWN_ROOT_REPLACED",
  "OWN_ACTIVE_BOUND",
  "OWN_MONITOR_TURN_BOUND",
  "CENSUS_DEADLINE",
  "CENSUS_EOF",
  "CENSUS_OUTPUT_BOUND",
  "CENSUS_READY_DEADLINE",
]);
export function compileMonitorRecord(value, code, facts = {}) {
  if (value === null || !["object", "function"].includes(typeof value))
    return value;
  const previous = compileMonitorMetadata.get(value);
  const record = {
    code: previous?.code ?? (compileMonitorCodes.has(code) ? code : "UNKNOWN"),
  };
  for (const name of [
    "snapshotElapsedMs",
    "snapshotChars",
    "snapshotRows",
    "priorOwnedCount",
    "nextOwnedCount",
  ])
    if (Number.isSafeInteger(facts[name]) && facts[name] >= 0)
      record[name] = facts[name];
  if (
    facts.snapshotExitCode === null ||
    (Number.isSafeInteger(facts.snapshotExitCode) &&
      facts.snapshotExitCode >= -255 &&
      facts.snapshotExitCode <= 255)
  )
    record.snapshotExitCode = facts.snapshotExitCode;
  compileMonitorMetadata.set(value, Object.freeze({ ...previous, ...record }));
  return value;
}
export function compileMonitorDetails(value) {
  return {
    ...((value !== null && ["object", "function"].includes(typeof value)
      ? compileMonitorMetadata.get(value)
      : null) ?? { code: "UNKNOWN" }),
  };
}
function compileFailureObservation(error) {
  let errorCode = "UNKNOWN";
  try {
    if (!utilTypes.isProxy(error) && utilTypes.isNativeError(error)) {
      const message = Object.getOwnPropertyDescriptor(error, "message");
      const code = Object.getOwnPropertyDescriptor(error, "code");
      const messages = new Map([
        [
          "Observed descendants not reaped; checkpoint denied",
          "OWN_NOT_REAPED",
        ],
        ["Owned reap deadline", "OWN_REAP_DEADLINE"],
        ["Owned freeze deadline", "OWN_FREEZE_DEADLINE"],
        ["Observed lineage did not stabilize", "OWN_LINEAGE_UNSTABLE"],
        ["Ambiguous owned process", "OWN_IDENTITY_AMBIGUOUS"],
        ["Owned PID replaced before reap", "OWN_PID_REPLACED"],
        ["Owned root PID identity changed", "OWN_ROOT_REPLACED"],
        [
          "Observed descendants survived compiler exit; checkpoint denied",
          "OWN_SURVIVED_EXIT",
        ],
        [
          "Unconfirmed compiler ownership; checkpoint denied",
          "OWN_UNCONFIRMED",
        ],
        [
          "Compile cleanup unconfirmed; checkpoint denied",
          "CLEANUP_UNCONFIRMED",
        ],
        ["Output settlement deadline", "OUTPUT_SETTLEMENT_DEADLINE"],
        ["Output close deadline", "OUTPUT_CLOSE_DEADLINE"],
        ["Shared compile output bound", "OUTPUT_BOUND"],
        ["CENSUS_DEADLINE", "CENSUS_DEADLINE"],
        ["CENSUS_EOF", "CENSUS_EOF"],
        ["CENSUS_REQUEST", "CENSUS_REQUEST"],
        ["CENSUS_REQUEST_BOUND", "CENSUS_REQUEST_BOUND"],
        ["CENSUS_OUTPUT_BOUND", "CENSUS_OUTPUT_BOUND"],
        ["CENSUS_STDERR_BOUND", "CENSUS_STDERR_BOUND"],
        ["CENSUS_READY_DEADLINE", "CENSUS_READY_DEADLINE"],
        ["CENSUS_JOIN", "CENSUS_JOIN"],
        ["CENSUS_FAILED", "CENSUS_FAILED"],
        ["CENSUS_ROOT", "CENSUS_ROOT"],
      ]);
      if (typeof message?.value === "string" && messages.has(message.value))
        errorCode = messages.get(message.value);
      else if (
        typeof code?.value === "string" &&
        [
          "EPIPE",
          "ENOENT",
          "EACCES",
          "EPERM",
          "ENOSPC",
          "EIO",
          "EMFILE",
        ].includes(code.value)
      )
        errorCode = code.value;
    }
  } catch {
    // Observation cannot replace even a falsy or hostile primary failure.
  }
  return { ...compileMonitorDetails(error), errorCode };
}
function compileMonitorGuard(ok, message, code, facts) {
  try {
    assert(ok, message);
  } catch (error) {
    throw compileMonitorRecord(error, code, facts);
  }
}

export function processRows(text) {
  compileMonitorGuard(
    typeof text === "string" && text.length <= 4 * 1024 ** 2,
    "Ownership snapshot bound",
    "PS_STDOUT_BOUND",
  );
  const rows = [],
    ids = new Set();
  for (const line of text.trim().split("\n")) {
    const match = /^\s*([0-9]+)\s+([0-9]+)\s+(.+?)\s*$/.exec(line);
    compileMonitorGuard(
      match,
      "Malformed ownership snapshot",
      "PS_ROWS_SYNTAX",
    );
    const row = {
      pid: Number(match[1]),
      parent: Number(match[2]),
      start: match[3].replace(/\s+/g, " "),
    };
    compileMonitorGuard(
      positive(row.pid) &&
        Number.isSafeInteger(row.parent) &&
        row.parent >= 0 &&
        !ids.has(row.pid) &&
        /^[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/.test(
          row.start,
        ),
      "Ambiguous process ownership",
      "PS_ROWS_IDENTITY",
    );
    ids.add(row.pid);
    rows.push(row);
    compileMonitorGuard(
      rows.length <= 32768,
      "Ownership process bound",
      "PS_ROWS_COUNT",
      { snapshotRows: rows.length },
    );
  }
  return rows;
}

// Exact Intel-image/source scope is qualified by the immutable records below.
// Integration and ABI proofs never mint live compile receipts.
export const MAC_NATIVE_CENSUS_ADMITTED = true;
export const MAC_CENSUS_ABI = Object.freeze({
  recordBytes: 648,
  pidOffset: 40,
  pidBytes: 4,
  parentOffset: 560,
  parentBytes: 4,
  groupOffset: 564,
  groupBytes: 4,
  secondsOffset: 0,
  secondsBytes: 8,
  microsOffset: 8,
  microsBytes: 4,
  pointerBytes: 8,
  longBytes: 8,
  mib: Object.freeze([1, 14, 0, 0]),
});
export const MAC_CENSUS_EVIDENCE = Object.freeze({
  runId: 41339128028,
  artifactId: 13096432034,
  sha256: "ec38df12b8469456d353614e2cb54e486ecc163b5ab15ddcb908b296d6fc1855",
});
export const MAC_CENSUS_SUPERVISOR_QUALIFICATION = Object.freeze({
  runId: 41342489672,
  artifactId: 13097527087,
  source: "ce297732e385466d4d8fe731e30441408fec6d30",
  sha256: "43bc3e2bb72dce370e8b35f0e3ab0cf4584ab85f4f66c1b5b336e7df7bfefb3c",
});
const MAC_CENSUS_SOURCES = Object.freeze({
  "x86_64-apple-darwin":
    "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
  "aarch64-apple-darwin":
    "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
});
const MAC_CENSUS_PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const macCensusFactories = new WeakMap();
const macCensusSessions = new WeakSet();
export function macCensusRequestBudget(workMilliseconds, phase = "compile") {
  assert(
    Number.isInteger(workMilliseconds) &&
      workMilliseconds > 0 &&
      workMilliseconds <= LIMITS.maxCompileMs,
    "CENSUS_REQUEST_BOUND",
  );
  assert(phase === "compile" || phase === "readonly", "CENSUS_PHASE");
  // Monitor <=ceil(work/250)+8; initial+freeze+kill+50 reap+terminal probes
  // fit within the remaining120 slots. Read-only phases need at most8 reads.
  return phase === "readonly" ? 8 : Math.ceil(workMilliseconds / 250) + 128;
}
function censusScope(value, proofOnly) {
  shape(value, [
    "target",
    "source",
    "canonicalRoot",
    "scratch",
    "python",
    "deadline",
  ]);
  assert(
    Object.values(Object.getOwnPropertyDescriptors(value)).every((field) =>
      Object.hasOwn(field, "value"),
    ),
    "CENSUS_ROOT",
  );
  assert(
    process.platform === "darwin" &&
      process.arch === "x64" &&
      process.env.ImageOS === "macos15" &&
      process.env.ImageVersion === "20260824.0482.1" &&
      process.env.RUNNER_ENVIRONMENT === "github-hosted",
    "CENSUS_HOST",
  );
  assert(
    Object.hasOwn(MAC_CENSUS_SOURCES, value.target) &&
      value.source === MAC_CENSUS_SOURCES[value.target] &&
      value.canonicalRoot ===
        `/Users/runner/work/_temp/sorng-cef-engineering/${value.target}/${value.source}` &&
      value.python === MAC_CENSUS_PYTHON,
    "CENSUS_ROOT",
  );
  assert(
    Number.isFinite(value.deadline) &&
      value.deadline > performance.now() &&
      value.deadline - performance.now() <= LIMITS.hostMs,
    "CENSUS_DEADLINE",
  );
  const prefix = proofOnly ? "integration" : "production";
  assert(
    typeof process.env.RUNNER_TEMP === "string" &&
      path.dirname(value.scratch) === process.env.RUNNER_TEMP &&
      new RegExp(
        `^cef-mac-census-${prefix}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`,
      ).test(path.basename(value.scratch)),
    "CENSUS_ROOT",
  );
}
async function censusOwnedRoot(root, { privateDirectory = true } = {}) {
  assert((await noLinks(root)) === root, "CENSUS_ROOT");
  const info = await lstat(root, { bigint: true });
  assert(
    info.isDirectory() &&
      info.uid === BigInt(userInfo().uid) &&
      (privateDirectory
        ? (info.mode & 0o777n) === 0o700n
        : (info.mode & 0o700n) === 0o700n && (info.mode & 0o022n) === 0n),
    "CENSUS_ROOT",
  );
  return info;
}
async function censusPythonPin(python) {
  assert((await noLinks(python)) === python, "CENSUS_TOOL_PIN");
  const before = await lstat(python, { bigint: true });
  assert(
    before.isFile() && before.size === 13592n && before.nlink === 1n,
    "CENSUS_TOOL_PIN",
  );
  const same = (info) =>
    [
      "dev",
      "ino",
      "mode",
      "size",
      "mtimeNs",
      "ctimeNs",
      "nlink",
      "uid",
      "gid",
    ].every((k) => before[k] === info[k]);
  const handle = await open(
    python,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    assert(same(await handle.stat({ bigint: true })), "CENSUS_TOOL_PIN");
    const buffer = Buffer.alloc(13593);
    let count = 0;
    for (;;) {
      const read = await handle.read(
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (!read.bytesRead) break;
      count += read.bytesRead;
      assert(count <= 13592, "CENSUS_TOOL_PIN");
    }
    assert(
      count === 13592 &&
        sha(buffer.subarray(0, count)) ===
          "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d" &&
        same(await handle.stat({ bigint: true })) &&
        same(await lstat(python, { bigint: true })),
      "CENSUS_TOOL_PIN",
    );
  } finally {
    await handle.close();
  }
}
async function censusFactory(value, proofOnly) {
  censusScope(value, proofOnly);
  const rootIdentity = await censusOwnedRoot(value.scratch);
  if (!proofOnly)
    await censusOwnedRoot(value.canonicalRoot, { privateDirectory: false });
  await censusPythonPin(value.python);
  const capability = Object.freeze({ kind: "scoped-mac-census-factory" });
  macCensusFactories.set(capability, {
    ...value,
    proofOnly,
    rootIdentity,
    sessions: 0,
    joinedSessions: 0,
    responses: 0,
    active: false,
    failed: null,
  });
  return capability;
}
export async function createMacProcessCensusFactory(value) {
  assert(MAC_NATIVE_CENSUS_ADMITTED, "CENSUS_UNADMITTED");
  return censusFactory(value, false);
}
export async function createMacCensusIntegrationProofFactory(value) {
  return censusFactory(value, true);
}
async function openCensusSession(
  factory,
  { deadline, workMilliseconds, phase, startupDeadline = deadline },
) {
  const startupEnd = Math.min(
    deadline,
    startupDeadline,
    performance.now() + 2000,
  );
  const binding = macCensusFactories.get(factory);
  assert(
    binding && !binding.failed && !binding.active && binding.sessions < 16,
    "CENSUS_CAPABILITY",
  );
  censusScope(
    {
      ...Object.fromEntries(
        [
          "target",
          "source",
          "canonicalRoot",
          "scratch",
          "python",
          "deadline",
        ].map((k) => [k, binding[k]]),
      ),
    },
    binding.proofOnly,
  );
  assert(
    Number.isFinite(deadline) &&
      deadline <= binding.deadline &&
      deadline > performance.now(),
    "CENSUS_DEADLINE",
  );
  const root = await censusOwnedRoot(binding.scratch);
  assert(
    ["dev", "ino", "mode", "uid"].every(
      (k) => root[k] === binding.rootIdentity[k],
    ),
    "CENSUS_ROOT",
  );
  await censusPythonPin(binding.python);
  assert(performance.now() < startupEnd, "CENSUS_DEADLINE");
  const requestBudget = macCensusRequestBudget(workMilliseconds, phase);
  binding.active = true;
  binding.sessions++;
  const sessionRoot = path.join(
    binding.scratch,
    "cef-mac-census-session-" + randomUUID(),
  );
  let setupComplete = false;
  try {
    await mkdir(sessionRoot, { mode: 0o700 });
    const sessionIdentity = await censusOwnedRoot(sessionRoot);
    const context = {
      kind: "mac-census-session",
      mode: binding.proofOnly ? "integration-proof" : "production",
      target: binding.target,
      source: binding.source,
      canonicalRoot: binding.canonicalRoot,
      image: "20260824.0482.1",
      phase,
      workMilliseconds,
      leaseMilliseconds: Math.max(1, Math.floor(deadline - performance.now())),
      wallEndMilliseconds: Math.floor(
        Date.now() + deadline - performance.now(),
      ),
      requestBudget,
      evidence: MAC_CENSUS_EVIDENCE.sha256,
      supervisorEvidence: MAC_CENSUS_SUPERVISOR_QUALIFICATION.sha256,
    };
    const raw = Buffer.from(canonical(context) + "\n");
    await writeFile(path.join(sessionRoot, "context.json"), raw, {
      flag: "wx",
      mode: 0o600,
    });
    assert(performance.now() < startupEnd, "CENSUS_DEADLINE");
    const env = {
      PATH: "/usr/bin:/bin",
      HOME: sessionRoot,
      TMPDIR: sessionRoot,
      RUNNER_TEMP: process.env.RUNNER_TEMP,
      ImageOS: "macos15",
      ImageVersion: "20260824.0482.1",
      RUNNER_ENVIRONMENT: "github-hosted",
      LC_ALL: "C",
      TZ: "UTC",
    };
    if (process.env.RUNNER_TRACKING_ID)
      env.RUNNER_TRACKING_ID = process.env.RUNNER_TRACKING_ID;
    const child = spawn(
      binding.python,
      [
        "-I",
        "-B",
        "-S",
        fileURLToPath(new URL("./cef-mac-process-census.py", import.meta.url)),
        "--census-worker",
        sessionRoot,
      ],
      { cwd: sessionRoot, env, shell: false, stdio: ["pipe", "pipe", "pipe"] },
    );
    const client = macCensusClient(child, {
      deadline,
      requestBudget,
      readyMilliseconds: Math.max(1, startupEnd - performance.now()),
      contextSha256: sha(raw),
      productionAdmitted: !binding.proofOnly,
    });
    binding.worker = child;
    let closed = false,
      closingPromise;
    const deny = (error) => {
      binding.failed ??= error;
      return binding.failed;
    };
    const session = {
      diagnostics: () => Object.freeze(client.diagnostics()),
      async snapshot(options = {}) {
        try {
          assert(
            !binding.failed &&
              !closed &&
              !options.signal?.aborted &&
              performance.now() < (options.deadline ?? deadline),
            "CENSUS_DEADLINE",
          );
          const value = await client.snapshot();
          binding.responses++;
          assert(
            performance.now() < (options.deadline ?? deadline) &&
              !options.signal?.aborted,
            "CENSUS_DEADLINE",
          );
          return compileMonitorRecord(value.rows, "NONE", {
            snapshotElapsedMs: Math.floor(value.roundtripMicros / 1000),
            snapshotRows: value.rows.length,
          });
        } catch (error) {
          const code = [
            "CENSUS_DEADLINE",
            "CENSUS_EOF",
            "CENSUS_OUTPUT_BOUND",
            "CENSUS_READY_DEADLINE",
          ].includes(error?.message)
            ? error.message
            : "UNKNOWN";
          throw deny(compileMonitorRecord(error, code));
        }
      },
      close(closeDeadline = deadline) {
        if (closingPromise) return closingPromise;
        closed = true;
        closingPromise = (async () => {
          let failure;
          try {
            const result = await client.close({ deadline: closeDeadline });
            if (result.joined) binding.joinedSessions++;
            if (result.failed)
              failure = binding.failed ?? new Error("CENSUS_FAILED");
            assert(performance.now() < closeDeadline, "CENSUS_DEADLINE");
            const current = await censusOwnedRoot(sessionRoot);
            assert(
              ["dev", "ino", "mode", "uid"].every(
                (k) => current[k] === sessionIdentity[k],
              ),
              "CENSUS_ROOT",
            );
            const parent = await censusOwnedRoot(binding.scratch);
            assert(
              ["dev", "ino", "mode", "uid"].every(
                (k) => parent[k] === binding.rootIdentity[k],
              ),
              "CENSUS_ROOT",
            );
            await unlink(path.join(sessionRoot, "context.json"));
            await rmdir(sessionRoot); // Empty, creation-owned session directory only.
            assert(performance.now() < closeDeadline, "CENSUS_DEADLINE");
          } catch (error) {
            failure ??= error;
          } finally {
            binding.active = false;
            binding.worker = null;
          }
          if (failure) throw deny(failure);
        })();
        return closingPromise;
      },
    };
    try {
      await client.ready;
      assert(performance.now() < startupEnd, "CENSUS_DEADLINE");
    } catch (error) {
      deny(error);
      try {
        await session.close();
      } catch {}
      throw error;
    }
    macCensusSessions.add(session);
    setupComplete = true;
    return session;
  } catch (error) {
    binding.failed ??= error;
    if (!setupComplete) binding.active = false;
    throw error;
  }
}
// Fixed proof-only failure injection. The handle was created by this factory;
// callers cannot provide a PID, signal, executable or alternative backend.
export function pauseMacCensusIntegrationWorker(factory) {
  const binding = macCensusFactories.get(factory);
  assert(
    binding?.proofOnly &&
      binding.active &&
      binding.worker?.exitCode === null &&
      binding.worker?.signalCode === null,
    "CENSUS_CAPABILITY",
  );
  assert(binding.worker.kill("SIGSTOP"), "CENSUS_PROOF_STOP");
}
export function macCensusIntegrationStatus(factory) {
  const binding = macCensusFactories.get(factory);
  assert(binding?.proofOnly, "CENSUS_PROOF_ONLY");
  return Object.freeze({
    sessions: binding.sessions,
    joinedSessions: binding.joinedSessions,
    responses: binding.responses,
    active: binding.active,
    poisoned: binding.failed !== null,
    workerJoined:
      binding.sessions > 0 &&
      binding.sessions === binding.joinedSessions &&
      !binding.active &&
      binding.worker === null,
  });
}
const CENSUS_FAILURE_CODES = new Set([
  "CENSUS_HOST",
  "CENSUS_IMAGE",
  "CENSUS_RUNNER",
  "CENSUS_PYTHON",
  "CENSUS_ROOT",
  "CENSUS_TOOL_PIN",
  "CENSUS_TOOL_CHANGED",
  "CENSUS_DEADLINE",
  "CENSUS_TOOL_BOUND",
  "CENSUS_OWNED_FILE",
  "CENSUS_ABI",
  "CENSUS_ROWS_BOUND",
  "CENSUS_ROWS_IDENTITY",
  "CENSUS_ROWS_EMPTY",
  "CENSUS_SYSCTL",
  "CENSUS_ROOT_NOT_EMPTY",
  "CENSUS_ORACLE_SOURCE",
  "CENSUS_COMPILE_GATE",
  "CENSUS_ORACLE_COMPILE",
  "CENSUS_ORACLE_EXEC",
  "CENSUS_REQUEST",
  "CENSUS_OUTPUT_BOUND",
  "CENSUS_ROLE",
  "CENSUS_ACTOR_FILE",
  "CENSUS_ARGUMENTS",
  "CENSUS_UNADMITTED",
  "CENSUS_FAILED",
]);
export function censusFailureCode(text) {
  try {
    assert(
      typeof text === "string" && Buffer.byteLength(text) <= 4096,
      "CENSUS_DIAGNOSTIC",
    );
    const value = JSON.parse(text);
    shape(
      value,
      value?.kind === "mac-census-native-failure"
        ? ["kind", "code", "mode", "productionAdmitted"]
        : ["kind", "code", "productionAdmitted"],
    );
    if (
      ((value.kind === "mac-census-proof-failure" &&
        value.productionAdmitted === false) ||
        (value.kind === "mac-census-native-failure" &&
          ["production", "integration-proof", "unavailable"].includes(
            value.mode,
          ) &&
          value.productionAdmitted === (value.mode === "production"))) &&
      CENSUS_FAILURE_CODES.has(value.code)
    )
      return value.code;
  } catch {
    /* Only a closed worker code is retained. */
  }
  return "CENSUS_UNAVAILABLE";
}
export function nativeCensusRows(value, request) {
  shape(value, ["request", "rows", "collectMicros"]);
  assert(value.request === request && positive(request), "CENSUS_REQUEST");
  assert(
    Number.isSafeInteger(value.collectMicros) &&
      value.collectMicros >= 0 &&
      value.collectMicros < 2_000_000,
    "CENSUS_DEADLINE",
  );
  assert(
    Array.isArray(value.rows) &&
      value.rows.length > 0 &&
      value.rows.length <= 32768,
    "CENSUS_ROWS_BOUND",
  );
  const seen = new Set();
  for (const row of value.rows) {
    shape(row, ["pid", "parent", "group", "start"]);
    assert(
      positive(row.pid) &&
        row.pid <= 2147483647 &&
        Number.isSafeInteger(row.parent) &&
        row.parent >= 0 &&
        row.parent <= 2147483647 &&
        Number.isSafeInteger(row.group) &&
        row.group >= 0 &&
        row.group <= 2147483647 &&
        typeof row.start === "string" &&
        /^darwin-v1:[1-9][0-9]{0,11}:(?:0|[1-9][0-9]{0,5})$/.test(row.start) &&
        !seen.has(row.pid),
      "CENSUS_ROWS_IDENTITY",
    );
    seen.add(row.pid);
  }
  return value.rows;
}

export function createMacCensusProofClient(child, { deadline } = {}) {
  assert(
    positive(child?.pid) &&
      typeof child.kill === "function" &&
      Number.isFinite(deadline) &&
      deadline > performance.now(),
    "CENSUS_PROOF_ONLY",
  );
  return macCensusClient(child, { deadline });
}
function macCensusClient(
  child,
  {
    deadline,
    requestBudget = 10000,
    readyMilliseconds = 45000,
    contextSha256,
    productionAdmitted = false,
  } = {},
) {
  const readyDeadline = Math.min(
    deadline,
    performance.now() + readyMilliseconds,
  );
  let buffer = Buffer.alloc(0),
    pending,
    request = 0,
    readyValue,
    firstError,
    failed = false,
    closing = false,
    joined = false,
    closedValue,
    readyTimer;
  let readyResolve, readyReject, closedResolve;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});
  const closed = new Promise((resolve) => {
    closedResolve = resolve;
  });
  const deny = (error) => {
    if (!failed) {
      failed = true;
      firstError = error;
    }
    clearTimeout(readyTimer);
    readyReject(firstError);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(firstError);
      pending = null;
    }
  };
  const frame = (line) => {
    try {
      const value = JSON.parse(line.toString("utf8"));
      if (!readyValue) {
        assert(performance.now() < readyDeadline, "CENSUS_READY_DEADLINE");
        shape(value, [
          "kind",
          "abi",
          contextSha256 ? "contextSha256" : "oracleSha256",
          "productionAdmitted",
        ]);
        assert(
          line.length <= 4096 &&
            value.kind ===
              (contextSha256
                ? "mac-census-native-ready"
                : "mac-census-proof-ready") &&
            value.productionAdmitted ===
              (contextSha256 ? productionAdmitted : false) &&
            (contextSha256
              ? value.contextSha256 === contextSha256 &&
                canonical(value.abi) === canonical(MAC_CENSUS_ABI)
              : /^[a-f0-9]{64}$/.test(value.oracleSha256)),
          "CENSUS_READY",
        );
        assert(
          value.abi &&
            typeof value.abi === "object" &&
            !Array.isArray(value.abi),
          "CENSUS_ABI",
        );
        clearTimeout(readyTimer);
        readyValue = value;
        readyResolve(value);
        return;
      }
      assert(pending && !failed, "CENSUS_UNSOLICITED");
      const rows = nativeCensusRows(value, pending.id);
      assert(performance.now() < pending.end, "CENSUS_DEADLINE");
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      current.resolve({
        rows,
        collectMicros: value.collectMicros,
        roundtripMicros: Math.max(
          0,
          Math.floor((performance.now() - current.begin) * 1000),
        ),
      });
    } catch (error) {
      deny(error);
    }
  };
  child.stdout.on("data", (chunk) => {
    if (failed) return;
    if (buffer.length + chunk.length > 4 * 1024 ** 2) {
      deny(new Error("CENSUS_OUTPUT_BOUND"));
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const index = buffer.indexOf(10);
      if (index < 0) break;
      const line = buffer.subarray(0, index);
      buffer = buffer.subarray(index + 1);
      frame(line);
      if (failed) break;
    }
  });
  child.stdout.on("error", (error) => deny(error));
  child.stdin.on("error", (error) => deny(error));
  let stderrBytes = 0;
  const stderrChunks = [];
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= 4096) stderrChunks.push(chunk);
    if (stderrBytes > 4096) deny(new Error("CENSUS_STDERR_BOUND"));
  });
  child.stderr.on("error", (error) => deny(error));
  child.once("error", (error) => deny(error));
  child.once("close", (code, signal) => {
    joined = true;
    closedValue = { code, signal };
    closedResolve(closedValue);
    clearTimeout(readyTimer);
    if (!closing || pending || buffer.length) deny(new Error("CENSUS_EOF"));
  });
  readyTimer = setTimeout(
    () => deny(new Error("CENSUS_READY_DEADLINE")),
    Math.max(1, readyDeadline - performance.now()),
  );
  return {
    ready,
    diagnostics: () => ({
      code: censusFailureCode(Buffer.concat(stderrChunks).toString("utf8")),
      stderrBytes,
      joined,
      exitCode:
        Number.isInteger(closedValue?.code) &&
        closedValue.code >= -255 &&
        closedValue.code <= 255
          ? closedValue.code
          : null,
    }),
    abort: (error = new Error("CENSUS_ABORT")) => deny(error),
    async snapshot() {
      await ready;
      if (failed) throw firstError;
      assert(!pending && !closing && !joined, "CENSUS_REQUEST");
      assert(request < requestBudget, "CENSUS_REQUEST_BOUND");
      const begin = performance.now(),
        end = Math.min(begin + 2000, deadline);
      assert(end > begin, "CENSUS_DEADLINE");
      return new Promise((resolve, reject) => {
        const id = ++request;
        pending = {
          id,
          begin,
          end,
          resolve,
          reject,
          timer: setTimeout(
            () => deny(new Error("CENSUS_DEADLINE")),
            Math.max(1, Math.floor(end - begin)),
          ),
        };
        try {
          child.stdin.write(JSON.stringify({ request: id }) + "\n", (error) => {
            if (error) deny(error);
          });
        } catch (error) {
          deny(error);
        }
      });
    },
    async close({ deadline: joinDeadline = deadline } = {}) {
      closing = true;
      if (pending) deny(new Error("CENSUS_ABORT"));
      if (!joined) {
        if (failed) child.kill("SIGKILL");
        else child.stdin.end();
      }
      const end = Math.min(
        deadline,
        joinDeadline,
        performance.now() + COMPILE_CLEANUP_MS,
      );
      const timer = setTimeout(
        () => {
          if (!joined) child.kill("SIGKILL");
        },
        Math.max(1, Math.min(1000, end - performance.now() - 100)),
      );
      try {
        const result = await compileWithin(() => closed, end);
        assert(joined && (failed || result.code === 0), "CENSUS_JOIN");
        return {
          joined: true,
          code: result.code,
          failed,
          requests: request,
          stderrBytes,
        };
      } finally {
        clearTimeout(timer);
        if (!joined) {
          child.kill("SIGKILL");
          child.stdout.destroy();
          child.stderr.destroy();
          child.stdin.destroy();
          child.unref();
        }
      }
    },
  };
}
async function processSnapshot({
  deadline = performance.now() + 2000,
  signal,
  probeJoins,
  censusSession,
} = {}) {
  if (censusSession !== undefined) {
    assert(macCensusSessions.has(censusSession), "CENSUS_CAPABILITY");
    return censusSession.snapshot({ deadline, signal });
  }
  compileMonitorGuard(
    !signal?.aborted && performance.now() < deadline,
    "Ownership snapshot deadline",
    signal?.aborted ? "PS_ABORT" : "PS_DEADLINE",
  );
  const began = performance.now();
  return new Promise((resolve, reject) => {
    const ps = spawn("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
      shell: false,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let probeClosed;
    const closeWitness = new Promise((resolve) => {
      probeClosed = resolve;
    });
    probeJoins?.add(closeWitness);
    ps.once("close", () => {
      probeClosed();
      probeJoins?.delete(closeWitness);
    });
    let text = "",
      failure = null,
      settled = false,
      exitCode = null;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const facts = {
        snapshotElapsedMs: Math.max(0, Math.floor(performance.now() - began)),
        snapshotChars: text.length,
        snapshotExitCode: exitCode,
      };
      if (error) reject(compileMonitorRecord(error, "UNKNOWN", facts));
      else {
        compileMonitorRecord(value, "NONE", {
          ...facts,
          snapshotRows: value.length,
        });
        resolve(value);
      }
    };
    const abort = () => {
      const error =
        failure ??
        compileMonitorRecord(
          new Error("Ownership snapshot deadline"),
          signal?.aborted ? "PS_ABORT" : "PS_DEADLINE",
        );
      try {
        ps.kill("SIGKILL");
      } catch {}
      ps.stdout.destroy();
      ps.unref();
      settle(error);
    };
    const timer = setTimeout(
      abort,
      Math.max(1, Math.floor(Math.min(2000, deadline - performance.now()))),
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    ps.stdout.on("data", (data) => {
      text += data;
      if (text.length > 4 * 1024 ** 2) {
        failure = compileMonitorRecord(
          new Error("Ownership snapshot failed"),
          "PS_STDOUT_BOUND",
        );
        abort();
      }
    });
    ps.stdout.on("error", (error) => {
      failure = compileMonitorRecord(error, "PS_STDOUT_READ");
      abort();
    });
    ps.once("error", (error) =>
      settle(compileMonitorRecord(error, "PS_SPAWN")),
    );
    ps.once("close", (code) => {
      if (settled) return;
      exitCode = code;
      try {
        compileMonitorGuard(
          code === 0,
          "Ownership snapshot failed",
          "PS_EXIT_NONZERO",
        );
        settle(null, processRows(text));
      } catch (error) {
        settle(error);
      }
    });
  });
}

export function observedLineage(rows, owned) {
  compileMonitorGuard(
    owned.length > 0 && owned.length <= 4096,
    "Bounded original root identity required",
    "OWN_SEED_BOUND",
    { priorOwnedCount: owned.length },
  );
  const root = owned[0];
  const current = new Map(rows.map((row) => [row.pid, row]));
  const found = new Map(owned.map((row) => [row.pid, { ...row }]));
  const replaced = new Set();
  for (const record of owned) {
    const row = current.get(record.pid);
    if (row && row.start !== record.start) {
      compileMonitorGuard(
        record.pid !== root.pid,
        "Owned root PID identity changed",
        "OWN_ROOT_REPLACED",
        { priorOwnedCount: owned.length },
      );
      // It is no longer our observed process. Do not adopt or signal the new
      // occupant, even if its current parent happens to be in our cohort.
      found.delete(record.pid);
      replaced.add(record.pid);
    }
  }
  // Discover before retiring absent ancestors: a non-atomic ps snapshot may
  // still report their children. Already observed detached children retain
  // their own exact identity even after reparenting. This is observed lineage,
  // never a universal fork/daemon tracking guarantee.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (
        !replaced.has(row.pid) &&
        !found.has(row.pid) &&
        found.has(row.parent)
      ) {
        found.set(row.pid, { pid: row.pid, start: row.start });
        changed = true;
      }
  }
  const active = [...found.values()].filter(
    (record) =>
      record.pid === root.pid ||
      current.get(record.pid)?.start === record.start,
  );
  compileMonitorGuard(
    active.length <= 4096,
    "Observed active descendant bound",
    "OWN_ACTIVE_BOUND",
    { priorOwnedCount: owned.length, nextOwnedCount: active.length },
  );
  return active;
}
export function sameObservedCohort(left, right) {
  const key = (rows) =>
    canonical(
      rows
        .map(({ pid, start }) => ({ pid, start }))
        .sort((a, b) => a.pid - b.pid),
    );
  return key(left) === key(right);
}
export async function observedQuiet(records, group, options = {}) {
  const native = records.some(
    (row) =>
      typeof row.start === "string" && row.start.startsWith("darwin-v1:"),
  );
  if (native) {
    assert(
      records.every((row) =>
        /^darwin-v1:[1-9][0-9]{0,11}:(?:0|[1-9][0-9]{0,5})$/.test(row.start),
      ),
      "CENSUS_MIXED_IDENTITY",
    );
    if (options.censusSession === undefined) {
      const factory = macCensusFactories.get(options.censusFactory);
      assert(factory, "CENSUS_CAPABILITY");
      const deadline = Math.min(
        options.deadline ?? performance.now() + COMPILE_CLEANUP_MS,
        factory.deadline,
      );
      const session = await openCensusSession(options.censusFactory, {
        deadline,
        workMilliseconds: Math.max(
          1,
          Math.min(
            LIMITS.maxCompileMs,
            Math.floor(deadline - performance.now()),
          ),
        ),
        phase: "readonly",
      });
      try {
        return await observedQuiet(records, group, {
          ...options,
          deadline,
          censusSession: session,
        });
      } finally {
        await session.close();
      }
    }
  } else
    assert(
      options.censusSession === undefined &&
        options.censusFactory === undefined,
      "CENSUS_MIXED_IDENTITY",
    );
  const rows = await processSnapshot(options);
  // A reused foreign PID is never signalled and is not our old process.
  if (
    records.some((record) =>
      rows.some((row) => row.pid === record.pid && row.start === record.start),
    )
  )
    return false;
  return groupQuiet(group, options);
}
async function stopObserved(
  child,
  initial,
  { deadline = performance.now() + 10000, probeJoins, censusSession } = {},
) {
  let owned = initial,
    stable = false;
  // Freeze the observed lineage before killing it, including children that
  // created separate process groups. No global executable-name selection.
  for (let round = 0; round < 8; round++) {
    assert(performance.now() < deadline, "Owned freeze deadline");
    const rows = await processSnapshot({ deadline, probeJoins, censusSession });
    const next = observedLineage(rows, owned);
    for (const record of next) {
      const current = rows.find((row) => row.pid === record.pid);
      if (!current) continue;
      assert(current.start === record.start, "Ambiguous owned process");
      try {
        process.kill(record.pid, "SIGSTOP");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (round > 0 && sameObservedCohort(next, owned)) {
      owned = next;
      stable = true;
      break;
    }
    owned = next;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(stable, "Observed lineage did not stabilize");
  const snapshot = await processSnapshot({
    deadline,
    probeJoins,
    censusSession,
  });
  for (const record of [...owned].reverse()) {
    const current = snapshot.find((row) => row.pid === record.pid);
    if (!current) continue;
    assert(current.start === record.start, "Owned PID replaced before reap");
    try {
      process.kill(record.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  // Never send a group kill after its leader exited: a reused group could
  // belong to someone else. Remaining group peers make the proof fail closed.
  for (let i = 0; i < 50; i++) {
    if (
      await observedQuiet(owned, child.pid, {
        deadline,
        probeJoins,
        censusSession,
      })
    )
      return owned;
    assert(performance.now() < deadline, "Owned reap deadline");
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(1, Math.ceil((deadline - performance.now()) / (50 - i))),
      ),
    );
  }
  throw new Error("Observed descendants not reaped; checkpoint denied");
}
// Only a result produced by this live process may authorize output mutation.
// Decoded checkpoint manifests retain the existing six-key portable shape.
export function sisoLoggerIdentity(host, username) {
  for (const value of [host, username])
    assert(
      typeof value === "string" &&
        value.length > 0 &&
        Buffer.byteLength(value) <= 1024 &&
        !/[\x00-\x1f\x7f/\\]/.test(value) &&
        !/[\uD800-\uDFFF]/u.test(value),
      "Bounded Siso OS identity required",
    );
  const shortHost = host.split(".", 1)[0];
  assert(shortHost.length > 0, "Bounded Siso OS identity required");
  const user = Array.from(username, (character) =>
    /^[A-Za-z0-9]$/.test(character) ? character : "_",
  ).join("");
  const prefix = `siso.${shortHost}.${user}.log.INFO.`;
  return Object.freeze({
    prefix,
    hostBytes: Buffer.byteLength(host),
    userBytes: Buffer.byteLength(username),
    hostWasShortened: host !== shortHost,
    userWasSanitized: username !== user,
  });
}
const liveCompileSlices = new WeakMap();
const COMPILE_CLEANUP_MS = 30000;
async function compileWithin(operation, deadline) {
  const remaining = Math.floor(deadline - performance.now());
  assert(
    remaining > 0,
    "Compile supervision cleanup deadline; checkpoint denied",
  );
  let alarm;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        assert(
          performance.now() < deadline,
          "Compile supervision cleanup deadline; checkpoint denied",
        );
        return operation();
      }),
      new Promise((_, reject) => {
        alarm = setTimeout(
          () =>
            reject(
              new Error(
                "Compile supervision cleanup deadline; checkpoint denied",
              ),
            ),
          remaining,
        );
      }),
    ]);
  } finally {
    clearTimeout(alarm);
  }
}
export async function compileSlice(
  executable,
  args,
  {
    cwd,
    env,
    logs,
    out,
    milliseconds = LIMITS.compileMs,
    outputLedger,
    observeRoot,
    stopSignal,
    censusFactory,
  },
) {
  if (stopSignal?.aborted) throw stopSignal.reason;
  const censusBinding =
    censusFactory === undefined ? null : macCensusFactories.get(censusFactory);
  assert(censusFactory === undefined || censusBinding, "CENSUS_CAPABILITY");
  assert(!censusBinding?.proofOnly || out === undefined, "CENSUS_PROOF_ONLY");
  assert(
    process.platform !== "win32" &&
      positive(milliseconds) &&
      milliseconds <= LIMITS.maxCompileMs,
    "Bounded Unix engineering slice only",
  );
  assert(
    outputLedger === undefined ||
      (outputLedger &&
        Object.getPrototypeOf(outputLedger) === Object.prototype &&
        Object.keys(outputLedger).length === 2 &&
        Object.hasOwn(outputLedger, "bytes") &&
        Object.hasOwn(outputLedger, "cap") &&
        outputLedger.cap === 64 * 1024 ** 2 &&
        Number.isSafeInteger(outputLedger.bytes) &&
        outputLedger.bytes >= 0 &&
        outputLedger.bytes <= outputLedger.cap),
    "Fixed shared output ledger required",
  );
  assert(
    observeRoot === undefined || typeof observeRoot === "function",
    "Owned root observer required",
  );
  for (const key of Object.keys(env))
    assert(
      !/^(GH_|GITHUB_|ACTIONS_)/i.test(key),
      "Compiler credential environment denied",
    );
  const canonicalOut = out === undefined ? null : await noLinks(out);
  const outIdentity = canonicalOut
    ? await lstat(canonicalOut, { bigint: true })
    : null;
  assert(
    !outIdentity || outIdentity.isDirectory(),
    "Compile output directory required",
  );
  const owner = userInfo();
  assert(
    Number.isSafeInteger(owner.uid) && owner.uid >= 0,
    "Bounded Siso OS identity required",
  );
  const loggerIdentity = sisoLoggerIdentity(hostname(), owner.username);
  const beginWallMs = Date.now(),
    workDeadline = performance.now() + milliseconds;
  let firstError,
    hasFailure = false,
    failureStage = "none",
    firstFailure = null,
    monitorFailure = null,
    lastSnapshot = null,
    snapshotOrdinal = 0,
    snapshotPending = true,
    monitorSettled = false,
    monitorResult = "unconfirmed",
    unsafeNaturalExit = false,
    timedOut = false,
    monitoring = true,
    observed = [],
    timer;
  let wakeStop;
  const stopRequested = new Promise((resolve) => {
    wakeStop = resolve;
  });
  const fail = (error, stage = "supervisor") => {
    if (!hasFailure) {
      hasFailure = true;
      firstError = error;
      failureStage = stage;
      firstFailure = {
        ...compileFailureObservation(error),
        snapshotOrdinal: snapshotOrdinal + (snapshotPending ? 1 : 0),
        lastSnapshot,
      };
      if (stage === "monitor" || stage === "initial-snapshot")
        monitorFailure = {
          ...compileMonitorDetails(error),
          snapshotOrdinal: snapshotOrdinal + (snapshotPending ? 1 : 0),
          lastSnapshot,
        };
    }
    wakeStop();
  };
  const observer = new AbortController();
  const cancelled = () => fail(stopSignal.reason, "cancel");
  stopSignal?.addEventListener("abort", cancelled, { once: true });
  if (stopSignal?.aborted) cancelled();
  const probeJoins = new Set();
  const ownedObserverAbort =
    observeRoot === undefined ? null : new AbortController();
  let ownedObserver = null;
  const streams = [],
    outputGates = [],
    outputCompletions = [],
    outputCloses = [];
  const registerOutput = (stream) => {
    // Install both witnesses synchronously, before any pipe can write. Error
    // settlement is distinct from the creation-owned stream's physical close.
    outputCloses.push(new Promise((resolve) => stream.once("close", resolve)));
    const completion = finished(stream);
    completion.catch((error) => fail(error, "writer"));
    outputCompletions.push(completion);
    return stream;
  };
  let stdout, stderr, child, censusSession;
  try {
    if (hasFailure) throw firstError;
    if (censusBinding) {
      assert(
        workDeadline + COMPILE_CLEANUP_MS <= censusBinding.deadline,
        "CENSUS_DEADLINE",
      );
      censusSession = await openCensusSession(censusFactory, {
        deadline: Math.min(
          censusBinding.deadline,
          workDeadline + COMPILE_CLEANUP_MS,
        ),
        workMilliseconds: milliseconds,
        phase: "compile",
        startupDeadline: workDeadline,
      });
      assert(
        performance.now() < workDeadline && !stopSignal?.aborted,
        "CENSUS_DEADLINE",
      );
    }
    for (const name of ["stdout", "stderr"]) {
      const stream = registerOutput(
        createWriteStream(path.join(logs, `checkpoint-compile.${name}.log`), {
          flags: "wx",
        }),
      );
      stream.on("error", (error) => fail(error, "writer"));
      streams.push(stream);
      if (outputLedger !== undefined) {
        const gate = registerOutput(
          new Transform({
            transform(chunk, encoding, done) {
              try {
                assert(
                  outputLedger.cap === 64 * 1024 ** 2 &&
                    Number.isSafeInteger(outputLedger.bytes) &&
                    outputLedger.bytes >= 0 &&
                    chunk.length <= outputLedger.cap - outputLedger.bytes,
                  "Shared compile output bound",
                );
                outputLedger.bytes += chunk.length; // Precharge before forwarding; never refund.
                done(null, chunk);
              } catch (error) {
                fail(error, "output-bound");
                done(error);
              }
            },
          }),
        );
        gate.on("error", (error) => fail(error, "writer"));
        outputGates.push(gate);
      }
    }
    [stdout, stderr] = streams;
    if (hasFailure) throw firstError;
    if (censusBinding)
      assert(
        performance.now() < workDeadline && !stopSignal?.aborted,
        "CENSUS_DEADLINE",
      );
    child = spawn(executable, args, {
      cwd,
      env: { ...env, TZ: "UTC" },
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stopSignal?.removeEventListener("abort", cancelled);
    for (const stream of [...streams, ...outputGates]) stream.destroy();
    if (censusSession)
      try {
        await censusSession.close();
      } catch {
        /* Preserve startup/spawn failure. */
      }
    throw hasFailure ? firstError : error;
  }
  const outputFinished = Promise.all(outputCompletions);
  const outputSettlement = Promise.allSettled(outputCompletions);
  const outputClosure = Promise.all(outputCloses);
  outputFinished.catch((error) => fail(error, "writer"));
  let rootExited = false,
    pipeClosed = false,
    code = null;
  const rootExit = new Promise((resolve) =>
    child.once("exit", (value) => {
      rootExited = true;
      code = value;
      resolve();
    }),
  );
  const closed = new Promise((resolve) =>
    child.once("close", (value) => {
      rootExited = true;
      pipeClosed = true;
      code = value;
      resolve();
    }),
  );
  child.once("error", (error) => fail(error, "spawn"));
  child.stdout.on("error", (error) => fail(error, "reader"));
  child.stderr.on("error", (error) => fail(error, "reader"));
  if (outputLedger === undefined) {
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
  } else {
    child.stdout.pipe(outputGates[0]).pipe(stdout);
    child.stderr.pipe(outputGates[1]).pipe(stderr);
  }
  const snapshotSeen = (rows) => {
    snapshotPending = false;
    lastSnapshot = {
      ...compileMonitorDetails(rows),
      snapshotOrdinal: ++snapshotOrdinal,
      snapshotRows: rows.length,
    };
  };
  const initial = processSnapshot({
    deadline: workDeadline + COMPILE_CLEANUP_MS,
    signal: observer.signal,
    probeJoins,
    censusSession,
  }).then((rows) => {
    snapshotSeen(rows);
    const root = rows.find((row) => row.pid === child.pid);
    assert(
      root && root.parent === process.pid,
      "Exact live child ownership required",
    );
    observed = observedLineage(rows, [{ pid: root.pid, start: root.start }]);
    if (observeRoot !== undefined) {
      assert(
        !ownedObserverAbort.signal.aborted,
        "Owned root observation expired",
      );
      // Register independently of the monitor loop; this promise has a rejection
      // owner immediately and is joined only under the original cleanup end.
      ownedObserver = Promise.resolve().then(() =>
        observeRoot(
          Object.freeze({
            pid: root.pid,
            parent: root.parent,
            start: root.start,
          }),
          Object.freeze({
            signal: ownedObserverAbort.signal,
            rootExited: () => rootExited,
          }),
        ),
      );
      ownedObserver.catch((error) => fail(error, "observer"));
    }
  });
  initial.catch((error) => fail(error, "initial-snapshot"));
  const monitor = (async () => {
    await initial;
    for (let turn = 0; monitoring && !rootExited; turn++) {
      compileMonitorGuard(
        turn < Math.ceil(milliseconds / 250) + 8,
        "Ownership observation bound",
        "OWN_MONITOR_TURN_BOUND",
      );
      await new Promise((resolve) => {
        const tick = setTimeout(done, 250);
        function done() {
          clearTimeout(tick);
          observer.signal.removeEventListener("abort", done);
          resolve();
        }
        observer.signal.addEventListener("abort", done, { once: true });
        if (observer.signal.aborted) done();
      });
      if (!monitoring) break;
      snapshotPending = true;
      const rows = await processSnapshot({
        deadline: workDeadline + COMPILE_CLEANUP_MS,
        signal: observer.signal,
        probeJoins,
        censusSession,
      });
      snapshotSeen(rows);
      observed = observedLineage(rows, observed);
    }
  })();
  monitor.then(
    () => {
      monitorSettled = true;
      monitorResult = "resolved";
    },
    (error) => {
      monitorSettled = true;
      monitorResult = "rejected";
      if (monitoring) fail(error, "monitor");
    },
  );
  timer = setTimeout(
    () => {
      timedOut = true;
      wakeStop();
    },
    Math.max(1, Math.floor(workDeadline - performance.now())),
  );
  let cleanupDeadline,
    quiet = false,
    monitorJoined = false,
    probesJoined = false,
    outputsJoined = false,
    outputsSettled = false,
    outputHandlesClosed = false;
  const joinOutputHandles = async () => {
    if (!outputsJoined)
      for (const stream of [...streams, ...outputGates]) stream.destroy();
    // Never create a cleanup lease here, including on startup failure.
    if (cleanupDeadline === undefined) return;
    try {
      await compileWithin(() => outputSettlement, cleanupDeadline);
      assert(performance.now() < cleanupDeadline, "Output settlement deadline");
      outputsSettled = true;
      await compileWithin(() => outputClosure, cleanupDeadline);
      assert(performance.now() < cleanupDeadline, "Output close deadline");
      outputHandlesClosed = true;
    } catch (error) {
      fail(error, "output-close");
    }
  };
  try {
    // Exit, not close: descendants can retain inherited pipes after root exit.
    await Promise.race([rootExit, closed, stopRequested]);
    cleanupDeadline = Math.min(
      performance.now() + COMPILE_CLEANUP_MS,
      workDeadline + COMPILE_CLEANUP_MS,
    );
    clearTimeout(timer);
    monitoring = false;
    ownedObserverAbort?.abort();
    // Let an in-flight fixed ps operation close within its own2s bound;
    // cancelling it without a close witness would deny otherwise clean output.
    try {
      const outcome = await compileWithin(
        () =>
          monitor.then(
            () => ({ passed: true }),
            (error) => ({ passed: false, error }),
          ),
        cleanupDeadline,
      );
      monitorJoined = true;
      if (!outcome.passed) fail(outcome.error, "monitor-join");
    } catch (error) {
      fail(error, "monitor-join");
    }
    if (!hasFailure && !timedOut) {
      try {
        quiet = await compileWithin(
          () =>
            observedQuiet(observed, child.pid, {
              deadline: cleanupDeadline,
              probeJoins,
              censusSession,
            }),
          cleanupDeadline,
        );
      } catch (error) {
        fail(error);
      }
      if (!quiet && !hasFailure) {
        unsafeNaturalExit = true;
        fail(
          new Error(
            "Observed descendants survived compiler exit; checkpoint denied",
          ),
        );
      }
    }
    if (!quiet) {
      try {
        assert(
          observed.length > 0,
          "Unconfirmed compiler ownership; checkpoint denied",
        );
        observed = await compileWithin(
          () =>
            stopObserved(child, observed, {
              deadline: cleanupDeadline,
              probeJoins,
              censusSession,
            }),
          cleanupDeadline,
        );
        quiet = await compileWithin(
          () =>
            observedQuiet(observed, child.pid, {
              deadline: cleanupDeadline,
              probeJoins,
              censusSession,
            }),
          cleanupDeadline,
        );
        assert(quiet, "Observed descendants not reaped; checkpoint denied");
      } catch (error) {
        fail(error, "reap");
      }
    }
    // A creation-owned live root can be stopped independently, but this is
    // never cohort/quiescence proof and never enables checkpoint admission.
    if (
      !quiet &&
      !rootExited &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      try {
        child.kill("SIGKILL");
      } catch (error) {
        fail(error);
      }
    }
    try {
      await compileWithin(() => closed, cleanupDeadline);
    } catch (error) {
      fail(error, "stdio-close");
    }
    if (pipeClosed && outputLedger === undefined) {
      stdout.end();
      stderr.end();
    }
    try {
      await compileWithin(() => outputFinished, cleanupDeadline);
      outputsJoined = true;
    } catch (error) {
      fail(error, "writer-join");
    }
    await joinOutputHandles();
    if (ownedObserver !== null) {
      try {
        await compileWithin(() => ownedObserver, cleanupDeadline);
      } catch (error) {
        fail(error, "observer-join");
      }
    }
    try {
      await compileWithin(() => Promise.all([...probeJoins]), cleanupDeadline);
      if (censusSession)
        await compileWithin(
          () => censusSession.close(cleanupDeadline),
          cleanupDeadline,
        );
      probesJoined = true;
    } catch (error) {
      fail(error, "probe-join");
    }
    if (
      hasFailure &&
      quiet &&
      monitorJoined &&
      probesJoined &&
      outputsJoined &&
      rootExited &&
      pipeClosed
    ) {
      // Preserve the existing unusable natural-exit receipt after confirmed
      // cleanup. Failure to persist it must not replace the primary error.
      try {
        await compileWithin(
          () =>
            writeFile(
              path.join(logs, "checkpoint-compile.outcome.json"),
              canonical({
                outcome: unsafeNaturalExit
                  ? "unsafe-natural-exit-descendants"
                  : "supervision-failed",
                exitCode: code,
                ownTimerExpired: timedOut,
                checkpointAllowed: false,
              }) + "\n",
              { flag: "wx" },
            ),
          cleanupDeadline,
        );
      } catch (error) {
        fail(error, "failure-receipt");
      }
    }
    assert(
      !hasFailure &&
        quiet &&
        monitorJoined &&
        probesJoined &&
        outputsJoined &&
        outputsSettled &&
        outputHandlesClosed &&
        rootExited &&
        pipeClosed,
      "Compile cleanup unconfirmed; checkpoint denied",
    );
    const outcome = timedOut
      ? "slice-ended"
      : code === 0
        ? "compiler-complete"
        : "compiler-failed";
    await compileWithin(
      () =>
        writeFile(
          path.join(logs, "checkpoint-compile.outcome.json"),
          canonical({
            outcome,
            exitCode: code,
            ownTimerExpired: timedOut,
            observedProcesses: observed.length,
            quiescence: "observed-lineage-and-root-group",
          }) + "\n",
          { flag: "wx" },
        ),
      cleanupDeadline,
    );
    const result = {
      outcome,
      exitCode: code,
      quiescent: true,
      groupId: child.pid,
      quiescence: "observed-lineage-and-root-group",
      observed,
    };
    if (!censusBinding?.proofOnly)
      liveCompileSlices.set(result, {
        loggerIdentity,
        uid: BigInt(owner.uid),
        beginWallMs,
        endWallMs: Date.now(),
        groupId: child.pid,
        canonicalOut,
        outIdentity,
        observed: observed.map(({ pid, start }) => ({ pid, start })),
        censusFactory,
      });
    return result;
  } catch (error) {
    fail(error);
    throw firstError;
  } finally {
    stopSignal?.removeEventListener("abort", cancelled);
    clearTimeout(timer);
    monitoring = false;
    observer.abort();
    ownedObserverAbort?.abort();
    // Never wait again with a new deadline or signal a possibly reused group.
    if (!outputsJoined) {
      child.stdout.destroy();
      child.stderr.destroy();
      for (const stream of [...streams, ...outputGates]) stream.destroy();
    }
    if (!outputsSettled || !outputHandlesClosed) await joinOutputHandles();
    if (!pipeClosed) child.unref();
    checkpointLog(
      console.error,
      `[cef-engineering-checkpoint] compile-supervision=${canonical({
        phase: hasFailure ? "denied" : "complete",
        ownTimerExpired: timedOut,
        rootExited,
        pipeClosed,
        monitorJoined,
        probesJoined,
        monitorSettled,
        monitorResult,
        firstFailure,
        census: censusSession?.diagnostics() ?? null,
        monitorFailure,
        outputsJoined,
        outputsSettled,
        outputHandlesClosed,
        cohortQuiet: quiet,
        observedProcesses: observed.length,
        cleanupElapsedMs:
          cleanupDeadline === undefined
            ? 0
            : Math.max(
                0,
                Math.floor(
                  performance.now() - (cleanupDeadline - COMPILE_CLEANUP_MS),
                ),
              ),
        failure: hasFailure ? "UNCONFIRMED" : "NONE",
        failureStage,
      })}`,
    );
    // All asynchronous branches have rejection owners; forced stream closure
    // is NOT process cleanup or a successful compile receipt.
    monitor.catch(() => {});
    initial.catch(() => {});
    outputFinished.catch(() => {});
    ownedObserver?.catch(() => {});
  }
}

const uploadObservers = new WeakSet();
const UPLOAD_STAGES = new Set([
  "upload",
  "state-read",
  "state-validation",
  "bundle-validation",
  "credential",
  "api-admission",
  "repository",
  "workflow",
  "run",
  "source-commit",
  "source-tree",
  "producer-validation",
  "code-validation",
  "quiescence",
  "asset-verification",
  "manifest-generation",
  "draft-create",
  "chunk-upload",
  "inventory-upload",
  "manifest-upload",
  "sdk-upload",
  "response-validation",
  "seal-write",
]);
const UPLOAD_CODES = new Map([
  ["Scoped GitHub credential required", "CREDENTIAL"],
  ["Closed same-repository checkpoint endpoint required", "ENDPOINT"],
  ["Restore API is GET-only", "METHOD"],
  ["Checkpoint transport deadline", "DEADLINE"],
  ["Bounded upload content length required", "CONTENT_BOUND"],
  ["Foreign API route denied", "ENDPOINT"],
  ["Checkpoint GitHub operation failed", "HTTP"],
  ["Foreign checkpoint repository", "REPOSITORY"],
  ["Untrusted producer run", "PRODUCER"],
  ["Producer commit tree", "COMMIT"],
  ["Producer code differs from sealed checkpoint", "CODE_DIGEST"],
  ["Current producer mismatch", "PRODUCER"],
  ["Current SDK producer mismatch", "PRODUCER"],
  ["Compiler group no longer quiescent", "QUIESCENCE"],
  ["SDK compiler no longer quiescent", "QUIESCENCE"],
  ["Changed upload asset", "ASSET_CHANGED"],
  ["SDK upload bytes changed", "ASSET_CHANGED"],
  ["Manifest bound", "MANIFEST_BOUND"],
  ["Unexpected checkpoint draft", "DRAFT"],
  ["Unexpected SDK transport draft", "DRAFT"],
  ["Uploaded checkpoint asset mismatch", "ASSET_RESPONSE"],
  ["SDK uploaded asset mismatch", "ASSET_RESPONSE"],
  ["Foreign SDK state", "STATE"],
  ["Foreign checkpoint state", "STATE"],
  ["Unknown engineering state", "STATE"],
  ["Seal size bound", "SEAL_BOUND"],
  ["SDK seal size bound", "SEAL_BOUND"],
]);
const UPLOAD_ERROR_CODES = new Set([
  ...UPLOAD_CODES.values(),
  "NONE",
  "UNAVAILABLE",
  "JSON",
  "ENOENT",
  "EACCES",
  "EPERM",
  "EIO",
  "ENOSPC",
]);
export function createUploadObserver(sink = () => {}) {
  if (uploadObservers.has(sink)) return sink;
  let count = 0,
    bytes = 0;
  const observe = (input) => {
    // Build a new closed value; never forward provider objects or exception text.
    try {
      const record = Object.freeze({
        kind: "sorng-cef-checkpoint-upload-diagnostic",
        stage: UPLOAD_STAGES.has(input?.stage) ? input.stage : "upload",
        event: ["begin", "complete", "failed", "response"].includes(
          input?.event,
        )
          ? input.event
          : "failed",
        errorCode: UPLOAD_ERROR_CODES.has(input?.errorCode)
          ? input.errorCode
          : "UNAVAILABLE",
        httpStatus:
          Number.isInteger(input?.httpStatus) &&
          input.httpStatus >= 100 &&
          input.httpStatus <= 599
            ? input.httpStatus
            : null,
      });
      const size = Buffer.byteLength(canonical(record) + "\n");
      const terminal =
        record.event === "failed" ||
        (record.stage === "upload" && record.event === "complete");
      // Reserve the final slot for a late primary failure or final outcome.
      if (
        count >= 128 ||
        (count >= 127 && !terminal) ||
        bytes + size > 64 * 1024
      )
        return;
      count++;
      bytes += size;
      checkpointLog(sink, record);
    } catch {
      /* Diagnostics cannot affect the primary operation. */
    }
  };
  uploadObservers.add(observe);
  return observe;
}
export async function uploadPhase(
  observer,
  stage,
  operation,
  responseFacts = null,
) {
  const observe = createUploadObserver(observer);
  observe({ stage, event: "begin", errorCode: "NONE" });
  try {
    const value = await operation();
    observe({ stage, event: "complete", errorCode: "NONE" });
    return value;
  } catch (error) {
    let code = "UNAVAILABLE";
    try {
      code =
        UPLOAD_CODES.get(error?.message) ??
        (error instanceof SyntaxError
          ? "JSON"
          : UPLOAD_ERROR_CODES.has(error?.code)
            ? error.code
            : "UNAVAILABLE");
    } catch {}
    let httpStatus = null;
    try {
      httpStatus = responseFacts?.httpStatus;
    } catch {}
    observe({ stage, event: "failed", errorCode: code, httpStatus });
    throw error;
  }
}
function uploadApiStage(route, upload) {
  if (route === "") return "repository";
  if (route === "releases") return "draft-create";
  if (/^actions\/workflows\//.test(route)) return "workflow";
  if (/^actions\/runs\//.test(route)) return "run";
  if (/^git\/commits\//.test(route)) return "source-commit";
  if (/^git\/trees\//.test(route)) return "source-tree";
  if (upload) {
    if (/\?name=checkpoint-[0-9]{5}\.bin$/.test(route)) return "chunk-upload";
    if (/\?name=inventory\.json$/.test(route)) return "inventory-upload";
    if (/\?name=manifest\.json$/.test(route)) return "manifest-upload";
    return "sdk-upload";
  }
  return "api-admission";
}
// A refused GitHub API response is reported by its public error message,
// documentation URL and rate-limit headers (never the token or our request),
// and a JSON request that GitHub rate-limits (429, or 403 with Retry-After,
// an exhausted limit or a secondary-rate-limit message) is retried at most
// twice, honouring Retry-After within the client deadline. Asset uploads are
// never replayed.
export const GITHUB_RETRY = Object.freeze({ attempts: 3, maxWaitMs: 120_000 });
export async function githubFailure(response) {
  const header = (name) => {
    const value = response.headers?.get?.(name);
    return typeof value === "string" ? value.slice(0, 64) : null;
  };
  let message = null,
    documentation = null;
  try {
    const parts = [];
    let bytes = 0;
    for await (const part of response.body ?? []) {
      bytes += part.length;
      if (bytes > 64 * 1024) throw Error("bound");
      parts.push(Buffer.from(part));
    }
    const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (typeof value?.message === "string")
      message = value.message.replace(/[^\x20-\x7e]/g, "?").slice(0, 300);
    if (
      typeof value?.documentation_url === "string" &&
      /^https:\/\/docs\.github\.com\/[\x21-\x7e]{1,200}$/.test(
        value.documentation_url,
      )
    )
      documentation = value.documentation_url;
  } catch {
    /* A non-JSON body is reported as absent. */
  }
  const retryAfter = header("retry-after");
  const remaining = header("x-ratelimit-remaining");
  const seconds = /^[0-9]{1,6}$/.test(retryAfter ?? "")
    ? Number(retryAfter)
    : null;
  return {
    status: response.status,
    message,
    documentation,
    retryAfter: seconds,
    rateLimitRemaining: /^[0-9]{1,9}$/.test(remaining ?? "")
      ? Number(remaining)
      : null,
    rateLimitResource: /^[a-z_]{1,32}$/.test(
      header("x-ratelimit-resource") ?? "",
    )
      ? header("x-ratelimit-resource")
      : null,
    requestId: /^[A-F0-9:]{1,64}$/.test(header("x-github-request-id") ?? "")
      ? header("x-github-request-id")
      : null,
    rateLimited:
      response.status === 429 ||
      (response.status === 403 &&
        (seconds !== null ||
          remaining === "0" ||
          /rate limit/i.test(message ?? ""))),
  };
}
export function apiClient(
  repository,
  token,
  request = fetch,
  {
    readOnly = false,
    milliseconds = 20 * 60_000,
    sdk = false,
    target = TARGET,
    observer,
    log = console.log,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const observe = createUploadObserver(observer);
  const deadline = Date.now() + milliseconds;
  observe({ stage: "credential", event: "begin", errorCode: "NONE" });
  try {
    assert(
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
        typeof token === "string" &&
        token.length > 0,
      "Scoped GitHub credential required",
    );
  } catch (error) {
    observe({ stage: "credential", event: "failed", errorCode: "CREDENTIAL" });
    throw error;
  }
  observe({ stage: "credential", event: "complete", errorCode: "NONE" });
  return async (
    route,
    { method = "GET", body, raw = false, upload = false, bodyBytes } = {},
  ) => {
    const responseFacts = { httpStatus: null };
    return uploadPhase(
      observe,
      uploadApiStage(route, upload),
      async () => {
        assert(
          !readOnly || (method === "GET" && !upload && !body),
          "Restore API is GET-only",
        );
        assert(Date.now() < deadline, "Checkpoint transport deadline");
        const readRoute =
          /^(?:|actions\/workflows\/cef-engineering-checkpoint\.yml|actions\/runs\/[1-9][0-9]*(?:\/artifacts\?per_page=100)?|releases\/[1-9][0-9]*(?:\/assets\?per_page=100)?|git\/ref\/heads\/main|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1)$/;
        const uploadRoute =
          /^releases\/[1-9][0-9]*\/assets\?name=(?:checkpoint-[0-9]{5}\.bin|inventory\.json|manifest\.json)$/;
        assert(
          (method === "GET" && !upload && readRoute.test(route)) ||
            (!readOnly &&
              method === "POST" &&
              ((route === "releases" && !upload) ||
                (upload &&
                  (sdk
                    ? /^releases\/[1-9][0-9]*\/assets\?name=/.test(route) &&
                      sdkNames(target).some((name) =>
                        route.endsWith(`?name=${encodeURIComponent(name)}`),
                      )
                    : uploadRoute.test(route))))),
          "Closed same-repository checkpoint endpoint required",
        );
        if (upload)
          assert(
            positive(bodyBytes) &&
              bodyBytes <= (sdk ? SDK_ASSET_MAX : LIMITS.chunk),
            "Bounded upload content length required",
          );
        const prefix = upload
          ? "https://uploads.github.com/"
          : "https://api.github.com/";
        const repositoryUrl = `${prefix}repos/${repository}`;
        const url = route ? `${repositoryUrl}/${route}` : repositoryUrl;
        assert(
          url === repositoryUrl || url.startsWith(`${repositoryUrl}/`),
          "Foreign API route denied",
        );
        const send = () =>
          request(url, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              ...(body
                ? {
                    "Content-Type": upload
                      ? "application/octet-stream"
                      : "application/json",
                    ...(upload ? { "Content-Length": String(bodyBytes) } : {}),
                  }
                : {}),
            },
            body: upload ? body : body ? JSON.stringify(body) : undefined,
            ...(upload ? { duplex: "half" } : {}),
            signal: AbortSignal.timeout(
              Math.min(upload ? 600000 : 30000, deadline - Date.now()),
            ),
            redirect: "error",
          });
        let response = await send();
        // Only a readable 4xx/5xx status enters the diagnostic/retry path; a
        // success is never re-read here.
        for (let attempt = 1; ; attempt++) {
          let status = null;
          try {
            status = response.status;
          } catch {
            break;
          }
          if (!Number.isInteger(status) || status < 400) break;
          const failure = await githubFailure(response);
          try {
            log(
              `[cef-engineering-checkpoint] github-error=${JSON.stringify({ stage: uploadApiStage(route, upload), attempt, ...failure })}`,
            );
          } catch {
            /* Diagnostics never replace the original refusal. */
          }
          const pause =
            failure.retryAfter !== null
              ? failure.retryAfter * 1000
              : 15_000 * attempt;
          if (
            upload ||
            !failure.rateLimited ||
            attempt >= GITHUB_RETRY.attempts ||
            pause > GITHUB_RETRY.maxWaitMs ||
            Date.now() + pause + 30_000 >= deadline
          ) {
            response = { ok: false, status };
            break;
          }
          await wait(pause);
          response = await send();
        }
        try {
          responseFacts.httpStatus = response.status;
          observe({
            stage: uploadApiStage(route, upload),
            event: "response",
            errorCode:
              Number.isInteger(responseFacts.httpStatus) &&
              (responseFacts.httpStatus < 200 || responseFacts.httpStatus > 299)
                ? "HTTP"
                : "NONE",
            httpStatus: responseFacts.httpStatus,
          });
        } catch {
          /* Reading diagnostic metadata cannot replace the response guard. */
        }
        assert(response.ok, "Checkpoint GitHub operation failed");
        return raw
          ? response
          : JSON.parse(
              (await boundedResponse(response, 16 * 1024 ** 2)).toString(
                "utf8",
              ),
            );
      },
      responseFacts,
    );
  };
}
export const UPLOAD_RECOVERY = Object.freeze({ attempts: 4, baseMs: 15_000 });
// A multi-hour compile must not be lost to one transient asset-upload refusal
// (observed: a bare 404 from uploads.github.com on the fourth asset of an
// otherwise healthy draft). A failed upload is retried with bounded backoff on
// a fresh stream; before every retry the release's asset list is re-read, and
// an asset that already landed intact (same name, size, digest) is adopted
// instead of re-sent. A same-name asset left in any other state cannot be
// replaced through the closed GET/POST endpoint set, so that refuses.
export async function uploadAssetWithRecovery(
  api,
  releaseId,
  pin,
  bundle,
  { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  const route = `releases/${releaseId}/assets?name=${encodeURIComponent(pin.name)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      return await api(route, {
        method: "POST",
        upload: true,
        bodyBytes: pin.bytes,
        body: createReadStream(path.join(bundle, pin.name)),
      });
    } catch (error) {
      if (attempt >= UPLOAD_RECOVERY.attempts) throw error;
      await wait(UPLOAD_RECOVERY.baseMs * attempt);
      let existing;
      try {
        const listing = await api(`releases/${releaseId}/assets?per_page=100`);
        existing = Array.isArray(listing)
          ? listing.find((asset) => asset?.name === pin.name)
          : undefined;
      } catch {
        throw error;
      }
      if (existing !== undefined) {
        if (
          existing.size === pin.bytes &&
          existing.state === "uploaded" &&
          existing.digest === `sha256:${pin.sha256}`
        )
          return existing;
        throw error;
      }
    }
  }
}
export async function verifyProducer(api, producer) {
  const [repo, workflow, run] = await Promise.all([
    api(""),
    api(`actions/workflows/${path.basename(WORKFLOW)}`),
    api(`actions/runs/${producer.runId}`),
  ]);
  assert(
    repo.id === producer.repositoryId &&
      repo.full_name === producer.repository &&
      repo.private === false &&
      repo.default_branch === producer.branch,
    "Foreign checkpoint repository",
  );
  assert(
    workflow.path === WORKFLOW &&
      run.workflow_id === workflow.id &&
      run.event === "workflow_dispatch" &&
      run.head_sha === producer.head &&
      run.head_branch === producer.branch &&
      run.head_repository?.id === repo.id &&
      run.run_attempt === producer.attempt,
    "Untrusted producer run",
  );
  return run;
}
export function validateTechnicalTransport(value) {
  shape(value, ["kind", "defaultBranch", "carrierHead"]);
  assert(
    value.kind === "default-branch-container" &&
      value.defaultBranch === "main" &&
      typeof value.carrierHead === "string" &&
      /^[a-f0-9]{40}$/.test(value.carrierHead),
    "Exact technical transport carrier required",
  );
  return value;
}
export async function resolveTechnicalTransport(api, producer) {
  shape(producer, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
  ]);
  assert(
    producer.branch === "main" &&
      typeof producer.repository === "string" &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(producer.repository) &&
      positive(producer.repositoryId) &&
      positive(producer.runId) &&
      positive(producer.attempt) &&
      typeof producer.head === "string" &&
      /^[a-f0-9]{40}$/.test(producer.head) &&
      producer.workflow === WORKFLOW,
    "Technical transport requires original default-branch producer",
  );
  const repo = await api("");
  assert(
    repo.id === producer.repositoryId &&
      repo.full_name === producer.repository &&
      repo.private === false &&
      repo.visibility === "public" &&
      repo.default_branch === "main",
    "Technical transport repository mismatch",
  );
  const ref = await api("git/ref/heads/main");
  assert(
    ref.ref === "refs/heads/main" && ref.object?.type === "commit",
    "Technical transport ref mismatch",
  );
  return Object.freeze(
    validateTechnicalTransport({
      kind: "default-branch-container",
      defaultBranch: "main",
      carrierHead: ref.object.sha,
    }),
  );
}
function transportHead(seal, producer) {
  return seal.schemaVersion === 2
    ? validateTechnicalTransport(seal.transport).carrierHead
    : producer.head;
}
async function verifyTechnicalReadback(
  api,
  releaseId,
  tag,
  transport,
  expected,
) {
  validateTechnicalTransport(transport);
  const [release, assets] = await Promise.all([
    api(`releases/${releaseId}`),
    api(`releases/${releaseId}/assets?per_page=100`),
  ]);
  assert(
    release.id === releaseId &&
      release.draft === true &&
      release.prerelease === true &&
      release.tag_name === tag &&
      release.target_commitish === transport.carrierHead,
    "Technical transport draft changed before sealing",
  );
  assert(
    Array.isArray(assets) &&
      assets.length === expected.length &&
      new Set(assets.map((x) => x.id)).size === expected.length &&
      new Set(assets.map((x) => x.name)).size === expected.length &&
      new Set(expected.map((x) => x.id)).size === expected.length,
    "Technical transport asset set changed before sealing",
  );
  for (const pin of expected) {
    const row = assets.find((x) => x.id === pin.id);
    assert(
      row &&
        row.name === pin.name &&
        row.size === pin.bytes &&
        row.state === "uploaded" &&
        row.digest === `sha256:${pin.sha256}`,
      "Technical transport asset changed before sealing",
    );
  }
}
export async function uploadCheckpoint(
  api,
  { bundle, manifest, producer, observer, censusFactory },
) {
  assert(
    censusFactory === undefined ||
      (macCensusFactories.has(censusFactory) &&
        !macCensusFactories.get(censusFactory).proofOnly),
    "CENSUS_CAPABILITY",
  );
  const observe = createUploadObserver(observer);
  return uploadPhase(observe, "upload", async () => {
    await uploadPhase(observe, "state-validation", async () => {
      validateManifest(manifest);
      assert(
        canonical(manifest.producer) === canonical(producer),
        "Current producer mismatch",
      );
    });
    await uploadPhase(observe, "producer-validation", () =>
      verifyProducer(api, producer),
    );
    await uploadPhase(observe, "code-validation", () =>
      verifyProducerCode(api, producer, manifest.identity.producer),
    );
    await uploadPhase(observe, "quiescence", async () => {
      assert(
        await observedQuiet(
          manifest.compile.observed,
          manifest.compile.groupId,
          { censusFactory },
        ),
        "Compiler group no longer quiescent",
      );
    });
    const pins = [...manifest.archive.chunks, manifest.archive.inventory];
    for (const p of pins)
      await uploadPhase(observe, "asset-verification", async () =>
        assert(
          canonical(
            await filePin(
              path.join(bundle, p.name),
              p.name === "inventory.json" ? LIMITS.metadata : LIMITS.chunk,
            ),
          ) === canonical(p),
          "Changed upload asset",
        ),
      );
    const manifestPin = await uploadPhase(
      observe,
      "manifest-generation",
      async () => {
        const manifestBytes = Buffer.from(`${canonical(manifest)}\n`);
        assert(manifestBytes.length < LIMITS.seal, "Manifest bound");
        const manifestPin = {
          name: "manifest.json",
          bytes: manifestBytes.length,
          sha256: sha(manifestBytes),
        };
        await writeFile(path.join(bundle, "manifest.json"), manifestBytes, {
          flag: "wx",
        });
        return manifestPin;
      },
    );
    const tag = `cef-checkpoint-${manifest.identity.target}-${manifest.identitySha256.slice(0, 16)}-${producer.runId}-${producer.attempt}`;
    const transport = await resolveTechnicalTransport(api, producer);
    const release = await api("releases", {
      method: "POST",
      body: {
        tag_name: tag,
        target_commitish: transport.carrierHead,
        name: tag,
        draft: true,
        prerelease: true,
        make_latest: "false",
        body: `Engineering checkpoint transport only. Technical container ${transport.carrierHead}; immutable build source ${producer.head}, run ${producer.runId}, attempt ${producer.attempt}. Not a runtime, SDK, acceptance or application release.`,
      },
    });
    await uploadPhase(observe, "response-validation", async () =>
      assert(
        positive(release.id) &&
          release.draft === true &&
          release.prerelease === true &&
          release.tag_name === tag &&
          release.target_commitish === transport.carrierHead,
        "Unexpected checkpoint draft",
      ),
    );
    const assets = [];
    for (const p of [...pins, manifestPin]) {
      const uploaded = await uploadAssetWithRecovery(
        api,
        release.id,
        p,
        bundle,
      );
      await uploadPhase(observe, "response-validation", async () =>
        assert(
          uploaded.name === p.name &&
            uploaded.size === p.bytes &&
            uploaded.state === "uploaded" &&
            uploaded.digest === `sha256:${p.sha256}` &&
            positive(uploaded.id),
          "Uploaded checkpoint asset mismatch",
        ),
      );
      assets.push({ id: uploaded.id, ...p });
    }
    await verifyTechnicalReadback(api, release.id, tag, transport, assets);
    return validateSeal(
      {
        schemaVersion: 2,
        kind: "sorng-cef-engineering-seal",
        producer,
        transport,
        identitySha256: manifest.identitySha256,
        release: { id: release.id, tag },
        manifest: manifestPin,
        assets,
      },
      producer,
      manifest.identity.target,
    );
  });
}
export function validateSeal(seal, expected, target = TARGET) {
  checkpointProfile(target);
  shape(seal, [
    "schemaVersion",
    "kind",
    "producer",
    "identitySha256",
    "release",
    "manifest",
    "assets",
    ...(seal?.schemaVersion === 2 ? ["transport"] : []),
  ]);
  assert(
    [1, 2].includes(seal.schemaVersion) &&
      seal.kind === "sorng-cef-engineering-seal" &&
      hex(seal.identitySha256) &&
      canonical(seal.producer) === canonical(expected),
    "Seal producer mismatch",
  );
  if (seal.schemaVersion === 2) {
    validateTechnicalTransport(seal.transport);
    assert(
      expected.branch === seal.transport.defaultBranch,
      "Technical transport producer branch mismatch",
    );
  }
  shape(seal.release, ["id", "tag"]);
  assert(
    positive(seal.release.id) &&
      seal.release.tag ===
        `cef-checkpoint-${target}-${seal.identitySha256.slice(0, 16)}-${expected.runId}-${expected.attempt}`,
    "Seal release mismatch",
  );
  pin(seal.manifest, LIMITS.seal);
  assert(
    seal.manifest.name === "manifest.json" &&
      Array.isArray(seal.assets) &&
      seal.assets.length >= 3 &&
      seal.assets.length <= 34,
    "Seal asset bounds",
  );
  const names = new Set(),
    ids = new Set();
  for (const row of seal.assets) {
    shape(row, ["id", "name", "bytes", "sha256"]);
    pin(
      { name: row.name, bytes: row.bytes, sha256: row.sha256 },
      row.name === "inventory.json" ? LIMITS.metadata : LIMITS.chunk,
    );
    assert(
      positive(row.id) && !names.has(row.name) && !ids.has(row.id),
      "Duplicate seal asset",
    );
    names.add(row.name);
    ids.add(row.id);
  }
  return seal;
}
// Fixed phases and error labels never include untrusted errors or SDK paths.
const AFTER_GN_PHASES = new Set([
  "sdk-preflight",
  "siso-pin",
  "sysroot-links",
  "sdk-roots",
  "sdk-links",
  "recipe-write",
  "graph-inventory",
  "identity",
  "restore",
]);
const AFTER_GN_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ELOOP",
  "ENOTDIR",
  "EEXIST",
  "ETIMEDOUT",
  "GRAPH_BOUND",
]);
// BEGIN closed Linux migration diagnostics
const LINUX_MIGRATION_DIAGNOSTIC_PHASES = new Set([
  "entry",
  "controls",
  "recheck-before-restore",
  "restore-install",
  "recheck-before-apply-1",
  "source-apply-1",
  "recheck-before-gn",
  "gn-revalidation",
  "graph-verify",
  "recipe-check",
  "source-apply-2",
  "recheck-before-retirement",
  "retirement",
  "recheck-before-record",
  "source-record",
  "record-check",
  "recheck-final",
  "cleanup",
  "completion",
]);
const LINUX_MIGRATION_DIAGNOSTIC_MESSAGES = new Set([
  "LINUX_GN_CLEANUP_RESERVE",
  "LINUX_GN_COHORT_UNCONFIRMED",
  "LINUX_GN_CREDENTIAL",
  "LINUX_GN_LOG_CLOSE_DEADLINE",
  "LINUX_GN_LOG_DIRECTORY",
  "LINUX_GN_LOG_OWNER",
  "LINUX_GN_ROLE",
  "LINUX_MIGRATION_BOUND",
  "LINUX_MIGRATION_BUNDLE_CHANGED",
  "LINUX_MIGRATION_CANONICAL_JSON",
  "LINUX_MIGRATION_CAPSULE_PRODUCER",
  "LINUX_MIGRATION_CURRENT_CODE",
  "LINUX_MIGRATION_CURRENT_HEAD",
  "LINUX_MIGRATION_CURRENT_SOURCE",
  "LINUX_MIGRATION_EXISTING_SIDECAR",
  "LINUX_MIGRATION_FILE_CHANGED",
  "LINUX_MIGRATION_FILE_SWAP",
  "LINUX_MIGRATION_FIXED_CHECKOUT",
  "LINUX_MIGRATION_FIXED_RUN",
  "LINUX_MIGRATION_FRESH_SWAP",
  "LINUX_MIGRATION_FROM_DIGEST",
  "LINUX_MIGRATION_GENUINE_GN_AND_APPLIES_REQUIRED",
  "LINUX_MIGRATION_GIT_BLOB",
  "LINUX_MIGRATION_GIT_TREE",
  "LINUX_MIGRATION_IDENTITY_FIELDS",
  "LINUX_MIGRATION_INSTALL_SWAP",
  "LINUX_MIGRATION_INSUFFICIENT_ORIGINAL_LEASE",
  "LINUX_MIGRATION_INVENTORY",
  "LINUX_MIGRATION_LINUX_METADATA",
  "LINUX_MIGRATION_NOT_ACTIVATED",
  "LINUX_MIGRATION_NO_CLEANUP_OBSERVATION",
  "LINUX_MIGRATION_NO_RETIREMENT_OBSERVATION",
  "LINUX_MIGRATION_OLD_CODE",
  "LINUX_MIGRATION_OLD_PRODUCER",
  "LINUX_MIGRATION_OLD_SOURCE",
  "LINUX_MIGRATION_OPAQUE_CANDIDATE",
  "LINUX_MIGRATION_OPAQUE_CREATOR",
  "LINUX_MIGRATION_OPAQUE_TOOLS",
  "LINUX_MIGRATION_ORIGINAL_CLOCK",
  "LINUX_MIGRATION_ORIGINAL_LEASE",
  "LINUX_MIGRATION_OWNERSHIP_LEDGER",
  "LINUX_MIGRATION_PIN",
  "LINUX_MIGRATION_PIN_MISMATCH",
  "LINUX_MIGRATION_POLICY_MISSING",
  "LINUX_MIGRATION_POLICY_SCOPE",
  "LINUX_MIGRATION_POLICY_UNCOMMITTED",
  "LINUX_MIGRATION_PRODUCER",
  "LINUX_MIGRATION_REGULAR_FILE",
  "LINUX_MIGRATION_REQUESTED_SLICE",
  "LINUX_MIGRATION_RESTORE",
  "LINUX_MIGRATION_RESTORE_OWNER",
  "LINUX_MIGRATION_RESTORE_SWAP",
  "LINUX_MIGRATION_RETIREMENT_DEADLINE",
  "LINUX_MIGRATION_RETIREMENT_DESTINATION",
  "LINUX_MIGRATION_RETIREMENT_HELPER_PIN",
  "LINUX_MIGRATION_RETIREMENT_INPUT",
  "LINUX_MIGRATION_RETIREMENT_READBACK",
  "LINUX_MIGRATION_RETIREMENT_REPORT",
  "LINUX_MIGRATION_SEALED_ASSET",
  "LINUX_MIGRATION_SEAL_ARTIFACT",
  "LINUX_MIGRATION_SEAL_BINDING",
  "LINUX_MIGRATION_SELECTION_ARGUMENTS",
  "LINUX_MIGRATION_SELECTION_LEASE",
  "LINUX_MIGRATION_SHAPE",
  "LINUX_MIGRATION_SIDECAR_OWNER",
  "LINUX_MIGRATION_SOURCE_DELTA",
  "LINUX_MIGRATION_TOOLS_AUTHORITY",
  "LINUX_MIGRATION_TOOLS_BINDING",
  "LINUX_MIGRATION_TOOLS_HOST",
  "LINUX_MIGRATION_TOOLS_INSTALLED_PIN",
  "LINUX_MIGRATION_TOOLS_LOCK",
  "LINUX_MIGRATION_TOOLS_LOCK_PIN",
  "LINUX_MIGRATION_TOOLS_MAP",
  "LINUX_MIGRATION_TOOLS_MAP_PIN",
  "LINUX_MIGRATION_TOOLS_PYTHON",
  "LINUX_MIGRATION_TOOLS_PYTHON_MODE",
  "LINUX_MIGRATION_TOOLS_SISO",
  "LINUX_MIGRATION_TOOLS_SOURCE",
  "LINUX_MIGRATION_TOOLS_WORKSPACE",
  "LINUX_MIGRATION_TRANSACTION_ALREADY_USED",
  "LINUX_MIGRATION_TRANSACTION_CACHE_BINDING",
  "LINUX_MIGRATION_TRANSACTION_CACHE_HEADER",
  "LINUX_MIGRATION_TRANSACTION_CACHE_OWNER",
  "LINUX_MIGRATION_TRANSACTION_COMPLETION_CONTEXT",
  "LINUX_MIGRATION_TRANSACTION_CONTROL_ROOT",
  "LINUX_MIGRATION_TRANSACTION_FULL_RECORD",
  "LINUX_MIGRATION_TRANSACTION_GN_ALREADY_USED",
  "LINUX_MIGRATION_TRANSACTION_GN_ORDER",
  "LINUX_MIGRATION_TRANSACTION_GN_UNCONFIRMED",
  "LINUX_MIGRATION_TRANSACTION_IDENTITY",
  "LINUX_MIGRATION_TRANSACTION_IDENTITY_FILE",
  "LINUX_MIGRATION_TRANSACTION_LOG_ROOT",
  "LINUX_MIGRATION_TRANSACTION_METADATA_MODE",
  "LINUX_MIGRATION_TRANSACTION_NOT_ACTIVATED",
  "LINUX_MIGRATION_TRANSACTION_READINESS",
  "LINUX_MIGRATION_TRANSACTION_RECIPE_CHANGED",
  "LINUX_MIGRATION_TRANSACTION_RETIRED",
  "LINUX_MIGRATION_TRANSACTION_RETIREMENT_UNCONFIRMED",
  "LINUX_MIGRATION_TRANSACTION_SOURCE_OWNER",
  "LINUX_MIGRATION_TRANSACTION_SOURCE_ROOT",
  "LINUX_MIGRATION_TRANSACTION_TOKENS",
  "LINUX_MIGRATION_UNREVIEWED_SOURCE_DELTA",
  "LINUX_SOURCE_OWNER_ALREADY_USED",
  "LINUX_SOURCE_OWNER_DEADLINE",
  "LINUX_SOURCE_OWNER_DUPLICATE",
  "LINUX_SOURCE_OWNER_ESCAPED",
  "LINUX_SOURCE_OWNER_RECEIPT",
  "LINUX_SOURCE_OWNER_REQUIRED",
  "LINUX_SOURCE_OWNER_RETIRED",
]);
const LINUX_MIGRATION_DIAGNOSTIC_FS = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ELOOP",
  "ENOTDIR",
  "EEXIST",
  "ETIMEDOUT",
  "ENOSPC",
  "EIO",
]);
export function linuxMigrationFailureRecord(error, phase) {
  let code = "UNKNOWN";
  try {
    // Native-error branding rejects proxies before descriptor inspection.
    // Accessors are never evaluated and unknown message text never leaves here.
    if (utilTypes.isNativeError(error)) {
      const message = Object.getOwnPropertyDescriptor(error, "message");
      const ownCode = Object.getOwnPropertyDescriptor(error, "code");
      if (
        typeof message?.value === "string" &&
        LINUX_MIGRATION_DIAGNOSTIC_MESSAGES.has(message.value)
      )
        code = message.value;
      else if (
        typeof ownCode?.value === "string" &&
        LINUX_MIGRATION_DIAGNOSTIC_FS.has(ownCode.value)
      )
        code = ownCode.value;
      else if (message?.value === "Checkpoint archive rejected")
        code = "ARCHIVE_REJECTED";
      else if (message?.value === "Archive deadline; partial is not admitted")
        code = "ARCHIVE_DEADLINE";
      else if (message?.value === "Malformed archive result")
        code = "ARCHIVE_RESULT";
    }
  } catch {
    /* A diagnostic never replaces even a falsy primary failure. */
  }
  return Object.freeze({
    kind: "sorng-linux-migration-failure",
    schemaVersion: 1,
    phase: LINUX_MIGRATION_DIAGNOSTIC_PHASES.has(phase) ? phase : "entry",
    code,
  });
}
// END closed Linux migration diagnostics

export async function afterGnPhase(phase, operation, log = console.log) {
  assert(AFTER_GN_PHASES.has(phase), "Closed after-GN phase required");
  log(`[cef-engineering-checkpoint] after-gn phase=${phase}`);
  try {
    return await operation();
  } catch (error) {
    const code = AFTER_GN_CODES.has(error?.code) ? error.code : "CHECK_FAILED";
    log(
      `[cef-engineering-checkpoint] after-gn failed phase=${phase} code=${code}`,
    );
    // BEGIN restore-only fixed migration assertion projection
    if (phase === "restore") {
      try {
        const record = linuxMigrationFailureRecord(error, "entry");
        if (LINUX_MIGRATION_DIAGNOSTIC_MESSAGES.has(record.code))
          log(
            "[cef-engineering-checkpoint] linux-migration " + canonical(record),
          );
      } catch {
        /* This additional observer never replaces the operation error. */
      }
    }
    // END restore-only fixed migration assertion projection
    if (
      phase === "sdk-roots" &&
      LINUX_DEPENDENCY_ROLES.has(error?.linuxDependencyRole)
    )
      log(
        `[cef-engineering-checkpoint] linux-dependency role=${error.linuxDependencyRole}`,
      );
    const counts = error?.graphCounts;
    if (
      phase === "graph-inventory" &&
      code === "GRAPH_BOUND" &&
      counts &&
      Object.keys(counts).sort().join() === "bytes,files,visited" &&
      ["files", "bytes", "visited"].every(
        (key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0,
      ) &&
      counts.files <= GRAPH_LIMITS.files + 1 &&
      counts.bytes <= (GRAPH_LIMITS.files + 1) * GRAPH_LIMITS.fileBytes &&
      counts.visited <= GRAPH_LIMITS.visited + 1
    )
      log(
        `[cef-engineering-checkpoint] graph files=${counts.files} bytes=${counts.bytes} visited=${counts.visited}`,
      );
    throw error; // The CLI's outer catch remains fixed and never prints raw errors.
  }
}

const SDK_REASONS = new Set([
  "filesystem",
  "probe-command",
  "probe-target",
  "absolute-roots",
  "sdk-containment",
  "sdk-name",
  "expected-targets",
  "physical-rebind",
  "physical-kind",
  "entry-count",
  "entry-kind-name",
  "raw-target",
  "changed-before-normalize",
  "normalized-target",
]);
export function sdkLayoutRecord(value) {
  if (
    !SDK_REASONS.has(value?.reason) ||
    !["layout", "sdk", "platform", "toolchain", "unknown"].includes(value?.role)
  )
    return { reason: "unavailable", role: "unknown" };
  const result = { reason: value.reason, role: value.role };
  for (const key of [
    "ok",
    "symbolic",
    "knownName",
    "duplicate",
    "absolute",
    "rawAlias",
    "canonical",
    "physicalMatch",
    "basenameKnown",
  ])
    if (typeof value[key] === "boolean") result[key] = value[key];
  if (Number.isInteger(value.count) && value.count >= 0 && value.count <= 4)
    result.count = value.count;
  for (const key of ["reportedSdkVersion", "expectedSdkVersion"])
    if (
      typeof value[key] === "string" &&
      value[key].length <= 16 &&
      /^[0-9]+(?:\.[0-9]+){0,2}$/.test(value[key])
    )
      result[key] = value[key];
  return result;
}
function sdkBasenameVersion(name) {
  const match = /^MacOSX([0-9]+(?:\.[0-9]+){0,2})\.sdk$/.exec(name);
  return match && match[1].length <= 16 ? match[1] : undefined;
}
// Opaque in-process capability: never decoded from checkpoint/recipe JSON.
const selectedSdkAliases = new WeakMap();
function selectedAliasName(index, name) {
  return index === 0
    ? name === "MacOSX.sdk" || sdkBasenameVersion(name) !== undefined
    : name === ["", "MacOSX.platform", "XcodeDefault.xctoolchain"][index];
}
async function aliasIdentity(raw, target) {
  const before = await lstat(raw, { bigint: true });
  const link = before.isSymbolicLink() ? await readlink(raw) : null;
  assert(
    before.isDirectory() || before.isSymbolicLink(),
    "Selected SDK alias kind",
  );
  assert(
    (await realpath(raw)) === target,
    "Selected SDK alias physical target",
  );
  const after = await lstat(raw, { bigint: true });
  assert(
    before.dev === after.dev &&
      before.ino === after.ino &&
      before.mode === after.mode &&
      (!before.isSymbolicLink() || (await readlink(raw)) === link),
    "Selected SDK alias changed",
  );
  return { dev: before.dev, ino: before.ino, mode: before.mode, link };
}
async function verifySelectedAliases(token, developerDir, sdkRoot, targets) {
  const attested = selectedSdkAliases.get(token);
  assert(
    attested &&
      attested.developerDir === developerDir &&
      attested.sdkRoot === sdkRoot &&
      attested.rows.length === 3 &&
      Array.isArray(targets) &&
      targets.length === 3,
    "Selected SDK alias attestation required",
  );
  for (const [index, row] of attested.rows.entries()) {
    assert(
      row.target === targets[index] && selectedAliasName(index, row.name),
      "Selected SDK alias binding",
    );
    const current = await aliasIdentity(row.raw, row.target);
    assert(
      current.dev === row.identity.dev &&
        current.ino === row.identity.ino &&
        current.mode === row.identity.mode &&
        current.link === row.identity.link,
      "Selected SDK alias identity changed",
    );
  }
  return attested.rows;
}
export function logSdkLayout(value, log = console.log) {
  log(
    `[cef-engineering-checkpoint] sdk-layout ${canonical(sdkLayoutRecord(value))}`,
  );
}
const execFileAsync = promisify(execFile);
export function selectedSdkEnvironment(selected) {
  const result = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
  };
  for (const key of ["DEVELOPER_DIR", "SDKROOT", "MACOSX_DEPLOYMENT_TARGET"]) {
    assert(
      typeof selected[key] === "string" &&
        selected[key].length <= 4096 &&
        !/[\x00-\x1f\x7f]/.test(selected[key]),
      "Selected SDK environment required",
    );
    result[key] = selected[key];
  }
  return result;
}
export async function selectedSdkPreflight(
  {
    temp,
    selected,
    expectedTargets,
    run = execFileAsync,
    observe = logSdkLayout,
  },
  continuation = async () => ({ sdkProbe: true, nativeAcceptance: false }),
) {
  const env = selectedSdkEnvironment(selected);
  const base = await noLinks(temp),
    baseStamp = await lstat(base, { bigint: true });
  const owned = await mkdtemp(path.join(base, "cef-checkpoint-sdk-probe-"));
  const ownedStamp = await lstat(owned, { bigint: true });
  const aliases = [];
  let aliasAttestation;
  try {
    const directory = path.join(owned, "sdk", "xcode_links");
    await mkdir(directory, { recursive: true });
    const commands = [
      ["/usr/bin/xcrun", ["-sdk", "macosx", "--show-sdk-path"]],
      ["/usr/bin/xcrun", ["-sdk", "macosx", "--show-sdk-platform-path"]],
      ["/usr/bin/xcode-select", ["-print-path"]],
    ];
    for (const [index, [file, args]] of commands.entries()) {
      const role = ["sdk", "platform", "toolchain"][index];
      let raw;
      try {
        const { stdout } = await run(file, args, {
          env,
          timeout: 5000,
          maxBuffer: 4096,
          encoding: "utf8",
          windowsHide: true,
        });
        assert(
          typeof stdout === "string" && stdout.length <= 4096,
          "SDK command output bound",
        );
        raw = stdout.replace(/\r?\n$/, "");
        assert(
          path.isAbsolute(raw) && !/[\x00-\x1f\x7f]/.test(raw),
          "Absolute SDK command path required",
        );
      } catch (error) {
        observe({ reason: "probe-command", role, ok: false });
        throw error;
      }
      observe({ reason: "probe-command", role, ok: true });
      if (index === 2)
        raw = path.join(raw, "Toolchains", "XcodeDefault.xctoolchain");
      const expectedRaw = [
        selected.SDKROOT,
        path.join(selected.DEVELOPER_DIR, "Platforms", "MacOSX.platform"),
        path.join(
          selected.DEVELOPER_DIR,
          "Toolchains",
          "XcodeDefault.xctoolchain",
        ),
      ][index];
      const expected = expectedTargets?.[index];
      let physicalMatch = false;
      try {
        physicalMatch = (await realpath(raw)) === expected;
      } catch {
        /* Observation only; the strict normalizer still rejects missing/foreign targets. */
      }
      observe({
        reason: "probe-target",
        role,
        rawAlias: raw === expectedRaw,
        canonical: raw === expected,
        physicalMatch,
        basenameKnown: [
          path.basename(expectedRaw),
          ...(typeof expected === "string" ? [path.basename(expected)] : []),
        ].includes(path.basename(raw)),
        ...(index === 0
          ? {
              reportedSdkVersion: sdkBasenameVersion(path.basename(raw)),
              expectedSdkVersion:
                sdkBasenameVersion(path.basename(expectedRaw)) ??
                (typeof expected === "string"
                  ? sdkBasenameVersion(path.basename(expected))
                  : undefined),
            }
          : {}),
      });
      assert(
        path.isAbsolute(raw) &&
          raw.length <= 4096 &&
          !/[\x00-\x1f\x7f]/.test(raw) &&
          selectedAliasName(index, path.basename(raw)),
        "Closed selected SDK alias required",
      );
      assert(
        Array.isArray(expectedTargets) &&
          expectedTargets.length === 3 &&
          typeof expected === "string" &&
          path.isAbsolute(expected),
        "Selected SDK target binding required",
      );
      aliases.push(
        Object.freeze({
          raw,
          name: path.basename(raw),
          target: expected,
          identity: Object.freeze(await aliasIdentity(raw, expected)),
        }),
      );
      await symlink(
        raw,
        path.join(directory, path.basename(raw)),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    aliasAttestation = Object.freeze(Object.create(null));
    selectedSdkAliases.set(
      aliasAttestation,
      Object.freeze({
        developerDir: selected.DEVELOPER_DIR,
        sdkRoot: selected.SDKROOT,
        rows: Object.freeze(aliases),
      }),
    );
    await normalizeSdkLinks(owned, {
      developerDir: selected.DEVELOPER_DIR,
      sdkRoot: selected.SDKROOT,
      expectedTargets,
      observe,
      aliasAttestation,
    });
  } finally {
    // Fail closed on a replaced root/output. Never recursively delete a changed alias.
    const currentBase = await noLinks(base),
      currentBaseStamp = await lstat(base, { bigint: true });
    const currentOwned = await lstat(owned, { bigint: true });
    assert(
      currentBase === base &&
        currentBaseStamp.dev === baseStamp.dev &&
        currentBaseStamp.ino === baseStamp.ino &&
        currentBaseStamp.isDirectory(),
      "SDK probe temporary root changed",
    );
    assert(
      path.isAbsolute(owned) &&
        path.dirname(owned) === base &&
        currentOwned.isDirectory() &&
        !currentOwned.isSymbolicLink() &&
        currentOwned.dev === ownedStamp.dev &&
        currentOwned.ino === ownedStamp.ino &&
        (await realpath(owned)) === owned,
      "SDK probe cleanup containment changed",
    );
    // Only this fresh owned directory is removed; recursive rm never follows its SDK links.
    await rm(owned, { recursive: true, force: true });
  }
  // Source acquisition is structurally downstream of successful probe and cleanup.
  return continuation(aliasAttestation);
}

const FRAMEWORK = "Chromium Embedded Framework.framework";
export const FRAMEWORK_LINKS = Object.freeze(
  Object.fromEntries(
    [
      ["Versions/Current", "version", "directory", "Versions/A"],
      ["Resources", "resources", "directory", "Versions/A/Resources"],
      ["Libraries", "libraries", "directory", "Versions/A/Libraries"],
      [
        "Chromium Embedded Framework",
        "binary",
        "file",
        "Versions/A/Chromium Embedded Framework",
      ],
    ].map(([name, role, kind, target]) => [
      `${FRAMEWORK}/${name}`,
      Object.freeze({
        role,
        kind,
        target: `${FRAMEWORK}/${target}`,
        raw: role === "version" ? "A" : `Versions/Current/${name}`,
      }),
    ]),
  ),
);

export function checkpointLinkRecipe(sdk) {
  assert(
    sdk && Object.keys(sdk).length === 3,
    "Three attested SDK roles required",
  );
  const roles = new Set();
  for (const [name, target] of Object.entries(sdk)) {
    const leaf = name.slice("sdk/xcode_links/".length);
    const role = /^MacOSX(?:[0-9]+(?:\.[0-9]+){0,2})?\.sdk$/.test(leaf)
      ? "sdk"
      : ["MacOSX.platform", "XcodeDefault.xctoolchain"].includes(leaf)
        ? leaf
        : null;
    assert(
      name === `sdk/xcode_links/${leaf}` &&
        role &&
        !roles.has(role) &&
        typeof target === "string" &&
        path.isAbsolute(target),
      "Closed SDK recipe required",
    );
    roles.add(role);
  }
  return { ...sdk, ...FRAMEWORK_LINKS };
}

async function optionalLinkStat(file) {
  try {
    return await lstat(file, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function sameLinkIdentity(a, b) {
  return (
    a &&
    b &&
    ["dev", "ino", "mode", "uid", "size", "mtimeNs", "ctimeNs"].every(
      (key) => a[key] === b[key],
    )
  );
}
async function ownedRealPath(file, owner, kind) {
  await noLinks(file);
  const s = await lstat(file, { bigint: true });
  assert(
    s.uid === owner &&
      (kind === "directory" ? s.isDirectory() : s.isFile() && s.nlink === 1n),
    "Owned framework target kind required",
  );
  return s;
}
// allowPending is only for checkpoint (non-final) sealing and restore: a time-cut build can have
// the framework tree before its package action created ANY alias. Final and acceptance paths
// keep the default and still require every alias.
export async function attestFrameworkLinks(out, { allowPending = false } = {}) {
  await noLinks(out);
  const root = await lstat(out, { bigint: true });
  const framework = path.join(out, FRAMEWORK);
  const f = await optionalLinkStat(framework);
  // The pinned package action need not have run in an interrupted build.
  if (!f) return { framework: "absent", targets: {} };
  await ownedRealPath(framework, root.uid, "directory");
  await ownedRealPath(path.join(framework, "Versions"), root.uid, "directory");
  await ownedRealPath(
    path.join(framework, "Versions", "A"),
    root.uid,
    "directory",
  );
  // Inventory the complete framework without following ANY alias before writes.
  // Python independently hashes every regular entry during the bounded pack.
  const inventory = async () => {
    const pending = [framework],
      result = [],
      end = Date.now() + 180000;
    let visited = 0;
    while (pending.length) {
      const directory = pending.pop();
      await ownedRealPath(directory, root.uid, "directory");
      for await (const entry of await opendir(directory)) {
        assert(
          ++visited <= 300000 && Date.now() < end,
          "Framework inventory bound",
        );
        const name = entry.name;
        const file = path.join(directory, name),
          member = path.relative(out, file).split(path.sep).join("/"),
          s = await lstat(file, { bigint: true });
        assert(s.uid === root.uid, "Foreign framework entry owner");
        if (s.isSymbolicLink()) {
          assert(member in FRAMEWORK_LINKS, "Unknown framework alias");
          continue;
        }
        assert(
          s.isDirectory() || (s.isFile() && s.nlink === 1n),
          "Framework regular entry required",
        );
        result.push([
          member,
          String(s.dev),
          String(s.ino),
          String(s.uid),
          String(s.mode),
          ...(s.isFile()
            ? [String(s.size), String(s.mtimeNs), String(s.ctimeNs)]
            : []),
        ]);
        if (s.isDirectory()) pending.push(file);
      }
    }
    return canonical(result.sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  };
  const before = await inventory();
  if (allowPending) {
    const missing = [];
    for (const member of Object.keys(FRAMEWORK_LINKS))
      if ((await optionalLinkStat(path.join(out, member))) === null)
        missing.push(member);
    assert(
      missing.length === 0 ||
        missing.length === Object.keys(FRAMEWORK_LINKS).length,
      "Framework alias set incomplete",
    );
    if (missing.length !== 0) {
      const pending = {};
      for (const spec of Object.values(FRAMEWORK_LINKS)) {
        const t = await optionalLinkStat(path.join(out, spec.target));
        if (t) {
          await ownedRealPath(path.join(out, spec.target), root.uid, spec.kind);
          pending[spec.role] = "present";
        } else {
          assert(spec.role !== "version", "Framework version must exist");
          pending[spec.role] = "pending";
        }
      }
      assert(
        (await inventory()) === before,
        "Framework regular inventory changed",
      );
      return { framework: "partial", targets: pending };
    }
  }
  const rows = [],
    targets = {};
  for (const [member, spec] of Object.entries(FRAMEWORK_LINKS)) {
    const file = path.join(out, member),
      target = path.join(out, spec.target);
    await ownedRealPath(path.dirname(file), root.uid, "directory");
    const s = await lstat(file, { bigint: true });
    assert(
      s.isSymbolicLink() && s.uid === root.uid && s.nlink === 1n,
      "Owned framework alias required",
    );
    const raw = await readlink(file);
    assert(raw === spec.raw, "Unreviewed framework alias");
    const t = await optionalLinkStat(target);
    if (t) {
      await ownedRealPath(target, root.uid, spec.kind);
      targets[spec.role] = "present";
    } else {
      assert(spec.role !== "version", "Framework version must exist");
      targets[spec.role] = "pending";
    }
    rows.push({ file, raw, identity: s });
  }
  // Attest only: these are Siso-tracked outputs, including their raw spelling.
  for (const row of rows) {
    assert(
      sameLinkIdentity(row.identity, await lstat(row.file, { bigint: true })) &&
        (await readlink(row.file)) === row.raw,
      "Framework alias changed",
    );
  }
  assert((await inventory()) === before, "Framework regular inventory changed");
  return { framework: "factory", targets };
}

// Observation has no admission authority and cannot replace the original
// cleanup failure. It must precede every current Siso removal guard.
export async function observeThenRemoveSisoLog(
  out,
  logs,
  compile,
  { log = console.log } = {},
  dependencies = {},
) {
  const observe = dependencies.observe ?? persistGeneratedLinkInventory;
  let diagnostic = { persisted: false, complete: false };
  try {
    const observed = await observe(out, logs);
    diagnostic = {
      persisted: observed?.persisted === true,
      complete: observed?.complete === true,
    };
  } catch {
    // Best-effort fixed observation only; preserve the actual cleanup result.
  }
  checkpointLog(
    log,
    `[cef-engineering-checkpoint] checkpoint link-diagnostic=${canonical(diagnostic)}`,
  );
  return checkpointPhase(
    "siso-log",
    () =>
      (dependencies.remove ?? removeQuiescentSisoLog)(out, compile, {
        observeIdentity: (record) =>
          checkpointLog(
            log,
            `[cef-engineering-checkpoint] checkpoint siso-identity=${canonical(record)}`,
          ),
        beforeUnlink: (record) =>
          writeFile(
            path.join(logs, "siso-log-alias-before.json"),
            canonical(record),
            { flag: "wx" },
          ),
      }),
    log,
  );
}

export async function removeQuiescentSisoLog(
  out,
  compile,
  { beforeUnlink = async () => {}, observeIdentity = () => {} } = {},
) {
  validateCompile(compile);
  const proof = liveCompileSlices.get(compile);
  assert(
    proof &&
      proof.canonicalOut &&
      proof.groupId === compile.groupId &&
      sameObservedCohort(proof.observed, compile.observed),
    "Genuine in-process compile result required",
  );
  assert(
    proof.endWallMs >= proof.beginWallMs,
    "Compiler wall clock moved backwards",
  );
  assert(
    (await noLinks(out)) === proof.canonicalOut,
    "Compile output path differs",
  );
  assert(
    await observedQuiet(proof.observed, proof.groupId, {
      censusFactory: proof.censusFactory,
    }),
    "Siso writers must be quiescent",
  );
  await noLinks(out);
  const root = await lstat(out, { bigint: true });
  assert(
    ["dev", "ino", "uid", "mode"].every(
      (key) => root[key] === proof.outIdentity[key],
    ),
    "Compile output identity changed",
  );
  const file = path.join(out, "siso.INFO"),
    s = await optionalLinkStat(file);
  if (!s) return { removed: false, absent: true };
  assert(
    s.isSymbolicLink() &&
      s.nlink === 1n &&
      s.uid === root.uid &&
      s.uid === proof.uid,
    "Owned Siso log alias required",
  );
  const raw = await readlink(file);
  assert(
    Buffer.byteLength(raw) <= 2048 && path.isAbsolute(raw),
    "Bounded Siso log alias required",
  );
  const temporary = tmpdir(),
    canonicalTemporary = await realpath(temporary);
  assert(
    [temporary, canonicalTemporary].includes(path.dirname(raw)),
    "Siso log outside actual temporary directory",
  );
  const { prefix, ...identityFacts } = proof.loggerIdentity;
  checkpointLog(
    observeIdentity,
    Object.freeze({
      contract: "siso-glog-1.2.5",
      ...identityFacts,
      expectedPrefixSha256: sha(prefix),
      prefixMatched: path.basename(raw).startsWith(prefix),
    }),
  );
  assert(path.basename(raw).startsWith(prefix), "Foreign Siso log identity");
  const suffix = path.basename(raw).slice(prefix.length),
    match = /^(\d{8})-(\d{6})\.([1-9][0-9]*)$/.exec(suffix);
  assert(
    match && proof.observed.some((row) => row.pid === Number(match[3])),
    "Siso log PID not observed",
  );
  const digits = match[1] + match[2];
  const timestamp = Date.parse(
    `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}.000Z`,
  );
  assert(
    Number.isFinite(timestamp) &&
      new Date(timestamp)
        .toISOString()
        .replace(/[^0-9]/g, "")
        .slice(0, 14) === digits,
    "Invalid Siso UTC timestamp",
  );
  // Filename precision is exactly one second: both actual endpoints round down.
  assert(
    timestamp >= Math.floor(proof.beginWallMs / 1000) * 1000 &&
      timestamp <= Math.floor(proof.endWallMs / 1000) * 1000,
    "Siso timestamp outside actual compile window",
  );
  const record = {
    removed: false,
    absent: false,
    link: {
      target: raw,
      dev: String(s.dev),
      ino: String(s.ino),
      uid: String(s.uid),
    },
  };
  await beforeUnlink(record); // Persist fixed private evidence before mutation.
  assert(
    await observedQuiet(proof.observed, proof.groupId, {
      censusFactory: proof.censusFactory,
    }),
    "Siso writers returned",
  );
  await noLinks(out);
  assert(
    sameLinkIdentity(root, await lstat(out, { bigint: true })) &&
      sameLinkIdentity(s, await lstat(file, { bigint: true })) &&
      (await readlink(file)) === raw,
    "Siso log alias changed",
  );
  // Never stat, open, resolve or remove the outside log target.
  await unlink(file);
  assert((await optionalLinkStat(file)) === null, "Siso alias still present");
  return {
    removed: true,
    absent: false,
    link: {
      target: raw,
      dev: String(s.dev),
      ino: String(s.ino),
      uid: String(s.uid),
    },
  };
}

export async function normalizeSdkLinks(
  out,
  {
    developerDir,
    sdkRoot,
    expectedTargets,
    aliasAttestation,
    observe = () => {},
  },
) {
  let role = "layout";
  const check = (ok, reason, facts = {}) => {
    const record = { reason, role, ok: Boolean(ok), ...facts };
    observe(record);
    if (!ok) {
      const error = new Error("SDK layout check failed");
      error.sdkLayout = record;
      throw error;
    }
  };
  try {
    check(
      path.isAbsolute(developerDir) && path.isAbsolute(sdkRoot),
      "absolute-roots",
    );
    const developer = await realpath(developerDir),
      sdk = await realpath(sdkRoot);
    check(
      sdk.startsWith(
        path.join(
          developer,
          "Platforms",
          "MacOSX.platform",
          "Developer",
          "SDKs",
        ) + path.sep,
      ),
      "sdk-containment",
    );
    const specs = [
      {
        raw: sdkRoot,
        target: sdk,
        names: new Set([path.basename(sdkRoot), path.basename(sdk)]),
      },
      {
        raw: path.join(developerDir, "Platforms", "MacOSX.platform"),
        names: new Set(["MacOSX.platform"]),
      },
      {
        raw: path.join(developerDir, "Toolchains", "XcodeDefault.xctoolchain"),
        names: new Set(["XcodeDefault.xctoolchain"]),
      },
    ];
    check(
      [...specs[0].names].every((name) =>
        /^MacOSX(?:[0-9]+(?:\.[0-9]+)*)?\.sdk$/.test(name),
      ),
      "sdk-name",
    );
    check(
      Array.isArray(expectedTargets) &&
        expectedTargets.length === 3 &&
        new Set(expectedTargets).size === 3,
      "expected-targets",
    );
    for (const [index, spec] of specs.entries()) {
      role = ["sdk", "platform", "toolchain"][index];
      spec.target ??= await realpath(spec.raw);
      check(spec.target === expectedTargets[index], "physical-rebind");
      await noLinks(spec.target);
      check((await stat(spec.target)).isDirectory(), "physical-kind");
    }
    if (aliasAttestation !== undefined) {
      const aliases = await verifySelectedAliases(
        aliasAttestation,
        developerDir,
        sdkRoot,
        expectedTargets,
      );
      for (const [index, row] of aliases.entries()) {
        specs[index].names.add(row.name);
        specs[index].selectedRaw = row.raw;
      }
    }
    role = "layout";
    const directory = path.join(out, "sdk", "xcode_links");
    await noLinks(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    check(entries.length === 3, "entry-count", {
      count: Math.min(entries.length, 4),
    });
    const found = new Set(),
      validated = [];
    for (const entry of entries) {
      const matches = specs.filter((spec) => spec.names.has(entry.name));
      role =
        matches.length === 1
          ? ["sdk", "platform", "toolchain"][specs.indexOf(matches[0])]
          : "unknown";
      check(
        entry.isSymbolicLink() &&
          matches.length === 1 &&
          !found.has(matches[0]),
        "entry-kind-name",
        {
          symbolic: entry.isSymbolicLink(),
          knownName: matches.length === 1,
          duplicate: matches.length === 1 && found.has(matches[0]),
        },
      );
      const spec = matches[0],
        file = path.join(directory, entry.name),
        raw = await readlink(file);
      const physicalMatch = (await realpath(file)) === spec.target;
      check(
        path.isAbsolute(raw) &&
          (raw === spec.raw ||
            raw === spec.target ||
            raw === spec.selectedRaw) &&
          physicalMatch,
        "raw-target",
        {
          absolute: path.isAbsolute(raw),
          rawAlias: raw === spec.raw,
          canonical: raw === spec.target,
          physicalMatch,
        },
      );
      found.add(spec);
      validated.push({
        file,
        role,
        raw,
        target: spec.target,
        name: `sdk/xcode_links/${entry.name}`,
      });
    }
    // Validate every entry before changing ONLY our generated out/ links. Preserve
    // GN's raw link names; canonicalize target text so Python's strict physical
    // recipe remains unchanged. The source and installed SDK are never modified.
    if (aliasAttestation !== undefined)
      await verifySelectedAliases(
        aliasAttestation,
        developerDir,
        sdkRoot,
        expectedTargets,
      );
    for (const row of validated)
      if (row.raw !== row.target) {
        role = row.role;
        check(
          (await lstat(row.file)).isSymbolicLink() &&
            (await readlink(row.file)) === row.raw &&
            (await realpath(row.file)) === row.target,
          "changed-before-normalize",
        );
        await unlink(row.file);
        await symlink(
          row.target,
          row.file,
          process.platform === "win32" ? "junction" : "dir",
        );
      }
    for (const row of validated) {
      role = row.role;
      check(
        (await readlink(row.file)) === row.target &&
          (await realpath(row.file)) === row.target,
        "normalized-target",
      );
    }
    return Object.fromEntries(
      validated
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((row) => [row.name, row.target]),
    );
  } catch (error) {
    if (!error.sdkLayout) observe({ reason: "filesystem", role, ok: false });
    throw error;
  }
}

// Pinned GN150a9d6's target writer can emit one .ninja per eligible target;
// Actual Mac GN reported 34799 targets and exceeded 2GiB after only 11868
// graph files. Retain full graph coverage, with a reviewed finite I/O budget.
export const GRAPH_LIMITS = Object.freeze({
  files: 50000,
  bytes: 8 * 1024 ** 3,
  visited: 300000,
  milliseconds: 180000,
  fileBytes: 256 * 1024 ** 2,
  readers: 4,
});
export function assertGraphBudget({ files, bytes, visited, elapsed }) {
  assert(
    [files, bytes, visited].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
      Number.isFinite(elapsed) &&
      elapsed >= 0,
    "Invalid graph inventory counters",
  );
  if (!(
    files <= GRAPH_LIMITS.files &&
    bytes <= GRAPH_LIMITS.bytes &&
    visited <= GRAPH_LIMITS.visited &&
    elapsed < GRAPH_LIMITS.milliseconds
  ))
    throw Object.assign(new Error("Graph inventory bound"), {
      code: "GRAPH_BOUND",
      graphCounts: { files, bytes, visited },
    });
}
export function graphInventoryRecord(value) {
  shape(value, [
    "phase",
    "files",
    "bytes",
    "visited",
    "active",
    "elapsedMs",
    "categories",
    "completedHashedFiles",
    "completedHashedBytes",
  ]);
  assert(
    ["metadata", "hashing", "complete", "stopped"].includes(value.phase),
    "Invalid graph diagnostic phase",
  );
  for (const key of [
    "files",
    "bytes",
    "visited",
    "active",
    "elapsedMs",
    "completedHashedFiles",
    "completedHashedBytes",
  ])
    assert(
      Number.isSafeInteger(value[key]) && value[key] >= 0,
      "Invalid graph diagnostic counter",
    );
  assert(
    value.files <= GRAPH_LIMITS.files + 1 &&
      value.bytes <= (GRAPH_LIMITS.files + 1) * GRAPH_LIMITS.fileBytes &&
      value.visited <= GRAPH_LIMITS.visited + 1 &&
      value.active <= GRAPH_LIMITS.readers &&
      value.completedHashedFiles <= value.files &&
      value.completedHashedBytes <= value.bytes &&
      value.elapsedMs <= GRAPH_LIMITS.milliseconds,
    "Graph diagnostic bound",
  );
  shape(value.categories, ["args", "build", "toolchain", "target"]);
  let files = 0,
    bytes = 0;
  for (const category of Object.values(value.categories)) {
    shape(category, ["files", "bytes"]);
    assert(
      Number.isSafeInteger(category.files) &&
        category.files >= 0 &&
        Number.isSafeInteger(category.bytes) &&
        category.bytes >= 0,
      "Invalid graph category",
    );
    files += category.files;
    bytes += category.bytes;
  }
  assert(
    files === value.files && bytes === value.bytes,
    "Graph diagnostic totals",
  );
  return canonical(value);
}
export async function graphInventory(
  root,
  {
    observe = () => {},
    observePins,
    signal,
    timeoutMs = GRAPH_LIMITS.milliseconds,
  } = {},
) {
  assert(
    Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= GRAPH_LIMITS.milliseconds,
    "Invalid graph deadline",
  );
  const began = performance.now();
  const controller = new AbortController();
  let visited = 0,
    totalBytes = 0,
    active = 0,
    peak = 0,
    metadataScheduled = 0,
    completedHashedFiles = 0,
    completedHashedBytes = 0,
    emitted = 0,
    nextProgress = began + 10000;
  const candidates = [],
    pins = [],
    pending = [root];
  const categories = Object.fromEntries(
    ["args", "build", "toolchain", "target"].map((key) => [
      key,
      { files: 0, bytes: 0 },
    ]),
  );
  const counts = () => ({
    files: candidates.length,
    bytes: totalBytes,
    visited,
  });
  const bound = () =>
    Object.assign(new Error("Graph inventory bound"), {
      code: "GRAPH_BOUND",
      graphCounts: counts(),
    });
  const stop = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const externalAbort = () => stop(bound());
  signal?.addEventListener("abort", externalAbort, { once: true });
  if (signal?.aborted) externalAbort();
  // This single timer covers metadata, hashing and cleanup. Tests may shorten
  // it; neither a caller nor a workflow can extend the reviewed upper bound.
  const timer = setTimeout(() => stop(bound()), timeoutMs);
  const check = (includeBytes = true) => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (performance.now() - began >= timeoutMs) {
      stop(bound());
      throw controller.signal.reason;
    }
    try {
      assertGraphBudget({
        ...counts(),
        bytes: includeBytes ? totalBytes : 0,
        elapsed: performance.now() - began,
      });
    } catch (error) {
      // Metadata may exceed the content-read budget while bounded enumeration
      // finishes. Any other limit still reports the actual measured bytes.
      if (error.code === "GRAPH_BOUND") error.graphCounts = counts();
      throw error;
    }
  };
  const emit = (phase) => {
    // Reserve both terminal records for a synchronous complete observer that
    // itself expires the deadline. Never emit unbounded per-file telemetry.
    if (emitted >= (phase === "complete" || phase === "stopped" ? 36 : 34))
      return;
    emitted++;
    observe(
      Object.freeze({
        phase,
        ...counts(),
        active,
        completedHashedFiles,
        completedHashedBytes,
        elapsedMs: Math.min(
          GRAPH_LIMITS.milliseconds,
          Math.floor(performance.now() - began),
        ),
        categories: Object.freeze(
          Object.fromEntries(
            Object.entries(categories).map(([key, value]) => [
              key,
              Object.freeze({ ...value }),
            ]),
          ),
        ),
      }),
    );
  };
  const same = (a, b) =>
    a.isFile() &&
    b.isFile() &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ino === b.ino &&
    a.dev === b.dev;
  const workers = [],
    metadataWorkers = new Set();
  async function admitMetadata(file, name) {
    try {
      check(false);
      await noLinks(file);
      check(false);
      const metadata = await stat(file);
      check(false);
      assert(
        metadata.isFile() &&
          metadata.size > 0 &&
          metadata.size <= GRAPH_LIMITS.fileBytes,
        "Checkpoint asset size",
      );
      candidates.push({ file, path: path.relative(root, file), metadata });
      totalBytes += metadata.size;
      const category =
        name === "args.gn"
          ? "args"
          : name === "build.ninja"
            ? "build"
            : name === "toolchain.ninja"
              ? "toolchain"
              : "target";
      categories[category].files++;
      categories[category].bytes += metadata.size;
      check(false);
    } catch (error) {
      stop(error);
      throw error;
    }
  }
  async function scheduleMetadata(file, name) {
    check(false);
    if (++metadataScheduled > GRAPH_LIMITS.files) throw bound();
    while (metadataWorkers.size >= GRAPH_LIMITS.readers) {
      await Promise.race(metadataWorkers);
      check(false);
    }
    const work = admitMetadata(file, name);
    metadataWorkers.add(work);
    const remove = () => metadataWorkers.delete(work);
    void work.then(remove, remove);
  }
  try {
    while (pending.length) {
      check(false);
      const directory = pending.pop();
      for (const item of await readdir(directory, { withFileTypes: true })) {
        visited++;
        check(false);
        // Links are not used as graph authority and will fail closed at pack time.
        if (item.isSymbolicLink()) continue;
        const file = path.join(directory, item.name);
        if (item.isDirectory()) pending.push(file);
        else if (item.name.endsWith(".ninja") || item.name === "args.gn") {
          await scheduleMetadata(file, item.name);
        }
      }
    }
    await Promise.all(metadataWorkers);
    check(false);
    emit("metadata");
    check();
    nextProgress = performance.now() + 10000;
    assert(
      candidates.some((p) => p.path === "build.ninja") &&
        candidates.some((p) => p.path === "args.gn"),
      "Fresh complete GN graph required",
    );
    let next = 0;
    async function worker() {
      while (next < candidates.length) {
        check();
        const candidate = candidates[next++];
        let handle, stream;
        active++;
        try {
          if (active > peak) {
            peak = active;
            emit("hashing");
          }
          check();
          await noLinks(candidate.file);
          check();
          const before = await stat(candidate.file);
          check();
          assert(same(candidate.metadata, before), "Checkpoint asset changed");
          handle = await open(candidate.file, "r");
          check();
          assert(same(before, await handle.stat()), "Checkpoint asset changed");
          check();
          stream = handle.createReadStream({
            autoClose: false,
            signal: controller.signal,
          });
          const hash = createHash("sha256");
          for await (const block of stream) {
            check();
            hash.update(block);
          }
          assert(
            same(before, await handle.stat()) &&
              same(before, await stat(candidate.file)),
            "Checkpoint asset changed",
          );
          check();
          pins.push({
            path: candidate.path,
            name: path.basename(candidate.file),
            bytes: before.size,
            sha256: hash.digest("hex"),
          });
          completedHashedFiles++;
          completedHashedBytes += before.size;
          if (performance.now() >= nextProgress) {
            nextProgress = performance.now() + 10000;
            emit("hashing");
          }
        } catch (error) {
          stop(error);
          throw error;
        } finally {
          try {
            if (stream) {
              stream.destroy();
              await finished(stream).catch(() => {});
            }
            await handle?.close();
          } finally {
            active--;
          }
        }
      }
    }
    for (
      let index = 0;
      index < Math.min(GRAPH_LIMITS.readers, candidates.length);
      index++
    )
      workers.push(worker());
    await Promise.all(workers);
    check();
    assert(pins.length === candidates.length, "Complete graph pins required");
    const digest = sha(
      canonical(
        pins.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      ),
    );
    check();
    emit("complete");
    check();
    if (observePins) {
      try {
        await observePins({
          sha256: digest,
          files: pins.length,
          bytes: totalBytes,
          pins: pins.map(({ path, name, bytes, sha256 }) => ({
            path,
            name,
            bytes,
            sha256,
          })),
        });
      } catch {
        // Optional diagnostics never replace graph admission or its first error.
      }
      check(); // The same absolute inventory deadline also covers this awaited work.
    }
    return {
      files: pins.length,
      bytes: totalBytes,
      visited,
      sha256: digest,
    };
  } catch (error) {
    stop(error);
    await Promise.allSettled([...metadataWorkers, ...workers]);
    try {
      emit("stopped");
    } catch {
      /* Preserve the original inventory failure. */
    }
    throw controller.signal.reason;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", externalAbort);
  }
}
export async function graphDigest(root) {
  return (await graphInventory(root)).sha256;
}

export async function verifyGraph(root, expected, options) {
  assert(
    hex(expected) && (await graphInventory(root, options)).sha256 === expected,
    "Checkpoint graph differs from verified fresh GN",
  );
}
export async function withVerifiedGraph(
  root,
  expected,
  operation,
  { log } = {},
) {
  const verify = (phase) =>
    log
      ? checkpointPhase(
          phase,
          () =>
            verifyGraph(root, expected, {
              observe: (value) =>
                checkpointLog(
                  log,
                  `[cef-engineering-checkpoint] checkpoint graph=${graphInventoryRecord(value)}`,
                ),
            }),
          log,
        )
      : verifyGraph(root, expected);
  await verify("graph-before");
  const result = await operation();
  await verify("graph-after");
  return result;
}
const RESTORE_STAGES = new Set([
  "proof-read",
  "manifest-read",
  "manifest-digest",
  "proof-match",
  "manifest-validation",
  "disk-capacity",
  "archive-restore",
  "archive-result",
  "restored-graph",
  "adjacent-install",
  "fresh-gn",
  "fresh-graph",
  "generated-bindings",
  "identity-comparison",
  "graph-snapshot",
]);
const RESTORE_FIELDS = [
  "producer",
  "source",
  "target",
  "image",
  "tools",
  "graph",
  "siso",
  "canonicalRoot",
];
const restoreObservers = new WeakSet();
export function createRestoreObserver(sink = () => {}) {
  if (restoreObservers.has(sink)) return sink;
  let count = 0,
    bytes = 0;
  const observe = async (input) => {
    try {
      assert(RESTORE_STAGES.has(input?.stage), "Closed restore stage");
      assert(
        ["begin", "complete", "failed", "unavailable"].includes(input.event),
        "Closed restore event",
      );
      const record = {
        kind: "sorng-cef-checkpoint-restore-diagnostic",
        stage: input.stage,
        event: input.event,
        errorCode: [
          "ENOENT",
          "EACCES",
          "EPERM",
          "EIO",
          "ENOSPC",
          "EEXIST",
          "ETIMEDOUT",
        ].includes(input.errorCode)
          ? input.errorCode
          : input.event === "failed"
            ? "GUARD_FAILED"
            : input.event === "unavailable"
              ? "UNAVAILABLE"
              : "NONE",
      };
      if (input.stage === "identity-comparison") {
        record.available = input.comparison?.available === true;
        if (!record.available) {
          record.event = "unavailable";
          record.errorCode = "INVALID_METADATA";
        }
        if (record.available) {
          shape(input.comparison.matches, RESTORE_FIELDS);
          assert(
            RESTORE_FIELDS.every(
              (field) => typeof input.comparison.matches[field] === "boolean",
            ),
            "Closed identity matches",
          );
          record.matches = Object.fromEntries(
            RESTORE_FIELDS.map((field) => [
              field,
              input.comparison.matches[field],
            ]),
          );
        }
      }
      const size = Buffer.byteLength(canonical(record) + "\n");
      if (
        count >= 32 ||
        (count >= 31 && record.event !== "failed") ||
        bytes + size > 64 * 1024
      )
        return;
      count++;
      bytes += size;
      await sink(record);
    } catch {
      // Observer failures are never restore admission or the primary failure.
    }
  };
  restoreObservers.add(observe);
  return observe;
}
export async function restorePhase(observer, stage, operation) {
  const observe = createRestoreObserver(observer);
  await observe({ stage, event: "begin" });
  try {
    const value = await operation();
    await observe({ stage, event: "complete" });
    return value;
  } catch (error) {
    let errorCode;
    try {
      errorCode = error?.code;
    } catch {}
    await observe({ stage, event: "failed", errorCode });
    throw error;
  }
}
export function restoreIdentityComparison(fresh, priorManifest) {
  try {
    validateIdentity(fresh);
    validateManifest(priorManifest);
    return {
      available: true,
      matches: Object.fromEntries(
        RESTORE_FIELDS.map((field) => [
          field,
          fresh[field] === priorManifest.identity[field],
        ]),
      ),
    };
  } catch {
    return { available: false };
  }
}
export function graphPinSnapshot(value) {
  shape(value, ["sha256", "files", "bytes", "pins"]);
  assert(
    hex(value.sha256) &&
      Number.isSafeInteger(value.files) &&
      value.files > 0 &&
      value.files <= GRAPH_LIMITS.files &&
      Array.isArray(value.pins) &&
      value.pins.length === value.files,
    "Bounded graph pin count",
  );
  assert(
    Number.isSafeInteger(value.bytes) &&
      value.bytes >= 0 &&
      value.bytes <= GRAPH_LIMITS.bytes,
    "Bounded graph pin bytes",
  );
  let previous = "",
    total = 0,
    encodedBytes = 0;
  const rows = [];
  for (const row of value.pins) {
    shape(row, ["path", "name", "bytes", "sha256"]);
    assert(
      typeof row.path === "string" &&
        row.path.length > 0 &&
        row.path.length <= 4096 &&
        !/[\\:\x00-\x1f\x7f]/.test(row.path) &&
        !row.path.startsWith("/") &&
        row.path
          .split("/")
          .every((part) => part && part !== "." && part !== "..") &&
        row.path > previous,
      "Canonical relative graph pin",
    );
    assert(
      row.name === path.posix.basename(row.path) &&
        (row.name === "args.gn" || row.name.endsWith(".ninja")) &&
        hex(row.sha256),
      "Declared graph pin kind",
    );
    assert(
      Number.isSafeInteger(row.bytes) &&
        row.bytes >= 0 &&
        row.bytes <= GRAPH_LIMITS.fileBytes,
      "Bounded graph pin size",
    );
    previous = row.path;
    total += row.bytes;
    const copy = {
      path: row.path,
      name: row.name,
      bytes: row.bytes,
      sha256: row.sha256,
    };
    encodedBytes += Buffer.byteLength(canonical(copy)) + 1;
    assert(
      encodedBytes <= 16 * 1024 ** 2 - 1024,
      "Graph pin snapshot byte bound",
    );
    rows.push(copy);
  }
  assert(
    total === value.bytes && sha(canonical(rows)) === value.sha256,
    "Complete graph snapshot digest",
  );
  const result = canonical({
    kind: "sorng-cef-fresh-graph-pins",
    complete: true,
    files: value.files,
    bytes: value.bytes,
    sha256: value.sha256,
    pins: rows,
  });
  assert(
    Buffer.byteLength(result) <= 16 * 1024 ** 2,
    "Graph pin snapshot byte bound",
  );
  return result;
}
// Committer epoch from pinned CEF682c; reproducibility input, never the operation clock.
export const SOURCE_METADATA_DATE_EPOCH = "1790626028";
// Only the complete owned-source sidecar; ordinary/external metadata stays128MiB.
export const SOURCE_METADATA_MAX_BYTES = 1536 * 1024 ** 2;
// A new Linux ARM producer seeds this sidecar; old checkpoints never gain it retroactively.
export function sourceMetadataPlan(identity, out, mode) {
  validateIdentity(identity);
  if (identity.target === "aarch64-apple-darwin")
    return macSourceMetadataPlan(identity, out, mode);
  if (identity.target === "x86_64-apple-darwin")
    return macIntelSourceMetadataPlan(identity, out, mode);
  assert(
    identity.target === "aarch64-unknown-linux-gnu",
    "Linux ARM source metadata only",
  );
  assert(
    ["source-record", "source-apply", "source-verify"].includes(mode),
    "Closed source metadata mode",
  );
  assert(
    identity.canonicalRoot.startsWith("/") &&
      !identity.canonicalRoot.includes("\\") &&
      path.posix.normalize(identity.canonicalRoot) === identity.canonicalRoot,
    "Canonical Linux source root",
  );
  const source = path.posix.join(identity.canonicalRoot, "source");
  assert(
    out === path.posix.join(source, "src", "out", "Release_GN_arm64"),
    "Fixed source metadata output",
  );
  return {
    mode,
    source,
    sidecar: path.posix.join(out, ".siso_sorng_source_metadata.json"),
  };
}
export function sourceMetadataResult(value, mode) {
  assert(
    ["source-record", "source-apply", "source-verify"].includes(mode),
    "Closed source metadata mode",
  );
  // Linux results carry per-phase timings; Mac results never do.
  const timed = Object.hasOwn(value ?? {}, "timing");
  shape(value, [
    ...(mode === "source-record"
      ? ["complete", "mode", "entries", "bytes", "sidecar"]
      : ["complete", "mode", "entries", "bytes"]),
    ...(timed ? ["timing"] : []),
  ]);
  if (timed) {
    shape(value.timing, [
      "phases",
      "hashedFiles",
      "hashedBytes",
      "reusedFiles",
    ]);
    assert(
      sourcePhases(value.timing.phases) &&
        sourceCount(value.timing.hashedFiles) &&
        sourceCount(value.timing.hashedBytes) &&
        sourceCount(value.timing.reusedFiles),
      "Bounded source metadata timing",
    );
  }
  assert(
    value.complete === true &&
      value.mode === mode &&
      Number.isSafeInteger(value.entries) &&
      value.entries >= 1 &&
      value.entries <= 3000000 &&
      Number.isSafeInteger(value.bytes) &&
      value.bytes >= 0 &&
      value.bytes <= 256 * 1024 ** 3,
    "Complete bounded source metadata required",
  );
  if (mode === "source-record") {
    shape(value.sidecar, ["name", "bytes", "sha256"]);
    assert(
      value.sidecar.name === ".siso_sorng_source_metadata.json" &&
        positive(value.sidecar.bytes) &&
        value.sidecar.bytes <= SOURCE_METADATA_MAX_BYTES &&
        hex(value.sidecar.sha256),
      "Fixed source sidecar pin",
    );
  }
  return value;
}

export async function restoreVerifiedGraph({
  fresh,
  restored,
  expectedGraph,
  revalidateGn,
  verifyGenerated,
  observe,
  beforeAuthoritativeGn,
  afterAuthoritativeGn,
}) {
  assert(
    typeof revalidateGn === "function" && typeof verifyGenerated === "function",
    "Genuine GN and SDK revalidation required",
  );
  await restorePhase(observe, "restored-graph", () =>
    verifyGraph(restored, expectedGraph),
  );
  await restorePhase(observe, "adjacent-install", () =>
    installRestoredDirectory(fresh, restored),
  );
  // Optional new-producer source metadata is applied only after verified install.
  if (beforeAuthoritativeGn !== undefined) {
    assert(
      typeof beforeAuthoritativeGn === "function",
      "Source metadata callback",
    );
    await beforeAuthoritativeGn();
  }
  // Cached gen/ files never supersede the CURRENT source/tool evaluation.
  await restorePhase(observe, "fresh-gn", revalidateGn);
  await restorePhase(observe, "fresh-graph", () =>
    verifyGraph(fresh, expectedGraph),
  );
  await restorePhase(observe, "generated-bindings", verifyGenerated);
  if (afterAuthoritativeGn !== undefined) {
    assert(
      typeof afterAuthoritativeGn === "function",
      "Source metadata callback",
    );
    await afterAuthoritativeGn();
  }
}
export async function installRestoredDirectory(fresh, verified) {
  await noLinks(fresh);
  await noLinks(verified);
  assert(
    path.dirname(fresh) === path.dirname(verified) &&
      path.basename(verified) === "checkpoint-restored",
    "Adjacent verified restore required",
  );
  const saved = `${fresh}.fresh-gn`;
  await rename(fresh, saved); // Retain original fresh GN output; never recursive deletion.
  try {
    await rename(verified, fresh);
  } catch (error) {
    await rename(saved, fresh);
    throw error;
  }
}

export async function boundedResponse(response, maximum) {
  assert(response.ok, "Download failed");
  const declared = response.headers.get("content-length");
  if (declared !== null)
    assert(
      /^[0-9]+$/.test(declared) && Number(declared) <= maximum,
      "Download length bound",
    );
  const parts = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    assert(bytes <= maximum, "Download byte bound");
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}
// Only this function follows API download redirects; credentials never follow.
export async function downloadAsset(
  repository,
  token,
  route,
  output,
  expected,
  {
    request = fetch,
    maximum = LIMITS.chunk,
    deadline = Date.now() + 20 * 60_000,
    createOutput = createWriteStream,
  } = {},
) {
  assert(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
      Date.now() < deadline,
    "Download repository/deadline",
  );
  assert(
    /^\/(actions\/artifacts\/[1-9][0-9]*\/zip|releases\/assets\/[1-9][0-9]*)$/.test(
      route,
    ),
    "Closed same-repository download route required",
  );
  assert(
    positive(expected.bytes) &&
      expected.bytes <= maximum &&
      hex(expected.sha256),
    "Expected immutable download digest required",
  );
  const first = await request(
    `https://api.github.com/repos/${repository}${route}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: route.startsWith("/actions/artifacts/")
          ? "application/vnd.github+json"
          : "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(30000, deadline - Date.now())),
    },
  );
  let response = first;
  if (first.status === 302) {
    await first.body?.cancel();
    const location = first.headers.get("location");
    let url;
    try {
      url = new URL(location);
    } catch {
      throw new Error("Invalid asset redirect");
    }
    assert(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.hash &&
        downloadHost(url.hostname),
      "Unreviewed asset download domain",
    );
    // No auth/header inheritance, no signed URL logging, no second redirect.
    response = await request(url, {
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(600000, deadline - Date.now())),
    });
  }
  assert(response.ok, "Asset download failed");
  const hash = createHash("sha256");
  let bytes = 0;
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const input = Readable.from(response.body);
  const stream = createOutput(output, { flags: "wx" });
  // pipeline owns destination errors from the first tick and cancels/joins the
  // input on any writer/hash/deadline failure; no per-drain listener pair leaks.
  try {
    await pipeline(
      input,
      async function* checked(source) {
        for await (const part of source) {
          assert(Date.now() < deadline, "Asset deadline");
          bytes += part.length;
          assert(
            bytes <= expected.bytes && bytes <= maximum,
            "Downloaded asset bound",
          );
          hash.update(part);
          yield part;
        }
      },
      stream,
      { signal },
    );
    assert(
      bytes === expected.bytes && hash.digest("hex") === expected.sha256,
      "Downloaded asset digest mismatch",
    );
  } catch (error) {
    if (signal.aborted) throw new Error("Asset deadline");
    throw error;
  }
}
export async function restoreDownload(
  api,
  {
    repository,
    token,
    runId,
    destination,
    python,
    helper,
    request = fetch,
    target = TARGET,
  },
) {
  assert(positive(runId), "Explicit producer run required");
  const downloadDeadline = Date.now() + 20 * 60_000;
  const run = await api(`actions/runs/${runId}`),
    repo = await api("");
  const producer = {
    repository,
    repositoryId: repo.id,
    runId,
    attempt: run.run_attempt,
    head: run.head_sha,
    branch: repo.default_branch,
    workflow: WORKFLOW,
  };
  await verifyProducer(api, producer);
  assert(
    run.status === "completed" &&
      ["success", "failure"].includes(run.conclusion),
    "Completed trusted producer required",
  );
  const listing = await api(`actions/runs/${runId}/artifacts?per_page=100`);
  assert(listing.total_count <= 100, "Artifact listing bound");
  const matches = listing.artifacts.filter(
    (a) => a.name === `cef-engineering-seal-${runId}-${producer.attempt}`,
  );
  assert(
    matches.length === 1,
    "Exactly one independent seal artifact required",
  );
  const artifact = matches[0];
  assert(
    !artifact.expired &&
      positive(artifact.id) &&
      positive(artifact.size_in_bytes) &&
      artifact.size_in_bytes < LIMITS.seal &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") &&
      artifact.workflow_run?.head_sha === producer.head,
    "Independent artifact digest/producer required",
  );
  await mkdir(destination);
  await noLinks(destination);
  const zip = path.join(destination, "seal.zip");
  await downloadAsset(
    repository,
    token,
    `/actions/artifacts/${artifact.id}/zip`,
    zip,
    { bytes: artifact.size_in_bytes, sha256: artifact.digest.slice(7) },
    { request, maximum: LIMITS.seal, deadline: downloadDeadline },
  );
  const seal = await archiveCommand(
    python,
    helper,
    ["seal", "--input", zip, "--output", destination],
    { timeout: 15000 },
  );
  validateSeal(seal, producer, target);
  const release = await api(`releases/${seal.release.id}`);
  assert(
    release.draft === true &&
      release.prerelease === true &&
      release.tag_name === seal.release.tag &&
      release.target_commitish === transportHead(seal, producer),
    "Draft checkpoint identity changed",
  );
  const names = new Set(seal.assets.map((a) => a.name));
  const releaseAssets = await api(
    `releases/${seal.release.id}/assets?per_page=100`,
  );
  assert(
    Array.isArray(releaseAssets) && releaseAssets.length === names.size,
    "Draft asset set changed",
  );
  const ordered = [...seal.assets].sort((a, b) =>
    a.name === "manifest.json" ? -1 : b.name === "manifest.json" ? 1 : 0,
  );
  let manifest;
  for (const row of ordered) {
    const observed = releaseAssets.find((a) => a.id === row.id);
    assert(
      observed &&
        observed.name === row.name &&
        observed.size === row.bytes &&
        observed.digest === `sha256:${row.sha256}` &&
        observed.state === "uploaded",
      "Mutable draft no longer matches independent seal",
    );
    await downloadAsset(
      repository,
      token,
      `/releases/assets/${row.id}`,
      path.join(destination, row.name),
      row,
      {
        request,
        deadline: downloadDeadline,
        maximum:
          row.name === "inventory.json"
            ? LIMITS.metadata
            : row.name === "manifest.json"
              ? LIMITS.seal
              : LIMITS.chunk,
      },
    );
    if (row.name === "manifest.json") {
      const bytes = await readFile(path.join(destination, row.name));
      assert(
        bytes.length === seal.manifest.bytes &&
          sha(bytes) === seal.manifest.sha256,
        "Manifest differs from independent seal",
      );
      manifest = validateManifest(JSON.parse(bytes));
      assert(
        manifest.identity.target === target,
        "Cross-target checkpoint restore",
      );
      assert(
        canonical(manifest.producer) === canonical(producer) &&
          manifest.identitySha256 === seal.identitySha256,
        "Manifest producer differs from seal",
      );
      await verifyProducerCode(api, producer, manifest.identity.producer);
    }
  }
  const manifestBytes = await readFile(path.join(destination, "manifest.json"));
  assert(
    manifestBytes.length === seal.manifest.bytes &&
      sha(manifestBytes) === seal.manifest.sha256,
    "Manifest differs from independent seal",
  );
  assert(manifest, "Sealed manifest missing");
  assert(
    canonical(manifest.producer) === canonical(producer) &&
      manifest.identitySha256 === seal.identitySha256,
    "Manifest producer differs from seal",
  );
  assert(
    canonical(
      [...manifest.archive.chunks, manifest.archive.inventory, seal.manifest]
        .map((a) => a.name)
        .sort(),
    ) === canonical([...names].sort()),
    "Sealed unexpected asset",
  );
  return {
    manifest,
    producer,
    sealArtifact: { id: artifact.id, sha256: artifact.digest.slice(7) },
    nativeAcceptance: false,
    runtimeReady: false,
  };
}

// A completed SDK is a distinct authority from a resumable out/ checkpoint.
export const SDK_ASSET_MAX = 2 * 1024 ** 3 - 1;
export const SDK_ARCHIVE = `sorng-cef-custom-${SOURCE_ID}-${TARGET}.tar.bz2`;
export const SDK_NAMES = Object.freeze([
  "source-lock.json",
  "manifest.json",
  "receipt.json",
  SDK_ARCHIVE,
  "runtime.json",
]);
export function sdkArchive(target = TARGET) {
  const profile = checkpointProfile(target);
  return `sorng-cef-custom-${profile.source}-${profile.target}.tar.bz2`;
}
export function sdkNames(target = TARGET) {
  return [
    "source-lock.json",
    "manifest.json",
    "receipt.json",
    sdkArchive(target),
    "runtime.json",
  ];
}
export function sdkSealName(producer, target = TARGET) {
  const profile = checkpointProfile(target);
  return `cef-engineering-sdk-seal-${profile.source}-${profile.target}-${producer.runId}-${producer.attempt}`;
}
export function sdkPin(value, target = TARGET) {
  shape(value, ["name", "bytes", "sha256"]);
  assert(
    sdkNames(target).includes(value.name) &&
      positive(value.bytes) &&
      value.bytes <=
        (value.name === sdkArchive(target) ? SDK_ASSET_MAX : 16 * 1024 ** 2) &&
      hex(value.sha256),
    "Invalid SDK asset pin",
  );
}
export function completionSha(value) {
  return sha(canonical(value) + "\n");
}
export function validateSdkCompletion(value) {
  shape(value, [
    "schemaVersion",
    "kind",
    "producer",
    "identity",
    "identitySha256",
    "target",
    "sourceLockSha256",
    "compile",
    "distributionExitCode",
    "bundleVerified",
    "bundleAssets",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  assert(
    value.schemaVersion === 1 &&
      value.kind === "sorng-cef-engineering-sdk-completion" &&
      value.sourceLockSha256 === checkpointProfile(value.target).source &&
      value.identity.target === value.target &&
      value.nativeAcceptance === false &&
      value.runtimeReady === false,
    "Closed completed SDK proof required",
  );
  assert(
    validateIdentity(value.identity) === value.identitySha256 &&
      value.producer.workflow === WORKFLOW,
    "SDK source/producer identity",
  );
  shape(value.producer, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
  ]);
  assert(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.producer.repository) &&
      positive(value.producer.repositoryId) &&
      positive(value.producer.runId) &&
      positive(value.producer.attempt) &&
      /^[a-f0-9]{40}$/.test(value.producer.head) &&
      typeof value.producer.branch === "string" &&
      value.producer.branch.length > 0 &&
      value.producer.branch.length <= 256,
    "Invalid SDK producer identity",
  );
  validateCompile(value.compile);
  assert(
    value.compile.outcome === "compiler-complete" &&
      value.compile.exitCode === 0 &&
      value.compile.quiescent === true &&
      value.distributionExitCode === 0 &&
      value.bundleVerified === true,
    "Partial/failed compiler or packaging is not SDK authority",
  );
  assert(
    Array.isArray(value.bundleAssets) && value.bundleAssets.length === 5,
    "Complete five-file SDK bundle required",
  );
  for (const row of value.bundleAssets) sdkPin(row, value.target);
  assert(
    new Set(value.bundleAssets.map((row) => row.name)).size === 5 &&
      sdkNames(value.target).every((name) =>
        value.bundleAssets.some((row) => row.name === name),
      ),
    "SDK bundle names differ",
  );
  return value;
}
export function createSdkCompletion({
  producer,
  identity,
  compile,
  distributionExitCode,
  checked,
}) {
  assert(
    checked.descriptor.target === identity.target &&
      checked.identity.sourceLockSha256 ===
        checkpointProfile(identity.target).source,
    "Verified SDK differs from reviewed source",
  );
  const value = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-sdk-completion",
    producer,
    identity,
    identitySha256: validateIdentity(identity),
    target: identity.target,
    sourceLockSha256: checkpointProfile(identity.target).source,
    compile,
    distributionExitCode,
    bundleVerified: true,
    bundleAssets: checked.assets
      .map((row) => ({ name: row.name, bytes: row.size, sha256: row.sha256 }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    nativeAcceptance: false,
    runtimeReady: false,
  };
  return validateSdkCompletion(value);
}
export function validateSdkSeal(seal, producer) {
  shape(seal, [
    "schemaVersion",
    "kind",
    "producer",
    "release",
    "completion",
    "completionSha256",
    "assets",
    ...(seal?.schemaVersion === 2 ? ["transport"] : []),
  ]);
  assert(
    [1, 2].includes(seal.schemaVersion) &&
      seal.kind === "sorng-cef-engineering-sdk-seal" &&
      canonical(seal.producer) === canonical(producer),
    "SDK seal producer mismatch",
  );
  if (seal.schemaVersion === 2) {
    validateTechnicalTransport(seal.transport);
    assert(
      producer.branch === seal.transport.defaultBranch,
      "Technical transport producer branch mismatch",
    );
  }
  validateSdkCompletion(seal.completion);
  assert(
    canonical(seal.completion.producer) === canonical(producer) &&
      completionSha(seal.completion) === seal.completionSha256,
    "SDK completion digest mismatch",
  );
  shape(seal.release, ["id", "tag"]);
  assert(
    positive(seal.release.id) &&
      seal.release.tag ===
        `cef-sdk-checkpoint-${seal.completion.target}-${seal.completion.identitySha256.slice(0, 16)}-${producer.runId}-${producer.attempt}`,
    "SDK draft mismatch",
  );
  assert(
    Array.isArray(seal.assets) && seal.assets.length === 5,
    "SDK sealed asset set",
  );
  const ids = new Set();
  for (const row of seal.assets) {
    shape(row, ["id", "name", "bytes", "sha256"]);
    sdkPin(
      { name: row.name, bytes: row.bytes, sha256: row.sha256 },
      seal.completion.target,
    );
    assert(positive(row.id) && !ids.has(row.id), "SDK asset id");
    ids.add(row.id);
  }
  assert(
    canonical(
      seal.assets
        .map(({ id, ...row }) => row)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    ) === canonical(seal.completion.bundleAssets),
    "SDK assets differ from completion",
  );
  return seal;
}
export async function uploadSdkBundle(
  api,
  { bundle, completion, producer, observer, censusFactory },
) {
  assert(
    censusFactory === undefined ||
      (macCensusFactories.has(censusFactory) &&
        !macCensusFactories.get(censusFactory).proofOnly),
    "CENSUS_CAPABILITY",
  );
  const observe = createUploadObserver(observer);
  return uploadPhase(observe, "upload", async () => {
    await uploadPhase(observe, "state-validation", async () => {
      validateSdkCompletion(completion);
      assert(
        canonical(completion.producer) === canonical(producer),
        "Current SDK producer mismatch",
      );
    });
    await uploadPhase(observe, "producer-validation", () =>
      verifyProducer(api, producer),
    );
    await uploadPhase(observe, "code-validation", () =>
      verifyProducerCode(api, producer, completion.identity.producer),
    );
    await uploadPhase(observe, "quiescence", async () => {
      assert(
        await observedQuiet(
          completion.compile.observed,
          completion.compile.groupId,
          { censusFactory },
        ),
        "SDK compiler no longer quiescent",
      );
    });
    for (const pin of completion.bundleAssets)
      await uploadPhase(observe, "asset-verification", async () =>
        assert(
          canonical(
            await filePin(
              path.join(bundle, pin.name),
              pin.name === sdkArchive(completion.target)
                ? SDK_ASSET_MAX
                : 16 * 1024 ** 2,
            ),
          ) === canonical(pin),
          "SDK upload bytes changed",
        ),
      );
    const tag = `cef-sdk-checkpoint-${completion.target}-${completion.identitySha256.slice(0, 16)}-${producer.runId}-${producer.attempt}`;
    const transport = await resolveTechnicalTransport(api, producer);
    const release = await api("releases", {
      method: "POST",
      body: {
        tag_name: tag,
        target_commitish: transport.carrierHead,
        name: tag,
        draft: true,
        prerelease: true,
        make_latest: "false",
        body: `Completed SDK byte transport only. Technical container ${transport.carrierHead}; immutable build source ${producer.head}, run ${producer.runId}, attempt ${producer.attempt}. Native acceptance and runtime publication remain separate.`,
      },
    });
    await uploadPhase(observe, "response-validation", async () =>
      assert(
        positive(release.id) &&
          release.draft === true &&
          release.prerelease === true &&
          release.tag_name === tag &&
          release.target_commitish === transport.carrierHead,
        "Unexpected SDK transport draft",
      ),
    );
    const assets = [];
    for (const pin of completion.bundleAssets) {
      const uploaded = await uploadAssetWithRecovery(
        api,
        release.id,
        pin,
        bundle,
      );
      await uploadPhase(observe, "response-validation", async () =>
        assert(
          uploaded.name === pin.name &&
            uploaded.size === pin.bytes &&
            uploaded.digest === `sha256:${pin.sha256}` &&
            uploaded.state === "uploaded" &&
            positive(uploaded.id),
          "SDK uploaded asset mismatch",
        ),
      );
      assets.push({ id: uploaded.id, ...pin });
    }
    await verifyTechnicalReadback(api, release.id, tag, transport, assets);
    return validateSdkSeal(
      {
        schemaVersion: 2,
        kind: "sorng-cef-engineering-sdk-seal",
        producer,
        transport,
        release: { id: release.id, tag },
        completion,
        completionSha256: completionSha(completion),
        assets,
      },
      producer,
    );
  });
}
export async function downloadSdkBundle(
  api,
  {
    selection,
    repository,
    token,
    destination,
    python,
    helper,
    request = fetch,
  },
) {
  assert(
    selection.producer === "engineering-sdk" &&
      checkpointProfile(selection.target).target === selection.target &&
      positive(selection.runAttempt),
    "Explicit completed engineering SDK selection required",
  );
  const [run, repo] = await Promise.all([
    api(`actions/runs/${selection.runId}`),
    api(""),
  ]);
  const producer = {
    repository,
    repositoryId: repo.id,
    runId: selection.runId,
    attempt: selection.runAttempt,
    head: selection.headSha,
    branch: repo.default_branch,
    workflow: WORKFLOW,
  };
  await verifyProducer(api, producer);
  assert(
    run.id === selection.runId &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.run_attempt === selection.runAttempt,
    "Only a successful completed SDK run is eligible",
  );
  const listing = await api(
    `actions/runs/${selection.runId}/artifacts?per_page=100`,
  );
  assert(listing.total_count <= 100, "SDK artifact listing bound");
  const artifact = listing.artifacts.find(
    (row) => row.id === selection.artifactId,
  );
  assert(
    artifact &&
      artifact.name === sdkSealName(producer, selection.target) &&
      artifact.expired === false &&
      artifact.workflow_run?.id === producer.runId &&
      artifact.workflow_run?.head_sha === producer.head &&
      artifact.digest === `sha256:${selection.artifactSha256}` &&
      positive(artifact.size_in_bytes) &&
      artifact.size_in_bytes < LIMITS.seal,
    "SDK independent completion seal mismatch",
  );
  await mkdir(destination);
  await noLinks(destination);
  const zip = path.join(destination, "sdk-seal.zip"),
    deadline = Date.now() + 20 * 60_000;
  await downloadAsset(
    repository,
    token,
    `/actions/artifacts/${artifact.id}/zip`,
    zip,
    { bytes: artifact.size_in_bytes, sha256: selection.artifactSha256 },
    { request, maximum: LIMITS.seal, deadline },
  );
  const seal = validateSdkSeal(
    await archiveCommand(
      python,
      helper,
      ["seal", "--input", zip, "--output", destination],
      { timeout: 15000 },
    ),
    producer,
  );
  assert(
    seal.completion.target === selection.target &&
      seal.completion.sourceLockSha256 ===
        checkpointProfile(selection.target).source &&
      seal.completionSha256 === selection.completionSha256 &&
      seal.completion.bundleAssets.find((row) => row.name === "runtime.json")
        .sha256 === selection.descriptorSha256,
    "SDK independently reviewed completion/descriptor mismatch",
  );
  await verifyProducerCode(api, producer, seal.completion.identity.producer);
  const [release, assets] = await Promise.all([
    api(`releases/${seal.release.id}`),
    api(`releases/${seal.release.id}/assets?per_page=100`),
  ]);
  assert(
    release.draft === true &&
      release.prerelease === true &&
      release.tag_name === seal.release.tag &&
      release.target_commitish === transportHead(seal, producer) &&
      Array.isArray(assets) &&
      assets.length === 5 &&
      new Set(assets.map((row) => row.id)).size === 5,
    "SDK draft changed after sealing",
  );
  for (const pin of seal.assets) {
    const actual = assets.find((row) => row.id === pin.id);
    assert(
      actual &&
        actual.name === pin.name &&
        actual.size === pin.bytes &&
        actual.state === "uploaded" &&
        actual.digest === `sha256:${pin.sha256}`,
      "SDK mutable draft differs from trusted seal",
    );
    await downloadAsset(
      repository,
      token,
      `/releases/assets/${pin.id}`,
      path.join(destination, pin.name),
      pin,
      {
        request,
        maximum:
          pin.name === sdkArchive(selection.target)
            ? SDK_ASSET_MAX
            : 16 * 1024 ** 2,
        deadline,
      },
    );
  }
  await writeFile(
    path.join(destination, "sdk-completion-proof.json"),
    canonical(seal.completion) + "\n",
    { flag: "wx" },
  );
  return { sdkComplete: true, nativeAcceptance: false, runtimeReady: false };
}
