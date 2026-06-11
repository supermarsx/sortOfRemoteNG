use sorng_app_shell::commands::LaunchArgs;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub fn greet(name: &str) -> String {
    sorng_app_shell::commands::greet(name)
}

#[tauri::command]
pub fn open_devtools(app: tauri::AppHandle) {
    sorng_app_shell::commands::open_devtools(app);
}

#[tauri::command]
pub fn open_url_external(url: String) -> Result<(), String> {
    sorng_app_shell::commands::open_url_external(url)
}

#[tauri::command]
pub fn get_launch_args(state: tauri::State<'_, LaunchArgs>) -> LaunchArgs {
    sorng_app_shell::commands::get_launch_args(state)
}

#[derive(serde::Serialize)]
pub struct SystemMemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
}

#[tauri::command]
pub fn get_system_memory_info() -> Result<SystemMemoryInfo, String> {
    platform_memory_info()
}

#[tauri::command]
pub fn close_all_windows<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label != "main" {
            window
                .close()
                .map_err(|e| format!("Failed to close window {label}: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn restart_app<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    app.restart();
}

#[tauri::command]
pub fn clear_app_data<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    remove_resolved_dir("app data", app.path().app_data_dir())?;
    remove_resolved_dir("app cache", app.path().app_cache_dir())?;
    Ok(())
}

#[tauri::command]
pub fn factory_reset<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    clear_app_data(app.clone())?;
    remove_resolved_dir("app config", app.path().app_config_dir())?;
    remove_resolved_dir("app local data", app.path().app_local_data_dir())?;
    Ok(())
}

fn remove_resolved_dir<E: std::fmt::Display>(
    label: &str,
    path: Result<PathBuf, E>,
) -> Result<(), String> {
    let path = path.map_err(|e| format!("Failed to resolve {label} directory: {e}"))?;
    if path.exists() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Failed to remove {label} directory {}: {e}", path.display()))?;
    }
    Ok(())
}

#[cfg(windows)]
fn platform_memory_info() -> Result<SystemMemoryInfo, String> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        dwMemoryLoad: 0,
        ullTotalPhys: 0,
        ullAvailPhys: 0,
        ullTotalPageFile: 0,
        ullAvailPageFile: 0,
        ullTotalVirtual: 0,
        ullAvailVirtual: 0,
        ullAvailExtendedVirtual: 0,
    };
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    if ok == 0 {
        return Err("GlobalMemoryStatusEx failed".to_string());
    }
    Ok(SystemMemoryInfo {
        total_bytes: status.ullTotalPhys,
        used_bytes: status.ullTotalPhys.saturating_sub(status.ullAvailPhys),
        available_bytes: status.ullAvailPhys,
    })
}

#[cfg(target_os = "linux")]
fn platform_memory_info() -> Result<SystemMemoryInfo, String> {
    let contents = std::fs::read_to_string("/proc/meminfo")
        .map_err(|e| format!("Failed to read /proc/meminfo: {e}"))?;
    let mut total_kb = None;
    let mut available_kb = None;
    for line in contents.lines() {
        if let Some(value) = line.strip_prefix("MemTotal:") {
            total_kb = value
                .split_whitespace()
                .next()
                .and_then(|v| v.parse::<u64>().ok());
        } else if let Some(value) = line.strip_prefix("MemAvailable:") {
            available_kb = value
                .split_whitespace()
                .next()
                .and_then(|v| v.parse::<u64>().ok());
        }
    }
    let total_bytes = total_kb
        .ok_or_else(|| "MemTotal missing from /proc/meminfo".to_string())?
        .saturating_mul(1024);
    let available_bytes = available_kb
        .ok_or_else(|| "MemAvailable missing from /proc/meminfo".to_string())?
        .saturating_mul(1024);
    Ok(SystemMemoryInfo {
        total_bytes,
        used_bytes: total_bytes.saturating_sub(available_bytes),
        available_bytes,
    })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn platform_memory_info() -> Result<SystemMemoryInfo, String> {
    Err("system memory info is not supported on this platform".to_string())
}

#[tauri::command]
pub async fn create_desktop_shortcut(
    name: String,
    collection_id: Option<String>,
    connection_id: Option<String>,
    description: Option<String>,
    folder_path: Option<String>,
) -> Result<String, String> {
    sorng_app_shell::commands::create_desktop_shortcut(
        name,
        collection_id,
        connection_id,
        description,
        folder_path,
    )
    .await
}

#[tauri::command]
pub async fn set_autostart<R: tauri::Runtime>(
    enabled: bool,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
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
    sorng_app_shell::commands::get_desktop_path()
}

#[tauri::command]
pub fn get_documents_path() -> Result<String, String> {
    sorng_app_shell::commands::get_documents_path()
}

#[tauri::command]
pub fn get_appdata_path() -> Result<String, String> {
    sorng_app_shell::commands::get_appdata_path()
}

#[tauri::command]
pub fn check_file_exists(path: String) -> Result<bool, String> {
    sorng_app_shell::commands::check_file_exists(path)
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    sorng_app_shell::commands::delete_file(path)
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    sorng_app_shell::commands::open_folder(path)
}

#[tauri::command]
pub fn flash_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .request_user_attention(Some(tauri::UserAttentionType::Informational))
            .map_err(|e| format!("Failed to flash window: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn scan_shortcuts(
    folders: Vec<String>,
) -> Result<Vec<sorng_app_shell::commands::ScannedShortcut>, String> {
    sorng_app_shell::commands::scan_shortcuts(folders).await
}
