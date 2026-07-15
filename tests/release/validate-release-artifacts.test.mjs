import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseArtifactNames } from "../../scripts/ci/validate-release-artifacts.mjs";

test("accepts versioned bundles and an unversioned updater archive", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(
      [
        "sortOfRemoteNG_26.1.0_x64.dmg",
        "sortOfRemoteNG_x64.app.tar.gz",
        "sortOfRemoteNG_x64.app.tar.gz.sig",
      ],
      "26.1.0",
    ),
    [],
  );
});

test("rejects bundle version drift", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(
      ["sortOfRemoteNG_26.2.0_x64-setup.exe"],
      "26.1.0",
    ),
    [
      "sortOfRemoteNG_26.2.0_x64-setup.exe contains version 26.2.0; expected 26.1.0.",
      "At least one bundle filename must contain the expected machine version 26.1.0.",
    ],
  );
});

test("requires a machine-versioned bundle as the release metadata anchor", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(["sortOfRemoteNG_x64.app.tar.gz"], "26.1.0"),
    [
      "At least one bundle filename must contain the expected machine version 26.1.0.",
    ],
  );
});

test("rejects an invalid expected transport version", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(
      ["sortOfRemoteNG_26.1.0_amd64.AppImage"],
      "26.1",
    ),
    ['Expected version "26.1" must be valid SemVer.'],
  );
});
