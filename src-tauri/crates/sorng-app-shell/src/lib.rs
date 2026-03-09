pub mod commands {
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

    pub fn parse_launch_args(args: impl IntoIterator<Item = String>) -> LaunchArgs {
        let args: Vec<String> = args.into_iter().collect();
        let mut collection_id = None;
        let mut connection_id = None;

        let mut i = 1;
        while i < args.len() {
            match args[i].as_str() {
                "--collection" | "-c" => {
                    if i + 1 < args.len() {
                        collection_id = Some(args[i + 1].clone());
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--connection" | "-n" => {
                    if i + 1 < args.len() {
                        connection_id = Some(args[i + 1].clone());
                        i += 2;
                    } else {
                        i += 1;
                    }
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

    #[tauri::command]
    pub fn greet(name: &str) -> String {
        format!("Hello, {}! You've been greeted from Rust!", name)
    }

    #[tauri::command]
    pub fn open_url_external(url: String) -> Result<(), String> {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("Only http and https URLs are supported".into());
        }

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &url])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&url)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    #[tauri::command]
    pub fn open_devtools(app: tauri::AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
        }
    }

    #[tauri::command]
    pub fn get_launch_args(state: tauri::State<'_, LaunchArgs>) -> LaunchArgs {
        state.inner().clone()
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
            .map_err(|e| format!("Failed to get application path: {}", e))?;

        let mut args = Vec::new();
        if let Some(collection_id) = collection_id {
            args.push("--collection".to_string());
            args.push(collection_id);
        }
        if let Some(connection_id) = connection_id {
            args.push("--connection".to_string());
            args.push(connection_id);
        }

        let args_string = args.join(" ");

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;

            let target_dir = if let Some(ref path) = folder_path {
                std::path::PathBuf::from(path)
            } else {
                dirs::desktop_dir().ok_or("Failed to get desktop directory")?
            };

            if !target_dir.exists() {
                std::fs::create_dir_all(&target_dir)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }

            let shortcut_path = target_dir.join(format!("{}.lnk", name));
            let powershell_script = format!(
                r#"
      $WshShell = New-Object -comObject WScript.Shell
      $Shortcut = $WshShell.CreateShortcut("{}")
      $Shortcut.TargetPath = "{}"
      $Shortcut.Arguments = "{}"
      $Shortcut.WorkingDirectory = "{}"
      $Shortcut.Description = "{}"
      $Shortcut.Save()
      "#,
                shortcut_path.display(),
                app_path.display(),
                args_string,
                app_path.parent().unwrap_or(&app_path).display(),
                description.unwrap_or_else(|| format!("Launch {} with specific connection", name))
            );

            let output = Command::new("powershell")
                .arg("-Command")
                .arg(&powershell_script)
                .output()
                .map_err(|e| format!("Failed to create shortcut: {}", e))?;

            if !output.status.success() {
                return Err(format!(
                    "PowerShell command failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(shortcut_path.to_string_lossy().to_string())
        }

        #[cfg(target_os = "linux")]
        {
            use std::fs;

            let target_dir = if let Some(ref path) = folder_path {
                std::path::PathBuf::from(path)
            } else {
                dirs::desktop_dir().ok_or("Failed to get desktop directory")?
            };

            if !target_dir.exists() {
                std::fs::create_dir_all(&target_dir)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }

            let shortcut_path = target_dir.join(format!("{}.desktop", name));
            let desktop_file_content = format!(
                r#"[Desktop Entry]
Version=1.0
Type=Application
Name={}
Comment={}
Exec="{}" {}
Path={}
Terminal=false
StartupNotify=false
"#,
                name,
                description.unwrap_or_else(|| format!("Launch {} with specific connection", name)),
                app_path.display(),
                args_string,
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

            let target_dir = if let Some(ref path) = folder_path {
                std::path::PathBuf::from(path)
            } else {
                dirs::desktop_dir().ok_or("Failed to get desktop directory")?
            };

            if !target_dir.exists() {
                std::fs::create_dir_all(&target_dir)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }

            let alias_name = format!("{} alias", name);
            let alias_path = target_dir.join(&alias_name);
            let applescript = format!(
                r#"
      tell application "Finder"
        make new alias file at desktop to POSIX file "{}" with properties {{name:"{}"}}
      end tell
      "#,
                app_path.display(),
                alias_name
            );

            let output = Command::new("osascript")
                .arg("-e")
                .arg(&applescript)
                .output()
                .map_err(|e| format!("Failed to create alias: {}", e))?;

            if !output.status.success() {
                return Err(format!(
                    "AppleScript command failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(alias_path.to_string_lossy().to_string())
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        {
            let _ = (name, collection_id, connection_id, description, folder_path);
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

    #[tauri::command]
    pub fn check_file_exists(path: String) -> Result<bool, String> {
        Ok(std::path::Path::new(&path).exists())
    }

    #[tauri::command]
    pub fn delete_file(path: String) -> Result<(), String> {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    }

    #[tauri::command]
    pub fn open_folder(path: String) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
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

        for folder in folders {
            let folder_path = std::path::Path::new(&folder);
            if !folder_path.exists() || !folder_path.is_dir() {
                continue;
            }

            let entries = match std::fs::read_dir(folder_path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
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
                                if let Ok(content) = std::fs::read_to_string(&path) {
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

        let powershell_script = format!(
            r#"
    $WshShell = New-Object -comObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("{}")
    Write-Output $Shortcut.TargetPath
    Write-Output "---SEPARATOR---"
    Write-Output $Shortcut.Arguments
    "#,
            path.display()
        );

        match Command::new("powershell")
            .arg("-Command")
            .arg(&powershell_script)
            .output()
        {
            Ok(output) if output.status.success() => {
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
}
