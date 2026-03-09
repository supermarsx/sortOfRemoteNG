// ── sorng-mysql-admin/src/service.rs ──────────────────────────────────────────
//! Aggregate MySQL façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::MysqlClient;
use crate::error::{MysqlError, MysqlResult};
use crate::types::*;

use crate::backup::BackupManager;
use crate::binlogs::BinlogManager;
use crate::databases::DatabaseManager;
use crate::innodb::InnodbManager;
use crate::processes::ProcessManager;
use crate::queries::QueryManager;
use crate::replication::ReplicationManager;
use crate::tables::TableManager;
use crate::users::UserManager;
use crate::variables::VariableManager;

/// Shared Tauri state handle.
pub type MysqlServiceState = Arc<Mutex<MysqlService>>;

/// Main MySQL service managing connections.
pub struct MysqlService {
    connections: HashMap<String, MysqlClient>,
}

impl Default for MysqlService {
    fn default() -> Self {
        Self::new()
    }
}

impl MysqlService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: MysqlConnectionConfig,
    ) -> MysqlResult<MysqlConnectionSummary> {
        let client = MysqlClient::new(config)?;

        let version = VariableManager::get_server_info(&client)
            .await
            .unwrap_or_default();
        let uptime_str = client.exec_sql("SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Uptime'")
            .await
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let uptime: u64 = uptime_str.parse().unwrap_or(0);

        let databases_count = DatabaseManager::list(&client)
            .await
            .map(|dbs| dbs.len() as u64)
            .unwrap_or(0);

        let threads_str = client.exec_sql("SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Threads_connected'")
            .await
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let threads_connected: u64 = threads_str.parse().unwrap_or(0);

        let summary = MysqlConnectionSummary {
            host: client.config.host.clone(),
            version,
            uptime,
            databases_count,
            threads_connected,
        };

        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> MysqlResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| MysqlError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> MysqlResult<&MysqlClient> {
        self.connections
            .get(id)
            .ok_or_else(|| MysqlError::not_connected(format!("No connection '{}'", id)))
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> MysqlResult<Vec<MysqlUser>> {
        UserManager::list(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, user: &str, host: &str) -> MysqlResult<MysqlUser> {
        UserManager::get(self.client(id)?, user, host).await
    }

    pub async fn create_user(
        &self,
        id: &str,
        user: &str,
        host: &str,
        password: &str,
        plugin: Option<&str>,
    ) -> MysqlResult<()> {
        UserManager::create(self.client(id)?, user, host, password, plugin).await
    }

    pub async fn drop_user(&self, id: &str, user: &str, host: &str) -> MysqlResult<()> {
        UserManager::drop(self.client(id)?, user, host).await
    }

    pub async fn rename_user(
        &self,
        id: &str,
        old_user: &str,
        old_host: &str,
        new_user: &str,
        new_host: &str,
    ) -> MysqlResult<()> {
        UserManager::rename(self.client(id)?, old_user, old_host, new_user, new_host).await
    }

    pub async fn set_user_password(
        &self,
        id: &str,
        user: &str,
        host: &str,
        password: &str,
    ) -> MysqlResult<()> {
        UserManager::set_password(self.client(id)?, user, host, password).await
    }

    pub async fn lock_user(&self, id: &str, user: &str, host: &str) -> MysqlResult<()> {
        UserManager::lock(self.client(id)?, user, host).await
    }

    pub async fn unlock_user(&self, id: &str, user: &str, host: &str) -> MysqlResult<()> {
        UserManager::unlock(self.client(id)?, user, host).await
    }

    pub async fn list_grants(
        &self,
        id: &str,
        user: &str,
        host: &str,
    ) -> MysqlResult<Vec<MysqlGrant>> {
        UserManager::list_grants(self.client(id)?, user, host).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn grant_privilege(
        &self,
        id: &str,
        privilege: &str,
        database: &str,
        table: &str,
        user: &str,
        host: &str,
        with_grant: bool,
    ) -> MysqlResult<()> {
        UserManager::grant(
            self.client(id)?,
            privilege,
            database,
            table,
            user,
            host,
            with_grant,
        )
        .await
    }

    pub async fn revoke_privilege(
        &self,
        id: &str,
        privilege: &str,
        database: &str,
        table: &str,
        user: &str,
        host: &str,
    ) -> MysqlResult<()> {
        UserManager::revoke(self.client(id)?, privilege, database, table, user, host).await
    }

    pub async fn flush_privileges(&self, id: &str) -> MysqlResult<()> {
        UserManager::flush_privileges(self.client(id)?).await
    }

    // ── Replication ──────────────────────────────────────────────

    pub async fn get_master_status(&self, id: &str) -> MysqlResult<ReplicationStatus> {
        ReplicationManager::get_master_status(self.client(id)?).await
    }

    pub async fn get_slave_status(&self, id: &str) -> MysqlResult<ReplicationStatus> {
        ReplicationManager::get_slave_status(self.client(id)?).await
    }

    pub async fn configure_master(&self, id: &str, config: &ReplicationConfig) -> MysqlResult<()> {
        ReplicationManager::configure_master(self.client(id)?, config).await
    }

    pub async fn start_slave(&self, id: &str) -> MysqlResult<()> {
        ReplicationManager::start_slave(self.client(id)?).await
    }

    pub async fn stop_slave(&self, id: &str) -> MysqlResult<()> {
        ReplicationManager::stop_slave(self.client(id)?).await
    }

    pub async fn reset_slave(&self, id: &str) -> MysqlResult<()> {
        ReplicationManager::reset_slave(self.client(id)?).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn change_master(
        &self,
        id: &str,
        master_host: &str,
        master_port: u16,
        master_user: &str,
        master_password: &str,
        master_log_file: Option<&str>,
        master_log_pos: Option<u64>,
    ) -> MysqlResult<()> {
        ReplicationManager::change_master(
            self.client(id)?,
            master_host,
            master_port,
            master_user,
            master_password,
            master_log_file,
            master_log_pos,
        )
        .await
    }

    pub async fn skip_counter(&self, id: &str, count: u64) -> MysqlResult<()> {
        ReplicationManager::skip_counter(self.client(id)?, count).await
    }

    pub async fn get_gtid_executed(&self, id: &str) -> MysqlResult<String> {
        ReplicationManager::get_gtid_executed(self.client(id)?).await
    }

    pub async fn get_gtid_purged(&self, id: &str) -> MysqlResult<String> {
        ReplicationManager::get_gtid_purged(self.client(id)?).await
    }

    pub async fn set_read_only(&self, id: &str, enabled: bool) -> MysqlResult<()> {
        ReplicationManager::set_read_only(self.client(id)?, enabled).await
    }

    // ── Databases ────────────────────────────────────────────────

    pub async fn list_databases(&self, id: &str) -> MysqlResult<Vec<MysqlDatabase>> {
        DatabaseManager::list(self.client(id)?).await
    }

    pub async fn get_database(&self, id: &str, name: &str) -> MysqlResult<MysqlDatabase> {
        DatabaseManager::get(self.client(id)?, name).await
    }

    pub async fn create_database(
        &self,
        id: &str,
        name: &str,
        charset: Option<&str>,
        collation: Option<&str>,
    ) -> MysqlResult<()> {
        DatabaseManager::create(self.client(id)?, name, charset, collation).await
    }

    pub async fn drop_database(&self, id: &str, name: &str) -> MysqlResult<()> {
        DatabaseManager::drop(self.client(id)?, name).await
    }

    pub async fn get_database_size(&self, id: &str, name: &str) -> MysqlResult<u64> {
        DatabaseManager::get_size(self.client(id)?, name).await
    }

    pub async fn get_database_charset(&self, id: &str, name: &str) -> MysqlResult<String> {
        DatabaseManager::get_charset(self.client(id)?, name).await
    }

    pub async fn alter_database_charset(
        &self,
        id: &str,
        name: &str,
        charset: &str,
        collation: &str,
    ) -> MysqlResult<()> {
        DatabaseManager::alter_charset(self.client(id)?, name, charset, collation).await
    }

    pub async fn list_database_tables(&self, id: &str, db: &str) -> MysqlResult<Vec<MysqlTable>> {
        DatabaseManager::list_tables(self.client(id)?, db).await
    }

    // ── Tables ───────────────────────────────────────────────────

    pub async fn list_tables(&self, id: &str, db: &str) -> MysqlResult<Vec<MysqlTable>> {
        TableManager::list(self.client(id)?, db).await
    }

    pub async fn get_table(&self, id: &str, db: &str, table: &str) -> MysqlResult<MysqlTable> {
        TableManager::get(self.client(id)?, db, table).await
    }

    pub async fn describe_table(
        &self,
        id: &str,
        db: &str,
        table: &str,
    ) -> MysqlResult<Vec<MysqlColumn>> {
        TableManager::describe(self.client(id)?, db, table).await
    }

    pub async fn list_indexes(
        &self,
        id: &str,
        db: &str,
        table: &str,
    ) -> MysqlResult<Vec<MysqlIndex>> {
        TableManager::list_indexes(self.client(id)?, db, table).await
    }

    pub async fn create_index(
        &self,
        id: &str,
        db: &str,
        table: &str,
        name: &str,
        columns: &[String],
        unique: bool,
    ) -> MysqlResult<()> {
        TableManager::create_index(self.client(id)?, db, table, name, columns, unique).await
    }

    pub async fn drop_index(&self, id: &str, db: &str, table: &str, name: &str) -> MysqlResult<()> {
        TableManager::drop_index(self.client(id)?, db, table, name).await
    }

    pub async fn analyze_table(&self, id: &str, db: &str, table: &str) -> MysqlResult<String> {
        TableManager::analyze(self.client(id)?, db, table).await
    }

    pub async fn optimize_table(&self, id: &str, db: &str, table: &str) -> MysqlResult<String> {
        TableManager::optimize(self.client(id)?, db, table).await
    }

    pub async fn repair_table(&self, id: &str, db: &str, table: &str) -> MysqlResult<String> {
        TableManager::repair(self.client(id)?, db, table).await
    }

    pub async fn check_table(&self, id: &str, db: &str, table: &str) -> MysqlResult<String> {
        TableManager::check(self.client(id)?, db, table).await
    }

    pub async fn truncate_table(&self, id: &str, db: &str, table: &str) -> MysqlResult<()> {
        TableManager::truncate(self.client(id)?, db, table).await
    }

    pub async fn get_create_statement(
        &self,
        id: &str,
        db: &str,
        table: &str,
    ) -> MysqlResult<String> {
        TableManager::get_create_statement(self.client(id)?, db, table).await
    }

    pub async fn get_row_count(&self, id: &str, db: &str, table: &str) -> MysqlResult<u64> {
        TableManager::get_row_count(self.client(id)?, db, table).await
    }

    // ── Queries / Slow Log ───────────────────────────────────────

    pub async fn is_slow_log_enabled(&self, id: &str) -> MysqlResult<bool> {
        QueryManager::is_slow_log_enabled(self.client(id)?).await
    }

    pub async fn enable_slow_log(&self, id: &str) -> MysqlResult<()> {
        QueryManager::enable_slow_log(self.client(id)?).await
    }

    pub async fn disable_slow_log(&self, id: &str) -> MysqlResult<()> {
        QueryManager::disable_slow_log(self.client(id)?).await
    }

    pub async fn get_slow_log_file(&self, id: &str) -> MysqlResult<String> {
        QueryManager::get_slow_log_file(self.client(id)?).await
    }

    pub async fn get_long_query_time(&self, id: &str) -> MysqlResult<f64> {
        QueryManager::get_long_query_time(self.client(id)?).await
    }

    pub async fn set_long_query_time(&self, id: &str, seconds: f64) -> MysqlResult<()> {
        QueryManager::set_long_query_time(self.client(id)?, seconds).await
    }

    pub async fn list_slow_queries(
        &self,
        id: &str,
        limit: u64,
    ) -> MysqlResult<Vec<SlowQueryEntry>> {
        QueryManager::list_slow_queries(self.client(id)?, limit).await
    }

    pub async fn explain_query(&self, id: &str, db: &str, sql: &str) -> MysqlResult<String> {
        QueryManager::explain_query(self.client(id)?, db, sql).await
    }

    pub async fn kill_query(&self, id: &str, process_id: u64) -> MysqlResult<()> {
        QueryManager::kill_query(self.client(id)?, process_id).await
    }

    pub async fn get_global_status(&self, id: &str) -> MysqlResult<Vec<MysqlVariable>> {
        QueryManager::get_global_status(self.client(id)?).await
    }

    pub async fn get_query_cache_status(&self, id: &str) -> MysqlResult<Vec<MysqlVariable>> {
        QueryManager::get_query_cache_status(self.client(id)?).await
    }

    // ── InnoDB ───────────────────────────────────────────────────

    pub async fn get_innodb_status(&self, id: &str) -> MysqlResult<InnodbStatus> {
        InnodbManager::get_status(self.client(id)?).await
    }

    pub async fn get_buffer_pool_stats(&self, id: &str) -> MysqlResult<InnodbStatus> {
        InnodbManager::get_buffer_pool_stats(self.client(id)?).await
    }

    pub async fn get_engine_status(&self, id: &str) -> MysqlResult<String> {
        InnodbManager::get_engine_status(self.client(id)?).await
    }

    pub async fn list_innodb_locks(&self, id: &str) -> MysqlResult<String> {
        InnodbManager::list_locks(self.client(id)?).await
    }

    pub async fn list_innodb_lock_waits(&self, id: &str) -> MysqlResult<String> {
        InnodbManager::list_lock_waits(self.client(id)?).await
    }

    pub async fn get_deadlock_info(&self, id: &str) -> MysqlResult<String> {
        InnodbManager::get_deadlock_info(self.client(id)?).await
    }

    pub async fn get_innodb_io_stats(&self, id: &str) -> MysqlResult<String> {
        InnodbManager::get_io_stats(self.client(id)?).await
    }

    pub async fn get_innodb_row_operations(&self, id: &str) -> MysqlResult<String> {
        InnodbManager::get_row_operations(self.client(id)?).await
    }

    pub async fn innodb_force_recovery_check(&self, id: &str) -> MysqlResult<String> {
        InnodbManager::force_recovery_check(self.client(id)?).await
    }

    // ── Variables ────────────────────────────────────────────────

    pub async fn list_global_variables(&self, id: &str) -> MysqlResult<Vec<MysqlVariable>> {
        VariableManager::list_global(self.client(id)?).await
    }

    pub async fn list_session_variables(&self, id: &str) -> MysqlResult<Vec<MysqlVariable>> {
        VariableManager::list_session(self.client(id)?).await
    }

    pub async fn get_global_variable(&self, id: &str, name: &str) -> MysqlResult<MysqlVariable> {
        VariableManager::get_global(self.client(id)?, name).await
    }

    pub async fn get_session_variable(&self, id: &str, name: &str) -> MysqlResult<MysqlVariable> {
        VariableManager::get_session(self.client(id)?, name).await
    }

    pub async fn set_global_variable(&self, id: &str, name: &str, value: &str) -> MysqlResult<()> {
        VariableManager::set_global(self.client(id)?, name, value).await
    }

    pub async fn set_session_variable(&self, id: &str, name: &str, value: &str) -> MysqlResult<()> {
        VariableManager::set_session(self.client(id)?, name, value).await
    }

    pub async fn list_status_variables(&self, id: &str) -> MysqlResult<Vec<MysqlVariable>> {
        VariableManager::list_status(self.client(id)?).await
    }

    pub async fn get_status_variable(&self, id: &str, name: &str) -> MysqlResult<MysqlVariable> {
        VariableManager::get_status(self.client(id)?, name).await
    }

    pub async fn get_server_info(&self, id: &str) -> MysqlResult<String> {
        VariableManager::get_server_info(self.client(id)?).await
    }

    // ── Backup ───────────────────────────────────────────────────

    pub async fn create_backup(
        &self,
        id: &str,
        config: &BackupConfig,
    ) -> MysqlResult<BackupResult> {
        BackupManager::create_backup(self.client(id)?, config).await
    }

    pub async fn restore_backup(&self, id: &str, db: &str, path: &str) -> MysqlResult<()> {
        BackupManager::restore(self.client(id)?, db, path).await
    }

    pub async fn list_backup_files(&self, id: &str, dir: &str) -> MysqlResult<Vec<BackupResult>> {
        BackupManager::list_backup_files(self.client(id)?, dir).await
    }

    pub async fn get_backup_size(&self, id: &str, path: &str) -> MysqlResult<u64> {
        BackupManager::get_backup_size(self.client(id)?, path).await
    }

    pub async fn verify_backup(&self, id: &str, path: &str) -> MysqlResult<bool> {
        BackupManager::verify_backup(self.client(id)?, path).await
    }

    pub async fn export_table(
        &self,
        id: &str,
        db: &str,
        table: &str,
        path: &str,
    ) -> MysqlResult<()> {
        BackupManager::export_table(self.client(id)?, db, table, path).await
    }

    pub async fn import_sql(&self, id: &str, db: &str, path: &str) -> MysqlResult<()> {
        BackupManager::import_sql(self.client(id)?, db, path).await
    }

    // ── Processes ────────────────────────────────────────────────

    pub async fn list_processes(&self, id: &str) -> MysqlResult<Vec<MysqlProcess>> {
        ProcessManager::list(self.client(id)?).await
    }

    pub async fn get_process(&self, id: &str, pid: u64) -> MysqlResult<MysqlProcess> {
        ProcessManager::get(self.client(id)?, pid).await
    }

    pub async fn kill_process(&self, id: &str, pid: u64) -> MysqlResult<()> {
        ProcessManager::kill(self.client(id)?, pid).await
    }

    pub async fn kill_process_query(&self, id: &str, pid: u64) -> MysqlResult<()> {
        ProcessManager::kill_query(self.client(id)?, pid).await
    }

    pub async fn list_processes_by_user(
        &self,
        id: &str,
        user: &str,
    ) -> MysqlResult<Vec<MysqlProcess>> {
        ProcessManager::list_by_user(self.client(id)?, user).await
    }

    pub async fn list_processes_by_db(&self, id: &str, db: &str) -> MysqlResult<Vec<MysqlProcess>> {
        ProcessManager::list_by_db(self.client(id)?, db).await
    }

    pub async fn get_max_connections(&self, id: &str) -> MysqlResult<u64> {
        ProcessManager::get_max_connections(self.client(id)?).await
    }

    pub async fn get_thread_stats(&self, id: &str) -> MysqlResult<String> {
        ProcessManager::get_thread_stats(self.client(id)?).await
    }

    // ── Binary Logs ──────────────────────────────────────────────

    pub async fn list_binlogs(&self, id: &str) -> MysqlResult<Vec<BinlogFile>> {
        BinlogManager::list(self.client(id)?).await
    }

    pub async fn get_current_binlog(&self, id: &str) -> MysqlResult<BinlogFile> {
        BinlogManager::get_current(self.client(id)?).await
    }

    pub async fn list_binlog_events(
        &self,
        id: &str,
        log_name: &str,
        limit: u64,
    ) -> MysqlResult<Vec<BinlogEvent>> {
        BinlogManager::list_events(self.client(id)?, log_name, limit).await
    }

    pub async fn purge_binlogs_to(&self, id: &str, log_name: &str) -> MysqlResult<()> {
        BinlogManager::purge_to(self.client(id)?, log_name).await
    }

    pub async fn purge_binlogs_before(&self, id: &str, datetime: &str) -> MysqlResult<()> {
        BinlogManager::purge_before(self.client(id)?, datetime).await
    }

    pub async fn get_binlog_format(&self, id: &str) -> MysqlResult<String> {
        BinlogManager::get_binlog_format(self.client(id)?).await
    }

    pub async fn set_binlog_format(&self, id: &str, format: &str) -> MysqlResult<()> {
        BinlogManager::set_binlog_format(self.client(id)?, format).await
    }

    pub async fn get_binlog_expire_days(&self, id: &str) -> MysqlResult<u64> {
        BinlogManager::get_expire_days(self.client(id)?).await
    }

    pub async fn set_binlog_expire_days(&self, id: &str, days: u64) -> MysqlResult<()> {
        BinlogManager::set_expire_days(self.client(id)?, days).await
    }

    pub async fn flush_binlogs(&self, id: &str) -> MysqlResult<()> {
        BinlogManager::flush(self.client(id)?).await
    }
}
