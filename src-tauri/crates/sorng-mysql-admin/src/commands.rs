// ── sorng-mysql-admin/src/commands.rs ─────────────────────────────────────────
//! Tauri commands – thin wrappers around `MysqlService`.

use crate::service::MysqlServiceState;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_connect(
    state: State<'_, MysqlServiceState>,
    id: String,
    config: MysqlConnectionConfig,
) -> CmdResult<MysqlConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_disconnect(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_connections(
    state: State<'_, MysqlServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_list_users(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_user(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
    host: String,
) -> CmdResult<MysqlUser> {
    state
        .lock()
        .await
        .get_user(&id, &user, &host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_create_user(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
    host: String,
    password: String,
    plugin: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_user(&id, &user, &host, &password, plugin.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_drop_user(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
    host: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drop_user(&id, &user, &host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_rename_user(
    state: State<'_, MysqlServiceState>,
    id: String,
    old_user: String,
    old_host: String,
    new_user: String,
    new_host: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rename_user(&id, &old_user, &old_host, &new_user, &new_host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_set_password(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
    host: String,
    password: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_user_password(&id, &user, &host, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_lock_user(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
    host: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .lock_user(&id, &user, &host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_unlock_user(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
    host: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .unlock_user(&id, &user, &host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_grants(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
    host: String,
) -> CmdResult<Vec<MysqlGrant>> {
    state
        .lock()
        .await
        .list_grants(&id, &user, &host)
        .await
        .map_err(map_err)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn mysql_admin_grant(
    state: State<'_, MysqlServiceState>,
    id: String,
    privilege: String,
    database: String,
    table: String,
    user: String,
    host: String,
    with_grant: bool,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .grant_privilege(&id, &privilege, &database, &table, &user, &host, with_grant)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_revoke(
    state: State<'_, MysqlServiceState>,
    id: String,
    privilege: String,
    database: String,
    table: String,
    user: String,
    host: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .revoke_privilege(&id, &privilege, &database, &table, &user, &host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_flush_privileges(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .flush_privileges(&id)
        .await
        .map_err(map_err)
}

// ── Replication ───────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_get_master_status(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<ReplicationStatus> {
    state
        .lock()
        .await
        .get_master_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_slave_status(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<ReplicationStatus> {
    state
        .lock()
        .await
        .get_slave_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_configure_master(
    state: State<'_, MysqlServiceState>,
    id: String,
    config: ReplicationConfig,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .configure_master(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_start_slave(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.start_slave(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_stop_slave(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop_slave(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_reset_slave(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.reset_slave(&id).await.map_err(map_err)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn mysql_admin_change_master(
    state: State<'_, MysqlServiceState>,
    id: String,
    master_host: String,
    master_port: u16,
    master_user: String,
    master_password: String,
    master_log_file: Option<String>,
    master_log_pos: Option<u64>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .change_master(
            &id,
            &master_host,
            master_port,
            &master_user,
            &master_password,
            master_log_file.as_deref(),
            master_log_pos,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_skip_counter(
    state: State<'_, MysqlServiceState>,
    id: String,
    count: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .skip_counter(&id, count)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_gtid_executed(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_gtid_executed(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_gtid_purged(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_gtid_purged(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_set_read_only(
    state: State<'_, MysqlServiceState>,
    id: String,
    enabled: bool,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_read_only(&id, enabled)
        .await
        .map_err(map_err)
}

// ── Databases ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_list_databases(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlDatabase>> {
    state
        .lock()
        .await
        .list_databases(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_database(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
) -> CmdResult<MysqlDatabase> {
    state
        .lock()
        .await
        .get_database(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_create_database(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
    charset: Option<String>,
    collation: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_database(&id, &name, charset.as_deref(), collation.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_drop_database(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drop_database(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_database_size(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_database_size(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_database_charset(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_database_charset(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_alter_database_charset(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
    charset: String,
    collation: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .alter_database_charset(&id, &name, &charset, &collation)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_database_tables(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<MysqlTable>> {
    state
        .lock()
        .await
        .list_database_tables(&id, &db)
        .await
        .map_err(map_err)
}

// ── Tables ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_list_tables(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<MysqlTable>> {
    state
        .lock()
        .await
        .list_tables(&id, &db)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<MysqlTable> {
    state
        .lock()
        .await
        .get_table(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_describe_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<Vec<MysqlColumn>> {
    state
        .lock()
        .await
        .describe_table(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_indexes(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<Vec<MysqlIndex>> {
    state
        .lock()
        .await
        .list_indexes(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_create_index(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
    name: String,
    columns: Vec<String>,
    unique: bool,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_index(&id, &db, &table, &name, &columns, unique)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_drop_index(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drop_index(&id, &db, &table, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_analyze_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .analyze_table(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_optimize_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .optimize_table(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_repair_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .repair_table(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_check_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .check_table(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_truncate_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .truncate_table(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_create_statement(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_create_statement(&id, &db, &table)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_row_count(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_row_count(&id, &db, &table)
        .await
        .map_err(map_err)
}

// ── Queries / Slow Log ────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_is_slow_log_enabled(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .is_slow_log_enabled(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_enable_slow_log(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_slow_log(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_disable_slow_log(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_slow_log(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_slow_log_file(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_slow_log_file(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_long_query_time(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<f64> {
    state
        .lock()
        .await
        .get_long_query_time(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_set_long_query_time(
    state: State<'_, MysqlServiceState>,
    id: String,
    seconds: f64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_long_query_time(&id, seconds)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_slow_queries(
    state: State<'_, MysqlServiceState>,
    id: String,
    limit: u64,
) -> CmdResult<Vec<SlowQueryEntry>> {
    state
        .lock()
        .await
        .list_slow_queries(&id, limit)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_explain_query(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    sql: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .explain_query(&id, &db, &sql)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_kill_query(
    state: State<'_, MysqlServiceState>,
    id: String,
    process_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .kill_query(&id, process_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_global_status(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlVariable>> {
    state
        .lock()
        .await
        .get_global_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_query_cache_status(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlVariable>> {
    state
        .lock()
        .await
        .get_query_cache_status(&id)
        .await
        .map_err(map_err)
}

// ── InnoDB ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_get_innodb_status(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<InnodbStatus> {
    state
        .lock()
        .await
        .get_innodb_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_buffer_pool_stats(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<InnodbStatus> {
    state
        .lock()
        .await
        .get_buffer_pool_stats(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_engine_status(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_engine_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_innodb_locks(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .list_innodb_locks(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_innodb_lock_waits(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .list_innodb_lock_waits(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_deadlock_info(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_deadlock_info(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_innodb_io_stats(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_innodb_io_stats(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_innodb_row_operations(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_innodb_row_operations(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_innodb_force_recovery_check(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .innodb_force_recovery_check(&id)
        .await
        .map_err(map_err)
}

// ── Variables ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_list_global_variables(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlVariable>> {
    state
        .lock()
        .await
        .list_global_variables(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_session_variables(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlVariable>> {
    state
        .lock()
        .await
        .list_session_variables(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_global_variable(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
) -> CmdResult<MysqlVariable> {
    state
        .lock()
        .await
        .get_global_variable(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_session_variable(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
) -> CmdResult<MysqlVariable> {
    state
        .lock()
        .await
        .get_session_variable(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_set_global_variable(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_global_variable(&id, &name, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_set_session_variable(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_session_variable(&id, &name, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_status_variables(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlVariable>> {
    state
        .lock()
        .await
        .list_status_variables(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_status_variable(
    state: State<'_, MysqlServiceState>,
    id: String,
    name: String,
) -> CmdResult<MysqlVariable> {
    state
        .lock()
        .await
        .get_status_variable(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_server_info(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_server_info(&id)
        .await
        .map_err(map_err)
}

// ── Backup ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_create_backup(
    state: State<'_, MysqlServiceState>,
    id: String,
    config: BackupConfig,
) -> CmdResult<BackupResult> {
    state
        .lock()
        .await
        .create_backup(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_restore_backup(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .restore_backup(&id, &db, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_backup_files(
    state: State<'_, MysqlServiceState>,
    id: String,
    dir: String,
) -> CmdResult<Vec<BackupResult>> {
    state
        .lock()
        .await
        .list_backup_files(&id, &dir)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_backup_size(
    state: State<'_, MysqlServiceState>,
    id: String,
    path: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_backup_size(&id, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_verify_backup(
    state: State<'_, MysqlServiceState>,
    id: String,
    path: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .verify_backup(&id, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_export_table(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    table: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .export_table(&id, &db, &table, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_import_sql(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
    path: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .import_sql(&id, &db, &path)
        .await
        .map_err(map_err)
}

// ── Processes ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_list_processes(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<MysqlProcess>> {
    state
        .lock()
        .await
        .list_processes(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_process(
    state: State<'_, MysqlServiceState>,
    id: String,
    pid: u64,
) -> CmdResult<MysqlProcess> {
    state
        .lock()
        .await
        .get_process(&id, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_kill_process(
    state: State<'_, MysqlServiceState>,
    id: String,
    pid: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .kill_process(&id, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_kill_process_query(
    state: State<'_, MysqlServiceState>,
    id: String,
    pid: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .kill_process_query(&id, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_processes_by_user(
    state: State<'_, MysqlServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<MysqlProcess>> {
    state
        .lock()
        .await
        .list_processes_by_user(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_processes_by_db(
    state: State<'_, MysqlServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<MysqlProcess>> {
    state
        .lock()
        .await
        .list_processes_by_db(&id, &db)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_max_connections(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_max_connections(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_thread_stats(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_thread_stats(&id)
        .await
        .map_err(map_err)
}

// ── Binary Logs ───────────────────────────────────────────────────

#[tauri::command]
pub async fn mysql_admin_list_binlogs(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<Vec<BinlogFile>> {
    state.lock().await.list_binlogs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_current_binlog(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<BinlogFile> {
    state
        .lock()
        .await
        .get_current_binlog(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_list_binlog_events(
    state: State<'_, MysqlServiceState>,
    id: String,
    log_name: String,
    limit: u64,
) -> CmdResult<Vec<BinlogEvent>> {
    state
        .lock()
        .await
        .list_binlog_events(&id, &log_name, limit)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_purge_binlogs_to(
    state: State<'_, MysqlServiceState>,
    id: String,
    log_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .purge_binlogs_to(&id, &log_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_purge_binlogs_before(
    state: State<'_, MysqlServiceState>,
    id: String,
    datetime: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .purge_binlogs_before(&id, &datetime)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_binlog_format(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_binlog_format(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_set_binlog_format(
    state: State<'_, MysqlServiceState>,
    id: String,
    format: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_binlog_format(&id, &format)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_get_binlog_expire_days(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_binlog_expire_days(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_set_binlog_expire_days(
    state: State<'_, MysqlServiceState>,
    id: String,
    days: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_binlog_expire_days(&id, days)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mysql_admin_flush_binlogs(
    state: State<'_, MysqlServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.flush_binlogs(&id).await.map_err(map_err)
}
