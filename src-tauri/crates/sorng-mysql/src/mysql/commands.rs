//! Tauri commands for the MySQL / MariaDB integration.

use crate::mysql::service::MysqlServiceState;
use crate::mysql::types::*;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_connect(
    state: tauri::State<'_, MysqlServiceState>,
    config: MysqlConnectionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_disconnect(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_disconnect_all(
    state: tauri::State<'_, MysqlServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn mysql_list_sessions(
    state: tauri::State<'_, MysqlServiceState>,
) -> Result<Vec<SessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn mysql_get_session(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session(&session_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_ping(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.ping(&session_id).map_err(|e| e.message)
}

// ── Query execution ─────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_execute_query(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.execute_query(&session_id, &sql).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_execute_statement(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.execute_statement(&session_id, &sql).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_explain_query(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    sql: String,
) -> Result<Vec<ExplainRow>, String> {
    let mut svc = state.lock().await;
    svc.explain_query(&session_id, &sql).await.map_err(|e| e.message)
}

// ── Schema ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_list_databases(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_databases(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_list_tables(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_tables(&session_id, &database).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_describe_table(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnDef>, String> {
    let mut svc = state.lock().await;
    svc.describe_table(&session_id, &database, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_list_indexes(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
) -> Result<Vec<IndexInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_indexes(&session_id, &database, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_list_foreign_keys(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_foreign_keys(&session_id, &database, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_list_views(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
) -> Result<Vec<ViewInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_views(&session_id, &database).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_list_routines(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_routines(&session_id, &database).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_list_triggers(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_triggers(&session_id, &database).await.map_err(|e| e.message)
}

// ── DDL ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_create_database(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    name: String,
    charset: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.create_database(&session_id, &name, charset.as_deref()).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_drop_database(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.drop_database(&session_id, &name).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_drop_table(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.drop_table(&session_id, &database, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_truncate_table(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.truncate_table(&session_id, &database, &table).await.map_err(|e| e.message)
}

// ── Data CRUD ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_get_table_data(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.get_table_data(&session_id, &database, &table, limit, offset).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_insert_row(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.insert_row(&session_id, &database, &table, &columns, &values).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_update_rows(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
    where_clause: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.update_rows(&session_id, &database, &table, &columns, &values, &where_clause).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_delete_rows(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
    where_clause: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.delete_rows(&session_id, &database, &table, &where_clause).await.map_err(|e| e.message)
}

// ── Export / Import ─────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_export_table(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
    options: ExportOptions,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.export_table(&session_id, &database, &table, &options).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_export_database(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    options: ExportOptions,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.export_database(&session_id, &database, &options).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_import_sql(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    sql_content: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.import_sql(&session_id, &sql_content).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_import_csv(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    database: String,
    table: String,
    csv_content: String,
    has_header: bool,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.import_csv(&session_id, &database, &table, &csv_content, has_header).await.map_err(|e| e.message)
}

// ── Administration ──────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_show_variables(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    filter: Option<String>,
) -> Result<Vec<ServerVariable>, String> {
    let mut svc = state.lock().await;
    svc.show_variables(&session_id, filter.as_deref()).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_show_processlist(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    let mut svc = state.lock().await;
    svc.show_processlist(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_kill_process(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    process_id: u64,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.kill_process(&session_id, process_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_list_users(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
) -> Result<Vec<UserInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_users(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_show_grants(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
    user: String,
    host: String,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    svc.show_grants(&session_id, &user, &host).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mysql_server_uptime(
    state: tauri::State<'_, MysqlServiceState>,
    session_id: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.server_uptime(&session_id).await.map_err(|e| e.message)
}
