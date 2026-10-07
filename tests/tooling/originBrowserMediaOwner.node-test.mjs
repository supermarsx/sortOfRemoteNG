import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Wiring regressions only. The Rust tests alongside MediaOwner exercise its
// decisions; these checks neither launch CEF nor claim device/runtime acceptance.
const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
const login = await read('src-tauri/src/origin_browser_login.rs');
const host = await read('src-tauri/crates/sorng-browser-host/src/cef_browser.rs');

test('production login hooks override the denying default with the exact owner and live lease', () => {
  const hooks = login.slice(login.indexOf('impl NativeDocumentHooks for LoginHooks'));
  assert.match(hooks, /fn media_permission_current\(&self, identity: &BrowserIdentity\) -> bool/);
  assert.match(hooks, /self\.media_owner\s*\.current\(identity, \|\| self\.lease\.is_current\(\)\)/);
  assert.match(login, /identity == &self\.identity/);
});

test('manual and automatic login both capture media ownership independently of login consent', () => {
  const prepare = login.slice(login.indexOf('pub(crate) async fn prepare('), login.indexOf('pub(crate) fn revoke('));
  const manual = prepare.slice(prepare.indexOf('if !authority.enabled()'), prepare.indexOf('let provider ='));
  assert.match(manual, /media_owner: MediaOwner::new\(identity\)/);
  assert.match(manual, /consent: None/);
  assert.equal([...prepare.matchAll(/media_owner: MediaOwner::new\(identity\)/g)].length, 2);
});

test('stale media challenges drop their denial token before native prompt dispatch', () => {
  const request = login.slice(login.indexOf('fn on_media_permission('), login.indexOf('fn on_main_document('));
  assert.match(request, /if !self\.media_permission_current\(&challenge\.identity\)\s*\{\s*return;/);
  assert.ok(request.indexOf('return;') < request.indexOf('super::media::request('));
  assert.match(request, /super::media::request\(&self\.window, self\.lease\.clone\(\), challenge, completion\)/);
  assert.doesNotMatch(request, /\.complete\(true\)/);
});

test('attempt revocation invalidates media even when manual login has no consent', () => {
  const revoke = login.slice(login.indexOf('pub(crate) fn revoke('), login.indexOf('pub(crate) fn form_configuration('));
  assert.ok(revoke.indexOf('self.media_owner.revoke();') >= 0);
  assert.ok(revoke.indexOf('self.media_owner.revoke();') < revoke.indexOf('if let Some(consent)'));
});

test('owner liveness remains additive to saved capability and exact document checks', async () => {
  const owner = host.slice(host.indexOf('fn media_owner_current('), host.indexOf('fn cancel_media('));
  assert.match(owner, /self\.capabilities\.media_stream_enabled\s*&& self\.current\(\)/);
  assert.match(owner, /hooks\.media_permission_current\(&self\.identity\)/);
  const document = host.slice(host.indexOf('fn media_document('), host.indexOf('fn request_media('));
  assert.match(document, /https_origin\(&frame_url\)\.as_deref\(\) != Some\(origin\)/);
  assert.match(document, /https_origin\(&main_frame_url\)\.as_deref\(\) != Some\(origin\)/);
  const preferences = await read('src-tauri/src/origin_browser_preferences.rs');
  assert.match(preferences, /media_stream_enabled: enabled\("mediaStreamEnabled"\)/);
  assert.match(preferences, /let enabled = \|key\| get\(key\)\.and_then\(Value::as_bool\)\.unwrap_or\(true\)/);
  assert.match(preferences, /overrides\s*\.and_then\(\|row\| row\.get\(key\)\)\s*\.or_else\(\|\| globals\.get\(key\)\)/);
});
