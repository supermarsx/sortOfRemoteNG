pub mod commands {
    use std::io::Read;
    use std::path::{Path, PathBuf};
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    use std::process::{Command, Stdio};
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    use std::time::{Duration, Instant};
    use tauri::Manager;

    #[derive(Debug, Clone, serde::Serialize)]
    pub struct LaunchArgs {
        pub collection_id: Option<String>,
        pub connection_id: Option<String>,
    }

    #[derive(serde::Serialize)]
    pub struct ScannedShortcut {
        name: String,
        path: String,
        target: Option<String>,
        arguments: Option<String>,
        is_sortofremoteng: bool,
    }

    const MAX_SHORTCUT_NAME_CHARS: usize = 128;
    const MAX_SHORTCUT_ID_CHARS: usize = 512;
    const MAX_SHORTCUT_DESCRIPTION_CHARS: usize = 1024;
    const MAX_SHORTCUT_SCAN_FOLDERS: usize = 32;
    const MAX_SHORTCUT_SCAN_RESULTS: usize = 1024;
    #[cfg(target_os = "linux")]
    const MAX_SHORTCUT_FILE_BYTES: u64 = 64 * 1024;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    const MAX_HELPER_OUTPUT_BYTES: usize = 64 * 1024;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    const HELPER_TIMEOUT: Duration = Duration::from_secs(15);

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    struct BoundedCommandOutput {
        success: bool,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    fn drain_bounded<R: Read>(mut reader: R, limit: usize) -> std::io::Result<Vec<u8>> {
        let mut retained = Vec::with_capacity(limit.min(8192));
        let mut buffer = [0_u8; 8192];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                return Ok(retained);
            }
            let remaining = limit.saturating_sub(retained.len());
            retained.extend_from_slice(&buffer[..count.min(remaining)]);
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    fn bounded_output_text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes)
            .chars()
            .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
            .take(2048)
            .collect::<String>()
            .trim()
            .to_string()
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    fn run_bounded_command(
        command: &mut Command,
        label: &str,
    ) -> Result<BoundedCommandOutput, String> {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start {label}: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{label} stdout was unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| format!("{label} stderr was unavailable"))?;
        let stdout_reader =
            std::thread::spawn(move || drain_bounded(stdout, MAX_HELPER_OUTPUT_BYTES));
        let stderr_reader =
            std::thread::spawn(move || drain_bounded(stderr, MAX_HELPER_OUTPUT_BYTES));
        let deadline = Instant::now() + HELPER_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(format!("{label} timed out and was terminated"));
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(format!("Failed while waiting for {label}: {error}"));
                }
            }
        };
        let stdout = stdout_reader
            .join()
            .map_err(|_| format!("{label} stdout reader failed"))?
            .map_err(|error| format!("Failed reading {label} stdout: {error}"))?;
        let stderr = stderr_reader
            .join()
            .map_err(|_| format!("{label} stderr reader failed"))?
            .map_err(|error| format!("Failed reading {label} stderr: {error}"))?;
        Ok(BoundedCommandOutput {
            success: status.success(),
            stdout,
            stderr,
        })
    }

    #[cfg(target_os = "linux")]
    fn read_small_utf8_file(path: &Path) -> Result<String, String> {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|error| format!("Failed to inspect shortcut: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Shortcut must be a regular non-symlink file".to_string());
        }
        if metadata.len() > MAX_SHORTCUT_FILE_BYTES {
            return Err("Shortcut file exceeds the supported size".to_string());
        }
        let file = std::fs::File::open(path)
            .map_err(|error| format!("Failed to open shortcut: {error}"))?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_SHORTCUT_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Failed to read shortcut: {error}"))?;
        if bytes.len() as u64 > MAX_SHORTCUT_FILE_BYTES {
            return Err("Shortcut file changed to an oversized file while reading".to_string());
        }
        String::from_utf8(bytes).map_err(|_| "Shortcut file is not valid UTF-8".to_string())
    }

    fn require_regular_executable(path: PathBuf, label: &str) -> Result<PathBuf, String> {
        let metadata = std::fs::metadata(&path)
            .map_err(|_| format!("Trusted {} executable was not found", label))?;
        if !metadata.is_file() {
            return Err(format!("Trusted {} path is not a regular file", label));
        }
        path.canonicalize()
            .map_err(|e| format!("Failed to resolve trusted {} executable: {}", label, e))
    }

    #[cfg(target_os = "windows")]
    fn windows_system_executable(relative: &[&str], label: &str) -> Result<PathBuf, String> {
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| "SystemRoot is unavailable or is not absolute".to_string())?;
        let path = relative
            .iter()
            .fold(system_root, |path, component| path.join(component));
        require_regular_executable(path, label)
    }

    #[cfg(target_os = "linux")]
    fn linux_system_executable(path: &str, label: &str) -> Result<PathBuf, String> {
        require_regular_executable(PathBuf::from(path), label)
    }

    #[cfg(target_os = "macos")]
    fn macos_system_executable(path: &str, label: &str) -> Result<PathBuf, String> {
        require_regular_executable(PathBuf::from(path), label)
    }

    fn validate_external_url(url: &str) -> Result<&str, String> {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("Only http and https URLs are supported".into());
        }

        if url.len() > 16_384 || url.chars().any(char::is_control) {
            return Err("URL is too long or contains control characters".into());
        }

        Ok(url)
    }

    #[cfg(target_os = "windows")]
    fn open_external_url_with_windows_shell(url: &str) -> Result<(), String> {
        use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
        use windows_sys::{
            w,
            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };

        let encoded_url = OsStr::new(url)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                w!("open"),
                encoded_url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };

        // Per ShellExecuteW, values greater than 32 indicate that Windows
        // accepted the request. Explorer.exe can exit successfully without
        // handing an URL to the registered browser, which is why URLs use the
        // shell association API directly instead.
        if result as isize <= 32 {
            return Err(format!(
                "Windows could not open the URL with its registered browser (ShellExecuteW code {})",
                result as isize
            ));
        }

        Ok(())
    }

    fn validate_shortcut_name(name: &str) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Shortcut name must not be empty".to_string());
        }
        if name.chars().count() > MAX_SHORTCUT_NAME_CHARS {
            return Err(format!(
                "Shortcut name must not exceed {} characters",
                MAX_SHORTCUT_NAME_CHARS
            ));
        }
        if name == "."
            || name == ".."
            || name.ends_with(['.', ' '])
            || name
                .chars()
                .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        {
            return Err(
                "Shortcut name contains path separators or unsupported filename characters"
                    .to_string(),
            );
        }
        Ok(name.to_string())
    }

    fn validate_shortcut_id(label: &str, value: Option<String>) -> Result<Option<String>, String> {
        let Some(value) = value else {
            return Ok(None);
        };
        if value.is_empty()
            || value.chars().count() > MAX_SHORTCUT_ID_CHARS
            || !value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c))
        {
            return Err(format!(
                "{} must contain only letters, digits, '-', '_', '.', or ':' and be at most {} characters",
                label, MAX_SHORTCUT_ID_CHARS
            ));
        }
        Ok(Some(value))
    }

    fn sanitize_shortcut_description(description: Option<String>, name: &str) -> String {
        description
            .unwrap_or_else(|| format!("Launch {} with specific connection", name))
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_SHORTCUT_DESCRIPTION_CHARS)
            .collect()
    }

    fn resolve_shortcut_target_directory(folder_path: Option<&str>) -> Result<PathBuf, String> {
        let target_dir = match folder_path {
            Some(path) => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    return Err("Shortcut folder must be an absolute path".to_string());
                }
                path
            }
            None => dirs::desktop_dir().ok_or("Failed to get desktop directory")?,
        };

        if !target_dir.exists() {
            std::fs::create_dir_all(&target_dir)
                .map_err(|e| format!("Failed to create shortcut directory: {}", e))?;
        }
        let target_dir = target_dir
            .canonicalize()
            .map_err(|e| format!("Failed to resolve shortcut directory: {}", e))?;
        if !target_dir.is_dir() {
            return Err("Shortcut folder must reference a directory".to_string());
        }
        Ok(target_dir)
    }

    #[cfg(target_os = "linux")]
    fn quote_desktop_exec_argument(value: &str) -> String {
        let mut escaped = String::with_capacity(value.len() + 2);
        for character in value.chars() {
            if matches!(character, '\\' | '"' | '`' | '$') {
                escaped.push('\\');
            }
            escaped.push(character);
        }
        format!("\"{}\"", escaped)
    }

    #[cfg(target_os = "windows")]
    const CREATE_SHORTCUT_POWERSHELL: &str = r#"
$ErrorActionPreference = 'Stop'
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($env:SORNG_SHORTCUT_PATH)
$Shortcut.TargetPath = $env:SORNG_APP_PATH
$Shortcut.Arguments = $env:SORNG_SHORTCUT_ARGS
$Shortcut.WorkingDirectory = $env:SORNG_WORKING_DIRECTORY
$Shortcut.Description = $env:SORNG_SHORTCUT_DESCRIPTION
$Shortcut.Save()
"#;

    #[cfg(target_os = "windows")]
    const READ_SHORTCUT_POWERSHELL: &str = r#"
$ErrorActionPreference = 'Stop'
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($env:SORNG_SHORTCUT_PATH)
Write-Output $Shortcut.TargetPath
Write-Output '---SEPARATOR---'
Write-Output $Shortcut.Arguments
"#;

    #[cfg(target_os = "macos")]
    const CREATE_ALIAS_APPLESCRIPT: &str = r#"
set appPath to system attribute "SORNG_APP_PATH"
set aliasName to system attribute "SORNG_ALIAS_NAME"
set targetDirectory to system attribute "SORNG_TARGET_DIRECTORY"
tell application "Finder"
  make new alias file at POSIX file targetDirectory to POSIX file appPath with properties {name:aliasName}
end tell
"#;

    pub fn parse_launch_args(args: impl IntoIterator<Item = String>) -> LaunchArgs {
        let args: Vec<String> = args.into_iter().collect();
        let mut collection_id = None;
        let mut connection_id = None;

        let mut i = 1;
        while i < args.len() {
            match args[i].as_str() {
                "--collection" | "-c" if i + 1 < args.len() => {
                    collection_id = Some(args[i + 1].clone());
                    i += 2;
                }
                "--collection" | "-c" => {
                    i += 1;
                }
                "--connection" | "-n" if i + 1 < args.len() => {
                    connection_id = Some(args[i + 1].clone());
                    i += 2;
                }
                "--connection" | "-n" => {
                    i += 1;
                }
                arg if arg.starts_with("--collection=") => {
                    if let Some(value) = arg.strip_prefix("--collection=").filter(|v| !v.is_empty())
                    {
                        collection_id = Some(value.to_string());
                    }
                    i += 1;
                }
                arg if arg.starts_with("--connection=") => {
                    if let Some(value) = arg.strip_prefix("--connection=").filter(|v| !v.is_empty())
                    {
                        connection_id = Some(value.to_string());
                    }
                    i += 1;
                }
                _ => {
                    i += 1;
                }
            }
        }

        LaunchArgs {
            collection_id,
            connection_id,
        }
    }

    #[cfg(test)]
    mod launch_args_tests {
        use super::parse_launch_args;

        fn args(values: &[&str]) -> Vec<String> {
            values.iter().map(|value| (*value).to_string()).collect()
        }

        #[test]
        fn parses_spaced_long_and_short_launch_arguments() {
            let parsed = parse_launch_args(args(&[
                "sortofremoteng",
                "--collection",
                "collection-long",
                "-n",
                "connection-short",
            ]));

            assert_eq!(parsed.collection_id.as_deref(), Some("collection-long"));
            assert_eq!(parsed.connection_id.as_deref(), Some("connection-short"));
        }

        #[test]
        fn parses_equals_style_launch_arguments() {
            let parsed = parse_launch_args(args(&[
                "sortofremoteng",
                "--collection=collection-webview",
                "--connection=connection-webview",
            ]));

            assert_eq!(parsed.collection_id.as_deref(), Some("collection-webview"));
            assert_eq!(parsed.connection_id.as_deref(), Some("connection-webview"));
        }

        #[test]
        fn last_valid_launch_argument_wins_across_supported_styles() {
            let parsed = parse_launch_args(args(&[
                "sortofremoteng",
                "--collection=collection-first",
                "--collection",
                "collection-last",
                "--connection",
                "connection-first",
                "--connection=connection-last",
            ]));

            assert_eq!(parsed.collection_id.as_deref(), Some("collection-last"));
            assert_eq!(parsed.connection_id.as_deref(), Some("connection-last"));
        }

        #[test]
        fn ignores_empty_or_missing_launch_argument_values() {
            let parsed = parse_launch_args(args(&[
                "sortofremoteng",
                "--collection=",
                "--connection=",
                "--collection",
            ]));

            assert!(parsed.collection_id.is_none());
            assert!(parsed.connection_id.is_none());
        }
    }

    #[tauri::command]
    pub fn greet(name: &str) -> String {
        format!("Hello, {}! You've been greeted from Rust!", name)
    }

    #[tauri::command]
    pub fn open_url_external(url: String) -> Result<(), String> {
        let url = validate_external_url(&url)?;

        #[cfg(target_os = "windows")]
        {
            open_external_url_with_windows_shell(url)?;
        }
        #[cfg(target_os = "macos")]
        {
            let open = macos_system_executable("/usr/bin/open", "macOS open")?;
            std::process::Command::new(open)
                .arg(url)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        {
            let xdg_open = linux_system_executable("/usr/bin/xdg-open", "xdg-open")?;
            std::process::Command::new(xdg_open)
                .arg(url)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// Open the webview DevTools for the main window.
    ///
    /// DevTools are gated to debug builds. The workspace intentionally does
    /// NOT enable the `devtools` Tauri feature (see `src-tauri/Cargo.toml`),
    /// so Tauri's `WebviewWindow::open_devtools` — itself gated by
    /// `cfg(any(debug_assertions, feature = "devtools"))` — only exists under
    /// `debug_assertions`. In a release build this command is therefore an
    /// inert no-op AND is not registered in the IPC handler (see
    /// `core_handler::build`), so the
    /// `core:webview:allow-internal-toggle-devtools` capability has nothing
    /// to authorize.
    #[tauri::command]
    pub fn open_devtools(app: tauri::AppHandle) {
        #[cfg(debug_assertions)]
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
        }
        #[cfg(not(debug_assertions))]
        let _ = app;
    }

    #[tauri::command]
    pub fn get_launch_args(state: tauri::State<'_, LaunchArgs>) -> LaunchArgs {
        state.inner().clone()
    }

    /// Strip newlines and control characters from a string to prevent
    /// injection into .desktop files or similar config formats.
    #[cfg(target_os = "linux")]
    fn sanitize_desktop_entry(input: &str) -> String {
        input
            .chars()
            .filter(|c| !c.is_control() && *c != '\\')
            .collect()
    }

    #[tauri::command]
    pub async fn create_desktop_shortcut(
        name: String,
        collection_id: Option<String>,
        connection_id: Option<String>,
        description: Option<String>,
        folder_path: Option<String>,
    ) -> Result<String, String> {
        let app_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get application path: {}", e))?
            .canonicalize()
            .map_err(|e| format!("Failed to resolve application path: {}", e))?;
        if !app_path.is_file() {
            return Err("Application path must reference a regular file".to_string());
        }

        let name = validate_shortcut_name(&name)?;
        let collection_id = validate_shortcut_id("Collection ID", collection_id)?;
        let connection_id = validate_shortcut_id("Connection ID", connection_id)?;
        let description = sanitize_shortcut_description(description, &name);
        let target_dir = resolve_shortcut_target_directory(folder_path.as_deref())?;

        let mut args = Vec::new();
        if let Some(collection_id) = collection_id.as_ref() {
            args.push("--collection".to_string());
            args.push(collection_id.clone());
        }
        if let Some(connection_id) = connection_id.as_ref() {
            args.push("--connection".to_string());
            args.push(connection_id.clone());
        }

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;

            let shortcut_path = target_dir.join(format!("{}.lnk", name));
            let powershell = windows_system_executable(
                &["System32", "WindowsPowerShell", "v1.0", "powershell.exe"],
                "Windows PowerShell",
            )?;
            let output = run_bounded_command(
                Command::new(powershell)
                    .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
                    .arg(CREATE_SHORTCUT_POWERSHELL)
                    .env("SORNG_SHORTCUT_PATH", &shortcut_path)
                    .env("SORNG_APP_PATH", &app_path)
                    .env("SORNG_SHORTCUT_ARGS", args.join(" "))
                    .env(
                        "SORNG_WORKING_DIRECTORY",
                        app_path.parent().unwrap_or(&app_path),
                    )
                    .env("SORNG_SHORTCUT_DESCRIPTION", &description),
                "PowerShell shortcut helper",
            )?;

            if !output.success {
                return Err(format!(
                    "PowerShell command failed: {}",
                    bounded_output_text(&output.stderr)
                ));
            }

            Ok(shortcut_path.to_string_lossy().to_string())
        }

        #[cfg(target_os = "linux")]
        {
            use std::fs;

            let shortcut_path = target_dir.join(format!("{}.desktop", name));
            let sanitized_name = sanitize_desktop_entry(&name);
            let sanitized_desc = sanitize_desktop_entry(&description);
            let mut exec_arguments = vec![quote_desktop_exec_argument(&app_path.to_string_lossy())];
            exec_arguments.extend(
                args.iter()
                    .map(|argument| quote_desktop_exec_argument(argument)),
            );
            let desktop_file_content = format!(
                r#"[Desktop Entry]
Version=1.0
Type=Application
Name={}
Comment={}
Exec={}
Path={}
Terminal=false
StartupNotify=false
"#,
                sanitized_name,
                sanitized_desc,
                exec_arguments.join(" "),
                app_path.parent().unwrap_or(&app_path).display()
            );

            fs::write(&shortcut_path, desktop_file_content)
                .map_err(|e| format!("Failed to write desktop file: {}", e))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&shortcut_path)
                    .map_err(|e| format!("Failed to get file metadata: {}", e))?
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&shortcut_path, perms)
                    .map_err(|e| format!("Failed to set file permissions: {}", e))?;
            }

            Ok(shortcut_path.to_string_lossy().to_string())
        }

        #[cfg(target_os = "macos")]
        {
            use std::process::Command;

            let alias_name = format!("{} alias", name);
            let alias_path = target_dir.join(&alias_name);
            let osascript =
                macos_system_executable("/usr/bin/osascript", "AppleScript interpreter")?;
            let output = run_bounded_command(
                Command::new(osascript)
                    .arg("-e")
                    .arg(CREATE_ALIAS_APPLESCRIPT)
                    .env("SORNG_APP_PATH", &app_path)
                    .env("SORNG_ALIAS_NAME", &alias_name)
                    .env("SORNG_TARGET_DIRECTORY", &target_dir),
                "AppleScript alias helper",
            )?;

            if !output.success {
                return Err(format!(
                    "AppleScript command failed: {}",
                    bounded_output_text(&output.stderr)
                ));
            }

            Ok(alias_path.to_string_lossy().to_string())
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        {
            let _ = (
                name,
                collection_id,
                connection_id,
                description,
                target_dir,
                args,
            );
            Err("Desktop shortcuts are not supported on this platform".to_string())
        }
    }

    #[tauri::command]
    pub async fn set_autostart(enabled: bool, app: tauri::AppHandle) -> Result<(), String> {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app.autolaunch();

        if enabled {
            autostart_manager
                .enable()
                .map_err(|e| format!("Failed to enable autostart: {}", e))?;
        } else {
            autostart_manager
                .disable()
                .map_err(|e| format!("Failed to disable autostart: {}", e))?;
        }

        Ok(())
    }

    #[tauri::command]
    pub fn get_desktop_path() -> Result<String, String> {
        dirs::desktop_dir()
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "Failed to get desktop directory".to_string())
    }

    #[tauri::command]
    pub fn get_documents_path() -> Result<String, String> {
        dirs::document_dir()
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "Failed to get documents directory".to_string())
    }

    #[tauri::command]
    pub fn get_appdata_path() -> Result<String, String> {
        #[cfg(target_os = "windows")]
        {
            dirs::data_dir()
                .map(|p| {
                    p.join("Microsoft")
                        .join("Windows")
                        .join("Start Menu")
                        .join("Programs")
                })
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| "Failed to get appdata directory".to_string())
        }

        #[cfg(target_os = "linux")]
        {
            dirs::data_local_dir()
                .map(|p| p.join("applications"))
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| "Failed to get applications directory".to_string())
        }

        #[cfg(target_os = "macos")]
        {
            dirs::home_dir()
                .map(|p| p.join("Applications"))
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| "Failed to get applications directory".to_string())
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        {
            Err("AppData path not supported on this platform".to_string())
        }
    }

    fn platform_shortcut_directories() -> Vec<PathBuf> {
        let mut directories = Vec::new();
        for path in [get_desktop_path(), get_documents_path(), get_appdata_path()]
            .into_iter()
            .flatten()
        {
            let path = PathBuf::from(path);
            if !directories.contains(&path) {
                directories.push(path);
            }
        }
        directories
    }

    fn supported_shortcut_extensions() -> &'static [&'static str] {
        #[cfg(target_os = "windows")]
        {
            &["lnk"]
        }
        #[cfg(target_os = "linux")]
        {
            &["desktop"]
        }
        #[cfg(target_os = "macos")]
        {
            &["app"]
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        {
            &[]
        }
    }

    fn is_supported_shortcut_file(path: &Path) -> bool {
        let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
            return false;
        };
        supported_shortcut_extensions()
            .iter()
            .any(|supported| extension.eq_ignore_ascii_case(supported))
    }

    fn canonical_shortcut_roots(roots: &[PathBuf]) -> Vec<PathBuf> {
        let mut canonical_roots = Vec::new();
        for root in roots {
            if let Ok(root) = root.canonicalize() {
                if !canonical_roots.contains(&root) {
                    canonical_roots.push(root);
                }
            }
        }
        canonical_roots
    }

    fn approved_scan_directories(folders: &[String], roots: &[PathBuf]) -> Vec<PathBuf> {
        let approved_roots = canonical_shortcut_roots(roots);
        let mut approved = Vec::new();
        for folder in folders {
            let Ok(folder) = Path::new(folder).canonicalize() else {
                continue;
            };
            if approved_roots.contains(&folder) && !approved.contains(&folder) {
                approved.push(folder);
            }
        }
        approved
    }

    fn validate_shortcut_file(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|e| format!("Failed to inspect shortcut: {}", e))?;
        if metadata.file_type().is_symlink() {
            return Err("Shortcut path must not be a symbolic link".to_string());
        }
        if !metadata.is_file() {
            return Err("Shortcut path must reference a regular file".to_string());
        }
        if !is_supported_shortcut_file(path) {
            return Err("Unsupported shortcut file extension".to_string());
        }

        let canonical_path = path
            .canonicalize()
            .map_err(|e| format!("Failed to resolve shortcut path: {}", e))?;
        let approved_roots = canonical_shortcut_roots(roots);
        if !approved_roots
            .iter()
            .any(|root| canonical_path.starts_with(root))
        {
            return Err("Shortcut path is outside approved shortcut directories".to_string());
        }
        Ok(canonical_path)
    }

    fn check_shortcut_in_roots(path: &Path, roots: &[PathBuf]) -> Result<bool, String> {
        match std::fs::symlink_metadata(path) {
            Ok(_) => validate_shortcut_file(path, roots).map(|_| true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!("Failed to inspect shortcut: {}", error)),
        }
    }

    fn delete_shortcut_in_roots(path: &Path, roots: &[PathBuf]) -> Result<(), String> {
        let canonical_path = validate_shortcut_file(path, roots)?;
        std::fs::remove_file(&canonical_path).map_err(|e| format!("Failed to delete file: {}", e))
    }

    #[tauri::command]
    pub fn check_shortcut(path: String) -> Result<bool, String> {
        check_shortcut_in_roots(Path::new(&path), &platform_shortcut_directories())
    }

    #[tauri::command]
    pub fn delete_shortcut(path: String) -> Result<(), String> {
        delete_shortcut_in_roots(Path::new(&path), &platform_shortcut_directories())
    }

    #[cfg(test)]
    mod shortcut_path_tests {
        use super::{
            approved_scan_directories, check_shortcut_in_roots, delete_shortcut_in_roots,
            supported_shortcut_extensions, validate_shortcut_file,
        };
        use std::path::{Path, PathBuf};
        use std::time::{SystemTime, UNIX_EPOCH};

        struct TestTree(PathBuf);

        impl Drop for TestTree {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        fn test_tree() -> (TestTree, PathBuf, PathBuf) {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock must follow the Unix epoch")
                .as_nanos();
            let base = std::env::temp_dir().join(format!(
                "sorng-shortcut-path-test-{}-{}",
                std::process::id(),
                nonce
            ));
            let allowed = base.join("allowed");
            let outside = base.join("outside");
            std::fs::create_dir_all(&allowed).expect("create allowed test directory");
            std::fs::create_dir_all(&outside).expect("create outside test directory");
            (TestTree(base), allowed, outside)
        }

        fn shortcut_path(directory: &Path, name: &str) -> PathBuf {
            let extension = supported_shortcut_extensions()
                .first()
                .expect("desktop targets must define a shortcut extension");
            directory.join(format!("{name}.{extension}"))
        }

        #[test]
        fn scanner_accepts_only_exact_canonical_platform_directories() {
            let (_tree, allowed, outside) = test_tree();
            let requested = vec![
                allowed.to_string_lossy().to_string(),
                outside.to_string_lossy().to_string(),
                allowed.join("missing").to_string_lossy().to_string(),
            ];

            let approved = approved_scan_directories(&requested, std::slice::from_ref(&allowed));

            assert_eq!(
                approved,
                vec![allowed.canonicalize().expect("canonical allowed directory")]
            );
        }

        #[test]
        fn valid_shortcut_can_be_checked_and_deleted_inside_an_approved_root() {
            let (_tree, allowed, _outside) = test_tree();
            let shortcut = shortcut_path(&allowed, "valid");
            std::fs::write(&shortcut, b"shortcut").expect("create shortcut");

            assert!(
                check_shortcut_in_roots(&shortcut, std::slice::from_ref(&allowed))
                    .expect("check valid shortcut")
            );
            delete_shortcut_in_roots(&shortcut, std::slice::from_ref(&allowed))
                .expect("delete valid shortcut");
            assert!(!shortcut.exists());
        }

        #[test]
        fn traversal_outside_an_approved_root_is_rejected() {
            let (_tree, allowed, outside) = test_tree();
            let shortcut = shortcut_path(&outside, "escaped");
            std::fs::write(&shortcut, b"shortcut").expect("create outside shortcut");
            let traversing_path = allowed
                .join("..")
                .join("outside")
                .join(shortcut.file_name().expect("shortcut file name"));

            let error = validate_shortcut_file(&traversing_path, std::slice::from_ref(&allowed))
                .expect_err("traversal must be rejected");

            assert!(error.contains("outside approved shortcut directories"));
            assert!(shortcut.exists());
        }

        #[test]
        fn directories_and_unsupported_extensions_are_rejected() {
            let (_tree, allowed, _outside) = test_tree();
            let disguised_directory = shortcut_path(&allowed, "directory");
            std::fs::create_dir(&disguised_directory).expect("create disguised directory");
            let unsupported = allowed.join("not-a-shortcut.txt");
            std::fs::write(&unsupported, b"not a shortcut").expect("create unsupported file");

            let directory_error =
                validate_shortcut_file(&disguised_directory, std::slice::from_ref(&allowed))
                    .expect_err("directories must be rejected");
            let extension_error =
                validate_shortcut_file(&unsupported, std::slice::from_ref(&allowed))
                    .expect_err("unsupported extensions must be rejected");

            assert!(directory_error.contains("regular file"));
            assert!(extension_error.contains("Unsupported shortcut file extension"));
        }

        #[cfg(any(unix, windows))]
        #[test]
        fn symbolic_link_escape_is_rejected() {
            let (_tree, allowed, outside) = test_tree();
            let outside_shortcut = shortcut_path(&outside, "outside-target");
            let link = shortcut_path(&allowed, "shortcut-link");
            std::fs::write(&outside_shortcut, b"shortcut").expect("create outside shortcut");

            #[cfg(unix)]
            std::os::unix::fs::symlink(&outside_shortcut, &link).expect("create shortcut symlink");
            #[cfg(windows)]
            if std::os::windows::fs::symlink_file(&outside_shortcut, &link).is_err() {
                // Windows symlink creation can require Developer Mode or an
                // elevated token. The production rejection is platform-neutral.
                return;
            }

            let error = validate_shortcut_file(&link, std::slice::from_ref(&allowed))
                .expect_err("symlink escape must be rejected");

            assert!(error.contains("symbolic link"));
            assert!(outside_shortcut.exists());
        }
    }

    #[tauri::command]
    pub fn open_folder(path: String) -> Result<(), String> {
        let path = PathBuf::from(path)
            .canonicalize()
            .map_err(|e| format!("Failed to resolve folder: {}", e))?;
        if !path.is_dir() {
            return Err("Folder path must reference an existing directory".to_string());
        }

        #[cfg(target_os = "windows")]
        {
            let explorer = windows_system_executable(&["explorer.exe"], "Windows Explorer")?;
            std::process::Command::new(explorer)
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            let xdg_open = linux_system_executable("/usr/bin/xdg-open", "xdg-open")?;
            std::process::Command::new(xdg_open)
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }

        #[cfg(target_os = "macos")]
        {
            let open = macos_system_executable("/usr/bin/open", "macOS open")?;
            std::process::Command::new(open)
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }

        Ok(())
    }

    #[tauri::command]
    pub fn flash_window(app: tauri::AppHandle) -> Result<(), String> {
        if let Some(window) = app.get_webview_window("main") {
            window
                .request_user_attention(Some(tauri::UserAttentionType::Informational))
                .map_err(|e| format!("Failed to flash window: {}", e))?;
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn scan_shortcuts(folders: Vec<String>) -> Result<Vec<ScannedShortcut>, String> {
        let mut shortcuts = Vec::new();
        let platform_directories = platform_shortcut_directories();
        let folders = approved_scan_directories(&folders, &platform_directories);

        for folder in folders.into_iter().take(MAX_SHORTCUT_SCAN_FOLDERS) {
            let entries = match std::fs::read_dir(&folder) {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                if shortcuts.len() >= MAX_SHORTCUT_SCAN_RESULTS {
                    return Ok(shortcuts);
                }
                let path = entry.path();
                if validate_shortcut_file(&path, &platform_directories).is_err() {
                    continue;
                }

                #[cfg(target_os = "windows")]
                {
                    if let Some(ext) = path.extension() {
                        if ext.to_string_lossy().to_lowercase() == "lnk" {
                            let name = path
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let (target, arguments, is_sortofremoteng) = get_shortcut_info(&path);
                            shortcuts.push(ScannedShortcut {
                                name,
                                path: path.to_string_lossy().to_string(),
                                target,
                                arguments,
                                is_sortofremoteng,
                            });
                        }
                    }
                }

                #[cfg(target_os = "linux")]
                {
                    if let Some(ext) = path.extension() {
                        if ext.to_string_lossy().to_lowercase() == "desktop" {
                            let name = path
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let (target, arguments, is_sortofremoteng) =
                                if let Ok(content) = read_small_utf8_file(&path) {
                                    let exec_line = content
                                        .lines()
                                        .find(|line| line.starts_with("Exec="))
                                        .map(|line| line.trim_start_matches("Exec=").to_string());
                                    let is_ours = content.to_lowercase().contains("sortofremoteng");
                                    (exec_line.clone(), None, is_ours)
                                } else {
                                    (None, None, false)
                                };

                            shortcuts.push(ScannedShortcut {
                                name,
                                path: path.to_string_lossy().to_string(),
                                target,
                                arguments,
                                is_sortofremoteng,
                            });
                        }
                    }
                }

                #[cfg(target_os = "macos")]
                {
                    if let Some(ext) = path.extension() {
                        if ext.to_string_lossy().to_lowercase() == "app" {
                            let name = path
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let is_sortofremoteng = name.to_lowercase().contains("sortofremoteng");

                            shortcuts.push(ScannedShortcut {
                                name,
                                path: path.to_string_lossy().to_string(),
                                target: None,
                                arguments: None,
                                is_sortofremoteng,
                            });
                        }
                    }
                }
            }
        }

        Ok(shortcuts)
    }

    #[cfg(target_os = "windows")]
    fn get_shortcut_info(path: &std::path::Path) -> (Option<String>, Option<String>, bool) {
        use std::process::Command;

        let Ok(powershell) = windows_system_executable(
            &["System32", "WindowsPowerShell", "v1.0", "powershell.exe"],
            "Windows PowerShell",
        ) else {
            return (None, None, false);
        };

        match run_bounded_command(
            Command::new(powershell)
                .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
                .arg(READ_SHORTCUT_POWERSHELL)
                .env("SORNG_SHORTCUT_PATH", path),
            "PowerShell shortcut reader",
        ) {
            Ok(output) if output.success => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let parts: Vec<&str> = stdout.split("---SEPARATOR---").collect();
                let target = parts
                    .first()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                let arguments = parts
                    .get(1)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                let is_sortofremoteng = target
                    .as_ref()
                    .map(|t| t.to_lowercase().contains("sortofremoteng"))
                    .unwrap_or(false)
                    || arguments
                        .as_ref()
                        .map(|a| a.contains("--collection") || a.contains("--connection"))
                        .unwrap_or(false);

                (target, arguments, is_sortofremoteng)
            }
            _ => (None, None, false),
        }
    }

    #[cfg(test)]
    mod process_safety_tests {
        use super::{validate_external_url, validate_shortcut_id, validate_shortcut_name};

        #[test]
        fn external_urls_accept_web_links_and_reject_non_web_or_control_input() {
            for url in [
                "https://github.com/supermarsx/sortOfRemoteNG/releases/latest",
                "http://127.0.0.1:3000/update",
            ] {
                assert_eq!(
                    validate_external_url(url).expect("web URL should be accepted"),
                    url
                );
            }

            for url in [
                "file:///C:/Windows/System32/calc.exe",
                "javascript:alert(1)",
                "https://example.test/update\nignored",
            ] {
                assert!(validate_external_url(url).is_err(), "{url:?}");
            }
        }

        #[test]
        fn shortcut_names_reject_traversal_and_script_metacharacters() {
            for name in [
                "../outside",
                r"..\outside",
                "name.lnk/child",
                "name\"; Start-Process calc; #",
                "line\nbreak",
            ] {
                assert!(validate_shortcut_name(name).is_err(), "{name:?}");
            }
            assert_eq!(
                validate_shortcut_name("Production - West")
                    .expect("ordinary display name should be accepted"),
                "Production - West"
            );
        }

        #[test]
        fn shortcut_identifiers_are_data_only_tokens() {
            assert_eq!(
                validate_shortcut_id(
                    "Connection ID",
                    Some("018f2f1a-75cb-7f74-b43f.example:1".to_string())
                )
                .expect("generated identifier should be accepted")
                .as_deref(),
                Some("018f2f1a-75cb-7f74-b43f.example:1")
            );
            for value in [
                "id value",
                "id;calc",
                "id\";Write-Host injected",
                "id\nnext",
            ] {
                assert!(
                    validate_shortcut_id("Connection ID", Some(value.to_string())).is_err(),
                    "{value:?}"
                );
            }
        }
    }
}
