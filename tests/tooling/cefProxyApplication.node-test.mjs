import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PROXY_APPLIED_BRIDGE_PATCH_ID as BRIDGE_PATCH_ID,
  PROXY_APPLIED_BRIDGE_V2 as BRIDGE_V2,
  HTTP2_BRIDGE_PATCH_ID,
  HTTP2_BRIDGE_V2,
} from "../../scripts/lib/browser-custom-runtime.mjs";

const root = new URL("../../native/cef-patches/", import.meta.url);
const chromium = await readFile(
  new URL(
    "154.0.8037.58-682c378/0010-chromium-proxy-application-ack.patch",
    root,
  ),
  "utf8",
);
const cef = await readFile(
  new URL("154.0.8037.58-682c378/0011-cef-proxy-application-ack.patch", root),
  "utf8",
);
const additions = (patch) =>
  patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");

test("proxy ACK revision is additive to H2 and cannot be claimed by old engine metadata", () => {
  assert.equal(BRIDGE_PATCH_ID, "sorng-tls-v2-682c378-3");
  assert.equal(HTTP2_BRIDGE_PATCH_ID, "sorng-tls-v2-682c378-2");
  assert.deepEqual(
    BRIDGE_V2.capabilities.filter((v) => v !== "proxy-applied"),
    HTTP2_BRIDGE_V2.capabilities,
  );
  assert.match(cef, /CAP_PROXY_APPLIED \(1ull << 8\)/);
  assert.doesNotMatch(cef, /#define.*\(1ull << 7\)/);
  assert.doesNotMatch(
    cef,
    /[+-]\s+(uint32_t|uint64_t|void\*) (size|abi_version|context_token|generation|user_data);/,
  );
});

test("engine fences the config pipe and validates effective config before any resolution", () => {
  const code = additions(chromium);
  assert.match(code, /GetLatestProxyConfig/);
  assert.match(code, /current\.value\(\)\.Equals\(expected\)/);
  assert.match(code, /proxy_config_generation_ == generation/);
  assert.match(code, /client->FlushProxyConfig/);
  assert.match(code, /WrapCallbackWithDefaultInvokeIfNotRun/);
  assert.doesNotMatch(
    code,
    /FlushForTesting\(|ForceReloadProxyConfig\(|ResolveHost\(|LookUpProxyForURL\(/,
  );
  assert.ok(
    code.indexOf("!matches()") < code.indexOf("client->FlushProxyConfig"),
  );
});

test("exact context proxy lookup rejects direct/fallback/foreign endpoint and stale completion", () => {
  const code = additions(cef);
  assert.match(code, /chains\.size\(\) != 1/);
  assert.match(code, /!chains\[0\]\.is_single_proxy\(\)/);
  assert.match(code, /!server\.is_http\(\)/);
  assert.match(code, /host\(\) != "127\.0\.0\.1"/);
  assert.match(code, /port\(\) != proxy_port_/);
  assert.match(code, /!proxy_pending_ \|\| revoked_/);
  assert.match(code, /base::Seconds\(10\)/);
  assert.match(
    code,
    /if \(proxy_pending_ \|\| proxy_applied_\) \{\s*ProxyFail\(\);\s*return;/,
  );
  assert.match(code, /Report\(kProxyApplied\)/);
  // The registry retains revoked tombstones beyond StoragePartition lifetime.
  assert.match(
    code,
    /base::WeakPtr<content::StoragePartition> proxy_partition_/,
  );
  assert.match(code, /proxy_partition_\.reset\(\);\s*proxy_pending_ = false;/);
  assert.doesNotMatch(code, /raw_ptr<content::StoragePartition>/);
  assert.doesNotMatch(
    code,
    /CreateURLLoader|CreateTCP|ResolveHost|ClearBadProxiesCache|CreateDirect/,
  );
});

test("revision four retires only detached quiescent registrations with keyed deferred lookup", async () => {
  const patch = await readFile(
    new URL(
      "154.0.8037.58-682c378/0012-cef-registration-retirement.patch",
      root,
    ),
    "utf8",
  );
  const code = additions(patch);
  assert.match(code, /CAP_BOUNDED_CONTEXT_RETIREMENT \(1ull << 9\)/);
  assert.match(code, /static sorng_tls::TokenHighWater tokens/);
  assert.match(code, /RegistrationTokens\(\)\.Reserve/);
  assert.match(code, /RegistrationCallbackScope callback_scope\(lifetime_\)/);
  assert.equal(
    (code.match(/RegistrationCallbackScope callback_scope\(lifetime_\)/g) ?? [])
      .length,
    2,
  );
  assert.match(code, /callback_depth_ == 0/);
  assert.match(code, /it->second->generation\(\) == generation/);
  assert.match(code, /RetirementTaskReady\(\)/);
  assert.match(code, /Registrations\(\)\.erase\(it\)/);
  assert.doesNotMatch(
    code,
    /Unretained\(this\)|delete this|reinterpret_cast<uint64_t>/,
  );
  const host = await readFile(
    new URL(
      "../../src-tauri/crates/sorng-browser-host/src/cef_tls_bridge.rs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(host, /PROXY_APPLIED_PATCH_ID: &str = "sorng-tls-v2-682c378-3"/);
  assert.match(host, /PATCH_ID: &str = "sorng-tls-v2-682c378-4"/);
  assert.match(
    host,
    /capabilities & BOUNDED_RETIREMENT != 0[\s\S]*?remove\(&owner.state.token\)/,
  );
});
