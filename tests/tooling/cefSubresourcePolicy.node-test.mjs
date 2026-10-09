import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compile the production request-class mapping and admission/redirect callbacks.
// Only the CEF containers, session and permission endpoints are test doubles;
// this is a boundary contract test, not native containment or RDWeb acceptance.
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

test("native generic subresources retain fetch, initiator, worker and redirect admission (std-only rustc)", async (t) => {
  const source = await readFile(
    new URL(
      "../../src-tauri/crates/sorng-browser-host/src/cef_requests.rs",
      import.meta.url,
    ),
    "utf8",
  );
  const fixture = await readFile(
    new URL("fixtures/cefSubresourcePolicy.rs", import.meta.url),
    "utf8",
  );
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
  ]
    .map((marker) => block(source, marker))
    .join("\n");
  const callbacks = ["fn on_before_resource_load(", "fn on_resource_redirect("]
    .map((marker) => block(source, marker))
    .join("\n");
  // The pinned enum has no WebSocket variant. Its separate native transport
  // must never become a generic request, nor may URL suffixes infer a class.
  assert.doesNotMatch(
    block(source, "fn native_request_class("),
    /url|header|extension|socket/i,
  );
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sorng-subresource-policy-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("sorng-subresource-policy-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "contract.exe" : "contract",
  );
  await writeFile(
    harness,
    `${fixture}\n#[path = ${JSON.stringify(fileURLToPath(new URL("../../src-tauri/crates/sorng-browser-host/src/native_redirect_policy.rs", import.meta.url)))}]\nmod redirect_policy;\n${functions}\nimpl SessionResourceRequestHandler {\n${callbacks}\n}\n`,
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    }).trim(),
  );
});
