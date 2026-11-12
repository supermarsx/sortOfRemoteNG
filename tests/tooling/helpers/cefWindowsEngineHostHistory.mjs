import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const specs = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/cef/windows_engine_host_arch_inverse.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const worker = "native/windows-arm-full-sdk/full-sdk-engine-worker.mjs";
// Test DATA only: never imported by native execution or SDK admission.
export function withoutEngineHostArchitecture(text, file = worker) {
  const spec = specs[file];
  assert(spec, "ENGINE_HOST_SCOPE");
  assert.equal(Buffer.byteLength(text), spec.bytes, "ENGINE_HOST_BYTES");
  assert.equal(sha(text), spec.sha256, "ENGINE_HOST_WHOLE");
  for (const pair of spec.pairs) {
    assert.equal(text.split(pair.current).length, 2, "ENGINE_HOST_COUNT");
    text = text.replace(pair.current, () => pair.previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.beforeBytes,
    "ENGINE_HOST_OLD_BYTES",
  );
  assert.equal(sha(text), spec.beforeSha256, "ENGINE_HOST_OLD_WHOLE");
  return text;
}
export function engineHostArchitecturePrefix(text, file = worker) {
  const spec = specs[file];
  return spec && sha(text) === spec.sha256
    ? withoutEngineHostArchitecture(text, file)
    : text;
}
