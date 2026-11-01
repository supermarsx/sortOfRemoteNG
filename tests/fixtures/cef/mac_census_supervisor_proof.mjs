// Actual tiny supervisor integration only. No source acquisition or admission.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAC_CENSUS_EVIDENCE,
  noLinks,
  compileSlice,
  createMacCensusIntegrationProofFactory,
  macCensusIntegrationStatus,
  pauseMacCensusIntegrationWorker,
  observedQuiet,
  removeQuiescentSisoLog,
  compileMonitorDetails,
} from "../../../scripts/lib/cef-engineering-checkpoint.mjs";
import { held } from "./mac_process_census_proof.mjs";

const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const HELPER = fileURLToPath(
  new URL("../../../scripts/lib/cef-mac-process-census.py", import.meta.url),
);
const TARGET = "x86_64-apple-darwin";
const SOURCE =
  "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef";
const ARM_TARGET = "aarch64-apple-darwin";
const ARM_SOURCE =
  "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54";
const CASES = Object.freeze([
  "normal",
  "slice-stop",
  "cancel",
  "reparent",
  "foreign",
  "worker-timeout",
]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function joinBy(promise, end) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("INTEGRATION_JOIN_DEADLINE")),
          Math.max(0, end - performance.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const rootStamp = (s) => [s.dev, s.ino, s.mode, s.uid].map(String).join(":");
export function integrationCaseNames() {
  return [...CASES];
}
async function ownedDirectory(root) {
  assert((await noLinks(root)) === root, "INTEGRATION_ROOT");
  const info = await fs.lstat(root, { bigint: true });
  assert(
    info.isDirectory() &&
      (info.mode & 0o777n) === 0o700n &&
      info.uid === BigInt(process.getuid()),
    "INTEGRATION_ROOT",
  );
  return info;
}
async function cleanupCase(root, identity) {
  assert(
    rootStamp(await ownedDirectory(root)) === rootStamp(identity),
    "INTEGRATION_ROOT",
  );
  const fixed = new Set([
    "start",
    "reparent-now",
    "normal.json",
    "slice-stop.json",
    "cancel.json",
    "reparent.json",
    "worker-timeout.json",
    "foreign.json",
    "launcher.json",
    "detached.json",
    "reparented.json",
  ]);
  for (const name of await fs.readdir(root)) {
    const file = path.join(root, name);
    if (name === "logs") {
      await noLinks(file);
      for (const leaf of await fs.readdir(file)) {
        assert(
          [
            "checkpoint-compile.stdout.log",
            "checkpoint-compile.stderr.log",
            "checkpoint-compile.outcome.json",
          ].includes(leaf),
          "INTEGRATION_CLEANUP",
        );
        const target = path.join(file, leaf);
        const s = await fs.lstat(target, { bigint: true });
        assert(
          s.isFile() &&
            !s.isSymbolicLink() &&
            s.nlink === 1n &&
            s.uid === identity.uid,
          "INTEGRATION_CLEANUP",
        );
        await fs.unlink(target);
      }
      await fs.rmdir(file);
    } else {
      assert(fixed.has(name), "INTEGRATION_CLEANUP");
      const s = await fs.lstat(file, { bigint: true });
      assert(
        s.isFile() &&
          !s.isSymbolicLink() &&
          s.nlink === 1n &&
          s.uid === identity.uid,
        "INTEGRATION_CLEANUP",
      );
      await fs.unlink(file);
    }
  }
  assert(
    rootStamp(await ownedDirectory(root)) === rootStamp(identity),
    "INTEGRATION_ROOT",
  );
  await fs.rmdir(root);
}
async function receipt(root, name, end) {
  while (performance.now() < end) {
    try {
      const value = JSON.parse(
        (await held(path.join(root, name + ".json"), 1024)).toString(),
      );
      return value;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await pause(10);
  }
  throw Error("INTEGRATION_RECEIPT");
}
function assertAbsent(pid) {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}
export async function runSupervisorProof(output) {
  assert(
    process.platform === "darwin" &&
      process.arch === "x64" &&
      process.env.ImageOS === "macos15" &&
      process.env.ImageVersion === "20260824.0482.1" &&
      process.env.RUNNER_ENVIRONMENT === "github-hosted",
    "INTEGRATION_HOST",
  );
  const temp = process.env.RUNNER_TEMP;
  assert(
    path.dirname(output) === temp &&
      /^cef-mac-census-supervisor-proof-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        path.basename(output),
      ),
    "INTEGRATION_ROOT",
  );
  const outputIdentity = await ownedDirectory(output);
  assert((await fs.readdir(output)).length === 0, "INTEGRATION_ROOT");
  const end = performance.now() + 160000;
  let aborted = false,
    activeAbort,
    failed = false,
    stage = "scope";
  const cancel = () => {
    aborted = true;
    activeAbort?.abort(Error("INTEGRATION_CANCEL"));
  };
  const alarm = setTimeout(cancel, 130000);
  process.on("SIGTERM", cancel);
  process.on("SIGINT", cancel);
  const roots = [],
    foreignActors = [];
  const report = {
    schemaVersion: 1,
    kind: "mac-census-supervisor-integration-proof",
    complete: false,
    productionAdmitted: false,
    productionInputWrites: false,
    nativeAcceptance: false,
    runtimeReady: false,
    hostPlatform: "darwin",
    hostArchitecture: "x86_64",
    image: "20260824.0482.1",
    evidence: MAC_CENSUS_EVIDENCE.sha256,
    requestDeadlineMs: 2000,
    cadenceMs: 250,
    maximumRequests: 43328,
    originalLeaseMs: 160000,
    cases: [],
    cleanupConfirmed: false,
  };
  try {
    for (const name of CASES) {
      stage = name;
      assert(
        !aborted && performance.now() < end - 30000,
        "INTEGRATION_DEADLINE",
      );
      const root = path.join(
        temp,
        "cef-mac-census-integration-" + randomUUID(),
      );
      await fs.mkdir(root, { mode: 0o700 });
      const identity = await ownedDirectory(root);
      roots.push({ root, identity, cleaned: false });
      const logs = path.join(root, "logs");
      await fs.mkdir(logs, { mode: 0o700 });
      const target = name === "foreign" ? ARM_TARGET : TARGET;
      const source = name === "foreign" ? ARM_SOURCE : SOURCE;
      const factory = await createMacCensusIntegrationProofFactory({
        target,
        source,
        canonicalRoot: `/Users/runner/work/_temp/sorng-cef-engineering/${target}/${source}`,
        scratch: root,
        python: PYTHON,
        deadline: Math.min(end, performance.now() + 40000),
      });
      const env = {
        PATH: "/usr/bin:/bin",
        RUNNER_TEMP: temp,
        ImageOS: "macos15",
        ImageVersion: "20260824.0482.1",
        RUNNER_ENVIRONMENT: "github-hosted",
        LC_ALL: "C",
        TZ: "UTC",
      };
      if (process.env.RUNNER_TRACKING_ID)
        env.RUNNER_TRACKING_ID = process.env.RUNNER_TRACKING_ID;
      const controller = new AbortController();
      activeAbort = controller;
      let rootIdentity,
        control,
        foreign,
        foreignClose,
        expectedFailure = false,
        pauseStarted;
      if (name === "foreign") {
        foreign = spawn(
          PYTHON,
          ["-I", "-B", "-S", HELPER, "--integration-actor", root, "foreign"],
          { cwd: root, env, stdio: ["ignore", "ignore", "ignore"] },
        );
        foreignClose = new Promise((resolve, reject) => {
          foreign.once("error", reject);
          foreign.once("close", resolve);
        });
        foreignClose.catch(() => {});
        foreignActors.push({ child: foreign, closed: foreignClose });
        const record = await Promise.race([
          receipt(
            root,
            "foreign",
            Math.min(end - 30000, performance.now() + 2000),
          ),
          foreignClose.then(() => {
            throw Error("INTEGRATION_FOREIGN_EXIT");
          }),
        ]);
        assert(
          record.pid === foreign.pid && record.parent === process.pid,
          "INTEGRATION_FOREIGN",
        );
      }
      let result, primary;
      try {
        const milliseconds =
          name === "reparent" ? 4500 : name === "worker-timeout" ? 5000 : 1500;
        assert(
          !aborted && performance.now() + milliseconds + 30000 < end,
          "INTEGRATION_DEADLINE",
        );
        result = await compileSlice(
          PYTHON,
          [
            "-I",
            "-B",
            "-S",
            HELPER,
            "--integration-actor",
            root,
            name === "foreign" ? "slice-stop" : name,
          ],
          {
            cwd: root,
            env,
            logs,
            milliseconds,
            censusFactory: factory,
            stopSignal: controller.signal,
            outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 },
            async observeRoot(value, owned) {
              rootIdentity = value;
              control = owned;
              assert(!aborted && !owned.signal.aborted, "INTEGRATION_CANCEL");
              await fs.writeFile(path.join(root, "start"), "start\n", {
                flag: "wx",
                mode: 0o600,
              });
              if (name === "cancel")
                controller.abort(Error("INTEGRATION_EXPECTED_CANCEL"));
              if (name === "worker-timeout") {
                pauseStarted = performance.now();
                pauseMacCensusIntegrationWorker(factory);
              }
              if (name === "reparent") {
                await receipt(
                  root,
                  "detached",
                  Math.min(end - 30000, performance.now() + 2000),
                );
                await pause(1000);
                assert(!aborted && !owned.signal.aborted, "INTEGRATION_CANCEL");
                await fs.writeFile(
                  path.join(root, "reparent-now"),
                  "reparent\n",
                  { flag: "wx", mode: 0o600 },
                );
                const changed = await receipt(
                  root,
                  "reparented",
                  Math.min(end - 30000, performance.now() + 1000),
                );
                assert(changed.confirmed === true, "INTEGRATION_REPARENT");
              }
            },
          },
        );
      } catch (error) {
        primary = error;
        expectedFailure = name === "cancel" || name === "worker-timeout";
        if (!expectedFailure) throw error;
      }
      assert(rootIdentity && control.rootExited(), "INTEGRATION_ROOT_JOIN");
      assertAbsent(rootIdentity.pid);
      const status = macCensusIntegrationStatus(factory);
      assert(status.workerJoined && !status.active, "INTEGRATION_WORKER_JOIN");
      let reparentRetained = null,
        foreignUntouched = null,
        proofMutationDenied = false,
        laterSessionJoined = null,
        poisonedFactoryRetryDenied = null,
        terminalCode = "NONE";
      if (expectedFailure) {
        assert(primary && !result, "INTEGRATION_FAILURE");
        if (name === "cancel") {
          assert.equal(primary.message, "INTEGRATION_EXPECTED_CANCEL");
          terminalCode = "CANCELLED";
        } else {
          assert.equal(compileMonitorDetails(primary).code, "CENSUS_DEADLINE");
          terminalCode = "CENSUS_DEADLINE";
          assert(
            status.poisoned && pauseStarted !== undefined,
            "INTEGRATION_FAILURE",
          );
          assert(
            performance.now() - pauseStarted >= 1900 &&
              performance.now() - pauseStarted < 10000,
            "INTEGRATION_REQUEST_DEADLINE",
          );
          await assert.rejects(
            observedQuiet(
              [{ pid: rootIdentity.pid, start: rootIdentity.start }],
              rootIdentity.pid,
              { censusFactory: factory },
            ),
            /CENSUS_CAPABILITY/,
          );
          poisonedFactoryRetryDenied = true;
        }
        try {
          const outcome = JSON.parse(
            (
              await held(
                path.join(logs, "checkpoint-compile.outcome.json"),
                4096,
              )
            ).toString(),
          );
          assert(
            outcome.checkpointAllowed === false,
            "INTEGRATION_FAILURE_RECEIPT",
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        proofMutationDenied = true;
      } else {
        assert(
          result.quiescent &&
            result.observed.every((x) =>
              /^darwin-v1:[1-9][0-9]{0,11}:(?:0|[1-9][0-9]{0,5})$/.test(
                x.start,
              ),
            ),
          "INTEGRATION_GRAMMAR",
        );
        assert(
          result.outcome ===
            (name === "normal" ? "compiler-complete" : "slice-ended"),
          "INTEGRATION_OUTCOME",
        );
        await assert.rejects(
          removeQuiescentSisoLog("/never-written-by-proof", result),
          /Genuine in-process compile result required/,
        );
        proofMutationDenied = true;
        if (name === "normal") {
          assert(
            await observedQuiet(result.observed, result.groupId, {
              censusFactory: factory,
            }),
            "INTEGRATION_READONLY",
          );
          const after = macCensusIntegrationStatus(factory);
          assert(
            after.sessions === 2 &&
              after.joinedSessions === 2 &&
              after.workerJoined,
            "INTEGRATION_READONLY",
          );
          laterSessionJoined = true;
        }
        if (name === "reparent") {
          for (const role of ["launcher", "detached"]) {
            const record = await receipt(root, role, end - 30000);
            assert(
              result.observed.some((x) => x.pid === record.pid),
              "INTEGRATION_REPARENT",
            );
            assertAbsent(record.pid);
          }
          reparentRetained = true;
        }
      }
      if (foreign) {
        assert(
          foreign.exitCode === null &&
            foreign.signalCode === null &&
            !result.observed.some((x) => x.pid === foreign.pid),
          "INTEGRATION_FOREIGN",
        );
        foreignUntouched = true;
        foreign.kill("SIGTERM");
        await joinBy(foreignClose, end);
        assertAbsent(foreign.pid);
      }
      report.cases.push({
        name,
        target,
        complete: true,
        expectedDenial: expectedFailure,
        helperJoined: true,
        rootJoined: true,
        uniformMicrosecondIdentity: rootIdentity.start.startsWith("darwin-v1:"),
        reparentRetained,
        foreignUntouched,
        proofMutationDenied,
        laterSessionJoined,
        poisonedFactoryRetryDenied,
        terminalCode,
      });
      await cleanupCase(root, identity);
      roots.at(-1).cleaned = true;
      activeAbort = null;
    }
    assert(!aborted && performance.now() < end, "INTEGRATION_DEADLINE");
    report.cleanupConfirmed = roots.every((x) => x.cleaned);
    report.complete = report.cleanupConfirmed;
  } catch (error) {
    failed = true;
    report.failure = stage;
    const diagnostic = compileMonitorDetails(error).code;
    const allowed = new Set([
      "CENSUS_HOST",
      "CENSUS_ROOT",
      "CENSUS_TOOL_PIN",
      "CENSUS_UNADMITTED",
      "CENSUS_DEADLINE",
      "CENSUS_CAPABILITY",
      "CENSUS_READY_DEADLINE",
      "CENSUS_EOF",
      "CENSUS_OUTPUT_BOUND",
    ]);
    report.failureCode = allowed.has(diagnostic)
      ? diagnostic
      : allowed.has(error?.message)
        ? error.message
        : "INTEGRATION_DENIED";
    report.cleanupConfirmed = false;
  } finally {
    for (const owned of foreignActors) {
      if (owned.child.exitCode === null && owned.child.signalCode === null)
        owned.child.kill("SIGKILL");
      try {
        await joinBy(owned.closed, end);
      } catch {
        owned.child.unref();
        failed = true;
        report.complete = false;
        report.cleanupConfirmed = false;
        report.failure ??= "foreign-cleanup";
      }
    }
    clearTimeout(alarm);
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
    assert(
      rootStamp(await ownedDirectory(output)) === rootStamp(outputIdentity),
      "INTEGRATION_ROOT",
    );
    const raw = JSON.stringify(report, null, 2) + "\n";
    assert(Buffer.byteLength(raw) <= 128 * 1024, "INTEGRATION_REPORT");
    await fs.writeFile(path.join(output, "proof.json"), raw, {
      flag: "wx",
      mode: 0o600,
    });
  }
  assert(!failed && report.complete, "INTEGRATION_FAILED");
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert(
      process.argv.length === 4 && process.argv[2] === "--output",
      "INTEGRATION_ARGUMENTS",
    );
    await runSupervisorProof(process.argv[3]);
    console.log("MAC_CENSUS_SUPERVISOR_PROOF_COMPLETE");
  } catch {
    console.error("MAC_CENSUS_SUPERVISOR_PROOF_FAILED");
    process.exitCode = 1;
  }
}
