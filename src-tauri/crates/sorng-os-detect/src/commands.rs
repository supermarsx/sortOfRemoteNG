// ── sorng-os-detect/src/commands.rs ─────────────────────────────────────────
//! Tauri commands – thin wrappers around `OsDetectService`.

use tauri::State;

use crate::service::OsDetectServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Host CRUD ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_add_host(
    state: State<'_, OsDetectServiceState>,
    name: String,
    ssh_config: Option<SshConfig>,
    use_sudo: bool,
) -> CmdResult<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let host = OsDetectHost {
        id: id.clone(),
        name,
        ssh: ssh_config,
        use_sudo,
        created_at: now,
        updated_at: now,
    };
    state.lock().await.add_host(host).map_err(map_err)?;
    Ok(id)
}

#[tauri::command]
pub async fn os_detect_remove_host(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<()> {
    state.lock().await.remove_host(&host_id).map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub async fn os_detect_update_host(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
    name: Option<String>,
    ssh_config: Option<SshConfig>,
    use_sudo: Option<bool>,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    let existing = svc.get_host(&host_id).map_err(map_err)?.clone();
    let updated = OsDetectHost {
        id: existing.id,
        name: name.unwrap_or(existing.name),
        ssh: ssh_config.or(existing.ssh),
        use_sudo: use_sudo.unwrap_or(existing.use_sudo),
        created_at: existing.created_at,
        updated_at: chrono::Utc::now(),
    };
    svc.update_host(updated).map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_get_host(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<OsDetectHost> {
    state
        .lock()
        .await
        .get_host(&host_id)
        .map(|h| h.clone())
        .map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_list_hosts(
    state: State<'_, OsDetectServiceState>,
) -> CmdResult<Vec<OsDetectHost>> {
    Ok(state.lock().await.list_hosts().into_iter().cloned().collect())
}

// ── Distro ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_os_family(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<OsFamily> {
    state.lock().await.detect_os_family(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_linux_distro(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<LinuxDistro> {
    state.lock().await.detect_linux_distro(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_os_version(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<OsVersion> {
    state.lock().await.detect_os_version(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_macos_version(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<OsVersion> {
    state.lock().await.detect_macos_version(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_bsd_version(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<OsVersion> {
    state.lock().await.detect_bsd_version(&host_id).await.map_err(map_err)
}

// ── Init System ───────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_init_system(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<InitSystem> {
    state.lock().await.detect_init_system(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_init_services(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<AvailableService>> {
    state.lock().await.list_init_services(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_default_target(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Option<String>> {
    state.lock().await.detect_default_target(&host_id).await.map_err(map_err)
}

// ── Package Manager ───────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_package_managers(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<PackageManager>> {
    state.lock().await.detect_package_managers(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_installed_packages(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<InstalledPackageInfo>> {
    state.lock().await.list_installed_packages(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_package_sources(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.detect_package_sources(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_updates_available(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<u64> {
    state.lock().await.check_updates_available(&host_id).await.map_err(map_err)
}

// ── Hardware ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_cpu(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<CpuInfo> {
    state.lock().await.detect_cpu(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_memory(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<MemoryInfo> {
    state.lock().await.detect_memory(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_disks(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<DiskInfo>> {
    state.lock().await.detect_disks(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_network_interfaces(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<NetworkInterfaceInfo>> {
    state
        .lock()
        .await
        .detect_network_interfaces(&host_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_gpus(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<GpuInfo>> {
    state.lock().await.detect_gpus(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_virtualization(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<VirtualizationInfo> {
    state.lock().await.detect_virtualization(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_hardware_profile(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<HardwareProfile> {
    state.lock().await.build_hardware_profile(&host_id).await.map_err(map_err)
}

// ── Kernel ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_kernel(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<KernelInfo> {
    state.lock().await.detect_kernel(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_architecture(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Architecture> {
    state.lock().await.detect_architecture(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_loaded_modules(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_loaded_modules(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_kernel_features(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    let kf = state
        .lock()
        .await
        .detect_kernel_features(&host_id)
        .await
        .map_err(map_err)?;
    let mut features = Vec::new();
    if kf.cgroups_version != "none" {
        features.push(format!("cgroups_{}", kf.cgroups_version));
    }
    for ns in kf.namespaces {
        features.push(format!("ns:{}", ns));
    }
    if kf.has_seccomp {
        features.push("seccomp".to_string());
    }
    if kf.has_bpf {
        features.push("bpf".to_string());
    }
    Ok(features)
}

// ── Security ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_selinux(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<SecurityInfo> {
    state.lock().await.detect_security_info(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_apparmor(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<SecurityInfo> {
    state.lock().await.detect_security_info(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_firewall(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<SecurityInfo> {
    state.lock().await.detect_security_info(&host_id).await.map_err(map_err)
}

// ── Services ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_available_services(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<AvailableService>> {
    state
        .lock()
        .await
        .detect_available_services(&host_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_service_capabilities(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<ServiceCapabilities> {
    state
        .lock()
        .await
        .detect_service_capabilities(&host_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_installed_runtimes(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    let runtimes = state
        .lock()
        .await
        .detect_installed_runtimes(&host_id)
        .await
        .map_err(map_err)?;
    Ok(runtimes.into_iter().map(|(name, _)| name).collect())
}

#[tauri::command]
pub async fn os_detect_web_servers(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    let servers = state
        .lock()
        .await
        .detect_web_servers(&host_id)
        .await
        .map_err(map_err)?;
    Ok(servers.into_iter().map(|(name, _)| name).collect())
}

#[tauri::command]
pub async fn os_detect_databases(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    let dbs = state
        .lock()
        .await
        .detect_databases(&host_id)
        .await
        .map_err(map_err)?;
    Ok(dbs.into_iter().map(|(name, _)| name).collect())
}

#[tauri::command]
pub async fn os_detect_container_runtimes(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<String>> {
    let rts = state
        .lock()
        .await
        .detect_container_runtimes(&host_id)
        .await
        .map_err(map_err)?;
    Ok(rts.into_iter().map(|(name, _)| name).collect())
}

// ── Shell ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_default_shell(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<ShellInfo> {
    state.lock().await.detect_default_shell(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_available_shells(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Vec<ShellInfo>> {
    state.lock().await.detect_available_shells(&host_id).await.map_err(map_err)
}

// ── Locale ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_locale(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<SystemLocale> {
    state.lock().await.detect_system_locale(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_timezone(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<Option<String>> {
    state.lock().await.detect_timezone(&host_id).await.map_err(map_err)
}

// ── Full / Quick Scan ─────────────────────────────────────────────

#[tauri::command]
pub async fn os_detect_full_scan(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<OsCapabilities> {
    state.lock().await.full_scan(&host_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn os_detect_quick_scan(
    state: State<'_, OsDetectServiceState>,
    host_id: String,
) -> CmdResult<OsCapabilities> {
    state.lock().await.quick_scan(&host_id).await.map_err(map_err)
}
