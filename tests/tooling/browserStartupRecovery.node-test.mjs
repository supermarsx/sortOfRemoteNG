import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

test("diagnostic delivery stays bounded and nonblocking with a stalled writer (std-only rustc)", async (t) => {
  const source = await readFile(new URL("../../src-tauri/src/origin_browser_startup_diagnostics.rs", import.meta.url), "utf8");
  const start = source.indexOf("// BEGIN std-only diagnostic delivery");
  const end = source.indexOf("// END std-only diagnostic delivery");
  assert.ok(start >= 0 && end > start);
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-diagnostic-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const harness = path.join(root, "delivery.rs");
  const binary = path.join(root, process.platform === "win32" ? "delivery.exe" : "delivery");
  // Compile the production worker and its own Rust tests, without Cargo or CEF.
  await writeFile(harness, source.slice(start, end));
  execFileSync("rustc", ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary], { timeout: 60_000 });
  t.diagnostic(execFileSync(binary, ["--nocapture"], { encoding: "utf8", timeout: 15_000 }).trim());
  assert.match(source, /delivery::start_worker\(MAX_RECORDS,/);
  const callers = source.slice(source.indexOf("pub(crate) fn begin(root:"), source.lastIndexOf("#[cfg(test)]"));
  assert.doesNotMatch(callers, /\.lock\(|\.send\(|sync_data|open_journal|log::/);
  // Startup, lifecycle and navigation/renderer evidence all use the worker.
  assert.equal((callers.match(/delivery::enqueue/g) ?? []).length, 3);
});

test("startup preparation does not acquire the settings mutex; explicit settings writes still do", async () => {
  const source = await readFile(new URL("../../src-tauri/crates/sorng-commands-core/src/browser_data_commands.rs", import.meta.url), "utf8");
  const preflight = source.slice(source.indexOf("pub fn prepare_for_startup("), source.indexOf("pub fn get_browser_data_directory("));
  assert.doesNotMatch(preflight, /ACCESS|\.lock\(/);
  assert.match(preflight, /prepare_startup_directory\(&ACTIVE_ROOT,/);
  const writer = source.slice(source.indexOf("pub fn set_browser_data_directory("), source.indexOf("pub fn open_browser_data_directory("));
  assert.match(writer, /ACCESS\s*\.lock\(/);
  assert.match(source, /let location = read_location\(app_data\);\s*prepare_with_location\(app_data, identifier, alternatives, location\)/);
  assert.match(source, /fn cancelled_blocked_preparation_does_not_block_settings_or_retarget_snapshot\(/);
});
