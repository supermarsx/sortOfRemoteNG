use super::vercel::*;

#[tauri::command]
pub async fn connect_vercel(
    state: tauri::State<'_, VercelServiceState>,
    config: VercelConnectionConfig,
) -> Result<String, String> {
    let mut vercel = state.lock().await;
    vercel.connect_vercel(config).await
}

#[tauri::command]
pub async fn disconnect_vercel(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut vercel = state.lock().await;
    vercel.disconnect_vercel(&session_id).await
}

#[tauri::command]
pub async fn list_vercel_sessions(
    state: tauri::State<'_, VercelServiceState>,
) -> Result<Vec<VercelSession>, String> {
    let vercel = state.lock().await;
    Ok(vercel.list_vercel_sessions().await)
}

#[tauri::command]
pub async fn get_vercel_session(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<VercelSession, String> {
    let vercel = state.lock().await;
    vercel
        .get_vercel_session(&session_id)
        .await
        .ok_or_else(|| format!("Vercel session {} not found", session_id))
}

#[tauri::command]
pub async fn list_vercel_projects(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<Vec<VercelProject>, String> {
    let vercel = state.lock().await;
    vercel.list_vercel_projects(&session_id).await
}

#[tauri::command]
pub async fn list_vercel_deployments(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: Option<String>,
) -> Result<Vec<VercelDeployment>, String> {
    let vercel = state.lock().await;
    vercel
        .list_vercel_deployments(&session_id, project_id)
        .await
}

#[tauri::command]
pub async fn list_vercel_domains(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<Vec<VercelDomain>, String> {
    let vercel = state.lock().await;
    vercel.list_vercel_domains(&session_id).await
}

#[tauri::command]
pub async fn list_vercel_teams(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
) -> Result<Vec<VercelTeam>, String> {
    let vercel = state.lock().await;
    vercel.list_vercel_teams(&session_id).await
}

#[tauri::command]
pub async fn create_vercel_deployment(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: String,
    files: HashMap<String, String>,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel
        .create_vercel_deployment(&session_id, &project_id, files)
        .await
}

#[tauri::command]
pub async fn redeploy_vercel_project(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: String,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel
        .redeploy_vercel_project(&session_id, &project_id)
        .await
}

#[tauri::command]
pub async fn add_vercel_domain(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    domain_name: String,
    project_id: Option<String>,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel
        .add_vercel_domain(&session_id, &domain_name, project_id)
        .await
}

#[tauri::command]
pub async fn set_vercel_env_var(
    state: tauri::State<'_, VercelServiceState>,
    session_id: String,
    project_id: String,
    key: String,
    value: String,
    target: Vec<String>,
) -> Result<String, String> {
    let vercel = state.lock().await;
    vercel
        .set_vercel_env_var(&session_id, &project_id, &key, &value, target)
        .await
}

