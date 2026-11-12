import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const runtimeBudgetSpecs = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/cef/windows_runtime_budget_inverse.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const specs = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/cef/windows_image_refresh_inverse.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const names = {
  driver: "native/windows-arm-full-sdk/full-sdk-source-driver.mjs",
  controller: "native/windows-arm-full-sdk/full_sdk_control.mjs",
  python: "native/windows-arm-full-sdk/full_sdk_source.py",
  producer: "native/windows-arm-full-sdk/producer.py",
  profile: "native/windows-arm-full-sdk/full-sdk-source-profile.json",
  imageCurrent:
    "native/windows-arm-full-sdk/image-qualified-current-profile.json",
  engineProfile:
    "native/windows-arm-full-sdk/engine-qualification-profile.json",
  privateProfile:
    "native/windows-arm-full-sdk/private-qualification-profile.json",
};
// Exact FULL-only budget prefix; runtime admission never imports this helper.
export function withoutRuntimeBudget(text, file) {
  const spec = runtimeBudgetSpecs[file];
  assert(spec, "RUNTIME_BUDGET_SCOPE");
  assert.equal(Buffer.byteLength(text), spec.bytes, "RUNTIME_BUDGET_BYTES");
  assert.equal(sha(text), spec.sha256, "RUNTIME_BUDGET_WHOLE");
  for (const row of spec.pairs) {
    assert.equal(text.split(row.current).length, 2, "RUNTIME_BUDGET_COUNT");
    text = text.replace(row.current, () => row.previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.beforeBytes,
    "RUNTIME_BUDGET_OLD_BYTES",
  );
  assert.equal(sha(text), spec.beforeSha256, "RUNTIME_BUDGET_OLD_WHOLE");
  return text;
}
export function runtimeBudgetPrefix(text, name) {
  const file = names[name] ?? name,
    spec = runtimeBudgetSpecs[file];
  return spec && sha(text) === spec.sha256
    ? withoutRuntimeBudget(text, file)
    : text;
}
// Strict test-only whole current -> whole previous view. Never used by runtime admission.
export function withoutReviewedWindowsImage(text, file) {
  text = runtimeBudgetPrefix(text, file);
  const spec = specs[file];
  assert(spec, "IMAGE_HISTORY_SCOPE");
  assert.equal(Buffer.byteLength(text), spec.bytes, "IMAGE_HISTORY_BYTES");
  assert.equal(sha(text), spec.sha256, "IMAGE_HISTORY_WHOLE");
  for (const row of spec.pairs) {
    assert.equal(text.split(row.current).length, 2, "IMAGE_HISTORY_COUNT");
    text = text.replace(row.current, () => row.previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.beforeBytes,
    "IMAGE_HISTORY_OLD_BYTES",
  );
  assert.equal(sha(text), spec.beforeSha256, "IMAGE_HISTORY_OLD_WHOLE");
  return text;
}
// Original inverse chains also call each other with already older states. Only
// an exact current whole file receives this prefix; every other state proceeds
// unchanged to the original whole-file historical checks, which still deny drift.
export function reviewedWindowsImagePrefix(text, name) {
  text = runtimeBudgetPrefix(text, name);
  const file = names[name] ?? name,
    spec = specs[file];
  return spec && sha(text) === spec.sha256
    ? withoutReviewedWindowsImage(text, file)
    : text;
}
