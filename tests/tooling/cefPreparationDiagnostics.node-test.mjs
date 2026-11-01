import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { observePreparationPhase } from "../../scripts/cef-runtime-ci.mjs";

function observer({
  openFails = false,
  writeFails = false,
  closeFails = false,
  emitFails = false,
} = {}) {
  const rows = [],
    emitted = [],
    opened = [];
  let closed = 0;
  return {
    rows,
    emitted,
    opened,
    closed: () => closed,
    dependencies: {
      async openFile(file, flags, mode) {
        opened.push({ file, flags, mode });
        if (openFails) throw new Error("PRIVATE_OPEN");
        return {
          async writeFile(line) {
            if (writeFails) throw new Error("PRIVATE_WRITE");
            rows.push(JSON.parse(line));
          },
          async close() {
            closed++;
            if (closeFails) throw new Error("PRIVATE_CLOSE");
          },
        };
      },
      emit(line) {
        if (emitFails) throw new Error("PRIVATE_EMIT");
        emitted.push(line);
      },
    },
  };
}

test("fixed phases surround actual production pre-acquisition operations", async () => {
  const source = await readFile(
    new URL("../../scripts/cef-runtime-ci.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /observePreparationPhase\(\s*logs,\s*"environment",\s*\(\) =>\s*buildEnvironment\(/,
  );
  assert.match(
    source,
    /observePreparationPhase\(\s*logs,\s*"metal",\s*\(\) =>\s*prepareMacMetalToolchain\(/,
  );
  assert.match(
    source,
    /observePreparationPhase\(\s*logs,\s*"external-inputs",\s*\(\) =>\s*engineering\.beforeAcquire\(/,
  );
  const checkpoint = await readFile(
    new URL("../../scripts/cef-engineering-checkpoint.mjs", import.meta.url),
    "utf8",
  );
  const external = checkpoint.slice(
    checkpoint.indexOf(
      'selected.argv("mac-external-observe", contextFile).slice(3)',
    ),
  );
  assert.match(
    external.slice(0, external.indexOf("const attestation")),
    /observeFailure: \(record\) =>\s*checkpointLog\(\s*console\.log,\s*`\[cef-engineering-checkpoint\] mac-external=\$\{canonical\(record\)\}`/,
  );
});

test("successful operations retain only two bounded records and unchanged return identity", async () => {
  const o = observer(),
    expected = { privateValue: "SECRET" };
  assert.equal(
    await observePreparationPhase(
      "/owned/logs",
      "metal",
      () => expected,
      o.dependencies,
    ),
    expected,
  );
  assert.deepEqual(o.opened, [
    {
      file: path.join("/owned/logs", "preparation-metal.jsonl"),
      flags: "wx",
      mode: 0o600,
    },
  ]);
  assert.deepEqual(o.rows, [
    { kind: "cef-pre-acquisition", phase: "metal", status: "start" },
    { kind: "cef-pre-acquisition", phase: "metal", status: "pass" },
  ]);
  assert.equal(o.closed(), 1);
  assert.ok(JSON.stringify(o.rows).length < 1024);
  assert.doesNotMatch(
    JSON.stringify(o.rows) + o.emitted.join(""),
    /SECRET|owned/,
  );
});

test("explicit Metal and source-scope causes survive while original exception identity is preserved", async () => {
  for (const message of [
    "MAC_METAL_COMMAND_FAILED",
    "MAC_METAL_PROBE_FAILED",
    "MAC_METAL_COMPONENT_DRIFT",
    "MAC_SOURCE_HOST_SCOPE",
    "MAC_SOURCE_ENV_SCOPE",
    "MAC_SOURCE_RUNNER_SCOPE",
    "MAC_EXTERNAL_PYTHON",
    "MAC_EXTERNAL_SDK_RELATION",
    "MAC_EXTERNAL_METAL",
    "MAC_EXTERNAL_REPORT_HASH",
  ]) {
    const o = observer(),
      original = new Error(message, { cause: new Error("SECRET_CAUSE") });
    original.stderr = "SECRET_STDERR";
    await assert.rejects(
      observePreparationPhase(
        "/owned/logs",
        "metal",
        () => {
          throw original;
        },
        o.dependencies,
      ),
      (error) => error === original,
    );
    assert.equal(o.rows[1].cause, message);
    assert.equal(o.rows[1].status, "failure");
    assert.equal(o.closed(), 1);
    assert.doesNotMatch(JSON.stringify(o.rows) + o.emitted.join(""), /SECRET/);
  }
});

test("unknown errors and generic uppercase-looking text never become public diagnostics", async () => {
  for (const message of [
    "/private/path?token=SECRET",
    "MAC_METAL_PRIVATE_TOKEN",
    "MAC_SOURCE_PRIVATE_TOKEN",
    "MAC_EXTERNAL_PRIVATE_TOKEN",
    "UPPERCASE_SECRET",
  ]) {
    const o = observer(),
      original = new Error(message);
    await assert.rejects(
      observePreparationPhase(
        "/owned/logs",
        "external-inputs",
        () => Promise.reject(original),
        o.dependencies,
      ),
      (error) => error === original,
    );
    assert.equal(o.rows[1].cause, "operation-failed");
    assert.doesNotMatch(
      JSON.stringify(o.rows) + o.emitted.join(""),
      /SECRET|PRIVATE|token/,
    );
  }
});

test("observation IO, logging and cleanup failures preserve operation result and cancellation", async () => {
  for (const options of [
    { openFails: true },
    { writeFails: true },
    { closeFails: true },
    { emitFails: true },
    { openFails: true, emitFails: true },
  ]) {
    const o = observer(options),
      success = {};
    assert.equal(
      await observePreparationPhase(
        "/owned/logs",
        "environment",
        () => success,
        o.dependencies,
      ),
      success,
    );
    const cancellation = new Error("CANCELLED_PRIVATE");
    await assert.rejects(
      observePreparationPhase(
        "/owned/logs",
        "environment",
        () => {
          throw cancellation;
        },
        o.dependencies,
      ),
      (error) => error === cancellation,
    );
  }
  const o = observer(),
    original = {
      get message() {
        throw new Error("PRIVATE_ACCESSOR");
      },
    };
  await assert.rejects(
    observePreparationPhase(
      "/owned/logs",
      "metal",
      () => {
        throw original;
      },
      o.dependencies,
    ),
    (error) => error === original,
  );
  assert.equal(o.rows[1].cause, "operation-failed");
});

test("unrecognized phases cannot create files, emit data or run an operation", async () => {
  const o = observer();
  let called = false;
  await assert.rejects(
    observePreparationPhase(
      "/owned/logs",
      "../SECRET",
      () => {
        called = true;
      },
      o.dependencies,
    ),
    /Invalid preparation observation phase/,
  );
  assert.equal(called, false);
  assert.equal(o.opened.length, 0);
  assert.equal(o.emitted.length, 0);
});
