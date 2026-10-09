import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compile unmodified production callbacks with endpoint doubles. This proves
// callback policy and a local socket gate, not live CEF/Google containment.
function block(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing production boundary: ${marker}`);
  const brace = source.indexOf("{", start);
  let depth = 1;
  for (let end = brace + 1; end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}" && --depth === 0)
      return source.slice(start, end + 1);
  }
  assert.fail(`Unclosed production boundary: ${marker}`);
}

test("denied redirects stay request-local only with complete native evidence (std-only rustc)", async (t) => {
  const base = new URL("../../src-tauri/crates/sorng-browser-host/src/", import.meta.url);
  const source = await readFile(new URL("cef_requests.rs", base), "utf8");
  const doubles = await readFile(new URL("fixtures/cefSubresourcePolicy.rs", import.meta.url), "utf8");
  const cases = await readFile(new URL("fixtures/cefRedirectIsolation.rs", import.meta.url), "utf8");
  const functions = [
    "pub(crate) fn context_resource_handler(",
    "fn resource_handler_with_denial(",
    "fn ordinary_redirect_resource(",
    "fn verified_redirect_frame(",
    "fn native_request_class(",
    "struct ResourceScope",
    "impl ResourceScope",
    "fn resolve_resource(",
    "fn scoped_request_allowed(",
    "fn observe_admitted_request(",
    "fn lock_attempt<'a>(",
    "fn revoke_attempt(",
  ].map((marker) => block(source, marker)).join("\n");
  const callbacks = ["fn on_before_resource_load(", "fn on_resource_redirect("]
    .map((marker) => block(source, marker)).join("\n");
  const root = await mkdtemp(path.join(os.tmpdir(), "sorng-redirect-policy-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("sorng-redirect-policy-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(root, process.platform === "win32" ? "contract.exe" : "contract");
  const policyPath = JSON.stringify(fileURLToPath(new URL("native_redirect_policy.rs", base)));
  await writeFile(harness, `${doubles}\n#[path = ${policyPath}]\nmod redirect_policy;\n${functions}\nimpl SessionResourceRequestHandler {\n${callbacks}\n}\n${cases}\n`);
  execFileSync("rustc", ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary], {
    cwd: root, encoding: "utf8", timeout: 60_000,
  });
  t.diagnostic(execFileSync(binary, ["--nocapture"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  }).trim());
});
