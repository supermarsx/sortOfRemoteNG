use crate::types::*;
use crate::error::AiAssistError;
use crate::service::AiAssistServiceState;

use std::collections::HashMap;
use tauri::State;

// ─── Session commands ────────────────────────────────────────────

#[tauri::command]
pub async fn ai_assist_create_session(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    host: String,
    username: String,
) -> Result<SessionContext, AiAssistError> {
    let mut service = state.write().await;
    Ok(service.create_session(&session_id, &host, &username))
}

#[tauri::command]
pub async fn ai_assist_remove_session(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
) -> Result<(), AiAssistError> {
    let mut service = state.write().await;
    service.remove_session(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn ai_assist_list_sessions(
    state: State<'_, AiAssistServiceState>,
) -> Result<Vec<String>, AiAssistError> {
    let service = state.read().await;
    Ok(service.list_sessions())
}

#[tauri::command]
pub async fn ai_assist_update_context(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    cwd: Option<String>,
    shell: Option<String>,
    uname: Option<String>,
    env_vars: Option<Vec<(String, String)>>,
) -> Result<(), AiAssistError> {
    let mut service = state.write().await;
    service.update_session_context(&session_id, cwd, shell, uname, env_vars)
}

#[tauri::command]
pub async fn ai_assist_record_command(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    command: String,
    exit_code: Option<i32>,
    output: Option<String>,
    duration_ms: Option<u64>,
) -> Result<(), AiAssistError> {
    let mut service = state.write().await;
    service.record_command(&session_id, &command, exit_code, output, duration_ms)
}

#[tauri::command]
pub async fn ai_assist_set_tools(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    tools: Vec<String>,
) -> Result<(), AiAssistError> {
    let mut service = state.write().await;
    service.set_installed_tools(&session_id, tools)
}

// ─── Completion commands ─────────────────────────────────────────

#[tauri::command]
pub async fn ai_assist_complete(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    input: String,
    cursor_position: usize,
) -> Result<CompletionResponse, AiAssistError> {
    let service = state.read().await;
    service.complete(&session_id, &input, cursor_position).await
}

// ─── Error explanation commands ──────────────────────────────────

#[tauri::command]
pub async fn ai_assist_explain_error(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    error_output: String,
    command: Option<String>,
) -> Result<ErrorExplanation, AiAssistError> {
    let service = state.read().await;
    service.explain_error(&session_id, &error_output, command.as_deref()).await
}

// ─── Man page commands ───────────────────────────────────────────

#[tauri::command]
pub async fn ai_assist_lookup_command(
    state: State<'_, AiAssistServiceState>,
    command: String,
) -> Result<ManPageInfo, AiAssistError> {
    let mut service = state.write().await;
    service.lookup_command(&command).await
}

#[tauri::command]
pub async fn ai_assist_search_commands(
    state: State<'_, AiAssistServiceState>,
    query: String,
) -> Result<Vec<ManPageInfo>, AiAssistError> {
    let service = state.read().await;
    Ok(service.search_commands(&query))
}

// ─── Natural language commands ───────────────────────────────────

#[tauri::command]
pub async fn ai_assist_translate(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    query: String,
    constraints: Option<Vec<String>>,
) -> Result<NaturalLanguageResult, AiAssistError> {
    let service = state.read().await;
    service.translate_natural_language(
        &session_id,
        &query,
        constraints.unwrap_or_default(),
    ).await
}

// ─── Risk assessment commands ────────────────────────────────────

#[tauri::command]
pub async fn ai_assist_assess_risk(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
    command: String,
) -> Result<RiskAssessment, AiAssistError> {
    let service = state.read().await;
    service.assess_risk(&session_id, &command).await
}

#[tauri::command]
pub async fn ai_assist_quick_risk(
    state: State<'_, AiAssistServiceState>,
    command: String,
) -> Result<RiskAssessment, AiAssistError> {
    let service = state.read().await;
    Ok(service.quick_risk_assessment(&command))
}

// ─── Snippet commands ────────────────────────────────────────────

#[tauri::command]
pub async fn ai_assist_list_snippets(
    state: State<'_, AiAssistServiceState>,
) -> Result<Vec<CommandSnippet>, AiAssistError> {
    let service = state.read().await;
    Ok(service.list_snippets().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_assist_search_snippets(
    state: State<'_, AiAssistServiceState>,
    query: String,
) -> Result<Vec<CommandSnippet>, AiAssistError> {
    let service = state.read().await;
    Ok(service.search_snippets(&query).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_assist_get_snippet(
    state: State<'_, AiAssistServiceState>,
    id: String,
) -> Result<CommandSnippet, AiAssistError> {
    let service = state.read().await;
    service.get_snippet(&id)
        .cloned()
        .ok_or_else(|| AiAssistError::not_found(&format!("snippet '{}'", id)))
}

#[tauri::command]
pub async fn ai_assist_render_snippet(
    state: State<'_, AiAssistServiceState>,
    id: String,
    params: HashMap<String, String>,
) -> Result<String, AiAssistError> {
    let service = state.read().await;
    service.render_snippet(&id, &params)
}

#[tauri::command]
pub async fn ai_assist_add_snippet(
    state: State<'_, AiAssistServiceState>,
    snippet: CommandSnippet,
) -> Result<(), AiAssistError> {
    let mut service = state.write().await;
    service.add_snippet(snippet);
    Ok(())
}

#[tauri::command]
pub async fn ai_assist_remove_snippet(
    state: State<'_, AiAssistServiceState>,
    id: String,
) -> Result<(), AiAssistError> {
    let mut service = state.write().await;
    service.remove_snippet(&id)
        .ok_or_else(|| AiAssistError::not_found(&format!("snippet '{}'", id)))?;
    Ok(())
}

// ─── History analysis commands ───────────────────────────────────

#[tauri::command]
pub async fn ai_assist_analyze_history(
    state: State<'_, AiAssistServiceState>,
    session_id: String,
) -> Result<HistoryAnalysis, AiAssistError> {
    let service = state.read().await;
    service.analyze_history(&session_id)
}

// ─── Config commands ─────────────────────────────────────────────

#[tauri::command]
pub async fn ai_assist_get_config(
    state: State<'_, AiAssistServiceState>,
) -> Result<AiAssistConfig, AiAssistError> {
    let service = state.read().await;
    Ok(service.get_config().clone())
}

#[tauri::command]
pub async fn ai_assist_update_config(
    state: State<'_, AiAssistServiceState>,
    config: AiAssistConfig,
) -> Result<(), AiAssistError> {
    let mut service = state.write().await;
    service.update_config(config);
    Ok(())
}
