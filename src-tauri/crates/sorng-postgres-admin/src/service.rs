// ── sorng-postgres-admin/src/service.rs ───────────────────────────────────────
//! Aggregate PostgreSQL façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PgClient;
use crate::error::{PgError, PgResult};
use crate::types::*;

use crate::backup::BackupManager;
use crate::databases::DatabaseManager;
use crate::extensions::ExtensionManager;
use crate::pg_hba::HbaManager;
use crate::replication::ReplicationManager;
use crate::roles::RoleManager;
use crate::schemas::SchemaManager;
use crate::stats::StatsManager;
use crate::tablespaces::TablespaceManager;
use crate::vacuum::VacuumManager;
use crate::wal::WalManager;

/// Shared Tauri state handle.
pub type PgServiceState = Arc<Mutex<PgService>>;

/// Main PG admin service managing SSH connections.
pub struct PgService {
    connections: HashMap<String, PgClient>,
}

impl Default for PgService {
    fn default() -> Self {
        Self::new()
    }
}

impl PgService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: PgConnectionConfig,
    ) -> PgResult<PgConnectionSummary> {
        let client = PgClient::new(config)?;

        let version = client
            .exec_sql("SHOW server_version")
            .await
            .map(|v| v.trim().to_string())
            .unwrap_or_default();

        let uptime = client
            .exec_sql("SELECT now() - pg_postmaster_start_time()")
            .await
            .map(|v| v.trim().to_string())
            .unwrap_or_default();

        let databases_count = client
            .exec_sql("SELECT count(*) FROM pg_database WHERE datistemplate = false")
            .await
            .map(|v| v.trim().parse().unwrap_or(0))
            .unwrap_or(0);

        let roles_count = client
            .exec_sql("SELECT count(*) FROM pg_roles")
            .await
            .map(|v| v.trim().parse().unwrap_or(0))
            .unwrap_or(0);

        let cluster_size = client
            .exec_sql("SELECT pg_size_pretty(sum(pg_database_size(datname))) FROM pg_database")
            .await
            .map(|v| v.trim().to_string())
            .unwrap_or_default();

        let summary = PgConnectionSummary {
            host: client.config.host.clone(),
            version,
            uptime,
            databases_count,
            roles_count,
            cluster_size,
        };

        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> PgResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| PgError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PgResult<&PgClient> {
        self.connections
            .get(id)
            .ok_or_else(|| PgError::not_connected(format!("No connection '{}'", id)))
    }

    // ── Roles ────────────────────────────────────────────────────

    pub async fn list_roles(&self, id: &str) -> PgResult<Vec<PgRole>> {
        RoleManager::list(self.client(id)?).await
    }

    pub async fn get_role(&self, id: &str, name: &str) -> PgResult<PgRole> {
        RoleManager::get(self.client(id)?, name).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_role(
        &self,
        id: &str,
        name: &str,
        password: Option<&str>,
        superuser: bool,
        createdb: bool,
        createrole: bool,
        login: bool,
        replication: bool,
        connection_limit: Option<i32>,
    ) -> PgResult<()> {
        RoleManager::create(
            self.client(id)?,
            name,
            password,
            superuser,
            createdb,
            createrole,
            login,
            replication,
            connection_limit,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn alter_role(
        &self,
        id: &str,
        name: &str,
        superuser: Option<bool>,
        createdb: Option<bool>,
        createrole: Option<bool>,
        login: Option<bool>,
        replication: Option<bool>,
        connection_limit: Option<i32>,
    ) -> PgResult<()> {
        RoleManager::alter(
            self.client(id)?,
            name,
            superuser,
            createdb,
            createrole,
            login,
            replication,
            connection_limit,
        )
        .await
    }

    pub async fn drop_role(&self, id: &str, name: &str) -> PgResult<()> {
        RoleManager::drop(self.client(id)?, name).await
    }

    pub async fn rename_role(&self, id: &str, old_name: &str, new_name: &str) -> PgResult<()> {
        RoleManager::rename(self.client(id)?, old_name, new_name).await
    }

    pub async fn grant_role(&self, id: &str, role: &str, member: &str) -> PgResult<()> {
        RoleManager::grant_role(self.client(id)?, role, member).await
    }

    pub async fn revoke_role(&self, id: &str, role: &str, member: &str) -> PgResult<()> {
        RoleManager::revoke_role(self.client(id)?, role, member).await
    }

    pub async fn set_role_password(
        &self,
        id: &str,
        name: &str,
        password: &str,
        valid_until: Option<&str>,
    ) -> PgResult<()> {
        RoleManager::set_password(self.client(id)?, name, password, valid_until).await
    }

    pub async fn list_role_memberships(&self, id: &str, name: &str) -> PgResult<Vec<String>> {
        RoleManager::list_role_memberships(self.client(id)?, name).await
    }

    // ── Databases ────────────────────────────────────────────────

    pub async fn list_databases(&self, id: &str) -> PgResult<Vec<PgDatabase>> {
        DatabaseManager::list(self.client(id)?).await
    }

    pub async fn get_database(&self, id: &str, name: &str) -> PgResult<PgDatabase> {
        DatabaseManager::get(self.client(id)?, name).await
    }

    pub async fn create_database(
        &self,
        id: &str,
        name: &str,
        owner: Option<&str>,
        encoding: Option<&str>,
        template: Option<&str>,
        tablespace: Option<&str>,
    ) -> PgResult<()> {
        DatabaseManager::create(
            self.client(id)?,
            name,
            owner,
            encoding,
            template,
            tablespace,
        )
        .await
    }

    pub async fn drop_database(&self, id: &str, name: &str) -> PgResult<()> {
        DatabaseManager::drop(self.client(id)?, name).await
    }

    pub async fn rename_database(&self, id: &str, old_name: &str, new_name: &str) -> PgResult<()> {
        DatabaseManager::rename(self.client(id)?, old_name, new_name).await
    }

    pub async fn alter_database_owner(&self, id: &str, db: &str, owner: &str) -> PgResult<()> {
        DatabaseManager::alter_owner(self.client(id)?, db, owner).await
    }

    pub async fn get_database_size(&self, id: &str, name: &str) -> PgResult<u64> {
        DatabaseManager::get_size(self.client(id)?, name).await
    }

    pub async fn get_database_connections(&self, id: &str, name: &str) -> PgResult<u64> {
        DatabaseManager::get_connections(self.client(id)?, name).await
    }

    pub async fn terminate_database_connections(&self, id: &str, name: &str) -> PgResult<()> {
        DatabaseManager::terminate_connections(self.client(id)?, name).await
    }

    pub async fn list_database_schemas(&self, id: &str, db: &str) -> PgResult<Vec<PgSchema>> {
        DatabaseManager::list_schemas(self.client(id)?, db).await
    }

    // ── pg_hba.conf ──────────────────────────────────────────────

    pub async fn list_hba(&self, id: &str) -> PgResult<Vec<PgHbaEntry>> {
        HbaManager::list(self.client(id)?).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn add_hba(
        &self,
        id: &str,
        entry_type: &str,
        database: &str,
        user: &str,
        address: Option<&str>,
        method: &str,
        options: Option<&str>,
    ) -> PgResult<()> {
        HbaManager::add(
            self.client(id)?,
            entry_type,
            database,
            user,
            address,
            method,
            options,
        )
        .await
    }

    pub async fn remove_hba(&self, id: &str, line_number: u32) -> PgResult<()> {
        HbaManager::remove(self.client(id)?, line_number).await
    }

    pub async fn update_hba(&self, id: &str, line_number: u32, entry: &PgHbaEntry) -> PgResult<()> {
        HbaManager::update(self.client(id)?, line_number, entry).await
    }

    pub async fn reload_hba(&self, id: &str) -> PgResult<()> {
        HbaManager::reload(self.client(id)?).await
    }

    pub async fn get_hba_raw(&self, id: &str) -> PgResult<String> {
        HbaManager::get_raw(self.client(id)?).await
    }

    pub async fn set_hba_raw(&self, id: &str, content: &str) -> PgResult<()> {
        HbaManager::set_raw(self.client(id)?, content).await
    }

    pub async fn validate_hba(&self, id: &str) -> PgResult<bool> {
        HbaManager::validate(self.client(id)?).await
    }

    // ── Replication ──────────────────────────────────────────────

    pub async fn get_replication_status(&self, id: &str) -> PgResult<Vec<PgReplicationStat>> {
        ReplicationManager::get_status(self.client(id)?).await
    }

    pub async fn list_replication_slots(&self, id: &str) -> PgResult<Vec<PgReplicationSlot>> {
        ReplicationManager::list_slots(self.client(id)?).await
    }

    pub async fn create_replication_slot(
        &self,
        id: &str,
        name: &str,
        plugin: Option<&str>,
    ) -> PgResult<()> {
        ReplicationManager::create_slot(self.client(id)?, name, plugin).await
    }

    pub async fn drop_replication_slot(&self, id: &str, name: &str) -> PgResult<()> {
        ReplicationManager::drop_slot(self.client(id)?, name).await
    }

    pub async fn create_physical_replication_slot(&self, id: &str, name: &str) -> PgResult<()> {
        ReplicationManager::create_physical_slot(self.client(id)?, name).await
    }

    pub async fn create_logical_replication_slot(
        &self,
        id: &str,
        name: &str,
        plugin: &str,
    ) -> PgResult<()> {
        ReplicationManager::create_logical_slot(self.client(id)?, name, plugin).await
    }

    pub async fn get_wal_receiver_status(&self, id: &str) -> PgResult<String> {
        ReplicationManager::get_wal_receiver_status(self.client(id)?).await
    }

    pub async fn promote_standby(&self, id: &str) -> PgResult<()> {
        ReplicationManager::promote_standby(self.client(id)?).await
    }

    pub async fn get_replication_lag(&self, id: &str) -> PgResult<String> {
        ReplicationManager::get_lag(self.client(id)?).await
    }

    // ── Vacuum / Analyze ─────────────────────────────────────────

    pub async fn get_vacuum_stats(&self, id: &str, db: &str) -> PgResult<Vec<PgVacuumInfo>> {
        VacuumManager::get_stats(self.client(id)?, db).await
    }

    pub async fn vacuum_table(
        &self,
        id: &str,
        db: &str,
        table: &str,
        full: bool,
        analyze: bool,
        verbose: bool,
    ) -> PgResult<()> {
        VacuumManager::vacuum(self.client(id)?, db, table, full, analyze, verbose).await
    }

    pub async fn vacuum_database(
        &self,
        id: &str,
        db: &str,
        full: bool,
        analyze: bool,
    ) -> PgResult<()> {
        VacuumManager::vacuum_database(self.client(id)?, db, full, analyze).await
    }

    pub async fn analyze_table(&self, id: &str, db: &str, table: Option<&str>) -> PgResult<()> {
        VacuumManager::analyze(self.client(id)?, db, table).await
    }

    pub async fn reindex(&self, id: &str, db: &str, table_or_index: &str) -> PgResult<()> {
        VacuumManager::reindex(self.client(id)?, db, table_or_index).await
    }

    pub async fn get_bloat(&self, id: &str, db: &str) -> PgResult<Vec<PgVacuumInfo>> {
        VacuumManager::get_bloat(self.client(id)?, db).await
    }

    pub async fn get_autovacuum_config(&self, id: &str) -> PgResult<Vec<PgSetting>> {
        VacuumManager::get_autovacuum_config(self.client(id)?).await
    }

    pub async fn set_autovacuum_config(
        &self,
        id: &str,
        setting: &str,
        value: &str,
    ) -> PgResult<()> {
        VacuumManager::set_autovacuum_config(self.client(id)?, setting, value).await
    }

    // ── Extensions ───────────────────────────────────────────────

    pub async fn list_available_extensions(&self, id: &str) -> PgResult<Vec<PgExtension>> {
        ExtensionManager::list_available(self.client(id)?).await
    }

    pub async fn list_installed_extensions(
        &self,
        id: &str,
        db: &str,
    ) -> PgResult<Vec<PgExtension>> {
        ExtensionManager::list_installed(self.client(id)?, db).await
    }

    pub async fn install_extension(
        &self,
        id: &str,
        db: &str,
        name: &str,
        schema: Option<&str>,
    ) -> PgResult<()> {
        ExtensionManager::install(self.client(id)?, db, name, schema).await
    }

    pub async fn uninstall_extension(
        &self,
        id: &str,
        db: &str,
        name: &str,
        cascade: bool,
    ) -> PgResult<()> {
        ExtensionManager::uninstall(self.client(id)?, db, name, cascade).await
    }

    pub async fn update_extension(
        &self,
        id: &str,
        db: &str,
        name: &str,
        version: Option<&str>,
    ) -> PgResult<()> {
        ExtensionManager::update(self.client(id)?, db, name, version).await
    }

    pub async fn get_extension(&self, id: &str, db: &str, name: &str) -> PgResult<PgExtension> {
        ExtensionManager::get(self.client(id)?, db, name).await
    }

    // ── Stats / Settings ─────────────────────────────────────────

    pub async fn get_database_stats(&self, id: &str) -> PgResult<Vec<PgStatDatabase>> {
        StatsManager::get_database_stats(self.client(id)?).await
    }

    pub async fn get_table_stats(
        &self,
        id: &str,
        db: &str,
        schema: Option<&str>,
    ) -> PgResult<Vec<PgStatTable>> {
        StatsManager::get_table_stats(self.client(id)?, db, schema).await
    }

    pub async fn get_index_stats(
        &self,
        id: &str,
        db: &str,
        schema: Option<&str>,
    ) -> PgResult<Vec<PgIndex>> {
        StatsManager::get_index_stats(self.client(id)?, db, schema).await
    }

    pub async fn get_locks(&self, id: &str) -> PgResult<Vec<PgLock>> {
        StatsManager::get_locks(self.client(id)?).await
    }

    pub async fn get_activity(&self, id: &str) -> PgResult<Vec<PgActivity>> {
        StatsManager::get_activity(self.client(id)?).await
    }

    pub async fn get_settings(&self, id: &str) -> PgResult<Vec<PgSetting>> {
        StatsManager::get_settings(self.client(id)?).await
    }

    pub async fn get_setting(&self, id: &str, name: &str) -> PgResult<PgSetting> {
        StatsManager::get_setting(self.client(id)?, name).await
    }

    pub async fn set_setting(&self, id: &str, name: &str, value: &str) -> PgResult<()> {
        StatsManager::set_setting(self.client(id)?, name, value).await
    }

    pub async fn reload_config(&self, id: &str) -> PgResult<()> {
        StatsManager::reload_config(self.client(id)?).await
    }

    pub async fn reset_stats(&self, id: &str, db: &str) -> PgResult<()> {
        StatsManager::reset_stats(self.client(id)?, db).await
    }

    // ── WAL ──────────────────────────────────────────────────────

    pub async fn get_wal_info(&self, id: &str) -> PgResult<PgWalInfo> {
        WalManager::get_info(self.client(id)?).await
    }

    pub async fn get_current_lsn(&self, id: &str) -> PgResult<String> {
        WalManager::get_current_lsn(self.client(id)?).await
    }

    pub async fn switch_wal(&self, id: &str) -> PgResult<()> {
        WalManager::switch_xlog(self.client(id)?).await
    }

    pub async fn get_archive_status(&self, id: &str) -> PgResult<String> {
        WalManager::get_archive_status(self.client(id)?).await
    }

    pub async fn list_wal_files(&self, id: &str) -> PgResult<Vec<String>> {
        WalManager::list_wal_files(self.client(id)?).await
    }

    pub async fn get_wal_size(&self, id: &str) -> PgResult<u64> {
        WalManager::get_wal_size(self.client(id)?).await
    }

    pub async fn checkpoint(&self, id: &str) -> PgResult<()> {
        WalManager::checkpoint(self.client(id)?).await
    }

    // ── Tablespaces ──────────────────────────────────────────────

    pub async fn list_tablespaces(&self, id: &str) -> PgResult<Vec<PgTablespace>> {
        TablespaceManager::list(self.client(id)?).await
    }

    pub async fn get_tablespace(&self, id: &str, name: &str) -> PgResult<PgTablespace> {
        TablespaceManager::get(self.client(id)?, name).await
    }

    pub async fn create_tablespace(
        &self,
        id: &str,
        name: &str,
        location: &str,
        owner: Option<&str>,
    ) -> PgResult<()> {
        TablespaceManager::create(self.client(id)?, name, location, owner).await
    }

    pub async fn drop_tablespace(&self, id: &str, name: &str) -> PgResult<()> {
        TablespaceManager::drop(self.client(id)?, name).await
    }

    pub async fn rename_tablespace(
        &self,
        id: &str,
        old_name: &str,
        new_name: &str,
    ) -> PgResult<()> {
        TablespaceManager::rename(self.client(id)?, old_name, new_name).await
    }

    pub async fn alter_tablespace_owner(&self, id: &str, name: &str, owner: &str) -> PgResult<()> {
        TablespaceManager::alter_owner(self.client(id)?, name, owner).await
    }

    pub async fn get_tablespace_size(&self, id: &str, name: &str) -> PgResult<u64> {
        TablespaceManager::get_size(self.client(id)?, name).await
    }

    pub async fn list_tablespace_objects(&self, id: &str, name: &str) -> PgResult<Vec<String>> {
        TablespaceManager::list_objects(self.client(id)?, name).await
    }

    // ── Schemas ──────────────────────────────────────────────────

    pub async fn list_schemas(&self, id: &str, db: &str) -> PgResult<Vec<PgSchema>> {
        SchemaManager::list(self.client(id)?, db).await
    }

    pub async fn get_schema(&self, id: &str, db: &str, name: &str) -> PgResult<PgSchema> {
        SchemaManager::get(self.client(id)?, db, name).await
    }

    pub async fn create_schema(
        &self,
        id: &str,
        db: &str,
        name: &str,
        owner: Option<&str>,
    ) -> PgResult<()> {
        SchemaManager::create(self.client(id)?, db, name, owner).await
    }

    pub async fn drop_schema(&self, id: &str, db: &str, name: &str, cascade: bool) -> PgResult<()> {
        SchemaManager::drop(self.client(id)?, db, name, cascade).await
    }

    pub async fn rename_schema(
        &self,
        id: &str,
        db: &str,
        old_name: &str,
        new_name: &str,
    ) -> PgResult<()> {
        SchemaManager::rename(self.client(id)?, db, old_name, new_name).await
    }

    pub async fn alter_schema_owner(
        &self,
        id: &str,
        db: &str,
        name: &str,
        owner: &str,
    ) -> PgResult<()> {
        SchemaManager::alter_owner(self.client(id)?, db, name, owner).await
    }

    pub async fn grant_schema(
        &self,
        id: &str,
        db: &str,
        schema: &str,
        role: &str,
        privileges: &str,
    ) -> PgResult<()> {
        SchemaManager::grant(self.client(id)?, db, schema, role, privileges).await
    }

    pub async fn revoke_schema(
        &self,
        id: &str,
        db: &str,
        schema: &str,
        role: &str,
        privileges: &str,
    ) -> PgResult<()> {
        SchemaManager::revoke(self.client(id)?, db, schema, role, privileges).await
    }

    pub async fn list_schema_tables(
        &self,
        id: &str,
        db: &str,
        schema: &str,
    ) -> PgResult<Vec<String>> {
        SchemaManager::list_tables(self.client(id)?, db, schema).await
    }

    pub async fn list_schema_views(
        &self,
        id: &str,
        db: &str,
        schema: &str,
    ) -> PgResult<Vec<String>> {
        SchemaManager::list_views(self.client(id)?, db, schema).await
    }

    pub async fn list_schema_functions(
        &self,
        id: &str,
        db: &str,
        schema: &str,
    ) -> PgResult<Vec<String>> {
        SchemaManager::list_functions(self.client(id)?, db, schema).await
    }

    // ── Backup ───────────────────────────────────────────────────

    pub async fn pg_dump(&self, id: &str, config: &PgBackupConfig) -> PgResult<PgBackupResult> {
        BackupManager::pg_dump(self.client(id)?, config).await
    }

    pub async fn pg_restore(
        &self,
        id: &str,
        db: &str,
        path: &str,
        format: Option<&str>,
    ) -> PgResult<()> {
        BackupManager::pg_restore(self.client(id)?, db, path, format).await
    }

    pub async fn pg_dumpall(&self, id: &str, path: &str) -> PgResult<PgBackupResult> {
        BackupManager::pg_dumpall(self.client(id)?, path).await
    }

    pub async fn pg_basebackup(
        &self,
        id: &str,
        path: &str,
        format: Option<&str>,
        checkpoint: Option<&str>,
    ) -> PgResult<PgBackupResult> {
        BackupManager::pg_basebackup(self.client(id)?, path, format, checkpoint).await
    }

    pub async fn list_backup_files(&self, id: &str, dir: &str) -> PgResult<Vec<String>> {
        BackupManager::list_backup_files(self.client(id)?, dir).await
    }

    pub async fn verify_backup(&self, id: &str, path: &str) -> PgResult<bool> {
        BackupManager::verify_backup(self.client(id)?, path).await
    }

    pub async fn get_backup_size(&self, id: &str, path: &str) -> PgResult<u64> {
        BackupManager::get_backup_size(self.client(id)?, path).await
    }
}
