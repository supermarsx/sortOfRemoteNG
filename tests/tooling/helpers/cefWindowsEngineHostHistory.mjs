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
const metadataSpecs = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/cef/windows_metadata_diagnostic_inverse.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const worker = "native/windows-arm-full-sdk/full-sdk-engine-worker.mjs";
const cacheSpecs = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/cef/windows_siso_cache_inverse.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const capSpecs = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/cef/windows_compile_cap_inverse.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const hooksSpecs = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/cef/windows_hooks_budget_inverse.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
// Newest layer: the full source hooks/GN stage cap 3600 -> 5400 s. Only an exact
// whole current file is inverted; every other state proceeds to the older layers.
export function withoutHooksBudget(text, file) {
  const spec = hooksSpecs[file];
  if (!spec) return text;
  // Only ordinary Git text witnesses (tests/) may expand to CRLF on Windows.
  const normal = file.startsWith("tests/")
    ? text.replaceAll("\r\n", "\n")
    : text;
  if (sha(normal) !== spec.sha256) return text;
  text = normal;
  assert.equal(Buffer.byteLength(text), spec.bytes, "HOOKS_BUDGET_BYTES");
  for (const pair of spec.pairs) {
    assert.equal(text.split(pair.current).length, 2, "HOOKS_BUDGET_COUNT");
    text = text.replace(pair.current, () => pair.previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.beforeBytes,
    "HOOKS_BUDGET_OLD_BYTES",
  );
  assert.equal(sha(text), spec.beforeSha256, "HOOKS_BUDGET_OLD_WHOLE");
  return text;
}
// Outermost layer: the optional compile_cap_minutes input in the controller.
export function withoutCompileCapInput(text, file) {
  text = withoutHooksBudget(text, file);
  // The accounting-inverse tests address the workflow by its short name.
  if (file === "workflow") file = ".github/workflows/windows-arm-full-sdk.yml";
  const spec = capSpecs[file];
  if (!spec) return text;
  // The workflow is pinned by its LF index bytes; a Windows checkout is CRLF.
  const normal = file.endsWith(".yml") ? text.replaceAll("\r\n", "\n") : text;
  if (sha(normal) !== spec.sha256) return text;
  text = normal;
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "COMPILE_CAP_HISTORY_BYTES",
  );
  for (const pair of spec.pairs) {
    assert.equal(
      text.split(pair.current).length,
      2,
      "COMPILE_CAP_HISTORY_COUNT",
    );
    text = text.replace(pair.current, () => pair.previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.beforeBytes,
    "COMPILE_CAP_HISTORY_OLD_BYTES",
  );
  assert.equal(sha(text), spec.beforeSha256, "COMPILE_CAP_HISTORY_OLD_WHOLE");
  return text;
}
export function withoutSisoMetadataCache(text, file) {
  text = withoutCompileCapInput(text, file);
  if (file === "tests/tooling/windowsArmFullSdk.node-test.mjs")
    text = text.replaceAll("\r\n", "\n");
  const spec = cacheSpecs[file];
  assert(spec, "SISO_CACHE_HISTORY_SCOPE");
  assert.equal(Buffer.byteLength(text), spec.bytes, "SISO_CACHE_HISTORY_BYTES");
  assert.equal(sha(text), spec.sha256, "SISO_CACHE_HISTORY_WHOLE");
  for (const pair of spec.pairs) {
    assert.equal(
      text.split(pair.current).length,
      2,
      "SISO_CACHE_HISTORY_COUNT",
    );
    text = text.replace(pair.current, () => pair.previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.beforeBytes,
    "SISO_CACHE_HISTORY_OLD_BYTES",
  );
  assert.equal(sha(text), spec.beforeSha256, "SISO_CACHE_HISTORY_OLD_WHOLE");
  return text;
}
export function sisoMetadataCachePrefix(text, file) {
  text = withoutCompileCapInput(text, file);
  const spec = cacheSpecs[file];
  if (file === "tests/tooling/windowsArmFullSdk.node-test.mjs")
    text = text.replaceAll("\r\n", "\n");
  return spec && sha(text) === spec.sha256
    ? withoutSisoMetadataCache(text, file)
    : text;
}
// Test DATA only: never imported by native execution or SDK admission.
export function withoutSourceMetadataDiagnostic(text, file) {
  text = sisoMetadataCachePrefix(text, file);
  const spec = metadataSpecs[file];
  assert(spec, "METADATA_HISTORY_SCOPE");
  assert.equal(Buffer.byteLength(text), spec.bytes, "METADATA_HISTORY_BYTES");
  assert.equal(sha(text), spec.sha256, "METADATA_HISTORY_WHOLE");
  for (const pair of spec.pairs) {
    assert.equal(text.split(pair.current).length, 2, "METADATA_HISTORY_COUNT");
    text = text.replace(pair.current, () => pair.previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.beforeBytes,
    "METADATA_HISTORY_OLD_BYTES",
  );
  assert.equal(sha(text), spec.beforeSha256, "METADATA_HISTORY_OLD_WHOLE");
  return text;
}
export function sourceMetadataDiagnosticPrefix(text, file) {
  text = sisoMetadataCachePrefix(text, file);
  const spec = metadataSpecs[file];
  return spec && sha(text) === spec.sha256
    ? withoutSourceMetadataDiagnostic(text, file)
    : text;
}
export function withoutEngineHostArchitecture(text, file = worker) {
  text = sourceMetadataDiagnosticPrefix(text, file);
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
  text = sourceMetadataDiagnosticPrefix(text, file);
  const spec = specs[file];
  return spec && sha(text) === spec.sha256
    ? withoutEngineHostArchitecture(text, file)
    : text;
}
