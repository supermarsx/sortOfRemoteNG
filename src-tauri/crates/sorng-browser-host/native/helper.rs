//! Dedicated CEF subprocess. No app services, profiles, logger or Tauri here.
//! Register as sorng-cef-helper with required-features = ["cef-host"].

#[cfg(target_os = "linux")]
fn run() -> Result<i32, Box<dyn std::error::Error>> {
    use sorng_browser_host::bootstrap_platform::{
        select_pinned_api, OwnedMainArgs, ProcessDispatch,
    };
    select_pinned_api()?;
    let args = OwnedMainArgs::from_current_process()?;
    let mut app = sorng_browser_host::cef_runtime::subprocess_application();
    match ProcessDispatch::from_cef_exit_code(cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    ))? {
        ProcessDispatch::Exit(code) => Ok(code),
        ProcessDispatch::Browser => Err("CEF helper requires a subprocess type".into()),
    }
}

#[cfg(target_os = "macos")]
fn run() -> Result<i32, Box<dyn std::error::Error>> {
    use sorng_browser_host::platform::macos::MacHelperBootstrap;
    // Initialize seatbelt BEFORE loading CEF or constructing any CEF wrappers.
    let provider =
        unsafe { MacHelperBootstrap::from_bundle_executable(&std::env::current_exe()?)? };
    let app = sorng_browser_host::cef_runtime::subprocess_application();
    Ok(unsafe { provider.execute_and_exit(Some(app))? })
}

fn main() {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let code = match run() {
        Ok(code) => code,
        Err(_) => 1, // Never print process arguments or credentials.
    };
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let code = 1; // Windows must use bootstrap.exe and the application DLL.
    std::process::exit(code);
}
