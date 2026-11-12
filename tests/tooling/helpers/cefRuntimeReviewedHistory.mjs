import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Test-only history: these reviewed image and Mac lease edits sit outside the
// exact Linux GN/owner bodies exercised by the original qualification models.
const changes = [
  {
    before: "}\n\nexport function assertHostedBuildIdentity(\n  map,\n",
    after:
      '}\n\n// acceptedImageVersions is the reviewed, exact set of hosted images whose build-relevant contents\n// are equivalent to the map\'s own pin. It can only widen the pin to named versions: it must contain\n// the pin, hold at most four unique exact strings, and never means "any image".\nexport function assertHostedBuildIdentity(\n  map,\n',
  },
  {
    before:
      "  platform = process.platform,\n  architecture = process.arch,\n) {\n  validateRunnerMap(map, target);\n  const expected = hostedBuildHost(target, map);\n  if (\n",
    after:
      '  platform = process.platform,\n  architecture = process.arch,\n  acceptedImageVersions = [],\n) {\n  validateRunnerMap(map, target);\n  if (\n    !Array.isArray(acceptedImageVersions) ||\n    acceptedImageVersions.length > 4 ||\n    new Set(acceptedImageVersions).size !== acceptedImageVersions.length ||\n    !acceptedImageVersions.every(\n      (version) =>\n        typeof version === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(version),\n    ) ||\n    (acceptedImageVersions.length > 0 &&\n      !acceptedImageVersions.includes(map.hosted.imageVersion))\n  )\n    fail(\n      "Accepted hosted images must be an exact reviewed set containing the reviewed pin",\n    );\n  const expected = hostedBuildHost(target, map);\n  if (\n',
  },
  {
    before:
      '    env.GITHUB_REPOSITORY_VISIBILITY !== "public" ||\n    env.ImageOS !== map.hosted.imageOS ||\n    env.ImageVersion !== map.hosted.imageVersion\n  )\n    fail("Hosted build OS, architecture or reviewed image identity changed");\n',
    after:
      '    env.GITHUB_REPOSITORY_VISIBILITY !== "public" ||\n    env.ImageOS !== map.hosted.imageOS ||\n    (env.ImageVersion !== map.hosted.imageVersion &&\n      !acceptedImageVersions.includes(env.ImageVersion))\n  )\n    fail("Hosted build OS, architecture or reviewed image identity changed");\n',
  },
  {
    before:
      '            ? (target === "x86_64-apple-darwin" ||\n              target === "aarch64-apple-darwin"\n                ? 180\n                : 120) * 60_000\n            : undefined,\n',
    after:
      '            ? (target === "x86_64-apple-darwin" ||\n              target === "aarch64-apple-darwin"\n                ? 210\n                : 120) * 60_000\n            : undefined,\n',
  },
  {
    before:
      '      admission = await hostedAdmissionRecorder(preparationLogs);\n      buildHost = await early("identity", () =>\n        assertHostedBuildIdentity(map, target, env),\n      );\n      await early("capacity", async () => {\n',
    after:
      '      admission = await hostedAdmissionRecorder(preparationLogs);\n      buildHost = await early("identity", () =>\n        assertHostedBuildIdentity(\n          map,\n          target,\n          env,\n          process.platform,\n          process.arch,\n          engineering?.acceptedImageVersions ?? [],\n        ),\n      );\n      await early("capacity", async () => {\n',
  },
];
const sha = (value) => createHash("sha256").update(value).digest("hex");
export function withoutReviewedPreparationChanges(value) {
  assert.equal(Buffer.byteLength(value), 78215);
  assert.equal(
    sha(value),
    "1bb87be232f4c31256a920a999abf629c698e1933e5ec241a5deaa4b998b7e1e",
  );
  for (const { before, after } of changes) {
    assert.equal(value.split(after).length, 2);
    value = value.replace(after, before);
  }
  assert.equal(Buffer.byteLength(value), 77173);
  assert.equal(
    sha(value),
    "0b1e92b48812a697895f43a3310ac450fbecdc19c3dd1b2cc5619589bda31523",
  );
  return value;
}
