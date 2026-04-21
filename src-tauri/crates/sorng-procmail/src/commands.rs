// ── sorng-procmail/src/commands.rs ────────────────────────────────────────────
// Tauri commands – thin wrappers around `ProcmailService`.

use super::service::ProcmailServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn procmail_connect(
    state: State<'_, ProcmailServiceState>,
    id: String,
    config: ProcmailConnectionConfig,
) -> CmdResult<ProcmailConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_disconnect(
    state: State<'_, ProcmailServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn procmail_list_connections(
    state: State<'_, ProcmailServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Recipes ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn procmail_list_recipes(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<ProcmailRecipe>> {
    state
        .lock()
        .await
        .list_recipes(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_get_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    recipe_id: String,
) -> CmdResult<ProcmailRecipe> {
    state
        .lock()
        .await
        .get_recipe(&id, &user, &recipe_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_create_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    request: CreateRecipeRequest,
) -> CmdResult<ProcmailRecipe> {
    state
        .lock()
        .await
        .create_recipe(&id, &user, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_update_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    recipe_id: String,
    request: UpdateRecipeRequest,
) -> CmdResult<ProcmailRecipe> {
    state
        .lock()
        .await
        .update_recipe(&id, &user, &recipe_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_delete_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    recipe_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_recipe(&id, &user, &recipe_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_enable_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    recipe_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_recipe(&id, &user, &recipe_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_disable_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    recipe_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_recipe(&id, &user, &recipe_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_reorder_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    recipe_id: String,
    new_position: usize,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .reorder_recipe(&id, &user, &recipe_id, new_position)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_test_recipe(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    message_content: String,
) -> CmdResult<RecipeTestResult> {
    state
        .lock()
        .await
        .test_recipe(&id, &user, &message_content)
        .await
        .map_err(map_err)
}

// ── Rules ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn procmail_list_rules(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<ProcmailRule>> {
    state
        .lock()
        .await
        .list_rules(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_get_rule(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    rule_id: String,
) -> CmdResult<ProcmailRule> {
    state
        .lock()
        .await
        .get_rule(&id, &user, &rule_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_create_rule(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    request: CreateRuleRequest,
) -> CmdResult<ProcmailRule> {
    state
        .lock()
        .await
        .create_rule(&id, &user, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_update_rule(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    rule_id: String,
    request: UpdateRuleRequest,
) -> CmdResult<ProcmailRule> {
    state
        .lock()
        .await
        .update_rule(&id, &user, &rule_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_delete_rule(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    rule_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_rule(&id, &user, &rule_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_enable_rule(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    rule_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_rule(&id, &user, &rule_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_disable_rule(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    rule_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_rule(&id, &user, &rule_id)
        .await
        .map_err(map_err)
}

// ── Variables ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn procmail_list_variables(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<ProcmailVariable>> {
    state
        .lock()
        .await
        .list_variables(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_get_variable(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<ProcmailVariable> {
    state
        .lock()
        .await
        .get_variable(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_set_variable(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    name: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_variable(&id, &user, &name, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_delete_variable(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_variable(&id, &user, &name)
        .await
        .map_err(map_err)
}

// ── Includes ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn procmail_list_includes(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<ProcmailInclude>> {
    state
        .lock()
        .await
        .list_includes(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_add_include(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_include(&id, &user, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_remove_include(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_include(&id, &user, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_enable_include(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_include(&id, &user, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_disable_include(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_include(&id, &user, &path)
        .await
        .map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn procmail_get_config(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<ProcmailConfig> {
    state
        .lock()
        .await
        .get_config(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_set_config(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    config: ProcmailConfig,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_config(&id, &user, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_backup_config(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .backup_config(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_restore_config(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    backup_content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .restore_config(&id, &user, &backup_content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_validate_config(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    content: String,
) -> CmdResult<RecipeTestResult> {
    state
        .lock()
        .await
        .validate_config(&id, &user, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_get_raw_config(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_raw_config(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_set_raw_config(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_raw_config(&id, &user, &content)
        .await
        .map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn procmail_query_log(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    lines: Option<usize>,
    filter: Option<String>,
) -> CmdResult<Vec<ProcmailLogEntry>> {
    state
        .lock()
        .await
        .query_log(&id, &user, lines, filter)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_list_log_files(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_log_files(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_clear_log(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .clear_log(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_get_log_path(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_log_path(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn procmail_set_log_path(
    state: State<'_, ProcmailServiceState>,
    id: String,
    user: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_log_path(&id, &user, &path)
        .await
        .map_err(map_err)
}
