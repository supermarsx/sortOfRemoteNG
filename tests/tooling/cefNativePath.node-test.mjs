import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

test("production CEF settings use the tested native path boundary (std-only rustc)", async (t) => {
  const runtimeUrl = new URL(
    "../../src-tauri/crates/sorng-browser-host/src/cef_runtime.rs",
    import.meta.url,
  );
  const source = await readFile(runtimeUrl, "utf8");
  const wiring = source.match(
    /#\[path = "cef_native_path\.rs"\]\s*mod native_path;/,
  );
  assert.ok(wiring, "production runtime must load the tested path module");
  const start = source.indexOf("pub fn native_settings(");
  const end = source.indexOf("/// Post a coalesced", start);
  assert.ok(
    start >= 0 && end > start,
    "locate both production settings functions",
  );
  const nativePath = fileURLToPath(new URL("cef_native_path.rs", runtimeUrl));
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-path-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const harness = path.join(root, "boundary.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "boundary.exe" : "boundary",
  );

  // Compile the actual settings functions and module, substituting only CEF's
  // data containers. This exercises boundary wiring without CEF linkage/builds.
  await writeFile(
    harness,
    `
use std::path::Path;
${wiring[0].replace('"cef_native_path.rs"', JSON.stringify(nativePath.replaceAll("\\", "/")))}
type CefString = String;
#[derive(Debug, PartialEq)]
pub enum RuntimeError { InvalidPackagePath }
#[derive(Default)]
pub struct Settings {
    browser_subprocess_path: String, resources_dir_path: String,
    root_cache_path: String, cache_path: String,
    external_message_pump: i32, command_line_args_disabled: i32,
    no_sandbox: i32, multi_threaded_message_loop: i32,
    windowless_rendering_enabled: i32, remote_debugging_port: i32,
    persist_session_cookies: i32, background_color: u32,
}
${source.slice(start, end)}

#[test]
fn production_settings_normalize_canonical_paths_and_keep_private_profiles() {
    let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
    let directory = executable.parent().unwrap();
    let settings = native_settings_with_data_root(&executable, directory, directory).unwrap();
    #[cfg(windows)]
    let expected = directory.to_str().unwrap().strip_prefix(r"\\\\?\\").unwrap();
    #[cfg(not(windows))]
    let expected = directory.to_str().unwrap();
    assert_eq!(settings.root_cache_path, expected);
    assert_eq!(settings.resources_dir_path, expected);
    if cfg!(windows) {
        assert!(settings.browser_subprocess_path.is_empty());
    } else {
        assert_eq!(settings.browser_subprocess_path, executable.to_str().unwrap());
    }
    assert!(settings.cache_path.is_empty());
    assert_eq!(settings.persist_session_cookies, 0);
    assert_eq!(settings.no_sandbox, 0);
    assert_eq!(settings.external_message_pump, 1);
    assert_eq!(settings.command_line_args_disabled, 1);
    assert_eq!(settings.multi_threaded_message_loop, 0);
    assert_eq!(settings.windowless_rendering_enabled, 0);
    assert_eq!(settings.remote_debugging_port, 0);
    assert_eq!(settings.background_color, 0xff18181b);
    assert!(native_settings(&executable, directory).unwrap().root_cache_path.is_empty());
}

#[test]
fn production_settings_reject_invalid_inputs_in_all_three_path_positions() {
    let executable = std::env::current_exe().unwrap();
    let directory = executable.parent().unwrap();
    for invalid in [Path::new("relative"), Path::new("missing\\0path")] {
        assert_eq!(native_settings(invalid, directory).err(), Some(RuntimeError::InvalidPackagePath));
        assert_eq!(native_settings(&executable, invalid).err(), Some(RuntimeError::InvalidPackagePath));
        assert_eq!(native_settings_with_data_root(&executable, directory, invalid).err(), Some(RuntimeError::InvalidPackagePath));
    }
    assert!(native_settings(directory, directory).is_err());
    assert!(native_settings(&executable, &executable).is_err());
    assert!(native_settings_with_data_root(&executable, directory, &executable).is_err());
    #[cfg(windows)]
    {
        // A Win32 alias exists, but the boundary must reject its raw spelling.
        let aliased = format!("{}.", directory.display());
        assert!(Path::new(&aliased).is_dir());
        assert!(native_settings(&executable, Path::new(&aliased)).is_err());
        assert!(native_settings_with_data_root(&executable, directory, Path::new(&aliased)).is_err());
        let helper_alias = format!("{}.", executable.display());
        assert!(Path::new(&helper_alias).is_file());
        assert!(native_settings(Path::new(&helper_alias), directory).is_err());
    }
}
`,
  );
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  t.diagnostic(
    execFileSync(binary, ["--nocapture"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    }).trim(),
  );
});
