import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import ts from "typescript";

// Behavioural coverage of the generated-output ctime tolerance in the ACTUAL
// production recheckSourceMetadata body. Outer owner/lease/Job are modeled.
// ctime-only drift is injected into the pinned snapshot identity, not real ctime.
const source = await fs.readFile(
  new URL(
    "../../native/windows-arm-full-sdk/full_sdk_control.mjs",
    import.meta.url,
  ),
  "utf8",
);
const ast = ts.createSourceFile("c.mjs", source, 99, true, ts.ScriptKind.JS);
const functions = [
  "need",
  "fail",
  "fileId",
  "directoryId",
  "heldOperationFile",
  "captureSourceMetadataFailure",
  "recheckSourceMetadata",
];
const variables = [
  "hashBytes",
  "sourceMetadataFailures",
  "startupErrorContexts",
  "sourceChildFailures",
  "STARTUP_CLOCK_ERRORS",
  "STARTUP_ERROR_CODES",
  "STARTUP_SYSCALLS",
];
const selected = ast.statements.filter((s) =>
  ts.isFunctionDeclaration(s)
    ? functions.includes(s.name?.text)
    : ts.isVariableStatement(s) &&
      s.declarationList.declarations.some((d) =>
        variables.includes(d.name.getText(ast)),
      ),
);
assert.equal(selected.length, functions.length + variables.length);
const actual = selected.map((s) => s.getText(ast)).join("\n");

const OUT = "source-checkout/src/out/Release_GN_arm64/";
const rows = {
  args: OUT + "args.gn",
  header: OUT + "gen/cef/include/cef_config.h",
  policy: "source-inputs/0",
  log: "private-qualification-logs/qual-gn-args.stdout.log",
  report: "full-metadata-result.json",
  outside: "source-checkout/src/out/Other/args.gn",
  // Prefix lookalike: must not match the tolerated directory.
  lookalike: "source-checkout/src/out/Release_GN_arm64x/args.gn",
};
const FIELDS = [
  "dev",
  "ino",
  "mode",
  "uid",
  "gid",
  "size",
  "mtimeNs",
  "ctimeNs",
];
const binding = {
  saved: { identity: "s" },
  live: { identity: "l" },
  policySha256: "p",
};

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "ctime-tolerance-")),
  );
  const token = Object.freeze({});
  const state = {
    root,
    creationJoined: true,
    pendingWriters: 0,
    readFds: new Set(),
    failed: false,
    plan: {
      image: "image",
      sourceId: "source",
      rootPins: [{ relative: "context.json", sha256: "context" }],
    },
  };
  t.after(async () => {
    for (const fd of state.readFds) await fd.close();
    state.readFds.clear();
    await fs.rm(root, { recursive: true, force: true });
  });
  const operationState = (value) => {
    assert.equal(value, token);
    if (state.failed) throw state.primary;
    return state;
  };
  const api = new Function(
    "fs",
    "path",
    "constants",
    "createHash",
    "utilTypes",
    "WeakMap",
    "operationState",
    "operationFence",
    "operationWork",
    "expectedDefaultsCodeBinding",
    "checkedInputRow",
    actual + "\nreturn {heldOperationFile,recheckSourceMetadata};",
  )(
    fs,
    path,
    constants,
    createHash,
    utilTypes,
    WeakMap,
    operationState,
    async () => operationState(token),
    async (value, action) => {
      operationState(value);
      return action();
    },
    async () => binding,
    (list, relative, record) => list.push({ relative, pin: record.pin }),
  );
  const records = {};
  for (const [name, relative] of Object.entries(rows)) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "fixed non-secret content " + name);
    const read = await api.heldOperationFile(token, relative, 8192);
    records[name] = Object.freeze({
      relative,
      maximum: 8192,
      identity: read.identity,
      pin: Object.freeze(read.pin),
    });
  }
  const snapshot = (overrides = {}) => {
    state.metadataSnapshot = Object.freeze({
      matchedExpectedDefaults: {
        contextSha256: "context",
        image: "image",
        sourceId: "source",
        full61Qualified: false,
        binding,
      },
      records: Object.freeze(
        Object.entries(records).map(([name, row]) => overrides[name] ?? row),
      ),
    });
  };
  snapshot();
  const recheck = () => api.recheckSourceMetadata(token, false);
  // Pin a snapshot identity that differs from the live file in one field, which
  // is exactly what a drift of that stat field looks like to the recheck.
  const drift = (name, field) => {
    const parts = records[name].identity.split(":");
    assert.equal(parts.length, 8);
    const i = FIELDS.indexOf(field);
    parts[i] = String(BigInt(parts[i]) + 1n);
    snapshot({ [name]: { ...records[name], identity: parts.join(":") } });
  };
  return { root, state, records, snapshot, recheck, drift };
}

const REPLACED = "FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED";
const PIN_OR_REPLACED = /FULL_SDK_CONTROL_SOURCE_(RECORD_PIN|METADATA_REPLACED)$/;
const rejectsReplaced = (promise) =>
  assert.rejects(promise, (error) => error.message === REPLACED);

test("baseline: unchanged rows including build-output rows pass", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.recheck()).length, Object.keys(rows).length);
});

test("ctime-only drift passes for build-output rows (args.gn and generated header)", async (t) => {
  for (const name of ["args", "header"]) {
    const f = await fixture(t);
    f.drift(name, "ctimeNs");
    const checked = await f.recheck();
    assert.equal(checked.length, Object.keys(rows).length);
    assert.equal(f.state.failed, false);
    assert.equal(f.state.readFds.size, 0);
  }
});

test("dev, ino, mode, uid, gid, size or mtime drift on a build-output row still rejects", async (t) => {
  for (const name of ["args", "header"])
    for (const field of FIELDS.filter((x) => x !== "ctimeNs")) {
      const f = await fixture(t);
      f.drift(name, field);
      await rejectsReplaced(f.recheck());
    }
});

test("a real same-inode mtime change on a build-output row rejects", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, rows.args);
  const before = await fs.stat(file, { bigint: true });
  await fs.utimes(file, new Date(1000000000000), new Date(1000000000000));
  assert.equal((await fs.stat(file, { bigint: true })).ino, before.ino);
  await rejectsReplaced(f.recheck());
});

test("a real inode replacement with identical bytes on a build-output row rejects", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, rows.header);
  await fs.writeFile(file + ".new", await fs.readFile(file));
  await fs.rename(file + ".new", file);
  await rejectsReplaced(f.recheck());
});

test("content change on a build-output row still rejects, even with ctime drift injected", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.root, rows.args), "tamper");
  await assert.rejects(f.recheck(), (e) => PIN_OR_REPLACED.test(e.message));
  const g = await fixture(t);
  g.drift("args", "ctimeNs");
  await fs.writeFile(path.join(g.root, rows.args), "fixed non-secret content X");
  await assert.rejects(g.recheck(), (e) => PIN_OR_REPLACED.test(e.message));
  // Same size, different bytes: still not tolerated.
  const h = await fixture(t);
  h.drift("header", "ctimeNs");
  const file = path.join(h.root, rows.header);
  const bytes = Buffer.from(await fs.readFile(file));
  bytes[0] ^= 1;
  await fs.writeFile(file, bytes);
  await assert.rejects(h.recheck(), (e) => PIN_OR_REPLACED.test(e.message));
});

test("a snapshot pin that disagrees with the live bytes does not ride on a ctime drift", async (t) => {
  const f = await fixture(t);
  f.drift("args", "ctimeNs");
  const row = f.state.metadataSnapshot.records.find(
    (r) => r.relative === rows.args,
  );
  f.snapshot({
    args: { ...row, pin: { ...row.pin, sha256: "0".repeat(64) } },
  });
  await assert.rejects(f.recheck(), (e) => PIN_OR_REPLACED.test(e.message));
});

test("ctime-only drift still rejects for policy, log and report rows", async (t) => {
  for (const name of ["policy", "log", "report"]) {
    const f = await fixture(t);
    f.drift(name, "ctimeNs");
    await rejectsReplaced(f.recheck());
  }
});

test("ctime-only drift still rejects outside out/Release_GN_arm64 (including a prefix lookalike)", async (t) => {
  for (const name of ["outside", "lookalike"]) {
    const f = await fixture(t);
    f.drift(name, "ctimeNs");
    await rejectsReplaced(f.recheck());
  }
});

test("a malformed identity on a build-output row is not tolerated", async (t) => {
  const f = await fixture(t);
  const row = f.records.args;
  f.snapshot({
    args: { ...row, identity: row.identity.split(":").slice(0, 7).join(":") },
  });
  await rejectsReplaced(f.recheck());
});
