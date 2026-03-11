use sorng_app_shell::commands::LaunchArgs;
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
