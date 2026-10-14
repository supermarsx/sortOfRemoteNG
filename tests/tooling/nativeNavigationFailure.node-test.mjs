import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = new URL(
  "../../src-tauri/crates/sorng-browser-host/src/",
  import.meta.url,
);
const app = new URL("../../src-tauri/src/", import.meta.url);

test("production load classifier compiles and tests without Cargo or CEF", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "native-navigation-failure-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = path.join(
    root,
    process.platform === "win32" ? "failure.exe" : "failure",
  );
  execFileSync(
    "rustc",
    [
      "--edition=2021",
      "--test",
      "-Dwarnings",
      fileURLToPath(new URL("native_navigation.rs", host)),
      "-o",
      binary,
    ],
    { timeout: 60_000 },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture"], {
      encoding: "utf8",
      timeout: 15_000,
    }).trim(),
  );
});

test("CEF callback uses recoverable classification, fences the browser and never consumes error prose", async () => {
  const source = await readFile(new URL("cef_browser.rs", host), "utf8");
  assert.match(source, /include!\("cef_load\.rs"\)/);
  const load = await readFile(new URL("cef_load.rs", host), "utf8");
  assert.match(load, /classify_load_error\(code, main_frame\)/);
  assert.match(load, /page\.load_failure = Some\(failure\)/);
  assert.match(
    load,
    /!self\.shared\.accepts\(browser\.as_deref\(\)\) \|\| !self\.shared\.current\(\)/,
  );
  assert.doesNotMatch(load, /\.fault\(|\.revoke\(|\.reload\(|\.load_url\(/);
  assert.equal((load.match(/_error_text/g) ?? []).length, 1);
  assert.equal((load.match(/_failed_url/g) ?? []).length, 1);
  const loading = load.slice(0, load.indexOf("fn on_load_error"));
  assert.doesNotMatch(loading, /load_failure\s*=/);
  const loadingState = loading.slice(
    loading.indexOf("fn on_loading_state_change"),
    loading.indexOf("fn on_load_end"),
  );
  assert.match(
    loadingState,
    /if is_loading == 0 && self\.shared\.accepts\(browser\.as_deref\(\)\) && self\.shared\.current\(\)/,
  );
  assert.match(
    loadingState,
    /map_or\(true, \|state\| state\.page\.load_failure\.is_some\(\)\)/,
  );
  assert.match(loadingState, /navigating = failed/);
  assert.doesNotMatch(loadingState, /navigating\s*=\s*(?:true|is_loading)/);
  const loadEnd = loading.slice(loading.indexOf("fn on_load_end"));
  assert.match(
    loadEnd,
    /frame\.is_valid\(\) != 1 \|\| frame\.is_main\(\) != 1 \|\| main\.is_valid\(\) != 1/,
  );
  assert.match(
    loadEnd,
    /frame\.identifier\(\)[\s\S]*!= [\s\S]*main\.identifier\(\)/,
  );
  assert.match(
    loadEnd,
    /map_or\(true, \|state\| state\.page\.load_failure\.is_some\(\)\)/,
  );
  assert.match(loadEnd, /navigating = failed/);
  assert.match(load, /self\.shared\.clear_automation\(\)/);
  assert.match(load, /self\.shared\.cancel_certificate\(None\)/);
  const browse = source.slice(
    source.indexOf("fn on_before_browse"),
    source.indexOf("fn on_open_urlfrom_tab"),
  );
  assert.match(
    browse,
    /let website_navigation = request\.as_ref\(\)\.is_some_and\(\|request\| browser_origin\(&CefString::from\(&request\.url\(\)\)\.to_string\(\)\)\.is_some\(\)\)/,
  );
  assert.match(
    browse,
    /if main_frame && decision == 0 && website_navigation\s*\{\s*self\.shared\.update\(browser\.as_deref\(\), \|page\| page\.load_failure = None\)/,
  );
});

test("owner-window IPC retains only fixed load evidence and does not count failed requests as completed documents", async () => {
  const ipc = await readFile(new URL("ipc.rs", host), "utf8");
  const dto = ipc.slice(
    ipc.indexOf("pub struct OriginBrowserLoadFailure"),
    ipc.indexOf("/// Input from a native host callback"),
  );
  assert.match(dto, /code: i32/);
  assert.match(dto, /category: &'static str/);
  assert.doesNotMatch(dto, /String|url|error_text/);
  const setter = ipc.slice(
    ipc.indexOf("pub fn set_load_failure"),
    ipc.indexOf("pub fn scrub_page_state"),
  );
  assert.match(setter, /OriginBrowserPhase::Attached/);
  assert.match(
    ipc.slice(ipc.indexOf("pub fn scrub_page_state")),
    /self\.load_failure = None/,
  );
  const display = await readFile(
    new URL("origin_browser_display.rs", app),
    "utf8",
  );
  assert.match(display, /next\.set_load_failure\(load_failure\)/);
  const runtime = await readFile(
    new URL("origin_browser_runtime.rs", app),
    "utf8",
  );
  const sink = runtime.slice(
    runtime.indexOf("impl BrowserEventSink for Sink"),
    runtime.indexOf("pub\(crate\) async fn create("),
  );
  assert.match(sink, /event\.state\.load_failure\.is_none\(\)/);
  assert.match(sink, /display::publish_with_load_failure\(/);
  assert.match(
    sink,
    /Lifecycle::Attached \| Lifecycle::Hidden => OriginBrowserPhase::Attached/,
  );
  const popup = await readFile(
    new URL("origin_browser_popup_runtime.rs", app),
    "utf8",
  );
  assert.match(popup, /snapshot\.set_load_failure\(state\.load_failure\)/);
});

test("hidden diagnostic presentations synchronize input fencing without showing or focusing the page", async () => {
  const runtime = await readFile(
    new URL("origin_browser_runtime.rs", app),
    "utf8",
  );
  assert.match(
    runtime,
    /return popups::present\(view, \*revision, \*bounds, \*visible, occlusions, \*input_blocked\)/,
  );
  const popup = await readFile(
    new URL("origin_browser_popup_runtime.rs", app),
    "utf8",
  );
  const presentation = popup.slice(
    popup.indexOf("fn apply_presentation("),
    popup.indexOf("pub(super) fn present("),
  );
  const hidden = presentation.slice(
    presentation.indexOf("} else {"),
    presentation.indexOf("        Ok(())"),
  );
  assert.match(hidden, /host\.hide\(id\)/);
  assert.match(hidden, /bounds\.or\(view\.presentation_bounds/);
  assert.match(
    hidden,
    /host\.occlude\(id, bounds, occlusions, scale, input_blocked\)/,
  );
  assert.doesNotMatch(hidden, /\.show\(|\.focus\(/);
  const devtoolsStart = runtime.search(
    /OriginBrowserAction::Devtools\s*\{\s*presentation_revision\s*,?\s*\}\s*=>/,
  );
  assert.ok(devtoolsStart >= 0, "missing explicit DevTools control arm");
  const devtools = runtime.slice(
    devtoolsStart,
    runtime.indexOf("OriginBrowserAction::Presentation {", devtoolsStart),
  );
  assert.match(devtools, /presentation_revision != view\.presentation/);
  assert.match(devtools, /view\.input_blocked/);
  assert.doesNotMatch(devtools, /!view\.visible/);
  const inspector = await readFile(new URL("cef_devtools.rs", host), "utf8");
  const gate = inspector.slice(
    inspector.indexOf("fn inspector_owner_current"),
    inspector.indexOf("impl CefBrowserHost<'_>"),
  );
  assert.match(gate, /!owner\.input_blocked\.load\(Ordering::Acquire\)/);
  assert.match(
    gate,
    /Lifecycle::Hidden && state\.page\.load_failure\.is_some\(\)/,
  );
});
