use super::script_stub::*;

#[tauri::command]
pub async fn execute_user_script(
    _state: tauri::State<'_, ScriptServiceState>,
    _code: String,
    _script_type: String,
    _context: ScriptContext,
) -> Result<ScriptResult, String> {
    Err(DISABLED_MESSAGE.to_string())
}
