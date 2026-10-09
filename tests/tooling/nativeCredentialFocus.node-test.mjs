import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("manual typing checks the owning foreground window, not shell keyboard focus", async (t) => {
  const source = await readFile(
    new URL(
      "../../src-tauri/src/origin_browser_manual_input.rs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf('#[cfg(target_os = "windows")]');
  const end = source.indexOf("fn selected(", start);
  assert.ok(start >= 0 && end > start);
  const guards = source.slice(start, end);
  const operation = source.slice(end);
  assert.match(operation, /!owner_window_has_focus\(&window\)/u);
  assert.match(operation, /!owner_window_has_focus\(&owner_window\)/u);
  assert.doesNotMatch(operation, /\.is_focused\(/u);
  assert.match(operation, /view\.popups\.selected\.as_deref\(\) == target/u);
  assert.match(operation, /Arc::ptr_eq\(&view\.attempt, attempt\)/u);
  assert.match(operation, /\.recheck\(&window, state\)/u);
  assert.match(operation, /!v\.input_blocked/u);
  const fixture = await readFile(
    new URL("fixtures/nativeCredentialFocus.rs", import.meta.url),
    "utf8",
  );
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-credential-focus-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-credential-focus-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "contract.exe" : "contract",
  );
  // Run both OS branches everywhere with deterministic window-system doubles.
  // This tests the production gate, without focusing windows or starting CEF.
  const [windowsGuard, otherGuard] = guards.split(
    '#[cfg(not(target_os = "windows"))]',
  );
  assert.ok(otherGuard);
  await writeFile(
    harness,
    fixture.replace(
      "/* PRODUCTION_GUARDS */",
      windowsGuard.replace('#[cfg(target_os = "windows")]', "") +
        otherGuard.replace(
          "fn owner_window_has_focus",
          "fn non_windows_owner_window_has_focus",
        ),
    ),
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary],
    {
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    },
  );
  t.diagnostic(
    execFileSync(binary, ["--test-threads=1"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }).trim(),
  );
});
