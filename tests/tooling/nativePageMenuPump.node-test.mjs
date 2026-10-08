import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("completed history requests do not emit timeout diagnostics", async () => {
  const source = await readFile(
    new URL(
      "../../src-tauri/crates/sorng-browser-host/src/cef_page_menu.rs",
      import.meta.url,
    ),
    "utf8",
  );
  const expiration = source.split("struct Expire {")[1].split("fn start(")[0];
  assert.match(
    expiration,
    /is_some_and\(\|query\| query\.serial == self\.serial\)/,
  );
  assert.match(
    expiration,
    /if pending \{\s*finish\(owner, self\.serial, Err\(unavailable_at\("query-timeout"\)\)\);\s*\}/,
  );
});

test("CEF history callbacks can read the UI registry before mutable tick housekeeping", async () => {
  const runtime = await readFile(
    new URL("../../src-tauri/src/origin_browser_runtime.rs", import.meta.url),
    "utf8",
  );
  const tick = runtime
    .split("pub(crate) fn tick() {")[1]
    .split("pub(crate) fn shutdown()")[0];
  const firstMutation = tick.indexOf("cell.borrow_mut()");
  assert.ok(firstMutation > tick.indexOf("ui.runtime.work()"));
  assert.ok(firstMutation > tick.indexOf("ui.runtime.cleanup_only_work()"));
  assert.match(tick.slice(0, firstMutation), /let slot = cell\.borrow\(\);/);
  assert.match(tick.slice(0, firstMutation), /drop\(slot\);/);
  assert.doesNotMatch(tick.slice(0, firstMutation), /borrow_mut\(/);

  // Reentrancy is not permission: owner/selection checks still fail closed.
  const menu = await readFile(
    new URL("../../src-tauri/src/origin_browser_page_menu.rs", import.meta.url),
    "utf8",
  );
  assert.match(
    menu,
    /let Ok\(slot\) = slot\.try_borrow\(\) else \{\s*return false;/,
  );
  assert.match(
    menu,
    /selected\(view, &attempt, target\.as_deref\(\), mutating\)/,
  );
});
