import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(
  new URL(
    "../../src-tauri/src/origin_browser_renderer_deadline.rs",
    import.meta.url,
  ),
);
const runtimeFile = new URL(
  "../../src-tauri/src/origin_browser_runtime.rs",
  import.meta.url,
);

test("actual renderer deadline preserves preparation budget and starts its cap at host creation", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sorng-renderer-deadline-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const exe = path.join(
    root,
    process.platform === "win32" ? "deadline.exe" : "deadline",
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", helper, "-o", exe],
    { timeout: 60_000, windowsHide: true },
  );
  const result = execFileSync(exe, [], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  assert.match(result, /4 passed; 0 failed/);
  t.diagnostic(result.trim());
});

test("production renderer-only wait uses the bounded deadline and reports renderer setup without global poisoning", async () => {
  const runtime = await readFile(runtimeFile, "utf8");
  assert.match(
    runtime,
    /#\[path = "origin_browser_renderer_deadline\.rs"\]\s*mod renderer_deadline;/,
  );
  const host = runtime.slice(
    runtime.indexOf("CefBrowserHost::create_owned_engineering_probe("),
    runtime.indexOf("ui.pending = waiting;"),
  );
  assert.match(
    host,
    /Ok\(host\)[\s\S]*start: Some\(Start \{\s*deadline: renderer_deadline::deadline\(Instant::now\(\), pending\.deadline\)/,
  );
  const startup = runtime.slice(
    runtime.indexOf("if let Some(start) = view.start.take()"),
    runtime.indexOf(
      "if !view.attempt.current() && !view.checkpoint.draining()",
    ),
  );
  assert.match(
    startup,
    /renderer_deadline::expired\(Instant::now\(\), start\.deadline\)/,
  );
  assert.match(
    startup,
    /view_failure\(Failure::RendererSetup, RENDERER_TIMED_OUT\)/,
  );
  assert.doesNotMatch(startup, /fail_runtime\(|Failure::Timeout/);
  assert.match(
    runtime,
    /deadline: Instant::now\(\)\s*\+ Duration::from_secs\(queued.preferences.initial_load_timeout_seconds\)/,
  );
  assert.match(
    runtime,
    /Duration::from_secs\(attempt.preferences.initial_load_timeout_seconds \+ 5\)/,
  );
  assert.match(runtime, /document_ready_timeout_seconds/);
});
