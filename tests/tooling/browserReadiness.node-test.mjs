import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import {
  assessNative,
  assessVitest,
  NATIVE_SUITES,
  LIVE_GOOGLE_PROBE,
  nativeArgs,
  parseArgs,
  runReadiness,
  SUITES,
} from "../../scripts/browser-readiness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
function receipt() {
  return {
    success: true,
    numTotalTests: SUITES.length,
    numPassedTests: SUITES.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    testResults: SUITES.map(({ file }) => ({
      name: path.join(root, file),
      status: "passed",
      assertionResults: [{ status: "passed" }],
    })),
  };
}

test("CLI accepts only explicit native/report/help options and does not echo unknown input", () => {
  assert.deepEqual(parseArgs([]), { native: false, report: null, help: false });
  assert.deepEqual(
    parseArgs(["--native", "--report", "reports/readiness.json"]),
    {
      native: true,
      report: "reports/readiness.json",
      help: false,
    },
  );
  for (const args of [
    ["--native", "--native"],
    ["--report"],
    ["--report", "--native"],
    ["--live"],
    ["account@example.test"],
  ]) {
    assert.throws(
      () => parseArgs(args),
      (error) => !error.message.includes("account@example.test"),
    );
  }
});

test("requires every selected suite and passing tests; aggregate success alone is insufficient", () => {
  assert.equal(assessVitest(receipt(), 0).status, "passed");
  assert.equal(assessVitest(receipt(), 1).status, "failed");
  for (const mutate of [
    (r) => r.testResults.pop(),
    (r) => r.testResults.push(r.testResults[0]),
    (r) => r.testResults[0].assertionResults.splice(0),
    (r) => {
      r.testResults[0].assertionResults[0].status = "skipped";
    },
    (r) => {
      r.testResults[0].assertionResults[0].status = "todo";
    },
    (r) => {
      r.testResults[0].status = "failed";
    },
    (r) => {
      r.testResults[0].name = path.join(root, "unrelated.test.ts");
    },
    (r) => {
      r.numTotalTests = 0;
    },
    (r) => {
      r.numPendingTestSuites = 1;
    },
    (r) => {
      r.success = false;
    },
  ]) {
    const data = receipt();
    mutate(data);
    assert.equal(assessVitest(data, 0).status, "failed");
  }
  for (const data of [undefined, null, {}, { success: true, testResults: [] }])
    assert.equal(assessVitest(data, 0).status, "failed");
});

test("native receipt requires executed tests, zero failures/ignored tests, and successful exit", () => {
  const stdout =
    "test result: ok. 25 passed; 0 failed; 0 ignored; 0 measured; 699 filtered out; finished in 0.60s";
  assert.equal(assessNative({ stdout, exitCode: 0 }).status, "passed");
  for (const output of [
    "",
    stdout.replace("25 passed", "0 passed"),
    stdout.replace("0 ignored", "1 ignored"),
    stdout + "\n" + stdout,
  ])
    assert.equal(
      assessNative({ stdout: output, exitCode: 0 }).status,
      "failed",
    );
  assert.equal(assessNative({ stdout, exitCode: 1 }).status, "failed");
  assert.equal(
    assessNative({
      stdout: "",
      exitCode: null,
      reason: "executable-unavailable",
    }).status,
    "not-run",
  );
});

test("fixed fixture selection covers staged assets, lifecycle, all three sites, identity and dark readiness", async () => {
  for (const area of [
    "google",
    "cloudflare",
    "porkbun",
    "network",
    "identity",
    "dark-mode",
    "injection",
    "readiness",
  ])
    assert.ok(SUITES.some((suite) => suite.area === area));
  for (const name of [
    "autologinAsset.test.ts",
    "autologinScopedAsset.test.ts",
    "autologinClientLifecycle.test.ts",
  ])
    assert.ok(SUITES.some((suite) => suite.file.endsWith(name)));
  assert.equal(new Set(SUITES.map((suite) => suite.file)).size, SUITES.length);
  for (const { file } of SUITES)
    assert.ok((await readFile(path.join(root, file))).length > 0);
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(
    pkg.scripts["browser:readiness"],
    "node ./scripts/browser-readiness.mjs",
  );
});

test("missing prerequisite produces not-run and a failing automated gate without executing children", async () => {
  const report = await runReadiness(
    {},
    {
      isFile: () => false,
      execute: () => assert.fail("Missing dependencies must not execute"),
    },
  );
  assert.equal(report.deterministic.status, "not-run");
  assert.equal(report.automatedGate.status, "failed");
  assert.equal(report.native.status, "not-run");
  assert.equal(report.loginReadiness, "not-run");
});

test("executes selected fixtures and optional exact native command, never promotes live stages or copies secrets", async () => {
  const calls = [];
  const secret = "account@example.test Bearer fixture-private-token";
  const execute = async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (args[0] === "scripts/native-build-env.mjs")
      return {
        exitCode: 0,
        stdout: `${secret}\ntest result: ok. 25 passed; 0 failed; 0 ignored;`,
      };
    const data = receipt();
    data.testResults[0].message = secret;
    data.testResults[0].assertionResults[0].title = secret;
    await writeFile(
      args
        .find((arg) => arg.startsWith("--outputFile="))
        .slice("--outputFile=".length),
      JSON.stringify(data),
    );
    return { exitCode: 0, stdout: secret };
  };
  for (const native of [false, true]) {
    calls.length = 0;
    const report = await runReadiness({ native }, { execute });
    assert.equal(report.automatedGate.status, "passed");
    assert.equal(report.native.status, native ? "passed" : "not-run");
    assert.equal(calls.length, native ? 1 + NATIVE_SUITES.length : 1);
    assert.equal(calls[0].command, process.execPath);
    assert.ok(calls[0].args.includes("--reporter=json"));
    assert.ok(SUITES.every(({ file }) => calls[0].args.includes(file)));
    if (native) {
      assert.deepEqual(
        calls.slice(1),
        NATIVE_SUITES.map((id) => ({
          command: process.execPath,
          args: nativeArgs(id),
          cwd: root,
        })),
      );
      assert.ok(
        report.native.suites.every(
          (suite) =>
            suite.status === "passed" &&
            suite.passed > 0 &&
            suite.ignored === 0 &&
            suite.durationMs >= 0,
        ),
      );
    }
    assert.equal(report.native.liveGoogleProbe.status, "not-run");
    assert.equal(report.native.liveGoogleProbe.test, LIVE_GOOGLE_PROBE);
    assert.ok(report.deterministic.durationMs >= 0);
    assert.equal(report.loginReadiness, "not-run");
    assert.equal(report.embeddedLive.status, "not-run");
    assert.equal(report.embeddedLive.browserPrerequisite.status, "not-run");
    assert.ok(
      report.embeddedLive.sites.every((site) =>
        site.stages.every((stage) => stage.status === "not-run"),
      ),
    );
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});

test("native suite selection explicitly excludes live Google and has no feature or target override", () => {
  assert.deepEqual(NATIVE_SUITES, [
    "cloudflare_challenge",
    "google_tests",
    "autologin_asset",
    "dark_mode::tests",
    "origin_browser",
    "private_forward_proxy",
    "private_forward_route",
    "browser_transport",
    "browser_dns",
  ]);
  for (const id of NATIVE_SUITES) {
    const args = nativeArgs(id);
    assert.ok(args.includes("--locked"));
    assert.ok(!args.includes("--ignored"));
    assert.ok(!args.includes("--features"));
    assert.ok(!args.includes("--target"));
  }
  assert.deepEqual(nativeArgs("google_tests").slice(-3), [
    "--",
    "--skip",
    LIVE_GOOGLE_PROBE,
  ]);
  assert.throws(() => nativeArgs("all"));
});

test("each native suite must execute tests and native failure does not erase other receipts", async () => {
  const report = await runReadiness(
    { native: true },
    {
      execute: async (_command, args) => {
        if (args[0] !== "scripts/native-build-env.mjs") {
          await writeFile(
            args
              .find((arg) => arg.startsWith("--outputFile="))
              .slice("--outputFile=".length),
            JSON.stringify(receipt()),
          );
          return { exitCode: 0, stdout: "" };
        }
        return {
          exitCode: 0,
          stdout: `test result: ok. ${args.includes("autologin_asset") ? 0 : 25} passed; 0 failed; 0 ignored;`,
        };
      },
    },
  );
  assert.equal(report.deterministic.status, "passed");
  assert.deepEqual(
    report.native.suites.map((suite) => suite.status),
    NATIVE_SUITES.map((id) => (id === "autologin_asset" ? "failed" : "passed")),
  );
  assert.equal(report.native.status, "failed");
  assert.equal(report.automatedGate.status, "failed");
});

test("a command exiting zero without a valid receipt is a failure", async () => {
  const report = await runReadiness(
    {},
    { execute: async () => ({ exitCode: 0, stdout: "Tests passed" }) },
  );
  assert.equal(report.automatedGate.status, "failed");
});

test("CLI help is inert and invalid input fails without leaking its value", async () => {
  const exec = promisify(execFile);
  const runner = path.join(root, "scripts/browser-readiness.mjs");
  const help = await exec(process.execPath, [runner, "--help"]);
  assert.match(help.stdout, /NOT a live-login readiness result/);
  await assert.rejects(
    exec(process.execPath, [runner, "account@example.test"]),
    (error) => {
      assert.equal(error.code, 2);
      assert.ok(!error.stdout.includes("account@example.test"));
      assert.ok(!error.stderr.includes("account@example.test"));
      return true;
    },
  );
});
