// ── sorng-budibase/src/commands.rs ─────────────────────────────────────────────
// Tauri commands – thin wrappers around `BudibaseService`.

use super::service::BudibaseServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_connect(
    state: State<'_, BudibaseServiceState>,
    id: String,
    config: BudibaseConnectionConfig,
) -> CmdResult<BudibaseConnectionStatus> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_disconnect(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn budibase_list_connections(
    state: State<'_, BudibaseServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn budibase_ping(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<BudibaseConnectionStatus> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn budibase_set_app_context(
    state: State<'_, BudibaseServiceState>,
    id: String,
    app_id: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_app_context(&id, app_id)
        .map_err(map_err)
}

// ── Apps ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_apps(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<Vec<BudibaseApp>> {
    state.lock().await.list_apps(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn budibase_search_apps(
    state: State<'_, BudibaseServiceState>,
    id: String,
    name: Option<String>,
) -> CmdResult<Vec<BudibaseApp>> {
    state
        .lock()
        .await
        .search_apps(&id, name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_app(
    state: State<'_, BudibaseServiceState>,
    id: String,
    app_id: String,
) -> CmdResult<BudibaseApp> {
    state
        .lock()
        .await
        .get_app(&id, &app_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_app(
    state: State<'_, BudibaseServiceState>,
    id: String,
    request: CreateAppRequest,
) -> CmdResult<BudibaseApp> {
    state
        .lock()
        .await
        .create_app(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_app(
    state: State<'_, BudibaseServiceState>,
    id: String,
    app_id: String,
    request: UpdateAppRequest,
) -> CmdResult<BudibaseApp> {
    state
        .lock()
        .await
        .update_app(&id, &app_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_app(
    state: State<'_, BudibaseServiceState>,
    id: String,
    app_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_app(&id, &app_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_publish_app(
    state: State<'_, BudibaseServiceState>,
    id: String,
    app_id: String,
) -> CmdResult<AppPublishResponse> {
    state
        .lock()
        .await
        .publish_app(&id, &app_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_unpublish_app(
    state: State<'_, BudibaseServiceState>,
    id: String,
    app_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .unpublish_app(&id, &app_id)
        .await
        .map_err(map_err)
}

// ── Tables ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_tables(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<Vec<BudibaseTable>> {
    state.lock().await.list_tables(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_table(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
) -> CmdResult<BudibaseTable> {
    state
        .lock()
        .await
        .get_table(&id, &table_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_table(
    state: State<'_, BudibaseServiceState>,
    id: String,
    request: CreateTableRequest,
) -> CmdResult<BudibaseTable> {
    state
        .lock()
        .await
        .create_table(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_table(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    request: UpdateTableRequest,
) -> CmdResult<BudibaseTable> {
    state
        .lock()
        .await
        .update_table(&id, &table_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_table(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    rev: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_table(&id, &table_id, rev)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_table_schema(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
) -> CmdResult<std::collections::HashMap<String, TableFieldSchema>> {
    state
        .lock()
        .await
        .get_table_schema(&id, &table_id)
        .await
        .map_err(map_err)
}

// ── Rows ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_rows(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
) -> CmdResult<Vec<BudibaseRow>> {
    state
        .lock()
        .await
        .list_rows(&id, &table_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_search_rows(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    request: RowSearchRequest,
) -> CmdResult<RowSearchResponse> {
    state
        .lock()
        .await
        .search_rows(&id, &table_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_row(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    row_id: String,
) -> CmdResult<BudibaseRow> {
    state
        .lock()
        .await
        .get_row(&id, &table_id, &row_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_row(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    row: BudibaseRow,
) -> CmdResult<BudibaseRow> {
    state
        .lock()
        .await
        .create_row(&id, &table_id, row)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_row(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    row_id: String,
    row: BudibaseRow,
) -> CmdResult<BudibaseRow> {
    state
        .lock()
        .await
        .update_row(&id, &table_id, &row_id, row)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_row(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    row_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_row(&id, &table_id, &row_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_bulk_create_rows(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    rows: Vec<BudibaseRow>,
) -> CmdResult<BulkRowResponse> {
    state
        .lock()
        .await
        .bulk_create_rows(&id, &table_id, rows)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_bulk_delete_rows(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
    request: BulkRowDeleteRequest,
) -> CmdResult<BulkRowResponse> {
    state
        .lock()
        .await
        .bulk_delete_rows(&id, &table_id, request)
        .await
        .map_err(map_err)
}

// ── Views ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_views(
    state: State<'_, BudibaseServiceState>,
    id: String,
    table_id: String,
) -> CmdResult<Vec<BudibaseView>> {
    state
        .lock()
        .await
        .list_views(&id, &table_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_view(
    state: State<'_, BudibaseServiceState>,
    id: String,
    view_id: String,
) -> CmdResult<BudibaseView> {
    state
        .lock()
        .await
        .get_view(&id, &view_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_view(
    state: State<'_, BudibaseServiceState>,
    id: String,
    request: CreateViewRequest,
) -> CmdResult<BudibaseView> {
    state
        .lock()
        .await
        .create_view(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_view(
    state: State<'_, BudibaseServiceState>,
    id: String,
    view_id: String,
    request: CreateViewRequest,
) -> CmdResult<BudibaseView> {
    state
        .lock()
        .await
        .update_view(&id, &view_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_view(
    state: State<'_, BudibaseServiceState>,
    id: String,
    view_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_view(&id, &view_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_query_view(
    state: State<'_, BudibaseServiceState>,
    id: String,
    view_id: String,
) -> CmdResult<ViewQueryResponse> {
    state
        .lock()
        .await
        .query_view(&id, &view_id)
        .await
        .map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_users(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<Vec<BudibaseUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn budibase_search_users(
    state: State<'_, BudibaseServiceState>,
    id: String,
    email: Option<String>,
    bookmark: Option<String>,
) -> CmdResult<UserSearchResponse> {
    state
        .lock()
        .await
        .search_users(&id, email, bookmark)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_user(
    state: State<'_, BudibaseServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<BudibaseUser> {
    state
        .lock()
        .await
        .get_user(&id, &user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_user(
    state: State<'_, BudibaseServiceState>,
    id: String,
    request: CreateUserRequest,
) -> CmdResult<BudibaseUser> {
    state
        .lock()
        .await
        .create_user(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_user(
    state: State<'_, BudibaseServiceState>,
    id: String,
    user_id: String,
    request: UpdateUserRequest,
) -> CmdResult<BudibaseUser> {
    state
        .lock()
        .await
        .update_user(&id, &user_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_user(
    state: State<'_, BudibaseServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_user(&id, &user_id)
        .await
        .map_err(map_err)
}

// ── Queries ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_queries(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<Vec<BudibaseQuery>> {
    state.lock().await.list_queries(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_query(
    state: State<'_, BudibaseServiceState>,
    id: String,
    query_id: String,
) -> CmdResult<BudibaseQuery> {
    state
        .lock()
        .await
        .get_query(&id, &query_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_execute_query(
    state: State<'_, BudibaseServiceState>,
    id: String,
    query_id: String,
    request: ExecuteQueryRequest,
) -> CmdResult<QueryExecutionResponse> {
    state
        .lock()
        .await
        .execute_query(&id, &query_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_query(
    state: State<'_, BudibaseServiceState>,
    id: String,
    query: BudibaseQuery,
) -> CmdResult<BudibaseQuery> {
    state
        .lock()
        .await
        .create_query(&id, query)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_query(
    state: State<'_, BudibaseServiceState>,
    id: String,
    query_id: String,
    query: BudibaseQuery,
) -> CmdResult<BudibaseQuery> {
    state
        .lock()
        .await
        .update_query(&id, &query_id, query)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_query(
    state: State<'_, BudibaseServiceState>,
    id: String,
    query_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_query(&id, &query_id)
        .await
        .map_err(map_err)
}

// ── Automations ───────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_automations(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<Vec<BudibaseAutomation>> {
    state
        .lock()
        .await
        .list_automations(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_automation(
    state: State<'_, BudibaseServiceState>,
    id: String,
    automation_id: String,
) -> CmdResult<BudibaseAutomation> {
    state
        .lock()
        .await
        .get_automation(&id, &automation_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_automation(
    state: State<'_, BudibaseServiceState>,
    id: String,
    request: CreateAutomationRequest,
) -> CmdResult<BudibaseAutomation> {
    state
        .lock()
        .await
        .create_automation(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_automation(
    state: State<'_, BudibaseServiceState>,
    id: String,
    automation_id: String,
    request: BudibaseAutomation,
) -> CmdResult<BudibaseAutomation> {
    state
        .lock()
        .await
        .update_automation(&id, &automation_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_automation(
    state: State<'_, BudibaseServiceState>,
    id: String,
    automation_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_automation(&id, &automation_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_trigger_automation(
    state: State<'_, BudibaseServiceState>,
    id: String,
    automation_id: String,
    request: TriggerAutomationRequest,
) -> CmdResult<TriggerAutomationResponse> {
    state
        .lock()
        .await
        .trigger_automation(&id, &automation_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_automation_logs(
    state: State<'_, BudibaseServiceState>,
    id: String,
    request: AutomationLogSearchRequest,
) -> CmdResult<AutomationLogSearchResponse> {
    state
        .lock()
        .await
        .get_automation_logs(&id, request)
        .await
        .map_err(map_err)
}

// ── Datasources ───────────────────────────────────────────────────

#[tauri::command]
pub async fn budibase_list_datasources(
    state: State<'_, BudibaseServiceState>,
    id: String,
) -> CmdResult<Vec<BudibaseDatasource>> {
    state
        .lock()
        .await
        .list_datasources(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_get_datasource(
    state: State<'_, BudibaseServiceState>,
    id: String,
    datasource_id: String,
) -> CmdResult<BudibaseDatasource> {
    state
        .lock()
        .await
        .get_datasource(&id, &datasource_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_create_datasource(
    state: State<'_, BudibaseServiceState>,
    id: String,
    request: CreateDatasourceRequest,
) -> CmdResult<BudibaseDatasource> {
    state
        .lock()
        .await
        .create_datasource(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_update_datasource(
    state: State<'_, BudibaseServiceState>,
    id: String,
    datasource_id: String,
    request: UpdateDatasourceRequest,
) -> CmdResult<BudibaseDatasource> {
    state
        .lock()
        .await
        .update_datasource(&id, &datasource_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_delete_datasource(
    state: State<'_, BudibaseServiceState>,
    id: String,
    datasource_id: String,
    rev: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_datasource(&id, &datasource_id, rev)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn budibase_test_datasource(
    state: State<'_, BudibaseServiceState>,
    id: String,
    datasource_id: String,
) -> CmdResult<DatasourceTestResponse> {
    state
        .lock()
        .await
        .test_datasource(&id, &datasource_id)
        .await
        .map_err(map_err)
}
