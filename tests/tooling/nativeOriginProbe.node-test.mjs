import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const app = new URL("../../src-tauri/src/", import.meta.url);
const protocol = new URL("../../src-tauri/crates/sorng-protocols/src/", import.meta.url);

async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n/g, "\n");
}

function inOrder(source, markers) {
  let offset = 0;
  for (const marker of markers) {
    const next = source.indexOf(marker, offset);
    assert.ok(next >= offset, `missing ordered boundary: ${marker}`);
    offset = next + marker.length;
  }
}

test("production probe busy guard releases on completion, cancellation and unwind without cross-attempt state", async (t) => {
  const source = await readSource(new URL("origin_browser_diagnostics.rs", app));
  const start = source.indexOf("/// Per-attempt gate");
  assert.ok(start >= 0);
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-origin-probe-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-origin-probe-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "guard.rs");
  const binary = path.join(root, process.platform === "win32" ? "guard.exe" : "guard");
  // Compile the production guard and its own unit test, not a mock implementation.
  await writeFile(harness, source.slice(start) + `
#[cfg(test)] mod additional_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[test] fn independent_attempts_do_not_share_busy_state() {
        let a = AtomicBool::new(false);
        let b = AtomicBool::new(false);
        let first = ProbeBusyGuard::enter(&a).unwrap();
        let second = ProbeBusyGuard::enter(&b).unwrap();
        drop(first);
        assert!(!a.load(Ordering::Acquire));
        assert!(b.load(Ordering::Acquire));
        assert!(ProbeBusyGuard::enter(&b).is_none());
        drop(second);
        assert!(ProbeBusyGuard::enter(&b).is_some());
    }
    #[test] fn unwinding_releases_only_the_current_attempt() {
        let busy = AtomicBool::new(false);
        let result = std::panic::catch_unwind(|| {
            let _guard = ProbeBusyGuard::enter(&busy).unwrap();
            panic!("fixture unwind");
        });
        assert!(result.is_err());
        assert!(ProbeBusyGuard::enter(&busy).is_some());
    }
}
`);
  execFileSync("rustc", ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary], { timeout: 60_000, windowsHide: true });
  t.diagnostic(execFileSync(binary, [], { encoding: "utf8", timeout: 15_000, windowsHide: true }).trim());
});

test("production probe session acquisition never waits or repairs poison", async (t) => {
  const source = await readSource(new URL("origin_browser_diagnostics_probe.rs", app));
  const start = source.indexOf("// BEGIN std-only probe session lock");
  const end = source.indexOf("// END std-only probe session lock");
  const tests = source.indexOf("#[cfg(test)]\nmod session_lock_tests");
  assert.ok(start >= 0 && end > start && tests > end);
  const transport = await readSource(new URL("origin_browser_diagnostics.rs", protocol));
  const enumStart = transport.indexOf("pub enum ProbeOutcome {");
  const enumEnd = transport.indexOf("\n}", enumStart) + 2;
  assert.ok(enumStart >= 0 && enumEnd > enumStart);
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-probe-session-lock-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-probe-session-lock-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "lock.rs");
  const binary = path.join(root, process.platform === "win32" ? "lock.exe" : "lock");
  // Actual production helper, enum variants and Rust regressions; no native
  // session, owner database, CEF process, network or credential is created.
  await writeFile(harness, "#[derive(Debug, PartialEq, Eq)]\n" +
    transport.slice(enumStart, enumEnd) + "\n" + source.slice(start, end) + source.slice(tests));
  execFileSync("rustc", ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary], { timeout: 60_000, windowsHide: true });
  // A regression to blocking lock() would deadlock on the same-thread holder;
  // the subprocess deadline bounds this regression instead of hanging CI.
  t.diagnostic(execFileSync(binary, [], { encoding: "utf8", timeout: 5_000, windowsHide: true }).trim());
});

test("native probe is owner, window, permission and cancellation fenced before publication", async () => {
  const source = await readSource(new URL("origin_browser_diagnostics_probe.rs", app));
  const tests = source.indexOf("#[cfg(test)]\nmod session_lock_tests");
  assert.ok(tests >= 0);
  const production = source.slice(0, tests);
  assert.equal((production.match(/try_session\(&attempt\.session\)/g) ?? []).length, 2);
  assert.doesNotMatch(production, /\.lock\(|clear_poison|into_inner|\.revoke\(/);
  assert.match(production, /TryLockError::WouldBlock\) => Err\(ProbeOutcome::Busy\)/);
  assert.match(production, /TryLockError::Poisoned\(_\)\) => Err\(ProbeOutcome::OwnerUnavailable\)/);
  assert.match(source, /attempt\.current\(\) && shared\(\)\.admission\.ready\(\)/);
  assert.match(source, /session\.authorize_navigation\(&attempt\.identity, root\)/);
  assert.match(source, /request_class: "navigation"/);
  assert.match(source, /== WebsitePermissionDecision::Allow/);
  assert.match(source, /COMMAND_TIMEOUT: Duration = Duration::from_secs\(10\)/);
  inOrder(source.slice(source.indexOf("pub(crate) async fn diagnose")), [
    "request.identity.validate()", "canonical_origin_root(&request.origin)",
    "lookup(&window, &request.identity)", "if !live(&attempt)",
    "ProbeBusyGuard::enter(&attempt.diagnostics_busy)",
    "tokio::time::timeout(COMMAND_TIMEOUT", "attempt.lease.recheck(&window, state).await",
    "try_session(&attempt.session)", "Err(outcome) => return Ok(ProbeResponse::without_response(outcome, started.elapsed()))",
    "if !live(&attempt)",
    "!navigation_allowed(&attempt, &session, root.as_str())",
    "session.with_proxy_credentials", "AnonymousOriginProbe::prepare(", "session.proxy_endpoint()",
    "tokio::select!", "if !live(&attempt) { break; }", "response = probe.run() => response",
    "attempt.lease.recheck(&window, state).await", "try_session(&attempt.session)",
    "Err(outcome) => return Ok(ProbeResponse::without_response(outcome, started.elapsed()))",
    "if !live(&attempt)", "!navigation_allowed(&attempt, &session, root.as_str())",
    "response.elapsed_ms", ".await;", "if !live(&attempt)", "match result",
  ]);
  const preparation = source.slice(source.indexOf("let prepared = {"), source.indexOf("let probe = match prepared"));
  assert.doesNotMatch(preparation, /\.await/);
  assert.doesNotMatch(source, /log::|println!|eprintln!|spawn\(|spawn_blocking|danger_accept_invalid|reqwest::Client/);
});

test("probe DTO and native command registration expose only the fixed anonymous report", async () => {
  const dto = await readSource(new URL("origin_browser_diagnostics.rs", app));
  assert.match(dto, /deny_unknown_fields/);
  const request = dto.slice(dto.indexOf("pub(crate) struct DiagnoseRequest"), dto.indexOf("pub(crate) type DiagnoseResponse"));
  assert.deepEqual([...request.matchAll(/pub (\w+):/g)].map((m) => m[1]), ["identity", "origin"]);
  assert.match(dto, /type DiagnoseResponse = sorng_protocols::origin_browser_diagnostics::ProbeResponse/);
  const transport = await readSource(new URL("origin_browser_diagnostics.rs", protocol));
  const outcomes = transport.slice(transport.indexOf("pub enum ProbeOutcome {"), transport.indexOf("/// Deliberately"));
  assert.deepEqual([...outcomes.matchAll(/^    (\w+),$/gm)].map((m) => m[1]), [
    "Response", "Timeout", "RouteUnavailable", "TlsFailed", "RequestFailed", "OwnerUnavailable", "Busy",
  ]);
  const response = transport.slice(transport.indexOf("pub struct ProbeResponse"), transport.indexOf("impl ProbeResponse"));
  assert.deepEqual([...response.matchAll(/pub (\w+):/g)].map((m) => m[1]), ["outcome", "elapsed_ms", "http_status", "content_length"]);
  assert.match(transport, /!endpoint\.ip\(\)\.is_loopback\(\)/);
  assert.match(transport, /\.no_proxy\(\)\s*\.proxy\(proxy\)/);
  assert.match(transport, /\.redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(transport, /\.cookie_store\(false\)/);
  assert.doesNotMatch(transport.slice(0, transport.indexOf("#[cfg(test)]")), /danger_accept_invalid/);
  const commands = await readSource(new URL("origin_browser_commands.rs", app));
  assert.match(commands, /\| "origin_browser_diagnose"/);
  const command = commands.slice(commands.indexOf("pub(crate) async fn origin_browser_diagnose("), commands.indexOf("pub(crate) async fn origin_browser_appearance("));
  assert.match(command, /diagnostics_probe::diagnose\(window, &state, request\)\.await/);
  assert.match(command, /cfg\(not\(feature = "native-browser"\)\)/);
  assert.match(command, /Err\(UNAVAILABLE\.into\(\)\)/);
  const runtime = await readSource(new URL("origin_browser_runtime.rs", app));
  assert.match(runtime, /permissions: authorized\.permissions\.clone\(\)/);
  assert.match(runtime, /diagnostics_busy: AtomicBool::new\(false\)/);
  assert.match(await readSource(new URL("lib.rs", app)), /mod origin_browser_diagnostics;/);
  assert.match(await readSource(new URL("invoke_handler.rs", app)), /crate::origin_browser_commands::origin_browser_diagnose,/);
});
