//! Tauri commands — async wrappers for the kernel management service.

use crate::error::KernelError;
use crate::service::KernelServiceState;
use crate::types::*;
use std::collections::HashMap;
use tauri::State;

fn err_str(e: KernelError) -> String {
    e.to_string()
}

// ─── Host CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn kernel_add_host(
    state: State<'_, KernelServiceState>,
    host: KernelHost,
) -> Result<(), String> {
    state.lock().await.add_host(host).map_err(err_str)
}

#[tauri::command]
pub async fn kernel_remove_host(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<KernelHost, String> {
    state.lock().await.remove_host(&host_id).map_err(err_str)
}

#[tauri::command]
pub async fn kernel_update_host(
    state: State<'_, KernelServiceState>,
    host: KernelHost,
) -> Result<(), String> {
    state.lock().await.update_host(host).map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_host(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<KernelHost, String> {
    let svc = state.lock().await;
    svc.get_host(&host_id).cloned().map_err(err_str)
}

#[tauri::command]
pub async fn kernel_list_hosts(
    state: State<'_, KernelServiceState>,
) -> Result<Vec<KernelHost>, String> {
    let svc = state.lock().await;
    Ok(svc.list_hosts().into_iter().cloned().collect())
}

// ─── Modules ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn kernel_list_modules(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<KernelModule>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::list_loaded_modules(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_module_info(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
) -> Result<ModuleInfo, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::get_module_info(&host, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_load_module(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
    params: Vec<String>,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    let pairs: Vec<(&str, &str)> = params.iter().filter_map(|p| p.split_once('=')).collect();
    crate::modules::load_module(&host, &name, &pairs)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_unload_module(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
    force: bool,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::unload_module(&host, &name, force)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_module_params(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
) -> Result<Vec<ModuleParameter>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::get_module_params(&host, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_set_module_param(
    state: State<'_, KernelServiceState>,
    host_id: String,
    module_name: String,
    param: String,
    value: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::set_module_param(&host, &module_name, &param, &value)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_list_available_modules(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::list_available_modules(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_blacklist_module(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::blacklist_module(&host, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_unblacklist_module(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::unblacklist_module(&host, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_list_blacklisted(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::list_blacklisted(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_list_autoload(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::get_modules_autoload(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_add_autoload(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::add_autoload_module(&host, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_remove_autoload(
    state: State<'_, KernelServiceState>,
    host_id: String,
    name: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::modules::remove_autoload_module(&host, &name)
        .await
        .map_err(err_str)
}

// ─── Sysctl ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn kernel_get_all_sysctl(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<SysctlEntry>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::get_all_sysctl(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_sysctl(
    state: State<'_, KernelServiceState>,
    host_id: String,
    key: String,
) -> Result<SysctlEntry, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::get_sysctl(&host, &key)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_set_sysctl(
    state: State<'_, KernelServiceState>,
    host_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::set_sysctl(&host, &key, &value)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_set_sysctl_persistent(
    state: State<'_, KernelServiceState>,
    host_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::set_sysctl_persistent(&host, &key, &value)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_remove_sysctl_persistent(
    state: State<'_, KernelServiceState>,
    host_id: String,
    key: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::remove_sysctl_persistent(&host, &key)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_reload_sysctl(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::reload_sysctl(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_network_sysctl(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<SysctlEntry>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::get_network_sysctl(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_vm_sysctl(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<SysctlEntry>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysctl::get_vm_sysctl(&host).await.map_err(err_str)
}

// ─── Features ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn kernel_get_config(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<KernelConfig>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::features::get_kernel_config(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_check_feature(
    state: State<'_, KernelServiceState>,
    host_id: String,
    feature: String,
) -> Result<Option<KernelConfig>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::features::check_kernel_feature(&host, &feature)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_detect_cgroup_version(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<u8, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::features::detect_cgroup_version(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_detect_namespace_support(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::features::detect_namespace_support(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_detect_security_modules(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::features::detect_security_modules(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_detect_io_schedulers(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<HashMap<String, Vec<String>>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::features::detect_io_schedulers(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_command_line(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<String, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::features::get_kernel_command_line(&host)
        .await
        .map_err(err_str)
}

// ─── Power ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn kernel_get_power_state(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<PowerState, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::power::get_power_state(&host).await.map_err(err_str)
}

#[tauri::command]
pub async fn kernel_list_thermal_zones(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<ThermalZone>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::power::list_thermal_zones(&host)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_get_cpu_governor(
    state: State<'_, KernelServiceState>,
    host_id: String,
    cpu: u32,
) -> Result<String, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::power::get_governor(&host, cpu)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_set_cpu_governor(
    state: State<'_, KernelServiceState>,
    host_id: String,
    cpu: u32,
    governor: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::power::set_governor(&host, cpu, &governor)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_list_governors(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::power::list_governors(&host).await.map_err(err_str)
}

// ─── Sysfs ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn kernel_read_sysfs(
    state: State<'_, KernelServiceState>,
    host_id: String,
    path: String,
) -> Result<String, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysfs::read_sysfs(&host, &path)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_write_sysfs(
    state: State<'_, KernelServiceState>,
    host_id: String,
    path: String,
    value: String,
) -> Result<(), String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysfs::write_sysfs(&host, &path, &value)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn kernel_list_block_devices(
    state: State<'_, KernelServiceState>,
    host_id: String,
) -> Result<Vec<HashMap<String, String>>, String> {
    let host = state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(err_str)?;
    crate::sysfs::get_block_devices(&host)
        .await
        .map_err(err_str)
}
