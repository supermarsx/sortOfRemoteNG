// Source-routing guards, not proof of live CEF creation or command acceptance.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) =>
  (await readFile(new URL(`../../${file}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");

test("explicit tabs capture the native frame and reuse the private-context deferred path", async () => {
  const source = await read("src-tauri/crates/sorng-browser-host/src/cef_popups.rs");
  const method = source.slice(source.indexOf("pub fn open_tab("), source.indexOf("fn download_slots("));
  assert.match(method, /self\s*\.check\(identity\)/);
  assert.match(method, /browser\.main_frame\(\)/);
  assert.match(method, /frame\.url\(\)/);
  assert.match(method, /self\.authorize\(identity, &target\)/);
  assert.match(method, /open_url_from_tab\(/);
  assert.doesNotMatch(method, /display\.url|snapshot|PrivateRequestContext::/);
  const deferred = source.slice(source.indexOf("struct DeferredLinkTab"), source.indexOf("pub(super) fn after_created"));
  assert.match(deferred, /pending_navigation_allowed\(&self\.view_id, &self\.target/);
  assert.match(deferred, /Some\(&mut context\.native\.clone\(\)\)/);
  assert.match(source, /context\.is_same\(Some\(&mut group\.context\.native\.clone\(\)\)\)/);
});

test("open-tab is lease rechecked and fenced to interactive selected presentation", async () => {
  const runtime = await read("src-tauri/src/origin_browser_popup_runtime.rs");
  const lease = runtime.slice(runtime.indexOf("pub(crate) async fn operate"), runtime.indexOf("let (sender, receiver)"));
  assert.match(lease, /PopupAction::OpenTab \{ \.\. \}/);
  assert.match(lease, /\.recheck\(&window, state\)/);
  const arm = runtime.slice(runtime.indexOf("PopupAction::OpenTab {\n"), runtime.indexOf("PopupAction::Control { view_id, action } =>"));
  assert.match(arm, /!view\.visible \|\| view\.input_blocked/);
  assert.match(arm, /presentation_revision != view\.presentation/);
  assert.match(arm, /with_target\(view, view_id\.as_deref\(\)/);
  assert.match(arm, /host\.open_tab\(&attempt\.identity, url\.as_deref\(\)\)/);
  assert.match(runtime, /target != view\.popups\.selected\.as_deref\(\)/);
});

test("popup inventory is delivered only to the owning webview window", async () => {
  const runtime = await read("src-tauri/src/origin_browser_popup_runtime.rs");
  assert.match(runtime, /view\.window\.emit_to\(\s*tauri::EventTarget::webview_window\(view\.window\.label\(\)\)/);
  assert.doesNotMatch(runtime, /\.emit\(EVENT,/);
});

test("OpenTab command schema validates the source, optional address, view and presentation", async () => {
  const commands = await read("src-tauri/src/origin_browser_commands.rs");
  assert.match(commands, /OpenTab \{ view_id: Option<String>, url: Option<String>, presentation_revision: u64 \}/);
  assert.match(commands, /tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields/);
  const validation = commands.slice(commands.indexOf("impl PopupRequest"), commands.indexOf("pub(crate) async fn origin_browser_popup"));
  assert.match(validation, /self\.source_identity\.validate\(\)/);
  const open = validation.slice(validation.indexOf("PopupAction::OpenTab"), validation.indexOf("PopupAction::Control"));
  assert.match(open, /\*presentation_revision == 0 \|\| \*presentation_revision > MAX_JS_INTEGER/);
  assert.match(open, /if let Some\(url\) = url/);
  assert.match(open, /OriginBrowserNavigateRequest[\s\S]*\.validate\(\)/);
  assert.match(open, /view_id\.as_ref\(\)/);
  assert.match(validation, /id\.is_empty\(\) \|\| id\.len\(\) > 256/);
});
