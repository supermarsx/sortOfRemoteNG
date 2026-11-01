import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) =>
  fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("intercepted CEF proxy leaves cannot populate the website certificate inspector", () => {
  const source = read("src-tauri/src/origin_browser_tls.rs");
  const start = source.indexOf("if let Some(intercept) = self.intercept.get()");
  const end = source.indexOf("// Do not even create TOFU records", start);
  assert.ok(
    start > 0 && end > start,
    "locate the complete interception fast path",
  );
  const fastPath = source.slice(start, end);
  assert.match(fastPath, /intercepted_admission/);
  assert.match(fastPath, /return;/);
  assert.doesNotMatch(fastPath, /security\s*\.\s*record/);
  const upstream = read("src-tauri/src/origin_browser_upstream_trust.rs");
  assert.match(
    upstream,
    /permit\.permits\(&attempt\.identity, &origin, &chain\)/,
  );
  assert.match(
    upstream,
    /attempt\.security\.record_transport\(&origin, &chain, e\.system_ca_valid, Some\(reviewed\)/,
  );
});

test("website security reader is shell-only and fences exact active identity and current native document", () => {
  const commands = read("src-tauri/src/origin_browser_commands.rs");
  const command = commands.slice(
    commands.indexOf("pub(crate) async fn origin_browser_security_info("),
    commands.indexOf("pub(crate) async fn origin_browser_security_info(") + 800,
  );
  assert.match(command, /require_shell\(&window\)/);
  assert.match(command, /request\.identity\.validate\(\)/);
  assert.match(
    read("src-tauri/src/invoke_handler.rs"),
    /crate::origin_browser_commands::origin_browser_security_info,/,
  );
  const runtime = read("src-tauri/src/origin_browser_runtime.rs");
  const reader = runtime.slice(
    runtime.indexOf("pub(crate) async fn security_info("),
    runtime.indexOf("pub(crate) fn status("),
  );
  assert.match(reader, /lookup\(&window, &request\.identity\)/);
  assert.match(reader, /attempt\.current\(\)/);
  assert.match(reader, /matches_page\(/);
  assert.match(reader, /request\.view_id != view\.popups\.selected/);
  assert.match(reader, /inventory\.sequence == request\.sequence/);
  assert.match(reader, /PopupPhase::Adopted/);
  assert.match(
    reader,
    /snapshot\.sequence\(\), snapshot\.current_url\(\), &request/,
  );
  assert.doesNotMatch(
    reader,
    /navigate|connect|reqwest|TcpStream|fetch|approve|remember/,
  );
});
