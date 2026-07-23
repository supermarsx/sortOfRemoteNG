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

test("accepts machine-versioned portable Windows archives for both architectures", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(
      [
        "sortOfRemoteNG_26.1.0_windows-x86_64-portable.zip",
        "sortOfRemoteNG_26.1.0_windows-aarch64-portable.zip",
      ],
      "26.1.0",
    ),
    [],
  );
});

test("accepts machine-versioned RPM and Flatpak bundles", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(
      [
        "sortOfRemoteNG_26.1.0_linux-x86_64.rpm",
        "sortOfRemoteNG_26.1.0_linux-aarch64.flatpak",
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

test("rejects version drift in a portable Windows ARM64 archive", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(
      ["sortOfRemoteNG_26.2.0_windows-aarch64-portable.zip"],
      "26.1.0",
    ),
    [
      "sortOfRemoteNG_26.2.0_windows-aarch64-portable.zip contains version 26.2.0; expected 26.1.0.",
      "At least one bundle filename must contain the expected machine version 26.1.0.",
    ],
  );
});

test("rejects version drift in RPM and Flatpak bundles", () => {
  assert.deepEqual(
    validateReleaseArtifactNames(
      [
        "sortOfRemoteNG_26.2.0_linux-x86_64.rpm",
        "sortOfRemoteNG_26.2.0_linux-aarch64.flatpak",
      ],
      "26.1.0",
    ),
    [
      "sortOfRemoteNG_26.2.0_linux-x86_64.rpm contains version 26.2.0; expected 26.1.0.",
      "sortOfRemoteNG_26.2.0_linux-aarch64.flatpak contains version 26.2.0; expected 26.1.0.",
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
