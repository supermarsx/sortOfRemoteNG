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

test("setup keeps its fatal steps fatal and lets the browser route services, the scheduler and the splash fail", async () => {
  const lib = await read("src-tauri/src/lib.rs");
  const registry = await read("src-tauri/src/state_registry.rs");

  const setup = dense(between(lib, ".setup(|app| {", ".invoke_handler("));
  // Fatal by design and unchanged: the profile guard, then every managed state.
  assert.ok(
    setup.startsWith(".setup(|app|{app_profile::verify_runtime(app)?;"),
  );
  const order = [
    "app_profile::verify_runtime(app)?;",
    "web_network_guard::install(app);",
    "ifletErr(step)=state_registry::register(app){state_registry::fail_start(app,step);returnOk(());}",
    'state_registry::recoverable("splash",',
    "splash::show(app)",
    "Ok(())",
  ];
  let cursor = 0;
  for (const step of order) {
    const at = setup.indexOf(step, cursor);
    assert.ok(at >= 0, `setup is missing or reorders: ${step}`);
    cursor = at + step.length;
  }
  assert.doesNotMatch(
    setup,
    /splash::show\(app\)\?/u,
    "a splash that cannot be shown must not end the app",
  );
  // The sandbox bootstrap stays fail-closed: no unsandboxed fallback.
  assert.match(
    dense(between(lib, "pub fn run() {", "let profile =")),
    /Err\(error\)=>\{eprintln!\("Nativebrowserstage=bootstraperror=\{error\}"\);return;\}/u,
  );

  const register = dense(
    between(
      registry,
      "pub(crate) fn register(",
      "\nfn resolve_user_store_path(",
    ),
  );
  for (const fatal of [
    /letinfrastructure=fatal\(FatalStep::AppData,sorng_app_startup_state::register_infrastructure_prefix\([^;]*\)\)\?;/u,
    /#\[cfg\(feature="ops"\)\]fatal\(FatalStep::CredentialLifecycle,sorng_app_domains::ops_startup_state::register\(app,&app_dir\)\)\?;/u,
  ])
    assert.match(register, fatal);

  // A fatal step does not reach Tauri, which would panic with nothing on
  // screen. Setup ends the start itself, once, and runs nothing after it.
  assert.ok(
    dense(registry).includes(
      "pub(crate)fnregister(app:&muttauri::App<tauri::Wry>)->Result<(),FatalStep>{",
    ),
  );
  assert.equal(dense(lib).split("fail_start(").length - 1, 1);
  // An unattended run must not wait on a dialog: stderr and a non-zero exit.
  assert.equal(
    dense(between(registry, "fn exit_failed_start(", "\n}\n")),
    'fnexit_failed_start(step:FatalStep)->!{eprintln!("{FAILED_START_TITLE}.{}",step.message().replace("\\n\\n",""));' +
      "std::process::exit(FAILED_START_EXIT_CODE)",
  );
  assert.match(registry, /const FAILED_START_EXIT_CODE: i32 = [1-9]\d*;/u);
  // With a person watching: the harness check first, then every webview
  // closed on this thread (or the process ends), every window hidden, one
  // dialog with the fixed words, and the exit when it is dismissed.
  assert.equal(
    dense(between(registry, "pub(crate) fn fail_start(", "\n}\n")),
    "pub(crate)fnfail_start(app:&tauri::App<tauri::Wry>,step:FatalStep){" +
      "letSome(dialog)=failure_dialog(app)else{exit_failed_start(step);};" +
      "crate::web_network_guard::close();" +
      "forwindowinapp.webview_windows().into_values(){" +
      "letwebview:&tauri::Webview<tauri::Wry>=window.as_ref();" +
      "ifwebview.close().is_err(){exit_failed_start(step);}" +
      "let_=window.hide();}" +
      "dialog.message(step.message()).title(FAILED_START_TITLE)" +
      ".kind(tauri_plugin_dialog::MessageDialogKind::Error)" +
      ".show(|_|std::process::exit(FAILED_START_EXIT_CODE));",
  );
  assert.equal(
    dense(between(registry, "fn failure_dialog<", "\n}\n")),
    "fnfailure_dialog<M:Manager<tauri::Wry>>(app:&M)" +
      "->Option<tauri::State<'_,tauri_plugin_dialog::Dialog<tauri::Wry>>>{" +
      "letharness_run=std::env::var_os(sorng_core::app_identity::EXPECT_ISOLATED_PROFILE_ENV).is_some();" +
      "app.try_state::<tauri_plugin_dialog::Dialog<tauri::Wry>>()" +
      ".filter(|_|failed_start_ending(harness_run)==FailedStartEnding::Dialog)",
  );
  // What that relies on, in files this test only reads. The harness marks
  // every app it launches with this variable, and the profile guard already
  // calls that a harness run.
  const identity = await read(
    "src-tauri/crates/sorng-core/src/app_identity.rs",
  );
  assert.match(
    identity,
    /pub const EXPECT_ISOLATED_PROFILE_ENV: &str = "SORNG_EXPECT_ISOLATED_PROFILE";/u,
  );
  const harness = await read("scripts/lib/e2e-profile-isolation.mjs");
  assert.match(
    harness,
    /export const EXPECT_ISOLATED_PROFILE_ENV = "SORNG_EXPECT_ISOLATED_PROFILE";/u,
  );
  const profile = await read("src-tauri/src/app_profile.rs");
  assert.match(
    profile,
    /harness runs require a per-run WebView2 folder: \{EXPECT_ISOLATED_PROFILE_ENV\} is set/u,
  );
  // The credential dialog names the tracker file and says an existing one was
  // left unchanged: loading it only reads.
  const tracker = await read(
    "src-tauri/crates/sorng-credentials/src/persistence.rs",
  );
  assert.match(tracker, /const STATE_DIRECTORY: &str = "credentials";/u);
  assert.match(
    tracker,
    /const STATE_FILENAME: &str = "tracker-state-v1\.json";/u,
  );
  assert.doesNotMatch(
    between(tracker, "pub(crate) fn load(", "pub(crate) fn store("),
    /fs::write|File::create|OpenOptions|remove_file|fs::rename|tempfile|persist\(/u,
  );

  // The scheduler: its result is settled here and never reaches setup.
  assert.ok(
    register.includes(
      '#[cfg(feature="ops")]{letscheduler=sorng_app_domains::ops_startup_state::register_scheduler(app,&app_dir);' +
        "scheduler_startup::settle(app.handle(),scheduler);}",
    ),
    "an unreadable scheduler must not end the app",
  );
  assert.match(
    registry,
    /#\[cfg\(feature = "ops"\)\]\nmod scheduler_startup \{/u,
  );
  const scheduler = `${between(registry, "mod scheduler_startup {", "\n}\n")}\n`;
  assert.equal(
    dense(between(scheduler, "pub(super) fn settle(", "\n    }\n")),
    "pub(super)fnsettle(app:&tauri::AppHandle,started:tauri::Result<()>){" +
      "letcause=match&started{Err(tauri::Error::Io(error))=>Some(error.kind()),_=>None};" +
      "ifsuper::recoverable(STAGE,EFFECT,started).is_none(){" +
      'super::report_startup_failure(app,"scheduler",notice(cause).to_owned());}',
  );
  // What `settle` and the notice rely on, in files this test only reads: a
  // load failure is reported as invalid data, the exit hook looks the state
  // up, and no consumer takes the state in a way that panics when it is absent.
  const ops = await read("src-tauri/src/state_registry/ops.rs");
  const registerScheduler = dense(
    between(ops, "pub fn register_scheduler(", "\n}\n"),
  );
  assert.match(
    registerScheduler,
    /SchedulerService::with_storage_path\(storage_path\)\.map_err\(\|error\|\{std::io::Error::new\(std::io::ErrorKind::InvalidData,/u,
  );
  assert.match(
    dense(between(ops, "pub fn stop_scheduler(", "\n}\n")),
    /ifletSome\(state\)=app_handle\.try_state::<crate::scheduler::service::SchedulerServiceState>\(\)/u,
  );
  const commands = await read(
    "src-tauri/crates/sorng-scheduler/src/commands.rs",
  );
  assert.match(commands, /state: State<'_, SchedulerServiceState>/u);
  for (const source of [ops, commands])
    assert.doesNotMatch(source, /\.state::<[^>]*Scheduler/u);
  // The notice promises that the saved schedule was left unchanged. That holds
  // because loading only reads, and a scheduler that failed to load is never
  // constructed, so nothing in the process holds its path.
  const schedulerService = await read(
    "src-tauri/crates/sorng-scheduler/src/service.rs",
  );
  assert.match(
    dense(between(schedulerService, "pub fn with_storage_path(", "\n    }\n")),
    /letscheduler=load_scheduler\(&path\)\?;Ok\(Self::managed\(scheduler,Some\(path\)\)\)$/u,
  );
  for (const [start, end] of [
    ["fn load_scheduler(", "\nfn sibling_path("],
    ["fn read_snapshot(", "\nfn write_snapshot("],
  ])
    assert.doesNotMatch(
      between(schedulerService, start, end),
      /write_snapshot|fs::write|File::create|OpenOptions|remove_file|fs::rename|set_len/u,
      `${start} must only read`,
    );

  // The browser block: one call that cannot return an error to setup.
  const browser = between(
    register,
    "sorng_app_startup_connectivity::register(",
    "sorng_app_startup_state::register_security_data(",
  );
  assert.match(
    browser,
    /#\[cfg\(feature="native-browser"\)\]native_browser_routes::bind\(app,&app_dir\);$/u,
  );
  const routes = `${between(registry, "mod native_browser_routes {", "\n}\n")}\n`;
  assert.match(
    dense(routes),
    /pub\(super\)fnbind\(app:&muttauri::App<tauri::Wry>,app_dir:&std::path::Path\)\{/u,
    "bind returns nothing, so it cannot abort setup",
  );
  const bind = dense(between(routes, "pub(super) fn bind(", "\n    }\n"));
  assert.match(
    bind,
    /letSome\(routes\)=super::recoverable\(STAGE,EFFECT,services\(app,app_dir\)\)else\{super::report_startup_failure\(app\.handle\(\),"native_browser_routes",NOTICE\.to_owned\(\)\);return;\};/u,
  );
  assert.doesNotMatch(bind, /\?;|returnErr|panic!|unwrap\(\)|expect\(/u);
  // Exactly the one registration this file has always had; none in lib.rs.
  assert.equal(registry.split(".manage(").length - 1, 1);
  assert.equal(lib.split(".manage(").length - 1, 0);

  // What the shell is told goes through the held queue, never a bare emit
  // that fires before the shell can listen.
  assert.equal(registry.split(".emit(").length - 1, 1);
  assert.match(
    dense(between(registry, "fn emit_startup_notice(", "\n}\n")),
    /app\.emit\(STARTUP_FAILURE_EVENT,payload\)/u,
  );
  assert.match(
    registry,
    /const STARTUP_FAILURE_EVENT: &str = "startup-failure";/u,
  );
  assert.match(
    dense(register),
    /report_startup_failure\(&app_handle_for_start,"rest_api_server",format!\("FailedtostartRESTAPIserver:\{err\}"\)\);/u,
  );
  // The shell closes the splash when it is ready; that is the release signal.
  const splash = await read("src-tauri/src/splash.rs");
  assert.match(splash, /WebviewWindowBuilder::new\(app, "splash",/u);
  assert.match(lib, /const SPLASH_WINDOW: &str = "splash";/u);
  const run = dense(
    between(lib, "app.run(|app_handle, event| {", "\n    });\n"),
  );
  assert.match(
    run,
    /event:tauri::WindowEvent::Destroyed,\.\.\}=&event\{.*iflabel==SPLASH_WINDOW\{state_registry::shell_ready\(app_handle\);\}/u,
  );
});

test("the startup helpers behave as their callers assume", async (t) => {
  const registry = await read("src-tauri/src/state_registry.rs");
  const fixture = await read("tests/tooling/fixtures/appStartupSteps.rs");
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-startup-steps-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-startup-steps-"));
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
        "/* PRODUCTION_NOTICES */",
        between(
          registry,
          "/// A startup failure the app survived",
          "static STARTUP_NOTICES:",
        ),
      )
      .replace(
        "/* PRODUCTION_STEPS */",
        between(
          registry,
          "/// A setup step the app runs without.",
          "/// Exit status of a start that ended at a fatal step",
        ),
      )
      .replace(
        "/* PRODUCTION_ROUTE_FAILURE */",
        between(
          registry,
          "    /// Why the services are absent.",
          "    fn services(",
        ),
      )
      .replace(
        "/* PRODUCTION_SCHEDULER_NOTICE */",
        between(
          registry,
          "    /// Why scheduled tasks are not running",
          "    pub(super) fn settle(",
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
