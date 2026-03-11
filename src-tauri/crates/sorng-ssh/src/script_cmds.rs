use super::script::*;

#[tauri::command]
pub async fn execute_user_script(
    state: tauri::State<'_, ScriptServiceState>,
    code: String,
    script_type: String,
    context: ScriptContext,
) -> Result<ScriptResult, String> {
    let mut service = state.lock().await;
    service.execute_script(code, script_type, context).await
}
