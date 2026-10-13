import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const read = async (relative) =>
  (
    await readFile(new URL(`../../${relative}`, import.meta.url), "utf8")
  ).replace(/\r\n/gu, "\n");

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, `Missing production boundary: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.ok(b > a, `Missing production boundary: ${end}`);
  return source.slice(a, b);
}

// Comment lines, whitespace and trailing commas are not part of this contract.
const dense = (source) =>
  source
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/\s+/gu, "")
    .replace(/,\)/gu, ")")
    .replace(/,\}/gu, "}");

const count = (source, needle) => source.split(needle).length - 1;

test("every latch of the navigation guard is reported, and installation is retried once before it latches", async () => {
  const guard = await read("src-tauri/src/web_network_guard.rs");
  const text = dense(guard);

  // One place latches, and it reports first.
  assert.equal(count(text, "mark_frame_guard_failed()"), 1);
  assert.match(
    dense(between(guard, "fn latch(cause: policy::LatchCause) {", "\n}\n")),
    /ifletSome\(line\)=policy::latch_report\(&REPORTED,cause\)\{log::error!\("\{line\}"\);\}webview_origins::mark_frame_guard_failed\(\);$/u,
  );

  // A failed attempt is retried after the pause or latched, as the policy says.
  const failed = dense(between(guard, "fn install_failed(", "\n}\n"));
  assert.match(
    failed,
    /matchpolicy::after_failure\(first,failure\)\{policy::AfterFailure::Retry=>\{log::warn!\(.*tauri::async_runtime::spawn\(asyncmove\{tokio::time::sleep\(policy::RETRY_DELAY\)\.await;attempt_install\(&app,Some\(failure\)\);\}\);\}policy::AfterFailure::Latch\(cause\)=>latch\(cause\)\}$/u,
  );
  assert.equal(count(text, "tokio::time::sleep("), 1, "one retry, one timer");

  const attempt = dense(between(guard, "fn attempt_install(", "\n}\n"));
  // The three ways an attempt ends without a guard all take that path.
  for (const site of [
    "install_failed(app,first,policy::InstallFailure::MainWindowMissing);return;",
    "Err(failure)=>install_failed(&on_main,first,failure)",
    "ifdispatched.is_err(){install_failed(app,first,policy::InstallFailure::DispatchRejected);}",
  ])
    assert.ok(attempt.includes(site), `missing failure path: ${site}`);
  assert.equal(count(attempt, "install_failed("), 3);
  assert.doesNotMatch(
    attempt,
    /mark_frame_guard_failed|latch\(policy::LatchCause::Install/u,
  );
  // Ready is published once, and only with the installed guard in hand.
  assert.equal(count(text, "mark_frame_guard_ready()"), 1);
  assert.ok(
    attempt.indexOf("*slot.borrow_mut()=Some(guard);") > 0 &&
      attempt.indexOf("*slot.borrow_mut()=Some(guard);") <
        attempt.indexOf("webview_origins::mark_frame_guard_ready();"),
  );
  // Causes come from the native layer by name, never as a URL or message.
  assert.ok(
    attempt.includes(
      ".map_err(|error|policy::InstallFailure::CoreUnavailable(error.code().0))",
    ),
  );
  assert.ok(
    attempt.includes(
      ".map_err(|fault|policy::InstallFailure::Step{step:fault.step,code:fault.error.code().0})",
    ),
  );
  assert.ok(
    attempt.includes(
      "std::sync::Arc::new(|fault:windows::HandlerFault|{latch(policy::LatchCause::Handler{handler:fault.handler,code:fault.code})})",
    ),
  );
  assert.ok(attempt.includes("windows::install_reporting("));
  assert.match(
    dense(between(guard, "pub fn install(app: &tauri::App) {", "\n}\n")),
    /#\[cfg\(target_os="windows"\)\]attempt_install\(app\.handle\(\),None\);/u,
  );

  const native = await read("src-tauri/src/web_network_guard_windows.rs");
  const nativeText = dense(native);
  // Dropping an installed guard still latches; an installation that never
  // completed does not, or the retry could not exist.
  assert.match(
    dense(between(native, "impl Drop for InstalledGuard {", "unsafe {")),
    /fndrop\(&mutself\)\{ifself\.armed\{super::webview_origins::mark_frame_guard_failed\(\);\}$/u,
  );
  assert.ok(nativeText.includes("resource_filter:false,armed:false}"));
  assert.equal(count(nativeText, "armed=true"), 1);
  assert.ok(nativeText.endsWith("installed.armed=true;Ok(installed)}"));
  // The entry point of the isolated WebView2 fixtures keeps its signature and
  // still latches a failed installation itself.
  assert.ok(
    nativeText.includes(
      "pubfninstall(core:&ICoreWebView2,environment:&ICoreWebView2Environment," +
        "allows:Arc<dynFn(&str)->bool+Send+Sync>,allows_resource:Arc<dynFn(&str)->bool+Send+Sync>," +
        "failed:Arc<dynFn()+Send+Sync>)->windows61::core::Result<InstalledGuard>{" +
        "install_reporting(core,environment,allows,allows_resource,Arc::new(move|_|failed()))" +
        ".map_err(|fault|{super::webview_origins::mark_frame_guard_failed();fault.error})}",
    ),
  );
  for (const fixture of ["native_frame_navigation", "native_live_browser"]) {
    const source = await read(
      `src-tauri/crates/sorng-file-viewer-host/tests/${fixture}.rs`,
    );
    assert.match(
      source,
      /#\[path = "\.\.\/\.\.\/\.\.\/src\/web_network_guard_windows\.rs"\]/u,
    );
    assert.match(source, /guard::install\(/u);
  }
  // Those fixtures have no logger: causes leave this file as data.
  assert.doesNotMatch(native, /\blog::|eprintln!|println!/u);
  // Each handler names itself and still stops the view when it cannot decide.
  for (const handler of [
    "resource-request",
    "frame-navigation",
    "new-window",
    "external-scheme",
  ])
    assert.match(
      nativeText,
      new RegExp(
        `ifletErr\\(error\\)=&result\\{\\w+\\(HandlerFault\\{handler:"${handler}",code:error\\.code\\(\\)\\.0\\}\\);let_=\\w+\\.Stop\\(\\);\\}result`,
        "u",
      ),
    );
  assert.equal(count(nativeText, "HandlerFault{handler:"), 4);
  assert.doesNotMatch(nativeText, /ifresult\.is_err\(\)/u);
  // Each installation step names itself.
  assert.deepEqual(
    Array.from(
      nativeText.matchAll(/\.map_err\(step\("([a-z-]+)"\)\)\?/gu),
      (m) => m[1],
    ),
    [
      "resource-filter",
      "resource-filter",
      "resource-handler",
      "frame-handler",
      "popup-handler",
      "external-scheme-handler",
      "external-scheme-handler",
    ],
  );
});

test("the installation and latch policy behaves as the guard assumes", async (t) => {
  const guard = await read("src-tauri/src/web_network_guard.rs");
  const fixture = await read("tests/tooling/fixtures/webNetworkGuardLatch.rs");
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-guard-latch-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-guard-latch-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "contract.exe" : "contract",
  );
  await writeFile(
    harness,
    fixture.replace(
      "/* PRODUCTION_POLICY */",
      between(
        guard,
        '#[cfg_attr(not(target_os = "windows"), allow(dead_code))]\nmod policy {',
        "pub fn close() {",
      ),
    ),
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary],
    { cwd: root, encoding: "utf8", timeout: 60_000, windowsHide: true },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture", "--test-threads=1"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }).trim(),
  );
});
