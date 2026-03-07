// ── sorng-php/src/service.rs ─────────────────────────────────────────────────
//! Aggregate PHP façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PhpClient;
use crate::error::{PhpError, PhpResult};
use crate::types::*;

use crate::versions::VersionManager;
use crate::fpm::FpmManager;
use crate::ini::IniManager;
use crate::modules::ModuleManager;
use crate::opcache::OpcacheManager;
use crate::sessions::SessionManager;
use crate::composer::ComposerManager;
use crate::logs::LogManager;
use crate::process::ProcessManager;

/// Shared Tauri state handle.
pub type PhpServiceState = Arc<Mutex<PhpService>>;

/// Main PHP service managing connections.
pub struct PhpService {
    connections: HashMap<String, PhpClient>,
}

impl PhpService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: PhpConnectionConfig) -> PhpResult<PhpConnectionSummary> {
        let client = PhpClient::new(config)?;

        let installed_versions = VersionManager::list(&client).await
            .map(|vs| vs.into_iter().map(|v| v.version).collect::<Vec<_>>())
            .unwrap_or_default();

        let default_version = VersionManager::get_default(&client).await
            .map(|v| Some(v.version))
            .unwrap_or(None);

        let fpm_running = if let Some(ref ver) = default_version {
            ProcessManager::get_service_status(&client, ver).await
                .map(|s| s.active)
                .unwrap_or(false)
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

    pub fn disconnect(&mut self, id: &str) -> PhpResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| PhpError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PhpResult<&PhpClient> {
        self.connections.get(id)
            .ok_or_else(|| PhpError::not_connected(format!("No connection '{}'", id)))
    }

    // ── Versions ─────────────────────────────────────────────────

    pub async fn list_versions(&self, id: &str) -> PhpResult<Vec<PhpVersion>> {
        VersionManager::list(self.client(id)?).await
    }

    pub async fn get_default_version(&self, id: &str) -> PhpResult<PhpVersion> {
        VersionManager::get_default(self.client(id)?).await
    }

    pub async fn get_version_detail(&self, id: &str, version: &str) -> PhpResult<PhpVersionDetail> {
        VersionManager::get_detail(self.client(id)?, version).await
    }

    pub async fn set_default_version(&self, id: &str, version: &str) -> PhpResult<()> {
        VersionManager::set_default(self.client(id)?, version).await
    }

    pub async fn list_sapis(&self, id: &str, version: &str) -> PhpResult<Vec<PhpSapi>> {
        VersionManager::list_sapis(self.client(id)?, version).await
    }

    pub async fn get_config_path(&self, id: &str, version: &str, sapi: &str) -> PhpResult<String> {
        VersionManager::get_config_path(self.client(id)?, version, sapi).await
    }

    pub async fn get_extension_dir(&self, id: &str, version: &str) -> PhpResult<String> {
        VersionManager::get_extension_dir(self.client(id)?, version).await
    }

    pub async fn check_version_installed(&self, id: &str, version: &str) -> PhpResult<bool> {
        VersionManager::check_version_installed(self.client(id)?, version).await
    }

    // ── FPM Pools ────────────────────────────────────────────────

    pub async fn list_fpm_pools(&self, id: &str, version: &str) -> PhpResult<Vec<PhpFpmPool>> {
        FpmManager::list_pools(self.client(id)?, version).await
    }

    pub async fn get_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<PhpFpmPool> {
        FpmManager::get_pool(self.client(id)?, version, name).await
    }

    pub async fn create_fpm_pool(&self, id: &str, req: &CreateFpmPoolRequest) -> PhpResult<PhpFpmPool> {
        FpmManager::create_pool(self.client(id)?, req).await
    }

    pub async fn update_fpm_pool(&self, id: &str, version: &str, name: &str, req: &UpdateFpmPoolRequest) -> PhpResult<PhpFpmPool> {
        FpmManager::update_pool(self.client(id)?, version, name, req).await
    }

    pub async fn delete_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<()> {
        FpmManager::delete_pool(self.client(id)?, version, name).await
    }

    pub async fn enable_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<()> {
        FpmManager::enable_pool(self.client(id)?, version, name).await
    }

    pub async fn disable_fpm_pool(&self, id: &str, version: &str, name: &str) -> PhpResult<()> {
        FpmManager::disable_pool(self.client(id)?, version, name).await
    }

    pub async fn get_fpm_pool_status(&self, id: &str, version: &str, name: &str) -> PhpResult<PhpFpmPoolStatus> {
        FpmManager::get_pool_status(self.client(id)?, version, name).await
    }

    pub async fn list_fpm_pool_processes(&self, id: &str, version: &str, name: &str) -> PhpResult<Vec<FpmWorkerProcess>> {
        FpmManager::list_pool_processes(self.client(id)?, version, name).await
    }

    // ── INI ──────────────────────────────────────────────────────

    pub async fn get_ini_file(&self, id: &str, version: &str, sapi: &str) -> PhpResult<PhpIniFile> {
        IniManager::get_ini_file(self.client(id)?, version, sapi).await
    }

    pub async fn list_ini_directives(&self, id: &str, version: &str, sapi: &str) -> PhpResult<Vec<PhpIniDirective>> {
        IniManager::list_directives(self.client(id)?, version, sapi).await
    }

    pub async fn get_ini_directive(&self, id: &str, version: &str, sapi: &str, key: &str) -> PhpResult<PhpIniDirective> {
        IniManager::get_directive(self.client(id)?, version, sapi, key).await
    }

    pub async fn set_ini_directive(&self, id: &str, req: &SetIniDirectiveRequest) -> PhpResult<()> {
        IniManager::set_directive(self.client(id)?, req).await
    }

    pub async fn remove_ini_directive(&self, id: &str, version: &str, sapi: &str, key: &str) -> PhpResult<()> {
        IniManager::remove_directive(self.client(id)?, version, sapi, key).await
    }

    pub async fn get_ini_scan_dir(&self, id: &str, version: &str, sapi: &str) -> PhpResult<PhpIniScanDir> {
        IniManager::get_scan_dir(self.client(id)?, version, sapi).await
    }

    pub async fn list_loaded_ini_files(&self, id: &str, version: &str) -> PhpResult<Vec<String>> {
        IniManager::list_loaded_ini_files(self.client(id)?, version).await
    }

    pub async fn backup_ini(&self, id: &str, version: &str, sapi: &str) -> PhpResult<IniBackup> {
        IniManager::backup_ini(self.client(id)?, version, sapi).await
    }

    pub async fn restore_ini(&self, id: &str, backup_path: &str, target_path: &str) -> PhpResult<()> {
        IniManager::restore_ini(self.client(id)?, backup_path, target_path).await
    }

    pub async fn validate_ini(&self, id: &str, version: &str) -> PhpResult<bool> {
        IniManager::validate_ini(self.client(id)?, version).await
    }

    // ── Modules ──────────────────────────────────────────────────

    pub async fn list_modules(&self, id: &str, version: &str) -> PhpResult<Vec<PhpModule>> {
        ModuleManager::list_modules(self.client(id)?, version).await
    }

    pub async fn get_module(&self, id: &str, version: &str, name: &str) -> PhpResult<PhpModule> {
        ModuleManager::get_module(self.client(id)?, version, name).await
    }

    pub async fn enable_module(&self, id: &str, req: &EnableModuleRequest) -> PhpResult<()> {
        ModuleManager::enable_module(self.client(id)?, req).await
    }

    pub async fn disable_module(&self, id: &str, req: &DisableModuleRequest) -> PhpResult<()> {
        ModuleManager::disable_module(self.client(id)?, req).await
    }

    pub async fn install_module(&self, id: &str, req: &InstallModuleRequest) -> PhpResult<()> {
        ModuleManager::install_module(self.client(id)?, req).await
    }

    pub async fn uninstall_module(&self, id: &str, version: &str, module_name: &str) -> PhpResult<()> {
        ModuleManager::uninstall_module(self.client(id)?, version, module_name).await
    }

    pub async fn is_module_loaded(&self, id: &str, version: &str, name: &str) -> PhpResult<bool> {
        ModuleManager::is_module_loaded(self.client(id)?, version, name).await
    }

    pub async fn list_available_modules(&self, id: &str, version: &str) -> PhpResult<Vec<String>> {
        ModuleManager::list_available_modules(self.client(id)?, version).await
    }

    pub async fn list_pecl_packages(&self, id: &str) -> PhpResult<Vec<PeclPackage>> {
        ModuleManager::list_pecl_packages(self.client(id)?).await
    }

    pub async fn install_pecl_package(&self, id: &str, name: &str, version: Option<&str>) -> PhpResult<()> {
        ModuleManager::install_pecl_package(self.client(id)?, name, version).await
    }

    pub async fn uninstall_pecl_package(&self, id: &str, name: &str) -> PhpResult<()> {
        ModuleManager::uninstall_pecl_package(self.client(id)?, name).await
    }

    // ── OPcache ──────────────────────────────────────────────────

    pub async fn get_opcache_status(&self, id: &str, version: &str) -> PhpResult<OpcacheStatus> {
        OpcacheManager::get_status(self.client(id)?, version).await
    }

    pub async fn get_opcache_config(&self, id: &str, version: &str) -> PhpResult<OpcacheConfig> {
        OpcacheManager::get_config(self.client(id)?, version).await
    }

    pub async fn reset_opcache(&self, id: &str, version: &str) -> PhpResult<()> {
        OpcacheManager::reset(self.client(id)?, version).await
    }

    pub async fn list_cached_scripts(&self, id: &str, version: &str) -> PhpResult<Vec<CachedScript>> {
        OpcacheManager::list_cached_scripts(self.client(id)?, version).await
    }

    pub async fn invalidate_cached_script(&self, id: &str, version: &str, path: &str) -> PhpResult<()> {
        OpcacheManager::invalidate_script(self.client(id)?, version, path).await
    }

    pub async fn is_opcache_enabled(&self, id: &str, version: &str) -> PhpResult<bool> {
        OpcacheManager::is_enabled(self.client(id)?, version).await
    }

    pub async fn update_opcache_config(&self, id: &str, version: &str, config: &OpcacheConfig) -> PhpResult<()> {
        OpcacheManager::update_config(self.client(id)?, version, config).await
    }

    // ── Sessions ─────────────────────────────────────────────────

    pub async fn get_session_config(&self, id: &str, version: &str) -> PhpResult<PhpSessionConfig> {
        SessionManager::get_config(self.client(id)?, version).await
    }

    pub async fn update_session_config(&self, id: &str, req: &UpdateSessionConfigRequest) -> PhpResult<()> {
        SessionManager::update_config(self.client(id)?, req).await
    }

    pub async fn get_session_stats(&self, id: &str, version: &str) -> PhpResult<SessionStats> {
        SessionManager::get_stats(self.client(id)?, version).await
    }

    pub async fn cleanup_sessions(&self, id: &str, version: &str, max_age_secs: Option<u64>) -> PhpResult<u64> {
        SessionManager::cleanup_sessions(self.client(id)?, version, max_age_secs).await
    }

    pub async fn list_session_files(&self, id: &str, version: &str) -> PhpResult<Vec<String>> {
        SessionManager::list_session_files(self.client(id)?, version).await
    }

    pub async fn get_session_save_path(&self, id: &str, version: &str) -> PhpResult<String> {
        SessionManager::get_save_path(self.client(id)?, version).await
    }

    // ── Composer ─────────────────────────────────────────────────

    pub async fn get_composer_info(&self, id: &str) -> PhpResult<ComposerInfo> {
        ComposerManager::get_info(self.client(id)?).await
    }

    pub async fn is_composer_installed(&self, id: &str) -> PhpResult<bool> {
        ComposerManager::is_installed(self.client(id)?).await
    }

    pub async fn list_composer_global_packages(&self, id: &str) -> PhpResult<Vec<ComposerGlobalPackage>> {
        ComposerManager::list_global_packages(self.client(id)?).await
    }

    pub async fn install_composer_global_package(&self, id: &str, package: &str, version: Option<&str>) -> PhpResult<ComposerRunResult> {
        ComposerManager::install_global_package(self.client(id)?, package, version).await
    }

    pub async fn remove_composer_global_package(&self, id: &str, package: &str) -> PhpResult<ComposerRunResult> {
        ComposerManager::remove_global_package(self.client(id)?, package).await
    }

    pub async fn get_composer_project(&self, id: &str, project_path: &str) -> PhpResult<ComposerProject> {
        ComposerManager::get_project(self.client(id)?, project_path).await
    }

    pub async fn composer_install(&self, id: &str, req: &ComposerInstallRequest) -> PhpResult<ComposerRunResult> {
        ComposerManager::install(self.client(id)?, req).await
    }

    pub async fn composer_update(&self, id: &str, req: &ComposerUpdateRequest) -> PhpResult<ComposerRunResult> {
        ComposerManager::update(self.client(id)?, req).await
    }

    pub async fn composer_require(&self, id: &str, req: &RequirePackageRequest) -> PhpResult<ComposerRunResult> {
        ComposerManager::require_package(self.client(id)?, req).await
    }

    pub async fn composer_remove(&self, id: &str, req: &RemovePackageRequest) -> PhpResult<ComposerRunResult> {
        ComposerManager::remove_package(self.client(id)?, req).await
    }

    pub async fn composer_dump_autoload(&self, id: &str, project_path: &str, optimize: bool) -> PhpResult<ComposerRunResult> {
        ComposerManager::dump_autoload(self.client(id)?, project_path, optimize).await
    }

    pub async fn composer_validate(&self, id: &str, project_path: &str) -> PhpResult<ComposerRunResult> {
        ComposerManager::validate(self.client(id)?, project_path).await
    }

    pub async fn composer_outdated(&self, id: &str, project_path: &str) -> PhpResult<Vec<ComposerPackage>> {
        ComposerManager::outdated(self.client(id)?, project_path).await
    }

    pub async fn composer_clear_cache(&self, id: &str) -> PhpResult<()> {
        ComposerManager::clear_cache(self.client(id)?).await
    }

    pub async fn composer_self_update(&self, id: &str) -> PhpResult<ComposerRunResult> {
        ComposerManager::self_update(self.client(id)?).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn read_php_log(&self, id: &str, req: &PhpLogReadRequest) -> PhpResult<Vec<PhpLogEntry>> {
        LogManager::read_log(self.client(id)?, req).await
    }

    pub async fn get_log_config(&self, id: &str, version: &str) -> PhpResult<PhpLogConfig> {
        LogManager::get_log_config(self.client(id)?, version).await
    }

    pub async fn get_fpm_log_config(&self, id: &str, version: &str) -> PhpResult<FpmLogConfig> {
        LogManager::get_fpm_log_config(self.client(id)?, version).await
    }

    pub async fn get_log_path(&self, id: &str, version: &str) -> PhpResult<String> {
        LogManager::get_log_path(self.client(id)?, version).await
    }

    pub async fn get_fpm_log_path(&self, id: &str, version: &str) -> PhpResult<String> {
        LogManager::get_fpm_log_path(self.client(id)?, version).await
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

    pub async fn get_fpm_service_status(&self, id: &str, version: &str) -> PhpResult<PhpFpmServiceStatus> {
        ProcessManager::get_service_status(self.client(id)?, version).await
    }

    pub async fn start_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::start(self.client(id)?, version).await
    }

    pub async fn stop_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::stop(self.client(id)?, version).await
    }

    pub async fn restart_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::restart(self.client(id)?, version).await
    }

    pub async fn reload_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::reload(self.client(id)?, version).await
    }

    pub async fn enable_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::enable(self.client(id)?, version).await
    }

    pub async fn disable_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::disable(self.client(id)?, version).await
    }

    pub async fn test_fpm_config(&self, id: &str, version: &str) -> PhpResult<ConfigTestResult> {
        ProcessManager::test_config(self.client(id)?, version).await
    }

    pub async fn get_fpm_master_process(&self, id: &str, version: &str) -> PhpResult<PhpFpmMasterProcess> {
        ProcessManager::get_master_process(self.client(id)?, version).await
    }

    pub async fn list_fpm_worker_pids(&self, id: &str, version: &str) -> PhpResult<Vec<u32>> {
        ProcessManager::list_worker_pids(self.client(id)?, version).await
    }

    pub async fn graceful_restart_fpm(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::graceful_restart(self.client(id)?, version).await
    }

    pub async fn reopen_fpm_logs(&self, id: &str, version: &str) -> PhpResult<()> {
        ProcessManager::reopen_logs(self.client(id)?, version).await
    }

    pub async fn list_all_fpm_services(&self, id: &str) -> PhpResult<Vec<PhpFpmServiceStatus>> {
        ProcessManager::list_all_fpm_services(self.client(id)?).await
    }
}
