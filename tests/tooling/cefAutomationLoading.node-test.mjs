import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("production automation fences follow main-document navigation, not child loading", async (t) => {
  const base = new URL(
    "../../src-tauri/crates/sorng-browser-host/src/",
    import.meta.url,
  );
  const source = await readFile(new URL("cef_browser.rs", base), "utf8");
  const fixture = await readFile(
    new URL("fixtures/cefAutomationLoading.rs", import.meta.url),
    "utf8",
  );
  const load = block(source, "wrap_load_handler! {");
  // The richer load-error diagnostics are a separate, pending concern. HEAD
  // faults/revokes on main-load errors; run this regression on either contract.
  const diagnosticLoads = load.includes(
    "crate::native_navigation::classify_load_error",
  );
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-automation-loading-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-automation-loading-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "contract.exe" : "contract",
  );
  // CEF endpoint doubles, but unmodified production callback bodies and the
  // actual availability predicate used by cef_login_typing. No browser/network.
  await writeFile(
    harness,
    fixture
      .replace("/* PRODUCTION_LOAD */", load)
      .replace(
        "/* PRODUCTION_BEFORE_BROWSE */",
        block(source, "fn on_before_browse("),
      )
      .replace(
        "/* PRODUCTION_AVAILABLE */",
        block(source, "fn available(&self)"),
      )
      .replace(
        "/* PRODUCTION_NAVIGATION */",
        diagnosticLoads
          ? `#[path = ${JSON.stringify(fileURLToPath(new URL("native_navigation.rs", base)))}]\nmod native_navigation;`
          : "",
      ),
  );
  execFileSync(
    "rustc",
    [
      "--edition=2021",
      "--test",
      "-Dwarnings",
      ...(!diagnosticLoads ? ["--cfg", "head_load_fault"] : []),
      harness,
      "-o",
      binary,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }).trim(),
  );
});
