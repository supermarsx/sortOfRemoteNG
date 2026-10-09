import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = path.join(repo, "src-tauri/crates/sorng-browser-host/src");

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

// Exercise the actual startup callback and helper with a std-only CommandLine
// double. This neither links/launches CEF nor proves a live RDWeb portal works.
test("browser startup excludes only the XSLT trial and preserves migrated profiles", async (t) => {
  const source = await readFile(
    path.join(sourceRoot, "cef_runtime.rs"),
    "utf8",
  );
  const fixture = await readFile(
    new URL("fixtures/cefStartupFieldTrials.rs", import.meta.url),
    "utf8",
  );
  const callback = block(source, "fn on_before_command_line_processing(");
  const dns = source.match(
    /pub const NATIVE_HOST_RESOLVER_RULES: &str = "[^"]+";/u,
  );
  assert.ok(dns, "Pinned DNS route constraint must remain available");
  assert.match(
    block(source, "pub fn native_settings("),
    /command_line_args_disabled:\s*1/u,
    "Ambient CLI cannot silently change packaged profile migration features",
  );
  const helper = path.join(sourceRoot, "cef_startup_features.rs");
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-startup-fieldtrials-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-startup-fieldtrials-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "contract.exe" : "contract",
  );
  await writeFile(
    harness,
    `#[path = ${JSON.stringify(helper.replaceAll("\\", "/"))}]\nmod startup_features;\n${dns[0]}\n${fixture}\nimpl RuntimeApplication {\n${callback}\n}\n`,
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary],
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
      timeout: 30_000,
      windowsHide: true,
    }).trim(),
  );
});
