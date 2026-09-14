import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const files = (path, extension) =>
  readdirSync(new URL(`../../${path}/`, import.meta.url), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const next = `${path}/${entry.name}`;
    return entry.isDirectory()
      ? files(next, extension)
      : extension.test(entry.name)
        ? [next]
        : [];
  });

test("every configured window disables general autofill before navigation", () => {
  const configs = readdirSync(new URL("../../src-tauri/", import.meta.url))
    .filter((name) => /^tauri(?:\..+)?\.conf\.json$/.test(name))
    .map((name) => `src-tauri/${name}`);
  assert.ok(configs.includes("src-tauri/tauri.conf.json"));
  for (const path of configs) {
    const config = JSON.parse(read(path));
    for (const window of config.app?.windows ?? [])
      assert.equal(
        window.generalAutofillEnabled,
        false,
        `${path}: ${window.label}`,
      );
  }
});

test("privacy plugin is registered before build and applies to every new webview", () => {
  const app = read("src-tauri/src/lib.rs");
  const plugin = app.indexOf(".plugin(webview_privacy::init())");
  assert.ok(plugin > app.indexOf(".plugin(tauri_plugin_dialog::init())"));
  assert.ok(plugin < app.indexOf(".setup(|app|"));
  assert.ok(plugin < app.indexOf(".build(tauri::generate_context!())"));
  const source = read("src-tauri/src/webview_privacy.rs");
  assert.match(
    source,
    /\.on_webview_ready\(\|webview\|[\s\S]*install_windows\(webview\)/,
  );
  assert.doesNotMatch(source, /\.label\(\)|get_webview_window/);
});

test("native policy disables and verifies both settings without removing profile data", () => {
  const source = read("src-tauri/src/webview_privacy.rs");
  for (const name of ["GeneralAutofill", "PasswordAutosave"]) {
    assert.match(source, new RegExp(`SetIs${name}Enabled\\(false\\)`));
    assert.match(source, new RegExp(`Is${name}Enabled\\(&mut enabled\\)`));
  }
  assert.match(source, /use settings::\{enforce, FormPrivacySettings\}/);
  assert.match(source, /enforce\(&mut Settings\(settings\)\)/);
  assert.match(source, /if result\.is_err\(\)/);
  assert.match(source, /privacy_failure\(failed_view\)/);
  assert.match(source, /Browser privacy unavailable/);
  assert.ok(source.indexOf("webview.close()") < source.indexOf(".show(move"));
  assert.doesNotMatch(
    source,
    /ClearBrowsingData|DeleteCookies|remove_dir|remove_file|\.eval\(/,
  );
});

test("detached and splash creation start private regardless of saved preferences", () => {
  const detached = read("src/hooks/session/useSessionDetach.ts");
  assert.match(
    detached,
    /new WebviewWindow\(windowLabel, \{[^]*?generalAutofillEnabled: false/,
  );
  const splash = read("src-tauri/src/splash.rs");
  assert.match(
    splash,
    /WebviewWindowBuilder::new\([^]*?\.general_autofill_enabled\(false\)/,
  );
  // A new app-owned creation site must be deliberately reviewed, not silently
  // omitted from pre-navigation defaults while relying on the later callback.
  assert.deepEqual(
    files("src", /\.[jt]sx?$/).filter((path) =>
      /new Webview(?:Window)?\(/.test(read(path)),
    ),
    ["src/hooks/session/useSessionDetach.ts"],
  );
  assert.deepEqual(
    files("src-tauri/src", /\.rs$/).filter((path) =>
      /Webview(?:Window)?Builder::new\(/.test(read(path)),
    ),
    ["src-tauri/src/splash.rs"],
  );
});

test("isolated file viewer retains its independent native privacy controls", () => {
  const source = read(
    "src-tauri/crates/sorng-file-viewer-host/src/windows_host.rs",
  );
  assert.match(source, /SetIsPasswordAutosaveEnabled\(false\)\?/);
  assert.match(source, /SetIsGeneralAutofillEnabled\(false\)\?/);
});
