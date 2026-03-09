//! Aggregate service facade for Synology NAS management.
//!
//! `SynologyService` owns the `SynoClient` and exposes every domain operation.
//! The Tauri `State` wrapper holds `SynologyServiceState = Arc<Mutex<SynologyService>>`.

use crate::auth::AuthManager;
use crate::backup::BackupManager;
use crate::client::SynoClient;
use crate::docker::DockerManager;
use crate::download_station::DownloadStationManager;
use crate::error::{SynologyError, SynologyResult};
use crate::file_station::FileStationManager;
use crate::hardware::HardwareManager;
use crate::logs::LogsManager;
use crate::network::NetworkManager;
use crate::notifications::NotificationsManager;
use crate::packages::PackagesManager;
use crate::security::SecurityManager;
use crate::services::ServicesManager;
use crate::shares::SharesManager;
use crate::storage::StorageManager;
use crate::surveillance::SurveillanceManager;
use crate::system::SystemManager;
use crate::types::*;
use crate::users::UsersManager;
use crate::virtualization::VirtualizationManager;

use std::sync::Arc;
use tokio::sync::Mutex;

pub type SynologyServiceState = Arc<Mutex<SynologyService>>;

pub struct SynologyService {
    client: Option<SynoClient>,
    config: Option<SynologyConfig>,
}

impl Default for SynologyService {
    fn default() -> Self {
        Self::new()
    }
}

impl SynologyService {
    pub fn new() -> Self {
        Self {
            client: None,
            config: None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.client.as_ref().is_some_and(|c| c.sid.is_some())
    }

    fn require_client(&self) -> SynologyResult<&SynoClient> {
        self.client
            .as_ref()
            .filter(|c| c.sid.is_some())
            .ok_or_else(|| SynologyError::auth("Not connected to Synology NAS"))
    }

    pub fn get_config(&self) -> Option<SynologyConfigSafe> {
        self.config.as_ref().map(|c| SynologyConfigSafe {
            host: c.host.clone(),
            port: c.port,
            username: c.username.clone(),
            use_https: c.use_https,
            dsm_version: self.client.as_ref().and_then(|cl| cl.dsm_version.clone()),
            model: self.client.as_ref().and_then(|cl| cl.model.clone()),
        })
    }

    // ─── Connection ──────────────────────────────────────────────

    pub async fn connect(&mut self, config: SynologyConfig) -> SynologyResult<String> {
        let mut client = SynoClient::new(&config)?;
        client.discover_apis().await?;
        let msg = AuthManager::login(&mut client).await?;
        self.config = Some(config);
        self.client = Some(client);
        Ok(msg)
    }

    pub async fn disconnect(&mut self) -> SynologyResult<()> {
        if let Some(ref mut client) = self.client {
            AuthManager::logout(client).await?;
        }
        self.client = None;
        Ok(())
    }

    pub async fn check_session(&self) -> SynologyResult<bool> {
        match &self.client {
            Some(client) => AuthManager::check_session(client).await,
            None => Ok(false),
        }
    }

    // ─── System ──────────────────────────────────────────────────

    pub async fn get_system_info(&self) -> SynologyResult<DsmInfo> {
        SystemManager::get_info(self.require_client()?).await
    }

    pub async fn get_utilization(&self) -> SynologyResult<SystemUtilization> {
        SystemManager::get_utilization(self.require_client()?).await
    }

    pub async fn list_processes(&self) -> SynologyResult<Vec<ProcessInfo>> {
        SystemManager::list_processes(self.require_client()?).await
    }

    pub async fn reboot(&self) -> SynologyResult<()> {
        SystemManager::reboot(self.require_client()?).await
    }

    pub async fn shutdown(&self) -> SynologyResult<()> {
        SystemManager::shutdown(self.require_client()?).await
    }

    pub async fn check_update(&self) -> SynologyResult<serde_json::Value> {
        SystemManager::check_update(self.require_client()?).await
    }

    // ─── Storage ─────────────────────────────────────────────────

    pub async fn get_storage_overview(&self) -> SynologyResult<StorageOverview> {
        StorageManager::get_overview(self.require_client()?).await
    }

    pub async fn list_disks(&self) -> SynologyResult<Vec<DiskInfo>> {
        StorageManager::list_disks(self.require_client()?).await
    }

    pub async fn list_volumes(&self) -> SynologyResult<Vec<VolumeInfo>> {
        StorageManager::list_volumes(self.require_client()?).await
    }

    pub async fn get_smart_info(&self, disk_id: &str) -> SynologyResult<SmartInfo> {
        StorageManager::get_smart_info(self.require_client()?, disk_id).await
    }

    pub async fn list_iscsi_luns(&self) -> SynologyResult<Vec<IscsiLun>> {
        StorageManager::list_iscsi_luns(self.require_client()?).await
    }

    pub async fn list_iscsi_targets(&self) -> SynologyResult<Vec<IscsiTarget>> {
        StorageManager::list_iscsi_targets(self.require_client()?).await
    }

    // ─── File Station ────────────────────────────────────────────

    pub async fn get_file_station_info(&self) -> SynologyResult<FileStationInfo> {
        FileStationManager::get_info(self.require_client()?).await
    }

    pub async fn list_files(
        &self,
        folder_path: &str,
        offset: u64,
        limit: u64,
        sort_by: &str,
        sort_direction: &str,
    ) -> SynologyResult<FileListResult> {
        FileStationManager::list_files(
            self.require_client()?,
            folder_path,
            offset,
            limit,
            sort_by,
            sort_direction,
        )
        .await
    }

    pub async fn list_file_shared_folders(&self) -> SynologyResult<FileListResult> {
        FileStationManager::list_shared_folders(self.require_client()?).await
    }

    pub async fn search_files(
        &self,
        folder_path: &str,
        pattern: &str,
    ) -> SynologyResult<serde_json::Value> {
        FileStationManager::search(self.require_client()?, folder_path, pattern).await
    }

    pub async fn upload_file(
        &self,
        dest_folder: &str,
        file_name: &str,
        content: Vec<u8>,
        overwrite: bool,
    ) -> SynologyResult<()> {
        FileStationManager::upload(
            self.require_client()?,
            dest_folder,
            file_name,
            content,
            overwrite,
        )
        .await
    }

    pub async fn download_file(&self, file_path: &str) -> SynologyResult<Vec<u8>> {
        FileStationManager::download(self.require_client()?, file_path).await
    }

    pub async fn create_folder(
        &self,
        folder_path: &str,
        name: &str,
        force_parent: bool,
    ) -> SynologyResult<serde_json::Value> {
        FileStationManager::create_folder(self.require_client()?, folder_path, name, force_parent)
            .await
    }

    pub async fn delete_files(&self, paths: &[&str], recursive: bool) -> SynologyResult<()> {
        FileStationManager::delete(self.require_client()?, paths, recursive).await
    }

    pub async fn rename_file(
        &self,
        path: &str,
        new_name: &str,
    ) -> SynologyResult<serde_json::Value> {
        FileStationManager::rename(self.require_client()?, path, new_name).await
    }

    pub async fn create_share_link(
        &self,
        path: &str,
        password: Option<&str>,
        expire_days: Option<u32>,
    ) -> SynologyResult<ShareLinkInfo> {
        FileStationManager::create_share_link(self.require_client()?, path, password, expire_days)
            .await
    }

    // ─── Shared Folders ──────────────────────────────────────────

    pub async fn list_shared_folders(&self) -> SynologyResult<Vec<SharedFolder>> {
        SharesManager::list(self.require_client()?).await
    }

    pub async fn get_share_permissions(&self, name: &str) -> SynologyResult<Vec<SharePermission>> {
        SharesManager::get_permissions(self.require_client()?, name).await
    }

    pub async fn create_shared_folder(
        &self,
        name: &str,
        vol_path: &str,
        desc: &str,
    ) -> SynologyResult<()> {
        SharesManager::create(self.require_client()?, name, vol_path, desc).await
    }

    pub async fn delete_shared_folder(&self, name: &str) -> SynologyResult<()> {
        SharesManager::delete(self.require_client()?, name).await
    }

    pub async fn mount_encrypted_share(&self, name: &str, password: &str) -> SynologyResult<()> {
        SharesManager::mount_encrypted(self.require_client()?, name, password).await
    }

    pub async fn unmount_encrypted_share(&self, name: &str) -> SynologyResult<()> {
        SharesManager::unmount_encrypted(self.require_client()?, name).await
    }

    // ─── Network ─────────────────────────────────────────────────

    pub async fn get_network_overview(&self) -> SynologyResult<NetworkOverview> {
        NetworkManager::get_overview(self.require_client()?).await
    }

    pub async fn list_network_interfaces(&self) -> SynologyResult<Vec<NetworkInterface>> {
        NetworkManager::list_interfaces(self.require_client()?).await
    }

    pub async fn list_firewall_rules(&self) -> SynologyResult<Vec<FirewallRule>> {
        NetworkManager::list_firewall_rules(self.require_client()?).await
    }

    pub async fn list_dhcp_leases(&self) -> SynologyResult<Vec<DhcpLease>> {
        NetworkManager::list_dhcp_leases(self.require_client()?).await
    }

    // ─── Users ───────────────────────────────────────────────────

    pub async fn list_users(&self) -> SynologyResult<Vec<SynoUser>> {
        UsersManager::list_users(self.require_client()?).await
    }

    pub async fn create_user(&self, params: &CreateUserParams) -> SynologyResult<()> {
        UsersManager::create_user(self.require_client()?, params).await
    }

    pub async fn delete_user(&self, name: &str) -> SynologyResult<()> {
        UsersManager::delete_user(self.require_client()?, name).await
    }

    pub async fn list_groups(&self) -> SynologyResult<Vec<SynoGroup>> {
        UsersManager::list_groups(self.require_client()?).await
    }

    // ─── Packages ────────────────────────────────────────────────

    pub async fn list_packages(&self) -> SynologyResult<Vec<PackageInfo>> {
        PackagesManager::list_installed(self.require_client()?).await
    }

    pub async fn start_package(&self, id: &str) -> SynologyResult<()> {
        PackagesManager::start(self.require_client()?, id).await
    }

    pub async fn stop_package(&self, id: &str) -> SynologyResult<()> {
        PackagesManager::stop(self.require_client()?, id).await
    }

    pub async fn install_package(&self, id: &str, volume: &str) -> SynologyResult<()> {
        PackagesManager::install(self.require_client()?, id, volume).await
    }

    pub async fn uninstall_package(&self, id: &str) -> SynologyResult<()> {
        PackagesManager::uninstall(self.require_client()?, id).await
    }

    // ─── Services ────────────────────────────────────────────────

    pub async fn list_services(&self) -> SynologyResult<Vec<ServiceStatus>> {
        ServicesManager::list(self.require_client()?).await
    }

    pub async fn get_smb_config(&self) -> SynologyResult<SmbConfig> {
        ServicesManager::get_smb_config(self.require_client()?).await
    }

    pub async fn get_nfs_config(&self) -> SynologyResult<NfsConfig> {
        ServicesManager::get_nfs_config(self.require_client()?).await
    }

    pub async fn get_ssh_config(&self) -> SynologyResult<SshConfig> {
        ServicesManager::get_ssh_config(self.require_client()?).await
    }

    pub async fn set_ssh_enabled(&self, enabled: bool) -> SynologyResult<()> {
        ServicesManager::set_ssh_enabled(self.require_client()?, enabled).await
    }

    // ─── Docker ──────────────────────────────────────────────────

    pub async fn list_docker_containers(&self) -> SynologyResult<Vec<DockerContainer>> {
        DockerManager::list_containers(self.require_client()?).await
    }

    pub async fn start_docker_container(&self, name: &str) -> SynologyResult<()> {
        DockerManager::start_container(self.require_client()?, name).await
    }

    pub async fn stop_docker_container(&self, name: &str) -> SynologyResult<()> {
        DockerManager::stop_container(self.require_client()?, name).await
    }

    pub async fn restart_docker_container(&self, name: &str) -> SynologyResult<()> {
        DockerManager::restart_container(self.require_client()?, name).await
    }

    pub async fn delete_docker_container(&self, name: &str, force: bool) -> SynologyResult<()> {
        DockerManager::delete_container(self.require_client()?, name, force).await
    }

    pub async fn list_docker_images(&self) -> SynologyResult<Vec<DockerImage>> {
        DockerManager::list_images(self.require_client()?).await
    }

    pub async fn pull_docker_image(&self, repository: &str, tag: &str) -> SynologyResult<()> {
        DockerManager::pull_image(self.require_client()?, repository, tag).await
    }

    pub async fn list_docker_networks(&self) -> SynologyResult<Vec<DockerNetwork>> {
        DockerManager::list_networks(self.require_client()?).await
    }

    pub async fn list_docker_projects(&self) -> SynologyResult<Vec<DockerProject>> {
        DockerManager::list_projects(self.require_client()?).await
    }

    pub async fn start_docker_project(&self, name: &str) -> SynologyResult<()> {
        DockerManager::start_project(self.require_client()?, name).await
    }

    pub async fn stop_docker_project(&self, name: &str) -> SynologyResult<()> {
        DockerManager::stop_project(self.require_client()?, name).await
    }

    // ─── Virtual Machines ────────────────────────────────────────

    pub async fn list_vms(&self) -> SynologyResult<Vec<VmGuest>> {
        VirtualizationManager::list_guests(self.require_client()?).await
    }

    pub async fn vm_power_on(&self, guest_id: &str) -> SynologyResult<()> {
        VirtualizationManager::power_on(self.require_client()?, guest_id).await
    }

    pub async fn vm_shutdown(&self, guest_id: &str) -> SynologyResult<()> {
        VirtualizationManager::shutdown(self.require_client()?, guest_id).await
    }

    pub async fn vm_force_shutdown(&self, guest_id: &str) -> SynologyResult<()> {
        VirtualizationManager::force_shutdown(self.require_client()?, guest_id).await
    }

    pub async fn list_vm_snapshots(&self, guest_id: &str) -> SynologyResult<Vec<VmSnapshot>> {
        VirtualizationManager::list_snapshots(self.require_client()?, guest_id).await
    }

    pub async fn take_vm_snapshot(&self, guest_id: &str, description: &str) -> SynologyResult<()> {
        VirtualizationManager::take_snapshot(self.require_client()?, guest_id, description).await
    }

    // ─── Download Station ────────────────────────────────────────

    pub async fn get_download_station_info(&self) -> SynologyResult<DownloadStationInfo> {
        DownloadStationManager::get_info(self.require_client()?).await
    }

    pub async fn list_download_tasks(&self) -> SynologyResult<Vec<DownloadTask>> {
        DownloadStationManager::list_tasks(self.require_client()?).await
    }

    pub async fn create_download_task(
        &self,
        uri: &str,
        destination: Option<&str>,
    ) -> SynologyResult<()> {
        DownloadStationManager::create_task(self.require_client()?, uri, destination).await
    }

    pub async fn pause_download(&self, task_id: &str) -> SynologyResult<()> {
        DownloadStationManager::pause_task(self.require_client()?, task_id).await
    }

    pub async fn resume_download(&self, task_id: &str) -> SynologyResult<()> {
        DownloadStationManager::resume_task(self.require_client()?, task_id).await
    }

    pub async fn delete_download(&self, task_id: &str, force: bool) -> SynologyResult<()> {
        DownloadStationManager::delete_task(self.require_client()?, task_id, force).await
    }

    pub async fn get_download_stats(&self) -> SynologyResult<DownloadStationStats> {
        DownloadStationManager::get_stats(self.require_client()?).await
    }

    // ─── Surveillance Station ────────────────────────────────────

    pub async fn get_surveillance_info(&self) -> SynologyResult<SurveillanceInfo> {
        SurveillanceManager::get_info(self.require_client()?).await
    }

    pub async fn list_cameras(&self) -> SynologyResult<Vec<Camera>> {
        SurveillanceManager::list_cameras(self.require_client()?).await
    }

    pub async fn get_camera_snapshot(&self, cam_id: &str) -> SynologyResult<Vec<u8>> {
        SurveillanceManager::get_snapshot(self.require_client()?, cam_id).await
    }

    pub async fn list_recordings(
        &self,
        cam_id: &str,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<Vec<Recording>> {
        SurveillanceManager::list_recordings(self.require_client()?, cam_id, offset, limit).await
    }

    // ─── Backup ──────────────────────────────────────────────────

    pub async fn list_backup_tasks(&self) -> SynologyResult<Vec<BackupTaskInfo>> {
        BackupManager::list_tasks(self.require_client()?).await
    }

    pub async fn start_backup_task(&self, task_id: &str) -> SynologyResult<()> {
        BackupManager::start_task(self.require_client()?, task_id).await
    }

    pub async fn cancel_backup_task(&self, task_id: &str) -> SynologyResult<()> {
        BackupManager::cancel_task(self.require_client()?, task_id).await
    }

    pub async fn list_backup_versions(&self, task_id: &str) -> SynologyResult<Vec<BackupVersion>> {
        BackupManager::list_versions(self.require_client()?, task_id).await
    }

    pub async fn list_active_backup_devices(&self) -> SynologyResult<Vec<ActiveBackupDevice>> {
        BackupManager::list_active_backup_devices(self.require_client()?).await
    }

    // ─── Security ────────────────────────────────────────────────

    pub async fn get_security_overview(&self) -> SynologyResult<SecurityOverview> {
        SecurityManager::get_overview(self.require_client()?).await
    }

    pub async fn list_blocked_ips(&self) -> SynologyResult<Vec<BlockedIp>> {
        SecurityManager::list_blocked_ips(self.require_client()?).await
    }

    pub async fn unblock_ip(&self, ip: &str) -> SynologyResult<()> {
        SecurityManager::unblock_ip(self.require_client()?, ip).await
    }

    pub async fn list_certificates(&self) -> SynologyResult<Vec<CertificateInfo>> {
        SecurityManager::list_certificates(self.require_client()?).await
    }

    pub async fn get_auto_block_config(&self) -> SynologyResult<AutoBlockConfig> {
        SecurityManager::get_auto_block_config(self.require_client()?).await
    }

    // ─── Hardware ────────────────────────────────────────────────

    pub async fn get_hardware_info(&self) -> SynologyResult<HardwareInfo> {
        HardwareManager::get_info(self.require_client()?).await
    }

    pub async fn get_ups_info(&self) -> SynologyResult<UpsInfo> {
        HardwareManager::get_ups(self.require_client()?).await
    }

    pub async fn get_power_schedule(&self) -> SynologyResult<PowerSchedule> {
        HardwareManager::get_power_schedule(self.require_client()?).await
    }

    // ─── Logs ────────────────────────────────────────────────────

    pub async fn get_system_logs(&self, offset: u64, limit: u64) -> SynologyResult<Vec<LogEntry>> {
        LogsManager::get_system_logs(self.require_client()?, offset, limit).await
    }

    pub async fn get_connection_logs(
        &self,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<Vec<ConnectionEntry>> {
        LogsManager::get_connection_logs(self.require_client()?, offset, limit).await
    }

    pub async fn get_active_connections(&self) -> SynologyResult<Vec<ConnectionEntry>> {
        LogsManager::get_active_connections(self.require_client()?).await
    }

    // ─── Notifications ───────────────────────────────────────────

    pub async fn get_notification_config(&self) -> SynologyResult<NotificationConfig> {
        NotificationsManager::get_config(self.require_client()?).await
    }

    pub async fn test_email_notification(&self) -> SynologyResult<()> {
        NotificationsManager::test_email(self.require_client()?).await
    }

    // ─── Dashboard ───────────────────────────────────────────────

    pub async fn get_dashboard(&self) -> SynologyResult<SynologyDashboard> {
        let client = self.require_client()?;

        // Gather data from multiple sources, tolerating individual failures
        let system_info = SystemManager::get_info(client).await.ok();
        let utilization = SystemManager::get_utilization(client).await.ok();
        let storage = StorageManager::get_overview(client).await.ok();
        let network = NetworkManager::get_overview(client).await.ok();
        let hardware = HardwareManager::get_info(client).await.ok();

        Ok(SynologyDashboard {
            system_info,
            utilization,
            storage,
            network,
            hardware,
        })
    }
}
