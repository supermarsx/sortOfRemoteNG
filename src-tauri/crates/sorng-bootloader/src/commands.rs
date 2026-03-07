// ── sorng-bootloader/src/commands.rs ─────────────────────────────────────────
//! Tauri commands – thin wrappers around the bootloader service and modules.

use tauri::State;

use crate::detect;
use crate::grub;
use crate::initramfs;
use crate::kernels;
use crate::service::BootloaderServiceState;
use crate::systemd_boot;
use crate::types::*;
use crate::uefi;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Host CRUD ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn boot_add_host(
    state: State<'_, BootloaderServiceState>,
    host: BootloaderHost,
) -> CmdResult<()> {
    state.lock().await.add_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn boot_remove_host(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<BootloaderHost> {
    state.lock().await.remove_host(&host_id).map_err(map_err)
}

#[tauri::command]
pub async fn boot_update_host(
    state: State<'_, BootloaderServiceState>,
    host: BootloaderHost,
) -> CmdResult<()> {
    state.lock().await.update_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_host(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<BootloaderHost> {
    state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_list_hosts(
    state: State<'_, BootloaderServiceState>,
) -> CmdResult<Vec<BootloaderHost>> {
    Ok(state.lock().await.list_hosts().into_iter().cloned().collect())
}

// ── Detection (detect.rs) ─────────────────────────────────────────

#[tauri::command]
pub async fn boot_detect_bootloader(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<BootloaderType> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    detect::detect_bootloader(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_detect_boot_mode(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    detect::detect_boot_mode(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_partitions(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<BootPartitionInfo>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    detect::get_boot_partitions(host).await.map_err(map_err)
}

// ── GRUB (grub.rs) ───────────────────────────────────────────────

#[tauri::command]
pub async fn boot_get_grub_config(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<GrubConfig> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::get_grub_config(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_grub_param(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::set_grub_param(host, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_grub_environment(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<GrubEnvironment> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::get_grub_environment(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_list_grub_entries(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<GrubMenuEntry>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::list_grub_entries(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_default_grub_entry(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    entry_id: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::set_default_entry(host, &entry_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_update_grub(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::update_grub(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_install_grub(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    device: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::install_grub(host, &device).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_custom_entries(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::get_custom_entries(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_custom_entries(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    content: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::set_custom_entries(host, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_list_grub_scripts(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<GrubScript>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::list_grub_scripts(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_enable_grub_script(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    name: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::enable_grub_script(host, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_disable_grub_script(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    name: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    grub::disable_grub_script(host, &name)
        .await
        .map_err(map_err)
}

// ── systemd-boot (systemd_boot.rs) ───────────────────────────────

#[tauri::command]
pub async fn boot_get_sd_config(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<SystemdBootConfig> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    systemd_boot::get_boot_config(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_sd_config(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    config_json: SystemdBootConfig,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    systemd_boot::set_boot_config(host, &config_json)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_list_sd_entries(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<SystemdBootEntry>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    systemd_boot::list_boot_entries(host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_create_sd_entry(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    entry_json: SystemdBootEntry,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    systemd_boot::create_boot_entry(host, &entry_json)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_delete_sd_entry(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    id: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    systemd_boot::delete_boot_entry(host, &id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_default_sd(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    id: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    systemd_boot::set_default_boot_entry(host, &id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_sd_status(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    let status = systemd_boot::boot_status(host).await.map_err(map_err)?;
    Ok(status.raw)
}

// ── UEFI (uefi.rs) ──────────────────────────────────────────────

#[tauri::command]
pub async fn boot_list_uefi_entries(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<UefiBootEntry>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    uefi::list_uefi_entries(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_uefi_order(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    uefi::get_boot_order(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_uefi_order(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    order: Vec<String>,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    uefi::set_boot_order(host, &order).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_create_uefi_entry(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    label: String,
    loader: String,
    params: Option<String>,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    uefi::create_uefi_entry(host, &label, &loader, params.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_delete_uefi_entry(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    boot_num: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    uefi::delete_uefi_entry(host, &boot_num)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_next_boot(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    boot_num: String,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    uefi::set_next_boot(host, &boot_num)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_uefi_info(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<UefiInfo> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    uefi::get_uefi_info(host).await.map_err(map_err)
}

// ── Kernels (kernels.rs) ────────────────────────────────────────

#[tauri::command]
pub async fn boot_list_kernels(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<KernelVersion>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    kernels::list_installed_kernels(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_running_kernel(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    kernels::get_running_kernel(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_get_kernel_params(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<BootParameter>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    kernels::get_kernel_params(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_set_kernel_params(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    params_json: Vec<BootParameter>,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    kernels::set_kernel_params(host, &params_json)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_add_kernel_param(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    param: BootParameter,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    kernels::add_kernel_param(host, &param)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_remove_kernel_param(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    param: BootParameter,
) -> CmdResult<()> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    kernels::remove_kernel_param(host, &param)
        .await
        .map_err(map_err)
}

// ── Initramfs (initramfs.rs) ────────────────────────────────────

#[tauri::command]
pub async fn boot_list_initramfs(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<Vec<InitramfsInfo>> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    initramfs::list_initramfs(host).await.map_err(map_err)
}

#[tauri::command]
pub async fn boot_rebuild_initramfs(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
    kernel_version: String,
) -> CmdResult<String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    initramfs::rebuild_initramfs(host, &kernel_version)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn boot_detect_initramfs_tool(
    state: State<'_, BootloaderServiceState>,
    host_id: String,
) -> CmdResult<InitramfsTool> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(map_err)?;
    initramfs::detect_initramfs_tool(host)
        .await
        .map_err(map_err)
}
