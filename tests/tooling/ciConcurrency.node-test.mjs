import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const read = (name) =>
  YAML.parse(
    readFileSync(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    ),
  );
const files = ["ci", "coverage", "audit", "frontend-build", "e2e-smoke", "e2e"];
const values = {
  workflow: "CI",
  event: "push",
  ref: "refs/heads/feature",
  pr: undefined,
  repository: "owner/repo",
  headRepository: undefined,
  refName: "feature",
  defaultBranch: "main",
  headRef: undefined,
};
function render(group, context, matrix = {}) {
  return group.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => {
    if (expression === "github.workflow") return context.workflow;
    if (
      expression ===
      "(github.event_name == 'push' || github.event_name == 'pull_request') && (github.head_ref || github.ref_name) != github.event.repository.default_branch && 'source' || github.event_name"
    )
      return ["push", "pull_request"].includes(context.event) &&
        (context.headRef || context.refName) !== context.defaultBranch
        ? "source"
        : context.event;
    if (
      expression ===
      "github.event.pull_request.head.repo.full_name || github.repository"
    )
      return context.headRepository || context.repository;
    if (expression === "github.head_ref || github.ref_name")
      return context.headRef || context.refName;
    if (expression === "github.event_name") return context.event;
    if (expression === "github.event.pull_request.number || github.ref")
      return context.pr || context.ref;
    const axis = /^matrix\.(cohort|os|target)$/.exec(expression);
    assert.ok(axis, `Unexpected concurrency expression: ${expression}`);
    assert.equal(typeof matrix[axis[1]], "string");
    return matrix[axis[1]];
  });
}
function assertReleaseEvidenceIsolated(group, context, matrix = {}) {
  const defaultPush = {
    ...context,
    event: "push",
    refName: context.defaultBranch,
    headRef: undefined,
    headRepository: undefined,
  };
  const requiredPush = render(group, defaultPush, matrix);
  const defaultPr = {
    ...defaultPush,
    event: "pull_request",
    headRef: context.defaultBranch,
    headRepository: context.repository,
    refName: "255/merge",
  };
  assert.notEqual(
    render(group, defaultPr, matrix),
    requiredPush,
    "PR from default branch cannot cancel required default push evidence",
  );
  for (const event of ["schedule", "workflow_dispatch"]) {
    assert.notEqual(
      render(group, { ...defaultPush, event }, matrix),
      requiredPush,
      "non-push validation cannot cancel required default push evidence",
    );
    assert.notEqual(
      render(group, { ...context, event }, matrix),
      render(group, context, matrix),
      "manual/scheduled runs retain a separate trigger family",
    );
  }
}
function rows(job) {
  const matrix = job.strategy?.matrix;
  if (!matrix) return [{}];
  if (matrix.include) return matrix.include;
  return Object.entries(matrix).reduce(
    (all, [axis, entries]) =>
      all.flatMap((prior) =>
        entries.map((value) => ({ ...prior, [axis]: value })),
      ),
    [{}],
  );
}

test("each validation job coalesces non-default push and PR work while preserving release evidence", () => {
  const ci = read("ci");
  assert.equal(
    ci.concurrency,
    undefined,
    "workflow-level cancellation would cancel the reusable release",
  );
  const expected = Object.keys(ci.jobs).filter(
    (id) => id !== "rolling-release",
  );
  assert.ok(expected.length > 10);
  const keys = new Set();
  for (const id of expected) {
    const job = ci.jobs[id],
      policy = job.concurrency;
    assert.equal(policy?.["cancel-in-progress"], true, id);
    assert.doesNotMatch(policy.group, /github\.(sha|run_id)|queue:/);
    const siblings = rows(job).map((matrix) =>
      render(policy.group, values, matrix),
    );
    assert.equal(
      new Set(siblings).size,
      siblings.length,
      `${id} matrix siblings must not cancel each other`,
    );
    for (const [index, key] of siblings.entries()) {
      assert.ok(key.length < 256, "identity fields must remain bounded");
      assert.equal(
        keys.has(key),
        false,
        "different jobs must not share a group",
      );
      keys.add(key);
      assert.equal(
        render(
          policy.group,
          { ...values, headRef: "", headRepository: "" },
          rows(job)[index],
        ),
        key,
        "actual empty-string push context uses GitHub truthy fallback",
      );
      assertReleaseEvidenceIsolated(policy.group, values, rows(job)[index]);
      assert.equal(
        render(
          policy.group,
          { ...values, sha: "new-source", run_id: 999 },
          rows(job)[index],
        ),
        key,
      );
      const pullRequest = {
        ...values,
        event: "pull_request",
        pr: 255,
        refName: "255/merge",
        ref: "refs/pull/255/merge",
        headRepository: values.repository,
        headRef: values.refName,
      };
      assert.equal(
        render(policy.group, pullRequest, rows(job)[index]),
        key,
        "same non-default branch push and PR must supersede each other",
      );
      assert.notEqual(
        render(
          policy.group,
          { ...pullRequest, headRepository: "fork/repo" },
          rows(job)[index],
        ),
        key,
        "fork head repositories stay separate",
      );
      assert.notEqual(
        render(policy.group, { ...values, refName: "other" }, rows(job)[index]),
        key,
        "other source branches stay separate",
      );
    }
  }
  const release = ci.jobs["rolling-release"];
  assert.equal(release.uses, "./.github/workflows/release.yml");
  assert.equal(release.concurrency, undefined);
  assert.match(
    release.if,
    /success\(\).*event_name == 'push'.*refs\/heads\/main/,
  );
  assert.deepEqual(new Set(release.needs), new Set(expected));
  assert.equal(release.with.source_sha, "${{ github.sha }}");
  const publication = read("release");
  assert.deepEqual(publication.concurrency, {
    group: "rolling-release",
    queue: "max",
    "cancel-in-progress": false,
  });
});

test("standalone validation coalesces non-default push and PR while preserving release evidence", () => {
  for (const name of files.filter((file) => file !== "ci")) {
    const workflow = read(name),
      policy = workflow.concurrency;
    assert.equal(policy?.["cancel-in-progress"], true, name);
    assert.doesNotMatch(policy.group, /github\.(sha|run_id)/);
    const context = { ...values, workflow: workflow.name };
    const key = render(policy.group, context);
    assert.equal(
      render(policy.group, { ...context, headRef: "", headRepository: "" }),
      key,
      "actual empty-string push context uses GitHub truthy fallback",
    );
    assertReleaseEvidenceIsolated(policy.group, context);
    assert.equal(
      render(policy.group, { ...context, sha: "newer", run_id: 888 }),
      key,
    );
    assert.notEqual(
      render(policy.group, {
        ...context,
        refName: "other",
        ref: "refs/heads/other",
      }),
      key,
    );
    const pullRequest = {
      ...context,
      event: "pull_request",
      pr: 255,
      refName: "255/merge",
      ref: "refs/pull/255/merge",
      headRepository: context.repository,
      headRef: context.refName,
    };
    assert.equal(render(policy.group, pullRequest), key);
    assert.notEqual(
      render(policy.group, { ...pullRequest, headRepository: "fork/repo" }),
      key,
    );
    assert.notEqual(
      render(policy.group, { ...context, workflow: "other" }),
      key,
    );
  }
});

test("latest-work cancellation preserves existing push/PR/manual/scheduled trigger coverage", () => {
  assert.deepEqual(read("ci").on, {
    push: { branches: ["**"] },
    pull_request: { branches: ["**"] },
  });
  assert.deepEqual(read("coverage").on, {
    push: { branches: ["**"] },
    pull_request: { branches: ["**"] },
  });
  assert.deepEqual(read("frontend-build").on, {
    push: { branches: ["main"] },
    pull_request: { branches: ["**"] },
  });
  assert.equal(read("audit").on.schedule.length, 1);
  assert.deepEqual(read("e2e-smoke").on, {
    pull_request: { branches: ["**"] },
    workflow_dispatch: {},
  });
  const docker = read("e2e");
  assert.deepEqual(docker.on.push, { branches: ["main"] });
  assert.deepEqual(docker.on.pull_request.types, [
    "labeled",
    "synchronize",
    "reopened",
  ]);
  assert.deepEqual(docker.on.workflow_dispatch, {});
  assert.equal(docker.on.schedule.length, 1);
  const version = read("ci").jobs.version;
  assert.ok(
    version.steps.some((step) =>
      step.run?.includes("tests/tooling/ciConcurrency.node-test.mjs"),
    ),
  );
});
