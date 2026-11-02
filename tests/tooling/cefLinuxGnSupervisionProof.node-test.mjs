import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  authority,
  originalEnd,
  kernelBlocks,
  validateReport,
  runProof,
  lastObservation,
  failureCode,
  assertionFailureCode,
  supervisorObservation,
} from "../fixtures/cef/linux_gn_supervision_proof.mjs";

// Portable tests only. No native child, Git, ps or proof main is executed here.
const ref = "refs/heads/codex/linux-gn-supervision-proof-20261102";
const facts = () => ({
  ImageOS: "ubuntu24",
  ImageVersion: "20261026.354.1",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: ref,
  GITHUB_WORKFLOW_REF: `supermarsx/sortOfRemoteNG/.github/workflows/cef-linux-gn-supervision-proof.yml@${ref}`,
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
});

const runtime = (
  await fs.readFile(
    new URL("../../scripts/cef-runtime-ci.mjs", import.meta.url),
    "utf8",
  )
).replaceAll("\r\n", "\n");
const fixture = (
  await fs.readFile(
    new URL("../fixtures/cef/linux_gn_supervision_proof.mjs", import.meta.url),
    "utf8",
  )
).replaceAll("\r\n", "\n");
const names = [
  "natural-zero",
  "nonzero",
  "timeout",
  "cancel",
  "detached-writer",
  "pipe-holder",
  "output-bound",
  "reserve",
  "setup-clock",
  "late-postcheck",
  "delayed-close",
  "direct-natural-zero",
  "direct-nonzero",
  "direct-output-bound",
];
const capCase = (id) => ["output-bound", "direct-output-bound"].includes(id);
const falseFlags = {
  vendorGnExecuted: false,
  sourceAcquisition: false,
  sourceRestarted: false,
  sourceInputsRevalidated: false,
  productionReadinessIssued: false,
  sourceMigrationAdmitted: false,
  compilerExecuted: false,
  sdkProduced: false,
  nativeAcceptance: false,
  runtimeReady: false,
  exactImageAdmission: false,
};
function syntheticReport() {
  // Pure validation input, explicitly NOT an executed native proof.
  return {
    kind: "linux-gn-benign-native-proof",
    complete: true,
    cleanupConfirmed: true,
    attemptId: "12345678-1234-4123-8123-123456789abc",
    head: "a".repeat(40),
    runId: "123",
    runAttempt: "1",
    sourceWitnessSha256: "b".repeat(64),
    observedHost: authority(facts(), "linux", "x64"),
    foreignPreserved: true,
    ...falseFlags,
    cases: names.map((id) => {
      const idle = ["reserve", "setup-clock"].includes(id),
        direct = id.startsWith("direct-"),
        positive = ["natural-zero", "direct-natural-zero"].includes(id);
      return {
        id,
        complete: true,
        fulfilled: positive,
        rejected: !positive,
        observerAssisted: !idle && !direct,
        executionMode: direct ? "direct" : idle ? "idle" : "observer-assisted",
        actorHandshakeJoined: direct ? true : null,
        faultScheduling: [
          "setup-clock",
          "late-postcheck",
          "delayed-close",
        ].includes(id),
        supervisorJoined: idle ? null : capCase(id) ? false : true,
        supervisorObservation: idle
          ? null
          : {
              rootExited: true,
              pipeClosed: true,
              monitorJoined: true,
              probesJoined: true,
              outputsJoined: !capCase(id),
              outputsSettled: true,
              outputHandlesClosed: true,
              cohortQuiet: true,
              observedProcesses: 1,
              phase: capCase(id) ? "denied" : "complete",
              failureStage: capCase(id) ? "output-bound" : "none",
            },
        expectedOutputRejection: capCase(id),
        spawned: idle ? 0 : positive ? 2 : 1,
        closeAttempts: id === "reserve" ? 0 : positive ? 2 : 1,
        reparentWitness: id === "detached-writer",
        noLateWriter: id === "detached-writer",
        productionReceiptRejected: positive,
        heldFdJoined: true,
      };
    }),
  };
}

test("pure authority checks exact private workflow/head/host, with image observed rather than asserted354", () => {
  for (const image of ["20261026.353.1", "20261026.354.1"]) {
    const value = authority(
      { ...facts(), ImageVersion: image },
      "linux",
      "x64",
    );
    assert.equal(value.imageVersion, image);
    assert.equal(value.source, "process-and-runner-environment");
    assert(Object.isFrozen(value));
  }
  for (const [platform, arch] of [
    ["darwin", "x64"],
    ["linux", "arm64"],
    ["win32", "x64"],
  ])
    assert.throws(() => authority(facts(), platform, arch));
  for (const key of Object.keys(facts()))
    for (const value of [undefined, "foreign"])
      assert.throws(
        () => authority({ ...facts(), [key]: value }, "linux", "x64"),
        key,
      );
  assert.throws(() =>
    authority({ ...facts(), GITHUB_REF: "refs/heads/main" }, "linux", "x64"),
  );
});

test("one original monotonic end includes checkout age and fixed30s cleanup, never refreshed", () => {
  const now = 1793664000000;
  assert.equal(originalEnd(String(now), now, 100), 160100);
  assert.equal(originalEnd(String(now - 200000), now, 100), 70100);
  assert.equal(originalEnd(String(now - 200000), now + 10000, 10100), 70100);
  for (const started of [
    String(now + 1),
    String(now - 240000),
    "0",
    "invalid",
    undefined,
  ])
    assert.throws(() => originalEnd(started, now, 100));
});

test("full canonical runtime and both original marked bodies are exact before evaluation", () => {
  const blocks = kernelBlocks(runtime);
  assert.equal(blocks.length, 2);
  assert(blocks[0].includes("await compileSlice(capture.python, capture.args"));
  assert(blocks[1].includes("state.active = false;"));
  for (const changed of [
    runtime + "\n",
    runtime.replace("state.active = false;", "state.active = true;"),
    runtime.replace("30000", "30001"),
  ])
    assert.throws(() => kernelBlocks(changed));
});

test("strict pure report validator rejects missing/native-invented claims, incomplete cases and extra data", () => {
  const value = syntheticReport();
  assert.equal(validateReport(value), value);
  for (const key of Object.keys(value)) {
    const changed = structuredClone(value);
    delete changed[key];
    assert.throws(() => validateReport(changed), key);
  }
  for (const key of Object.keys(falseFlags)) {
    const changed = structuredClone(value);
    changed[key] = true;
    assert.throws(() => validateReport(changed), key);
  }
  for (const mutate of [
    (v) => {
      v.foreignPreserved = false;
    },
    (v) => {
      v.rawError = "PRIVATE";
    },
    (v) => {
      v.observedHost.expectedImage = "20261026.354.1";
    },
    (v) => {
      v.observedHost.platform = "darwin";
    },
    (v) => {
      v.cases.reverse();
    },
    (v) => {
      v.cases.pop();
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => validateReport(changed));
  }
});

test("all case facts enforce real joins, both roots, exact64MiB path and labeled injected faults", () => {
  for (let index = 0; index < names.length; index++) {
    const value = syntheticReport();
    for (const key of Object.keys(value.cases[index])) {
      const changed = structuredClone(value);
      delete changed.cases[index][key];
      assert.throws(() => validateReport(changed), names[index] + key);
    }
    for (const key of [
      "complete",
      "fulfilled",
      "rejected",
      "observerAssisted",
      "faultScheduling",
      "reparentWitness",
      "noLateWriter",
      "productionReceiptRejected",
      "heldFdJoined",
      "expectedOutputRejection",
    ]) {
      const changed = structuredClone(value);
      changed.cases[index][key] = !changed.cases[index][key];
      assert.throws(() => validateReport(changed), names[index] + key);
    }
    for (const key of ["spawned", "closeAttempts"]) {
      const changed = structuredClone(value);
      changed.cases[index][key]++;
      assert.throws(() => validateReport(changed));
    }
    const changed = structuredClone(value);
    changed.cases[index].supervisorJoined = "root-only";
    assert.throws(() => validateReport(changed));
  }
});

test("strict case observations reject missing or false joins and confine the cap exception to its exact denied case", () => {
  for (const [index, id] of names.entries()) {
    const value = syntheticReport();
    if (["reserve", "setup-clock"].includes(id)) {
      for (const observation of [{}, value.cases[0].supervisorObservation]) {
        const changed = structuredClone(value);
        changed.cases[index].supervisorObservation = observation;
        assert.throws(() => validateReport(changed), id);
      }
      continue;
    }
    for (const key of Object.keys(value.cases[index].supervisorObservation)) {
      const missing = structuredClone(value);
      delete missing.cases[index].supervisorObservation[key];
      assert.throws(() => validateReport(missing), id + key);
    }
    for (const key of [
      "rootExited",
      "pipeClosed",
      "monitorJoined",
      "probesJoined",
      "outputsJoined",
      "outputsSettled",
      "outputHandlesClosed",
      "cohortQuiet",
    ])
      for (const observed of [null, undefined, 0, "true", false]) {
        if (capCase(id) && key === "outputsJoined" && observed === false)
          continue;
        const changed = structuredClone(value);
        changed.cases[index].supervisorObservation[key] = observed;
        assert.throws(() => validateReport(changed), id + key + observed);
      }
    const extra = structuredClone(value);
    extra.cases[index].supervisorObservation.rawError = "PRIVATE";
    assert.throws(() => validateReport(extra));
    for (const [key, observed] of [
      ["phase", "UNKNOWN"],
      ["failureStage", "PRIVATE"],
      ["observedProcesses", 4097],
    ]) {
      const changed = structuredClone(value);
      changed.cases[index].supervisorObservation[key] = observed;
      assert.throws(() => validateReport(changed), id + key);
    }
    if (capCase(id)) {
      for (const [key, observed] of [
        ["phase", "complete"],
        ["failureStage", "writer"],
        ["outputsJoined", true],
      ]) {
        const changed = structuredClone(value);
        changed.cases[index].supervisorObservation[key] = observed;
        assert.throws(() => validateReport(changed), key);
      }
    } else {
      const mislabeled = structuredClone(value);
      mislabeled.cases[index].supervisorObservation.failureStage =
        "output-bound";
      assert.throws(() => validateReport(mislabeled), id + "stage mislabel");
      const changed = structuredClone(value);
      changed.cases[index].expectedOutputRejection = true;
      changed.cases[index].supervisorJoined = false;
      changed.cases[index].supervisorObservation =
        value.cases[names.indexOf("output-bound")].supervisorObservation;
      assert.throws(() => validateReport(changed), id + "exception mislabel");
    }
  }
});

test("actual diagnostic and cap assertions require exact first error and physical closure in a portable model", () => {
  const start = fixture.indexOf("function diagnostic(message) {"),
    end = fixture.indexOf("\nasync function caseRun(", start);
  assert(start > 0 && end > start);
  const scope = vm.createContext({ assert, JSON });
  const api = vm.runInContext(
    fixture.slice(start, end) +
      "\n({diagnostic,joined,outputBoundClosed,outputBoundCase})",
    scope,
  );
  const summary =
    syntheticReport().cases[names.indexOf("output-bound")]
      .supervisorObservation;
  const message = (value) =>
    "[cef-engineering-checkpoint] compile-supervision=" + JSON.stringify(value);
  assert.equal(api.joined(summary), false);
  assert.equal(api.outputBoundClosed(summary), true);
  assert.equal(api.diagnostic(message(summary)).outputsJoined, false);
  for (const key of ["outputsSettled", "outputHandlesClosed"])
    for (const value of [undefined, null, 0, "true"]) {
      const changed = { ...summary, [key]: value };
      assert.throws(() => api.diagnostic(message(changed)));
      assert.equal(api.outputBoundClosed(changed), false);
    }
  const a = fixture.lastIndexOf("  if (outputBoundCase(id))"),
    b = fixture.indexOf('  if (["reserve", "setup-clock"].includes(id))', a);
  assert(a > end && b > a);
  const assertion = fixture.slice(a, b);
  for (const rejection of [
    false,
    0,
    null,
    undefined,
    Error("writer failure"),
    Error("Shared compile output bound PRIVATE"),
    Error("Shared compile output bound"),
  ]) {
    const evaluate = () =>
      vm.runInNewContext(assertion, {
        assert,
        id: "output-bound",
        rejected: true,
        fulfilled: false,
        rejection,
        summary,
        outputBoundClosed: api.outputBoundClosed,
        outputBoundCase: api.outputBoundCase,
        assertionFailureCode,
      });
    if (assertionFailureCode(rejection) === "COMPILE_OUTPUT_BOUND") evaluate();
    else assert.throws(evaluate, /PROOF_OUTPUT_STAGE/);
  }
});

function directFunctions(bindings = {}) {
  const a = fixture.indexOf("const DIRECT_ROLES = Object.freeze({"),
    b = fixture.indexOf("\nasync function caseRun(", a);
  const checkStart = fixture.indexOf("function check(end) {"),
    checkEnd = fixture.indexOf("\nasync function held(", checkStart),
    pollStart = fixture.indexOf("async function poll(work, end) {"),
    pollEnd = fixture.indexOf("\nasync function optional(", pollStart);
  assert(a > 0 && b > a && checkStart > 0 && pollStart > 0);
  const dependencies = {
    assert,
    Buffer,
    path,
    constants: { O_RDONLY: 0 },
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    ...bindings,
    modelDelay: bindings.delay,
  };
  return new Function(
    ...Object.keys(dependencies),
    fixture.slice(checkStart, checkEnd) +
      "\n" +
      (bindings.delay ? "delay = modelDelay;\n" : "") +
      fixture.slice(pollStart, pollEnd) +
      "\n" +
      fixture.slice(a, b) +
      "\nreturn {directCompile,directActorHandshake};",
  )(...Object.values(dependencies));
}

test("actual wrapper initial and revalidation forward direct options with no observer out or census own properties", async () => {
  const { directCompile } = directFunctions();
  const forwarded = [],
    joins = [];
  let coordinated = 0;
  const core = {
    compileSlice: async (exe, args, options) => {
      forwarded.push({ exe, args, options });
      return quiet();
    },
  };
  const m = model((exe, args, options) =>
    directCompile(
      core,
      exe,
      args,
      options,
      async () => {
        coordinated++;
      },
      joins,
      1000,
    ),
  );
  await m.api.superviseLinuxSourceGn(m.capture, "initial");
  await m.api.withLinuxSourceOwner({}, m.capture, async (context) => {
    const receipt = await m.api.revalidateLinuxSourceOwner(context);
    assert.equal(
      m.api.assertLinuxSourceOwnerReceipt(context, receipt).cohortQuietProven,
      true,
    );
  });
  assert.equal(forwarded.length, 2);
  assert.equal(coordinated, 2);
  assert.equal(joins.length, 2);
  for (const [index, { exe, args, options }] of forwarded.entries()) {
    assert.equal(exe, m.capture.python);
    assert.equal(args, m.capture.args);
    assert.equal(options.env, m.capture.env);
    assert.equal(options.cwd, m.capture.cwd);
    assert.equal(
      options.logs,
      "/proof/logs/source-gn-" + (index ? "revalidation" : "initial"),
    );
    assert.equal(options.milliseconds, 30000);
    assert.deepEqual(JSON.parse(JSON.stringify(options.outputLedger)), {
      bytes: 0,
      cap: 64 * 1024 ** 2,
    });
    assert.equal(
      Object.getPrototypeOf(options.outputLedger),
      Object.getPrototypeOf(core),
    );
    for (const key of ["observeRoot", "out", "censusFactory"])
      assert.equal(Object.hasOwn(options, key), false);
    assert.equal(Object.hasOwn(options, "stopSignal"), index === 1);
  }
  for (const key of ["observeRoot", "out", "censusFactory"]) {
    let called = false;
    await assert.rejects(
      directCompile(
        {
          compileSlice: () => {
            called = true;
          },
        },
        "fixed",
        [],
        { [key]: undefined },
        () => {
          called = true;
        },
        [],
        1000,
      ),
      /PROOF_DIRECT_OPTIONS/,
    );
    assert.equal(called, false);
  }
});

test("direct coordinator remains joined after first supervisor rejection and preserves falsy original reasons", async () => {
  const { directCompile } = directFunctions();
  for (const first of [
    false,
    0,
    null,
    undefined,
    Error("Shared compile output bound"),
  ]) {
    let release,
      settled = false;
    const joins = [];
    const run = directCompile(
      {
        compileSlice: async () => {
          throw first;
        },
      },
      "fixed",
      [],
      { outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 } },
      () =>
        new Promise((_, reject) => {
          release = () => reject(Error("later fixture failure"));
        }),
      joins,
      1000,
    );
    run.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise(setImmediate);
    assert.equal(settled, false);
    assert.equal(joins.length, 1);
    release();
    await run.then(
      () => assert.fail("rejection lost"),
      (error) => assert.equal(error, first),
    );
  }
  let release;
  const joins = [];
  await assert.rejects(
    directCompile(
      { compileSlice: async () => quiet() },
      "fixed",
      [],
      { outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 } },
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      joins,
      15,
    ),
    /PROOF_DEADLINE/,
  );
  release();
  await Promise.all(joins);
  const marker = Error("independent handshake failed");
  await assert.rejects(
    directCompile(
      { compileSlice: async () => quiet() },
      "fixed",
      [],
      { outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 } },
      async () => {
        throw marker;
      },
      [],
      1000,
    ),
    (error) => error === marker,
  );
});

async function handshakeFixture(t, role, options = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "gn-direct-handshake-")),
  );
  const attempt = path.join(root, "attempt-initial");
  await fs.mkdir(attempt);
  const leaf = (name) => path.join(attempt, name);
  const facts = { pid: 12345, parent: 4321 };
  await fs.writeFile(leaf("claimed"), "12345");
  await fs.writeFile(leaf(role + ".json"), JSON.stringify(facts));
  if (role === "natural-zero")
    await fs.writeFile(
      leaf("child-natural.json"),
      JSON.stringify({ pid: 12346, parent: 12345 }),
    );
  t.after(async () => {
    for (const directory of [attempt, path.join(root, "saved")]) {
      if (!(await fs.stat(directory).catch(() => null))) continue;
      for (const entry of await fs.readdir(directory)) {
        const file = path.join(directory, entry);
        assert(file.startsWith(root + path.sep));
        const info = await fs.lstat(file);
        assert(info.isFile() && !info.isSymbolicLink());
        await fs.unlink(file);
      }
      await fs.rmdir(directory);
    }
    await fs.rmdir(root);
  });
  let clock = 0,
    closes = 0;
  const stamp = (value) =>
    [
      value.dev,
      value.ino,
      value.mode,
      value.uid,
      value.size,
      value.nlink,
      value.mtimeNs,
      value.ctimeNs,
    ].join(":");
  const identity = stamp(await fs.lstat(attempt, { bigint: true }))
    .split(":")
    .slice(0, 4)
    .join(":");
  const state = {
    root,
    attempt,
    leaf,
    handles: [],
    releases: [],
    pids: new Set(),
  };
  const owned = {
    current: async () => assert(!options.retired, "PROOF_RETIRED"),
    directoryCurrent: async (value) => {
      assert.equal(value, attempt);
      assert.equal(
        stamp(await fs.lstat(attempt, { bigint: true }))
          .split(":")
          .slice(0, 4)
          .join(":"),
        identity,
        "PROOF_DIRECTORY_CHANGED",
      );
    },
  };
  const api = directFunctions({
    fs: {
      ...fs,
      open: async (...args) => {
        const fd = await fs.open(...args);
        state.handles.push(fd);
        if (options.lateOpen)
          await new Promise((resolve) => {
            state.releaseOpen = resolve;
          });
        return {
          stat: (...values) => fd.stat(...values),
          read: (...values) => fd.read(...values),
          close: () => {
            closes++;
            if (options.neverClose)
              return new Promise((resolve) => {
                state.releases.push(async () => {
                  await fd.close();
                  resolve();
                });
              });
            return fd.close().then(() => {
              if (options.closeError) throw options.closeError;
            });
          },
        };
      },
    },
    process: { pid: 4321 },
    full: stamp,
    ordinary: (value) => value.isFile() && value.nlink === 1n,
    performance: { now: () => clock },
    delay: async (ms, end) => {
      clock += ms;
      await options.onDelay?.(state);
      assert(clock < end, "PROOF_DEADLINE");
    },
  });
  // Replace only scheduling in this model; actual helper source owns real leaf
  // descriptors. Directory ownership and process identities are modeled.
  if (options.mutate) await options.mutate(state);
  state.run = (end = 6000) =>
    api.directActorHandshake(role, attempt, owned, end, state.pids);
  state.closes = () => closes;
  return state;
}

test("direct handshake uses actual held leaf descriptors and fixed releases without process probes", async (t) => {
  for (const role of ["natural-zero", "nonzero", "output-bound"]) {
    const state = await handshakeFixture(t, role);
    await state.run();
    assert.equal(state.closes(), role === "natural-zero" ? 3 : 2);
    assert(state.handles.every((fd) => fd.fd === -1));
    assert.deepEqual(
      [...state.pids],
      role === "natural-zero" ? [12345, 12346] : [12345],
    );
    if (role !== "output-bound")
      assert.equal(
        await fs.readFile(
          state.leaf(
            role === "natural-zero" ? "release-child" : "release-root",
          ),
          "utf8",
        ),
        "release",
      );
  }
});

test("direct handshake denies missing partial mismatched changed retired and late inputs and joins every owned close", async (t) => {
  for (const mutate of [
    (s) => fs.unlink(s.leaf("claimed")),
    (s) => fs.writeFile(s.leaf("nonzero.json"), "{"),
    (s) => fs.writeFile(s.leaf("claimed"), "12347"),
    (s) =>
      fs.writeFile(
        s.leaf("nonzero.json"),
        JSON.stringify({ pid: 12345, parent: 9 }),
      ),
  ]) {
    const state = await handshakeFixture(t, "nonzero", { mutate });
    await assert.rejects(state.run(40));
    assert(state.handles.every((fd) => fd.fd === -1));
    assert.equal(
      await fs.stat(state.leaf("release-root")).then(
        () => true,
        () => false,
      ),
      false,
    );
  }
  for (const options of [
    { retired: true },
    {
      onDelay: (s) =>
        fs.writeFile(
          s.leaf("nonzero.json"),
          JSON.stringify({ pid: 12349, parent: 4321 }),
        ),
    },
    {
      onDelay: async (s) => {
        await fs.rename(s.attempt, path.join(s.root, "saved"));
        await fs.mkdir(s.attempt);
      },
    },
    { closeError: Error("owned close denied") },
  ]) {
    const state = await handshakeFixture(t, "nonzero", options);
    await assert.rejects(state.run());
    assert(state.handles.every((fd) => fd.fd === -1));
  }
  for (const child of [
    { pid: 12345, parent: 12345 },
    { pid: 12346, parent: 9 },
  ]) {
    const state = await handshakeFixture(t, "natural-zero", {
      mutate: (s) =>
        fs.writeFile(s.leaf("child-natural.json"), JSON.stringify(child)),
    });
    await assert.rejects(state.run(), /PROOF_DIRECT_LINEAGE/);
    assert.equal(state.closes(), 3);
    assert(state.handles.every((fd) => fd.fd === -1));
  }
  const late = await handshakeFixture(t, "nonzero");
  await assert.rejects(late.run(1000), /PROOF_DEADLINE/);
  assert(late.handles.every((fd) => fd.fd === -1));
  const pending = await handshakeFixture(t, "output-bound", {
    neverClose: true,
  });
  await assert.rejects(pending.run(20), /PROOF_DEADLINE/);
  assert.equal(pending.closes(), 2);
  await Promise.all(pending.releases.map((release) => release()));
  assert(pending.handles.every((fd) => fd.fd === -1));
  const opening = await handshakeFixture(t, "output-bound", { lateOpen: true });
  await assert.rejects(opening.run(20), /PROOF_DEADLINE/);
  assert.equal(opening.closes(), 0);
  opening.releaseOpen();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert(opening.handles.every((fd) => fd.fd === -1));
});

test("strict fourteen-case schema requires direct labels and joined independent handshakes", () => {
  const report = syntheticReport();
  assert.equal(report.cases.length, 14);
  for (const [index, row] of report.cases.entries()) {
    for (const [key, values] of [
      [
        "executionMode",
        [
          undefined,
          null,
          "UNKNOWN",
          row.executionMode === "direct" ? "observer-assisted" : "direct",
        ],
      ],
      [
        "actorHandshakeJoined",
        [undefined, false, row.actorHandshakeJoined === true ? null : true],
      ],
    ])
      for (const value of values) {
        const changed = structuredClone(report);
        changed.cases[index][key] = value;
        assert.throws(() => validateReport(changed), row.id + key);
      }
  }
});

test("actual direct case orchestration uses the actual wrapper and real handshake files with modeled processes only", async (t) => {
  const helpersStart = fixture.indexOf("function diagnostic(message) {"),
    helpersEnd = fixture.indexOf(
      "const DIRECT_ROLES = Object.freeze({",
      helpersStart,
    ),
    caseStart = fixture.indexOf("async function caseRun("),
    caseEnd = fixture.indexOf(
      "\nasync function claimActorDirectory(",
      caseStart,
    );
  assert(helpersStart > 0 && helpersEnd > helpersStart && caseEnd > caseStart);
  const predicates = new Function(
    "assert",
    fixture.slice(helpersStart, helpersEnd) +
      "\nreturn {diagnostic,joined,outputBoundClosed};",
  )(assert);
  for (const id of [
    "direct-natural-zero",
    "direct-nonzero",
    "direct-output-bound",
  ]) {
    // Real files/leaf FDs; child execution, UIDs, directory modes/FDs and the
    // existing final process sample are modeled. No local child is started.
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "gn-direct-case-")),
    );
    let clock = 0,
      polls = 0,
      leavesClosed = 0,
      calls = 0;
    const release = new Map(),
      consoleModel = { error: () => {} };
    const normalize = (value) => {
      const copy = Object.assign(
        Object.create(Object.getPrototypeOf(value)),
        value,
      );
      copy.uid = typeof copy.uid === "bigint" ? 0n : 0;
      if (copy.isDirectory())
        copy.mode =
          typeof copy.mode === "bigint"
            ? (copy.mode & ~0o777n) | 0o700n
            : (copy.mode & ~0o777) | 0o700;
      return copy;
    };
    const stat = async (...args) => normalize(await fs.lstat(...args));
    const physical = (s) => [s.dev, s.ino, s.mode, s.uid].map(String).join(":"),
      full = (s) =>
        physical(s) + ":" + [s.size, s.nlink, s.mtimeNs, s.ctimeNs].join(":");
    const directories = new Map([
      [root, physical(await stat(root, { bigint: true }))],
    ]);
    const owned = {
      root,
      observers: new Set(),
      assertActive: () => assert(clock < 160000),
      current: async () =>
        assert.equal(
          physical(await stat(root, { bigint: true })),
          directories.get(root),
        ),
      directoryCurrent: async (directory) => {
        assert(directories.has(directory));
        assert.equal(
          physical(await stat(directory, { bigint: true })),
          directories.get(directory),
        );
      },
      mkdir: async (directory) => {
        assert(directories.has(path.dirname(directory)));
        await fs.mkdir(directory, { mode: 0o700 });
        directories.set(
          directory,
          physical(await stat(directory, { bigint: true })),
        );
      },
    };
    t.after(async () => {
      for (const directory of [...directories.keys()].sort(
        (a, b) => b.length - a.length,
      )) {
        assert(directory === root || directory.startsWith(root + path.sep));
        for (const leaf of await fs.readdir(directory)) {
          const name = path.join(directory, leaf),
            value = await fs.lstat(name);
          assert(value.isFile() && !value.isSymbolicLink());
          await fs.unlink(name);
        }
        await fs.rmdir(directory);
      }
    });
    const io = {
      ...fs,
      lstat: stat,
      writeFile: async (name, ...args) => {
        await fs.writeFile(name, ...args);
        release.get(path.dirname(name))?.();
      },
      open: async (name, ...args) => {
        const info = await fs.lstat(name);
        if (info.isDirectory())
          return {
            stat: async () => stat(name, { bigint: true }),
            close: async () => {},
          };
        const fd = await fs.open(name, ...args);
        return {
          stat: async (...args) => normalize(await fd.stat(...args)),
          read: (...args) => fd.read(...args),
          close: async () => {
            await fd.close();
            leavesClosed++;
          },
        };
      },
    };
    const scheduling = {
      performance: { now: () => clock },
      delay: async (ms, end) => {
        clock += ms;
        assert(clock < end);
      },
      fs: io,
      process: { pid: process.pid },
      full,
      ordinary: (s) => s.isFile() && s.nlink === 1n,
    };
    const { directCompile, directActorHandshake } = directFunctions(scheduling);
    const core = {
      hostRemaining: () => 160000 - clock,
      compileSlice: async (_exe, args, options) => {
        calls++;
        for (const key of ["observeRoot", "out", "censusFactory"])
          assert(!Object.hasOwn(options, key));
        const attempt = path.join(
          args[3],
          options.logs.endsWith("initial")
            ? "attempt-initial"
            : "attempt-revalidation",
        );
        const role = args[2],
          pid = 20000 + calls * 10;
        writeFileSync(path.join(attempt, "claimed"), String(pid));
        writeFileSync(
          path.join(attempt, role + ".json"),
          JSON.stringify({ pid, parent: process.pid }),
        );
        if (role === "natural-zero")
          writeFileSync(
            path.join(attempt, "child-natural.json"),
            JSON.stringify({ pid: pid + 1, parent: pid }),
          );
        if (role !== "output-bound")
          await new Promise((resolve) => release.set(attempt, resolve));
        consoleModel.error(
          "[cef-engineering-checkpoint] compile-supervision=" +
            JSON.stringify({
              rootExited: true,
              pipeClosed: true,
              monitorJoined: true,
              probesJoined: true,
              outputsJoined: role !== "output-bound",
              outputsSettled: true,
              outputHandlesClosed: true,
              cohortQuiet: true,
              observedProcesses: 1,
              phase: role === "output-bound" ? "denied" : "complete",
              failureStage: role === "output-bound" ? "output-bound" : "none",
            }),
        );
        if (role === "output-bound") throw Error("Shared compile output bound");
        return role === "nonzero"
          ? { ...quiet(), outcome: "compiler-failed", exitCode: 7 }
          : quiet();
      },
    };
    const dependencies = {
      assert,
      fs: io,
      path,
      constants: { O_RDONLY: 0 },
      process: {
        pid: process.pid,
        execPath: "/modeled/node",
        env: { RUNNER_TEMP: root },
        getuid: () => 0,
      },
      performance: scheduling.performance,
      console: consoleModel,
      vm,
      AbortController,
      setTimeout,
      clearTimeout,
      ROOT: fileURLToPath(new URL("../../", import.meta.url)),
      RUNTIME: "scripts/cef-runtime-ci.mjs",
      SELF: "/fixed/fixture",
      physical,
      ...predicates,
      directCompile,
      directActorHandshake,
      DIRECT_ROLES: {
        "direct-natural-zero": "natural-zero",
        "direct-nonzero": "nonzero",
        "direct-output-bound": "output-bound",
      },
      outputBoundCase: capCase,
      kernelBlocks,
      pathToFileURL,
      supervisorObservation,
      assertionFailureCode,
      ps: async () => {
        polls++;
        return [];
      },
      lastCaseDiagnostic: null,
      within: async (work) => work(),
      delay: scheduling.delay,
    };
    const execute = new Function(
      ...Object.keys(dependencies),
      "return (" + fixture.slice(caseStart, caseEnd) + ");",
    )(...Object.values(dependencies));
    const known = new Map();
    const row = await execute(
      id,
      owned,
      { contents: new Map([["scripts/cef-runtime-ci.mjs", runtime]]) },
      core,
      160000,
      known,
    );
    assert.equal(row.actorHandshakeJoined, true);
    assert.equal(row.observerAssisted, false);
    assert.equal(row.executionMode, "direct");
    assert.equal(calls, id === "direct-natural-zero" ? 2 : 1);
    assert.equal(polls, 1);
    assert.equal(known.size, 0);
    assert.equal(owned.observers.size, 0);
    assert.equal(leavesClosed, id === "direct-natural-zero" ? 6 : 2);
    const report = syntheticReport();
    report.cases[names.indexOf(id)] = JSON.parse(JSON.stringify(row));
    assert.equal(validateReport(report), report);
  }
});

test("actual public proof entry rejects extraargs before native/unsafe IO and clears last observation", async () => {
  await assert.rejects(runProof("not allowed"), /PROOF_ENTRY/);
  assert.equal(lastObservation(), null);
  assert.throws(() => lastObservation("extra"), /PROOF_ENTRY/);
  const old = process.env.GITHUB_REF;
  try {
    process.env.GITHUB_REF = "refs/heads/closed-negative";
    await assert.rejects(runProof(), /PROOF_HOST|PROOF_SCOPE/);
    const observation = lastObservation();
    assert.equal(observation.complete, false);
    assert.equal(observation.code, "PROOF_FAILED");
    assert(Object.isFrozen(observation));
    await assert.rejects(
      runProof({ report: syntheticReport() }),
      /PROOF_ENTRY/,
    );
    assert.equal(lastObservation(), null);
  } finally {
    if (old === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = old;
  }
});

test("closed failure projection labels unobserved reparenting without invoking thrown getters", () => {
  assert.equal(
    failureCode(Error("PROOF_REPARENT_UNOBSERVED")),
    "REPARENT_WITNESS_UNOBSERVED",
  );
  for (const value of [
    undefined,
    null,
    false,
    0,
    "PRIVATE",
    Error("PRIVATE"),
    Object.defineProperty({}, "message", {
      get() {
        assert.fail("getter");
      },
    }),
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Error("PRIVATE trap");
        },
      },
    ),
  ])
    assert.equal(failureCode(value), "PROOF_FAILED");
});

test("actual private root creator in isolated FS model records creation and retires normal operations before cleanup", async () => {
  const a = fixture.indexOf("async function ownedRoot(end) {"),
    b = fixture.indexOf("\nasync function actorMain(", a);
  assert(a > 0 && b > a);
  const dirs = new Map([
    [
      "/temp",
      { dev: 1n, ino: 1n, mode: 0o40700n, uid: 0n, isDirectory: () => true },
    ],
  ]);
  let ordinal = 1n,
    creates = 0;
  const scope = vm.createContext({
    assert,
    path: path.posix,
    Map,
    BigInt,
    constants: { O_RDONLY: 0, O_DIRECTORY: 1, O_NOFOLLOW: 2 },
    process: { env: { RUNNER_TEMP: "/temp" }, getuid: () => 0 },
    randomUUID: () => "12345678-1234-4123-8123-123456789abc",
    physical: (s) => [s.dev, s.ino, s.mode, s.uid].map(String).join(":"),
    check: () => {},
    fs: {
      realpath: async (p) => p,
      lstat: async (p) => {
        assert(dirs.has(p));
        return dirs.get(p);
      },
      mkdir: async (p) => {
        assert(!dirs.has(p));
        creates++;
        dirs.set(p, {
          dev: 1n,
          ino: ++ordinal,
          mode: 0o40700n,
          uid: 0n,
          isDirectory: () => true,
        });
      },
      open: async (p) => {
        const original = dirs.get(p);
        return { stat: async () => original, close: async () => {} };
      },
    },
  });
  const create = vm.runInContext("(" + fixture.slice(a, b) + ")", scope);
  const owned = await create(1000);
  await owned.current();
  await owned.mkdir(owned.root + "/logs");
  assert.equal(creates, 2);
  await assert.rejects(owned.mkdir(owned.root + "/unknown/child"));
  assert.equal(creates, 2);
  const original = dirs.get(owned.root + "/logs");
  dirs.set(owned.root + "/logs", { ...original, ino: 999n });
  await assert.rejects(
    owned.mkdir(owned.root + "/logs/child"),
    /DIRECTORY_CHANGED/,
  );
  assert.equal(creates, 2);
  owned.retire();
  assert.throws(() => owned.assertActive(), /RETIRED/);
  await assert.rejects(owned.current(), /RETIRED/);
  await owned.cleanupCurrent(); // Separate private physical check cannot mint work.
  dirs.set(owned.root, { ...dirs.get(owned.root), ino: 1000n });
  await assert.rejects(owned.cleanupCurrent(), /CHANGED/);
});

test("actual private launcher claims two disjoint actor attempts for unchanged initial/revalidation argv", async () => {
  const a = fixture.indexOf("async function claimActorDirectory(directory) {"),
    b = fixture.indexOf("\nasync function launch(", a);
  assert(a > 0 && b > a);
  const files = new Set(),
    flags = [],
    closed = [];
  let primary;
  const scope = vm.createContext({
    assert,
    path: path.posix,
    constants: { O_WRONLY: 1, O_CREAT: 2, O_EXCL: 4, O_NOFOLLOW: 8 },
    process: { getuid: () => 0, pid: 1234 },
    fs: {
      realpath: async (p) => p,
      lstat: async () => ({ isDirectory: () => true, uid: 0, mode: 0o40700 }),
      open: async (file, mode) => {
        flags.push(mode);
        if (primary) throw primary;
        if (files.has(file))
          throw Object.assign(Error("exists"), { code: "EEXIST" });
        files.add(file);
        return {
          writeFile: async (value) => assert.equal(value, "1234"),
          close: async () => {
            closed.push(file);
          },
        };
      },
    },
  });
  const claim = vm.runInContext("(" + fixture.slice(a, b) + ")", scope);
  assert.equal(await claim("/owned/case"), "/owned/case/attempt-initial");
  assert.equal(await claim("/owned/case"), "/owned/case/attempt-revalidation");
  await assert.rejects(claim("/owned/case"), /INVOCATIONS/);
  assert.equal(files.size, 2);
  assert.equal(closed.length, 2);
  assert(flags.every((mode) => mode === 15));
  primary = Object.assign(Error("denied"), { code: "EACCES" });
  await claim("/owned/other-case").then(
    () => assert.fail("failure adopted"),
    (error) => assert.equal(error, primary),
  );
  assert.equal(files.size, 2);
});

test("actor and oracle source keeps commands/env/namespace fixed with no vendor or input-selected module", () => {
  assert.match(
    fixture,
    /fixedChild\(\s*"\/bin\/ps",\s*\["-axo", "pid=,ppid=,lstart="\]/,
  );
  assert.match(
    fixture,
    /fixedChild\(\s*"\/usr\/bin\/git",\s*\["cat-file", "--batch"\]/,
  );
  assert(fixture.includes("sourceWitness(end)"));
  assert(
    fixture.includes("await import(pathToFileURL(path.join(ROOT, CORE)))"),
  );
  assert(fixture.includes("outputLedger: { ...options.outputLedger }"));
  assert(fixture.includes("64 * 1024 ** 2 + 1"));
  assert(!fixture.includes('exec("'));
  assert(!fixture.includes("shell: true"));
  assert(!fixture.includes("censusFactory:"));
  assert(!fixture.includes("out:"));
});

function model(supervisor) {
  const [wrapper, owner] = kernelBlocks(runtime);
  let remaining = 60000;
  const dirs = new Map([["/proof/logs", 1n]]);
  let ino = 1n,
    opened = 0,
    closed = 0;
  const info = (name) => ({
    dev: 1n,
    ino: dirs.get(name),
    mode: name === "/proof/logs" ? 0o40755n : 0o40700n,
    uid: 0n,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  });
  const scope = vm.createContext({
    path: path.posix,
    constants: { O_RDONLY: 0, O_NOFOLLOW: 1, O_DIRECTORY: 2 },
    process: { getuid: () => 0 },
    realpath: async (p) => p,
    lstat: async (p) => info(p),
    mkdir: async (p) => {
      assert(!dirs.has(p));
      dirs.set(p, ++ino);
    },
    open: async (p) => {
      opened++;
      return {
        stat: async () => info(p),
        close: async () => {
          closed++;
        },
      };
    },
    hostRemaining: () => remaining,
    fail: (message) => {
      throw Error(message);
    },
    setTimeout,
    clearTimeout,
    AbortController,
    compileSlice: (...args) => supervisor(...args),
  });
  const api = vm.runInContext(
    wrapper +
      owner.replace(/^export /gm, "") +
      "\n({superviseLinuxSourceGn,withLinuxSourceOwner,revalidateLinuxSourceOwner,assertLinuxSourceOwnerReceipt})",
    scope,
  );
  const capture = {
    python: "/fixed/node",
    args: Object.freeze([
      "/fixed/fixture",
      "--launch",
      "natural-zero",
      "/proof/case-natural-zero",
    ]),
    cwd: "/fixed",
    env: Object.freeze({ PATH: "/usr/bin:/bin", TZ: "UTC" }),
    logs: "/proof/logs",
    remaining: () => remaining,
    hostClock: {},
    binding: {},
  };
  return {
    scope,
    api,
    capture,
    expire: () => {
      remaining = 0;
    },
    closeCount: () => closed,
    openCount: () => opened,
  };
}
const quiet = () => ({
  outcome: "compiler-complete",
  exitCode: 0,
  quiescent: true,
  quiescence: "observed-lineage-and-root-group",
});

test("portable exact-wrapper model passes both roles but no raw capability reaches isolated receipt", async () => {
  const called = [];
  const m = model(async (exe, args, options) => {
    called.push({ exe, args, options });
    return quiet();
  });
  await m.api.superviseLinuxSourceGn(m.capture, "initial");
  const context = {};
  let issued;
  await m.api.withLinuxSourceOwner(context, m.capture, async (value) => {
    issued = await m.api.revalidateLinuxSourceOwner(value);
    const observed = m.api.assertLinuxSourceOwnerReceipt(value, issued);
    assert.equal(observed.cohortQuietProven, true);
    assert.equal(observed.productionReadinessIssued, false);
    assert.equal(observed.runtimeReady, false);
    assert(!("observed" in observed));
  });
  assert.equal(called.length, 2);
  assert.equal(m.closeCount(), 2);
  assert.throws(
    () => m.api.assertLinuxSourceOwnerReceipt(context, issued),
    /RECEIPT/,
  );
  for (const call of called) {
    assert.equal(call.exe, m.capture.python);
    assert.equal(call.args, m.capture.args);
    assert.equal(call.options.milliseconds, 30000);
    assert.equal(call.options.outputLedger.cap, 64 * 1024 ** 2);
    assert.equal(call.options.out, undefined);
    assert.equal(call.options.censusFactory, undefined);
  }
});

test("portable exact-wrapper model preserves falsy rejection and refuses post-await expired clocks", async () => {
  for (const marker of [undefined, null, false, 0, ""]) {
    const m = model(async () => {
      throw marker;
    });
    await m.api.superviseLinuxSourceGn(m.capture, "initial").then(
      () => assert.fail("failure lost"),
      (error) => assert.equal(error, marker),
    );
    assert.equal(m.closeCount(), 1);
  }
  let m;
  m = model(async () => {
    m.expire();
    return quiet();
  });
  await assert.rejects(
    m.api.superviseLinuxSourceGn(m.capture, "initial"),
    /DEADLINE/,
  );
  assert.equal(m.closeCount(), 1);
});

test("portable root0 alone, timeout, nonzero and missing lineage are not supervisor qualification", async () => {
  for (const change of [
    { outcome: "slice-ended" },
    { exitCode: 7 },
    { quiescent: false },
    { quiescence: "root-only" },
  ]) {
    const m = model(async () => ({ ...quiet(), ...change }));
    await assert.rejects(
      m.api.superviseLinuxSourceGn(m.capture, "initial"),
      /UNCONFIRMED/,
    );
    assert.equal(m.closeCount(), 1);
  }
});

const cleanup887 =
  'async function cleanup(owned, end) {\n  await owned.cleanupCurrent();\n  async function remove(dir) {\n    await owned.directoryCurrent(dir);\n    const info = await fs.lstat(dir, { bigint: true });\n    assert(\n      info.isDirectory() &&\n        info.uid === BigInt(process.getuid()) &&\n        (info.mode & 0o777n) === 0o700n,\n      "PROOF_CLEANUP_DIR",\n    );\n    const stamp = owned.directories.get(dir);\n    assert(\n      stamp !== undefined && physical(info) === stamp,\n      "PROOF_CLEANUP_CREATION",\n    );\n    const entries = await fs.readdir(dir, { withFileTypes: true });\n    for (const entry of entries) {\n      await owned.cleanupCurrent();\n      await owned.directoryCurrent(dir);\n      assert(\n        physical(await fs.lstat(dir, { bigint: true })) === stamp,\n        "PROOF_CLEANUP_CHANGED",\n      );\n      const file = path.join(dir, entry.name);\n      assert(\n        /^(case-(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|reserve|setup-clock|late-postcheck|delayed-close|foreign-control)|logs|source-gn-(?:initial|revalidation)|checkpoint-compile\\.(?:stdout\\.log|stderr\\.log|outcome\\.json)|actor-environment\\.json|(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|child-natural|child-writer|child-pipe|child-hold|foreign)\\.json|counter|reparented|release-root|release-child|attempt-initial|attempt-revalidation|claimed)$/.test(\n          entry.name,\n        ),\n        "PROOF_UNKNOWN_LEAF",\n      );\n      if (entry.isDirectory()) await remove(file);\n      else {\n        const before = await fs.lstat(file, { bigint: true });\n        assert(ordinary(before), "PROOF_CLEANUP_FILE");\n        assert(\n          full(await fs.lstat(file, { bigint: true })) === full(before),\n          "PROOF_CLEANUP_CHANGED",\n        );\n        await owned.cleanupCurrent();\n        await owned.directoryCurrent(dir);\n        assert(\n          physical(await fs.lstat(dir, { bigint: true })) === stamp,\n          "PROOF_CLEANUP_CHANGED",\n        );\n        await fs.unlink(file);\n      }\n    }\n    assert(\n      physical(await fs.lstat(dir, { bigint: true })) === stamp,\n      "PROOF_CLEANUP_CHANGED",\n    );\n    await owned.directoryCurrent(dir);\n    if (dir !== owned.root) await fs.rmdir(dir);\n  }\n  await remove(owned.root);\n  await owned.cleanupCurrent();\n  await within(() => owned.fd.close(), end);\n  assert(\n    physical(await fs.lstat(owned.root, { bigint: true })) === owned.identity,\n    "PROOF_CLEANUP_CHANGED",\n  );\n  await fs.rmdir(owned.root);\n}\n';

// Real file/rename/read/unlink and real leaf FD IO; only UID/directory modes
// and the root-directory FD are modeled for this portable Windows regression.
test(
  "actual cleanup denies last-await file/content/directory swaps and preserves foreign replacements",
  { timeout: 10000 },
  async () => {
    assert.equal(
      createHash("sha256").update(cleanup887).digest("hex"),
      "06482c6793257db4fe1493f43df1bcdcf0dc3629904c371a90899e1ffd7c424e",
    );
    const a = fixture.indexOf("async function cleanup(owned, end) {"),
      b = fixture.indexOf("\nexport function validateReport(", a);
    assert(a > 0 && b > a);
    const actual = fixture.slice(a, b);
    const facts = (s) => {
      const copy = Object.assign(Object.create(Object.getPrototypeOf(s)), s);
      copy.uid = 0n;
      if (copy.isDirectory()) copy.mode = (copy.mode & ~0o777n) | 0o700n;
      return copy;
    };
    const physical = (s) => [s.dev, s.ino, s.mode, s.uid].map(String).join(":");
    const full = (s) =>
      physical(s) + ":" + [s.size, s.nlink, s.mtimeNs, s.ctimeNs].join(":");
    for (const variant of ["unchanged", "leaf", "content", "directory", "root"])
      for (const [label, body] of [
        ["old887", cleanup887],
        ["current", actual],
      ]) {
        const base = await fs.realpath(
          await fs.mkdtemp(
            path.join(os.tmpdir(), "codex-gn-cleanup-regression-"),
          ),
        );
        const root = path.join(base, "owned"),
          leaf = path.join(root, "actor-environment.json"),
          saved = path.join(base, "saved-owned"),
          sub = path.join(root, "logs");
        await fs.mkdir(root, { mode: 0o700 });
        if (variant === "directory") await fs.mkdir(sub, { mode: 0o700 });
        else if (variant !== "root")
          await fs.writeFile(leaf, "OWNED", { flag: "wx" });
        const stat = async (p) => facts(await fs.lstat(p, { bigint: true }));
        const identity = physical(await stat(root));
        const directories = new Map([[root, identity]]);
        if (variant === "directory")
          directories.set(sub, physical(await stat(sub)));
        let leafStats = 0,
          subChecks = 0,
          replaced = false,
          completed = false,
          failure,
          leafCloses = 0;
        const rootCurrent = async () =>
          assert.equal(physical(await stat(root)), identity);
        const owned = {
          root,
          identity,
          directories,
          fd: {
            close: async () => {
              if (variant === "root") {
                await fs.rename(root, saved);
                await fs.mkdir(root, { mode: 0o700 });
                replaced = true;
              }
            },
          },
          cleanupCurrent: async () => {
            if (
              ["leaf", "content"].includes(variant) &&
              leafStats >= 2 &&
              !replaced
            ) {
              if (variant === "leaf") {
                await fs.rename(leaf, saved);
                await fs.writeFile(leaf, "ALIEN", { flag: "wx" });
              } else await fs.writeFile(leaf, "ALIEN");
              replaced = true;
            }
            await rootCurrent();
          },
          directoryCurrent: async (dir) => {
            await rootCurrent();
            if (variant === "directory" && dir === sub && ++subChecks === 2) {
              await fs.rename(sub, saved);
              await fs.mkdir(sub, { mode: 0o700 });
              replaced = true;
            }
          },
        };
        const io = {
          ...fs,
          lstat: async (p) => {
            if (p === leaf) leafStats++;
            return stat(p);
          },
          open: async (...args) => {
            const fd = await fs.open(...args);
            return {
              stat: async (options) => facts(await fd.stat(options)),
              read: (...values) => fd.read(...values),
              close: async () => {
                leafCloses++;
                await fd.close();
              },
            };
          },
        };
        const end = performance.now() + 5000;
        const cleanup = vm.runInNewContext("(" + body + ")", {
          assert,
          path,
          physical,
          full,
          ordinary: (s) => s.isFile() && s.nlink === 1n && s.uid === 0n,
          process: { getuid: () => 0 },
          within: async (work) => {
            assert(performance.now() < end);
            const value = await work();
            assert(performance.now() < end);
            return value;
          },
          fs: io,
        });
        try {
          try {
            await cleanup(owned, end);
            completed = true;
          } catch (error) {
            failure = error;
          }
          if (variant === "unchanged") {
            assert.equal(completed, true, label);
            assert.equal(
              await fs.lstat(root).then(
                () => true,
                () => false,
              ),
              false,
            );
          } else {
            assert.equal(replaced, true, variant + label);
            const target = ["leaf", "content"].includes(variant)
              ? leaf
              : variant === "directory"
                ? sub
                : root;
            if (label === "old887" && variant !== "root") {
              assert.equal(completed, true, variant);
              assert.equal(
                await fs.lstat(target).then(
                  () => true,
                  () => false,
                ),
                false,
                "RED: foreign replacement was deleted",
              );
            } else {
              assert.equal(completed, false, variant);
              assert.match(failure.message, /PROOF_CLEANUP_CHANGED/);
              assert.equal(
                await fs.lstat(target).then(
                  () => true,
                  () => false,
                ),
                true,
                "GREEN: foreign replacement preserved",
              );
              if (["leaf", "content"].includes(variant))
                assert.equal(await fs.readFile(target, "utf8"), "ALIEN");
            }
          }
          if (label === "current" && !["directory", "root"].includes(variant))
            assert.equal(leafCloses, 1, "one actual leaf FD close");
        } finally {
          // Only these freshly created known test paths; no recursive cleanup.
          for (const p of [leaf, sub, saved, root]) {
            assert(p.startsWith(base + path.sep));
            const info = await fs.lstat(p).catch((error) => {
              if (error.code !== "ENOENT") throw error;
              return null;
            });
            if (!info) continue;
            assert(!info.isSymbolicLink());
            if (info.isDirectory()) await fs.rmdir(p);
            else await fs.unlink(p);
          }
          await fs.rmdir(base);
        }
      }
  },
);

test("fixed own-descriptor assertions and supervisor diagnostic copies disclose no raw errors", () => {
  for (const [message, code] of [
    ["PROOF_JOIN", "ASSERT_JOIN"],
    ["PROOF_DENIAL", "ASSERT_DENIAL"],
    ["PROOF_OUTPUT_STAGE", "ASSERT_OUTPUT_STAGE"],
    ["PROOF_ROOT_ADMISSION", "ASSERT_ROOT_ADMISSION"],
    ["PROOF_SUMMARY_ONCE", "ASSERT_SUMMARY_ONCE"],
    ["PROOF_SUPERVISOR_DIAGNOSTIC", "ASSERT_SUPERVISOR_DIAGNOSTIC"],
    ["PROOF_CASE_ROOT_CHANGED", "ASSERT_CASE_ROOT_CHANGED"],
    ["PROOF_FIXED_COMMAND", "ASSERT_FIXED_COMMAND"],
    ["Shared compile output bound", "COMPILE_OUTPUT_BOUND"],
    ["PROOF_REPARENT_UNOBSERVED", "REPARENT_WITNESS_UNOBSERVED"],
  ])
    assert.equal(assertionFailureCode(Error(message)), code);
  let getters = 0;
  const hostile = Object.defineProperty({}, "message", {
    get() {
      getters++;
      throw Error("PRIVATE");
    },
  });
  for (const value of [
    hostile,
    false,
    0,
    null,
    undefined,
    "PROOF_JOIN",
    Error("PROOF_JOIN PRIVATE"),
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Error("PRIVATE");
        },
      },
    ),
  ])
    assert.equal(assertionFailureCode(value), "PROOF_FAILED");
  const summary = {
    rootExited: true,
    pipeClosed: true,
    monitorJoined: true,
    probesJoined: true,
    outputsJoined: false,
    outputsSettled: true,
    outputHandlesClosed: false,
    cohortQuiet: true,
    observedProcesses: 1,
    phase: "denied",
    failureStage: "output-bound",
    rawError: "PRIVATE",
  };
  const copied = supervisorObservation(summary);
  assert.equal(copied.outputsJoined, false);
  assert.equal(copied.outputsSettled, true);
  assert.equal(copied.outputHandlesClosed, false);
  assert.equal(copied.failureStage, "output-bound");
  summary.outputsJoined = true;
  summary.outputsSettled = false;
  summary.outputHandlesClosed = true;
  assert.equal(copied.outputsJoined, false);
  assert.equal(copied.outputsSettled, true);
  assert.equal(copied.outputHandlesClosed, false);
  for (const key of ["outputsSettled", "outputHandlesClosed"])
    for (const value of [undefined, null, 0, "true"])
      assert.equal(
        supervisorObservation({ ...summary, [key]: value })[key],
        null,
      );
  for (const key of ["outputsSettled", "outputHandlesClosed"]) {
    const withGetter = Object.defineProperty({ ...summary }, key, {
      get() {
        getters++;
        throw Error("PRIVATE");
      },
    });
    assert.equal(supervisorObservation(withGetter)[key], null);
  }
  assert(Object.isFrozen(copied));
  assert(!JSON.stringify(copied).includes("PRIVATE"));
  assert.equal(
    supervisorObservation({
      ...summary,
      phase: "PRIVATE",
      failureStage: "PRIVATE",
    }).failureStage,
    "OTHER",
  );
  assert.equal(
    supervisorObservation({ ...summary, phase: "PRIVATE" }).phase,
    "UNKNOWN",
  );
  for (const value of [
    null,
    {},
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Error("PRIVATE");
        },
      },
    ),
    Object.defineProperty({ ...summary }, "outputsJoined", {
      get() {
        getters++;
        throw Error("PRIVATE");
      },
    }),
    { ...summary, observedProcesses: 4097 },
    { ...summary, rootExited: 1 },
  ])
    assert.equal(supervisorObservation(value), null);
  assert.equal(getters, 0);
});

// Invert only the direct-case delta before the previously qualified history.
const directCaseInverse = [
  {
    start: 82,
    remove: [
      '  "direct-natural-zero",',
      '  "direct-nonzero",',
      '  "direct-output-bound",',
    ],
    replace: [],
  },
  {
    start: 691,
    remove: [
      "const DIRECT_ROLES = Object.freeze({",
      '  "direct-natural-zero": "natural-zero",',
      '  "direct-nonzero": "nonzero",',
      '  "direct-output-bound": "output-bound",',
      "});",
      "function outputBoundCase(id) {",
      '  return id === "output-bound" || id === "direct-output-bound";',
      "}",
      "async function directActorHandshake(role, attempt, owned, end, pids) {",
      '  assert(Object.values(DIRECT_ROLES).includes(role), "PROOF_DIRECT_ROLE");',
      '  const names = ["claimed", role + ".json"];',
      '  if (role === "natural-zero") names.push("child-natural.json");',
      "  const handles = [],",
      "    witnesses = [];",
      "  let failed = false,",
      "    first,",
      "    active = true;",
      "  try {",
      "    const operation = (async () => {",
      "      await poll(async () => {",
      "        await owned.current();",
      "        await owned.directoryCurrent(attempt);",
      "        try {",
      "          for (const name of names) await fs.lstat(path.join(attempt, name));",
      "          return true;",
      "        } catch (error) {",
      '          if (error.code === "ENOENT") return false;',
      "          throw error;",
      "        }",
      "      }, end);",
      "      for (const name of names) {",
      "        check(end);",
      "        await owned.directoryCurrent(attempt);",
      "        const file = path.join(attempt, name);",
      '        assert.equal(await fs.realpath(file), file, "PROOF_DIRECT_ALIAS");',
      "        const before = await fs.lstat(file, { bigint: true });",
      "        assert(",
      "          ordinary(before) && before.size > 0n && before.size <= 4096n,",
      '          "PROOF_DIRECT_FILE",',
      "        );",
      "        const fd = await fs.open(",
      "          file,",
      "          constants.O_RDONLY | constants.O_NOFOLLOW,",
      "        );",
      "        if (!active) {",
      "          const closing = Promise.resolve().then(() => fd.close());",
      "          closing.catch(() => {});",
      '          throw Error("PROOF_DIRECT_EXPIRED");',
      "        }",
      "        handles.push(fd);",
      "        assert.equal(",
      "          full(await fd.stat({ bigint: true })),",
      "          full(before),",
      '          "PROOF_DIRECT_CHANGED",',
      "        );",
      "        const buffer = Buffer.alloc(4097);",
      "        const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);",
      '        assert(bytesRead === Number(before.size), "PROOF_DIRECT_FILE");',
      "        const raw = buffer.subarray(0, bytesRead);",
      "        witnesses.push({ file, fd, stamp: full(before), raw });",
      "      }",
      "      const current = async () => {",
      "        check(end);",
      "        await owned.current();",
      "        await owned.directoryCurrent(attempt);",
      "        for (const row of witnesses)",
      "          assert(",
      "            full(await row.fd.stat({ bigint: true })) === row.stamp &&",
      "              full(await fs.lstat(row.file, { bigint: true })) === row.stamp &&",
      "              (await fs.realpath(row.file)) === row.file,",
      '            "PROOF_DIRECT_CHANGED",',
      "          );",
      "        check(end);",
      "      };",
      "      await current();",
      "      const claim = witnesses[0].raw.toString();",
      '      assert(/^[1-9][0-9]{0,9}$/.test(claim), "PROOF_DIRECT_CLAIM");',
      "      const root = JSON.parse(witnesses[1].raw);",
      "      const actor = (value, parent) => {",
      "        assert(",
      "          value &&",
      '            Object.keys(value).sort().join(":") === "parent:pid" &&',
      "            Number.isSafeInteger(value.pid) &&",
      "            value.pid > 1 &&",
      "            value.parent === parent &&",
      "            !pids.has(value.pid),",
      '          "PROOF_DIRECT_LINEAGE",',
      "        );",
      "        pids.add(value.pid);",
      "      };",
      "      actor(root, process.pid);",
      '      assert.equal(root.pid, Number(claim), "PROOF_DIRECT_CLAIM");',
      '      if (role === "natural-zero")',
      "        actor(JSON.parse(witnesses[2].raw), root.pid);",
      '      if (role !== "output-bound") {',
      "        // Scheduling only: the actual supervisor must independently prove every",
      "        // join. This hold neither observes nor acknowledges its initial snapshot.",
      "        await delay(2000, end);",
      "        await current();",
      "        await fs.writeFile(",
      "          path.join(",
      "            attempt,",
      '            role === "natural-zero" ? "release-child" : "release-root",',
      "          ),",
      '          "release",',
      '          { flag: "wx", mode: 0o600 },',
      "        );",
      "        await current();",
      "      }",
      "    })();",
      "    operation.catch(() => {});",
      "    await within(() => operation, end);",
      "  } catch (error) {",
      "    failed = true;",
      "    first = error;",
      "  } finally {",
      "    active = false;",
      "    // Close owners are attached even when the original work end has expired.",
      "    const closing = Promise.allSettled(",
      "      handles.reverse().map((fd) => Promise.resolve().then(() => fd.close())),",
      "    );",
      "    try {",
      "      const results = await within(() => closing, end);",
      "      for (const result of results)",
      '        if (result.status === "rejected") throw result.reason;',
      "    } catch (error) {",
      "      if (!failed) {",
      "        failed = true;",
      "        first = error;",
      "      }",
      "    }",
      "  }",
      "  if (failed) throw first;",
      "}",
      "async function directCompile(core, exe, args, options, coordinate, joins, end) {",
      "  assert(",
      '    ["observeRoot", "out", "censusFactory"].every(',
      "      (key) => !Object.hasOwn(options, key),",
      "    ),",
      '    "PROOF_DIRECT_OPTIONS",',
      "  );",
      "  const work = Promise.resolve().then(() =>",
      "    core.compileSlice(exe, args, {",
      "      ...options,",
      "      outputLedger: { ...options.outputLedger },",
      "    }),",
      "  );",
      "  work.catch(() => {});",
      "  const handshake = Promise.resolve().then(coordinate);",
      "  handshake.catch(() => {});",
      "  joins.push(handshake);",
      "  const results = await within(",
      "    () => Promise.allSettled([work, handshake]),",
      "    end,",
      "  );",
      "  // A later fixture cleanup/coordinator error cannot replace the actual",
      "  // supervisor's original rejection, including a falsy reason.",
      '  if (results[0].status === "rejected") throw results[0].reason;',
      '  if (results[1].status === "rejected") throw results[1].reason;',
      "  return results[0].value;",
      "}",
      "",
    ],
    replace: [],
  },
  {
    start: 854,
    remove: ["  const direct = Object.hasOwn(DIRECT_ROLES, id);"],
    replace: [],
  },
  {
    start: 867,
    remove: [
      "  const naturalRole = direct",
      "    ? DIRECT_ROLES[id]",
      '    : ["reserve", "setup-clock", "late-postcheck", "delayed-close"].includes(id)',
      '      ? "natural-zero"',
      "      : id;",
    ],
    replace: [
      "  const naturalRole = [",
      '    "reserve",',
      '    "setup-clock",',
      '    "late-postcheck",',
      '    "delayed-close",',
      "  ].includes(id)",
      '    ? "natural-zero"',
      "    : id;",
    ],
  },
  {
    start: 926,
    remove: [
      "  // The original executed cases retain their supported creation observer.",
      "  // Direct cases instead coordinate fixed actors through owned files only.",
      '  const assisted = !direct && !["reserve", "setup-clock"].includes(id);',
    ],
    replace: [
      "  // Every native child gets the supported observer for creation ownership.",
      "  // This is explicitly observer-assisted, rather than exact production options.",
      '  const assisted = !["reserve", "setup-clock"].includes(id);',
    ],
  },
  {
    start: 931,
    remove: [
      "    fdJoins = [],",
      "    directJoins = [],",
      "    directPids = new Set();",
      "  let actorHandshakeJoined = null;",
    ],
    replace: ["    fdJoins = [];"],
  },
  {
    start: 1111,
    remove: [
      "      if (direct) {",
      "        const role = path.basename(options.logs);",
      "        assert(",
      '          ["source-gn-initial", "source-gn-revalidation"].includes(role),',
      '          "PROOF_DIRECT_ATTEMPT",',
      "        );",
      '        const attempt = attempts[role === "source-gn-initial" ? 0 : 1];',
      "        return directCompile(",
      "          core,",
      "          exe,",
      "          args,",
      "          options,",
      "          () =>",
      "            directActorHandshake(",
      "              naturalRole,",
      "              attempt,",
      "              owned,",
      "              Math.min(end, phaseEnd - 30000),",
      "              directPids,",
      "            ),",
      "          directJoins,",
      "          Math.min(end, phaseEnd),",
      "        );",
      "      }",
    ],
    replace: [],
  },
  {
    start: 1200,
    remove: [
      '      if (naturalRole === "natural-zero" && (id === "natural-zero" || direct)) {',
    ],
    replace: ['      if (id === "natural-zero") {'],
  },
  {
    start: 1235,
    remove: [
      "    if (direct) {",
      "      const results = await within(",
      "        () => Promise.allSettled(directJoins),",
      "        Math.min(end, phaseEnd),",
      "      );",
      "      actorHandshakeJoined =",
      "        results.length === spawned &&",
      '        results.every((result) => result.status === "fulfilled");',
      "    }",
    ],
    replace: [],
  },
  {
    start: 1250,
    remove: [
      "  if (direct)",
      "    assert(",
      "      actorHandshakeJoined === true && !observerEntered,",
      '      "PROOF_DIRECT_JOIN",',
      "    );",
      '  if (id === "natural-zero" || id === "direct-natural-zero")',
    ],
    replace: ['  if (id === "natural-zero")'],
  },
  {
    start: 1267,
    remove: [
      "      outputBoundCase(id) ? outputBoundClosed(summary) : joined(summary),",
    ],
    replace: [
      '      id === "output-bound" ? outputBoundClosed(summary) : joined(summary),',
    ],
  },
  {
    start: 1306,
    remove: ["  if (outputBoundCase(id))"],
    replace: ['  if (id === "output-bound")'],
  },
  {
    start: 1327,
    remove: [
      "  for (const pid of directPids)",
      "    assert(",
      "      !current.some((row) => row.pid === pid),",
      '      "PROOF_DIRECT_ACTOR_PRESENT",',
      "    );",
    ],
    replace: [],
  },
  {
    start: 1344,
    remove: [
      '    executionMode: direct ? "direct" : assisted ? "observer-assisted" : "idle",',
      "    actorHandshakeJoined,",
    ],
    replace: [],
  },
  {
    start: 1353,
    remove: ["    expectedOutputRejection: outputBoundCase(id),"],
    replace: ['    expectedOutputRejection: id === "output-bound",'],
  },
  {
    start: 1630,
    remove: [
      "        /^(case-(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|reserve|setup-clock|late-postcheck|delayed-close|direct-natural-zero|direct-nonzero|direct-output-bound|foreign-control)|logs|source-gn-(?:initial|revalidation)|checkpoint-compile\\.(?:stdout\\.log|stderr\\.log|outcome\\.json)|actor-environment\\.json|(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|child-natural|child-writer|child-pipe|child-hold|foreign)\\.json|counter|reparented|release-root|release-child|attempt-initial|attempt-revalidation|claimed)$/.test(",
    ],
    replace: [
      "        /^(case-(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|reserve|setup-clock|late-postcheck|delayed-close|foreign-control)|logs|source-gn-(?:initial|revalidation)|checkpoint-compile\\.(?:stdout\\.log|stderr\\.log|outcome\\.json)|actor-environment\\.json|(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|child-natural|child-writer|child-pipe|child-hold|foreign)\\.json|counter|reparented|release-root|release-child|attempt-initial|attempt-revalidation|claimed)$/.test(",
    ],
  },
  {
    start: 1774,
    remove: ['          "executionMode",', '          "actorHandshakeJoined",'],
    replace: [],
  },
  {
    start: 1793,
    remove: [
      "      direct = Object.hasOwn(DIRECT_ROLES, id),",
      '      positive = id === "natural-zero" || id === "direct-natural-zero";',
    ],
    replace: ['      positive = id === "natural-zero";'],
  },
  {
    start: 1823,
    remove: ["            (outputBoundCase(id)"],
    replace: ['            (id === "output-bound"'],
  },
  {
    start: 1834,
    remove: [
      "        row.observerAssisted === (!idle && !direct) &&",
      "        row.executionMode ===",
      '          (direct ? "direct" : idle ? "idle" : "observer-assisted") &&',
      "        row.actorHandshakeJoined === (direct ? true : null) &&",
    ],
    replace: ["        row.observerAssisted === !idle &&"],
  },
  {
    start: 1841,
    remove: [
      "          (idle ? null : outputBoundCase(id) ? false : true) &&",
      "        row.expectedOutputRejection === outputBoundCase(id) &&",
    ],
    replace: [
      '          (idle ? null : id === "output-bound" ? false : true) &&',
      '        row.expectedOutputRejection === (id === "output-bound") &&',
    ],
  },
];
function withoutRuntimeBudgetRetarget(source) {
  const current =
    '    RUNTIME,\n    76637,\n    "626a0c34481f18c5044be88c47ca72bf3312dfbe1a5858b69936b683a9bf3182",';
  const qualified =
    '    RUNTIME,\n    76412,\n    "8eaf57312438c26ed5bc8e58070bb685daf11aeaa83e06594cfb746c4d8b20fe",';
  assert.equal(source.split(current).length, 2);
  const restored = source.replace(current, qualified);
  assert.equal(Buffer.byteLength(restored), 67657);
  assert.equal(
    createHash("sha256").update(restored).digest("hex"),
    "60f4923ceea868fb18b7697b0b072649cfdf55583300444de4a62ef20f93cc46",
  );
  return restored;
}

test("runtime-budget pin retarget preserves the complete actually qualified b6ca fixture", () => {
  withoutRuntimeBudgetRetarget(fixture);
});

function withoutDirectCases(source) {
  source = withoutRuntimeBudgetRetarget(source);
  const lines = source.split("\n");
  for (const hunk of [...directCaseInverse].reverse()) {
    assert.deepEqual(
      lines.slice(hunk.start, hunk.start + hunk.remove.length),
      hunk.remove,
    );
    lines.splice(hunk.start, hunk.remove.length, ...hunk.replace);
  }
  return lines.join("\n");
}

test("direct-case inverse restores the complete qualified3df fixture before every prior inverse", () => {
  const original = withoutDirectCases(fixture);
  assert.equal(Buffer.byteLength(original), 60167);
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "4bf021d1de32dedaffa5cf143c5f6f3fb604aab6008b3bacbf164237f08e4398",
  );
});

// Exact inverse of this output-close integration, before the earlier diagnostic inverse.
const outputCloseInverse = [
  {
    start: 31,
    remove: [
      "    232441,",
      '    "fa669f8e3bae755bcac623cbb9c567665405d58fbb5ca3d2130331101005947f",',
    ],
    replace: [
      "    230823,",
      '    "8c40dbd4461582659f5f92f8f9b07c0aa68d1df5525aad68a6119fd4c4d3c0ec",',
    ],
  },
  {
    start: 641,
    remove: ['    "outputsSettled",', '    "outputHandlesClosed",'],
    replace: [],
  },
  {
    start: 663,
    remove: [
      '      "outputsSettled",',
      '      "outputHandlesClosed",',
      '      "cohortQuiet",',
      "    ].every((key) => value[key] === true)",
      "  );",
      "}",
      "",
      "function outputBoundClosed(value) {",
      "  return (",
      "    value !== null &&",
      '    value?.phase === "denied" &&',
      '    value.failureStage === "output-bound" &&',
      "    value.outputsJoined === false &&",
      "    [",
      '      "rootExited",',
      '      "pipeClosed",',
      '      "monitorJoined",',
      '      "probesJoined",',
      '      "outputsSettled",',
      '      "outputHandlesClosed",',
    ],
    replace: [],
  },
  {
    start: 1062,
    remove: [
      "    assert(",
      '      id === "output-bound" ? outputBoundClosed(summary) : joined(summary),',
      '      "PROOF_JOIN",',
      "    );",
    ],
    replace: ['    assert(joined(summary), "PROOF_JOIN");'],
  },
  {
    start: 1103,
    remove: [
      "    assert(",
      "      rejected &&",
      "        !fulfilled &&",
      '        assertionFailureCode(rejection) === "COMPILE_OUTPUT_BOUND" &&',
      "        outputBoundClosed(summary),",
      '      "PROOF_OUTPUT_STAGE",',
      "    );",
    ],
    replace: [
      '    assert(summary.failureStage === "output-bound", "PROOF_OUTPUT_STAGE");',
    ],
  },
  {
    start: 1141,
    remove: [
      "    supervisorObservation: supervisorObservation(summary),",
      '    expectedOutputRejection: id === "output-bound",',
    ],
    replace: [],
  },
  {
    start: 1565,
    remove: [
      '          "supervisorObservation",',
      '          "expectedOutputRejection",',
    ],
    replace: [],
  },
  {
    start: 1581,
    remove: [
      "    const observation = row.supervisorObservation;",
      "    const copiedObservation = supervisorObservation(observation);",
      "    assert(",
      "      idle",
      "        ? observation === null",
      "        : observation !== null &&",
      '            Object.keys(observation).sort().join(":") ===',
      "              [",
      '                "rootExited",',
      '                "pipeClosed",',
      '                "monitorJoined",',
      '                "probesJoined",',
      '                "outputsJoined",',
      '                "outputsSettled",',
      '                "outputHandlesClosed",',
      '                "cohortQuiet",',
      '                "observedProcesses",',
      '                "phase",',
      '                "failureStage",',
      "              ]",
      "                .sort()",
      '                .join(":") &&',
      "            copiedObservation !== null &&",
      '            ["complete", "denied"].includes(observation.phase) &&',
      "            copiedObservation.failureStage === observation.failureStage &&",
      "            (!positive ||",
      '              (observation.phase === "complete" &&',
      '                observation.failureStage === "none")) &&',
      '            (id === "output-bound"',
      "              ? outputBoundClosed(observation)",
      '              : observation.failureStage !== "output-bound" &&',
      "                joined(observation)),",
      '      "PROOF_CASE_JOINS",',
      "    );",
    ],
    replace: [],
  },
  {
    start: 1623,
    remove: [
      "        row.supervisorJoined ===",
      '          (idle ? null : id === "output-bound" ? false : true) &&',
      '        row.expectedOutputRejection === (id === "output-bound") &&',
    ],
    replace: ["        row.supervisorJoined === (idle ? null : true) &&"],
  },
  {
    start: 1708,
    remove: [
      '    for (const key of ["outputsSettled", "outputHandlesClosed"]) {',
      "      const observed = diagnosticOwn(value, key);",
      '      result[key] = typeof observed === "boolean" ? observed : null;',
      "    }",
    ],
    replace: [],
  },
  {
    start: 1723,
    remove: ['      "output-close",'],
    replace: [],
  },
];
function withoutOutputCloseIntegration(source) {
  const lines = source.split("\n");
  for (const hunk of [...outputCloseInverse].reverse()) {
    assert.deepEqual(
      lines.slice(hunk.start, hunk.start + hunk.remove.length),
      hunk.remove,
    );
    lines.splice(hunk.start, hunk.remove.length, ...hunk.replace);
  }
  return lines.join("\n");
}

test("output-close integration inverse restores the complete4662 fixture before diagnostic history", () => {
  const original = withoutOutputCloseIntegration(withoutDirectCases(fixture));
  assert.equal(Buffer.byteLength(original), 57732);
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "4662e1add9fd3390c1ddf2e215200974c2eb27c95ac1445df89c529c9025bb92",
  );
});

function withoutFailureDiagnostics(source) {
  for (const name of [
    "state",
    "capture",
    "projection",
    "reset",
    "cleanup state",
    "case reset",
    "existing sample",
    "containment",
    "containment result",
    "cleanup attempt",
    "cleanup completion",
  ]) {
    const start = "fixed failure diagnostic " + name;
    const expression = new RegExp(
      "^[ \\t]*// BEGIN " +
        start +
        "\\n[\\s\\S]*?^[ \\t]*// END " +
        start +
        "\\n",
      "gm",
    );
    assert.equal([...source.matchAll(expression)].length, 1, start);
    source = source.replace(expression, "");
    if (name === "projection")
      source = source.replace(
        "\n\nexport async function runProof",
        "\nexport async function runProof",
      );
  }
  const old = `    const code = failureCode(first),
      unsupported = code === "REPARENT_WITNESS_UNOBSERVED";
    last = freeze({
      kind: "linux-gn-benign-native-proof-failure",
      attemptId,
      complete: false,
      code,
      phase: firstPhase,
      activeCase,
      completedCases,
      incomplete: true,
      unsupported,
      ...FALSE_FLAGS,
    });
`;
  const expression =
    /^    \/\/ BEGIN fixed failure diagnostic envelope\n[\s\S]*?^    \/\/ END fixed failure diagnostic envelope\n/gm;
  assert.equal([...source.matchAll(expression)].length, 1);
  return source.replace(expression, old);
}

test("fixed diagnostics exact inverse preserves complete8b4 actors limits expected outcomes and source", () => {
  const original = withoutFailureDiagnostics(
    withoutOutputCloseIntegration(withoutDirectCases(fixture)),
  );
  assert.equal(Buffer.byteLength(original), 52966);
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "b3b4c1e842523a58139a2aaa21b5d0f13d737de21e20099574d449a7bdf3e93c",
  );
});

test("actual proof control preserves falsy primary and reports only observed cleanup completion", async () => {
  // Actual runProof body with ONLY the dynamic module load replaced by a
  // fixed nonminting model. No native process, Git, ps or actor runs here.
  const original = runProof.toString();
  const load = "core = await import(pathToFileURL(path.join(ROOT, CORE)));";
  assert.equal(original.split(load).length, 2);
  const body = original.replace(load, "core = modelCore;");
  const a = fixture.indexOf("function boundedFailureObservation("),
    b = fixture.indexOf("// END fixed failure diagnostic projection", a);
  assert(a > 0 && b > a);
  const bounded = fixture.slice(a, b);
  const project = vm.runInNewContext("(" + bounded + ")", {
    Buffer,
    supervisorObservation,
    freeze: (value) => Object.freeze(value),
  });
  const fallback = {
    kind: "fixed-failure",
    complete: false,
    code: "PROOF_FAILED",
  };
  const malformedFacts = Object.defineProperty({}, "attempted", {
    get() {
      throw Error("PRIVATE diagnostic failure");
    },
  });
  const safe = project(fallback, null, malformedFacts);
  assert.equal(
    safe,
    fallback,
    "projection failure retains original fixed envelope",
  );
  assert(Object.isFrozen(safe));
  assert(Buffer.byteLength(JSON.stringify(safe)) <= 4096);
  assert(!JSON.stringify(safe).includes("PRIVATE"));
  for (const primary of [false, 0, null, undefined, Error("PROOF_JOIN")])
    for (const cleanupFails of [false, true]) {
      const observed = [];
      let scope;
      const diagnostic =
        syntheticReport().cases[names.indexOf("output-bound")]
          .supervisorObservation;
      const bindings = {
        assert,
        randomUUID: () => "00000000-0000-4000-8000-000000000001",
        Map,
        Set,
        Promise,
        Buffer,
        performance,
        authority: () => ({}),
        process: {
          env: {},
          platform: "model",
          arch: "model",
          versions: { node: "model" },
        },
        originalEnd: () => performance.now() + 1000,
        sourceWitness: async () => ({
          contents: new Map([
            [".node-version", "model"],
            ["runtime", "model"],
          ]),
        }),
        kernelBlocks: () => {},
        RUNTIME: "runtime",
        modelCore: {},
        check: () => {},
        ownedRoot: async () => ({
          observers: new Set(),
          retire() {
            observed.push("retire");
          },
        }),
        foreignActor: async () => ({
          ready: async () => {},
          current: async () => {},
          stop: async () => {
            observed.push("foreign-stop");
          },
        }),
        CASES: ["output-bound"],
        modeledDiagnostic: diagnostic,
        caseRun: async () => {
          vm.runInContext("lastCaseDiagnostic=modeledDiagnostic", scope);
          throw primary;
        },
        within: async (work) => await work(),
        cleanup: async () => {
          observed.push("cleanup");
          if (cleanupFails) throw Error("PRIVATE cleanup");
        },
        assertionFailureCode,
        supervisorObservation,
        freeze: (value) => Object.freeze(value),
        FALSE_FLAGS: { productionReadinessIssued: false, runtimeReady: false },
        JSON,
      };
      scope = vm.createContext(bindings);
      const model = vm.runInNewContext(
        `let last=null,running=false,lastCaseDiagnostic=null;${bounded}\nconst run=${body};({run,observation:()=>last});`,
        scope,
      );
      let rejected = false,
        caught;
      try {
        await model.run();
      } catch (error) {
        rejected = true;
        caught = error;
      }
      assert.equal(rejected, true);
      assert.equal(caught, primary, "including falsy original throw");
      const observation = model.observation();
      assert.equal(
        observation.code,
        primary instanceof Error ? "ASSERT_JOIN" : "PROOF_FAILED",
      );
      assert.equal(observation.cleanupAttempted, true);
      assert.equal(observation.cleanupCompleted, !cleanupFails);
      assert.equal(observation.knownOwnedActorsRemaining, null);
      assert.equal(observation.supervisorObservation.outputsJoined, false);
      assert.equal(observation.supervisorObservation.outputsSettled, true);
      assert.equal(observation.supervisorObservation.outputHandlesClosed, true);
      assert(Object.isFrozen(observation.supervisorObservation));
      assert.equal(observation.extraContainmentUsed, false);
      assert.equal(observation.runtimeReady, false);
      assert(Buffer.byteLength(JSON.stringify(observation)) <= 4096);
      assert(!JSON.stringify(observation).includes("PRIVATE"));
      assert.deepEqual(observed, ["retire", "foreign-stop", "cleanup"]);
    }
});
