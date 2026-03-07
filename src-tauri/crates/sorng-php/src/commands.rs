// ── sorng-php/src/commands.rs ────────────────────────────────────────────────
//! Tauri commands – thin wrappers around `PhpService`.

use tauri::State;
use crate::service::PhpServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_connect(
    state: State<'_, PhpServiceState>,
    id: String,
    config: PhpConnectionConfig,
) -> CmdResult<PhpConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_disconnect(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn php_list_connections(
    state: State<'_, PhpServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Versions ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_list_versions(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<Vec<PhpVersion>> {
    state.lock().await.list_versions(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_default_version(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<PhpVersion> {
    state.lock().await.get_default_version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_version_detail(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<PhpVersionDetail> {
    state.lock().await.get_version_detail(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_set_default_version(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.set_default_version(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_sapis(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<PhpSapi>> {
    state.lock().await.list_sapis(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_config_path(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    sapi: String,
) -> CmdResult<String> {
    state.lock().await.get_config_path(&id, &version, &sapi).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_extension_dir(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<String> {
    state.lock().await.get_extension_dir(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_check_version_installed(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<bool> {
    state.lock().await.check_version_installed(&id, &version).await.map_err(map_err)
}

// ── FPM Pools ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_list_fpm_pools(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<PhpFpmPool>> {
    state.lock().await.list_fpm_pools(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_fpm_pool(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<PhpFpmPool> {
    state.lock().await.get_fpm_pool(&id, &version, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_create_fpm_pool(
    state: State<'_, PhpServiceState>,
    id: String,
    request: CreateFpmPoolRequest,
) -> CmdResult<PhpFpmPool> {
    state.lock().await.create_fpm_pool(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_update_fpm_pool(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
    request: UpdateFpmPoolRequest,
) -> CmdResult<PhpFpmPool> {
    state.lock().await.update_fpm_pool(&id, &version, &name, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_delete_fpm_pool(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_fpm_pool(&id, &version, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_enable_fpm_pool(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.enable_fpm_pool(&id, &version, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_disable_fpm_pool(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.disable_fpm_pool(&id, &version, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_fpm_pool_status(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<PhpFpmPoolStatus> {
    state.lock().await.get_fpm_pool_status(&id, &version, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_fpm_pool_processes(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<Vec<FpmWorkerProcess>> {
    state.lock().await.list_fpm_pool_processes(&id, &version, &name).await.map_err(map_err)
}

// ── INI ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_get_ini_file(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    sapi: String,
) -> CmdResult<PhpIniFile> {
    state.lock().await.get_ini_file(&id, &version, &sapi).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_ini_directives(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    sapi: String,
) -> CmdResult<Vec<PhpIniDirective>> {
    state.lock().await.list_ini_directives(&id, &version, &sapi).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_ini_directive(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    sapi: String,
    key: String,
) -> CmdResult<PhpIniDirective> {
    state.lock().await.get_ini_directive(&id, &version, &sapi, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_set_ini_directive(
    state: State<'_, PhpServiceState>,
    id: String,
    request: SetIniDirectiveRequest,
) -> CmdResult<()> {
    state.lock().await.set_ini_directive(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_remove_ini_directive(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    sapi: String,
    key: String,
) -> CmdResult<()> {
    state.lock().await.remove_ini_directive(&id, &version, &sapi, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_ini_scan_dir(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    sapi: String,
) -> CmdResult<PhpIniScanDir> {
    state.lock().await.get_ini_scan_dir(&id, &version, &sapi).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_loaded_ini_files(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_loaded_ini_files(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_backup_ini(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    sapi: String,
) -> CmdResult<IniBackup> {
    state.lock().await.backup_ini(&id, &version, &sapi).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_restore_ini(
    state: State<'_, PhpServiceState>,
    id: String,
    backup_path: String,
    target_path: String,
) -> CmdResult<()> {
    state.lock().await.restore_ini(&id, &backup_path, &target_path).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_validate_ini(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<bool> {
    state.lock().await.validate_ini(&id, &version).await.map_err(map_err)
}

// ── Modules ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_list_modules(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<PhpModule>> {
    state.lock().await.list_modules(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_module(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<PhpModule> {
    state.lock().await.get_module(&id, &version, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_enable_module(
    state: State<'_, PhpServiceState>,
    id: String,
    request: EnableModuleRequest,
) -> CmdResult<()> {
    state.lock().await.enable_module(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_disable_module(
    state: State<'_, PhpServiceState>,
    id: String,
    request: DisableModuleRequest,
) -> CmdResult<()> {
    state.lock().await.disable_module(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_install_module(
    state: State<'_, PhpServiceState>,
    id: String,
    request: InstallModuleRequest,
) -> CmdResult<()> {
    state.lock().await.install_module(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_uninstall_module(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    module_name: String,
) -> CmdResult<()> {
    state.lock().await.uninstall_module(&id, &version, &module_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_is_module_loaded(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    name: String,
) -> CmdResult<bool> {
    state.lock().await.is_module_loaded(&id, &version, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_available_modules(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_available_modules(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_pecl_packages(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<Vec<PeclPackage>> {
    state.lock().await.list_pecl_packages(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_install_pecl_package(
    state: State<'_, PhpServiceState>,
    id: String,
    name: String,
    version: Option<String>,
) -> CmdResult<()> {
    state.lock().await.install_pecl_package(&id, &name, version.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_uninstall_pecl_package(
    state: State<'_, PhpServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.uninstall_pecl_package(&id, &name).await.map_err(map_err)
}

// ── OPcache ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_get_opcache_status(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<OpcacheStatus> {
    state.lock().await.get_opcache_status(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_opcache_config(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<OpcacheConfig> {
    state.lock().await.get_opcache_config(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_reset_opcache(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.reset_opcache(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_cached_scripts(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<CachedScript>> {
    state.lock().await.list_cached_scripts(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_invalidate_cached_script(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.invalidate_cached_script(&id, &version, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_is_opcache_enabled(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<bool> {
    state.lock().await.is_opcache_enabled(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_update_opcache_config(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    config: OpcacheConfig,
) -> CmdResult<()> {
    state.lock().await.update_opcache_config(&id, &version, &config).await.map_err(map_err)
}

// ── Sessions ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_get_session_config(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<PhpSessionConfig> {
    state.lock().await.get_session_config(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_update_session_config(
    state: State<'_, PhpServiceState>,
    id: String,
    request: UpdateSessionConfigRequest,
) -> CmdResult<()> {
    state.lock().await.update_session_config(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_session_stats(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<SessionStats> {
    state.lock().await.get_session_stats(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_cleanup_sessions(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
    max_age_secs: Option<u64>,
) -> CmdResult<u64> {
    state.lock().await.cleanup_sessions(&id, &version, max_age_secs).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_session_files(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_session_files(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_session_save_path(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<String> {
    state.lock().await.get_session_save_path(&id, &version).await.map_err(map_err)
}

// ── Composer ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_get_composer_info(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<ComposerInfo> {
    state.lock().await.get_composer_info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_is_composer_installed(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<bool> {
    state.lock().await.is_composer_installed(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_composer_global_packages(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<Vec<ComposerGlobalPackage>> {
    state.lock().await.list_composer_global_packages(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_install_composer_global_package(
    state: State<'_, PhpServiceState>,
    id: String,
    package: String,
    version: Option<String>,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.install_composer_global_package(&id, &package, version.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_remove_composer_global_package(
    state: State<'_, PhpServiceState>,
    id: String,
    package: String,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.remove_composer_global_package(&id, &package).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_composer_project(
    state: State<'_, PhpServiceState>,
    id: String,
    project_path: String,
) -> CmdResult<ComposerProject> {
    state.lock().await.get_composer_project(&id, &project_path).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_install(
    state: State<'_, PhpServiceState>,
    id: String,
    request: ComposerInstallRequest,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.composer_install(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_update(
    state: State<'_, PhpServiceState>,
    id: String,
    request: ComposerUpdateRequest,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.composer_update(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_require(
    state: State<'_, PhpServiceState>,
    id: String,
    request: RequirePackageRequest,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.composer_require(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_remove(
    state: State<'_, PhpServiceState>,
    id: String,
    request: RemovePackageRequest,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.composer_remove(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_dump_autoload(
    state: State<'_, PhpServiceState>,
    id: String,
    project_path: String,
    optimize: bool,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.composer_dump_autoload(&id, &project_path, optimize).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_validate(
    state: State<'_, PhpServiceState>,
    id: String,
    project_path: String,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.composer_validate(&id, &project_path).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_outdated(
    state: State<'_, PhpServiceState>,
    id: String,
    project_path: String,
) -> CmdResult<Vec<ComposerPackage>> {
    state.lock().await.composer_outdated(&id, &project_path).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_clear_cache(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.composer_clear_cache(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_composer_self_update(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<ComposerRunResult> {
    state.lock().await.composer_self_update(&id).await.map_err(map_err)
}

// ── Logs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_read_log(
    state: State<'_, PhpServiceState>,
    id: String,
    request: PhpLogReadRequest,
) -> CmdResult<Vec<PhpLogEntry>> {
    state.lock().await.read_php_log(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_log_config(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<PhpLogConfig> {
    state.lock().await.get_log_config(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_fpm_log_config(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<FpmLogConfig> {
    state.lock().await.get_fpm_log_config(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_log_path(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<String> {
    state.lock().await.get_log_path(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_fpm_log_path(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<String> {
    state.lock().await.get_fpm_log_path(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_clear_log(
    state: State<'_, PhpServiceState>,
    id: String,
    log_path: String,
) -> CmdResult<()> {
    state.lock().await.clear_log(&id, &log_path).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_tail_log(
    state: State<'_, PhpServiceState>,
    id: String,
    log_path: String,
    lines: u32,
) -> CmdResult<String> {
    state.lock().await.tail_log(&id, &log_path, lines).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_log_size(
    state: State<'_, PhpServiceState>,
    id: String,
    log_path: String,
) -> CmdResult<u64> {
    state.lock().await.get_log_size(&id, &log_path).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_rotate_log(
    state: State<'_, PhpServiceState>,
    id: String,
    log_path: String,
) -> CmdResult<()> {
    state.lock().await.rotate_log(&id, &log_path).await.map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn php_get_fpm_service_status(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<PhpFpmServiceStatus> {
    state.lock().await.get_fpm_service_status(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_start_fpm(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.start_fpm(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_stop_fpm(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.stop_fpm(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_restart_fpm(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.restart_fpm(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_reload_fpm(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.reload_fpm(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_enable_fpm(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.enable_fpm(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_disable_fpm(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.disable_fpm(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_test_fpm_config(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<ConfigTestResult> {
    state.lock().await.test_fpm_config(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_get_fpm_master_process(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<PhpFpmMasterProcess> {
    state.lock().await.get_fpm_master_process(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_fpm_worker_pids(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<Vec<u32>> {
    state.lock().await.list_fpm_worker_pids(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_graceful_restart_fpm(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.graceful_restart_fpm(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_reopen_fpm_logs(
    state: State<'_, PhpServiceState>,
    id: String,
    version: String,
) -> CmdResult<()> {
    state.lock().await.reopen_fpm_logs(&id, &version).await.map_err(map_err)
}

#[tauri::command]
pub async fn php_list_all_fpm_services(
    state: State<'_, PhpServiceState>,
    id: String,
) -> CmdResult<Vec<PhpFpmServiceStatus>> {
    state.lock().await.list_all_fpm_services(&id).await.map_err(map_err)
}
