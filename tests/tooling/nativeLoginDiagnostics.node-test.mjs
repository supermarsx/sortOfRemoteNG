import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const app = new URL("../../src-tauri/src/", import.meta.url);

test("production per-attempt diagnostic gate is bounded under repeated and concurrent callbacks", async (t) => {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-login-diagnostics-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-login-diagnostics-"));
    await rm(root, { recursive: true, force: true });
  });
  const binary = path.join(
    root,
    process.platform === "win32" ? "gate.exe" : "gate",
  );
  execFileSync(
    "rustc",
    [
      "--edition=2021",
      "--test",
      "-Dwarnings",
      fileURLToPath(new URL("origin_browser_observation_gate.rs", app)),
      "-o",
      binary,
    ],
    { timeout: 60_000, windowsHide: true },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }).trim(),
  );
});

test("renderer evidence uses owner-fenced fixed checkpoints, never page or credential data", async () => {
  const login = await readFile(new URL("origin_browser_login.rs", app), "utf8");
  const feature = login.slice(
    login.indexOf("fn on_feature_status("),
    login.indexOf("fn appearance_configuration("),
  );
  assert.match(
    feature,
    /media_owner\.current\(identity, \|\| self\.lease\.is_current\(\)\)/,
  );
  assert.match(feature, /observations\.feature\(code\)/);
  assert.equal((feature.match(/_origin/g) ?? []).length, 1);
  assert.doesNotMatch(
    feature,
    /format!|log::|\.lock\(|\.await|\.url\(|credentials\./,
  );
  const checkpoints = [...feature.matchAll(/=>\s*\((\d+),\s*"([a-z-]+)"\)/g)];
  assert.equal(checkpoints.length, 25);
  assert.equal(new Set(checkpoints.map((m) => m[1])).size, 25);
  assert.ok(checkpoints.some((m) => m[2] === "renderer-installation-failed"));
  assert.ok(checkpoints.some((m) => m[2] === "native-rejected-grant"));
  assert.match(login, /Native::ResourceAdmission/);
  const journal = await readFile(
    new URL("origin_browser_startup_diagnostics.rs", app),
    "utf8",
  );
  assert.match(journal, /observation_records >= 512/);
  assert.match(journal, /!relay\s*&& !observation\s*&& !tls_failure\s*&& !session_failure\s*&& self\.navigation_records >= 128/);
  assert.match(journal, /relay && self\.relay_records >= MAX_TIMED_STARTUPS as usize/);
  assert.match(journal, /tls_failure && self\.tls_failure_records >= MAX_RECORDS/);
  assert.match(journal, /session_failure && self\.session_failure_records >= MAX_RECORDS/);
  for (const [kind, counter] of [
    ["tls_failure", "tls_failure_records"],
    ["session_failure", "session_failure_records"],
    ["relay", "relay_records"],
    ["observation", "observation_records"],
  ]) {
    assert.match(journal, new RegExp(`if ${kind} \\{ self\\.${counter} \\+= 1; \\}`));
  }
  assert.match(journal, /else \{ self\.navigation_records \+= 1; \}/);
});
