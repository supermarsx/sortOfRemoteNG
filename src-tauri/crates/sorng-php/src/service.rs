// ── sorng-php/src/service.rs ─────────────────────────────────────────────────
//! Aggregate PHP façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::{validate_php_version, PhpClient};
use crate::error::{PhpError, PhpResult};
use crate::types::*;

use crate::composer::ComposerManager;
use crate::fpm::FpmManager;
use crate::ini::IniManager;
use crate::logs::LogManager;
use crate::modules::ModuleManager;
use crate::opcache::OpcacheManager;
use crate::process::ProcessManager;
use crate::sessions::SessionManager;
use crate::versions::VersionManager;

/// Shared Tauri state handle.
pub type PhpServiceState = Arc<Mutex<PhpService>>;

/// Main PHP service managing connections.
pub struct PhpService {
    connections: HashMap<String, PhpClient>,
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use crate::error::PhpErrorKind;

    fn config() -> PhpConnectionConfig {
        PhpConnectionConfig {
            host: "php.example.test".into(),
            port: Some(22),
            ssh_user: Some("admin".into()),
            ssh_password: None,
            ssh_key: None,
            php_bin: None,
            fpm_bin: None,
            composer_bin: None,
            config_dir: None,
            fpm_pool_dir: None,
            timeout_secs: Some(5),
        }
    }

    #[tokio::test]
    async fn duplicate_connection_id_is_rejected_before_remote_probe() {
        let mut service = PhpService::new();
        service
            .connections
            .insert("duplicate".into(), PhpClient::new(config()).unwrap());

        let error = service
            .connect("duplicate".into(), config())
            .await
            .unwrap_err();

        assert!(matches!(error.kind, PhpErrorKind::AlreadyConnected));
    }
}

impl Default for PhpService {
    fn default() -> Self {
        Self::new()
    }
}

impl PhpService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: PhpConnectionConfig,
    ) -> PhpResult<PhpConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(PhpError::already_connected(&id));
        }
        let client = PhpClient::new(config)?;
        let probe = client.exec_ssh("true").await?;
        if probe.exit_code != 0 {
            return Err(PhpError::ssh(format!(
                "SSH probe failed with exit code {}: {}",
                probe.exit_code,
                probe.stderr.trim()
            )));
        }

        let versions = VersionManager::list(&client).await?;
        if versions.is_empty() {
            return Err(PhpError::connection(
                "No PHP installation was discovered on the remote host",
            ));
        }
        let default_version = versions
            .iter()
            .find(|version| version.is_default)
            .map(|version| version.version.clone());
        let default_has_fpm = versions
            .iter()
            .find(|version| version.is_default)
            .is_some_and(|version| version.sapis.iter().any(|sapi| sapi == "fpm"));
        let installed_versions = versions
            .into_iter()
            .map(|version| version.version)
            .collect();

        let fpm_running = if default_has_fpm {
            let ver = default_version
                .as_deref()
                .expect("default FPM version must have a default version");
            ProcessManager::get_service_status(&client, ver)
                .await
                .map(|status| status.active)?
        } else {
            false
        };

        let summary = PhpConnectionSummary {
            host: client.config.host.clone(),
            default_version,
            installed_versions,
            fpm_running,
            config_dir: client.config_dir().to_string(),
        };

        self.connections.insert(id, client);
        Ok(summary)
    }

    pub async fn disconnect(&mut self, id: &str) -> PhpResult<()> {
        let client = self
            .connections
            .get(id)
            .ok_or_else(|| PhpError::not_connected(format!("No connection '{}'", id)))?;
        client.disconnect().await?;
        self.connections.remove(id);
        Ok(())
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PhpResult<&PhpClient> {
        self.connections
            .get(id)
            .ok_or_else(|| PhpError::not_connected(format!("No connection '{}'", id)))
    }

    fn version_client(&self, id: &str, version: &str) -> PhpResult<&PhpClient> {
        validate_php_version(version)?;
        self.client(id)
    }

    // ── Versions ─────────────────────────────────────────────────

    pub async fn list_versions(&self, id: &str) -> PhpResult<Vec<PhpVersion>> {
        VersionManager::list(self.client(id)?).await
    }

    pub async fn get_default_version(&self, id: &str) -> PhpResult<PhpVersion> {
        VersionManager::get_default(self.client(id)?).await
    }

    pub async fn get_version_detail(&self, id: &str, version: &str) -> PhpResult<PhpVersionDetail> {
        VersionManager::get_detail(self.version_client(id, version)?, version).await
    }

    pub async fn set_default_version(&self, id: &str, version: &str) -> PhpResult<()> {
        VersionManager::set_default(self.version_client(id, version)?, version).await
    }

    pub async fn list_sapis(&self, id: &str, version: &str) -> PhpResult<Vec<PhpSapi>> {
        VersionManager::list_sapis(self.version_client(id, version)?, version).await
    }

    pub async fn get_config_path(&self, id: &str, version: &str, sapi: &str) -> PhpResult<String> {
        VersionManager::get_config_path(self.version_client(id, version)?, version, sapi).await
    }

    pub async fn get_extension_dir(&self, id: &str, version: &str) -> PhpResult<String> {
        VersionManager::get_extension_dir(self.version_client(id, version)?, version).await
    }

    pub async fn check_version_installed(&self, id: &str, version: &str) -> PhpResult<bool> {
        VersionManager::check_version_installed(self.version_client(id, version)?, version).await
    }

    // ── FPM Pools ────────────────────────────────────────────────

    pub async fn list_fpm_pools(&self, id: &str, version: &str) -> PhpResult<Vec<PhpFpmPool>> {
        FpmManager::list_pools(self.version_client(id, version)?, version).await
    }

    pub async fn get_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<PhpFpmPool> {
        FpmManager::get_pool(self.version_client(id, version)?, version, name).await
    }

    pub async fn create_fpm_pool(
        &self,
        id: &str,
        req: &CreateFpmPoolRequest,
    ) -> PhpResult<PhpFpmPool> {
        FpmManager::create_pool(self.version_client(id, &req.version)?, req).await
    }

    pub async fn update_fpm_pool(
        &self,
        id: &str,
        version: &str,
        name: &str,
        req: &UpdateFpmPoolRequest,
    ) -> PhpResult<PhpFpmPool> {
        FpmManager::update_pool(self.version_client(id, version)?, version, name, req).await
    }

    pub async fn delete_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<()> {
        FpmManager::delete_pool(self.version_client(id, version)?, version, name).await
    }

    pub async fn enable_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<()> {
        FpmManager::enable_pool(self.version_client(id, version)?, version, name).await
    }

    pub async fn disable_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<()> {
        FpmManager::disable_pool(self.version_client(id, version)?, version, name).await
    }

    pub async fn get_fpm_pool_status(
        &self,
        id: &str,
        version: &str,
        name: &str,
    ) -> PhpResult<PhpFpmPoolStatus> {
        FpmManager::get_pool_status(self.version_client(id, version)?, version, name).await
    }

    pub async fn list_fpm_pool_processes(
        &self,
        id: &str,
        version: &str,
        name: &str,
    ) -> PhpResult<Vec<FpmWorkerProcess>> {
        FpmManager::list_pool_processes(self.version_client(id, version)?, version, name).await
    }

    // ── INI ──────────────────────────────────────────────────────

    pub async fn get_ini_file(&self, id: &str, version: &str, sapi: &str) -> PhpResult<PhpIniFile> {
        IniManager::get_ini_file(self.version_client(id, version)?, version, sapi).await
    }

    pub async fn list_ini_directives(
        &self,
        id: &str,
        version: &str,
        sapi: &str,
    ) -> PhpResult<Vec<PhpIniDirective>> {
        IniManager::list_directives(self.version_client(id, version)?, version, sapi).await
    }

    pub async fn get_ini_directive(
        &self,
        id: &str,
        version: &str,
        sapi: &str,
        key: &str,
    ) -> PhpResult<PhpIniDirective> {
        IniManager::get_directive(self.version_client(id, version)?, version, sapi, key).await
    }

    pub async fn set_ini_directive(&self, id: &str, req: &SetIniDirectiveRequest) -> PhpResult<()> {
        IniManager::set_directive(self.version_client(id, &req.version)?, req).await
    }

    pub async fn remove_ini_directive(
        &self,
        id: &str,
        version: &str,
        sapi: &str,
        key: &str,
    ) -> PhpResult<()> {
        IniManager::remove_directive(self.version_client(id, version)?, version, sapi, key).await
    }

    pub async fn get_ini_scan_dir(
        &self,
        id: &str,
        version: &str,
        sapi: &str,
    ) -> PhpResult<PhpIniScanDir> {
        IniManager::get_scan_dir(self.version_client(id, version)?, version, sapi).await
    }

    pub async fn list_loaded_ini_files(&self, id: &str, version: &str) -> PhpResult<Vec<String>> {
        IniManager::list_loaded_ini_files(self.version_client(id, version)?, version).await
    }

    pub async fn backup_ini(&self, id: &str, version: &str, sapi: &str) -> PhpResult<IniBackup> {
        IniManager::backup_ini(self.version_client(id, version)?, version, sapi).await
    }

    pub async fn restore_ini(
        &self,
        id: &str,
        backup_path: &str,
        target_path: &str,
    ) -> PhpResult<()> {
        IniManager::restore_ini(self.client(id)?, backup_path, target_path).await
    }

    pub async fn validate_ini(&self, id: &str, version: &str) -> PhpResult<bool> {
        IniManager::validate_ini(self.version_client(id, version)?, version).await
    }

    // ── Modules ──────────────────────────────────────────────────

    pub async fn list_modules(&self, id: &str, version: &str) -> PhpResult<Vec<PhpModule>> {
        ModuleManager::list_modules(self.version_client(id, version)?, version).await
    }

    pub async fn get_module(&self, id: &str, version: &str, name: &str) -> PhpResult<PhpModule> {
        ModuleManager::get_module(self.version_client(id, version)?, version, name).await
    }

    pub async fn enable_module(&self, id: &str, req: &EnableModuleRequest) -> PhpResult<()> {
        ModuleManager::enable_module(self.version_client(id, &req.version)?, req).await
    }

    pub async fn disable_module(&self, id: &str, req: &DisableModuleRequest) -> PhpResult<()> {
        ModuleManager::disable_module(self.version_client(id, &req.version)?, req).await
    }

    pub async fn install_module(&self, id: &str, req: &InstallModuleRequest) -> PhpResult<()> {
        ModuleManager::install_module(self.version_client(id, &req.version)?, req).await
    }

    pub async fn uninstall_module(
        &self,
        id: &str,
        version: &str,
        module_name: &str,
    ) -> PhpResult<()> {
        ModuleManager::uninstall_module(self.version_client(id, version)?, version, module_name)
            .await
    }

    pub async fn is_module_loaded(&self, id: &str, version: &str, name: &str) -> PhpResult<bool> {
        ModuleManager::is_module_loaded(self.version_client(id, version)?, version, name).await
    }

    pub async fn list_available_modules(&self, id: &str, version: &str) -> PhpResult<Vec<String>> {
        ModuleManager::list_available_modules(self.version_client(id, version)?, version).await
    }

    pub async fn list_pecl_packages(&self, id: &str) -> PhpResult<Vec<PeclPackage>> {
        ModuleManager::list_pecl_packages(self.client(id)?).await
    }

    pub async fn install_pecl_package(
        &self,
        id: &str,
        name: &str,
        version: Option<&str>,
    ) -> PhpResult<()> {
        ModuleManager::install_pecl_package(self.client(id)?, name, version).await
    }

    pub async fn uninstall_pecl_package(&self, id: &str, name: &str) -> PhpResult<()> {
        ModuleManager::uninstall_pecl_package(self.client(id)?, name).await
    }

    // ── OPcache ──────────────────────────────────────────────────

    pub async fn get_opcache_status(&self, id: &str, version: &str) -> PhpResult<OpcacheStatus> {
        OpcacheManager::get_status(self.version_client(id, version)?, version).await
    }

    pub async fn get_opcache_config(&self, id: &str, version: &str) -> PhpResult<OpcacheConfig> {
        OpcacheManager::get_config(self.version_client(id, version)?, version).await
    }

    pub async fn reset_opcache(&self, id: &str, version: &str) -> PhpResult<()> {
        OpcacheManager::reset(self.version_client(id, version)?, version).await
    }

    pub async fn list_cached_scripts(
        &self,
        id: &str,
        version: &str,
    ) -> PhpResult<Vec<CachedScript>> {
        OpcacheManager::list_cached_scripts(self.version_client(id, version)?, version).await
    }

    pub async fn invalidate_cached_script(
        &self,
        id: &str,
        version: &str,
        path: &str,
    ) -> PhpResult<()> {
        OpcacheManager::invalidate_script(self.version_client(id, version)?, version, path).await
    }

    pub async fn is_opcache_enabled(&self, id: &str, version: &str) -> PhpResult<bool> {
        OpcacheManager::is_enabled(self.version_client(id, version)?, version).await
    }

    pub async fn update_opcache_config(
        &self,
        id: &str,
        version: &str,
        config: &OpcacheConfig,
    ) -> PhpResult<()> {
        OpcacheManager::update_config(self.version_client(id, version)?, version, config).await
    }

    // ── Sessions ─────────────────────────────────────────────────

    pub async fn get_session_config(&self, id: &str, version: &str) -> PhpResult<PhpSessionConfig> {
        SessionManager::get_config(self.version_client(id, version)?, version).await
    }

    pub async fn update_session_config(
        &self,
        id: &str,
        req: &UpdateSessionConfigRequest,
    ) -> PhpResult<()> {
        SessionManager::update_config(self.version_client(id, &req.version)?, req).await
    }

    pub async fn get_session_stats(&self, id: &str, version: &str) -> PhpResult<SessionStats> {
        SessionManager::get_stats(self.version_client(id, version)?, version).await
    }

    pub async fn cleanup_sessions(
        &self,
        id: &str,
        version: &str,
        max_age_secs: Option<u64>,
    ) -> PhpResult<u64> {
        SessionManager::cleanup_sessions(self.version_client(id, version)?, version, max_age_secs)
            .await
    }

    pub async fn list_session_files(&self, id: &str, version: &str) -> PhpResult<Vec<String>> {
        SessionManager::list_session_files(self.version_client(id, version)?, version).await
    }

    pub async fn get_session_save_path(&self, id: &str, version: &str) -> PhpResult<String> {
        SessionManager::get_save_path(self.version_client(id, version)?, version).await
    }

    // ── Composer ─────────────────────────────────────────────────

    pub async fn get_composer_info(&self, id: &str) -> PhpResult<ComposerInfo> {
        ComposerManager::get_info(self.client(id)?).await
    }

    pub async fn is_composer_installed(&self, id: &str) -> PhpResult<bool> {
        ComposerManager::is_installed(self.client(id)?).await
    }

    pub async fn list_composer_global_packages(
        &self,
        id: &str,
    ) -> PhpResult<Vec<ComposerGlobalPackage>> {
        ComposerManager::list_global_packages(self.client(id)?).await
    }

    pub async fn install_composer_global_package(
        &self,
        id: &str,
        package: &str,
        version: Option<&str>,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::install_global_package(self.client(id)?, package, version).await
    }

    pub async fn remove_composer_global_package(
        &self,
        id: &str,
        package: &str,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::remove_global_package(self.client(id)?, package).await
    }

    pub async fn get_composer_project(
        &self,
        id: &str,
        project_path: &str,
    ) -> PhpResult<ComposerProject> {
        ComposerManager::get_project(self.client(id)?, project_path).await
    }

    pub async fn composer_install(
        &self,
        id: &str,
        req: &ComposerInstallRequest,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::install(self.client(id)?, req).await
    }

    pub async fn composer_update(
        &self,
        id: &str,
        req: &ComposerUpdateRequest,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::update(self.client(id)?, req).await
    }

    pub async fn composer_require(
        &self,
        id: &str,
        req: &RequirePackageRequest,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::require_package(self.client(id)?, req).await
    }

    pub async fn composer_remove(
        &self,
        id: &str,
        req: &RemovePackageRequest,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::remove_package(self.client(id)?, req).await
    }

    pub async fn composer_dump_autoload(
        &self,
        id: &str,
        project_path: &str,
        optimize: bool,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::dump_autoload(self.client(id)?, project_path, optimize).await
    }

    pub async fn composer_validate(
        &self,
        id: &str,
        project_path: &str,
    ) -> PhpResult<ComposerRunResult> {
        ComposerManager::validate(self.client(id)?, project_path).await
    }

    pub async fn composer_outdated(
        &self,
        id: &str,
        project_path: &str,
    ) -> PhpResult<Vec<ComposerPackage>> {
        ComposerManager::outdated(self.client(id)?, project_path).await
    }

    pub async fn composer_clear_cache(&self, id: &str) -> PhpResult<()> {
        ComposerManager::clear_cache(self.client(id)?).await
    }

    pub async fn composer_self_update(&self, id: &str) -> PhpResult<ComposerRunResult> {
        ComposerManager::self_update(self.client(id)?).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn read_php_log(
        &self,
        id: &str,
        req: &PhpLogReadRequest,
    ) -> PhpResult<Vec<PhpLogEntry>> {
        LogManager::read_log(self.client(id)?, req).await
    }

    pub async fn get_log_config(&self, id: &str, version: &str) -> PhpResult<PhpLogConfig> {
        LogManager::get_log_config(self.version_client(id, version)?, version).await
    }

    pub async fn get_fpm_log_config(&self, id: &str, version: &str) -> PhpResult<FpmLogConfig> {
        LogManager::get_fpm_log_config(self.version_client(id, version)?, version).await
    }

    pub async fn get_log_path(&self, id: &str, version: &str) -> PhpResult<String> {
        LogManager::get_log_path(self.version_client(id, version)?, version).await
    }

    pub async fn get_fpm_log_path(&self, id: &str, version: &str) -> PhpResult<String> {
        LogManager::get_fpm_log_path(self.version_client(id, version)?, version).await
    }

    pub async fn clear_log(&self, id: &str, log_path: &str) -> PhpResult<()> {
        LogManager::clear_log(self.client(id)?, log_path).await
    }

    pub async fn tail_log(&self, id: &str, log_path: &str, lines: u32) -> PhpResult<String> {
        LogManager::tail_log(self.client(id)?, log_path, lines).await
    }

    pub async fn get_log_size(&self, id: &str, log_path: &str) -> PhpResult<u64> {
        LogManager::get_log_size(self.client(id)?, log_path).await
    }

    pub async fn rotate_log(&self, id: &str, log_path: &str) -> PhpResult<()> {
        LogManager::rotate_log(self.client(id)?, log_path).await
    }

    // ── Process ──────────────────────────────────────────────────

    pub async fn get_fpm_service_status(
        &self,
        id: &str,
        version: &str,
    ) -> PhpResult<PhpFpmServiceStatus> {
        ProcessManager::get_service_status(self.version_client(id, version)?, version).await
    }

    pub async fn start_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::start(self.version_client(id, version)?, version).await
    }

    pub async fn stop_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::stop(self.version_client(id, version)?, version).await
    }

    pub async fn restart_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::restart(self.version_client(id, version)?, version).await
    }

    pub async fn reload_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::reload(self.version_client(id, version)?, version).await
    }

    pub async fn enable_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::enable(self.version_client(id, version)?, version).await
    }

    pub async fn disable_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::disable(self.version_client(id, version)?, version).await
    }

    pub async fn test_fpm_config(&self, id: &str, version: &str) -> PhpResult<ConfigTestResult> {
        ProcessManager::test_config(self.version_client(id, version)?, version).await
    }

    pub async fn get_fpm_master_process(
        &self,
        id: &str,
        version: &str,
    ) -> PhpResult<PhpFpmMasterProcess> {
        ProcessManager::get_master_process(self.version_client(id, version)?, version).await
    }

    pub async fn list_fpm_worker_pids(&self, id: &str, version: &str) -> PhpResult<Vec<u32>> {
        ProcessManager::list_worker_pids(self.version_client(id, version)?, version).await
    }

    pub async fn graceful_restart_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::graceful_restart(self.version_client(id, version)?, version).await
    }

    pub async fn reopen_fpm_logs(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::reopen_logs(self.version_client(id, version)?, version).await
    }

    pub async fn list_all_fpm_services(&self, id: &str) -> PhpResult<Vec<PhpFpmServiceStatus>> {
        ProcessManager::list_all_fpm_services(self.client(id)?).await
    }
}
