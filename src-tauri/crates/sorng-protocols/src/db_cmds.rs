use super::db::*;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect_mysql(
    state: tauri::State<'_, DbServiceState>,
    host: String,
    port: u16,
    username: String,
    password: String,
    database: String,
    proxy: Option<ProxyConfig>,
    openvpn: Option<OpenVPNConfig>,
    ssh_tunnel: Option<SshTunnelConfig>,
) -> Result<String, String> {
    let mut db = state.lock().await;
    db.connect_mysql(
        host, port, username, password, database, proxy, openvpn, ssh_tunnel,
    )
    .await
}

#[tauri::command]
pub async fn execute_query(
    state: tauri::State<'_, DbServiceState>,
    query: String,
) -> Result<QueryResult, String> {
    let db = state.lock().await;
    db.execute_query(query).await
}

#[tauri::command]
pub async fn disconnect_db(state: tauri::State<'_, DbServiceState>) -> Result<(), String> {
    let mut db = state.lock().await;
    db.disconnect_db().await
}

#[tauri::command]
pub async fn get_databases(state: tauri::State<'_, DbServiceState>) -> Result<Vec<String>, String> {
    let db = state.lock().await;
    db.get_databases().await
}

#[tauri::command]
pub async fn get_tables(
    state: tauri::State<'_, DbServiceState>,
    database: String,
) -> Result<Vec<String>, String> {
    let db = state.lock().await;
    db.get_tables(database).await
}

#[tauri::command]
pub async fn get_table_structure(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
) -> Result<QueryResult, String> {
    let db = state.lock().await;
    db.get_table_structure(database, table).await
}

#[tauri::command]
pub async fn create_database(
    state: tauri::State<'_, DbServiceState>,
    database: String,
) -> Result<(), String> {
    let db = state.lock().await;
    db.create_database(database).await
}

#[tauri::command]
pub async fn drop_database(
    state: tauri::State<'_, DbServiceState>,
    database: String,
) -> Result<(), String> {
    let db = state.lock().await;
    db.drop_database(database).await
}

#[tauri::command]
pub async fn create_table(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    columns: Vec<String>,
) -> Result<(), String> {
    let db = state.lock().await;
    db.create_table(database, table, columns).await
}

#[tauri::command]
pub async fn drop_table(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
) -> Result<(), String> {
    let db = state.lock().await;
    db.drop_table(database, table).await
}

#[tauri::command]
pub async fn get_table_data(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<QueryResult, String> {
    let db = state.lock().await;
    db.get_table_data(database, table, limit, offset).await
}

#[tauri::command]
pub async fn insert_row(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
) -> Result<u64, String> {
    let db = state.lock().await;
    db.insert_row(database, table, columns, values).await
}

#[tauri::command]
pub async fn update_row(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    columns: Vec<String>,
    values: Vec<String>,
    where_clause: String,
) -> Result<u64, String> {
    let db = state.lock().await;
    db.update_row(database, table, columns, values, where_clause)
        .await
}

#[tauri::command]
pub async fn delete_row(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    where_clause: String,
) -> Result<u64, String> {
    let db = state.lock().await;
    db.delete_row(database, table, where_clause).await
}

#[tauri::command]
pub async fn export_table(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    format: String,
) -> Result<String, String> {
    let db = state.lock().await;
    db.export_table(database, table, format).await
}

#[tauri::command]
pub async fn export_table_chunked(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    format: String,
    chunk_size: Option<u32>,
    max_chunks: Option<u32>,
) -> Result<String, String> {
    let db = state.lock().await;
    db.export_table_chunked(database, table, format, chunk_size, max_chunks)
        .await
}

#[tauri::command]
pub async fn export_database(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    format: String,
    include_data: bool,
) -> Result<String, String> {
    let db = state.lock().await;
    db.export_database(database, format, include_data).await
}

#[tauri::command]
pub async fn export_database_chunked(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    format: String,
    include_data: bool,
    chunk_size: Option<u32>,
    max_chunks: Option<u32>,
) -> Result<String, String> {
    let db = state.lock().await;
    db.export_database_chunked(database, format, include_data, chunk_size, max_chunks)
        .await
}

#[tauri::command]
pub async fn import_sql(
    state: tauri::State<'_, DbServiceState>,
    sql_content: String,
) -> Result<u64, String> {
    let db = state.lock().await;
    db.import_sql(sql_content).await
}

#[tauri::command]
pub async fn import_csv(
    state: tauri::State<'_, DbServiceState>,
    database: String,
    table: String,
    csv_content: String,
    has_header: bool,
) -> Result<u64, String> {
    let db = state.lock().await;
    db.import_csv(database, table, csv_content, has_header)
        .await
}

