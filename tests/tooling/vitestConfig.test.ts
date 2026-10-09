import { describe, expect, it } from "vitest";
import { availableParallelism } from "node:os";
import { readFileSync } from "node:fs";
import vitestConfig, {
  NODE_TEST_SUITE_EXCLUDES,
  resolveTestWorkerCount,
} from "../../vitest.config";

describe("ordinary Vitest discovery", () => {
  it("does not rediscover verification worktrees and preimages as application source", () => {
    const config = vitestConfig as {
      test?: { exclude?: readonly string[] };
    };
    expect(config.test?.exclude).toContain(".artifacts/**");
    const typescript = JSON.parse(readFileSync("tsconfig.json", "utf8"));
    expect(typescript.exclude).toContain(".artifacts");
    expect(typescript.include).toEqual(expect.arrayContaining(["**/*.ts", "**/*.tsx"]));
  });
  it.each([
    [1, 1],
    [2, 1],
    [4, 3],
    [8, 7],
    [9, 8],
    [16, 8],
    [64, 8],
  ])("uses %i available CPUs to select %i workers", (cpus, workers) => {
    expect(resolveTestWorkerCount(cpus)).toBe(workers);
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid available parallelism %s",
    (cpus) => {
      expect(() => resolveTestWorkerCount(cpus)).toThrow(RangeError);
    },
  );

  it("configures the worker bound from the current host capacity", () => {
    const config = vitestConfig as {
      test?: { maxWorkers?: number };
    };

    expect(config.test?.maxWorkers).toBe(
      resolveTestWorkerCount(availableParallelism()),
    );
  });

  it("leaves dedicated Node test suites to their own runners", () => {
    const config = vitestConfig as {
      test?: { exclude?: readonly string[] };
    };

    expect(NODE_TEST_SUITE_EXCLUDES).toEqual([
      "tests/readme-screenshot/**/*.mjs",
      "tests/e2e-http-fixtures/**/*.mjs",
      "tests/release/**/*.mjs",
      "tests/versioning/**/*.mjs",
      "tests/protocol/nativeAppearanceClient.test.mjs",
      "tests/protocol/nativeLoginClient.test.mjs",
      "tests/protocol/nativeLoginKeyboard.test.mjs",
      "tests/protocol/nativeTotpClient.test.mjs",
    ]);
    expect(config.test?.exclude).toEqual(
      expect.arrayContaining([...NODE_TEST_SUITE_EXCLUDES]),
    );
  });
  it("executes every excluded native browser suite with Node in the transport matrix", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const testJob = workflow
      .split("\n  browser-transport-contracts:\n")[1]
      ?.split(/\n {2}[a-z][\w-]*:\n/)[0];
    const nodeCommand = testJob
      ?.split(/\r?\n/)
      .find((line) => line.includes("run: node --test tests/protocol/"));
    expect(nodeCommand).toBeDefined();
    for (const file of NODE_TEST_SUITE_EXCLUDES.filter((path) =>
      path.startsWith("tests/protocol/"),
    )) {
      expect(nodeCommand).toContain(file);
      expect(readFileSync(file, "utf8")).toContain('from "node:test"');
    }
  });
  it("runs native std-only suites explicitly after Rust setup in the transport matrix", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const testJob = workflow
      .split("\n  browser-transport-contracts:\n")[1]
      ?.split(/\n {2}[a-z][\w-]*:\n/)[0];
    const stepName = "      - name: Native browser std-only contracts (Node + rustc)\n";
    const toolingStep = testJob?.split(stepName)[1]?.split(/\n      - /)[0];
    const command = toolingStep
      ?.split("\n")
      .find((line) => line.trim().startsWith("run:"));
    const suites = [
      "tests/tooling/nativeWarmStartup.node-test.mjs",
      "tests/tooling/nativeCredentialFocus.node-test.mjs",
      "tests/tooling/nativeNavigationFailure.node-test.mjs",
      "tests/tooling/nativeLoginDiagnostics.node-test.mjs",
      "tests/tooling/cefStartupFieldTrials.node-test.mjs",
      "tests/tooling/nativeOriginProbe.node-test.mjs",
    ];
    expect(command?.trim().split(/\s+/)).toEqual([
      "run:",
      "node",
      "--test",
      ...suites,
    ]);
    expect(toolingStep).not.toMatch(/continue-on-error|if:/);
    const steps = testJob?.split("\n      - ") ?? [];
    const rustSetup = steps.findIndex((step) =>
      step.startsWith("uses: dtolnay/rust-toolchain@"),
    );
    expect(rustSetup).toBeGreaterThanOrEqual(0);
    expect(steps[rustSetup + 1]?.startsWith(stepName.trim().slice(2))).toBe(true);
    for (const file of suites) {
      expect(readFileSync(file, "utf8")).toContain('from "node:test"');
    }
  });

});
