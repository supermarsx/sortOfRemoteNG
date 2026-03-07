use tauri::command;
use std::sync::{Arc, Mutex};
use crate::service::AboutService;
use crate::types::*;

type State<'a> = tauri::State<'a, Arc<Mutex<AboutService>>>;

#[command]
pub async fn about_get_info(state: State<'_>) -> Result<AboutResponse, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_about())
}

#[command]
pub async fn about_get_app_info(state: State<'_>) -> Result<AppInfo, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_app_info())
}

#[command]
pub async fn about_get_license_summary(state: State<'_>) -> Result<LicenseSummary, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_license_summary())
}

#[command]
pub async fn about_get_all_license_texts(state: State<'_>) -> Result<Vec<LicenseEntry>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_all_license_texts())
}

#[command]
pub async fn about_get_license_text(state: State<'_>, identifier: String) -> Result<Option<LicenseEntry>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_license_text(&identifier))
}

#[command]
pub async fn about_get_rust_deps(state: State<'_>) -> Result<Vec<DependencyInfo>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_rust_dependencies())
}

#[command]
pub async fn about_get_rust_deps_by_category(state: State<'_>) -> Result<Vec<DependencyCategory>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_rust_deps_by_category())
}

#[command]
pub async fn about_get_js_deps(state: State<'_>) -> Result<Vec<DependencyInfo>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_js_dependencies())
}

#[command]
pub async fn about_get_js_deps_by_category(state: State<'_>) -> Result<Vec<DependencyCategory>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_js_deps_by_category())
}

#[command]
pub async fn about_get_workspace_crates(state: State<'_>) -> Result<Vec<WorkspaceCrateInfo>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_workspace_crates())
}

#[command]
pub async fn about_get_workspace_crates_by_category(state: State<'_>) -> Result<Vec<DependencyCategory>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_workspace_crates_by_category())
}

#[command]
pub async fn about_get_credits(state: State<'_>) -> Result<CreditsResponse, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_credits())
}

#[command]
pub async fn about_search_deps(state: State<'_>, query: String) -> Result<Vec<DependencyInfo>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.search_dependencies(&query))
}

#[command]
pub async fn about_get_deps_by_license(state: State<'_>, license: String) -> Result<Vec<DependencyInfo>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_deps_by_license(&license))
}
