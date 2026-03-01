//! Tauri commands for the SQLite integration.

use crate::sqlite::service::SqliteServiceState;
use crate::sqlite::types::*;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_connect(
    state: tauri::State<'_, SqliteServiceState>,
    config: SqliteConnectionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_disconnect(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_disconnect_all(
    state: tauri::State<'_, SqliteServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn sqlite_list_sessions(
    state: tauri::State<'_, SqliteServiceState>,
) -> Result<Vec<SessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn sqlite_get_session(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session(&session_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_ping(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.ping(&session_id).map_err(|e| e.message)
}

// ── Query execution ─────────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_execute_query(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.execute_query(&session_id, &sql).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_execute_statement(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.execute_statement(&session_id, &sql).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_explain_query(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    sql: String,
) -> Result<Vec<ExplainRow>, String> {
    let mut svc = state.lock().await;
    svc.explain_query(&session_id, &sql).await.map_err(|e| e.message)
}

// ── Schema ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_list_tables(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<Vec<TableInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_tables(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_describe_table(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
) -> Result<Vec<ColumnDef>, String> {
    let mut svc = state.lock().await;
    svc.describe_table(&session_id, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_list_indexes(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
) -> Result<Vec<IndexInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_indexes(&session_id, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_list_foreign_keys(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_foreign_keys(&session_id, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_list_triggers(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<Vec<TriggerInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_triggers(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_list_attached_databases(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<Vec<AttachedDatabase>, String> {
    let mut svc = state.lock().await;
    svc.list_attached_databases(&session_id).await.map_err(|e| e.message)
}

// ── PRAGMA ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_get_pragma(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    pragma: String,
) -> Result<PragmaValue, String> {
    let mut svc = state.lock().await;
    svc.get_pragma(&session_id, &pragma).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_set_pragma(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    pragma: String,
    value: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_pragma(&session_id, &pragma, &value).await.map_err(|e| e.message)
}

// ── DDL / Maintenance ───────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_drop_table(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.drop_table(&session_id, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_vacuum(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.vacuum(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_integrity_check(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    svc.integrity_check(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_attach_database(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    path: String,
    alias: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.attach_database(&session_id, &path, &alias).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_detach_database(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    alias: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.detach_database(&session_id, &alias).await.map_err(|e| e.message)
}

// ── Data CRUD ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_get_table_data(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.get_table_data(&session_id, &table, limit, offset).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_insert_row(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.insert_row(&session_id, &table, &columns, &values).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_update_rows(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
    where_clause: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.update_rows(&session_id, &table, &columns, &values, &where_clause).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_delete_rows(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
    where_clause: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.delete_rows(&session_id, &table, &where_clause).await.map_err(|e| e.message)
}

// ── Export / Import ─────────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_export_table(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
    options: ExportOptions,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.export_table(&session_id, &table, &options).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_export_database(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    options: ExportOptions,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.export_database(&session_id, &options).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_import_sql(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    sql_content: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.import_sql(&session_id, &sql_content).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_import_csv(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
    csv_content: String,
    has_header: bool,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.import_csv(&session_id, &table, &csv_content, has_header).await.map_err(|e| e.message)
}

// ── Info ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sqlite_database_size(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.database_size(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn sqlite_table_count(
    state: tauri::State<'_, SqliteServiceState>,
    session_id: String,
    table: String,
) -> Result<i64, String> {
    let mut svc = state.lock().await;
    svc.table_count(&session_id, &table).await.map_err(|e| e.message)
}
