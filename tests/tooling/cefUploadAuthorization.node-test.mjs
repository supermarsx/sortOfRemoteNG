import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowRaw = await readFile(
  new URL(
    "../../.github/workflows/cef-upload-authorization.yml",
    import.meta.url,
  ),
  "utf8",
);
const workflow = workflowRaw.replaceAll("\r\n", "\n");
const library = workflow
  .split("// BEGIN AUTHORIZATION LIBRARY\n")[1]
  .split("// END AUTHORIZATION LIBRARY")[0];
const api = Function(
  library +
    "\nreturn {OLD,PRODUCER_TAG,CAP,authority,releaseBody,routeAllowed,responseFacts,boundedJson,run};",
)();
const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "1",
  GH_TOKEN: "synthetic-never-sent",
};
const event = {
  repository: {
    id: 1010282954,
    full_name: env.GITHUB_REPOSITORY,
    private: false,
    visibility: "public",
    default_branch: "main",
  },
  inputs: {},
};
const tag = api.authority(env, event);
const producer = {
  ref: "refs/tags/" + api.PRODUCER_TAG,
  object: { type: "commit", sha: api.OLD },
};
const release = {
  id: 81,
  tag_name: tag,
  target_commitish: api.OLD,
  draft: true,
  prerelease: true,
  published_at: null,
  assets: [],
};
function fixture(change = () => {}) {
  const calls = [];
  const state = { time: 0 };
  const deps = {
    wall: () => state.time,
    mono: () => state.time,
    fetch: async (url, options) => {
      calls.push({ url, options });
      const route = url.slice(
        "https://api.github.com/repos/supermarsx/sortOfRemoteNG".length,
      );
      let value =
        route === ""
          ? event.repository
          : route === "/git/ref/heads/main"
            ? {
                ref: "refs/heads/main",
                object: { type: "commit", sha: env.GITHUB_SHA },
              }
            : route.startsWith("/git/ref/tags/")
              ? structuredClone(producer)
              : structuredClone(release);
      const result = {
        value,
        status: options.method === "POST" ? 201 : 200,
        headers: { "x-github-request-id": "ABCD:0123" },
      };
      change(result, route, options, state);
      return new Response(result.raw ?? JSON.stringify(result.value), result);
    },
  };
  return { calls, deps, state };
}

test("workflow is manual public Main-only with pinned Node and cancel-older policy", async () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /github\.repository_id == '1010282954'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /node-version-file: "\.node-version"/);
  assert.equal(
    (
      await readFile(new URL("../../.node-version", import.meta.url), "utf8")
    ).trim(),
    "24.19.0",
  );
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(
    workflow,
    /workflows: write|workflow_run:|pull_request:|schedule:|execFile|spawn\(|curl|git push/,
  );
  assert.equal((workflow.match(/GH_TOKEN:/g) ?? []).length, 1);
  assert.equal((workflow.match(/deps\.fetch\(/g) ?? []).length, 1);
});

test("legitimate CRLF workflow smudge exercises the same actual authorization library", () => {
  const smudged = workflow.replaceAll("\n", "\r\n");
  assert.equal(smudged.includes("// BEGIN AUTHORIZATION LIBRARY\n"), false);
  const normalized = smudged.replaceAll("\r\n", "\n");
  const body = normalized
    .split("// BEGIN AUTHORIZATION LIBRARY\n")[1]
    .split("// END AUTHORIZATION LIBRARY")[0];
  const actual = Function(body + "\nreturn {authority,releaseBody};")();
  assert.equal(actual.authority(env, event), tag);
  assert.deepEqual(actual.releaseBody(tag), api.releaseBody(tag));
});

test("authority rejects foreign/private/non-main/old-head/nonmanual/input-bearing contexts", () => {
  for (const [key, value] of [
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REPOSITORY", "foreign/repo"],
    ["GITHUB_REPOSITORY_ID", "1"],
    ["GITHUB_REF", "refs/heads/other"],
    ["GITHUB_SHA", api.OLD],
    ["GITHUB_RUN_ID", "123/other"],
    ["GITHUB_RUN_ATTEMPT", "0"],
  ])
    assert.throws(() => api.authority({ ...env, [key]: value }, event));
  for (const update of [
    { inputs: { arbitrary: "denied" } },
    { inputs: [] },
    { inputs: "" },
    { inputs: 0 },
    { repository: { ...event.repository, private: true } },
    { repository: { ...event.repository, default_branch: "other" } },
  ])
    assert.throws(() => api.authority(env, { ...event, ...update }));
  const missing = { ...event };
  delete missing.inputs;
  assert.throws(() => api.authority(env, missing));
});

test("official null and empty-object no-input dispatches both pass the actual inline run", async () => {
  for (const inputs of [null, {}]) {
    const f = fixture();
    const result = await api.run(env, { ...event, inputs }, f.deps);
    assert.equal(result.success, true);
    assert.equal(result.postStarted, true);
    assert.equal(f.calls.filter((x) => x.options.method === "POST").length, 1);
  }
  const missing = { ...event };
  delete missing.inputs;
  const f = fixture();
  assert.equal(
    (await api.run(env, missing, f.deps)).firstError,
    "AUTHORITY_DENIED",
  );
  assert.equal(f.calls.length, 0);
});

test("exact POST body is only an unpublished technical prerelease against fixed e7", () => {
  const body = api.releaseBody(tag);
  assert.deepEqual(Object.keys(body).sort(), [
    "body",
    "draft",
    "generate_release_notes",
    "make_latest",
    "name",
    "prerelease",
    "tag_name",
    "target_commitish",
  ]);
  assert.equal(body.target_commitish, api.OLD);
  assert.equal(body.draft, true);
  assert.equal(body.prerelease, true);
  assert.equal(body.make_latest, "false");
  assert.equal(body.generate_release_notes, false);
  assert.throws(() => api.releaseBody("app-release"));
});

test("closed routes deny tag creation/deletion/foreign or generic release authority", () => {
  for (const [route, method] of [
    ["git/refs", "POST"],
    ["releases/81", "PATCH"],
    ["releases/81", "DELETE"],
    ["releases/tags/anything", "GET"],
    ["https://foreign.invalid", "GET"],
    ["../releases", "POST"],
    ["git/ref/tags/foreign", "GET"],
  ])
    assert.equal(api.routeAllowed(route, method, 81), false);
  assert.equal(api.routeAllowed("releases/82", "GET", 81), false);
  assert.equal(api.routeAllowed("releases/81", "GET", 81), true);
});

test("actual inline run verifies the old tag before one POST and verifies the returned draft", async () => {
  const f = fixture();
  const result = await api.run(env, event, f.deps);
  assert.equal(result.success, true);
  assert.equal(result.postStarted, true);
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls.filter((x) => x.options.method === "POST").length, 1);
  assert.match(f.calls[2].url, /git\/ref\/tags\/cef-producer-e7/);
  assert.equal(f.calls[3].options.body, JSON.stringify(api.releaseBody(tag)));
  for (const call of f.calls) {
    assert.equal(call.options.redirect, "error");
    assert.match(
      call.url,
      /^https:\/\/api\.github\.com\/repos\/supermarsx\/sortOfRemoteNG(?:\/|$)/,
    );
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.deepEqual(result.release, {
    id: 81,
    tag,
    target: api.OLD,
    draft: true,
    prerelease: true,
    published: false,
    assets: 0,
  });
  assert.equal(JSON.stringify(result).includes(env.GH_TOKEN), false);
});

test("missing/moved/annotated producer tag or changed Main refuses before any POST", async () => {
  for (const mutation of [
    (r) => {
      r.value.object.sha = "b".repeat(40);
    },
    (r) => {
      r.value.object.type = "tag";
    },
    (r) => {
      r.value.ref = "refs/tags/foreign";
    },
    (r) => {
      r.status = 404;
      r.value = { message: "Not Found" };
    },
  ]) {
    const f = fixture((r, route) => {
      if (route.startsWith("/git/ref/tags/")) mutation(r);
    });
    const result = await api.run(env, event, f.deps);
    assert.equal(result.success, false);
    assert.equal(result.postStarted, false);
    assert.equal(
      f.calls.some((x) => x.options.method === "POST"),
      false,
    );
  }
  const f = fixture((r, route) => {
    if (route.endsWith("/main")) r.value.object.sha = "c".repeat(40);
  });
  assert.equal((await api.run(env, event, f.deps)).firstError, "MAIN_DENIED");
  assert.equal(f.calls.length, 2);
});

test("403 observations retain only closed reason/request-id/numeric rate and never retry", async () => {
  for (const [message, expected] of [
    ["Resource not accessible by integration", "integration"],
    ["API rate limit exceeded", "rate"],
    ["arbitrary private text", "other"],
  ]) {
    const f = fixture((r, route) => {
      if (route === "/releases") {
        r.status = 403;
        r.value = { message };
        r.headers["x-ratelimit-remaining"] = "12";
      }
    });
    const result = await api.run(env, event, f.deps);
    assert.equal(result.firstError, "HTTP_DENIED");
    assert.equal(result.responses.at(-1).reason, expected);
    assert.equal(result.responses.at(-1).requestId, "ABCD:0123");
    assert.equal(result.responses.at(-1).rate.remaining, 12);
    assert.equal(f.calls.length, 4);
    assert.equal(JSON.stringify(result).includes(message), false);
  }
});

test("malformed numeric/header/body data cannot become retained arbitrary text", async () => {
  const response = new Response("{}", {
    status: 403,
    headers: {
      "x-github-request-id": "private/arbitrary",
      "x-ratelimit-limit": "-1",
      "x-ratelimit-remaining": "secret",
      "x-ratelimit-reset": "9999999999999999999",
    },
  });
  const facts = api.responseFacts(response, {});
  assert.equal(facts.requestId, null);
  assert.deepEqual(facts.rate, {
    limit: null,
    remaining: null,
    used: null,
    reset: null,
  });
  for (const raw of ["x".repeat(16385), new Uint8Array([0xff]), "{"]) {
    const f = fixture((r) => {
      r.raw = raw;
    });
    const result = await api.run(env, event, f.deps);
    assert.equal(result.success, false);
    assert.equal(result.postStarted, false);
    assert.equal(f.calls.length, 1);
    assert.ok(["RESPONSE_CAP", "UNAVAILABLE"].includes(result.firstError));
  }
});

test("exact response cap accepted; cap overshoot cancels the actual response reader", async () => {
  const raw = JSON.stringify({ a: "x".repeat(16376) });
  assert.equal(Buffer.byteLength(raw), api.CAP);
  assert.equal(
    (await api.boundedJson(new Response(raw), () => 1)).a.length,
    16376,
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(16385));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    api.boundedJson(new Response(stream), () => 1),
    /RESPONSE_CAP/,
  );
  assert.equal(cancelled, true);
});

test("published/wrong-target/asset-bearing or conflicting readback never claims success", async () => {
  for (const mutate of [
    (r) => {
      r.value.draft = false;
    },
    (r) => {
      r.value.prerelease = false;
    },
    (r) => {
      r.value.target_commitish = "b".repeat(40);
    },
    (r) => {
      r.value.published_at = "2026-10-25";
    },
    (r) => {
      r.value.assets = [{}];
    },
    (r) => {
      r.value.id = 82;
    },
  ]) {
    const f = fixture((r, route) => {
      if (route === "/releases/81") mutate(r);
    });
    const result = await api.run(env, event, f.deps);
    assert.equal(result.success, false);
    assert.equal(result.firstError, "RELEASE_READBACK_DENIED");
    assert.equal(result.postStarted, true);
    assert.equal(result.release.id, 81);
    assert.equal(f.calls.length, 5);
  }
});

test("wall or monotonic exhaustion and later errors preserve the original first failure", async () => {
  const f = fixture((r, route, options, state) => {
    if (route === "/releases") {
      r.status = 403;
      r.value = {};
      state.time = 180001;
    }
  });
  const result = await api.run(env, event, f.deps);
  assert.equal(result.success, false);
  assert.equal(result.firstError, "DEADLINE");
  assert.equal(result.postStarted, true);
  const g = fixture();
  let monotonic = 0;
  g.deps.mono = () => (monotonic += 180001);
  assert.equal((await api.run(env, event, g.deps)).firstError, "DEADLINE");
  assert.equal(g.calls.length, 0);
  const h = fixture((r, route) => {
    if (route === "/releases") {
      r.status = 403;
      r.value = {};
    }
  });
  const original = await api.run(env, event, h.deps);
  assert.equal(original.firstError, "HTTP_DENIED");
  assert.equal(h.calls.length, 4);
});
