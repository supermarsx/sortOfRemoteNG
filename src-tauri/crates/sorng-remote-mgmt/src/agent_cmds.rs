use super::agent::*;

#[tauri::command]
pub async fn connect_agent(
    state: tauri::State<'_, AgentServiceState>,
    config: AgentConnectionConfig,
) -> Result<String, String> {
    let mut agent = state.lock().await;
    agent.connect_agent(config).await
}

#[tauri::command]
pub async fn disconnect_agent(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut agent = state.lock().await;
    agent.disconnect_agent(&session_id).await
}

#[tauri::command]
pub async fn get_agent_metrics(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
) -> Result<AgentMetrics, String> {
    let agent = state.lock().await;
    agent.get_agent_metrics(&session_id).await
}

#[tauri::command]
pub async fn get_agent_logs(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
    limit: Option<usize>,
) -> Result<Vec<AgentLogEntry>, String> {
    let agent = state.lock().await;
    agent.get_agent_logs(&session_id, limit).await
}

#[tauri::command]
pub async fn execute_agent_command(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
    command: AgentCommand,
) -> Result<String, String> {
    let agent = state.lock().await;
    agent.execute_agent_command(&session_id, command).await
}

#[tauri::command]
pub async fn get_agent_command_result(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
    command_id: String,
) -> Result<AgentCommandResult, String> {
    let agent = state.lock().await;
    agent
        .get_agent_command_result(&session_id, &command_id)
        .await
}

#[tauri::command]
pub async fn get_agent_session(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
) -> Result<AgentSession, String> {
    let agent = state.lock().await;
    agent
        .get_agent_session(&session_id)
        .await
        .ok_or_else(|| format!("Agent session {} not found", session_id))
}

#[tauri::command]
pub async fn list_agent_sessions(
    state: tauri::State<'_, AgentServiceState>,
) -> Result<Vec<AgentSession>, String> {
    let agent = state.lock().await;
    Ok(agent.list_agent_sessions().await)
}

#[tauri::command]
pub async fn update_agent_status(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
    status: AgentStatus,
) -> Result<(), String> {
    let mut agent = state.lock().await;
    agent.update_agent_status(&session_id, status).await
}

#[tauri::command]
pub async fn get_agent_info(
    state: tauri::State<'_, AgentServiceState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let agent = state.lock().await;
    agent.get_agent_info(&session_id).await
}

