// Tauri command handlers for the RDP file parser/generator.
//
// Each command follows the `rdpfile_*` naming convention and delegates
// to [`RdpFileService`].

use serde::{Deserialize, Serialize};
use tauri::State;

use super::service::RdpFileServiceState;
use super::types::*;

/// Helper to map RdpFileError → String for Tauri command results.
fn err_str(e: super::error::RdpFileError) -> String {
    e.to_string()
}

// ─── Batch import result ────────────────────────────────────────────

/// Result structure for a single file in a batch import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchImportEntry {
    pub filename: String,
    pub success: bool,
    pub result: Option<RdpParseResult>,
    pub error: Option<String>,
}

/// Result structure for a single file in a batch export.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchExportEntry {
    pub filename: String,
    pub content: String,
}

// ─── Commands ───────────────────────────────────────────────────────

/// Parse .rdp file content and return the structured result.
#[tauri::command]
pub async fn rdpfile_parse(
    state: State<'_, RdpFileServiceState>,
    content: String,
) -> Result<RdpParseResult, String> {
    let svc = state.lock().await;
    svc.parse(&content).map_err(err_str)
}

/// Generate .rdp file content from an RdpFile struct.
#[tauri::command]
pub async fn rdpfile_generate(
    state: State<'_, RdpFileServiceState>,
    rdp_file: RdpFile,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.generate(&rdp_file))
}

/// Import: parse .rdp content and convert to a ConnectionImport for the app.
#[tauri::command]
pub async fn rdpfile_import(
    state: State<'_, RdpFileServiceState>,
    content: String,
) -> Result<ConnectionImport, String> {
    let svc = state.lock().await;
    svc.import(&content).map_err(err_str)
}

/// Export: convert a connection JSON object to .rdp file content.
#[tauri::command]
pub async fn rdpfile_export(
    state: State<'_, RdpFileServiceState>,
    connection: serde_json::Value,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export(&connection).map_err(err_str)
}

/// Batch export multiple connections to RDP files.
#[tauri::command]
pub async fn rdpfile_batch_export(
    state: State<'_, RdpFileServiceState>,
    connections: Vec<serde_json::Value>,
) -> Result<Vec<BatchExportEntry>, String> {
    let svc = state.lock().await;
    let results = svc.batch_export(&connections);
    Ok(results
        .into_iter()
        .map(|(filename, content)| BatchExportEntry { filename, content })
        .collect())
}

/// Batch import multiple RDP files.
#[tauri::command]
pub async fn rdpfile_batch_import(
    state: State<'_, RdpFileServiceState>,
    files: Vec<(String, String)>,
) -> Result<Vec<BatchImportEntry>, String> {
    let svc = state.lock().await;
    let results = svc.batch_import(&files);
    Ok(results
        .into_iter()
        .map(|(filename, result)| match result {
            Ok(parse_result) => BatchImportEntry {
                filename,
                success: true,
                result: Some(parse_result),
                error: None,
            },
            Err(e) => BatchImportEntry {
                filename,
                success: false,
                result: None,
                error: Some(e.to_string()),
            },
        })
        .collect())
}

/// Validate .rdp file content and return a list of issues/warnings.
#[tauri::command]
pub async fn rdpfile_validate(
    state: State<'_, RdpFileServiceState>,
    content: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.validate(&content).map_err(err_str)
}
