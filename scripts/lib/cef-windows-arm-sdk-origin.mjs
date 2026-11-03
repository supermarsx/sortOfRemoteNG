// Fixed future FULL-SDK provenance only. No compiler, import, acceptance or
// publication action is implemented here. Matching record JSON is a candidate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";

export const WINDOWS_ARM_SDK_ORIGIN = "owned-windows-arm64-full-sdk";
export const WINDOWS_ARM_SDK_TARGET = "aarch64-pc-windows-msvc";
export const WINDOWS_ARM_SDK_WORKFLOW =
  ".github/workflows/windows-arm-full-sdk.yml";
export const WINDOWS_ARM_SDK_POLICY =
  "native/windows-arm-full-sdk/sdk-origin-review.json";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPOSITORY = "supermarsx/sortOfRemoteNG";
const REPOSITORY_ID = 1010282954;
const execute = promisify(execFile);
const policies = new WeakMap();
const bindings = new WeakMap();
const MAX = 1024 * 1024;
const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sort(value[key])]),
    );
  return value;
}
function frozen(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const hex = (value, n = 64) =>
  typeof value === "string" && new RegExp("^[a-f0-9]{" + n + "}$").test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const need = (value, code) => assert(value, "WINDOWS_ARM_SDK_" + code);
function shape(value, keys) {
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join() === keys.slice().sort().join(),
    "FIELDS",
  );
}
function pin(value, maximum = MAX) {
  shape(value, ["bytes", "sha256"]);
  need(
    positive(value.bytes) && value.bytes <= maximum && hex(value.sha256),
    "PIN",
  );
}
function bytes(raw, expected, maximum = MAX) {
  pin(expected, maximum);
  need(
    Buffer.isBuffer(raw) &&
      raw.length === expected.bytes &&
      hash(raw) === expected.sha256,
    "BYTES",
  );
}
function json(raw, maximum = MAX) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= maximum,
    "BOUND",
  );
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(raw),
  );
  need(canonical(value) + "\n" === raw.toString("utf8"), "CANONICAL_JSON");
  return value;
}
function snapshotRecords(records) {
  shape(records, ["source", "compile", "package", "producerSeal"]);
  return Object.fromEntries(
    ["source", "compile", "package", "producerSeal"].map((role) => {
      const value = records[role];
      need(
        Buffer.isBuffer(value) && value.length > 0 && value.length <= MAX,
        "BOUND",
      );
      return [role, Buffer.from(value)];
    }),
  );
}
function snapshotArtifact(artifact) {
  shape(artifact, ["pin", "raw"]);
  const declared = artifact.pin;
  shape(declared, ["id", "bytes", "sha256"]);
  const copied = {
    id: declared.id,
    bytes: declared.bytes,
    sha256: declared.sha256,
  };
  need(positive(copied.id), "ARTIFACT");
  pin({ bytes: copied.bytes, sha256: copied.sha256 });
  const value = artifact.raw;
  need(
    Buffer.isBuffer(value) && value.length > 0 && value.length <= MAX,
    "BOUND",
  );
  return { pin: copied, raw: Buffer.from(value) };
}
function crc32(raw) {
  let value = 0xffffffff;
  for (const byte of raw) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function independentSeal(raw, member = "seal.json") {
  need(
    Buffer.isBuffer(raw) && raw.length >= 98 && raw.length <= MAX,
    "ZIP_BOUND",
  );
  const end = raw.length - 22;
  need(
    raw.readUInt32LE(end) === 0x06054b50 &&
      raw.readUInt16LE(end + 20) === 0 &&
      raw.readUInt16LE(end + 4) === 0 &&
      raw.readUInt16LE(end + 6) === 0,
    "ZIP_END",
  );
  let count = raw.readUInt16LE(end + 10),
    size = raw.readUInt32LE(end + 12),
    offset = raw.readUInt32LE(end + 16),
    terminal = end;
  need(raw.readUInt16LE(end + 8) === count, "ZIP_MULTIDISK");
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = end - 20;
    need(
      locator >= 56 &&
        raw.readUInt32LE(locator) === 0x07064b50 &&
        raw.readUInt32LE(locator + 4) === 0 &&
        raw.readUInt32LE(locator + 16) === 1,
      "ZIP64",
    );
    const at = Number(raw.readBigUInt64LE(locator + 8));
    need(
      Number.isSafeInteger(at) &&
        at >= 0 &&
        at + 56 === locator &&
        raw.readUInt32LE(at) === 0x06064b50 &&
        raw.readBigUInt64LE(at + 4) === 44n &&
        raw.readUInt32LE(at + 16) === 0 &&
        raw.readUInt32LE(at + 20) === 0 &&
        raw.readBigUInt64LE(at + 24) === 1n &&
        raw.readBigUInt64LE(at + 32) === 1n,
      "ZIP64",
    );
    count = 1;
    size = Number(raw.readBigUInt64LE(at + 40));
    offset = Number(raw.readBigUInt64LE(at + 48));
    terminal = at;
  }
  need(
    count === 1 &&
      Number.isSafeInteger(size) &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      size >= 46 &&
      offset + size === terminal &&
      raw.readUInt32LE(offset) === 0x02014b50,
    "ZIP_DIRECTORY",
  );
  const flags = raw.readUInt16LE(offset + 8),
    method = raw.readUInt16LE(offset + 10),
    crc = raw.readUInt32LE(offset + 16);
  let compressed = raw.readUInt32LE(offset + 20),
    expanded = raw.readUInt32LE(offset + 24),
    local = raw.readUInt32LE(offset + 42);
  const nameSize = raw.readUInt16LE(offset + 28),
    extraSize = raw.readUInt16LE(offset + 30),
    commentSize = raw.readUInt16LE(offset + 32);
  need(
    (flags & ~0x808) === 0 &&
      [0, 8].includes(method) &&
      raw.readUInt16LE(offset + 34) === 0 &&
      nameSize === Buffer.byteLength(member) &&
      raw
        .subarray(offset + 46, offset + 46 + nameSize)
        .equals(Buffer.from(member)) &&
      46 + nameSize + extraSize + commentSize === size &&
      commentSize === 0,
    "ZIP_ENTRY",
  );
  const mode = raw.readUInt32LE(offset + 38) >>> 16;
  need((mode & 0xf000) === 0 || (mode & 0xf000) === 0x8000, "ZIP_KIND");
  let extra = offset + 46 + nameSize,
    zip64 = false;
  while (extra < offset + 46 + nameSize + extraSize) {
    need(extra + 4 <= offset + 46 + nameSize + extraSize, "ZIP_EXTRA");
    const id = raw.readUInt16LE(extra),
      n = raw.readUInt16LE(extra + 2);
    extra += 4;
    need(extra + n <= offset + 46 + nameSize + extraSize, "ZIP_EXTRA");
    if (id === 1) {
      need(!zip64, "ZIP_EXTRA");
      zip64 = true;
      let cursor = extra;
      const read = () => {
        need(cursor + 8 <= extra + n, "ZIP_EXTRA");
        const value = Number(raw.readBigUInt64LE(cursor));
        cursor += 8;
        need(Number.isSafeInteger(value), "ZIP_EXTRA");
        return value;
      };
      if (expanded === 0xffffffff) expanded = read();
      if (compressed === 0xffffffff) compressed = read();
      if (local === 0xffffffff) local = read();
      need(cursor === extra + n, "ZIP_EXTRA");
    }
    extra += n;
  }
  need(
    positive(expanded) &&
      expanded <= MAX &&
      positive(compressed) &&
      compressed <= MAX &&
      local === 0 &&
      raw.readUInt32LE(local) === 0x04034b50 &&
      raw.readUInt16LE(local + 6) === flags &&
      raw.readUInt16LE(local + 8) === method &&
      raw.readUInt16LE(local + 26) === nameSize &&
      raw
        .subarray(local + 30, local + 30 + nameSize)
        .equals(Buffer.from(member)),
    "ZIP_LOCAL",
  );
  const start = local + 30 + nameSize + raw.readUInt16LE(local + 28),
    finish = start + compressed;
  need(
    finish <= offset &&
      (flags & 8
        ? [12, 16, 20, 24].includes(offset - finish)
        : finish === offset),
    "ZIP_DATA",
  );
  if (flags & 8) {
    const n = offset - finish,
      signed = n === 16 || n === 24,
      wide = n >= 20;
    let at = finish;
    if (signed) {
      need(raw.readUInt32LE(at) === 0x08074b50, "ZIP_DESCRIPTOR");
      at += 4;
    }
    need(raw.readUInt32LE(at) === crc, "ZIP_DESCRIPTOR");
    at += 4;
    need(
      wide
        ? raw.readBigUInt64LE(at) === BigInt(compressed) &&
            raw.readBigUInt64LE(at + 8) === BigInt(expanded)
        : raw.readUInt32LE(at) === compressed &&
            raw.readUInt32LE(at + 4) === expanded,
      "ZIP_DESCRIPTOR",
    );
  } else {
    need(
      raw.readUInt32LE(local + 14) === crc &&
        [compressed, 0xffffffff].includes(raw.readUInt32LE(local + 18)) &&
        [expanded, 0xffffffff].includes(raw.readUInt32LE(local + 22)),
      "ZIP_LOCAL_SIZE",
    );
  }
  const result =
    method === 0
      ? raw.subarray(start, finish)
      : inflateRawSync(raw.subarray(start, finish), {
          maxOutputLength: expanded + 1,
        });
  need(result.length === expanded && crc32(result) === crc, "ZIP_CRC");
  return result;
}

// BEGIN pure independent seal byte reader
// Decoding returns data only. Authentication and producer ownership are separate.
// Snapshot both boundaries so returned bytes never alias a caller-owned ZIP.
export function extractIndependentSealBytes(rawZip) {
  need(
    Buffer.isBuffer(rawZip) && rawZip.length >= 98 && rawZip.length <= MAX,
    "ZIP_BOUND",
  );
  return Buffer.from(independentSeal(Buffer.from(rawZip)));
}
// END pure independent seal byte reader

const stamp = (info) =>
  [
    info.dev,
    info.ino,
    info.mode,
    info.uid,
    info.nlink,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
  ].join(":");
async function git(args) {
  const devNull = process.platform === "win32" ? "NUL" : "/dev/null";
  need(
    (args.length === 2 && args[0] === "rev-parse" && args[1] === "HEAD") ||
      (args.length === 4 &&
        args[0] === "ls-tree" &&
        hex(args[1], 40) &&
        args[2] === "--") ||
      (args.length === 3 &&
        args[0] === "cat-file" &&
        args[1] === "blob" &&
        /^[a-f0-9]{40}:/.test(args[2])),
    "GIT_COMMAND",
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(?:GIT_|GCM_|SSH_ASKPASS$)/i.test(name),
    ),
  );
  const { stdout } = await execute(
    "git",
    [
      "-c",
      "core.hooksPath=" + devNull,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.longpaths=true",
      "--no-pager",
      "-C",
      ROOT,
      ...args,
    ],
    {
      encoding: "buffer",
      maxBuffer: 4 * MAX,
      timeout: 10000,
      windowsHide: true,
      env: {
        ...environment,
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  return stdout;
}
async function noLinks(file) {
  for (let current = file; ; current = path.dirname(current)) {
    const info = await fs.lstat(current);
    need(
      !info.isSymbolicLink() && !(Number(info.fileAttributes ?? 0) & 0x400),
      "LINK",
    );
    if (path.dirname(current) === current) break;
  }
}
async function hold(relative, head, expected) {
  const listing = (await git(["ls-tree", head, "--", relative])).toString();
  const row = /^(100644|100755) blob ([a-f0-9]{40})\t([^\r\n]+)\n$/.exec(
    listing,
  );
  need(
    row &&
      row[3] === relative &&
      (![WINDOWS_ARM_SDK_POLICY, WINDOWS_ARM_SDK_WORKFLOW].includes(relative) ||
        row[1] === "100644"),
    "GIT_MODE",
  );
  const file = path.join(ROOT, relative);
  await noLinks(file);
  const before = await fs.lstat(file, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(MAX),
    "REGULAR",
  );
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    need(
      stamp(await handle.stat({ bigint: true })) === stamp(before),
      "FD_CHANGED",
    );
    const blocks = [];
    let count = 0;
    for (;;) {
      const block = Buffer.alloc(
        Math.min(65536, Number(before.size) - count + 1),
      );
      const { bytesRead } = await handle.read(block, 0, block.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      need(count <= Number(before.size) && count <= MAX, "BOUND");
      blocks.push(block.subarray(0, bytesRead));
    }
    need(count === Number(before.size), "FILE_CHANGED");
    const raw = Buffer.concat(blocks, count);
    need(
      stamp(await handle.stat({ bigint: true })) === stamp(before) &&
        stamp(await fs.lstat(file, { bigint: true })) === stamp(before),
      "FILE_CHANGED",
    );
    const committed = await git(["cat-file", "blob", head + ":" + relative]);
    need(raw.equals(committed), "UNCOMMITTED");
    if (expected) bytes(raw, expected);
    return {
      file,
      relative,
      handle,
      raw,
      identity: stamp(before),
      blob: createHash("sha1")
        .update(Buffer.from("blob " + raw.length + "\0"))
        .update(raw)
        .digest("hex"),
      mode: row[1],
    };
  } catch (error) {
    try {
      await handle.close();
    } catch {
      /* Preserve the exact primary. */
    }
    throw error;
  }
}
const SOURCES = Object.freeze({
  "20261030.294.1": Object.freeze({
    sourceLockIdentity:
      "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    sourceProfileSha256:
      "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",
  }),
  "20261021.278.1": Object.freeze({
    sourceLockIdentity:
      "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
    sourceProfileSha256:
      "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",
  }),
});
const BRIDGE = Object.freeze({
  abiVersion: 2,
  patchId: "sorng-tls-v2-682c378-5",
  headerSha256:
    "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
  chromium: "a654841425914cbb703a2931e07b70a83aedbafd",
  cef: "682c378d70d5780061e96644dca16ddd8fd157a9",
});
const HELPER_INPUTS = new Set([
  "native/cef-hosted-recipe.json",
  "scripts/browser-runtime-package.mjs",
  "scripts/cef-custom-artifact-inventory.mjs",
  "scripts/cef-hosted-bootstrap.mjs",
  "scripts/cef-hosted-provision.mjs",
  "scripts/cef-patched-runtime.mjs",
  "scripts/cef-runtime-ci.mjs",
  "scripts/lib/browser-custom-runtime.mjs",
  "scripts/lib/browser-runtime-release.mjs",
  "scripts/lib/cef-engineering-checkpoint.mjs",
  "scripts/lib/cef-mac-sdk-inventory.mjs",
  "scripts/lib/cef-checkpoint-archive.py",
  "scripts/lib/cef-mac-source-metadata.mjs",
]);
const INPUT_PATCHES = new Set([
  "0001-chromium-socket-admission.patch",
  "0002-cef-native-bridge.patch",
  "0003-cef-native-widget-lifetime.patch",
  "0004-chromium-soda-provisioning.patch",
  "0005-chromium-proxy-route-probe.patch",
  "0006-cef-explicit-download-destination.patch",
  "0007-chromium-instance-tracer-reentrancy.patch",
  "0008-chromium-same-authority-http2.patch",
  "0009-cef-http2-bridge-capability.patch",
  "0010-chromium-proxy-application-ack.patch",
  "0011-cef-proxy-application-ack.patch",
  "0012-cef-registration-retirement.patch",
  "0013-chromium-owned-quic-datagrams.patch",
  "0014-cef-owned-quic-datagrams.patch",
  "0015-chromium-owned-quic-job-selection.patch",
  "0016-chromium-owned-quic-payload-advertisement.patch",
  "0017-chromium-instance-tracer-allocation-reentrancy.patch",
  "0018-chromium-owned-capsule-context-lifetime.patch",
  "0019-chromium-owned-capsule-test-netlog-qualification.patch",
  "0020-chromium-base-unittests-trace-processor-dependency.patch",
  "0021-chromium-test-trace-processor-dependency-closure.patch",
  "0022-chromium-test-trace-processor-static-package-name.patch",
  "0024-cef-external-webview-lifetime.patch",
]);
const INPUT_EXCEPTIONS = new Set([
  ".github/workflows/windows-x64-arm-toolchain.yml",
  ".github/workflows/windows-arm-source-preflight.yml",
  ".github/workflows/windows-arm-compiler-input-qualification.yml",
  "tests/tooling/windowsArmFullSdk.node-test.mjs",
  "tests/tooling/windowsArmImageQualifiedSourceGn.node-test.mjs",
  "tests/tooling/windowsArmEngineQualification.node-test.mjs",
  "tests/tooling/windowsArmPrivateQualification.node-test.mjs",
]);
function supportedProducerInput(name) {
  if (RAW_PRODUCER_PATHS.includes(name)) return true;
  if (
    typeof name !== "string" ||
    name.length > 512 ||
    !/^[A-Za-z0-9_.\/-]+$/.test(name) ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    return false;
  if (INPUT_EXCEPTIONS.has(name)) return true;
  if (
    /^native\/windows-arm-full-sdk\/[A-Za-z0-9_.-]+\.(?:py|mjs|json|cc)$/.test(
      name,
    )
  )
    return name !== WINDOWS_ARM_SDK_POLICY;
  const helpers = "native/windows-arm-full-sdk/current-source-helpers/";
  if (name.startsWith(helpers))
    return HELPER_INPUTS.has(name.slice(helpers.length));
  for (const namespace of [
    "20261101-r5-windows-arm64-cross-x64-current-source-gn",
    "20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn",
  ]) {
    const prefix = "native/cef-build-inputs/" + namespace + "/";
    if (!name.startsWith(prefix)) continue;
    const member = name.slice(prefix.length);
    return (
      [
        "cef-ci-runner-aarch64-pc-windows-msvc.json",
        "source-lock.json",
        "review-receipt.json",
        "upstream-sha256.json",
        "gn/aarch64-pc-windows-msvc.gn",
        "include/cef_sorng_tls_bridge.h",
        "tools/aarch64-pc-windows-msvc.json",
      ].includes(member) ||
      (member.startsWith("patches/") && INPUT_PATCHES.has(member.slice(8)))
    );
  }
  return false;
}
function policyShape(value) {
  shape(value, [
    "schemaVersion",
    "kind",
    "origin",
    "target",
    "workflow",
    "workflowPin",
    "sources",
    "bridge",
    "producerInputs",
    "recordSchemaVersion",
    "jobPolicy",
  ]);
  need(
    value.schemaVersion === 1 &&
      value.recordSchemaVersion === 1 &&
      value.kind === "sorng-windows-arm64-sdk-origin-policy" &&
      value.origin === WINDOWS_ARM_SDK_ORIGIN &&
      value.target === WINDOWS_ARM_SDK_TARGET &&
      value.workflow === WINDOWS_ARM_SDK_WORKFLOW &&
      canonical(value.sources) === canonical(SOURCES) &&
      canonical(value.bridge) === canonical(BRIDGE),
    "POLICY",
  );
  pin(value.workflowPin);
  shape(value.jobPolicy, [
    "maxWorkMs",
    "cleanupMs",
    "wholeMs",
    "finalReserveMs",
  ]);
  const limits = value.jobPolicy;
  need(
    positive(limits.maxWorkMs) &&
      limits.maxWorkMs <= 21600 * 1000 &&
      limits.cleanupMs === 30000 &&
      positive(limits.wholeMs) &&
      limits.wholeMs <= 21600 * 1000 &&
      positive(limits.finalReserveMs) &&
      limits.maxWorkMs + limits.cleanupMs + limits.finalReserveMs <=
        limits.wholeMs,
    "JOB_POLICY",
  );
  need(
    Array.isArray(value.producerInputs) &&
      value.producerInputs.length > 0 &&
      value.producerInputs.length <= 128,
    "INPUTS",
  );
  const seen = new Set();
  for (const row of value.producerInputs) {
    shape(row, ["path", "bytes", "sha256"]);
    need(supportedProducerInput(row.path) && !seen.has(row.path), "INPUT_PATH");
    pin({ bytes: row.bytes, sha256: row.sha256 });
    seen.add(row.path);
  }
  return value;
}
async function current(receipt) {
  const state = policies.get(receipt);
  need(state, "OPAQUE_POLICY");
  need(
    (await git(["rev-parse", "HEAD"])).toString().trim() === state.head,
    "HEAD_CHANGED",
  );
  for (const row of state.held) {
    await noLinks(row.file);
    need(
      stamp(await row.handle.stat({ bigint: true })) === row.identity &&
        stamp(await fs.lstat(row.file, { bigint: true })) === row.identity,
      "FILE_CHANGED",
    );
    const raw = Buffer.alloc(row.raw.length);
    let at = 0;
    while (at < raw.length) {
      const result = await row.handle.read(raw, at, raw.length - at, at);
      need(result.bytesRead > 0, "FILE_CHANGED");
      at += result.bytesRead;
    }
    need(
      raw.equals(row.raw) &&
        stamp(await row.handle.stat({ bigint: true })) === row.identity &&
        stamp(await fs.lstat(row.file, { bigint: true })) === row.identity,
      "FILE_CHANGED",
    );
  }
  need(policies.get(receipt) === state, "OPAQUE_POLICY");
  need(
    (await git(["rev-parse", "HEAD"])).toString().trim() === state.head,
    "HEAD_CHANGED",
  );
  need(policies.get(receipt) === state, "OPAQUE_POLICY");
  return state;
}
function retained(receipt, state, original = state) {
  need(state === original && policies.get(receipt) === state, "OPAQUE_POLICY");
}
export function inspectWindowsArmSdkOriginPolicy(raw) {
  const value = policyShape(json(raw));
  // Pure schema projection, deliberately absent from the capability registry.
  return Object.freeze({
    kind: "windows-arm-full-sdk-origin-policy-candidate",
    origin: value.origin,
    target: value.target,
    producerInputs: value.producerInputs.length,
    executionAdmitted: false,
  });
}
export async function loadWindowsArmSdkOrigin() {
  need(arguments.length === 0, "ARGUMENTS");
  const head = (await git(["rev-parse", "HEAD"])).toString().trim();
  need(hex(head, 40), "HEAD");
  const held = [];
  try {
    const file = await hold(WINDOWS_ARM_SDK_POLICY, head);
    held.push(file);
    const policy = policyShape(json(file.raw));
    held.push(await hold(WINDOWS_ARM_SDK_WORKFLOW, head, policy.workflowPin));
    for (const row of policy.producerInputs)
      held.push(
        await hold(row.path, head, { bytes: row.bytes, sha256: row.sha256 }),
      );
    const receipt = Object.freeze({
      kind: "windows-arm-full-sdk-origin-policy",
      executionAdmitted: false,
    });
    const state = { head, held, policy, policySha256: hash(file.raw) };
    policies.set(receipt, state);
    try {
      retained(receipt, await current(receipt), state);
    } catch (error) {
      policies.delete(receipt);
      throw error;
    }
    return receipt;
  } catch (error) {
    for (const row of held) {
      try {
        await row.handle.close();
      } catch {
        /* Preserve primary. */
      }
    }
    throw error;
  }
}
export async function closeWindowsArmSdkOrigin(receipt) {
  const state = policies.get(receipt);
  need(state, "OPAQUE_POLICY");
  policies.delete(receipt); // Retire even when a close reports failure.
  let failed = false,
    first;
  for (const row of state.held) {
    try {
      await row.handle.close();
    } catch (error) {
      if (!failed) {
        failed = true;
        first = error;
      }
    }
  }
  if (failed) throw first;
}
export async function inspectWindowsArmSdkOriginReview(receipt, review) {
  shape(review, [
    "schemaVersion",
    "kind",
    "origin",
    "target",
    "originPolicySha256",
    "sourceLockIdentity",
    "bundleSourceLockRawSha256",
    "originalInputsSourceLockRawSha256",
    "descriptorSha256",
    "handoffSha256",
    "reviewBinding",
    "assets",
    "engineSha256",
    "filesVerified",
  ]);
  const fields = Object.keys(review);
  const text = canonical(review);
  need(Buffer.byteLength(text) <= MAX, "BOUND");
  review = JSON.parse(text);
  shape(review, fields);
  const state = await current(receipt);
  retained(receipt, state);
  need(
    review.schemaVersion === 1 &&
      review.kind === "sorng-cef-owned-import-review" &&
      review.origin === WINDOWS_ARM_SDK_ORIGIN &&
      review.target === WINDOWS_ARM_SDK_TARGET &&
      review.originPolicySha256 === state.policySha256 &&
      Object.values(SOURCES).some(
        (value) => value.sourceLockIdentity === review.sourceLockIdentity,
      ),
    "REVIEW_SCOPE",
  );
  // Existing owned-review validation remains responsible for the unchanged
  // portable asset/review-binding fields. This adds only the origin boundary.
  return frozen({
    kind: "windows-arm-full-sdk-owned-review-origin",
    origin: review.origin,
    target: review.target,
    sourceLockIdentity: review.sourceLockIdentity,
    originPolicySha256: state.policySha256,
    bundleVerified: false,
    nativeAcceptance: false,
    runtimeReady: false,
    publicationAllowed: false,
  });
}
function producer(value) {
  shape(value, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
    "workflowId",
  ]);
  need(
    value.repository === REPOSITORY &&
      value.repositoryId === REPOSITORY_ID &&
      positive(value.runId) &&
      positive(value.attempt) &&
      hex(value.head, 40) &&
      value.branch === "main" &&
      value.workflow === WINDOWS_ARM_SDK_WORKFLOW &&
      positive(value.workflowId),
    "PRODUCER",
  );
}
function base(value, kind, extra, state) {
  shape(value, [
    "schemaVersion",
    "kind",
    "origin",
    "target",
    "originPolicySha256",
    "producer",
    "image",
    "sourceLockIdentity",
    ...extra,
  ]);
  need(
    value.schemaVersion === 1 &&
      value.kind === kind &&
      value.origin === WINDOWS_ARM_SDK_ORIGIN &&
      value.target === WINDOWS_ARM_SDK_TARGET &&
      value.originPolicySha256 === state.policySha256 &&
      Object.hasOwn(SOURCES, value.image) &&
      value.sourceLockIdentity === SOURCES[value.image].sourceLockIdentity,
    "RECORD",
  );
  producer(value.producer);
}
function digest(value) {
  need(hex(value), "DIGEST");
}
// BEGIN schema2 raw quarantine origin
// These checks authenticate the approved original producer's finite readers.
// Nine metadata pins and 162 checked files are not a whole Chromium inventory.
const RAW_PRODUCER_PATHS = Object.freeze([
  ".node-version",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/cef-ci-runner-aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/gn/aarch64-pc-windows-msvc.gn",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/include/cef_sorng_tls_bridge.h",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0001-chromium-socket-admission.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0002-cef-native-bridge.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0003-cef-native-widget-lifetime.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0004-chromium-soda-provisioning.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0005-chromium-proxy-route-probe.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0006-cef-explicit-download-destination.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0007-chromium-instance-tracer-reentrancy.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0008-chromium-same-authority-http2.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0009-cef-http2-bridge-capability.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0010-chromium-proxy-application-ack.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0011-cef-proxy-application-ack.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0012-cef-registration-retirement.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0013-chromium-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0014-cef-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0015-chromium-owned-quic-job-selection.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0016-chromium-owned-quic-payload-advertisement.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0018-chromium-owned-capsule-context-lifetime.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0020-chromium-base-unittests-trace-processor-dependency.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0021-chromium-test-trace-processor-dependency-closure.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/patches/0022-chromium-test-trace-processor-static-package-name.patch",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/review-receipt.json",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/source-lock.json",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/tools/aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/upstream-sha256.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/cef-ci-runner-aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/gn/aarch64-pc-windows-msvc.gn",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/include/cef_sorng_tls_bridge.h",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0001-chromium-socket-admission.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0002-cef-native-bridge.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0003-cef-native-widget-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0004-chromium-soda-provisioning.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0005-chromium-proxy-route-probe.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0006-cef-explicit-download-destination.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0007-chromium-instance-tracer-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0008-chromium-same-authority-http2.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0009-cef-http2-bridge-capability.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0010-chromium-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0011-cef-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0012-cef-registration-retirement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0013-chromium-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0014-cef-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0015-chromium-owned-quic-job-selection.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0016-chromium-owned-quic-payload-advertisement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0018-chromium-owned-capsule-context-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0020-chromium-base-unittests-trace-processor-dependency.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0021-chromium-test-trace-processor-dependency-closure.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0022-chromium-test-trace-processor-static-package-name.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0024-cef-external-webview-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/review-receipt.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/source-lock.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/tools/aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/upstream-sha256.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/cef-ci-runner-aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/gn/aarch64-pc-windows-msvc.gn",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/include/cef_sorng_tls_bridge.h",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0001-chromium-socket-admission.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0002-cef-native-bridge.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0003-cef-native-widget-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0004-chromium-soda-provisioning.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0005-chromium-proxy-route-probe.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0006-cef-explicit-download-destination.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0007-chromium-instance-tracer-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0008-chromium-same-authority-http2.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0009-cef-http2-bridge-capability.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0010-chromium-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0011-cef-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0012-cef-registration-retirement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0013-chromium-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0014-cef-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0015-chromium-owned-quic-job-selection.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0016-chromium-owned-quic-payload-advertisement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0018-chromium-owned-capsule-context-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0020-chromium-base-unittests-trace-processor-dependency.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0021-chromium-test-trace-processor-dependency-closure.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0022-chromium-test-trace-processor-static-package-name.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0024-cef-external-webview-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/review-receipt.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/source-lock.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/tools/aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/upstream-sha256.json",
  "native/windows-arm-full-sdk/acquire.py",
  "native/windows-arm-full-sdk/checkpoint.py",
  "native/windows-arm-full-sdk/checkpoint_inputs.py",
  "native/windows-arm-full-sdk/compiled_checkpoint.py",
  "native/windows-arm-full-sdk/compiler_input_probe.cc",
  "native/windows-arm-full-sdk/current-source-helpers/native/cef-hosted-recipe.json",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/browser-runtime-package.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-custom-artifact-inventory.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-hosted-bootstrap.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-hosted-provision.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-patched-runtime.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-runtime-release.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-checkpoint-archive.py",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-mac-sdk-inventory.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-mac-source-metadata.mjs",
  "native/windows-arm-full-sdk/engine-qualification-profile.json",
  "native/windows-arm-full-sdk/environment.py",
  "native/windows-arm-full-sdk/expected-defaults.mjs",
  "native/windows-arm-full-sdk/extract.py",
  "native/windows-arm-full-sdk/full-sdk-engine-worker.mjs",
  "native/windows-arm-full-sdk/full-sdk-source-driver.mjs",
  "native/windows-arm-full-sdk/full-sdk-source-profile.json",
  "native/windows-arm-full-sdk/full_sdk_control.mjs",
  "native/windows-arm-full-sdk/full_sdk_engine.py",
  "native/windows-arm-full-sdk/full_sdk_source.py",
  "native/windows-arm-full-sdk/image-qualified-20261021-profile.json",
  "native/windows-arm-full-sdk/image-qualified-current-profile.json",
  "native/windows-arm-full-sdk/job.py",
  "native/windows-arm-full-sdk/private-qualification-profile.json",
  "native/windows-arm-full-sdk/producer.py",
  "native/windows-arm-full-sdk/profile.json",
  "native/windows-arm-full-sdk/source-root.mjs",
  "native/windows-arm-full-sdk/test_full_sdk_source.py",
  "native/windows-arm-full-sdk/workflow-clock.mjs",
  "tests/tooling/windowsArmFullSdk.node-test.mjs",
]);
const RAW_KIND = "windows-arm-full-sdk-quarantine-seal";
const RAW_MEMBER = "full-sdk-sdk-seal.json";
const rawPin = (value) => ({ bytes: value.length, sha256: hash(value) });
const equalRaw = (a, b) => canonical(a) === canonical(b);
function rawJson(raw, maximum = MAX) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= maximum,
    "RAW_BOUND",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let at = 0;
  const white = () => {
    while (/[\x20\t\r\n]/.test(text[at] ?? "x")) at++;
  };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') return JSON.parse(text.slice(start, at));
      if (c === "\\") at++;
    }
    need(false, "RAW_JSON");
  };
  const scan = (depth) => {
    need(depth <= 64, "RAW_JSON");
    white();
    if (text[at] === '"') {
      string();
      return;
    }
    if (text[at] === "{" || text[at] === "[") {
      const object = text[at++] === "{",
        end = object ? "}" : "]",
        keys = new Set();
      white();
      if (text[at] === end) {
        at++;
        return;
      }
      for (;;) {
        if (object) {
          need(text[at] === '"', "RAW_JSON");
          const k = string();
          need(!keys.has(k), "RAW_JSON_DUPLICATE");
          keys.add(k);
          white();
          need(text[at++] === ":", "RAW_JSON");
        }
        scan(depth + 1);
        white();
        if (text[at] === end) {
          at++;
          return;
        }
        need(text[at++] === ",", "RAW_JSON");
        white();
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
        text.slice(at),
      );
    need(token, "RAW_JSON");
    at += token[0].length;
    if (!["true", "false", "null"].includes(token[0]))
      need(Number.isFinite(Number(token[0])), "RAW_JSON");
  };
  scan(0);
  white();
  need(at === text.length, "RAW_JSON");
  return JSON.parse(text);
}
function rawEvidence(row) {
  shape(row, ["bytes", "sha256", "base64"]);
  pin({ bytes: row.bytes, sha256: row.sha256 });
  const padding = (3 - (row.bytes % 3)) % 3;
  need(
    typeof row.base64 === "string" &&
      row.base64.length === Math.ceil(row.bytes / 3) * 4 &&
      /^[A-Za-z0-9+/]+$/.test(
        row.base64.slice(0, row.base64.length - padding),
      ) &&
      row.base64.slice(row.base64.length - padding) === "=".repeat(padding),
    "RAW_EVIDENCE",
  );
  const raw = Buffer.from(row.base64, "base64");
  need(raw.toString("base64") === row.base64, "RAW_EVIDENCE");
  bytes(raw, { bytes: row.bytes, sha256: row.sha256 });
  return { raw, value: rawJson(raw), pin: rawPin(raw) };
}
function rawRoot(image, sourceId) {
  const value = createHash("sha256")
    .update(
      "sortOfRemoteNG/windows-arm-full-sdk/root/v1\0repositoryId=1010282954" +
        "\0target=aarch64-pc-windows-msvc\0image=" +
        image +
        "\0sourceId=" +
        sourceId,
    )
    .digest()
    .subarray(0, 16);
  value[6] = (value[6] & 15) | 64;
  value[8] = (value[8] & 63) | 128;
  const s = value.toString("hex");
  return (
    "windows-arm-full-sdk-" +
    [
      s.slice(0, 8),
      s.slice(8, 12),
      s.slice(12, 16),
      s.slice(16, 20),
      s.slice(20),
    ].join("-")
  );
}
function rawJob(value, cap) {
  const observed = job(
    {
      exitCode: 0,
      outcome: "success",
      quiescent: true,
      rootReaped: true,
      logReadersStopped: true,
      activeAtEnd: 0,
      processLimit: 64,
      memoryBytes: 8 * 1024 ** 3,
      cpuRate: 2500,
      workMs: 21600000 - 150000,
      cleanupMs: 30000,
      elapsedMs: value.value.elapsedMs,
    },
    { ...value.pin, base64: value.raw.toString("base64") },
    {
      policy: { jobPolicy: { maxWorkMs: 21600000 - 150000, cleanupMs: 30000 } },
    },
  );
  need(value.value.outputCapBytes === cap, "RAW_JOB_CAP");
  return observed;
}
function rawTiming(v, source) {
  shape(v, [
    "kind",
    "wholeMs",
    "reserveMs",
    "wallStartMs",
    "tickStartMs",
    "wallEndMs",
    "tickEndMs",
    "wallSampleMs",
    "tickSampleMs",
    "sourceWallEndMs",
    "sourceTickEndMs",
    "remainingMs",
    "producerElapsedMs",
  ]);
  need(
    Object.entries(v).every(
      ([k, n]) => k === "kind" || (Number.isSafeInteger(n) && n >= 0),
    ) &&
      v.kind === "windows-arm-original-whole-clock-sample" &&
      v.wholeMs === 21600000 &&
      v.reserveMs === 150000 &&
      v.wallEndMs - v.wallStartMs === v.wholeMs &&
      v.tickEndMs - v.tickStartMs === v.wholeMs &&
      v.wallSampleMs >= v.wallStartMs &&
      v.tickSampleMs >= v.tickStartMs &&
      v.sourceWallEndMs === Math.floor(source.wallWholeEnd * 1000) &&
      v.sourceWallEndMs <= v.wallEndMs &&
      v.sourceTickEndMs === Math.floor(source.monotonicWholeEnd * 1000) &&
      v.sourceTickEndMs <= v.tickEndMs &&
      v.remainingMs ===
        Math.min(
          v.wallEndMs - v.wallSampleMs,
          v.tickEndMs - v.tickSampleMs,
          v.sourceWallEndMs - v.wallSampleMs,
          v.sourceTickEndMs - v.tickSampleMs,
        ) &&
      v.remainingMs > v.reserveMs &&
      v.producerElapsedMs === v.wholeMs - v.remainingMs &&
      v.producerElapsedMs > 0 &&
      v.producerElapsedMs < v.wholeMs - v.reserveMs,
    "RAW_TIMING",
  );
}
function rawDetails(seal, state) {
  need(
    equalRaw(state.policy.jobPolicy, {
      maxWorkMs: 21450000,
      cleanupMs: 30000,
      wholeMs: 21600000,
      finalReserveMs: 120000,
    }),
    "RAW_JOB_POLICY",
  );
  shape(seal, [
    "schemaVersion",
    "kind",
    "origin",
    "target",
    "identity",
    "workflow",
    "release",
    "assets",
    "controller",
    "nativePhases",
    "checkedInputs",
    "producerTiming",
    "sourceChain",
    "sourceNative",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
    "publicationAllowed",
  ]);
  need(
    seal.schemaVersion === 2 &&
      seal.kind === RAW_KIND &&
      seal.origin === WINDOWS_ARM_SDK_ORIGIN &&
      seal.target === WINDOWS_ARM_SDK_TARGET &&
      seal.sdkBuilt === true &&
      ["nativeAcceptance", "runtimeReady", "publicationAllowed"].every(
        (k) => seal[k] === false,
      ),
    "RAW_SCOPE",
  );
  const identity = seal.identity,
    wf = seal.workflow;
  shape(identity, [
    "image",
    "sourceId",
    "producerSha256",
    "sourceDateEpoch",
    "canonicalRoot",
    "toolProofPin",
    "graphPin",
  ]);
  need(
    Object.hasOwn(SOURCES, identity.image) &&
      identity.sourceId === SOURCES[identity.image].sourceLockIdentity &&
      identity.canonicalRoot === rawRoot(identity.image, identity.sourceId) &&
      equalRaw(identity.sourceDateEpoch, { present: false, value: null }),
    "RAW_IDENTITY",
  );
  pin(identity.toolProofPin, 16 * MAX);
  pin(identity.graphPin, 16 * MAX);
  shape(wf, [
    "repository",
    "repositoryId",
    "path",
    "ref",
    "head",
    "runId",
    "attempt",
  ]);
  need(
    wf.repository === REPOSITORY &&
      wf.repositoryId === REPOSITORY_ID &&
      wf.path === WINDOWS_ARM_SDK_WORKFLOW &&
      wf.ref === "refs/heads/main" &&
      hex(wf.head, 40) &&
      typeof wf.runId === "string" &&
      /^[1-9][0-9]{0,15}$/.test(wf.runId) &&
      typeof wf.attempt === "string" &&
      /^[1-9][0-9]{0,8}$/.test(wf.attempt) &&
      positive(Number(wf.runId)),
    "RAW_WORKFLOW",
  );
  need(
    state.policy.producerInputs.length === 128 &&
      equalRaw(
        state.policy.producerInputs.map((r) => r.path),
        RAW_PRODUCER_PATHS,
      ),
    "RAW_INPUT_PATHS",
  );
  const rows = state.policy.producerInputs;
  need(
    identity.producerSha256 === hash(Buffer.from(canonical(rows))),
    "RAW_PRODUCER",
  );
  const sourceNames = [
    "context.json",
    "full-sdk-engine-cef-engine-context.json",
    "full-sdk-engine-cef-engine-launch.json",
    "jobs/cef-engine/receipt.json",
    "full-sdk-engine-closed-cef-engine.json",
    "jobs/full-source-operation/receipt.json",
    "full-source-launcher-result.json",
    "full-source-closed-launcher.json",
  ];
  shape(seal.sourceNative, sourceNames);
  const native = Object.fromEntries(
    sourceNames.map((n) => [n, rawEvidence(seal.sourceNative[n])]),
  );
  const source = native["context.json"].value,
    sourcePin = native["context.json"].pin;
  shape(source, [
    "kind",
    "mode",
    "workflow",
    "policy",
    "ref",
    "repository",
    "repositoryId",
    "event",
    "visibility",
    "defaultBranch",
    "inputs",
    "checkpointRestore",
    "image",
    "target",
    "sourceId",
    "sourceProfileSha256",
    "head",
    "workflowSha",
    "runId",
    "attempt",
    "sources",
    "originPolicySha256",
    "wallWholeEnd",
    "monotonicWholeEnd",
    "wallWorkEnd",
    "monotonicWorkEnd",
    "wallAcquisitionEnd",
    "monotonicAcquisitionEnd",
  ]);
  shape(source.inputs, ["restore_run"]);
  need(
    typeof source.inputs.restore_run === "string" &&
      /^(?:0|[1-9][0-9]{0,15})$/.test(source.inputs.restore_run),
    "RAW_RESTORE_SCOPE",
  );
  if (source.checkpointRestore !== null) {
    shape(source.checkpointRestore, ["runId", "attempt", "readyPin"]);
    need(
      source.checkpointRestore.runId === source.inputs.restore_run &&
        /^[1-9][0-9]{0,8}$/.test(source.checkpointRestore.attempt),
      "RAW_RESTORE_SCOPE",
    );
    pin(source.checkpointRestore.readyPin);
  } else need(source.inputs.restore_run === "0", "RAW_RESTORE_SCOPE");
  need(
    source.kind === "windows-arm-full-sdk-context" &&
      source.mode === "full-sdk-source-gn" &&
      source.repository === REPOSITORY &&
      source.repositoryId === String(REPOSITORY_ID) &&
      source.workflow === wf.path &&
      source.ref === wf.ref &&
      source.event === "workflow_dispatch" &&
      source.visibility === "public" &&
      source.defaultBranch === "main" &&
      source.policy === WINDOWS_ARM_SDK_POLICY &&
      source.sourceProfileSha256 ===
        SOURCES[identity.image].sourceProfileSha256 &&
      source.head === wf.head &&
      source.workflowSha === wf.head &&
      source.runId === wf.runId &&
      source.attempt === wf.attempt &&
      source.image === identity.image &&
      source.sourceId === identity.sourceId &&
      source.target === WINDOWS_ARM_SDK_TARGET &&
      source.originPolicySha256 === state.policySha256 &&
      equalRaw(source.sources, rows) &&
      [
        source.wallWholeEnd,
        source.monotonicWholeEnd,
        source.wallWorkEnd,
        source.monotonicWorkEnd,
        source.wallAcquisitionEnd,
        source.monotonicAcquisitionEnd,
      ].every(Number.isFinite) &&
      source.wallAcquisitionEnd <= source.wallWorkEnd &&
      source.wallWorkEnd <= source.wallWholeEnd &&
      source.monotonicAcquisitionEnd <= source.monotonicWorkEnd &&
      source.monotonicWorkEnd <= source.monotonicWholeEnd,
    "RAW_SOURCE",
  );
  const index = (name) => {
    const i = rows.findIndex((r) => r.path === name);
    need(i >= 0, "RAW_INPUT");
    return i;
  };
  const metadataPaths = [
    "native/windows-arm-full-sdk/private-qualification-profile.json",
    "native/windows-arm-full-sdk/engine-qualification-profile.json",
  ]
    .map((n) => "source-inputs/" + index(n))
    .concat([
      "private-qualification-logs/qual-gn-desc-pa.stdout.log",
      "private-qualification-logs/qual-gn-desc-cef.stdout.log",
      "private-qualification-logs/qual-gn-args.stdout.log",
      "source-checkout/src/out/Release_GN_arm64/args.gn",
      "source-checkout/src/out/Release_GN_arm64/gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h",
      "source-checkout/src/out/Release_GN_arm64/gen/cef/include/cef_config.h",
      "full-metadata-result.json",
    ]);
  const roles = ["probe-clang", "probe-link", "cef-engine", "package"],
    phaseNames = roles.flatMap((r) => [
      "full-sdk-engine-" + r + "-context.json",
      "full-sdk-engine-" + r + "-launch.json",
      "jobs/" + r + "/receipt.json",
      "full-sdk-engine-closed-" + r + ".json",
      "full-sdk-engine-" + r + "-result.json",
    ]);
  shape(seal.nativePhases, phaseNames);
  const phases = Object.fromEntries(
    phaseNames.map((n) => [n, rawEvidence(seal.nativePhases[n])]),
  );
  const expected = new Map([
    ["context.json", sourcePin],
    ["source-gn-logs/fresh-graph-pins.json", identity.graphPin],
    ["installed-source-inventory.json", identity.toolProofPin],
  ]);
  const add = (name, p) => {
    const old = expected.get(name);
    need(!old || equalRaw(old, p), "RAW_CHECKED_PIN");
    expected.set(name, p);
  };
  rows.forEach((r, i) =>
    add("source-inputs/" + i, { bytes: r.bytes, sha256: r.sha256 }),
  );
  add("source-checkout/src/cef/BUILD.gn", {
    bytes: 97568,
    sha256: "2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0",
  });
  add(
    "source-checkout/src/base/allocator/partition_allocator/src/partition_alloc/BUILD.gn",
    {
      bytes: 45891,
      sha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
    },
  );
  const identities = new Set();
  let previous = null,
    metadata = null,
    gitPolicies = null,
    parent = null,
    probe = null,
    elapsed = 0;
  for (const role of roles) {
    const at = (suffix) => phases[suffix],
      packet = at("full-sdk-engine-" + role + "-context.json"),
      launch = at("full-sdk-engine-" + role + "-launch.json"),
      raw = at("jobs/" + role + "/receipt.json"),
      closed = at("full-sdk-engine-closed-" + role + ".json"),
      result = at("full-sdk-engine-" + role + "-result.json"),
      p = packet.value,
      l = launch.value,
      c = closed.value,
      r = result.value;
    shape(p, [
      "schemaVersion",
      "kind",
      "mode",
      "role",
      "sourceContextSha256",
      "image",
      "sourceId",
      "target",
      "wallWholeEnd",
      "monotonicWholeEnd",
      "wallPhaseEnd",
      "monotonicPhaseEnd",
      "parentPid",
      "parentCreationFiletime",
      "metadataFiles",
      "gitPolicyFiles",
      "prior",
    ]);
    need(
      p.schemaVersion === 1 &&
        p.kind === "windows-arm-full-sdk-engine-context" &&
        p.mode === "full-sdk-engine" &&
        p.role === role &&
        p.sourceContextSha256 === sourcePin.sha256 &&
        p.image === source.image &&
        p.sourceId === source.sourceId &&
        p.target === seal.target &&
        p.wallWholeEnd === source.wallWholeEnd &&
        p.monotonicWholeEnd === source.monotonicWholeEnd &&
        [p.wallPhaseEnd, p.monotonicPhaseEnd].every(Number.isFinite) &&
        p.wallPhaseEnd <= p.wallWholeEnd - 150 &&
        p.monotonicPhaseEnd <= p.monotonicWholeEnd - 150 &&
        positive(p.parentPid) &&
        p.parentPid <= 0xffffffff &&
        typeof p.parentCreationFiletime === "string" &&
        /^[1-9][0-9]{0,19}$/.test(p.parentCreationFiletime) &&
        equalRaw(p.prior, previous),
      "RAW_PHASE",
    );
    if (role === "cef-engine")
      need(
        p.wallPhaseEnd <= p.wallWholeEnd - 3600 &&
          p.monotonicPhaseEnd <= p.monotonicWholeEnd - 3600,
        "RAW_RESERVE",
      );
    const parentKey = p.parentPid + ":" + p.parentCreationFiletime;
    need(!parent || parent === parentKey, "RAW_PARENT");
    parent = parentKey;
    if (role === "probe-clang") probe = [p.wallPhaseEnd, p.monotonicPhaseEnd];
    if (role === "probe-link")
      need(
        equalRaw(probe, [p.wallPhaseEnd, p.monotonicPhaseEnd]),
        "RAW_PROBE_END",
      );
    need(
      Array.isArray(p.metadataFiles) &&
        equalRaw(
          p.metadataFiles.map((r) => r.relative),
          metadataPaths,
        ),
      "RAW_METADATA",
    );
    p.metadataFiles.forEach((row) => {
      shape(row, ["relative", "bytes", "sha256"]);
      pin({ bytes: row.bytes, sha256: row.sha256 }, 8 * MAX);
      add(row.relative, { bytes: row.bytes, sha256: row.sha256 });
    });
    need(!metadata || equalRaw(metadata, p.metadataFiles), "RAW_METADATA");
    metadata = p.metadataFiles;
    need(
      Array.isArray(p.gitPolicyFiles) && p.gitPolicyFiles.length === 2,
      "RAW_GIT_POLICY",
    );
    p.gitPolicyFiles.forEach((row, i) => {
      shape(row, ["relative", "bytes", "sha256"]);
      need(
        row.relative ===
          "full-sdk-control/cef-source-git-policy/" +
            (i ? "system" : "global") +
            ".gitconfig",
        "RAW_GIT_POLICY",
      );
      if (i)
        need(
          row.bytes === 0 && row.sha256 === hash(Buffer.alloc(0)),
          "RAW_GIT_POLICY",
        );
      else pin({ bytes: row.bytes, sha256: row.sha256 }, 65536);
    });
    need(
      !gitPolicies || equalRaw(gitPolicies, p.gitPolicyFiles),
      "RAW_GIT_POLICY",
    );
    gitPolicies = p.gitPolicyFiles;
    shape(l, [
      "kind",
      "role",
      "contextSha256",
      "ownPid",
      "ownCreationFiletime",
      "parentPid",
      "parentCreationFiletime",
    ]);
    shape(c, [
      "kind",
      "role",
      "success",
      "parentHandleClosed",
      "ownHandleClosed",
      "ownPid",
      "ownCreationFiletime",
      "parentPid",
      "parentCreationFiletime",
      "sourceContextSha256",
      "sdkBuilt",
      "nativeAcceptance",
      "jobSeconds",
      ...(role === "cef-engine" ? ["completion"] : []),
    ]);
    if (role === "cef-engine") need(c.completion === "success", "RAW_CLOSE");
    shape(r, [
      "kind",
      "role",
      "sourceContextSha256",
      "image",
      "sourceId",
      "success",
      "output",
      "engineComplete",
      "sdkBuilt",
      "nativeAcceptance",
      "runtimeReady",
    ]);
    const identityKey = rawJob(raw, 64 * MAX);
    need(!identities.has(identityKey), "RAW_JOB_REUSE");
    identities.add(identityKey);
    const caps = {
      "probe-clang": 900,
      "probe-link": 900,
      "cef-engine": 10800,
      package: 2400,
    };
    need(
      positive(c.jobSeconds) &&
        c.jobSeconds <= caps[role] &&
        raw.value.elapsedMs <= c.jobSeconds * 1000 + 30000,
      "RAW_ASSIGNED_SECONDS",
    );
    need(
      l.kind === "windows-arm-full-sdk-engine-launch" &&
        l.role === role &&
        l.contextSha256 === packet.pin.sha256 &&
        positive(l.ownPid) &&
        l.ownPid <= 0xffffffff &&
        l.ownPid !== raw.value.rootPid &&
        typeof l.ownCreationFiletime === "string" &&
        /^[1-9][0-9]{0,19}$/.test(l.ownCreationFiletime) &&
        c.kind === "windows-arm-full-sdk-engine-launcher-close" &&
        c.role === role &&
        c.success === true &&
        c.parentHandleClosed === true &&
        c.ownHandleClosed === true &&
        c.sdkBuilt === false &&
        c.nativeAcceptance === false &&
        c.ownPid === l.ownPid &&
        c.ownCreationFiletime === l.ownCreationFiletime &&
        c.parentPid === l.parentPid &&
        l.parentPid === p.parentPid &&
        c.parentCreationFiletime === l.parentCreationFiletime &&
        l.parentCreationFiletime === p.parentCreationFiletime &&
        c.sourceContextSha256 === sourcePin.sha256,
      "RAW_CLOSE",
    );
    need(
      r.kind === "windows-arm-full-sdk-engine-worker-result" &&
        r.role === role &&
        r.success === true &&
        r.sourceContextSha256 === sourcePin.sha256 &&
        r.image === source.image &&
        r.sourceId === source.sourceId &&
        r.engineComplete === (role === "cef-engine") &&
        r.sdkBuilt === (role === "package") &&
        r.nativeAcceptance === false &&
        r.runtimeReady === false,
      "RAW_RESULT",
    );
    if (role.startsWith("probe-")) pin(r.output, 8 * MAX);
    if (role === "cef-engine" || role === "package")
      elapsed += raw.value.elapsedMs;
    previous = { result: result.pin, receipt: raw.pin };
  }
  for (const n of sourceNames.slice(1, 5))
    need(equalRaw(native[n].pin, phases[n].pin), "RAW_NATIVE_CROSS");
  const sj = native["jobs/full-source-operation/receipt.json"],
    sl = native["full-source-launcher-result.json"].value,
    sc = native["full-source-closed-launcher.json"].value;
  need(
    !identities.has(rawJob(sj, 131072)) &&
      sj.value.elapsedMs <= 7230000 &&
      sl.success === true &&
      sl.sdkBuilt === false &&
      equalRaw(sl.originalOperationJob, sj.value) &&
      sc.success === true &&
      sc.parentHandleClosed === true &&
      sc.ownHandleClosed === true &&
      sc.ownPid === sl.ownPid &&
      sc.ownCreationFiletime === sl.ownCreationFiletime &&
      sc.parentCreationFiletime ===
        phases["full-sdk-engine-cef-engine-context.json"].value
          .parentCreationFiletime,
    "RAW_SOURCE_CHAIN",
  );
  const chain = {
    outcome: "engine-complete",
    sourceContext: sourcePin,
    engineContext: phases["full-sdk-engine-cef-engine-context.json"].pin,
    launch: phases["full-sdk-engine-cef-engine-launch.json"].pin,
    job: phases["jobs/cef-engine/receipt.json"].pin,
    close: phases["full-sdk-engine-closed-cef-engine.json"].pin,
    sourceJob: sj.pin,
    sourceLauncher: native["full-source-launcher-result.json"].pin,
    sourceClose: native["full-source-closed-launcher.json"].pin,
  };
  need(equalRaw(seal.sourceChain, chain), "RAW_SOURCE_CHAIN");
  for (const n of [
    "jobs/full-source-operation/receipt.json",
    "full-source-launcher-result.json",
    "full-source-closed-launcher.json",
  ])
    add(n, native[n].pin);
  const original = [
    "full-source-launcher-result.json",
    "full-source-closed-launcher.json",
    "jobs/full-source-operation/receipt.json",
    "full-source-closed-full-source-operation.json",
    "full-source-operation-result.json",
    "full-source-closed-verify-setup.json",
    "full-source-gn-result.json",
  ];
  const dataRoles = [
    "sdk-data",
    "llvm-data",
    "rust-archive",
    "gn-archive",
    "siso-archive",
    "materialize",
    "runtime-closure",
    "full-sdk-source-gn",
  ];
  original.push(
    ...dataRoles.map((r) => "jobs/" + r + "/receipt.json"),
    ...dataRoles.slice(0, -1).map((r) => "full-source-closed-" + r + ".json"),
  );
  const checked = seal.checkedInputs;
  shape(checked, ["schemaVersion", "kind", "before", "after"]);
  need(
    checked.schemaVersion === 1 &&
      checked.kind === "windows-arm-checked-input-closure-pair",
    "RAW_CHECKED",
  );
  const names = [...new Set([...expected.keys(), ...original])].sort();
  need(names.length === 162, "RAW_CHECKED_COUNT");
  for (const [side, boundary] of [
    ["before", "before-probe-clang"],
    ["after", "after-package-before-sdk-seal"],
  ]) {
    const row = checked[side];
    shape(row, ["boundary", "sha256", "content"]);
    const v = row.content;
    shape(v, [
      "schemaVersion",
      "kind",
      "sourceContextSha256",
      "image",
      "sourceId",
      "producerSha256",
      "metadataProjectionSha256",
      "records",
    ]);
    need(
      row.boundary === boundary &&
        v.schemaVersion === 1 &&
        v.kind === "windows-arm-checked-input-closure" &&
        v.sourceContextSha256 === sourcePin.sha256 &&
        v.image === source.image &&
        v.sourceId === source.sourceId &&
        v.producerSha256 === identity.producerSha256 &&
        hex(v.metadataProjectionSha256) &&
        row.sha256 === hash(Buffer.from(canonical(v))) &&
        Array.isArray(v.records) &&
        equalRaw(
          v.records.map((r) => r.relative),
          names,
        ),
      "RAW_CHECKED",
    );
    for (const r of v.records) {
      shape(r, ["relative", "bytes", "sha256"]);
      need(
        Number.isSafeInteger(r.bytes) &&
          r.bytes >= 0 &&
          r.bytes <= 16 * MAX &&
          hex(r.sha256),
        "RAW_CHECKED_PIN",
      );
      need(
        !expected.has(r.relative) ||
          equalRaw(expected.get(r.relative), {
            bytes: r.bytes,
            sha256: r.sha256,
          }),
        "RAW_CHECKED_PIN",
      );
    }
  }
  need(
    equalRaw(checked.before.content, checked.after.content) &&
      checked.before.sha256 === checked.after.sha256,
    "RAW_CHECKED_CHANGE",
  );
  rawTiming(seal.producerTiming, source);
  need(elapsed <= seal.producerTiming.producerElapsedMs, "RAW_ELAPSED");
  shape(seal.release, ["id", "tag", "head", "carrierHead"]);
  need(
    positive(seal.release.id) &&
      seal.release.head === wf.head &&
      hex(seal.release.carrierHead, 40),
    "RAW_RELEASE",
  );
  const controller = rawEvidence(seal.controller),
    report = controller.value;
  shape(report, [
    "kind",
    "sourceId",
    "image",
    "target",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
    "publicationAllowed",
    "bundle",
    "assets",
    "checkedInputs",
  ]);
  need(
    report.kind === "windows-arm-full-sdk-produced" &&
      report.sourceId === source.sourceId &&
      report.image === source.image &&
      report.target === seal.target &&
      report.sdkBuilt === true &&
      report.nativeAcceptance === false &&
      report.runtimeReady === false &&
      report.publicationAllowed === false &&
      report.bundle === "full-sdk-package/bundle" &&
      equalRaw(report.checkedInputs, checked),
    "RAW_CONTROLLER",
  );
  const tag =
    "windows-arm-full-sdk-quarantine-" +
    wf.runId +
    "-" +
    wf.attempt +
    "-" +
    source.sourceId.slice(0, 12) +
    "-" +
    controller.pin.sha256.slice(0, 16);
  need(seal.release.tag === tag, "RAW_RELEASE");
  sealRecordAssets(seal.assets, identity.sourceId);
  const stripped = seal.assets.map(({ id: _id, ...r }) => r);
  const packageOutput =
    phases["full-sdk-engine-package-result.json"].value.output;
  shape(packageOutput, ["bundle", "assets"]);
  need(
    packageOutput.bundle === report.bundle &&
      equalRaw(
        packageOutput.assets.map(({ name, size, sha256 }) => ({
          name,
          bytes: size,
          sha256,
        })),
        stripped,
      ) &&
      Array.isArray(report.assets) &&
      report.assets.length === 5 &&
      equalRaw(
        report.assets.map(({ name, size, sha256 }) => ({
          name,
          bytes: size,
          sha256,
        })),
        stripped,
      ) &&
      report.assets.every((r) => {
        shape(r, ["name", "size", "sha256", "identity"]);
        return typeof r.identity === "string";
      }),
    "RAW_ASSETS",
  );
  const prefix =
    "native/cef-build-inputs/" +
    (source.image === "20261030.294.1"
      ? "20261101-r5-windows-arm64-cross-x64-current-source-gn"
      : "20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn") +
    "/source-lock.json";
  const selected = rows[index(prefix)];
  return {
    source,
    phases,
    sourcePin,
    sourceLockRaw: { bytes: selected.bytes, sha256: selected.sha256 },
    bundleSourceLockRaw: (({ bytes, sha256 }) => ({ bytes, sha256 }))(
      stripped.find((r) => r.name === "source-lock.json"),
    ),
    assets: stripped,
    producer: {
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      runId: Number(wf.runId),
      attempt: Number(wf.attempt),
      head: wf.head,
      branch: "main",
      workflow: wf.path,
    },
  };
}
function sealRecordAssets(rows, sourceId) {
  need(Array.isArray(rows) && rows.length === 5, "RAW_ASSETS");
  const ids = new Set();
  for (const r of rows) {
    shape(r, ["id", "name", "bytes", "sha256"]);
    need(positive(r.id) && !ids.has(r.id), "RAW_ASSETS");
    ids.add(r.id);
  }
  assets(rows.map(({ id: _id, ...r }) => r));
  need(
    rows.some(
      (r) =>
        r.name ===
        "sorng-cef-custom-" +
          sourceId +
          "-" +
          WINDOWS_ARM_SDK_TARGET +
          ".tar.bz2",
    ),
    "RAW_ASSETS",
  );
}
function rawViews(sealRaw, details, metadata) {
  shape(metadata, ["manifest", "receipt"]);
  const value = {};
  for (const name of ["manifest", "receipt"]) {
    const entry = rawEvidence(metadata[name]),
      asset = details.assets.find((r) => r.name === name + ".json");
    bytes(entry.raw, { bytes: asset.bytes, sha256: asset.sha256 });
    value[name] = entry.value;
  }
  const manifest = value.manifest,
    receipt = value.receipt,
    id = details.source.sourceId;
  need(
    manifest.kind === "sorng-cef-custom-runtime" &&
      manifest.schemaVersion === 1 &&
      manifest.sourceLockSha256 === id &&
      Array.isArray(manifest.artifacts) &&
      manifest.artifacts.length === 1 &&
      receipt.kind === "sorng-cef-custom-build-receipt" &&
      receipt.schemaVersion === 1 &&
      receipt.target === WINDOWS_ARM_SDK_TARGET &&
      receipt.sourceLockSha256 === id,
    "RAW_BUNDLE",
  );
  const artifact = manifest.artifacts[0],
    archive = details.assets.find((r) => r.name.endsWith(".tar.bz2"));
  need(
    artifact.target === WINDOWS_ARM_SDK_TARGET &&
      artifact.archive?.sha256 === archive.sha256 &&
      artifact.archive?.size === archive.bytes &&
      receipt.archiveSha256 === archive.sha256 &&
      Array.isArray(artifact.sdkFiles) &&
      positive(artifact.sdkFiles.length) &&
      artifact.sdkFiles.length <= 300000 &&
      receipt.sdkInventorySha256 ===
        hash(Buffer.from(canonical(artifact.sdkFiles))),
    "RAW_BUNDLE",
  );
  const library = artifact.sdkFiles.filter(
    (r) => r.path === artifact.runtime?.library,
  );
  need(
    library.length === 1 &&
      library[0].type === "file" &&
      hex(library[0].sha256) &&
      typeof artifact.runtime.library === "string" &&
      path.posix.basename(artifact.runtime.library) === "libcef.dll",
    "RAW_ENGINE",
  );
  const sealSha256 = hash(sealRaw);
  const source = {
    kind: "windows-arm-quarantine-source-view",
    sealSha256,
    sourceLockRaw: details.sourceLockRaw,
    bundleSourceLockRaw: details.bundleSourceLockRaw,
    checkedInputsSha256: JSON.parse(sealRaw).checkedInputs.before.sha256,
  };
  const compile = {
    kind: "windows-arm-quarantine-compile-view",
    sealSha256,
    sourceRecordSha256: hash(Buffer.from(canonical(source) + "\n")),
    nativePhase: "cef-engine",
    result: details.phases["full-sdk-engine-cef-engine-result.json"].pin,
  };
  const packaged = {
    kind: "windows-arm-quarantine-package-view",
    sealSha256,
    compileRecordSha256: hash(Buffer.from(canonical(compile) + "\n")),
    engine: { sha256: library[0].sha256 },
    inventory: { files: artifact.sdkFiles.length },
    assets: details.assets,
    metadata,
  };
  return { source, compile, package: packaged };
}
// Generates review DATA only; it cannot register a producer binding or import.
export async function projectWindowsArmSdkQuarantineRecords(
  receipt,
  rawSeal,
  bundleMetadata,
) {
  need(
    Buffer.isBuffer(rawSeal) && rawSeal.length > 0 && rawSeal.length <= MAX,
    "RAW_BOUND",
  );
  rawSeal = Buffer.from(rawSeal);
  shape(bundleMetadata, ["manifest", "receipt"]);
  const metadata = Object.fromEntries(
    ["manifest", "receipt"].map((name) => {
      shape(bundleMetadata[name], ["bytes", "sha256", "base64"]);
      const { bytes, sha256, base64 } = bundleMetadata[name];
      const row = { bytes, sha256, base64 };
      rawEvidence(row);
      return [name, row];
    }),
  );
  const state = await current(receipt);
  const seal = json(rawSeal),
    details = rawDetails(seal, state),
    views = rawViews(rawSeal, details, metadata);
  retained(receipt, await current(receipt), state);
  const encoded = Object.entries(views).map(([k, v]) => [
    k,
    canonical(v) + "\n",
  ]);
  need(
    encoded.every(
      ([, v]) => Buffer.byteLength(v) > 0 && Buffer.byteLength(v) <= MAX,
    ),
    "RAW_BOUND",
  );
  return Object.fromEntries([
    ...encoded.map(([k, v]) => [k, Buffer.from(v)]),
    ["producerSeal", rawSeal],
  ]);
}
async function inspectRawRecords(receipt, records, state) {
  const seal = json(records.producerSeal),
    details = rawDetails(seal, state),
    packaged = json(records.package),
    views = rawViews(records.producerSeal, details, packaged.metadata);
  for (const role of ["source", "compile", "package"])
    need(equalRaw(json(records[role]), views[role]), "RAW_VIEW");
  retained(receipt, await current(receipt), state);
  return frozen({
    kind: "windows-arm-full-sdk-record-candidate",
    origin: WINDOWS_ARM_SDK_ORIGIN,
    originPolicySha256: state.policySha256,
    target: seal.target,
    sourceLockIdentity: seal.identity.sourceId,
    image: seal.identity.image,
    producer: details.producer,
    sealSha256: hash(records.producerSeal),
    recordPins: Object.fromEntries(
      Object.entries(records).map(([k, v]) => [k, rawPin(v)]),
    ),
    bundleVerified: false,
    producerVerified: false,
    nativeAcceptance: false,
    runtimeReady: false,
    publicationAllowed: false,
  });
}
async function verifyRawProducer(
  receipt,
  records,
  artifact,
  api,
  inspected,
  state,
) {
  const seal = json(records.producerSeal),
    p = inspected.producer;
  bytes(artifact.raw, {
    bytes: artifact.pin.bytes,
    sha256: artifact.pin.sha256,
  });
  need(
    independentSeal(artifact.raw, RAW_MEMBER).equals(records.producerSeal),
    "INDEPENDENT_SEAL",
  );
  need(typeof api === "function", "API");
  const routes = [
    "",
    "actions/workflows/windows-arm-full-sdk.yml",
    "actions/runs/" + p.runId,
    "actions/artifacts/" + artifact.pin.id,
    "git/commits/" + p.head,
    "git/commits/" + seal.release.carrierHead,
    "releases/" + seal.release.id,
    "releases/" + seal.release.id + "/assets?per_page=100",
  ];
  const [
    repo,
    workflow,
    run,
    remoteArtifact,
    commit,
    carrier,
    release,
    releaseAssets,
  ] = await Promise.all(
    routes.map(async (route) => structuredClone(await api(route))),
  );
  need(
    repo.id === REPOSITORY_ID &&
      repo.full_name === REPOSITORY &&
      repo.private === false &&
      repo.visibility === "public" &&
      repo.default_branch === "main",
    "REPOSITORY",
  );
  need(
    positive(workflow.id) &&
      workflow.path === WINDOWS_ARM_SDK_WORKFLOW &&
      run.id === p.runId &&
      run.run_attempt === p.attempt &&
      run.head_sha === p.head &&
      run.head_branch === "main" &&
      run.path === WINDOWS_ARM_SDK_WORKFLOW &&
      run.workflow_id === workflow.id &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      [run.repository, run.head_repository].every(
        (r) => r?.id === REPOSITORY_ID && r?.full_name === REPOSITORY,
      ),
    "RUN",
  );
  need(
    remoteArtifact.id === artifact.pin.id &&
      remoteArtifact.expired === false &&
      remoteArtifact.size_in_bytes === artifact.pin.bytes &&
      remoteArtifact.digest === "sha256:" + artifact.pin.sha256 &&
      remoteArtifact.name ===
        "windows-arm-full-sdk-seal-" + p.runId + "-" + p.attempt &&
      remoteArtifact.workflow_run?.id === p.runId &&
      remoteArtifact.workflow_run?.head_sha === p.head,
    "ARTIFACT",
  );
  need(
    commit.sha === p.head &&
      hex(commit.tree?.sha, 40) &&
      carrier.sha === seal.release.carrierHead,
    "GIT_TREE",
  );
  const tree = structuredClone(
    await api("git/trees/" + commit.tree.sha + "?recursive=1"),
  );
  need(
    tree.truncated === false &&
      Array.isArray(tree.tree) &&
      tree.tree.length <= 100000,
    "GIT_TREE",
  );
  for (const row of state.held) {
    const found = tree.tree.filter((r) => r.path === row.relative);
    need(
      found.length === 1 &&
        found[0].type === "blob" &&
        found[0].mode === row.mode &&
        found[0].sha === row.blob,
      "PRODUCER_CODE",
    );
  }
  need(
    release.id === seal.release.id &&
      release.draft === true &&
      release.prerelease === true &&
      release.tag_name === seal.release.tag &&
      release.name === seal.release.tag &&
      release.target_commitish === seal.release.carrierHead &&
      Array.isArray(releaseAssets) &&
      releaseAssets.length === 5,
    "RELEASE",
  );
  for (const row of seal.assets) {
    const found = releaseAssets.filter((r) => r.id === row.id);
    need(
      found.length === 1 &&
        found[0].name === row.name &&
        found[0].size === row.bytes &&
        found[0].digest === "sha256:" + row.sha256 &&
        found[0].state === "uploaded",
      "RELEASE_ASSET",
    );
  }
  retained(receipt, await current(receipt), state);
  const result = Object.freeze({
    ...inspected,
    kind: "windows-arm-full-sdk-producer-binding",
    producerVerified: true,
  });
  bindings.set(result, { receipt, state, sealSha256: inspected.sealSha256 });
  return result;
}
// END schema2 raw quarantine origin
function sourceRecord(value, state) {
  base(
    value,
    "sorng-windows-arm64-full-sdk-source",
    [
      "sourceProfileSha256",
      "sourceLockRaw",
      "bridge",
      "argsSha256",
      "graphSha256",
      "toolsSha256",
      "beforeSha256",
      "afterSha256",
    ],
    state,
  );
  need(
    value.sourceProfileSha256 === SOURCES[value.image].sourceProfileSha256 &&
      canonical(value.bridge) === canonical(BRIDGE) &&
      value.beforeSha256 === value.afterSha256,
    "SOURCE",
  );
  pin(value.sourceLockRaw);
  for (const key of [
    "argsSha256",
    "graphSha256",
    "toolsSha256",
    "beforeSha256",
    "afterSha256",
  ])
    digest(value[key]);
}
const JOB_FIELDS = [
  "exitCode",
  "outcome",
  "quiescent",
  "rootReaped",
  "logReadersStopped",
  "activeAtEnd",
  "processLimit",
  "memoryBytes",
  "cpuRate",
  "workMs",
  "cleanupMs",
  "elapsedMs",
];
function job(value, receipt, state) {
  shape(value, JOB_FIELDS);
  need(
    value.exitCode === 0 &&
      value.outcome === "success" &&
      value.quiescent === true &&
      value.rootReaped === true &&
      value.logReadersStopped === true &&
      value.activeAtEnd === 0 &&
      value.processLimit === 64 &&
      value.memoryBytes === 8 * 1024 ** 3 &&
      value.cpuRate === 2500 &&
      positive(value.workMs) &&
      value.workMs <= state.policy.jobPolicy.maxWorkMs &&
      positive(value.cleanupMs) &&
      value.cleanupMs === state.policy.jobPolicy.cleanupMs &&
      positive(value.elapsedMs) &&
      value.elapsedMs <= value.workMs + value.cleanupMs,
    "JOB",
  );
  shape(receipt, ["bytes", "sha256", "base64"]);
  pin({ bytes: receipt.bytes, sha256: receipt.sha256 }, 65536);
  need(
    typeof receipt.base64 === "string" && receipt.base64.length <= 90000,
    "JOB_RECEIPT",
  );
  const raw = Buffer.from(receipt.base64, "base64");
  need(raw.toString("base64") === receipt.base64, "JOB_RECEIPT");
  bytes(raw, { bytes: receipt.bytes, sha256: receipt.sha256 }, 65536);
  const observed = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(raw),
  );
  const pretty = JSON.stringify(observed, null, 2) + "\n";
  need(
    raw.toString() === pretty ||
      raw.toString() === pretty.replaceAll("\n", "\r\n"),
    "JOB_RECEIPT_JSON",
  );
  shape(observed, [
    "kind",
    "started",
    "assignedBeforeResume",
    "resumed",
    "jobCreated",
    "handleListOnly",
    "outcome",
    "rootExit",
    "cleanupVerified",
    "activeAtEnd",
    "assignmentMode",
    "policyReadback",
    "jobHandleInheritable",
    "jobHandleInStdioAllowlist",
    "rootPid",
    "rootCreationFiletime",
    "assignedAtCreationVerified",
    "rootReaped",
    "finalRootExit",
    "observedChildrenReaped",
    "cleanupBudgetMs",
    "logReadersStopped",
    "capturedBytes",
    "outputCapBytes",
    "elapsedMs",
    "success",
    ...(Object.hasOwn(observed, "observerStopped") ? ["observerStopped"] : []),
  ]);
  need(
    observed.kind === "owned-job-proof" &&
      observed.assignmentMode === "creation-attribute" &&
      [
        "started",
        "assignedBeforeResume",
        "resumed",
        "jobCreated",
        "handleListOnly",
        "cleanupVerified",
        "assignedAtCreationVerified",
        "rootReaped",
        "logReadersStopped",
        "success",
      ].every((key) => observed[key] === true) &&
      (!Object.hasOwn(observed, "observerStopped") ||
        observed.observerStopped === true) &&
      observed.outcome === "success" &&
      observed.rootExit === 0 &&
      observed.finalRootExit === 0 &&
      observed.activeAtEnd === 0 &&
      observed.jobHandleInheritable === false &&
      observed.jobHandleInStdioAllowlist === false &&
      positive(observed.rootPid) &&
      observed.rootPid <= 0xffffffff &&
      typeof observed.rootCreationFiletime === "string" &&
      /^[1-9][0-9]{0,19}$/.test(observed.rootCreationFiletime) &&
      Number.isSafeInteger(observed.observedChildrenReaped) &&
      observed.observedChildrenReaped >= 0 &&
      observed.observedChildrenReaped <= 64 &&
      observed.cleanupBudgetMs === value.cleanupMs &&
      observed.elapsedMs === value.elapsedMs &&
      positive(observed.outputCapBytes) &&
      observed.outputCapBytes <= 64 * MAX &&
      Number.isSafeInteger(observed.capturedBytes) &&
      observed.capturedBytes >= 0 &&
      observed.capturedBytes <= observed.outputCapBytes,
    "JOB_RECEIPT",
  );
  shape(observed.policyReadback, [
    "flags",
    "activeProcessLimit",
    "jobMemoryBytes",
    "cpuFlags",
    "cpuRate",
    "inheritedHandles",
    "affinityChanged",
  ]);
  need(
    canonical(observed.policyReadback) ===
      canonical({
        flags: 8712,
        activeProcessLimit: value.processLimit,
        jobMemoryBytes: String(value.memoryBytes),
        cpuFlags: 5,
        cpuRate: value.cpuRate,
        inheritedHandles: 3,
        affinityChanged: false,
      }),
    "JOB_READBACK",
  );
  return observed.rootPid + ":" + observed.rootCreationFiletime;
}
function compileRecord(value, state) {
  base(
    value,
    "sorng-windows-arm64-full-sdk-compile",
    [
      "outcome",
      "sourceRecordSha256",
      "argsSha256",
      "graphSha256",
      "toolsSha256",
      "job",
      "jobReceipt",
    ],
    state,
  );
  need(value.outcome === "compiler-complete", "COMPILE");
  for (const key of [
    "sourceRecordSha256",
    "argsSha256",
    "graphSha256",
    "toolsSha256",
  ])
    digest(value[key]);
  return job(value.job, value.jobReceipt, state);
}
function assets(value) {
  need(Array.isArray(value) && value.length === 5, "ASSETS");
  const names = [
    "runtime.json",
    "source-lock.json",
    "manifest.json",
    "receipt.json",
  ];
  const seen = new Set();
  for (const row of value) {
    shape(row, ["name", "bytes", "sha256"]);
    need(typeof row.name === "string" && !seen.has(row.name), "ASSETS");
    need(
      names.includes(row.name) ||
        /^sorng-cef-custom-[a-f0-9]{64}-aarch64-pc-windows-msvc\.tar\.bz2$/.test(
          row.name,
        ),
      "ASSET_NAME",
    );
    pin(
      { bytes: row.bytes, sha256: row.sha256 },
      row.name.endsWith(".tar.bz2") ? 32 * 1024 ** 3 : 16 * MAX,
    );
    seen.add(row.name);
  }
  need(
    names.every((name) => seen.has(name)),
    "ASSETS",
  );
}
function packageRecord(value, state) {
  base(
    value,
    "sorng-windows-arm64-full-sdk-package",
    [
      "outcome",
      "compileRecordSha256",
      "job",
      "jobReceipt",
      "engine",
      "inventory",
      "assets",
    ],
    state,
  );
  need(value.outcome === "sdk-packaged", "PACKAGE");
  digest(value.compileRecordSha256);
  const identity = job(value.job, value.jobReceipt, state);
  shape(value.engine, ["machine", "sha256", "exportsSha256"]);
  need(value.engine.machine === 0xaa64, "MACHINE");
  digest(value.engine.sha256);
  digest(value.engine.exportsSha256);
  shape(value.inventory, ["files", "bytes", "sha256"]);
  need(
    positive(value.inventory.files) &&
      value.inventory.files <= 300000 &&
      positive(value.inventory.bytes) &&
      value.inventory.bytes <= 256 * 1024 ** 3,
    "INVENTORY",
  );
  digest(value.inventory.sha256);
  assets(value.assets);
  return identity;
}
function sealRecord(value, state) {
  base(
    value,
    "sorng-windows-arm64-full-sdk-seal",
    [
      "outcome",
      "records",
      "release",
      "assets",
      "nativeAcceptance",
      "runtimeReady",
      "producerElapsedMs",
    ],
    state,
  );
  need(
    value.outcome === "full-sdk-complete" &&
      value.nativeAcceptance === false &&
      value.runtimeReady === false,
    "FULL_SDK",
  );
  shape(value.records, ["source", "compile", "package"]);
  need(
    positive(value.producerElapsedMs) &&
      value.producerElapsedMs <=
        state.policy.jobPolicy.wholeMs - state.policy.jobPolicy.finalReserveMs,
    "PRODUCER_LEASE",
  );
  for (const row of Object.values(value.records)) pin(row);
  shape(value.release, ["id", "tag", "carrierHead"]);
  need(
    positive(value.release.id) &&
      hex(value.release.carrierHead, 40) &&
      value.release.tag ===
        "windows-arm-full-sdk-" +
          value.producer.runId +
          "-" +
          value.producer.attempt,
    "RELEASE",
  );
  need(Array.isArray(value.assets) && value.assets.length === 5, "ASSETS");
  const ids = new Set();
  for (const row of value.assets) {
    shape(row, ["id", "name", "bytes", "sha256"]);
    need(positive(row.id) && !ids.has(row.id), "ASSET_ID");
    ids.add(row.id);
  }
  assets(value.assets.map(({ id: _id, ...row }) => row));
}
export async function inspectWindowsArmSdkRecords(receipt, records) {
  records = snapshotRecords(records);
  const state = await current(receipt);
  if (json(records.producerSeal).kind === RAW_KIND) {
    const result = await inspectRawRecords(receipt, records, state);
    retained(receipt, await current(receipt), state);
    return result;
  }
  shape(records, ["source", "compile", "package", "producerSeal"]);
  const values = Object.fromEntries(
    Object.entries(records).map(([key, raw]) => [key, json(raw)]),
  );
  sourceRecord(values.source, state);
  const compileJobIdentity = compileRecord(values.compile, state);
  const packageJobIdentity = packageRecord(values.package, state);
  sealRecord(values.producerSeal, state);
  const seal = values.producerSeal;
  need(
    compileJobIdentity !== packageJobIdentity &&
      values.compile.job.elapsedMs + values.package.job.elapsedMs <=
        seal.producerElapsedMs,
    "JOB_TRANSACTION",
  );
  for (const [role, raw] of Object.entries(records)) {
    const value = values[role];
    need(
      canonical(value.producer) === canonical(seal.producer) &&
        value.image === seal.image &&
        value.sourceLockIdentity === seal.sourceLockIdentity,
      "CROSS_RECORD",
    );
    if (role !== "producerSeal") bytes(raw, seal.records[role]);
  }
  need(
    values.compile.sourceRecordSha256 === hash(records.source) &&
      values.package.compileRecordSha256 === hash(records.compile) &&
      ["argsSha256", "graphSha256", "toolsSha256"].every(
        (key) => values.compile[key] === values.source[key],
      ) &&
      canonical(values.package.assets) ===
        canonical(seal.assets.map(({ id: _id, ...row }) => row)) &&
      seal.assets.find((row) => row.name === "source-lock.json").sha256 ===
        values.source.sourceLockRaw.sha256 &&
      seal.assets.find((row) => row.name === "source-lock.json").bytes ===
        values.source.sourceLockRaw.bytes &&
      seal.assets.some(
        (row) =>
          row.name ===
          "sorng-cef-custom-" +
            seal.sourceLockIdentity +
            "-" +
            WINDOWS_ARM_SDK_TARGET +
            ".tar.bz2",
      ),
    "CROSS_BINDING",
  );
  retained(receipt, await current(receipt), state);
  return frozen({
    kind: "windows-arm-full-sdk-record-candidate",
    origin: WINDOWS_ARM_SDK_ORIGIN,
    originPolicySha256: state.policySha256,
    target: WINDOWS_ARM_SDK_TARGET,
    sourceLockIdentity: seal.sourceLockIdentity,
    image: seal.image,
    producer: structuredClone(seal.producer),
    sealSha256: hash(records.producerSeal),
    recordPins: Object.fromEntries(
      Object.entries(records).map(([key, raw]) => [
        key,
        { bytes: raw.length, sha256: hash(raw) },
      ]),
    ),
    bundleVerified: false,
    producerVerified: false,
    nativeAcceptance: false,
    runtimeReady: false,
    publicationAllowed: false,
  });
}

// API is the caller's existing scoped read-only GitHub transport. Its values
// still require the complete fixed workflow/run/artifact/Git/asset checks below.
export async function verifyWindowsArmSdkProducer(
  receipt,
  records,
  artifact,
  api,
) {
  // Copy every caller-owned byte/pin before the FIRST await. The same private
  // transaction feeds inspection, independent seal checks, API binds and result.
  records = snapshotRecords(records);
  artifact = snapshotArtifact(artifact);
  const inspected = await inspectWindowsArmSdkRecords(receipt, records);
  const state = await current(receipt),
    seal = json(records.producerSeal),
    p = seal.producer;
  if (seal.kind === RAW_KIND) {
    const result = await verifyRawProducer(
      receipt,
      records,
      artifact,
      api,
      inspected,
      state,
    );
    retained(receipt, await current(receipt), state);
    return result;
  }
  shape(artifact, ["pin", "raw"]);
  const artifactPin = artifact.pin;
  shape(artifactPin, ["id", "bytes", "sha256"]);
  need(positive(artifactPin.id), "ARTIFACT");
  bytes(artifact.raw, { bytes: artifactPin.bytes, sha256: artifactPin.sha256 });
  need(
    independentSeal(artifact.raw).equals(records.producerSeal),
    "INDEPENDENT_SEAL",
  );
  need(typeof api === "function", "API");
  const metadata = await Promise.all([
    api(""),
    api("actions/workflows/windows-arm-full-sdk.yml"),
    api("actions/runs/" + p.runId),
    api("actions/artifacts/" + artifactPin.id),
    api("git/commits/" + p.head),
    api("releases/" + seal.release.id),
    api("releases/" + seal.release.id + "/assets?per_page=100"),
  ]);
  const [repo, workflow, run, remoteArtifact, commit, release, releaseAssets] =
    metadata.map((value) => structuredClone(value));
  need(
    repo.id === REPOSITORY_ID &&
      repo.full_name === REPOSITORY &&
      repo.private === false &&
      repo.default_branch === "main",
    "REPOSITORY",
  );
  need(
    workflow.id === p.workflowId &&
      workflow.path === WINDOWS_ARM_SDK_WORKFLOW &&
      run.id === p.runId &&
      run.run_attempt === p.attempt &&
      run.head_sha === p.head &&
      run.head_branch === "main" &&
      run.path === WINDOWS_ARM_SDK_WORKFLOW &&
      run.workflow_id === p.workflowId &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.repository?.id === REPOSITORY_ID &&
      run.head_repository?.id === REPOSITORY_ID &&
      run.repository?.full_name === REPOSITORY &&
      run.head_repository?.full_name === REPOSITORY,
    "RUN",
  );
  need(
    remoteArtifact.id === artifactPin.id &&
      remoteArtifact.expired === false &&
      remoteArtifact.size_in_bytes === artifactPin.bytes &&
      remoteArtifact.digest === "sha256:" + artifactPin.sha256 &&
      remoteArtifact.name ===
        "windows-arm-full-sdk-seal-" + p.runId + "-" + p.attempt &&
      remoteArtifact.workflow_run?.id === p.runId &&
      remoteArtifact.workflow_run?.head_sha === p.head,
    "ARTIFACT",
  );
  need(hex(commit.tree?.sha, 40), "GIT_TREE");
  const tree = structuredClone(
    await api("git/trees/" + commit.tree.sha + "?recursive=1"),
  );
  need(
    tree.truncated === false &&
      Array.isArray(tree.tree) &&
      tree.tree.length <= 100000,
    "GIT_TREE",
  );
  for (const row of state.held) {
    const found = tree.tree.filter((entry) => entry.path === row.relative);
    need(
      found.length === 1 &&
        found[0].type === "blob" &&
        found[0].mode === row.mode &&
        found[0].sha === row.blob,
      "PRODUCER_CODE",
    );
  }
  need(
    release.id === seal.release.id &&
      release.draft === true &&
      release.prerelease === true &&
      release.tag_name === seal.release.tag &&
      release.target_commitish === seal.release.carrierHead &&
      Array.isArray(releaseAssets) &&
      releaseAssets.length === 5,
    "RELEASE",
  );
  for (const row of seal.assets) {
    const found = releaseAssets.filter((entry) => entry.id === row.id);
    need(
      found.length === 1 &&
        found[0].name === row.name &&
        found[0].size === row.bytes &&
        found[0].digest === "sha256:" + row.sha256,
      "RELEASE_ASSET",
    );
  }
  retained(receipt, await current(receipt), state);
  const result = Object.freeze({
    ...inspected,
    kind: "windows-arm-full-sdk-producer-binding",
    producerVerified: true,
  });
  bindings.set(result, { receipt, state, sealSha256: inspected.sealSha256 });
  return result;
}
export async function assertWindowsArmSdkProducerBinding(
  binding,
  receipt,
  sealSha256,
) {
  const actual = bindings.get(binding);
  need(
    actual?.receipt === receipt && actual.sealSha256 === sealSha256,
    "OPAQUE_BINDING",
  );
  retained(receipt, await current(receipt), actual.state);
  return binding;
}
