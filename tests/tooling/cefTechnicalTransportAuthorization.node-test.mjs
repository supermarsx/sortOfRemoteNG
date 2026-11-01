import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ORIGINAL_PRODUCER,
  authority,
  run,
} from "../fixtures/cef/technical_transport_authorization.mjs";

const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: ORIGINAL_PRODUCER.repository,
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_REF:
    ORIGINAL_PRODUCER.repository +
    "/.github/workflows/cef-upload-authorization.yml@refs/heads/main",
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "1",
  GH_TOKEN: "synthetic-never-sent",
};
const event = {
  repository: {
    id: 1010282954,
    full_name: ORIGINAL_PRODUCER.repository,
    private: false,
    visibility: "public",
    default_branch: "main",
  },
  inputs: { proof: "transport-v2" },
};
const carrierHead = "b".repeat(40);
function fixture(change = () => {}) {
  const calls = [];
  const tag = authority(env, event);
  const request = async (url, options) => {
    const route = url.slice(
      ("https://api.github.com/repos/" + ORIGINAL_PRODUCER.repository).length,
    );
    calls.push({
      route,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    let value;
    if (route === "") value = structuredClone(event.repository);
    else if (route === "/actions/workflows/cef-engineering-checkpoint.yml")
      value = { id: 71, path: ORIGINAL_PRODUCER.workflow };
    else if (route === "/actions/runs/41323982797")
      value = {
        workflow_id: 71,
        event: "workflow_dispatch",
        head_sha: ORIGINAL_PRODUCER.head,
        head_branch: "main",
        head_repository: { id: 1010282954 },
        run_attempt: 1,
      };
    else if (route === "/git/ref/heads/main")
      value = {
        ref: "refs/heads/main",
        object: { type: "commit", sha: carrierHead },
      };
    else if (
      (route === "/releases" && options.method === "POST") ||
      route === "/releases/81"
    )
      value = {
        id: 81,
        tag_name: tag,
        target_commitish: carrierHead,
        draft: true,
        prerelease: true,
        published_at: null,
        assets: [],
      };
    else assert.fail("Unexpected request route: " + route);
    const result = {
      value,
      status: options.method === "POST" ? 201 : 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "4997",
      },
    };
    change(result, route, options, calls);
    return new Response(JSON.stringify(result.value), result);
  };
  return { request, calls };
}

test("actual production client and resolver separate historical source from one empty draft container", async () => {
  const f = fixture(),
    result = await run(env, event, f.request);
  assert.equal(result.complete, true);
  assert.equal(result.sourceCommit, ORIGINAL_PRODUCER.head);
  assert.equal(result.sourceRun, 41323982797);
  assert.equal(result.transport.carrierHead, carrierHead);
  const posts = f.calls.filter((row) => row.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].route, "/releases");
  assert.equal(posts[0].body.target_commitish, carrierHead);
  assert.notEqual(posts[0].body.target_commitish, ORIGINAL_PRODUCER.head);
  assert.match(posts[0].body.body, /Historical source commit: 1cfeff9/);
  assert.equal(posts[0].body.draft, true);
  assert.equal(posts[0].body.prerelease, true);
  assert.equal(posts[0].body.make_latest, "false");
  for (const field of [
    "sealCreated",
    "checkpointRecovered",
    "nativeAcceptance",
    "runtimeReady",
    "applicationPublication",
  ])
    assert.equal(result[field], false);
  assert(!JSON.stringify(result).includes(env.GH_TOKEN));
});

test("foreign authority, arbitrary source selection or token absence sends no requests", async () => {
  for (const mutate of [
    (e, v) => (e.GITHUB_REF = "refs/heads/foreign"),
    (e, v) => (e.GITHUB_WORKFLOW_SHA = "c".repeat(40)),
    (e, v) => (e.GITHUB_WORKFLOW_REF = "foreign"),
    (e, v) => (e.GH_TOKEN = ""),
    (e, v) => (v.repository.private = true),
    (e, v) => (v.inputs.source = "arbitrary"),
    (e, v) => (v.inputs.proof = "current-head"),
  ]) {
    const e = { ...env },
      v = structuredClone(event),
      f = fixture();
    mutate(e, v);
    await assert.rejects(run(e, v, f.request));
    assert.deepEqual(f.calls, []);
  }
});

test("historical producer and current Main identity failures deny before draft creation", async () => {
  for (const mutate of [
    (r, route) => {
      if (route.startsWith("/actions/runs/")) r.value.head_sha = carrierHead;
    },
    (r, route) => {
      if (route === "/git/ref/heads/main") r.value.ref = "refs/heads/foreign";
    },
    (r, route) => {
      if (route === "/git/ref/heads/main") r.value.object.type = "tag";
    },
    (r, route) => {
      if (route === "/git/ref/heads/main") r.value.object.sha = "SECRET";
    },
    (r, route) => {
      if (route === "/git/ref/heads/main")
        r.value.object.sha = ORIGINAL_PRODUCER.head;
    },
    (r, route) => {
      if (route === "") r.value.default_branch = "foreign";
    },
  ]) {
    const f = fixture(mutate);
    await assert.rejects(run(env, event, f.request));
    assert(!f.calls.some((row) => row.method === "POST"));
  }
});

test("created and final release readbacks must retain carrier, unpublished state and zero assets", async () => {
  for (const phase of ["/releases", "/releases/81"]) {
    for (const mutate of [
      (value) => (value.target_commitish = ORIGINAL_PRODUCER.head),
      (value) => (value.draft = false),
      (value) => (value.published_at = "now"),
      (value) => value.assets.push({ id: 1 }),
      (value) => (value.tag_name = "foreign"),
    ]) {
      const f = fixture((r, route) => {
        if (route === phase) mutate(r.value);
      });
      await assert.rejects(run(env, event, f.request), /READBACK/);
      assert.equal(f.calls.filter((row) => row.method === "POST").length, 1);
    }
  }
});

test("a GitHub authorization refusal is not replayed or replaced with an arbitrary target", async () => {
  const f = fixture((r, route) => {
    if (route === "/releases") {
      r.status = 403;
      r.value = { message: "Resource not accessible by integration" };
    }
  });
  await assert.rejects(run(env, event, f.request));
  assert.equal(f.calls.filter((row) => row.method === "POST").length, 1);
  assert.equal(
    f.calls.filter((row) => row.route === "/git/ref/heads/main").length,
    1,
  );
});

test("even a retryable rate-limit response cannot send a second draft POST", async () => {
  const f = fixture((r, route) => {
    if (route === "/releases") {
      r.status = 429;
      r.value = { message: "API rate limit exceeded" };
      r.headers["retry-after"] = "0";
      r.headers["x-ratelimit-remaining"] = "0";
    }
  });
  await assert.rejects(
    run(env, event, f.request),
    /TRANSPORT_PROBE_POST_REPLAY/,
  );
  assert.equal(f.calls.filter((row) => row.method === "POST").length, 1);
  assert.equal(
    f.calls.filter((row) => row.route === "/git/ref/heads/main").length,
    1,
  );
});

test("diagnostics expose only fixed phases and numeric HTTP status and cannot replace behavior", async () => {
  const f = fixture(),
    records = [];
  const result = await run(env, event, f.request, (record) => {
    records.push(record);
    throw Error("PRIVATE_DIAGNOSTIC_FAILURE");
  });
  assert.equal(result.complete, true);
  for (const record of records) {
    assert(Object.isFrozen(record));
    assert(
      Object.keys(record).every((key) => ["phase", "httpStatus"].includes(key)),
    );
    assert(
      [
        "authority",
        "producer",
        "carrier",
        "draft-create",
        "draft-readback",
      ].includes(record.phase),
    );
  }
  assert(
    records.some(
      (row) => row.phase === "draft-create" && row.httpStatus === 201,
    ),
  );
  assert(
    records.some(
      (row) => row.phase === "draft-readback" && row.httpStatus === 200,
    ),
  );
  assert(!JSON.stringify(records).includes(env.GH_TOKEN));
});

test("workflow isolates both credentialed modes and keeps one original five-minute job", async () => {
  const workflow = (
    await readFile(".github/workflows/cef-upload-authorization.yml", "utf8")
  ).replaceAll("\r\n", "\n");
  assert.match(workflow, /options: \[current-head, transport-v2\]/);
  assert.match(workflow, /default: current-head/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /actions: read/);
  assert.equal((workflow.match(/GH_TOKEN:/g) ?? []).length, 2);
  const legacy = workflow.slice(
    workflow.indexOf("- name: One unpublished technical draft"),
    workflow.indexOf("- name: One source-separated technical transport draft"),
  );
  const current = workflow.slice(
    workflow.indexOf("- name: One source-separated technical transport draft"),
    workflow.indexOf("- name: Retain only the closed authorization result"),
  );
  assert.match(legacy, /if: inputs.proof == 'current-head'/);
  assert.match(current, /if: inputs.proof == 'transport-v2'/);
  assert.match(current, /timeout-minutes: 4/);
  assert.equal((legacy.match(/GH_TOKEN:/g) ?? []).length, 1);
  assert.equal((current.match(/GH_TOKEN:/g) ?? []).length, 1);
  assert.match(
    current,
    /node tests\/fixtures\/cef\/technical_transport_authorization\.mjs/,
  );
  assert.doesNotMatch(
    workflow,
    /workflows: write|pull_request:|workflow_run:|schedule:|secrets\./,
  );
});
