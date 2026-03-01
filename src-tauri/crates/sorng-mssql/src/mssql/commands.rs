//! Tauri commands for the Microsoft SQL Server integration.

use crate::mssql::service::MssqlServiceState;
use crate::mssql::types::*;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn mssql_connect(
    state: tauri::State<'_, MssqlServiceState>,
    config: MssqlConnectionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_disconnect(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_disconnect_all(
    state: tauri::State<'_, MssqlServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn mssql_list_sessions(
    state: tauri::State<'_, MssqlServiceState>,
) -> Result<Vec<SessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn mssql_get_session(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session(&session_id).map_err(|e| e.message)
}

// ── Query execution ─────────────────────────────────────────────────

#[tauri::command]
pub async fn mssql_execute_query(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.execute_query(&session_id, &sql).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_execute_statement(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.execute_statement(&session_id, &sql).await.map_err(|e| e.message)
}

// ── Schema ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mssql_list_databases(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_databases(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_schemas(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
) -> Result<Vec<SchemaInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_schemas(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_tables(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
) -> Result<Vec<TableInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_tables(&session_id, &schema).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_describe_table(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnDef>, String> {
    let mut svc = state.lock().await;
    svc.describe_table(&session_id, &schema, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_indexes(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
) -> Result<Vec<IndexInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_indexes(&session_id, &schema, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_foreign_keys(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_foreign_keys(&session_id, &schema, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_views(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
) -> Result<Vec<ViewInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_views(&session_id, &schema).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_stored_procs(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
) -> Result<Vec<StoredProcInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_stored_procs(&session_id, &schema).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_triggers(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
) -> Result<Vec<TriggerInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_triggers(&session_id, &schema).await.map_err(|e| e.message)
}

// ── DDL ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mssql_create_database(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.create_database(&session_id, &name).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_drop_database(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.drop_database(&session_id, &name).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_drop_table(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.drop_table(&session_id, &schema, &table).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_truncate_table(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.truncate_table(&session_id, &schema, &table).await.map_err(|e| e.message)
}

// ── Data CRUD ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn mssql_get_table_data(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<QueryResult, String> {
    let mut svc = state.lock().await;
    svc.get_table_data(&session_id, &schema, &table, limit, offset).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_insert_row(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.insert_row(&session_id, &schema, &table, &columns, &values).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_update_rows(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
    where_clause: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.update_rows(&session_id, &schema, &table, &columns, &values, &where_clause).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_delete_rows(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
    where_clause: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.delete_rows(&session_id, &schema, &table, &where_clause).await.map_err(|e| e.message)
}

// ── Export / Import ─────────────────────────────────────────────────

#[tauri::command]
pub async fn mssql_export_table(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
    options: ExportOptions,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.export_table(&session_id, &schema, &table, &options).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_import_sql(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    sql_content: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.import_sql(&session_id, &sql_content).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_import_csv(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    schema: String,
    table: String,
    csv_content: String,
    has_header: bool,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.import_csv(&session_id, &schema, &table, &csv_content, has_header).await.map_err(|e| e.message)
}

// ── Administration ──────────────────────────────────────────────────

#[tauri::command]
pub async fn mssql_server_properties(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
) -> Result<Vec<ServerProperty>, String> {
    let mut svc = state.lock().await;
    svc.server_properties(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_show_processes(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
) -> Result<Vec<SpWhoResult>, String> {
    let mut svc = state.lock().await;
    svc.show_processes(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_kill_process(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
    spid: i16,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.kill_process(&session_id, spid).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn mssql_list_logins(
    state: tauri::State<'_, MssqlServiceState>,
    session_id: String,
) -> Result<Vec<SqlLogin>, String> {
    let mut svc = state.lock().await;
    svc.list_logins(&session_id).await.map_err(|e| e.message)
}
