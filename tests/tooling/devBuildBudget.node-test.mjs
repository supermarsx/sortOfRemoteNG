import test from "node:test";
import assert from "node:assert/strict";
import {
  GIB,
  describeDevBuildResources,
  planDevBuildResources,
  readDevBuildResources,
} from "../../scripts/lib/dev-build-budget.mjs";
import { buildTauriLaunchPlan } from "../../scripts/tauri-dev.mjs";

const resources = Object.freeze({
  parallelism: 40,
  totalMemoryBytes: 288 * GIB,
  freeMemoryBytes: 230 * GIB,
});
const plan = (overrides = {}) =>
  planDevBuildResources({ baseEnv: {}, resources, ...overrides });

test("40-GiB dev allowance selects 32 jobs on a 40-CPU high-memory host", () => {
  const selected = plan();
  assert.equal(selected.source, "automatic");
  assert.equal(selected.jobs, 32);
  assert.equal(selected.budgetBytes, 40 * GIB);
  assert.equal(selected.estimatedBuildBytes, 40 * GIB);
  assert.deepEqual(selected.environment, { CARGO_BUILD_JOBS: "32" });
  assert.equal(selected.insufficientHeadroom, false);
  assert.match(
    describeDevBuildResources(selected),
    /not a hard RAM cap or live controller/,
  );
});

test("CPU and free-memory limits can independently lower the recommendation", () => {
  assert.equal(plan({ resources: { ...resources, parallelism: 8 } }).jobs, 8);
  const selected = plan({
    resources: {
      parallelism: 40,
      totalMemoryBytes: 100 * GIB,
      freeMemoryBytes: 23 * GIB,
    },
  });
  assert.equal(selected.systemReserveBytes, 7 * GIB);
  assert.equal(selected.budgetBytes, 16 * GIB);
  assert.equal(selected.jobs, 8);
  assert.ok(selected.estimatedBuildBytes <= selected.budgetBytes);
});

for (const freeGiB of [0, 6, 7, 8, 15]) {
  test(`low RAM (${freeGiB} GiB free of 100) retains one job with an honest warning`, () => {
    const selected = plan({
      resources: {
        ...resources,
        totalMemoryBytes: 100 * GIB,
        freeMemoryBytes: freeGiB * GIB,
      },
    });
    assert.ok(selected.budgetBytes >= 0);
    assert.equal(selected.jobs, 1);
    assert.equal(selected.insufficientHeadroom, true);
    assert.match(
      describeDevBuildResources(selected),
      /7% free-RAM reserve cannot be assured/,
    );
  });
}

test("threshold boundary and malformed observations cannot create negative or unbounded jobs", () => {
  const totalMemoryBytes = 100 * GIB;
  const reserve = Math.ceil((totalMemoryBytes * 7) / 100);
  const exact = plan({
    resources: {
      ...resources,
      totalMemoryBytes,
      freeMemoryBytes: reserve + 9 * GIB,
    },
  });
  assert.equal(exact.jobs, 1);
  assert.equal(exact.insufficientHeadroom, false);
  const atReserve = plan({
    resources: { ...resources, totalMemoryBytes, freeMemoryBytes: reserve },
  });
  assert.equal(atReserve.budgetBytes, 0);
  for (const invalid of [
    { parallelism: NaN, totalMemoryBytes: Infinity, freeMemoryBytes: Infinity },
    { parallelism: 0, totalMemoryBytes: -1, freeMemoryBytes: -1 },
    {},
  ]) {
    const selected = plan({ resources: invalid });
    assert.equal(selected.jobs, 1);
    assert.equal(selected.budgetBytes, 0);
    assert.equal(selected.insufficientHeadroom, true);
  }
  assert.equal(
    plan({ resources: { ...resources, freeMemoryBytes: 400 * GIB } })
      .freeMemoryBytes,
    resources.totalMemoryBytes,
  );
});

test("explicit Cargo job and config overrides are preserved without echoing arbitrary values", () => {
  for (const argv of [
    ["--", "--jobs", "4"],
    ["--", "--jobs=4"],
    ["--", "-j4"],
    ["--", "-j", "-2"],
  ]) {
    const selected = plan({ argv });
    assert.equal(selected.source, "arguments");
    assert.deepEqual(selected.environment, {});
  }
  const selected = plan({
    baseEnv: Object.freeze({
      CARGO_BUILD_JOBS: "private-arbitrary-invalid-input",
    }),
  });
  assert.equal(selected.source, "environment");
  assert.deepEqual(selected.environment, {});
  assert.match(
    describeDevBuildResources(selected),
    /override \(environment\) preserved/,
  );
  assert.doesNotMatch(describeDevBuildResources(selected), /private-arbitrary/);
  assert.equal(
    plan({ argv: ["--", "--config", "private-local-cargo.toml"] }).source,
    "cargo-config",
  );
});

test("release/custom profiles and runners opt out while app-only arguments do not affect build sizing", () => {
  for (const argv of [
    ["--release"],
    ["--", "--profile", "release"],
    ["--", "--profile=custom"],
  ]) {
    assert.equal(plan({ argv }).source, "profile");
    assert.deepEqual(plan({ argv }).environment, {});
  }
  for (const argv of [
    ["--runner", "custom"],
    ["-r", "custom"],
    ["-rcustom"],
    ["-r=custom"],
    ["--runner=custom"],
  ])
    assert.equal(plan({ argv }).source, "runner");
  assert.equal(
    plan({ argv: ["--", "--locked", "--", "--jobs", "100", "--release"] })
      .source,
    "automatic",
  );
});

test("launch plans scope jobs to the child without changing features, parent environment or runtime heap", () => {
  const baseEnv = Object.freeze({
    NODE_OPTIONS: "--max-old-space-size=4096",
    PRESERVED: "yes",
  });
  const argv = ["--features", "full", "--", "--locked"];
  const selected = buildTauriLaunchPlan({
    port: 3042,
    baseEnv,
    passthrough: argv,
    buildResourceOptions: { resources },
  });
  assert.equal(baseEnv.CARGO_BUILD_JOBS, undefined);
  assert.equal(selected.env.CARGO_BUILD_JOBS, "32");
  assert.equal(selected.env.NODE_OPTIONS, baseEnv.NODE_OPTIONS);
  assert.deepEqual(selected.tauriArgs.slice(-argv.length), argv);
  assert.equal(selected.tauriArgs.includes("--no-default-features"), false);
  for (const value of ["4", "-2", "default", "", "invalid"]) {
    const inherited = buildTauriLaunchPlan({
      port: 3042,
      baseEnv: { CARGO_BUILD_JOBS: value },
      buildResourceOptions: { resources },
    });
    assert.equal(inherited.env.CARGO_BUILD_JOBS, value);
  }
  assert.equal(
    buildTauriLaunchPlan({
      port: 3042,
      baseEnv: {},
      passthrough: ["--release"],
      buildResourceOptions: { resources },
    }).env.CARGO_BUILD_JOBS,
    undefined,
  );
});

test("the production sampler reads actual process-visible CPU and physical memory without starting a build", (t) => {
  const observed = readDevBuildResources();
  assert.ok(Number.isInteger(observed.parallelism) && observed.parallelism > 0);
  assert.ok(observed.totalMemoryBytes > 0);
  assert.ok(
    observed.freeMemoryBytes >= 0 &&
      observed.freeMemoryBytes <= observed.totalMemoryBytes,
  );
  const selected = plan({ resources: observed });
  assert.ok(selected.jobs <= observed.parallelism);
  assert.ok(selected.budgetBytes <= 40 * GIB);
  assert.ok(
    selected.budgetBytes <=
      Math.max(
        0,
        observed.freeMemoryBytes -
          Math.ceil((observed.totalMemoryBytes * 7) / 100),
      ),
  );
  t.diagnostic(
    `Observed ${observed.parallelism} CPUs, ${(observed.totalMemoryBytes / GIB).toFixed(2)} GiB total, ${(observed.freeMemoryBytes / GIB).toFixed(2)} GiB free; recommends ${selected.jobs} jobs.`,
  );
});
