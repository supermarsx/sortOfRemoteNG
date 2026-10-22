import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TARGETS } from "../../scripts/browser-runtime-package.mjs";
import { checkReleaseRuntimeCatalog } from "../../scripts/ci/check-release-runtime-catalog.mjs";

function catalog() {
  return {
    schemaVersion: 1,
    kind: "sorng-cef-runtime-releases",
    targets: Object.fromEntries(
      TARGETS.map((target) => [
        target,
        {
          descriptorUrl: `https://github.com/supermarsx/sortOfRemoteNG/releases/download/cef-test-${target}/runtime.json`,
          descriptorSha256: "a".repeat(64),
        },
      ]),
    ),
  };
}

test("release requires all six runtime pins without claiming native execution", () => {
  assert.deepEqual(checkReleaseRuntimeCatalog(catalog()), {
    targets: [...TARGETS],
    catalogComplete: true,
    nativeAcceptance: "not-observed",
  });
});

test("every missing platform blocks tag allocation, including a partial five-platform catalog", () => {
  for (const target of TARGETS) {
    const value = catalog();
    delete value.targets[target];
    assert.throws(
      () => checkReleaseRuntimeCatalog(value),
      (error) =>
        error.message.includes(target) &&
        error.message.includes("before tag allocation"),
    );
  }
  assert.throws(
    () => checkReleaseRuntimeCatalog({ ...catalog(), targets: {} }),
    /all six platform runtimes/,
  );
});

test("release preflight preserves descriptor hash and host validation", () => {
  const value = catalog();
  value.targets[TARGETS[0]].descriptorSha256 = "0".repeat(64);
  assert.throws(
    () => checkReleaseRuntimeCatalog(value),
    /Invalid reviewed CEF release entry/,
  );
  value.targets[TARGETS[0]].descriptorSha256 = "a".repeat(64);
  value.targets[TARGETS[0]].descriptorUrl =
    "https://untrusted.example/runtime.json";
  assert.throws(
    () => checkReleaseRuntimeCatalog(value),
    /Invalid reviewed CEF release entry/,
  );
});

test("runtime prerequisite is checked before release identity allocation and tag mutation", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const preflight = workflow.indexOf(
    "run: node scripts/ci/check-release-runtime-catalog.mjs",
  );
  assert.ok(preflight > 0);
  assert.ok(
    preflight <
      workflow.indexOf("- name: Resolve bare rolling release identity"),
  );
  assert.ok(
    preflight <
      workflow.indexOf("- name: Create or reuse immutable release snapshot"),
  );
});
