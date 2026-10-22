import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../native/cef-patches/", import.meta.url);
const patch = await readFile(
  new URL(
    "154.0.8037.58-682c378/0008-chromium-same-authority-http2.patch",
    root,
  ),
  "utf8",
);
const added = patch
  .split(/\r?\n/)
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .map((line) => line.slice(1))
  .join("\n");

test("protected H2 enables multiplexing while preserving caller ALPN exclusions", () => {
  assert.match(added, /session_params\.enable_http2 = true/);
  assert.match(added, /std::erase_if\(ssl_config_\.alpn_protos/);
  assert.match(
    added,
    /proto != NextProto::kProtoHTTP2 && proto != NextProto::kProtoHTTP11/,
  );
  assert.doesNotMatch(added, /alpn_protos\s*=\s*\{/);
  // The patch must leave these pre-existing barriers untouched.
  for (const invariant of [
    "enable_http2_alternative_service = false",
    "enable_quic = false",
    "enable_early_data = false",
  ]) {
    assert.ok(patch.includes(invariant));
    assert.ok(!patch.includes(`-    session_params.${invariant}`));
  }
});

test("every protected session alias path requires exact authority/context key", () => {
  // Three exact-key retrieval guards plus the two independent alias-creation
  // guards are necessary: disabling only DNS pooling leaves IP aliases open.
  assert.equal((added.match(/tls_admission_delegate\(\)/g) ?? []).length, 5);
  assert.equal(
    (added.match(/key [!=]= it->second->spdy_session_key\(\)/g) ?? []).length,
    3,
  );
  assert.match(added, /return nullptr/);
  assert.match(added, /return false/);
  assert.doesNotMatch(
    added,
    /MapKeyToAvailableSession|AddPooledAlias|VerifyDomainAuthentication/,
  );
});

test("new H2 capability is distinct from legacy H1 and reserved H3", async () => {
  const header = await readFile(
    new URL("cef_sorng_tls_bridge.h", root),
    "utf8",
  );
  assert.match(header, /CEF_SORNG_TLS_CAP_HTTP1_ONLY \(1ull << 2\)/);
  assert.match(header, /CEF_SORNG_TLS_CAP_SAME_AUTHORITY_HTTP2 \(1ull << 6\)/);
  assert.doesNotMatch(header, /#define CEF_SORNG_TLS_CAP_\w+ \(1ull << 7\)/);
});
