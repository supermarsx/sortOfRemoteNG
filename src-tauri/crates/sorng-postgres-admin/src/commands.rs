// ── sorng-postgres-admin/src/commands.rs ──────────────────────────────────────
//! Tauri commands – thin wrappers around `PgService`.

use crate::service::PgServiceState;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_connect(
    state: State<'_, PgServiceState>,
    id: String,
    config: PgConnectionConfig,
) -> CmdResult<PgConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_disconnect(state: State<'_, PgServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_connections(state: State<'_, PgServiceState>) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Roles ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_list_roles(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgRole>> {
    state.lock().await.list_roles(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_role(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<PgRole> {
    state
        .lock()
        .await
        .get_role(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pg_admin_create_role(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    password: Option<String>,
    superuser: bool,
    createdb: bool,
    createrole: bool,
    login: bool,
    replication: bool,
    connection_limit: Option<i32>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_role(
            &id,
            &name,
            password.as_deref(),
            superuser,
            createdb,
            createrole,
            login,
            replication,
            connection_limit,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pg_admin_alter_role(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    superuser: Option<bool>,
    createdb: Option<bool>,
    createrole: Option<bool>,
    login: Option<bool>,
    replication: Option<bool>,
    connection_limit: Option<i32>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .alter_role(
            &id,
            &name,
            superuser,
            createdb,
            createrole,
            login,
            replication,
            connection_limit,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_drop_role(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drop_role(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_rename_role(
    state: State<'_, PgServiceState>,
    id: String,
    old_name: String,
    new_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rename_role(&id, &old_name, &new_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_grant_role(
    state: State<'_, PgServiceState>,
    id: String,
    role: String,
    member: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .grant_role(&id, &role, &member)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_revoke_role(
    state: State<'_, PgServiceState>,
    id: String,
    role: String,
    member: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .revoke_role(&id, &role, &member)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_set_role_password(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    password: String,
    valid_until: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_role_password(&id, &name, &password, valid_until.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_role_memberships(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_role_memberships(&id, &name)
        .await
        .map_err(map_err)
}

// ── Databases ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_list_databases(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgDatabase>> {
    state
        .lock()
        .await
        .list_databases(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_database(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<PgDatabase> {
    state
        .lock()
        .await
        .get_database(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_create_database(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    owner: Option<String>,
    encoding: Option<String>,
    template: Option<String>,
    tablespace: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_database(
            &id,
            &name,
            owner.as_deref(),
            encoding.as_deref(),
            template.as_deref(),
            tablespace.as_deref(),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_drop_database(
    state: State<'_, PgServiceState>,
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
pub async fn pg_admin_rename_database(
    state: State<'_, PgServiceState>,
    id: String,
    old_name: String,
    new_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rename_database(&id, &old_name, &new_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_alter_database_owner(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    owner: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .alter_database_owner(&id, &db, &owner)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_database_size(
    state: State<'_, PgServiceState>,
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
pub async fn pg_admin_get_database_connections(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_database_connections(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_terminate_connections(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .terminate_database_connections(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_database_schemas(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<PgSchema>> {
    state
        .lock()
        .await
        .list_database_schemas(&id, &db)
        .await
        .map_err(map_err)
}

// ── pg_hba.conf ───────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_list_hba(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgHbaEntry>> {
    state.lock().await.list_hba(&id).await.map_err(map_err)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pg_admin_add_hba(
    state: State<'_, PgServiceState>,
    id: String,
    entry_type: String,
    database: String,
    user: String,
    address: Option<String>,
    method: String,
    options: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_hba(
            &id,
            &entry_type,
            &database,
            &user,
            address.as_deref(),
            &method,
            options.as_deref(),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_remove_hba(
    state: State<'_, PgServiceState>,
    id: String,
    line_number: u32,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_hba(&id, line_number)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_update_hba(
    state: State<'_, PgServiceState>,
    id: String,
    line_number: u32,
    entry: PgHbaEntry,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_hba(&id, line_number, &entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_reload_hba(state: State<'_, PgServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload_hba(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_hba_raw(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_hba_raw(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_set_hba_raw(
    state: State<'_, PgServiceState>,
    id: String,
    content: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_hba_raw(&id, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_validate_hba(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.validate_hba(&id).await.map_err(map_err)
}

// ── Replication ───────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_get_replication_status(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgReplicationStat>> {
    state
        .lock()
        .await
        .get_replication_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_replication_slots(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgReplicationSlot>> {
    state
        .lock()
        .await
        .list_replication_slots(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_create_replication_slot(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    plugin: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_replication_slot(&id, &name, plugin.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_drop_replication_slot(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drop_replication_slot(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_create_physical_replication_slot(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_physical_replication_slot(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_create_logical_replication_slot(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    plugin: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_logical_replication_slot(&id, &name, &plugin)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_wal_receiver_status(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_wal_receiver_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_promote_standby(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .promote_standby(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_replication_lag(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_replication_lag(&id)
        .await
        .map_err(map_err)
}

// ── Vacuum / Analyze ──────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_get_vacuum_stats(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<PgVacuumInfo>> {
    state
        .lock()
        .await
        .get_vacuum_stats(&id, &db)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_vacuum_table(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    table: String,
    full: bool,
    analyze: bool,
    verbose: bool,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .vacuum_table(&id, &db, &table, full, analyze, verbose)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_vacuum_database(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    full: bool,
    analyze: bool,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .vacuum_database(&id, &db, full, analyze)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_analyze(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    table: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .analyze_table(&id, &db, table.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_reindex(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    table_or_index: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .reindex(&id, &db, &table_or_index)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_bloat(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<PgVacuumInfo>> {
    state
        .lock()
        .await
        .get_bloat(&id, &db)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_autovacuum_config(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgSetting>> {
    state
        .lock()
        .await
        .get_autovacuum_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_set_autovacuum_config(
    state: State<'_, PgServiceState>,
    id: String,
    setting: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_autovacuum_config(&id, &setting, &value)
        .await
        .map_err(map_err)
}

// ── Extensions ────────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_list_available_extensions(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgExtension>> {
    state
        .lock()
        .await
        .list_available_extensions(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_installed_extensions(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<PgExtension>> {
    state
        .lock()
        .await
        .list_installed_extensions(&id, &db)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_install_extension(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
    schema: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .install_extension(&id, &db, &name, schema.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_uninstall_extension(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
    cascade: bool,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .uninstall_extension(&id, &db, &name, cascade)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_update_extension(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
    version: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_extension(&id, &db, &name, version.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_extension(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
) -> CmdResult<PgExtension> {
    state
        .lock()
        .await
        .get_extension(&id, &db, &name)
        .await
        .map_err(map_err)
}

// ── Stats / Settings ──────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_get_database_stats(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgStatDatabase>> {
    state
        .lock()
        .await
        .get_database_stats(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_table_stats(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    schema: Option<String>,
) -> CmdResult<Vec<PgStatTable>> {
    state
        .lock()
        .await
        .get_table_stats(&id, &db, schema.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_index_stats(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    schema: Option<String>,
) -> CmdResult<Vec<PgIndex>> {
    state
        .lock()
        .await
        .get_index_stats(&id, &db, schema.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_locks(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgLock>> {
    state.lock().await.get_locks(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_activity(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgActivity>> {
    state.lock().await.get_activity(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_settings(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgSetting>> {
    state.lock().await.get_settings(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_setting(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<PgSetting> {
    state
        .lock()
        .await
        .get_setting(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_set_setting(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_setting(&id, &name, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_reload_config(state: State<'_, PgServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_reset_stats(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .reset_stats(&id, &db)
        .await
        .map_err(map_err)
}

// ── WAL ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_get_wal_info(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<PgWalInfo> {
    state.lock().await.get_wal_info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_current_lsn(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_current_lsn(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_switch_wal(state: State<'_, PgServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.switch_wal(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_archive_status(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_archive_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_wal_files(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_wal_files(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_wal_size(state: State<'_, PgServiceState>, id: String) -> CmdResult<u64> {
    state.lock().await.get_wal_size(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_checkpoint(state: State<'_, PgServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.checkpoint(&id).await.map_err(map_err)
}

// ── Tablespaces ───────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_list_tablespaces(
    state: State<'_, PgServiceState>,
    id: String,
) -> CmdResult<Vec<PgTablespace>> {
    state
        .lock()
        .await
        .list_tablespaces(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_tablespace(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<PgTablespace> {
    state
        .lock()
        .await
        .get_tablespace(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_create_tablespace(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    location: String,
    owner: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_tablespace(&id, &name, &location, owner.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_drop_tablespace(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drop_tablespace(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_rename_tablespace(
    state: State<'_, PgServiceState>,
    id: String,
    old_name: String,
    new_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rename_tablespace(&id, &old_name, &new_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_alter_tablespace_owner(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
    owner: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .alter_tablespace_owner(&id, &name, &owner)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_tablespace_size(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<u64> {
    state
        .lock()
        .await
        .get_tablespace_size(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_tablespace_objects(
    state: State<'_, PgServiceState>,
    id: String,
    name: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_tablespace_objects(&id, &name)
        .await
        .map_err(map_err)
}

// ── Schemas ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_list_schemas(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
) -> CmdResult<Vec<PgSchema>> {
    state
        .lock()
        .await
        .list_schemas(&id, &db)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_get_schema(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
) -> CmdResult<PgSchema> {
    state
        .lock()
        .await
        .get_schema(&id, &db, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_create_schema(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
    owner: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_schema(&id, &db, &name, owner.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_drop_schema(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
    cascade: bool,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drop_schema(&id, &db, &name, cascade)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_rename_schema(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    old_name: String,
    new_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rename_schema(&id, &db, &old_name, &new_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_alter_schema_owner(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    name: String,
    owner: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .alter_schema_owner(&id, &db, &name, &owner)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_grant_schema(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    schema: String,
    role: String,
    privileges: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .grant_schema(&id, &db, &schema, &role, &privileges)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_revoke_schema(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    schema: String,
    role: String,
    privileges: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .revoke_schema(&id, &db, &schema, &role, &privileges)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_schema_tables(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    schema: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_schema_tables(&id, &db, &schema)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_schema_views(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    schema: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_schema_views(&id, &db, &schema)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_schema_functions(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    schema: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_schema_functions(&id, &db, &schema)
        .await
        .map_err(map_err)
}

// ── Backup ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pg_admin_pg_dump(
    state: State<'_, PgServiceState>,
    id: String,
    config: PgBackupConfig,
) -> CmdResult<PgBackupResult> {
    state
        .lock()
        .await
        .pg_dump(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_pg_restore(
    state: State<'_, PgServiceState>,
    id: String,
    db: String,
    path: String,
    format: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .pg_restore(&id, &db, &path, format.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_pg_dumpall(
    state: State<'_, PgServiceState>,
    id: String,
    path: String,
) -> CmdResult<PgBackupResult> {
    state
        .lock()
        .await
        .pg_dumpall(&id, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_pg_basebackup(
    state: State<'_, PgServiceState>,
    id: String,
    path: String,
    format: Option<String>,
    checkpoint: Option<String>,
) -> CmdResult<PgBackupResult> {
    state
        .lock()
        .await
        .pg_basebackup(&id, &path, format.as_deref(), checkpoint.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_list_backup_files(
    state: State<'_, PgServiceState>,
    id: String,
    dir: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_backup_files(&id, &dir)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pg_admin_verify_backup(
    state: State<'_, PgServiceState>,
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
pub async fn pg_admin_get_backup_size(
    state: State<'_, PgServiceState>,
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
