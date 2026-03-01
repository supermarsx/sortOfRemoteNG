//! Tauri command bindings for the mRemoteNG crate.
//!
//! Thin wrappers that take `State<MremotengServiceState>`, lock the mutex,
//! and delegate to the service.  Every command returns `Result<T, String>`.

use serde_json::Value;

use super::service::MremotengServiceState;
use super::types::*;

// ─── Format Detection ────────────────────────────────────────────────

#[tauri::command]
pub async fn mrng_detect_format(
    file_path: String,
    content: String,
) -> Result<String, String> {
    let format = super::service::MremotengService::detect_format(&file_path, &content);
    serde_json::to_string(&format).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_get_import_formats() -> Result<Vec<Value>, String> {
    Ok(super::service::MremotengService::supported_import_formats())
}

#[tauri::command]
pub async fn mrng_get_export_formats() -> Result<Vec<Value>, String> {
    Ok(super::service::MremotengService::supported_export_formats())
}

// ─── Import Operations ───────────────────────────────────────────────

#[tauri::command]
pub async fn mrng_import_xml(
    state: tauri::State<'_, MremotengServiceState>,
    xml_content: String,
    password: Option<String>,
    target_folder_id: Option<String>,
) -> Result<MrngImportResult, String> {
    let config = MrngImportConfig {
        password,
        target_folder_id,
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.import_xml(&xml_content, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_xml_as_connections(
    state: tauri::State<'_, MremotengServiceState>,
    xml_content: String,
    password: Option<String>,
) -> Result<Vec<Value>, String> {
    let config = MrngImportConfig {
        password,
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.import_xml_as_app_connections(&xml_content, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_csv(
    state: tauri::State<'_, MremotengServiceState>,
    csv_content: String,
    password: Option<String>,
) -> Result<MrngImportResult, String> {
    let config = MrngImportConfig {
        password,
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.import_csv(&csv_content, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_csv_as_connections(
    state: tauri::State<'_, MremotengServiceState>,
    csv_content: String,
    password: Option<String>,
) -> Result<Vec<Value>, String> {
    let config = MrngImportConfig {
        password,
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.import_csv_as_app_connections(&csv_content, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_rdp_files(
    state: tauri::State<'_, MremotengServiceState>,
    files: Vec<(String, String)>,
) -> Result<MrngImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_rdp_files(&files).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_rdp_as_connections(
    state: tauri::State<'_, MremotengServiceState>,
    files: Vec<(String, String)>,
) -> Result<Vec<Value>, String> {
    let mut svc = state.lock().await;
    svc.import_rdp_as_app_connections(&files).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_putty_reg(
    state: tauri::State<'_, MremotengServiceState>,
    reg_content: String,
) -> Result<MrngImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_putty_from_reg(&reg_content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_putty_registry(
    state: tauri::State<'_, MremotengServiceState>,
) -> Result<MrngImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_putty_from_registry().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_putty_as_connections(
    state: tauri::State<'_, MremotengServiceState>,
    reg_content: Option<String>,
) -> Result<Vec<Value>, String> {
    let mut svc = state.lock().await;
    svc.import_putty_as_app_connections(reg_content.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_auto(
    state: tauri::State<'_, MremotengServiceState>,
    file_path: String,
    content: String,
    password: Option<String>,
) -> Result<MrngImportResult, String> {
    let config = MrngImportConfig {
        password,
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.import_auto(&file_path, &content, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_import_auto_as_connections(
    state: tauri::State<'_, MremotengServiceState>,
    file_path: String,
    content: String,
    password: Option<String>,
) -> Result<Vec<Value>, String> {
    let config = MrngImportConfig {
        password,
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.import_auto_as_app_connections(&file_path, &content, &config).map_err(|e| e.to_string())
}

// ─── Export Operations ───────────────────────────────────────────────

#[tauri::command]
pub async fn mrng_export_xml(
    state: tauri::State<'_, MremotengServiceState>,
    connections: Vec<MrngConnectionInfo>,
    password: Option<String>,
    encrypt_passwords: Option<bool>,
    kdf_iterations: Option<u32>,
) -> Result<MrngExportResult, String> {
    let config = MrngExportConfig {
        password,
        encrypt_passwords: encrypt_passwords.unwrap_or(true),
        kdf_iterations: kdf_iterations.unwrap_or(1000),
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.export_xml(&connections, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_export_app_to_xml(
    state: tauri::State<'_, MremotengServiceState>,
    app_connections: Vec<Value>,
    password: Option<String>,
    encrypt_passwords: Option<bool>,
    kdf_iterations: Option<u32>,
) -> Result<MrngExportResult, String> {
    let config = MrngExportConfig {
        password,
        encrypt_passwords: encrypt_passwords.unwrap_or(true),
        kdf_iterations: kdf_iterations.unwrap_or(1000),
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.export_app_to_xml(&app_connections, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_export_csv(
    state: tauri::State<'_, MremotengServiceState>,
    connections: Vec<MrngConnectionInfo>,
    password: Option<String>,
    encrypt_passwords: Option<bool>,
    kdf_iterations: Option<u32>,
) -> Result<MrngExportResult, String> {
    let config = MrngExportConfig {
        password,
        encrypt_passwords: encrypt_passwords.unwrap_or(true),
        kdf_iterations: kdf_iterations.unwrap_or(1000),
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.export_csv(&connections, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_export_app_to_csv(
    state: tauri::State<'_, MremotengServiceState>,
    app_connections: Vec<Value>,
    password: Option<String>,
    encrypt_passwords: Option<bool>,
    kdf_iterations: Option<u32>,
) -> Result<MrngExportResult, String> {
    let config = MrngExportConfig {
        password,
        encrypt_passwords: encrypt_passwords.unwrap_or(true),
        kdf_iterations: kdf_iterations.unwrap_or(1000),
        ..Default::default()
    };
    let mut svc = state.lock().await;
    svc.export_app_to_csv(&app_connections, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_export_rdp_file(
    state: tauri::State<'_, MremotengServiceState>,
    connection: MrngConnectionInfo,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.export_rdp_file(&connection))
}

#[tauri::command]
pub async fn mrng_export_app_to_rdp(
    state: tauri::State<'_, MremotengServiceState>,
    app_connection: Value,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_app_to_rdp(&app_connection).map_err(|e| e.to_string())
}

// ─── Validation / Info ───────────────────────────────────────────────

#[tauri::command]
pub async fn mrng_validate_xml(
    state: tauri::State<'_, MremotengServiceState>,
    xml_content: String,
    password: Option<String>,
) -> Result<Value, String> {
    let svc = state.lock().await;
    let pw = password.as_deref().unwrap_or(&svc.default_password);
    svc.validate_xml(&xml_content, pw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mrng_get_last_import(
    state: tauri::State<'_, MremotengServiceState>,
) -> Result<Option<MrngImportResult>, String> {
    let svc = state.lock().await;
    Ok(svc.get_last_import().cloned())
}

#[tauri::command]
pub async fn mrng_get_last_export(
    state: tauri::State<'_, MremotengServiceState>,
) -> Result<Option<MrngExportResult>, String> {
    let svc = state.lock().await;
    Ok(svc.get_last_export().cloned())
}

// ─── Configuration ───────────────────────────────────────────────────

#[tauri::command]
pub async fn mrng_set_password(
    state: tauri::State<'_, MremotengServiceState>,
    password: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_default_password(&password);
    Ok(())
}

#[tauri::command]
pub async fn mrng_set_kdf_iterations(
    state: tauri::State<'_, MremotengServiceState>,
    iterations: u32,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_kdf_iterations(iterations);
    Ok(())
}
