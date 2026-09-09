use crate::ssh_scripts::tooling::{self, Analysis, Capabilities, Formatting, Language};

#[tauri::command]
pub async fn script_tooling_capabilities() -> Result<Capabilities, String> {
    tooling::capabilities().await
}
#[tauri::command]
pub async fn script_tooling_analyze(
    language: Language,
    source: String,
) -> Result<Analysis, String> {
    tooling::analyze(language, source).await
}
#[tauri::command]
pub async fn script_tooling_format(
    language: Language,
    source: String,
) -> Result<Formatting, String> {
    tooling::format(language, source).await
}
