// Diagnostic source metadata policy, never a graph/checkpoint compatibility rule.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const POLICY = Object.freeze({
  name: "chromium-commit-committer-second-v1",
  chromium: "a654841425914cbb703a2931e07b70a83aedbafd",
  epoch: 1790036443,
});
export const TOOL_PINS = Object.freeze(
  [
    [
      "compile_xcassets.py",
      16540,
      "69d0de00e6bbcce0eae2dfb278876b0fd76d4f9430f2b1625c8bf6806ecfc5cd",
    ],
    [
      "filter_libtool.py",
      1766,
      "157d25b50057d3927dfcadfb24edf94ac7081b1802ccbbc54258360af9cad02f",
    ],
    [
      "linker_driver.py",
      21507,
      "0b0f5458b7f6d763a76285dd17494bf6a5ea0936c11cdcb193d6fa988bdc0ef5",
    ],
    [
      "swift_const_gather_protocols.json",
      181,
      "b78c534eaedb844857a208c60f627ea4c53845579169226844e8a9464734a23e",
    ],
    [
      "swiftc.py",
      25224,
      "ccd8d11da5523ba5960246ac90c1776c8e0545753926c63dde533178a1e97a97",
    ],
  ].map((row) => Object.freeze(row)),
);

const stable = (s) =>
  [s.dev, s.ino, s.nlink, s.size, s.mode, s.birthtimeNs].join(":");
const cross = (s) => [s.dev, s.ino, s.nlink, s.size, s.birthtimeNs].join(":");
const full = (s) => stable(s) + ":" + s.mtimeNs + ":" + s.ctimeNs;
const facts = (s) =>
  Object.fromEntries(
    [
      "dev",
      "ino",
      "nlink",
      "size",
      "mode",
      "birthtimeNs",
      "atimeNs",
      "mtimeNs",
      "ctimeNs",
    ].map((key) => [key, String(s[key])]),
  );

async function content(fd, expected, check) {
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(65536);
  let position = 0;
  for (;;) {
    check();
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    position += bytesRead;
    assert(position <= expected[1], "MAC_META_SIZE");
    hash.update(buffer.subarray(0, bytesRead));
  }
  assert(
    position === expected[1] && hash.digest("hex") === expected[2],
    "MAC_META_HASH",
  );
}

// The caller supplies its already-reviewed canonical/ancestor guard. Production
// uses exactly the five pins above; synthetic callers exercise this same body.
export async function stampFile(
  file,
  expected,
  check,
  state,
  physical,
  io = fs,
  platform = process.platform,
) {
  check();
  await physical(file, io);
  const before = await io.lstat(file, { bigint: true });
  assert(
    before.isFile() &&
      before.nlink === 1n &&
      before.size === BigInt(expected[1]),
    "MAC_META_FILE",
  );
  const fd = await io.open(file, "r+");
  let primary;
  try {
    const initial = await fd.stat({ bigint: true });
    assert(
      initial.isFile() && cross(initial) === cross(before),
      "MAC_META_IDENTITY",
    );
    await content(fd, expected, check);
    const admitted = await fd.stat({ bigint: true }),
      pathAdmitted = await io.lstat(file, { bigint: true });
    assert(
      full(initial) === full(admitted) && full(before) === full(pathAdmitted),
      "MAC_META_CHANGED",
    );
    check();
    state.metadataCurrent = {
      role: expected[0],
      before: facts(before),
      timestampWriteAttempted: true,
      after: null,
      birthTransitionPolicy:
        platform === "darwin"
          ? "min-original-birth-selected-mtime"
          : "unchanged",
    };
    // Only this held owned file's mtime is selected. Atime is carried from the
    // observed path view; no source content or generated graph is rewritten.
    await fd.utimes(Number(before.atimeNs) / 1e9, POLICY.epoch);
    const stamped = await fd.stat({ bigint: true }),
      pathStamped = await io.lstat(file, { bigint: true });
    await content(fd, expected, check);
    const after = await fd.stat({ bigint: true }),
      pathAfter = await io.lstat(file, { bigint: true });
    state.metadataCurrent.after = facts(pathAfter);
    const epochNs = BigInt(POLICY.epoch) * 1000000000n;
    // This is the sole deliberate metadata-write boundary. Darwin's observed
    // backdating clamp is exact; global stable/full/cross identity stays strict.
    const expectedBirth = (original) =>
      platform === "darwin" && original > epochNs ? epochNs : original;
    assert(
      stable({
        ...initial,
        birthtimeNs: expectedBirth(initial.birthtimeNs),
      }) === stable(after) &&
        stable({
          ...before,
          birthtimeNs: expectedBirth(before.birthtimeNs),
        }) === stable(pathAfter) &&
        cross(after) === cross(pathAfter),
      "MAC_META_IDENTITY",
    );
    assert(
      full(stamped) === full(after) && full(pathStamped) === full(pathAfter),
      "MAC_META_CHANGED",
    );
    assert(
      after.mtimeNs === epochNs && pathAfter.mtimeNs === epochNs,
      "MAC_META_READBACK",
    );
    await physical(file, io);
    check();
    return {
      role: expected[0],
      bytes: expected[1],
      sha256: expected[2],
      before: facts(before),
      after: facts(pathAfter),
      heldAfter: facts(after),
      birthTransitionPolicy: state.metadataCurrent.birthTransitionPolicy,
    };
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch {
      state.cleanupFailure ??= "MAC_META_CLOSE";
      if (!primary) throw Error("MAC_META_CLOSE");
    }
  }
}

export async function applyMetadata(context, check, state, physical) {
  assert(
    context.sourceLock.upstream.chromium.commit === POLICY.chromium,
    "MAC_META_SOURCE",
  );
  assert(
    path.resolve(context.work, "source/src") === context.chromium,
    "MAC_META_ROOT",
  );
  const rows = [];
  state.metadataTransition = {
    kind: "fixed-five-source-metadata-transition",
    policy: POLICY,
    rows,
    provisionalGnAlreadyRan: true,
    graphRewritten: false,
    checkpointMigrationAuthorized: false,
  };
  for (const pin of TOOL_PINS)
    rows.push(
      await stampFile(
        path.join(context.chromium, "build/toolchain/apple", pin[0]),
        pin,
        check,
        state,
        physical,
      ),
    );
  state.metadataCurrent = null;
  return state.metadataTransition;
}

export async function verifyMetadata(context, check, state, held, transition) {
  assert(transition?.rows?.length === TOOL_PINS.length, "MAC_META_TRANSITION");
  for (const [index, pin] of TOOL_PINS.entries()) {
    const actual = await held(
      path.join(context.chromium, "build/toolchain/apple", pin[0]),
      pin[1],
      check,
      state,
    );
    assert(
      actual.bytes === pin[1] &&
        actual.sha256 === pin[2] &&
        actual.identity.mtimeNs === BigInt(POLICY.epoch) * 1000000000n,
      "MAC_META_POST",
    );
    assert(transition.rows[index].role === pin[0], "MAC_META_TRANSITION");
    for (const key of ["dev", "ino", "nlink", "size", "mode", "birthtimeNs"])
      assert(
        String(actual.identity[key]) === transition.rows[index].after[key],
        "MAC_META_POST_IDENTITY",
      );
  }
}

// Existing afterGn observes a provisional GN. Only the genuine second GN may
// feed authoritative graph capture. A failure cannot reach collect or compile.
export async function authoritativeGn(context, operations) {
  const transition = await operations.apply(context);
  await operations.verify(context, transition);
  await context.revalidateGn();
  await operations.verify(context, transition);
  return operations.collect(context, transition);
}

// The fixed-five implementation above is copied byte-for-byte from the genuine
// GN diagnostic. Complete-source Darwin writes require a separate Python proof.
import { macMetalFingerprint } from "../cef-hosted-provision.mjs";
export const MAC_SOURCE_POLICY = Object.freeze({
  target: "aarch64-apple-darwin",
  platform: "darwin",
  kind: "sorng-macarm-source-metadata",
  name: "sorng-macarm-complete-owned-inputs-v1-unadmitted",
  darwinWriteAdmitted: false,
});
export const MAC_INTEL_SOURCE_POLICY = Object.freeze({
  target: "x86_64-apple-darwin",
  source: "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
  platform: "darwin",
  kind: "sorng-macintel-source-metadata",
  name: "sorng-macintel-complete-owned-inputs-v1-unadmitted",
  darwinWriteAdmitted: false,
});
const ARM_EXTERNAL = Object.freeze({
  target: MAC_SOURCE_POLICY.target,
  contextKind: "sorng-macarm-external-input-context",
  observationKind: "sorng-macarm-external-input-observation",
  name: "sorng-macarm-readonly-external-inputs-v1",
});
const INTEL_EXTERNAL = Object.freeze({
  target: MAC_INTEL_SOURCE_POLICY.target,
  source: MAC_INTEL_SOURCE_POLICY.source,
  contextKind: "sorng-macintel-external-input-context",
  observationKind: "sorng-macintel-external-input-observation",
  name: "sorng-macintel-readonly-external-inputs-v1",
});
export const MAC_EXTERNAL_LIMITS = Object.freeze({
  entries: 1000000,
  fileBytes: 8 * 1024 ** 3,
  bytes: 256 * 1024 ** 3,
  metadataBytes: 128 * 1024 ** 2,
  readers: 4,
  seconds: 600,
  capabilitySeconds: 5,
});
const MAC_DEVELOPER = "/Applications/Xcode_26.3.app/Contents/Developer";
const MAC_PYTHON_FRAMEWORK =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework";
const MAC_PYTHON = MAC_PYTHON_FRAMEWORK + "/Versions/3.14/bin/python3.14";
const plainAbsolute = (p) => {
  assert(
    typeof p === "string" &&
      p.startsWith("/") &&
      !/[\\\x00-\x20\x7f]/.test(p) &&
      path.posix.normalize(p) === p &&
      !p.includes("//"),
    "MAC_SOURCE_PATH",
  );
  return p;
};
const externalPlans = new WeakSet();
const freezeData = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
};
export function assertMacSourceWriteAdmission() {
  assert(
    MAC_SOURCE_POLICY.darwinWriteAdmitted,
    "MAC_SOURCE_DARWIN_CAPABILITY_UNREVIEWED",
  );
}
export function macSourceMetadataPlan(identity, out, mode) {
  assert(identity?.target === MAC_SOURCE_POLICY.target, "MAC_SOURCE_TARGET");
  assert(
    ["source-record", "source-verify", "source-apply"].includes(mode),
    "MAC_SOURCE_MODE",
  );
  const work = plainAbsolute(identity.canonicalRoot);
  assert(
    /^[a-f0-9]{64}$/.test(identity.source) &&
      work ===
        "/Users/runner/work/_temp/sorng-cef-engineering/aarch64-apple-darwin/" +
          identity.source,
    "MAC_SOURCE_ROOT",
  );
  assert(out === work + "/source/src/out/Release_GN_arm64", "MAC_SOURCE_OUT");
  // A report or external-read context cannot switch this source-controlled gate.
  assertMacSourceWriteAdmission();
  return {
    mode,
    source: work + "/source",
    sidecar: out + "/.siso_sorng_source_metadata.json",
    platformPolicy: "mac-arm",
  };
}

export function assertMacIntelSourceWriteAdmission() {
  assert(
    MAC_INTEL_SOURCE_POLICY.darwinWriteAdmitted,
    "MAC_INTEL_SOURCE_DARWIN_CAPABILITY_UNREVIEWED",
  );
}
export function macIntelSourceMetadataPlan(identity, out, mode) {
  assert(
    identity?.target === MAC_INTEL_SOURCE_POLICY.target,
    "MAC_SOURCE_TARGET",
  );
  assert(
    ["source-record", "source-verify", "source-apply"].includes(mode),
    "MAC_SOURCE_MODE",
  );
  const work = plainAbsolute(identity.canonicalRoot);
  assert(
    identity.source === MAC_INTEL_SOURCE_POLICY.source &&
      work ===
        "/Users/runner/work/_temp/sorng-cef-engineering/x86_64-apple-darwin/" +
          MAC_INTEL_SOURCE_POLICY.source,
    "MAC_SOURCE_ROOT",
  );
  assert(out === work + "/source/src/out/Release_GN_x64", "MAC_SOURCE_OUT");
  assertMacIntelSourceWriteAdmission();
  return {
    mode,
    source: work + "/source",
    sidecar: out + "/.siso_sorng_source_metadata.json",
    platformPolicy: "mac-intel",
  };
}

const sdkRelations = new WeakMap();
// Fixed logical SDK version to physical root attestation; never inferred from a basename.
export async function macSdkRelation({ selected, sdkTargets, check }, io = fs) {
  const physical =
    MAC_DEVELOPER + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk";
  const logical =
    MAC_DEVELOPER + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.2.sdk";
  assert(
    selected?.DEVELOPER_DIR === MAC_DEVELOPER &&
      selected.SDKROOT === physical &&
      Array.isArray(sdkTargets) &&
      sdkTargets.length === 3 &&
      sdkTargets[0] === physical &&
      typeof check === "function",
    "MAC_EXTERNAL_SDK_RELATION",
  );
  const observe = async () => {
    check();
    const link = await io.lstat(logical, { bigint: true });
    check();
    assert(link.isSymbolicLink(), "MAC_EXTERNAL_SDK_RELATION");
    assert(
      (await io.readlink(logical)) === "MacOSX.sdk",
      "MAC_EXTERNAL_SDK_RELATION",
    );
    check();
    assert(
      (await io.realpath(logical)) === physical,
      "MAC_EXTERNAL_SDK_RELATION",
    );
    check();
    const root = await io.lstat(physical, { bigint: true });
    assert(
      root.isDirectory() && !root.isSymbolicLink(),
      "MAC_EXTERNAL_SDK_RELATION",
    );
    check();
    assert(
      (await io.realpath(physical)) === physical,
      "MAC_EXTERNAL_SDK_RELATION",
    );
    check();
    return { link: full(link), root: full(root) };
  };
  const before = await observe(),
    after = await observe();
  assert(
    before.link === after.link && before.root === after.root,
    "MAC_EXTERNAL_SDK_RELATION_CHANGED",
  );
  const proof = Object.freeze({
    logical,
    physical,
    literal: "MacOSX.sdk",
    version: "26.2",
  });
  sdkRelations.set(proof, Object.freeze([...sdkTargets]));
  return proof;
}

export function macExternalObservationPlan(options) {
  return externalObservationPlanFor(ARM_EXTERNAL, options);
}
export function macIntelExternalObservationPlan({
  sourceLockIdentity,
  ...options
}) {
  assert(
    sourceLockIdentity === MAC_INTEL_SOURCE_POLICY.source,
    "MAC_SOURCE_ROOT",
  );
  return externalObservationPlanFor(INTEL_EXTERNAL, options);
}
function externalObservationPlanFor(
  envelope,
  {
    map,
    toolchain,
    selected,
    sdkTargets,
    sdkRelation,
    metal,
    runnerTemp,
    output,
    remainingMilliseconds,
  },
) {
  assert(
    map?.target === envelope.target && toolchain?.target === map.target,
    "MAC_EXTERNAL_TARGET",
  );
  assert(map.python === MAC_PYTHON.slice(1), "MAC_EXTERNAL_PYTHON");
  assert(
    selected?.DEVELOPER_DIR === MAC_DEVELOPER &&
      selected.SDKROOT ===
        MAC_DEVELOPER + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
    "MAC_EXTERNAL_SELECTED",
  );
  assert(
    Array.isArray(sdkTargets) && sdkTargets.length === 3,
    "MAC_EXTERNAL_SDK",
  );
  const sdk = plainAbsolute(sdkTargets[0]);
  assert(
    sdk ===
      MAC_DEVELOPER + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk" &&
      sdkTargets[1] === MAC_DEVELOPER + "/Platforms/MacOSX.platform" &&
      sdkTargets[2] === MAC_DEVELOPER + "/Toolchains/XcodeDefault.xctoolchain",
    "MAC_EXTERNAL_SDK",
  );
  assert(
    sdkRelations.has(sdkRelation) &&
      sdkRelations
        .get(sdkRelation)
        .every((value, index) => value === sdkTargets[index]),
    "MAC_EXTERNAL_SDK_RELATION",
  );
  const fingerprint = macMetalFingerprint(metal);
  assert(
    metal.developerDir === MAC_DEVELOPER &&
      metal.componentResourceClosureVerified === false,
    "MAC_EXTERNAL_METAL",
  );
  const metalRoots = metal.tools.map((tool, index) => {
    assert(tool.role === ["metal", "metallib"][index], "MAC_EXTERNAL_METAL");
    const suffix = "/usr/bin/" + (index ? "air-lld" : "metal");
    const p = plainAbsolute(tool.physicalPath);
    assert(p.endsWith(suffix), "MAC_EXTERNAL_METAL");
    const root = p.slice(0, -suffix.length);
    assert(
      root === sdkTargets[2] ||
        /^\/Users\/runner\/Library\/Developer\/DVTDownloads\/MetalToolchain\/mounts\/[a-f0-9]{40}\/Metal\.xctoolchain$/.test(
          root,
        ),
      "MAC_EXTERNAL_METAL",
    );
    return root;
  });
  assert(
    metalRoots.length === 2 && metalRoots[0] === metalRoots[1],
    "MAC_EXTERNAL_METAL",
  );
  const temp = plainAbsolute(runnerTemp),
    destination = plainAbsolute(output);
  assert(
    temp === "/Users/runner/work/_temp" &&
      path.posix.dirname(destination) === temp &&
      /^cef-mac-inputs-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        path.posix.basename(destination),
      ),
    "MAC_EXTERNAL_OUTPUT",
  );
  assert(
    Array.isArray(toolchain.files) && toolchain.files.length === 9,
    "MAC_EXTERNAL_PINS",
  );
  const pins = toolchain.files
    .filter((p) => p.path !== `cef-ci-runner-${envelope.target}.json`)
    .map((p) => {
      assert(
        p &&
          /^[a-f0-9]{64}$/.test(p.sha256) &&
          Number.isSafeInteger(p.size) &&
          p.size > 0,
        "MAC_EXTERNAL_PINS",
      );
      let role, relative;
      const sdkPrefix = selected.SDKROOT.slice(1) + "/";
      const toolPrefix = sdkTargets[2].slice(1) + "/";
      if (p.path.startsWith(sdkPrefix)) {
        role = "sdk";
        relative = p.path.slice(sdkPrefix.length);
      } else if (p.path.startsWith(toolPrefix)) {
        role = "toolchain";
        relative = p.path.slice(toolPrefix.length);
      } else if (p.path === MAC_PYTHON.slice(1)) {
        role = "python";
        relative = "Versions/3.14/bin/python3.14";
      } else assert.fail("MAC_EXTERNAL_PINS");
      assert(
        relative &&
          !relative.split("/").some((x) => !x || x === "." || x === ".."),
        "MAC_EXTERNAL_PINS",
      );
      return { role, path: relative, size: p.size, sha256: p.sha256 };
    });
  assert(
    pins.length === 8 &&
      new Set(pins.map((p) => p.role + "/" + p.path)).size === 8,
    "MAC_EXTERNAL_PINS",
  );
  for (const [index, tool] of metal.tools.entries())
    pins.push({
      role: "metal",
      path: "usr/bin/" + (index ? "air-lld" : "metal"),
      size: tool.bytes,
      sha256: tool.sha256,
    });
  const context = {
    schemaVersion: 1,
    kind: envelope.contextKind,
    target: map.target,
    roots: {
      sdk,
      toolchain: sdkTargets[2],
      metal: metalRoots[0],
      python: MAC_PYTHON_FRAMEWORK,
    },
    runnerTemp: temp,
    outputRoot: destination,
    requiredPins: pins,
    limits: MAC_EXTERNAL_LIMITS,
    originalMetalFingerprint: fingerprint,
    historicalMetalResourceClosureVerified: false,
  };
  if (envelope === INTEL_EXTERNAL) context.source = envelope.source;
  assert(typeof remainingMilliseconds === "function", "MAC_EXTERNAL_DEADLINE");
  const argv = (mode, contextFile) => {
    assert(
      ["mac-external-observe", "mac-owned-capability-observe"].includes(mode),
      "MAC_EXTERNAL_MODE",
    );
    assert(
      plainAbsolute(contextFile) === destination + "/context.json",
      "MAC_EXTERNAL_CONTEXT",
    );
    const milliseconds = remainingMilliseconds();
    assert(
      Number.isFinite(milliseconds) && milliseconds > 0,
      "MAC_EXTERNAL_DEADLINE",
    );
    const seconds = Math.floor(
      Math.min(
        mode === "mac-owned-capability-observe" ? 5000 : 600000,
        milliseconds,
      ) / 1000,
    );
    assert(seconds > 0, "MAC_EXTERNAL_DEADLINE");
    return [
      "-I",
      "-B",
      "scripts/lib/cef-checkpoint-archive.py",
      mode,
      "--input",
      contextFile,
      "--output",
      destination +
        (mode === "mac-external-observe"
          ? "/external.json"
          : "/capability.json"),
      "--seconds",
      String(seconds),
    ];
  };
  const plan = Object.freeze({
    context: freezeData(context),
    python: MAC_PYTHON,
    argv,
  });
  externalPlans.add(plan);
  return plan;
}

const externalAttestations = new WeakMap();
const exactKeys = (value, keys, code) =>
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    code,
  );
// Python records the complete st_mode, including its type bits. Keep that raw
// value in the portable binding and require it to agree with the declared kind.
const externalModeMatches = (mode, kind) =>
  Number.isInteger(mode) &&
  mode >= 0 &&
  mode <= 0xffff &&
  (mode & 0xf000) ===
    { file: 0o100000, directory: 0o040000, symlink: 0o120000 }[kind];

const reportIdentity = (value) =>
  ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs", "birthtimeNs"]
    .map((key) => value[key])
    .join(":");

// Data-only POSIX component resolution against the complete declared-role rows.
// In particular, a symlink is expanded BEFORE a subsequent '..' is interpreted.
function macExternalResolver(roots, snapshots, check) {
  const tables = {},
    ancestors = new Set();
  for (const role of ["sdk", "toolchain", "metal", "python"]) {
    plainAbsolute(roots[role]);
    assert(
      roots[role] !== "/" && Array.isArray(snapshots[role]),
      "MAC_EXTERNAL_ENTRY_TARGET",
    );
    tables[role] = new Map();
    for (const row of snapshots[role]) {
      check();
      tables[role].set(row.path, row);
    }
    for (let at = roots[role]; ; at = path.posix.dirname(at)) {
      ancestors.add(at);
      if (at === "/") break;
    }
  }
  const candidates = (absolute) =>
    Object.entries(roots).filter(
      ([, root]) => absolute === root || absolute.startsWith(root + "/"),
    );
  const ordered = (rows, preferred) =>
    rows.sort((a, b) =>
      a[0] === preferred
        ? -1
        : b[0] === preferred
          ? 1
          : b[1].length - a[1].length,
    );
  const nodeAt = (absolute, preferred) => {
    const inside = ordered(candidates(absolute), preferred);
    for (const [role, root] of inside) {
      const name = absolute.slice(root.length).replace(/^\//, "");
      if (!name) return { role, path: "", kind: "directory" };
      const row = tables[role].get(name);
      if (row) return { ...row, role };
    }
    assert(
      inside.length === 0 && ancestors.has(absolute),
      "MAC_EXTERNAL_ENTRY_TARGET",
    );
    return { navigationOnly: true, kind: "directory" };
  };
  const rawParts = (raw) => {
    assert(
      typeof raw === "string" &&
        !raw.startsWith("//") &&
        Buffer.byteLength(raw) > 0 &&
        Buffer.byteLength(raw) <= 4096 &&
        !/[\x00-\x1f\x7f]/.test(raw),
      "MAC_EXTERNAL_ENTRY_TARGET",
    );
    return raw.split("/");
  };
  return (role, sourcePath, rawTarget) => {
    assert(Object.hasOwn(tables, role), "MAC_EXTERNAL_ENTRY_TARGET");
    const raw = rawParts(rawTarget),
      parent = sourcePath.split("/").slice(0, -1);
    const anchor = rawTarget.startsWith("/")
      ? ordered(candidates(rawTarget), role)[0]
      : null;
    const literal = rawTarget.startsWith("/")
      ? anchor
        ? {
            role: anchor[0],
            components: rawTarget
              .slice(anchor[1].length)
              .replace(/^\//, "")
              .split("/"),
          }
        : { globalComponents: raw }
      : { role, components: [...parent, ...raw] };
    let current = [],
      pending = rawTarget.startsWith("/")
        ? raw
        : [...roots[role].split("/"), ...parent, ...raw],
      links = 0,
      preferred = role;
    while (pending.length) {
      check();
      const part = pending.shift();
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (current.length) current.pop();
        continue;
      }
      const absolute = "/" + [...current, part].join("/"),
        row = nodeAt(absolute, preferred);
      if (row.role) preferred = row.role;
      if (row.kind === "symlink") {
        assert(++links <= 64, "MAC_EXTERNAL_ENTRY_CYCLE");
        const target = rawParts(row.target);
        if (row.target.startsWith("/")) current = [];
        pending = [...target, ...pending];
      } else {
        assert(
          row.kind === "directory" || row.kind === "file",
          "MAC_EXTERNAL_ENTRY_TARGET",
        );
        assert(
          !pending.length || row.kind === "directory",
          "MAC_EXTERNAL_ENTRY_KIND",
        );
        current.push(part);
      }
    }
    const final = nodeAt("/" + current.join("/"), preferred);
    assert(
      !final.navigationOnly && final.role && final.kind !== "symlink",
      "MAC_EXTERNAL_ENTRY_TARGET",
    );
    return {
      literal,
      resolved: { role: final.role, path: final.path, kind: final.kind },
    };
  };
}
export function resolveMacExternalTarget(
  roots,
  snapshots,
  role,
  sourcePath,
  rawTarget,
  check = () => {},
) {
  return macExternalResolver(roots, snapshots, check)(
    role,
    sourcePath,
    rawTarget,
  );
}
export async function readMacExternalObservation(
  plan,
  result,
  check = () => {},
  io = fs,
) {
  assert(
    externalPlans.has(plan) &&
      plan.context.target === ARM_EXTERNAL.target &&
      plan.context.kind === ARM_EXTERNAL.contextKind,
    "MAC_EXTERNAL_PLAN",
  );
  return readExternalObservationFor(ARM_EXTERNAL, plan, result, check, io);
}
export async function readMacIntelExternalObservation(
  plan,
  result,
  check = () => {},
  io = fs,
) {
  assert(
    externalPlans.has(plan) &&
      plan.context.target === INTEL_EXTERNAL.target &&
      plan.context.kind === INTEL_EXTERNAL.contextKind &&
      plan.context.source === INTEL_EXTERNAL.source,
    "MAC_EXTERNAL_PLAN",
  );
  return readExternalObservationFor(INTEL_EXTERNAL, plan, result, check, io);
}
async function readExternalObservationFor(envelope, plan, result, check, io) {
  assert(externalPlans.has(plan), "MAC_EXTERNAL_PLAN");
  exactKeys(
    result,
    [
      "complete",
      "kind",
      "entries",
      "bytes",
      "snapshot",
      "sourceWriteAdmitted",
      "nativeAcceptance",
      "runtimeReady",
    ],
    "MAC_EXTERNAL_RESULT",
  );
  assert(
    result.complete === true &&
      result.kind === envelope.observationKind &&
      result.sourceWriteAdmitted === false &&
      result.nativeAcceptance === false &&
      result.runtimeReady === false &&
      Number.isSafeInteger(result.entries) &&
      result.entries > 0 &&
      result.entries <= MAC_EXTERNAL_LIMITS.entries &&
      Number.isSafeInteger(result.bytes) &&
      result.bytes >= 0 &&
      result.bytes <= MAC_EXTERNAL_LIMITS.bytes,
    "MAC_EXTERNAL_RESULT",
  );
  exactKeys(
    result.snapshot,
    ["name", "bytes", "sha256"],
    "MAC_EXTERNAL_RESULT",
  );
  assert(
    result.snapshot.name === "external.json" &&
      Number.isSafeInteger(result.snapshot.bytes) &&
      result.snapshot.bytes > 0 &&
      result.snapshot.bytes <= MAC_EXTERNAL_LIMITS.metadataBytes &&
      /^[a-f0-9]{64}$/.test(result.snapshot.sha256),
    "MAC_EXTERNAL_RESULT",
  );
  const file = plan.context.outputRoot + "/external.json";
  check();
  for (let at = plan.context.outputRoot; ; at = path.posix.dirname(at)) {
    check();
    const directory = await io.lstat(at);
    assert(
      directory.isDirectory() && !directory.isSymbolicLink(),
      "MAC_EXTERNAL_REPORT_PARENT",
    );
    if (path.posix.dirname(at) === at) break;
  }
  assert(
    (await io.realpath(plan.context.outputRoot)) === plan.context.outputRoot,
    "MAC_EXTERNAL_REPORT_PARENT",
  );
  const parentBefore = await io.lstat(plan.context.outputRoot, {
    bigint: true,
  });
  const before = await io.lstat(file, { bigint: true });
  assert(
    before.isFile() &&
      before.nlink === 1n &&
      before.size === BigInt(result.snapshot.bytes),
    "MAC_EXTERNAL_REPORT",
  );
  check();
  const fd = await io.open(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  let failed = false;
  try {
    assert(
      reportIdentity(await fd.stat({ bigint: true })) ===
        reportIdentity(before),
      "MAC_EXTERNAL_REPORT",
    );
    check();
    const raw = await fd.readFile();
    check();
    assert(
      raw.length === result.snapshot.bytes &&
        createHash("sha256").update(raw).digest("hex") ===
          result.snapshot.sha256,
      "MAC_EXTERNAL_REPORT_HASH",
    );
    const value = JSON.parse(raw);
    exactKeys(
      value,
      [
        "schemaVersion",
        "kind",
        "target",
        "policy",
        "complete",
        "externalSnapshotComplete",
        "roles",
        "entries",
        "bytes",
        "runnerUid",
        "historicalMetalResourceClosureVerified",
        "sourceWriteAdmitted",
        "nativeAcceptance",
        "runtimeReady",
        ...(envelope === INTEL_EXTERNAL ? ["source"] : []),
      ],
      "MAC_EXTERNAL_REPORT",
    );
    assert(
      value.schemaVersion === 1 &&
        value.kind === result.kind &&
        value.target === envelope.target &&
        (envelope !== INTEL_EXTERNAL || value.source === envelope.source) &&
        value.policy === envelope.name &&
        value.complete === true &&
        value.externalSnapshotComplete === true &&
        value.entries === result.entries &&
        value.bytes === result.bytes &&
        Number.isSafeInteger(value.runnerUid) &&
        value.runnerUid >= 0 &&
        value.historicalMetalResourceClosureVerified === false &&
        value.sourceWriteAdmitted === false &&
        value.nativeAcceptance === false &&
        value.runtimeReady === false &&
        Array.isArray(value.roles) &&
        value.roles.length === 4,
      "MAC_EXTERNAL_REPORT",
    );
    let entries = 0,
      bytes = 0;
    const portableRoles = [],
      symbolic = [];
    for (const [index, role] of [
      "sdk",
      "toolchain",
      "metal",
      "python",
    ].entries()) {
      const row = value.roles[index];
      exactKeys(row, ["role", "physicalRoot", "snapshot"], "MAC_EXTERNAL_ROLE");
      assert(
        row.role === role &&
          row.physicalRoot === plan.context.roots[role] &&
          Array.isArray(row.snapshot?.entries),
        "MAC_EXTERNAL_ROLE",
      );
      exactKeys(
        row.snapshot,
        ["entries", "rootMtimeNs", "gitHeads", "bytes", "root", "localRoot"],
        "MAC_EXTERNAL_ROLE",
      );
      exactKeys(
        row.snapshot.root,
        ["mode", "mtimeNs", "uid", "gid", "nlink"],
        "MAC_EXTERNAL_ROLE",
      );
      exactKeys(
        row.snapshot.localRoot,
        ["dev", "ino", "ctimeNs", "birthtimeNsAvailable", "birthtimeNs"],
        "MAC_EXTERNAL_ROLE",
      );
      assert(
        Object.keys(row.snapshot.gitHeads).length === 0 &&
          row.snapshot.rootMtimeNs === row.snapshot.root.mtimeNs,
        "MAC_EXTERNAL_ROLE",
      );
      assert(
        externalModeMatches(row.snapshot.root.mode, "directory") &&
          typeof row.snapshot.root.mtimeNs === "string" &&
          /^(0|[1-9][0-9]{0,18})$/.test(row.snapshot.root.mtimeNs) &&
          BigInt(row.snapshot.root.mtimeNs) < 2n ** 63n &&
          [
            row.snapshot.root.uid,
            row.snapshot.root.gid,
            row.snapshot.root.nlink,
          ].every(Number.isSafeInteger) &&
          [0, value.runnerUid].includes(row.snapshot.root.uid) &&
          row.snapshot.root.gid >= 0 &&
          row.snapshot.root.nlink > 0 &&
          ["dev", "ino", "ctimeNs"].every((key) => {
            const field = row.snapshot.localRoot[key];
            return (
              typeof field === "string" && /^(0|[1-9][0-9]{0,19})$/.test(field)
            );
          }) &&
          (row.snapshot.localRoot.birthtimeNsAvailable === false
            ? row.snapshot.localRoot.birthtimeNs === null
            : row.snapshot.localRoot.birthtimeNsAvailable === true &&
              typeof row.snapshot.localRoot.birthtimeNs === "string" &&
              /^(0|[1-9][0-9]{0,18})$/.test(
                row.snapshot.localRoot.birthtimeNs,
              ) &&
              BigInt(row.snapshot.localRoot.birthtimeNs) < 2n ** 63n),
        "MAC_EXTERNAL_ROLE",
      );
      const portableEntries = [];
      let roleBytes = 0;
      const names = new Map();
      for (const item of row.snapshot.entries) {
        check();
        assert(
          item &&
            typeof item.path === "string" &&
            Buffer.byteLength(item.path) <= 1024 &&
            !item.path.startsWith("/") &&
            !item.path.includes("\\") &&
            !/^[A-Za-z]:/.test(item.path) &&
            (role === "sdk" || !item.path.includes(":")) &&
            !/[\x00-\x1f\x7f]/.test(item.path) &&
            !item.path
              .split("/")
              .some(
                (part) =>
                  !part ||
                  part === "." ||
                  part === ".." ||
                  /[ .]$/.test(part) ||
                  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
              ) &&
            !names.has(item.path) &&
            ["file", "directory", "symlink"].includes(item.kind),
          "MAC_EXTERNAL_ENTRY",
        );
        names.set(item.path, item);
        entries++;
        exactKeys(
          item,
          [
            "path",
            "kind",
            "mode",
            "mtimeNs",
            "nlink",
            "uid",
            "gid",
            ...(item.kind === "file"
              ? ["size", "sha256"]
              : item.kind === "symlink"
                ? ["target", "sha256"]
                : []),
          ],
          "MAC_EXTERNAL_ENTRY",
        );
        assert(
          externalModeMatches(item.mode, item.kind) &&
            typeof item.mtimeNs === "string" &&
            /^(0|[1-9][0-9]{0,18})$/.test(item.mtimeNs) &&
            BigInt(item.mtimeNs) < 2n ** 63n &&
            [item.nlink, item.uid, item.gid].every(Number.isSafeInteger) &&
            item.nlink > 0 &&
            [0, value.runnerUid].includes(item.uid) &&
            item.gid >= 0,
          "MAC_EXTERNAL_ENTRY",
        );
        const portable = {
          path: item.path,
          kind: item.kind,
          mode: item.mode,
          mtimeNs: item.mtimeNs,
          nlink: item.nlink,
          uid: item.uid,
          gid: item.gid,
        };
        if (item.kind === "file") {
          assert(
            Number.isSafeInteger(item.size) &&
              item.size >= 0 &&
              item.size <= MAC_EXTERNAL_LIMITS.fileBytes &&
              /^[a-f0-9]{64}$/.test(item.sha256),
            "MAC_EXTERNAL_ENTRY",
          );
          bytes += item.size;
          roleBytes += item.size;
          portable.size = item.size;
          portable.sha256 = item.sha256;
        } else if (item.kind === "symlink") {
          assert(
            typeof item.target === "string" &&
              Buffer.byteLength(item.target) > 0 &&
              Buffer.byteLength(item.target) <= 4096 &&
              !/[\x00-\x1f\x7f]/.test(item.target) &&
              createHash("sha256").update(item.target).digest("hex") ===
                item.sha256,
            "MAC_EXTERNAL_ENTRY",
          );
          symbolic.push({ role, path: item.path, raw: item.target, portable });
          if (!item.target.startsWith("/"))
            portable.relativeLiteral = item.target;
        }
        portableEntries.push(portable);
      }
      assert(row.snapshot.bytes === roleBytes, "MAC_EXTERNAL_TOTALS");
      portableRoles.push({
        role,
        root: structuredClone(row.snapshot.root),
        entries: portableEntries,
      });
      for (const pin of plan.context.requiredPins.filter(
        (pin) => pin.role === role,
      )) {
        const item = names.get(pin.path);
        assert(
          item?.kind === "file" &&
            item.size === pin.size &&
            item.sha256 === pin.sha256,
          "MAC_EXTERNAL_REQUIRED_PIN",
        );
      }
    }
    const snapshots = Object.fromEntries(
      value.roles.map((row) => [row.role, row.snapshot.entries]),
    );
    const resolve = macExternalResolver(plan.context.roots, snapshots, check);
    for (const item of symbolic) {
      const target = resolve(item.role, item.path, item.raw);
      item.portable.target = target.literal;
      item.portable.resolvedTarget = target.resolved;
    }
    assert(
      entries === result.entries && bytes === result.bytes,
      "MAC_EXTERNAL_TOTALS",
    );
    check();
    assert(
      reportIdentity(await fd.stat({ bigint: true })) ===
        reportIdentity(before) &&
        reportIdentity(await io.lstat(file, { bigint: true })) ===
          reportIdentity(before) &&
        reportIdentity(
          await io.lstat(plan.context.outputRoot, { bigint: true }),
        ) === reportIdentity(parentBefore) &&
        (await io.realpath(plan.context.outputRoot)) ===
          plan.context.outputRoot,
      "MAC_EXTERNAL_REPORT_CHANGED",
    );
    check();
    const token = Object.freeze({
      kind: value.kind,
      entries: value.entries,
      bytes: value.bytes,
    });
    externalAttestations.set(
      token,
      structuredClone({
        policy: value.policy,
        ...(envelope === INTEL_EXTERNAL ? { source: envelope.source } : {}),
        portableRoles,
        snapshot: result.snapshot,
        roots: plan.context.roots,
        requiredPins: plan.context.requiredPins,
        originalMetalFingerprint: plan.context.originalMetalFingerprint,
        historicalMetalResourceClosureVerified: false,
        externalSnapshotComplete: true,
      }),
    );
    return token;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      if (!failed) throw error;
    }
  }
}
export function macExternalToolsBinding(base, attestation) {
  return externalToolsBindingFor(ARM_EXTERNAL, base, attestation);
}
export function macIntelExternalToolsBinding(base, attestation) {
  return externalToolsBindingFor(INTEL_EXTERNAL, base, attestation);
}
function externalToolsBindingFor(envelope, base, attestation) {
  const external = externalAttestations.get(attestation);
  assert(
    external &&
      external.policy === envelope.name &&
      (envelope !== INTEL_EXTERNAL || external.source === envelope.source),
    "MAC_EXTERNAL_ATTESTATION",
  );
  return {
    ...base,
    macExternalInputs: structuredClone({
      policy: external.policy,
      ...(envelope === INTEL_EXTERNAL
        ? { target: envelope.target, source: envelope.source }
        : {}),
      roles: external.portableRoles,
      requiredPins: external.requiredPins,
      originalMetalFingerprint: external.originalMetalFingerprint,
      historicalMetalResourceClosureVerified: false,
      externalSnapshotComplete: true,
    }),
  };
}
export function macExternalObservationEvidence(attestation) {
  return externalObservationEvidenceFor(ARM_EXTERNAL, attestation);
}
export function macIntelExternalObservationEvidence(attestation) {
  return externalObservationEvidenceFor(INTEL_EXTERNAL, attestation);
}
function externalObservationEvidenceFor(envelope, attestation) {
  const external = externalAttestations.get(attestation);
  assert(
    external &&
      external.policy === envelope.name &&
      (envelope !== INTEL_EXTERNAL || external.source === envelope.source),
    "MAC_EXTERNAL_ATTESTATION",
  );
  return structuredClone({
    ...(envelope === INTEL_EXTERNAL
      ? { target: envelope.target, source: envelope.source }
      : {}),
    snapshot: external.snapshot,
    physicalRoots: external.roots,
    historicalMetalResourceClosureVerified: false,
    externalSnapshotComplete: true,
    sourceWriteAdmitted: false,
  });
}

export async function prepareAuthoritativeMacGn(context, check) {
  assertMacSourceWriteAdmission();
  return prepareAuthoritativeMacGnFor(ARM_EXTERNAL, context, check);
}
export async function prepareAuthoritativeMacIntelGn(context, check) {
  assertMacIntelSourceWriteAdmission();
  assert(
    context.sourceLockIdentity === MAC_INTEL_SOURCE_POLICY.source,
    "MAC_SOURCE_ROOT",
  );
  return prepareAuthoritativeMacGnFor(INTEL_EXTERNAL, context, check);
}
async function prepareAuthoritativeMacGnFor(envelope, context, check) {
  assert(context.runner?.target === envelope.target, "MAC_SOURCE_TARGET");
  const physical = async (file) => {
    plainAbsolute(file);
    assert((await fs.realpath(file)) === file, "MAC_META_ALIAS");
    for (let at = file; ; at = path.posix.dirname(at)) {
      assert(!(await fs.lstat(at)).isSymbolicLink(), "MAC_META_LINK");
      if (path.posix.dirname(at) === at) break;
    }
    return file;
  };
  const state = {};
  const held = async (file, cap) => {
    check();
    await physical(file);
    const before = await fs.lstat(file, { bigint: true });
    assert(
      before.isFile() &&
        before.nlink === 1n &&
        before.size > 0n &&
        before.size <= BigInt(cap),
      "MAC_META_FILE",
    );
    const fd = await fs.open(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    let failed = false;
    try {
      assert(
        reportIdentity(await fd.stat({ bigint: true })) ===
          reportIdentity(before),
        "MAC_META_IDENTITY",
      );
      const bytes = await fd.readFile();
      check();
      assert(
        bytes.length === Number(before.size) &&
          reportIdentity(await fd.stat({ bigint: true })) ===
            reportIdentity(before) &&
          reportIdentity(await fs.lstat(file, { bigint: true })) ===
            reportIdentity(before),
        "MAC_META_CHANGED",
      );
      return {
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        identity: before,
      };
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await fd.close();
      } catch (error) {
        state.cleanupFailure = "MAC_META_CLOSE";
        if (!failed) throw error;
      }
    }
  };
  const transition = await applyMetadata(context, check, state, physical);
  await verifyMetadata(context, check, state, held, transition);
  await context.revalidateGn();
  await verifyMetadata(context, check, state, held, transition);
  assert(!state.cleanupFailure, "MAC_META_CLOSE");
  return transition;
}
