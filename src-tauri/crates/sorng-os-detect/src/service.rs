//! Service façade for OS detection management.

use crate::distro;
use crate::error::OsDetectError;
use crate::full_scan;
use crate::hardware;
use crate::init_system;
use crate::kernel;
use crate::locale;
use crate::package_mgr;
use crate::security;
use crate::services;
use crate::shell;
use crate::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type OsDetectServiceState = Arc<Mutex<OsDetectService>>;

pub struct OsDetectService {
    hosts: HashMap<String, OsDetectHost>,
}

impl OsDetectService {
    pub fn new() -> OsDetectServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    pub fn add_host(&mut self, host: OsDetectHost) -> Result<(), OsDetectError> {
        if self.hosts.contains_key(&host.id) {
            return Err(OsDetectError::Other(format!(
                "Host {} already exists",
                host.id
            )));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn remove_host(&mut self, host_id: &str) -> Result<OsDetectHost, OsDetectError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| OsDetectError::HostNotFound(host_id.to_string()))
    }

    pub fn get_host(&self, host_id: &str) -> Result<&OsDetectHost, OsDetectError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| OsDetectError::HostNotFound(host_id.to_string()))
    }

    pub fn list_hosts(&self) -> Vec<&OsDetectHost> {
        self.hosts.values().collect()
    }

    pub fn update_host(&mut self, host: OsDetectHost) -> Result<(), OsDetectError> {
        if !self.hosts.contains_key(&host.id) {
            return Err(OsDetectError::HostNotFound(host.id.clone()));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    // ─── Full / Quick / Partial Scan ────────────────────────────────

    pub async fn full_scan(&self, host_id: &str) -> Result<OsCapabilities, OsDetectError> {
        let host = self.get_host(host_id)?;
        full_scan::full_scan(host).await
    }

    pub async fn quick_scan(&self, host_id: &str) -> Result<OsCapabilities, OsDetectError> {
        let host = self.get_host(host_id)?;
        full_scan::quick_scan(host).await
    }

    pub async fn partial_scan(
        &self,
        host_id: &str,
        sections: &[ScanSection],
    ) -> Result<OsCapabilities, OsDetectError> {
        let host = self.get_host(host_id)?;
        full_scan::partial_scan(host, sections).await
    }

    // ─── Distro ─────────────────────────────────────────────────────

    pub async fn detect_os_family(&self, host_id: &str) -> Result<OsFamily, OsDetectError> {
        let host = self.get_host(host_id)?;
        distro::detect_os_family(host).await
    }

    pub async fn detect_linux_distro(&self, host_id: &str) -> Result<LinuxDistro, OsDetectError> {
        let host = self.get_host(host_id)?;
        distro::detect_linux_distro(host).await
    }

    pub async fn detect_os_version(&self, host_id: &str) -> Result<OsVersion, OsDetectError> {
        let host = self.get_host(host_id)?;
        distro::detect_os_version(host).await
    }

    pub async fn detect_macos_version(&self, host_id: &str) -> Result<OsVersion, OsDetectError> {
        let host = self.get_host(host_id)?;
        distro::detect_macos_version(host).await
    }

    pub async fn detect_bsd_version(&self, host_id: &str) -> Result<OsVersion, OsDetectError> {
        let host = self.get_host(host_id)?;
        distro::detect_bsd_version(host).await
    }

    pub async fn detect_windows_version(&self, host_id: &str) -> Result<OsVersion, OsDetectError> {
        let host = self.get_host(host_id)?;
        distro::detect_windows_version(host).await
    }

    // ─── Init System ────────────────────────────────────────────────

    pub async fn detect_init_system(&self, host_id: &str) -> Result<InitSystem, OsDetectError> {
        let host = self.get_host(host_id)?;
        init_system::detect_init_system(host).await
    }

    pub async fn detect_service_manager_version(
        &self,
        host_id: &str,
    ) -> Result<Option<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        init_system::detect_service_manager_version(host).await
    }

    pub async fn list_init_services(
        &self,
        host_id: &str,
    ) -> Result<Vec<AvailableService>, OsDetectError> {
        let host = self.get_host(host_id)?;
        init_system::list_init_services(host).await
    }

    pub async fn detect_default_target(
        &self,
        host_id: &str,
    ) -> Result<Option<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        init_system::detect_default_target(host).await
    }

    // ─── Package Manager ────────────────────────────────────────────

    pub async fn detect_package_managers(
        &self,
        host_id: &str,
    ) -> Result<Vec<PackageManager>, OsDetectError> {
        let host = self.get_host(host_id)?;
        package_mgr::detect_package_managers(host).await
    }

    pub async fn detect_default_package_manager(
        &self,
        host_id: &str,
    ) -> Result<PackageManager, OsDetectError> {
        let host = self.get_host(host_id)?;
        package_mgr::detect_default_package_manager(host).await
    }

    pub async fn count_installed_packages(&self, host_id: &str) -> Result<u64, OsDetectError> {
        let host = self.get_host(host_id)?;
        package_mgr::count_installed_packages(host).await
    }

    pub async fn list_installed_packages(
        &self,
        host_id: &str,
    ) -> Result<Vec<InstalledPackageInfo>, OsDetectError> {
        let host = self.get_host(host_id)?;
        package_mgr::list_installed_packages(host).await
    }

    pub async fn detect_package_sources(
        &self,
        host_id: &str,
    ) -> Result<Vec<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        package_mgr::detect_package_sources(host).await
    }

    pub async fn check_updates_available(&self, host_id: &str) -> Result<u64, OsDetectError> {
        let host = self.get_host(host_id)?;
        package_mgr::check_updates_available(host).await
    }

    // ─── Hardware ───────────────────────────────────────────────────

    pub async fn detect_cpu(&self, host_id: &str) -> Result<CpuInfo, OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::detect_cpu(host).await
    }

    pub async fn detect_memory(&self, host_id: &str) -> Result<MemoryInfo, OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::detect_memory(host).await
    }

    pub async fn detect_disks(&self, host_id: &str) -> Result<Vec<DiskInfo>, OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::detect_disks(host).await
    }

    pub async fn detect_network_interfaces(
        &self,
        host_id: &str,
    ) -> Result<Vec<NetworkInterfaceInfo>, OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::detect_network_interfaces(host).await
    }

    pub async fn detect_gpus(&self, host_id: &str) -> Result<Vec<GpuInfo>, OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::detect_gpus(host).await
    }

    pub async fn detect_virtualization(
        &self,
        host_id: &str,
    ) -> Result<VirtualizationInfo, OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::detect_virtualization(host).await
    }

    pub async fn detect_dmi_info(
        &self,
        host_id: &str,
    ) -> Result<(Option<String>, Option<String>, Option<String>), OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::detect_dmi_info(host).await
    }

    pub async fn build_hardware_profile(
        &self,
        host_id: &str,
    ) -> Result<HardwareProfile, OsDetectError> {
        let host = self.get_host(host_id)?;
        hardware::build_hardware_profile(host).await
    }

    // ─── Kernel ─────────────────────────────────────────────────────

    pub async fn detect_kernel(&self, host_id: &str) -> Result<KernelInfo, OsDetectError> {
        let host = self.get_host(host_id)?;
        kernel::detect_kernel(host).await
    }

    pub async fn detect_architecture(&self, host_id: &str) -> Result<Architecture, OsDetectError> {
        let host = self.get_host(host_id)?;
        kernel::detect_architecture(host).await
    }

    pub async fn list_loaded_modules(&self, host_id: &str) -> Result<Vec<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        kernel::list_loaded_modules(host).await
    }

    pub async fn get_sysctl_values(
        &self,
        host_id: &str,
        keys: &[&str],
    ) -> Result<std::collections::HashMap<String, String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        kernel::get_sysctl_values(host, keys).await
    }

    pub async fn detect_kernel_features(
        &self,
        host_id: &str,
    ) -> Result<kernel::KernelFeatures, OsDetectError> {
        let host = self.get_host(host_id)?;
        kernel::detect_kernel_features(host).await
    }

    // ─── Security ───────────────────────────────────────────────────

    pub async fn detect_selinux(
        &self,
        host_id: &str,
    ) -> Result<(bool, Option<String>), OsDetectError> {
        let host = self.get_host(host_id)?;
        security::detect_selinux(host).await
    }

    pub async fn detect_apparmor(&self, host_id: &str) -> Result<bool, OsDetectError> {
        let host = self.get_host(host_id)?;
        security::detect_apparmor(host).await
    }

    pub async fn detect_firewall(&self, host_id: &str) -> Result<Option<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        security::detect_firewall(host).await
    }

    pub async fn detect_capabilities(&self, host_id: &str) -> Result<Vec<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        security::detect_capabilities(host).await
    }

    pub async fn detect_security_info(&self, host_id: &str) -> Result<SecurityInfo, OsDetectError> {
        let host = self.get_host(host_id)?;
        security::detect_security_info(host).await
    }

    // ─── Services ───────────────────────────────────────────────────

    pub async fn detect_available_services(
        &self,
        host_id: &str,
    ) -> Result<Vec<AvailableService>, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::detect_available_services(host).await
    }

    pub async fn detect_service_capabilities(
        &self,
        host_id: &str,
    ) -> Result<ServiceCapabilities, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::detect_service_capabilities(host).await
    }

    pub async fn check_command_available(
        &self,
        host_id: &str,
        cmd: &str,
    ) -> Result<bool, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::check_command_available(host, cmd).await
    }

    pub async fn detect_installed_runtimes(
        &self,
        host_id: &str,
    ) -> Result<Vec<(String, String)>, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::detect_installed_runtimes(host).await
    }

    pub async fn detect_web_servers(
        &self,
        host_id: &str,
    ) -> Result<Vec<(String, String)>, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::detect_web_servers(host).await
    }

    pub async fn detect_databases(
        &self,
        host_id: &str,
    ) -> Result<Vec<(String, String)>, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::detect_databases(host).await
    }

    pub async fn detect_mail_services(
        &self,
        host_id: &str,
    ) -> Result<Vec<(String, String)>, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::detect_mail_services(host).await
    }

    pub async fn detect_container_runtimes(
        &self,
        host_id: &str,
    ) -> Result<Vec<(String, String)>, OsDetectError> {
        let host = self.get_host(host_id)?;
        services::detect_container_runtimes(host).await
    }

    // ─── Shell ──────────────────────────────────────────────────────

    pub async fn detect_default_shell(&self, host_id: &str) -> Result<ShellInfo, OsDetectError> {
        let host = self.get_host(host_id)?;
        shell::detect_default_shell(host).await
    }

    pub async fn detect_available_shells(
        &self,
        host_id: &str,
    ) -> Result<Vec<ShellInfo>, OsDetectError> {
        let host = self.get_host(host_id)?;
        shell::detect_available_shells(host).await
    }

    pub async fn detect_shell_version(
        &self,
        host_id: &str,
        shell_path: &str,
    ) -> Result<String, OsDetectError> {
        let host = self.get_host(host_id)?;
        shell::detect_shell_version(host, shell_path).await
    }

    // ─── Locale ─────────────────────────────────────────────────────

    pub async fn detect_locale(
        &self,
        host_id: &str,
    ) -> Result<(Option<String>, Option<String>), OsDetectError> {
        let host = self.get_host(host_id)?;
        locale::detect_locale(host).await
    }

    pub async fn detect_timezone(&self, host_id: &str) -> Result<Option<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        locale::detect_timezone(host).await
    }

    pub async fn detect_keymap(&self, host_id: &str) -> Result<Option<String>, OsDetectError> {
        let host = self.get_host(host_id)?;
        locale::detect_keymap(host).await
    }

    pub async fn detect_system_locale(&self, host_id: &str) -> Result<SystemLocale, OsDetectError> {
        let host = self.get_host(host_id)?;
        locale::detect_system_locale(host).await
    }
}
