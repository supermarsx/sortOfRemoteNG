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
    .replace(/,\)/gu, ")");

const count = (source, needle) => source.split(needle).length - 1;

test("the app exit path releases what the secure clipboard owns, on the exit request and on the final exit, before anything else", async () => {
  const lib = await read("src-tauri/src/lib.rs");
  const registry = await read("src-tauri/src/state_registry.rs");
  const call = "state_registry::clear_secure_clipboard_on_exit(app_handle);";

  const run = dense(
    between(lib, "app.run(|app_handle, event| {", "\n    });\n"),
  );
  // First statement of the handler, for both events: the native browser starts
  // to shut down on `ExitRequested`, so a stop that hangs or aborts there must
  // find the secret already gone, and the final `Exit` tries once more.
  assert.ok(
    run.startsWith(
      "app.run(|app_handle,event|{ifmatches!(event," +
        `tauri::RunEvent::ExitRequested{..}|tauri::RunEvent::Exit){${call}}`,
    ),
    "the exit request and the final exit must clear the secure clipboard before anything else",
  );
  for (const later of [
    "origin_browser_runtime::on_event(app_handle,&event);",
    "web_network_guard::close();",
    "ops_startup_state::stop_scheduler(app_handle);",
  ])
    assert.ok(run.indexOf(call) < run.indexOf(later), `clear before ${later}`);
  // That is the only call. No window event clears: closing a window can leave
  // the app running in the tray with a secret the user still needs.
  assert.equal(count(dense(lib), "clear_secure_clipboard_on_exit"), 1);

  const entry = dense(
    between(registry, "pub(crate) fn clear_secure_clipboard_on_exit(", "\n}\n"),
  );
  assert.equal(
    entry,
    'pub(crate)fnclear_secure_clipboard_on_exit(app:&tauri::AppHandle){#[cfg(any(feature="collab",feature="platform"))]exit_clear::run(app);#[cfg(not(any(feature="collab",feature="platform")))]let_=app;',
  );
  assert.match(
    registry,
    /#\[cfg\(any\(feature = "collab", feature = "platform"\)\)\]\nmod exit_clear \{/u,
    "compiled exactly where the secure clipboard state is registered",
  );
  const clear = `${between(registry, "mod exit_clear {", "\n}\n")}\n`;
  const runClear = dense(between(clear, "pub(super) fn run(", "\n    }\n"));
  // The managed service and its own exit entry point, reported once.
  assert.equal(
    runClear,
    "pub(super)fnrun(app:&tauri::AppHandle){" +
      "letSome(state)=app.try_state::<crate::secure_clip::SecureClipServiceState>()else{return;};" +
      "report(crate::secure_clip::service::clear_on_exit_blocking(state.inner()));",
  );
  assert.equal(count(dense(registry), "clear_on_exit_blocking("), 1);
  // That entry point is synchronous and bounds itself. The exit path must not
  // enter an async runtime or wait on a lock of its own.
  assert.doesNotMatch(
    dense(clear),
    /block_on|\.await|tokio::|\.write\(\)|\.lock\(\)/u,
  );

  // Ownership is the engine's decision. Nothing here reads, writes or clears
  // an OS clipboard, and nothing clears the secure one for any other reason.
  for (const [name, source] of [
    ["lib.rs", lib],
    ["state_registry.rs", registry],
  ]) {
    assert.doesNotMatch(
      source,
      /OpenClipboard|EmptyClipboard|SetClipboardData|GetClipboardData|arboard|clipboard_manager|read_os_clipboard|write_os_clipboard|ClipEngine|ClearReason|\.clear\(\)|clear_on_lock/u,
      `${name} must leave the clipboard to the secure-clipboard service`,
    );
  }

  // The service seam this wiring is written against.
  const service = await read(
    "src-tauri/crates/sorng-secure-clip/src/service.rs",
  );
  assert.match(
    service,
    /pub fn clear_on_exit_blocking\(state: &SecureClipServiceState\) -> Result<bool, SecureClipError> \{/u,
  );
  assert.match(
    service,
    /pub type SecureClipServiceState = Arc<RwLock<SecureClipService>>;/u,
  );
  const collab = await read(
    "src-tauri/crates/sorng-app-startup-state/src/collab.rs",
  );
  assert.match(collab, /app\.manage\(secure_clip\);/u);
});

test("the two routes that skip the run events, an in-app restart and a signed update install, clear as well", async () => {
  // `AppHandle::restart` on the main thread, where a sync command runs,
  // replaces the process at once. `request_restart` asks the event loop, so
  // `ExitRequested` and `Exit` reach the handler before the same restart.
  const shell = await read("src-tauri/src/app_shell_commands.rs");
  assert.equal(
    dense(between(shell, "pub fn restart_app<", "\n}\n")),
    "pubfnrestart_app<R:tauri::Runtime>(app:tauri::AppHandle<R>){app.request_restart();",
  );
  assert.doesNotMatch(dense(shell), /\.restart\(\)/u);

  // The updater plugin ends the process itself after its exit hook. The app
  // hands its clear to the updater as soon as the updater is registered.
  const registry = await read("src-tauri/src/state_registry.rs");
  assert.equal(
    dense(between(registry, "fn hand_exit_clear_to_updater(", "\n}\n")),
    "fnhand_exit_clear_to_updater(app:&tauri::App<tauri::Wry>){" +
      "letSome(updater)=app.try_state::<crate::updater::service::UpdaterServiceState>()else{return;};" +
      "lethandle=app.handle().clone();" +
      "updater.set_before_exit(move||clear_secure_clipboard_on_exit(&handle));",
  );
  const register = dense(
    between(
      registry,
      "pub(crate) fn register(",
      "\nfn resolve_user_store_path(",
    ),
  );
  const handed = register.indexOf("hand_exit_clear_to_updater(app);");
  assert.ok(
    register.indexOf("register_infrastructure_prefix(") < handed &&
      handed < register.indexOf("sorng_app_startup_connectivity::register("),
    "handed over right after the registrar that manages the updater",
  );
  const startup = await read(
    "src-tauri/crates/sorng-app-startup-state/src/lib.rs",
  );
  assert.match(startup, /app\.manage\(UpdaterService::new\(/u);

  const updater = await read("src-tauri/crates/sorng-updater/src/service.rs");
  assert.equal(
    dense(between(updater, "pub fn set_before_exit(", "\n    }\n")),
    "pubfnset_before_exit(&self,work:implFn()+Send+Sync+'static){" +
      "let_=self.before_exit.set(Arc::new(work));",
  );
  // Setting the plugin's hook replaces its default, which only cleans up:
  // the app's work first, then that same cleanup, on every updater built.
  const build = dense(
    between(updater, "fn build_updater<R: Runtime>(", "\n    }\n"),
  );
  assert.ok(
    build.endsWith(
      "letexiting=app.clone();" +
        "letcleanup=move||exiting.cleanup_before_exit();" +
        "builder=builder.on_before_exit(before_exit(self.before_exit.get().cloned(),cleanup));" +
        "Ok(builder.build()?)",
    ),
    "build_updater must install the exit hook last, on the builder it returns",
  );
  assert.equal(count(dense(updater), "app.updater_builder()"), 1);
  assert.equal(count(dense(updater), ".on_before_exit("), 1);
  const unsigned = await read("src-tauri/crates/sorng-updater/src/unsigned.rs");
  assert.doesNotMatch(unsigned, /updater_builder|on_before_exit/u);
});

test("each way the exit clear can end is reported once, and the updater's exit hook keeps its order", async (t) => {
  const registry = await read("src-tauri/src/state_registry.rs");
  const updater = await read("src-tauri/crates/sorng-updater/src/service.rs");
  const fixture = await read("tests/tooling/fixtures/secureClipboardExit.rs");
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-clipboard-exit-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-clipboard-exit-"));
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
        "/* PRODUCTION_EXIT_CLEAR */",
        between(
          registry,
          "    /// One line for what the clear did.",
          "    pub(super) fn run(",
        ),
      )
      .replace(
        "/* PRODUCTION_BEFORE_EXIT */",
        between(
          updater,
          "/// Work the embedding app does before",
          "#[derive(Debug, Clone)]\nstruct StoredUpdaterSettings {",
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
