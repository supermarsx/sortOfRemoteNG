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

function inOrder(source, steps, what) {
  let cursor = 0;
  for (const step of steps) {
    const at = source.indexOf(step, cursor);
    assert.ok(at >= 0, `${what} is missing or reorders: ${step}`);
    cursor = at + step.length;
  }
}

const count = (source, part) => source.split(part).length - 1;

// The variants of an error enum, without their messages.
function variants(source, header) {
  return between(source, header, "\n}\n")
    .slice(header.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#[") && !line.startsWith("//"))
    .map((line) => line.replace(/#\[from\]\s*/u, "").replace(/,$/u, ""));
}

const ENTRY = "src-tauri/src/origin_browser_entry.rs";
const REGISTRY = "src-tauri/src/state_registry.rs";
const HOST = "src-tauri/crates/sorng-browser-host/src";

test("a failed engine initialization returns to the runtime, and ends the process only where CEF's contract demands it", async () => {
  const entry = await read(ENTRY);
  const install = between(
    entry,
    "pub(crate) fn install(",
    "/// The production export",
  );

  // One initialization, and one way out of a failed one. The failure is
  // recorded and logged as before; then either the process is told to end,
  // with the settings leaked because freeing their strings is a CEF call, or
  // the error goes back to the runtime, which revokes admission.
  assert.equal(count(install, "CefRuntime::initialize_owned("), 1);
  assert.equal(
    dense(
      between(
        install,
        "Err(error) => {",
        "crate::origin_browser_runtime::install(runtime)",
      ),
    ),
    "Err(error)=>{" +
      "runtime_failure.record(Code::RuntimeInitialization);" +
      "timing.finish(0);" +
      "diagnostics::record(Stage::Failed,Some(Failure::Initialization));" +
      'log::error!("Nativebrowserstage=initializingerror={error}");' +
      'eprintln!("Nativebrowserstage=initializingerror={error}");' +
      "log::logger().flush();" +
      'ifengine_left(&error,cfg!(target_os="macos"))==EngineLeft::MustExit{' +
      "std::mem::forget(settings);" +
      "crate::state_registry::end_for_engine_failure(cef_exit_code(&error));}" +
      "returnErr(EntryError::Runtime(error));}};",
  );
  // The module ends the process nowhere itself: no silent exit is left.
  assert.equal(count(entry, "process::exit"), 0);

  // A successful start is what it was.
  assert.ok(
    dense(install).endsWith(
      "crate::origin_browser_runtime::install(runtime).map_err(|_|{" +
        "runtime_failure.record(Code::RuntimeInitialization);" +
        'EntryError::Fixed("Nativeruntimeregistryinstallationfailed")})?;' +
        "runtime_failure.stage(RuntimeStage::PolicyReadback);" +
        "timing.mark(TimingStage::RuntimeInstalled);" +
        "Ok(())}",
    ),
  );
  // So is a helper process: it returns CEF's code and starts no application.
  assert.match(
    dense(between(entry, "pub(crate) unsafe fn prepare_windows(", "\n}\n")),
    /matchdispatch\{ProcessDispatch::Exit\(code\)=>Ok\(ProcessDispatch::Exit\(code\)\),ProcessDispatch::Browser=>retain_browser\(Box::new\(provider\)\)\}$/u,
  );
  const main = dense(between(entry, "pub unsafe extern", "\n}\n"));
  assert.match(
    main,
    /matchunsafe\{prepare_windows\(instance,sandbox,version\)\}\{Ok\(ProcessDispatch::Exit\(code\)\)=>code,/u,
  );
  assert.match(
    main,
    /Err\(error\)=>\{eprintln!\("Nativebrowserstage=bootstraperror=\{error\}"\);1\}\}$/u,
  );

  // Every variant is placed by name. A new one stops the build until it is.
  const placed = between(entry, "fn engine_left(", "\n}\n");
  assert.doesNotMatch(placed, /^\s*(?:_|[a-z][a-z0-9_]*)\s*=>/mu);
  assert.doesNotMatch(placed, /\|\s*_\b/u);

  // The fixture places the doubles below. They have the variants of the real
  // types, in files this test only reads.
  const fixture = await read("tests/tooling/fixtures/nativeEngineFailure.rs");
  const platform = await read(`${HOST}/bootstrap_platform.rs`);
  const runtime = await read(`${HOST}/cef_runtime.rs`);
  assert.deepEqual(
    variants(fixture, "enum BootstrapError {"),
    variants(platform, "pub enum BootstrapError {"),
  );
  assert.deepEqual(
    variants(fixture, "enum RuntimeError {"),
    variants(runtime, "pub enum RuntimeError {"),
  );
});

test("each error is raised where its place says, in the sources that raise it", async () => {
  const runtime = await read(`${HOST}/cef_runtime.rs`);
  // Settings, then the once-per-process claim, then the provider.
  inOrder(
    dense(between(runtime, "pub unsafe fn initialize_owned(", "\n    }\n")),
    [
      "bootstrap_platform::validate_native_settings(settings)?;",
      "INITIALIZATION.set(()).map_err(|_|RuntimeError::AlreadyStarted)?;",
      "Self::initialize_owner_claimed(",
    ],
    "initialize_owned",
  );
  // A scheduler or policy fault is answered only after the provider's
  // shutdown returned, with the App released first.
  inOrder(
    dense(between(runtime, "unsafe fn initialize_owner_claimed(", "\n    }\n")),
    [
      ".initialize_native(settings,&mutapplication)?;",
      "ifletErr(error)=scheduler.check(){",
      "drop(application);",
      "bootstrap.get_mut().shutdown_native()?;",
      "returnErr(error);",
    ],
    "initialize_owner_claimed",
  );
  assert.equal(
    dense(between(runtime, "fn failure_reason(", "\n    }\n")),
    "fnfailure_reason(&self)->RuntimeError{" +
      "ifself.network_policy.load(Ordering::Acquire)==POLICY_FAILED{" +
      "RuntimeError::NetworkPolicyUnavailable}else{RuntimeError::SchedulerUnavailable}",
  );

  // Windows: everything but a refused Initialize is ahead of it, and the
  // shutdown refuses nothing once initialized.
  const windows = await read(`${HOST}/platform/windows.rs`);
  const start = dense(
    between(windows, "pub unsafe fn initialize_browser(", "\n    }\n"),
  );
  inOrder(
    start,
    [
      "returnErr(BootstrapFailure::InvalidLifecycle);",
      "bootstrap::validate_native_settings(settings)?;",
      "returnErr(BootstrapFailure::SeparateSubprocess);",
      "runtime_access::prepare(settings)?;",
      "ifcef::initialize(",
      "returnErr(BootstrapFailure::InitializeFailed);",
    ],
    "the Windows provider's start",
  );
  assert.equal(count(start, "returnErr("), 3);
  assert.equal(
    dense(between(windows, "pub unsafe fn shutdown(", "\n    }\n")),
    "pubunsafefnshutdown(&mutself)->Result<(),BootstrapFailure>{" +
      "ifself.thread!=std::thread::current().id()||!self.initialized{" +
      "returnErr(BootstrapFailure::InvalidLifecycle);}" +
      "cef::shutdown();self.initialized=false;Ok(())",
  );
  assert.match(
    dense(between(windows, "fn runtime_error(", "\n}\n")),
    /BootstrapFailure::InvalidLifecycle=>BootstrapError::InvalidLifecycle,BootstrapFailure::InitializeFailed=>\{BootstrapError::InitializeFailed\(cef::get_exit_code\(\)\)\}/u,
  );
  const access = await read(`${HOST}/platform/windows_runtime_access.rs`);
  assert.ok(count(access, "BootstrapError::PlatformPrecondition(") > 0);
  assert.equal(
    count(access, "BootstrapError::"),
    count(access, "BootstrapError::PlatformPrecondition("),
  );

  // Linux: the same shape.
  const linux = await read(`${HOST}/platform/linux.rs`);
  const x11 = `${between(
    linux,
    "impl bootstrap::RuntimeBootstrap for X11Bootstrap {",
    "\n}\n",
  )}\n`;
  inOrder(
    dense(between(x11, "unsafe fn initialize_native(", "\n    }\n")),
    [
      "returnErr(BootstrapError::InvalidLifecycle);",
      'BootstrapError::PlatformPrecondition("X11environmentchangedafterstartup")',
      "bootstrap::validate_native_settings(settings)?;",
      "ifcef::initialize(",
      "returnErr(BootstrapError::InitializeFailed(cef::get_exit_code()));",
    ],
    "the Linux provider's start",
  );
  const x11Shutdown = between(x11, "unsafe fn shutdown_native(", "\n    }\n");
  assert.doesNotMatch(x11Shutdown, /PlatformPrecondition/u);
  assert.match(dense(x11Shutdown), /cef::shutdown\(\);/u);

  // macOS: its shutdown can refuse with a precondition and leave CEF running,
  // which is why that answer still ends the process there.
  const macos = await read(`${HOST}/platform/macos.rs`);
  const mac = `${between(
    macos,
    "impl bootstrap::RuntimeBootstrap for MacBrowserBootstrap {",
    "\n}\n",
  )}\n`;
  inOrder(
    dense(between(mac, "unsafe fn shutdown_native(", "\n    }\n")),
    [
      "check_tao_application_bridge().map_err(|_|{BootstrapError::PlatformPrecondition(",
      "cef::shutdown();",
    ],
    "the macOS provider's shutdown",
  );

  // No provider unloads the engine when it is dropped.
  for (const [source, provider] of [
    [windows, "WindowsSandboxBootstrap"],
    [linux, "X11Bootstrap"],
    [macos, "MacBrowserBootstrap"],
  ])
    assert.doesNotMatch(
      source,
      new RegExp(`impl(?:<[^>]*>)?\\s+Drop\\s+for\\s+${provider}\\b`, "u"),
    );
});

test("the runtime that gets the error back keeps the native browser off and never reaches the engine", async () => {
  const runtime = await read("src-tauri/src/origin_browser_runtime.rs");
  const ensure = dense(
    between(runtime, "async fn ensure_runtime(", "\nfn watch_native_start("),
  );
  // Revoked admission answers before any start is prepared.
  inOrder(
    ensure,
    [
      "ifshared().admission.revoked(){returnErr(STARTUP_FAILED.to_owned());}",
      "ifletSome(permit)=shared().startup.prepare(){",
      "crate::origin_browser_entry::install(",
    ],
    "ensure_runtime",
  );
  // The pump starts for a successful start only, and an error returned after
  // native entry revokes for good and reaches the tab as a message.
  assert.match(
    ensure,
    /letresult=matchresult\{Ok\(\(\)\)=>\{start_pump\(app,pump\);/u,
  );
  assert.equal(count(dense(runtime), "start_pump("), 2);
  assert.match(
    ensure,
    /Err\(error\)=>\{log::error!\("Nativebrowserstage=preparingerror=\{error\}"\);diagnostics::record\(Stage::Failed,Some\(Failure::Package\)\);ifshared\(\)\.startup\.started\(\)\{revoke_all\(\);\}Err\(PACKAGE_FAILED\.to_owned\(\)\)\}/u,
  );
  assert.equal(
    dense(between(runtime, "pub(crate) fn revoke_all(", "\n}\n")),
    "pub(crate)fnrevoke_all(){shared().prewarm.cancel();shared().startup.fail();" +
      "shared().admission.revoke();revoke_attempts();",
  );
  // The idle prewarm has one attempt per process.
  assert.match(
    dense(between(runtime, "async fn prewarm_document(", "\nasync fn recheck")),
    /if!shared\(\)\.prewarm\.begin\(\)\{returnOk\(\(\)\);\}/u,
  );
  const prewarm = await read("src-tauri/src/origin_browser_prewarm.rs");
  assert.equal(
    dense(between(prewarm, "impl PrewarmGate {", "\n}\n")),
    "implPrewarmGate{" +
      "pubfnbegin(&self)->bool{self.0.compare_exchange(0,1,Ordering::AcqRel,Ordering::Acquire).is_ok()}" +
      "pubfncurrent(&self)->bool{self.0.load(Ordering::Acquire)==1}" +
      "pubfncancel(&self){self.0.store(2,Ordering::Release);}",
  );

  // Neither gate has a way back: a start that entered native code is never
  // prepared again, and revoked admission never becomes ready.
  const flow = dense(
    await read("src-tauri/src/origin_browser_runtime_flow.rs"),
  );
  const gate = between(
    flow,
    "implStartupGate{",
    "pub(super)structStartupPermit",
  );
  assert.equal(count(gate, "compare_exchange("), 1);
  assert.match(gate, /compare_exchange\(Self::DEFERRED,Self::PREPARING,/u);
  assert.equal(count(gate, ".store("), 1);
  assert.match(gate, /\.store\(Self::FAILED,Ordering::Release\)/u);
  for (const from of flow.matchAll(
    /compare_exchange\(StartupGate::([A-Z]+),/gu,
  ))
    assert.equal(from[1], "PREPARING");
  const admission = between(
    flow,
    "implRuntimeAdmission{",
    "pub(super)constNATIVE_START_LIMIT",
  );
  assert.equal(count(admission, ".store("), 1);
  assert.match(admission, /\.store\(Self::REVOKED,Ordering::Release\)/u);
  assert.doesNotMatch(
    flow,
    /compare_exchange\((?:Self|RuntimeAdmission)::REVOKED,|admission\.0\.store\(/u,
  );

  // With no runtime installed, the pump tick, the event hook and the shutdown
  // at exit find an empty registry and call nothing of the engine.
  const tick = dense(between(runtime, "pub(crate) fn tick(", "\n}\n"));
  const empty = tick.indexOf("letSome(ui)=slot.as_ref()else{return;};");
  assert.ok(empty >= 0, "tick returns early without a runtime");
  assert.ok(tick.indexOf("ui.") > empty);
  assert.doesNotMatch(tick.slice(0, empty), /\bcef|runtime\./u);
  const shutdown = dense(between(runtime, "pub(crate) fn shutdown(", "\n}\n"));
  const taken = shutdown.indexOf("ifletSome(ui)=slot.take(){");
  assert.ok(taken >= 0, "shutdown takes the runtime only when there is one");
  const engine = /ui\.runtime\.|cef_tls_bridge::/u;
  assert.doesNotMatch(shutdown.slice(0, taken), engine);
  // Everything of the engine is inside that block, and nothing follows it.
  let depth = 0;
  let end = shutdown.indexOf("{", taken);
  do {
    depth += { "{": 1, "}": -1 }[shutdown[end]] ?? 0;
    end += 1;
  } while (depth > 0);
  assert.match(shutdown.slice(taken, end), /ui\.runtime\.shutdown\(\)/u);
  assert.equal(shutdown.slice(end), "Ok(())})");
});

test("the end is announced once, with the secure clipboard released, and reaches no engine code", async () => {
  const registry = await read(REGISTRY);
  assert.equal(
    count(registry, '#[cfg(feature = "native-browser")]\nmod engine_failure {'),
    1,
  );
  const engine = `${between(registry, "mod engine_failure {", "\n}\n")}\n`;
  // A status of its own: not a failed start's, and not one CEF gives (its
  // result codes end at 41 and resume at 7006).
  const code = Number(/const EXIT_CODE: i32 = (\d+);/u.exec(engine)?.[1]);
  const failedStart = Number(
    /const FAILED_START_EXIT_CODE: i32 = (\d+);/u.exec(registry)?.[1],
  );
  assert.ok(code > 41 && code < 256, `exit status ${code}`);
  assert.notEqual(code, failedStart);

  // With a person watching: one dialog, and the process ends when it is
  // dismissed. Under a harness, or with nothing to show it: stderr and the end
  // at once. Both release the secure clipboard first; this end skips the run
  // events that would.
  assert.equal(
    dense(between(engine, "pub(super) fn end(", "\n    }\n")),
    "pub(super)fnend(cef_code:Option<i32>){" +
      "letmessage=message(cef_code);" +
      "letapp=APP.get();" +
      "letSome((app,dialog))=app.and_then(|app|Some((app,super::failure_dialog(app)?)))else{" +
      'eprintln!("{TITLE}.{}",message.replace("\\n\\n",""));' +
      "ifletSome(app)=app{super::clear_secure_clipboard_on_exit(app);}" +
      "std::process::exit(EXIT_CODE);};" +
      "letapp=app.clone();" +
      "dialog.message(message).title(TITLE)" +
      ".kind(tauri_plugin_dialog::MessageDialogKind::Error)" +
      ".show(move|_|{super::clear_secure_clipboard_on_exit(&app);std::process::exit(EXIT_CODE)});",
  );
  assert.doesNotMatch(
    dense(engine),
    /\bcef::|sorng_browser_host::|origin_browser_|blocking_show/u,
  );
  assert.equal(
    count(
      registry,
      '#[cfg(feature = "native-browser")]\n' +
        "pub(crate) fn end_for_engine_failure(cef_code: Option<i32>) {\n" +
        "    engine_failure::end(cef_code);\n}\n",
    ),
    1,
  );

  // The dialog and its harness check are the ones a failed start uses
  // (`appStartupSteps` holds their text).
  assert.equal(count(registry, "fn failure_dialog<"), 1);
  assert.equal(count(registry, "failure_dialog("), 2);

  // The handle the end needs is kept before any setup step can fail, and
  // nothing else writes it.
  assert.ok(
    dense(between(registry, "pub(crate) fn register(", "\n}\n")).startsWith(
      "pub(crate)fnregister(app:&muttauri::App<tauri::Wry>)->Result<(),FatalStep>{" +
        '#[cfg(feature="native-browser")]let_=engine_failure::APP.set(app.handle().clone());',
    ),
  );
  assert.equal(count(registry, "APP.set("), 1);
});

test("the classification and the notice behave as the entry assumes", async (t) => {
  const entry = await read(ENTRY);
  const registry = await read(REGISTRY);
  const fixture = await read("tests/tooling/fixtures/nativeEngineFailure.rs");
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-engine-failure-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-engine-failure-"));
    await rm(root, { recursive: true, force: true });
  });
  const harness = path.join(root, "contract.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "contract.exe" : "contract",
  );
  await writeFile(
    harness,
    fixture
      .replace(
        "/* PRODUCTION_ENGINE_LEFT */",
        between(
          entry,
          "/// What a failed `CefRuntime::initialize_owned` left in this process.",
          "/// Authorized create/prewarm only",
        ),
      )
      .replace(
        "/* PRODUCTION_NOTICE */",
        between(
          registry,
          "    /// What the user is told.",
          "    pub(super) fn end(",
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
