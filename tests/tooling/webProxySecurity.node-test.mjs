import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("desktop CSP permits the protected loopback mediator without arbitrary HTTP frames or IPC scope", () => {
  const config = JSON.parse(
    readFileSync(new URL("src-tauri/tauri.conf.json", root), "utf8"),
  );
  const directives = new Map(
    config.app.security.csp.split(";").map((value) => {
      const [name, ...sources] = value.trim().split(/\s+/u);
      return [name, sources];
    }),
  );
  // CSP cannot express the token's hexadecimal pattern. Only localhost
  // subdomains are allowed here; the live hook separately requires the exact
  // p<32hex>.localhost origin returned by the backend.
  assert.deepEqual(directives.get("frame-src"), ["http://*.localhost:*"]);
  assert.ok(!directives.get("connect-src").includes("http://*.localhost:*"));
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);

  const capabilities = new URL("src-tauri/capabilities/", root);
  for (const name of readdirSync(capabilities).filter((name) =>
    name.endsWith(".json"),
  )) {
    const capability = JSON.parse(
      readFileSync(new URL(name, capabilities), "utf8"),
    );
    assert.equal(
      capability.remote,
      undefined,
      `${name} must not grant IPC to remote proxy frames`,
    );
  }
});

test("native mediator ownership remains per returned session, never saved connection eviction", () => {
  const source = readFileSync(
    new URL("src-tauri/crates/sorng-protocols/src/http_cmds.rs", root),
    "utf8",
  );
  const start = source.slice(
    source.indexOf("pub async fn start_basic_auth_proxy("),
    source.indexOf("pub fn stop_basic_auth_proxy("),
  );
  assert.match(start, /let session_id = uuid::Uuid::new_v4\(\)/u);
  assert.match(start, /mgr\.sessions\.insert\(\s*session_id\.clone\(\)/u);
  assert.doesNotMatch(start, /sessions\.remove\(/u);
  assert.doesNotMatch(start, /entry\.connection_id\s*==/u);
});
