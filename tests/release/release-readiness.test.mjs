import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  classifyWorkflowReadiness,
  fetchWorkflowRuns,
  parseArgs,
  REQUIRED_RELEASE_WORKFLOWS,
  waitForWorkflowReadiness,
} from "../../scripts/ci/wait-for-release-readiness.mjs";

const SOURCE = "a".repeat(40);
const OTHER_SOURCE = "b".repeat(40);
const WORKFLOW_PATHS = new Map(
  REQUIRED_RELEASE_WORKFLOWS.map((requirement) => [
    requirement.name,
    requirement.path,
  ]),
);
const readyFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/workflow-runs-ready.json", import.meta.url),
    "utf8",
  ),
).workflow_runs;
const wrongPathFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/workflow-runs-wrong-path.json", import.meta.url),
    "utf8",
  ),
).workflow_runs;

function run(name, overrides = {}) {
  return {
    id: 1,
    name,
    path: WORKFLOW_PATHS.get(name) ?? ".github/workflows/test-only.yml",
    head_sha: SOURCE,
    event: "push",
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

test("accepts exact-source push gates without waiting on the release workflow itself", () => {
  const result = classifyWorkflowReadiness(readyFixture, {
    sourceSha: SOURCE.toUpperCase(),
  });
  assert.equal(result.state, "ready");
  assert.equal(result.ready.length, REQUIRED_RELEASE_WORKFLOWS.length);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.failed, []);
});

test("does not accept wrong-SHA, dispatch, or similarly named runs", () => {
  const result = classifyWorkflowReadiness(
    [
      run("Audit", { head_sha: OTHER_SOURCE }),
      run("Audit", { event: "workflow_dispatch" }),
      run("Audit release"),
    ],
    { sourceSha: SOURCE, requiredWorkflows: ["Audit"] },
  );
  assert.equal(result.state, "pending");
  assert.match(result.pending[0].reason, /no exact-SHA push run/);
});

test("rejects a same-name exact-SHA run from the wrong workflow path", () => {
  const result = classifyWorkflowReadiness(wrongPathFixture, {
    sourceSha: SOURCE,
    requiredWorkflows: ["Audit"],
  });
  assert.equal(result.state, "failed");
  assert.match(
    result.failed[0].reason,
    /impostor\.yml.*expected \.github\/workflows\/audit\.yml/,
  );
});

test("reports active or missing workflows as pending", () => {
  const result = classifyWorkflowReadiness(
    [run("Audit", { status: "in_progress", conclusion: null })],
    { sourceSha: SOURCE, requiredWorkflows: ["Audit", "Backend Coverage"] },
  );
  assert.equal(result.state, "pending");
  assert.equal(result.pending.length, 2);
});

test("every supported active state keeps an older success pending", () => {
  for (const status of [
    "queued",
    "in_progress",
    "requested",
    "waiting",
    "pending",
  ]) {
    const result = classifyWorkflowReadiness(
      [
        run("Audit", { id: 10 }),
        run("Audit", { id: 11, status, conclusion: null }),
      ],
      { sourceSha: SOURCE, requiredWorkflows: ["Audit"] },
    );
    assert.equal(result.state, "pending", status);
    assert.match(result.pending[0].reason, new RegExp(status));
  }
});

test("fails closed for a terminal non-success with no active retry", () => {
  const result = classifyWorkflowReadiness(
    [run("Audit", { conclusion: "cancelled" })],
    { sourceSha: SOURCE, requiredWorkflows: ["Audit"] },
  );
  assert.equal(result.state, "failed");
  assert.match(result.failed[0].reason, /cancelled/);
});

test("fails closed for malformed exact-SHA workflow state", () => {
  const result = classifyWorkflowReadiness(
    [run("Audit", { conclusion: null })],
    { sourceSha: SOURCE, requiredWorkflows: ["Audit"] },
  );
  assert.equal(result.state, "failed");
  assert.match(result.failed[0].reason, /malformed workflow-run state/);
});

test("a successful exact-SHA run satisfies readiness despite an older failure", () => {
  const result = classifyWorkflowReadiness(
    [run("Audit", { id: 1, conclusion: "failure" }), run("Audit", { id: 2 })],
    { sourceSha: SOURCE, requiredWorkflows: ["Audit"] },
  );
  assert.equal(result.state, "ready");
});

test("the newest completed invocation overrides an older success", () => {
  const result = classifyWorkflowReadiness(
    [run("Audit", { id: 1 }), run("Audit", { id: 2, conclusion: "failure" })],
    { sourceSha: SOURCE, requiredWorkflows: ["Audit"] },
  );
  assert.equal(result.state, "failed");
  assert.match(result.failed[0].reason, /run 2: completed\/failure/);
});

test("run attempt breaks ties when GitHub returns duplicate run records", () => {
  const result = classifyWorkflowReadiness(
    [
      run("Audit", { id: 7, run_attempt: 1 }),
      run("Audit", { id: 7, run_attempt: 2, conclusion: "failure" }),
    ],
    { sourceSha: SOURCE, requiredWorkflows: ["Audit"] },
  );
  assert.equal(result.state, "failed");
});

test("polls deterministically until every required workflow succeeds", async () => {
  let clock = 0;
  let loads = 0;
  const result = await waitForWorkflowReadiness({
    loadRuns: async () => {
      loads += 1;
      return loads === 1
        ? [run("Audit", { status: "queued", conclusion: null })]
        : [run("Audit")];
    },
    sourceSha: SOURCE,
    requiredWorkflows: ["Audit"],
    timeoutMs: 20,
    pollMs: 5,
    now: () => clock,
    sleep: async (duration) => {
      clock += duration;
    },
  });
  assert.equal(result.state, "ready");
  assert.equal(loads, 2);
  assert.equal(clock, 5);
});

test("stops at the bounded timeout when required runs never appear", async () => {
  let clock = 0;
  let loads = 0;
  await assert.rejects(
    waitForWorkflowReadiness({
      loadRuns: async () => {
        loads += 1;
        return [];
      },
      sourceSha: SOURCE,
      requiredWorkflows: ["Audit"],
      timeoutMs: 10,
      pollMs: 6,
      now: () => clock,
      sleep: async (duration) => {
        clock += duration;
      },
    }),
    /Timed out.*no exact-SHA push run/,
  );
  assert.equal(clock, 10);
  assert.equal(loads, 3);
});

test("terminal failures abort without another poll", async () => {
  let sleeps = 0;
  await assert.rejects(
    waitForWorkflowReadiness({
      loadRuns: async () => [run("Audit", { conclusion: "failure" })],
      sourceSha: SOURCE,
      requiredWorkflows: ["Audit"],
      timeoutMs: 10,
      pollMs: 1,
      sleep: async () => {
        sleeps += 1;
      },
    }),
    /Required workflow failed/,
  );
  assert.equal(sleeps, 0);
});

test("queries GitHub for exact-SHA push runs without exposing the token", async () => {
  let requestedUrl;
  let requestedOptions;
  const runs = await fetchWorkflowRuns({
    apiUrl: "https://github.test/api/v3",
    repo: "owner/repo",
    sourceSha: SOURCE,
    token: "secret-token",
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      };
    },
  });
  assert.deepEqual(runs, []);
  assert.equal(requestedUrl.searchParams.get("head_sha"), SOURCE);
  assert.equal(requestedUrl.searchParams.get("event"), "push");
  assert.equal(requestedUrl.pathname, "/api/v3/repos/owner/repo/actions/runs");
  assert.equal(requestedOptions.headers.Authorization, "Bearer secret-token");
  assert.ok(requestedOptions.signal instanceof AbortSignal);
  assert.doesNotMatch(String(requestedUrl), /secret-token/);
});

test("fixture CLI emits stable GitHub outputs without network access", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "sorng-readiness-"));
  const outputPath = path.join(temp, "github-output.txt");
  const scriptPath = fileURLToPath(
    new URL("../../scripts/ci/wait-for-release-readiness.mjs", import.meta.url),
  );
  const fixturePath = fileURLToPath(
    new URL("./fixtures/workflow-runs-ready.json", import.meta.url),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        "owner/repo",
        "--source-sha",
        SOURCE,
        "--runs-file",
        fixturePath,
        "--github-output",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Readiness poll 1: ready/);
    assert.equal(
      readFileSync(outputPath, "utf8"),
      `ready=true\nsource_sha=${SOURCE}\n`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("parses bounded readiness CLI options and repeatable workflow names", () => {
  assert.deepEqual(
    parseArgs([
      "--repo=owner/repo",
      `--source-sha=${SOURCE}`,
      "--timeout-seconds=90",
      "--poll-seconds",
      "3",
      "--required-workflow=Audit=.github/workflows/audit.yml",
      "--required-workflow",
      "Docker e2e (nightly)=.github/workflows/e2e.yml",
      "--github-output=output.txt",
    ]),
    {
      apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
      githubOutput: "output.txt",
      pollSeconds: 3,
      repo: "owner/repo",
      requiredWorkflows: [
        { name: "Audit", path: ".github/workflows/audit.yml" },
        {
          name: "Docker e2e (nightly)",
          path: ".github/workflows/e2e.yml",
        },
      ],
      runsFile: null,
      sourceSha: SOURCE,
      timeoutSeconds: 90,
    },
  );
});

test("default readiness budget covers the required sixty-minute Docker gate", () => {
  assert.equal(parseArgs([]).timeoutSeconds, 90 * 60);
});

test("workflow overrides cannot omit exact path binding", () => {
  assert.throws(
    () => parseArgs(["--required-workflow=Audit"]),
    /requires Name=\.github\/workflows\/file\.yml/,
  );
});
