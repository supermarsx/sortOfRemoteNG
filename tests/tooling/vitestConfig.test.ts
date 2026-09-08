import { describe, expect, it } from "vitest";
import { availableParallelism } from "node:os";
import vitestConfig, {
  NODE_TEST_SUITE_EXCLUDES,
  resolveTestWorkerCount,
} from "../../vitest.config";

describe("ordinary Vitest discovery", () => {
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

  it("leaves dedicated Node test suites to their package scripts", () => {
    const config = vitestConfig as {
      test?: { exclude?: readonly string[] };
    };

    expect(NODE_TEST_SUITE_EXCLUDES).toEqual([
      "tests/readme-screenshot/**/*.mjs",
      "tests/e2e-http-fixtures/**/*.mjs",
      "tests/release/**/*.mjs",
      "tests/versioning/**/*.mjs",
    ]);
    expect(config.test?.exclude).toEqual(
      expect.arrayContaining([...NODE_TEST_SUITE_EXCLUDES]),
    );
  });
});
