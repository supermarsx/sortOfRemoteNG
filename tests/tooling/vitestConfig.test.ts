import { describe, expect, it } from "vitest";
import vitestConfig, { NODE_TEST_SUITE_EXCLUDES } from "../../vitest.config";

describe("ordinary Vitest discovery", () => {
  it("leaves dedicated Node test suites to their package scripts", () => {
    const config = vitestConfig as {
      test?: { exclude?: readonly string[] };
    };

    expect(NODE_TEST_SUITE_EXCLUDES).toEqual([
      "tests/readme-screenshot/**/*.mjs",
      "tests/release/**/*.mjs",
      "tests/versioning/**/*.mjs",
    ]);
    expect(config.test?.exclude).toEqual(
      expect.arrayContaining([...NODE_TEST_SUITE_EXCLUDES]),
    );
  });
});
