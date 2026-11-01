import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  assess,
  observe,
  ARGS,
  CAPTURE_BYTES,
  MAXIMUM_MS,
} from "./browserPrivateProxyFailureDiagnostic.mjs";
const name = "private_forward_proxy::tests::fixed_contract";
const output = `test ${name} ... FAILED\nthread 'private' panicked: SECRET_PANIC_VALUE /private/path\ntest result: FAILED. 204 passed; 1 failed; 0 ignored; 0 measured; 600 filtered out; finished in 1.00s\n`;
function child() {
  const value = new EventEmitter();
  Object.assign(value, {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref() {
      this.unreferenced = true;
    },
    kill() {
      assert.fail("process group helper owns the live group");
    },
  });
  return value;
}
function close(value, code = 101) {
  value.exitCode = code;
  value.stdout.destroy();
  value.stderr.destroy();
  value.emit("exit", code, null);
  setImmediate(() => value.emit("close", code, null));
}
test("diagnostic emits only strict failed Rust names and numeric summary, never panic values or paths", () => {
  const value = assess(output, 101);
  assert.equal(value.status, "observed");
  assert.equal(value.failed, 1);
  assert.equal(value.passed, 204);
  assert.deepEqual(value.failedTests, [name]);
  assert(!JSON.stringify(value).includes("SECRET"));
  assert(!JSON.stringify(value).includes("/private"));
});
test("missing, forged, duplicate and inconsistent failure names cannot become an observation", () => {
  for (const raw of [
    output.replace(name, "private_forward_proxy::/SECRET"),
    output.replace(name, "unrelated::SECRET"),
    output.replace("1 failed", "2 failed"),
    output + output,
    output.replace(`test ${name} ... FAILED\n`, ""),
    output.replace(`test ${name}`, `test ${name}\nSECRET`),
    output.replace("204 passed; 1 failed", "0 passed; 0 failed"),
  ]) {
    const value = assess(raw, 101);
    assert.equal(value.status, "incomplete");
    assert.deepEqual(value.failedTests, []);
    assert(!JSON.stringify(value).includes("SECRET"));
  }
  assert.equal(assess(output, 0).status, "incomplete");
  assert.equal(
    assess("test result: FAILED. 1 passed; 0 failed; 0 ignored;", 0).status,
    "incomplete",
  );
});
test("passed diagnostic remains a diagnostic and preserves ignored counts", () => {
  const value = assess(
    "test result: ok. 205 passed; 0 failed; 0 ignored; 0 measured;",
    0,
  );
  assert.equal(value.status, "observed");
  assert.equal(value.reason, "native-tests-passed");
  assert.deepEqual(value.failedTests, []);
  assert.equal(
    assess("test result: ok. 204 passed; 0 failed; 1 ignored;", 0).reason,
    "native-tests-ignored",
  );
});
test("one fixed native wrapper command captures stderr privately and joins both streams", async () => {
  let calls = 0;
  const value = child();
  const result = await observe({
    milliseconds: 1000,
    launch(file, args, options) {
      calls++;
      assert.equal(file, process.execPath);
      assert.deepEqual(args, [...ARGS]);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(options.detached, true);
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
      setImmediate(() => {
        value.stdout.write(output);
        value.stderr.write("SECRET_STDERR /private/path");
        close(value);
      });
      return value;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.cleanup, "joined");
  assert.deepEqual(result.failedTests, [name]);
  assert(!JSON.stringify(result).includes("SECRET"));
  assert.equal(MAXIMUM_MS, 30 * 60 * 1000);
});
test("combined 8MiB stdout/stderr cap stops only the still-owned live group and emits no raw output", async () => {
  const value = child();
  let kills = 0;
  const result = await observe({
    milliseconds: 1000,
    launch() {
      setImmediate(() => {
        value.stdout.write(Buffer.alloc(CAPTURE_BYTES / 2));
        value.stderr.write(Buffer.alloc(CAPTURE_BYTES / 2 + 1));
      });
      return value;
    },
    killGroup(pid) {
      assert.equal(pid, value.pid);
      kills++;
      close(value, null);
    },
  });
  assert.equal(kills, 1);
  assert.equal(result.reason, "capture-bound");
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.failedTests, []);
  assert.equal(result.cleanup, "joined");
});
test("deadline never signals a process group after its root exited and cannot claim unjoined cleanup", async () => {
  const value = child();
  let killed = 0;
  const result = await observe({
    milliseconds: 35,
    launch() {
      setImmediate(() => {
        value.exitCode = 0;
        value.emit("exit", 0, null);
      });
      return value;
    },
    killGroup() {
      killed++;
    },
  });
  assert.equal(killed, 0);
  assert.equal(result.reason, "deadline");
  assert.equal(result.cleanup, "unconfirmed");
  assert.equal(value.unreferenced, true);
});
test("pre-cancelled observation cannot launch cargo", async () => {
  const result = await observe({
    milliseconds: 100,
    onCancel(stop) {
      stop();
      return () => {};
    },
    launch() {
      assert.fail("cancelled observation must not launch");
    },
  });
  assert.equal(result.reason, "cancelled");
  assert.equal(result.status, "incomplete");
});

test("late close after an event-loop stall cannot beat the original deadline timer", async () => {
  const value = child();
  const result = await observe({
    milliseconds: 20,
    launch() {
      setImmediate(() => {
        const stalledUntil = performance.now() + 45;
        while (performance.now() < stalledUntil) {
          // Deliberately delay timers, then deliver the valid child-close order.
        }
        value.stdout.write(output);
        value.exitCode = 101;
        value.emit("exit", 101, null);
        value.stdout.emit("close");
        value.stderr.emit("close");
        value.emit("close", 101, null);
      });
      return value;
    },
    killGroup() {
      assert.fail("root has already exited before completion");
    },
  });
  assert.equal(result.cleanup, "joined");
  assert.equal(result.reason, "deadline");
  assert.equal(result.status, "incomplete");
  assert.equal(result.passed, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.failedTests, []);
});
test("workflow runs only after Linux readiness failure, retains one fixed nonhidden report and preserves original failure", async () => {
  const workflow = YAML.parse(
    await readFile(".github/workflows/ci.yml", "utf8"),
  );
  const job = workflow.jobs["browser-transport-contracts"];
  const original = job.steps.find((s) => s.id === "browser_readiness");
  assert.equal(original["continue-on-error"], undefined);
  const run = job.steps.find((s) =>
    s.run?.includes("browserPrivateProxyFailureDiagnostic.mjs"),
  );
  assert.equal(
    run.if,
    "failure() && runner.os == 'Linux' && steps.browser_readiness.outcome == 'failure'",
  );
  assert.equal(run["timeout-minutes"], 30);
  const upload = job.steps.find((s) =>
    s.with?.name?.startsWith("browser-private-proxy-diagnostic-"),
  );
  assert.equal(
    upload.with.path,
    "${{ runner.temp }}/browser-private-proxy-diagnostic.json",
  );
  assert.equal(
    upload.if,
    "always() && runner.os == 'Linux' && steps.browser_readiness.outcome == 'failure'",
  );
  const source = await readFile(
    "tests/tooling/browserPrivateProxyFailureDiagnostic.mjs",
    "utf8",
  );
  assert(!source.includes("console.error(error"));
  assert(!source.includes("console.log(stdout"));
});
