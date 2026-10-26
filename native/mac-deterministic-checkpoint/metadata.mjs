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
    assert(
      stable(initial) === stable(after) &&
        stable(before) === stable(pathAfter) &&
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
