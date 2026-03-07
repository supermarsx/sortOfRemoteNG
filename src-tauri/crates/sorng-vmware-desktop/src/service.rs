//! Aggregate service façade for the VMware Desktop crate.
//!
//! `VmwDesktopService` owns the `VmRun` CLI driver and optional
//! `VmRestClient`, then delegates to the domain modules.  The Tauri `State`
//! wrapper holds `VmwDesktopServiceState = Arc<Mutex<VmwDesktopService>>`.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use crate::types::*;
use crate::vmrest::VmRestClient;
use crate::vmrun::VmRun;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe handle managed by Tauri.
pub type VmwDesktopServiceState = Arc<Mutex<VmwDesktopService>>;

/// Top-level service that aggregates all VMware Desktop subsystems.
pub struct VmwDesktopService {
    vmrun: Option<VmRun>,
    rest: Option<VmRestClient>,
    config: Option<VmwDesktopConfig>,
    host_info: Option<VmwHostInfo>,
    connected: bool,
}

impl VmwDesktopService {
    /// Create a new (disconnected) service.
    pub fn new() -> Self {
        Self {
            vmrun: None,
            rest: None,
            config: None,
            host_info: None,
            connected: false,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }

    fn require_vmrun(&self) -> VmwResult<&VmRun> {
        self.vmrun
            .as_ref()
            .ok_or_else(|| VmwError::not_connected())
    }

    // ── Connection ──────────────────────────────────────────────────

    /// Connect — detect vmrun, optionally start vmrest.
    pub async fn connect(&mut self, config: VmwDesktopConfig) -> VmwResult<VmwConnectionSummary> {
        if self.connected {
            return Err(VmwError::new(
                VmwErrorKind::AlreadyConnected,
                "Already connected",
            ));
        }

        // Detect / configure vmrun
        let vmrun = if let Some(ref path) = config.vmrun_path {
            VmRun::new(path, if cfg!(target_os = "macos") { "fusion" } else { "ws" }, config.timeout_secs)
        } else {
            VmRun::detect().map_err(|_| VmwError::vmrun_not_found())?
        };

        // Detect product
        let host_info = crate::prefs::detect_product().ok();

        // Configure vmrest if requested
        let rest = if let (Some(ref host), Some(port)) = (&config.vmrest_host, config.vmrest_port) {
            let url = format!("http://{}:{}", host, port);
            let user = config.vmrest_username.clone().unwrap_or_default();
            let pass = config.vmrest_password.clone().unwrap_or_default();
            let client = VmRestClient::new(host, port, &user, &pass)?;
            // Verify connectivity
            match client.ping().await {
                Ok(_) => Some(client),
                Err(e) => {
                    log::warn!("vmrest not reachable at {url}: {e}");
                    None
                }
            }
        } else {
            None
        };

        let vmrest_available = rest.is_some();
        let product = host_info
            .as_ref()
            .map(|h| h.product)
            .unwrap_or(VmwProduct::Unknown);
        let product_version = host_info.as_ref().and_then(|h| h.product_version.clone());

        self.vmrun = Some(vmrun);
        self.rest = rest;
        self.config = Some(config);
        self.host_info = host_info;
        self.connected = true;

        Ok(VmwConnectionSummary {
            product,
            product_version,
            vmrun_available: true,
            vmrest_available,
            vm_count: 0,
        })
    }

    /// Disconnect — tear down state.
    pub async fn disconnect(&mut self) -> VmwResult<()> {
        self.vmrun = None;
        self.rest = None;
        self.config = None;
        self.host_info = None;
        self.connected = false;
        Ok(())
    }

    /// Get current connection summary.
    pub fn connection_summary(&self) -> VmwConnectionSummary {
        VmwConnectionSummary {
            product: self
                .host_info
                .as_ref()
                .map(|h| h.product)
                .unwrap_or(VmwProduct::Unknown),
            product_version: self.host_info.as_ref().and_then(|h| h.product_version.clone()),
            vmrun_available: self.vmrun.is_some(),
            vmrest_available: self.rest.is_some(),
            vm_count: 0,
        }
    }

    /// Get detected host info.
    pub fn host_info(&self) -> VmwResult<VmwHostInfo> {
        self.host_info
            .clone()
            .ok_or_else(|| VmwError::new(VmwErrorKind::InternalError, "Host info not available"))
    }

    // ── VM Lifecycle ────────────────────────────────────────────────

    /// List VMs.
    pub async fn list_vms(&self) -> VmwResult<Vec<VmSummary>> {
        let vmrun = self.require_vmrun()?;
        let scan_dirs = vec![crate::prefs::get_default_vm_dir()];
        crate::vm::list_vms(vmrun, self.rest.as_ref(), &scan_dirs).await
    }

    /// Get detailed info for a VM.
    pub async fn get_vm(&self, vmx_path: &str) -> VmwResult<VmDetail> {
        let vmrun = self.require_vmrun()?;
        crate::vm::get_vm(vmrun, self.rest.as_ref(), vmx_path).await
    }

    /// Create a new VM.
    pub async fn create_vm(&self, req: CreateVmRequest) -> VmwResult<VmDetail> {
        let vmrun = self.require_vmrun()?;
        crate::vm::create_vm(vmrun, self.rest.as_ref(), req).await
    }

    /// Update VM configuration.
    pub async fn update_vm(&self, req: UpdateVmRequest) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vm::update_vm(vmrun, req).await
    }

    /// Delete a VM.
    pub async fn delete_vm(&self, vmx_path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vm::delete_vm(vmrun, self.rest.as_ref(), vmx_path).await
    }

    /// Clone a VM.
    pub async fn clone_vm(&self, req: CloneVmRequest) -> VmwResult<VmDetail> {
        let vmrun = self.require_vmrun()?;
        crate::vm::clone_vm(vmrun, self.rest.as_ref(), req).await
    }

    /// Register an existing VMX.
    pub async fn register_vm(&self, vmx_path: &str) -> VmwResult<String> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required to register VMs")
        })?;
        crate::vm::register_vm(rest, vmx_path).await
    }

    /// Unregister a VM.
    pub async fn unregister_vm(&self, id: &str) -> VmwResult<()> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required to unregister VMs")
        })?;
        crate::vm::unregister_vm(rest, id).await
    }

    /// Configure a NIC.
    pub async fn configure_nic(&self, req: ConfigureNicRequest) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vm::configure_nic(vmrun, req).await
    }

    /// Remove a NIC.
    pub async fn remove_nic(&self, vmx_path: &str, nic_index: u32) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vm::remove_nic(vmrun, vmx_path, nic_index).await
    }

    /// Configure CD/DVD.
    pub async fn configure_cdrom(&self, req: ConfigureCdromRequest) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vm::configure_cdrom(vmrun, req).await
    }

    // ── Power ───────────────────────────────────────────────────────

    /// Start a VM.
    pub async fn start_vm(&self, vmx_path: &str, gui: bool) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::power::start_vm(vmrun, vmx_path, gui).await
    }

    /// Stop a VM.
    pub async fn stop_vm(&self, vmx_path: &str, hard: bool) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::power::stop_vm(vmrun, vmx_path, hard).await
    }

    /// Reset a VM.
    pub async fn reset_vm(&self, vmx_path: &str, hard: bool) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::power::reset_vm(vmrun, vmx_path, hard).await
    }

    /// Suspend a VM.
    pub async fn suspend_vm(&self, vmx_path: &str, hard: bool) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::power::suspend_vm(vmrun, vmx_path, hard).await
    }

    /// Pause a VM.
    pub async fn pause_vm(&self, vmx_path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::power::pause_vm(vmrun, vmx_path).await
    }

    /// Unpause a VM.
    pub async fn unpause_vm(&self, vmx_path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::power::unpause_vm(vmrun, vmx_path).await
    }

    /// Get power state.
    pub async fn get_power_state(&self, vmx_path: &str) -> VmwResult<VmPowerState> {
        let vmrun = self.require_vmrun()?;
        crate::power::get_power_state(vmrun, vmx_path).await
    }

    /// Batch power operation on multiple VMs.
    pub async fn batch_power(
        &self,
        vmx_paths: &[String],
        action: PowerAction,
    ) -> VmwResult<BatchPowerResult> {
        let vmrun = self.require_vmrun()?;
        crate::power::batch_power(vmrun, vmx_paths, action).await
    }

    // ── Snapshots ───────────────────────────────────────────────────

    /// List snapshots.
    pub async fn list_snapshots(&self, vmx_path: &str) -> VmwResult<Vec<SnapshotInfo>> {
        let vmrun = self.require_vmrun()?;
        crate::snapshots::list_snapshots(vmrun, vmx_path).await
    }

    /// Get snapshot tree.
    pub async fn get_snapshot_tree(&self, vmx_path: &str) -> VmwResult<SnapshotTree> {
        let vmrun = self.require_vmrun()?;
        crate::snapshots::get_snapshot_tree(vmrun, vmx_path).await
    }

    /// Create a snapshot.
    pub async fn create_snapshot(
        &self,
        vmx_path: &str,
        req: CreateSnapshotRequest,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::snapshots::create_snapshot(vmrun, vmx_path, req).await
    }

    /// Delete a snapshot.
    pub async fn delete_snapshot(
        &self,
        vmx_path: &str,
        name: &str,
        delete_children: bool,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::snapshots::delete_snapshot(vmrun, vmx_path, name, delete_children).await
    }

    /// Revert to a snapshot.
    pub async fn revert_to_snapshot(&self, vmx_path: &str, name: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::snapshots::revert_to_snapshot(vmrun, vmx_path, name).await
    }

    /// Get a specific snapshot by name.
    pub async fn get_snapshot(&self, vmx_path: &str, name: &str) -> VmwResult<SnapshotInfo> {
        let vmrun = self.require_vmrun()?;
        crate::snapshots::get_snapshot(vmrun, vmx_path, name).await
    }

    // ── Guest Operations ────────────────────────────────────────────

    /// Execute a program in the guest.
    pub async fn exec_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        req: GuestExecRequest,
    ) -> VmwResult<GuestExecResult> {
        let vmrun = self.require_vmrun()?;
        crate::guest::exec_in_guest(vmrun, vmx_path, guest_user, guest_pass, req).await
    }

    /// Run a script in the guest.
    pub async fn run_script_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        req: GuestScriptRequest,
    ) -> VmwResult<GuestExecResult> {
        let vmrun = self.require_vmrun()?;
        crate::guest::run_script_in_guest(vmrun, vmx_path, guest_user, guest_pass, req).await
    }

    /// Copy a file from host to guest.
    pub async fn copy_to_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        host_path: &str,
        guest_path: &str,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::copy_to_guest(vmrun, vmx_path, guest_user, guest_pass, host_path, guest_path)
            .await
    }

    /// Copy a file from guest to host.
    pub async fn copy_from_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        guest_path: &str,
        host_path: &str,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::copy_from_guest(
            vmrun, vmx_path, guest_user, guest_pass, guest_path, host_path,
        )
        .await
    }

    /// Create a directory in the guest.
    pub async fn create_directory_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        dir_path: &str,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::create_directory_in_guest(vmrun, vmx_path, guest_user, guest_pass, dir_path)
            .await
    }

    /// Delete a directory in the guest.
    pub async fn delete_directory_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        dir_path: &str,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::delete_directory_in_guest(vmrun, vmx_path, guest_user, guest_pass, dir_path)
            .await
    }

    /// Delete a file in the guest.
    pub async fn delete_file_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        file_path: &str,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::delete_file_in_guest(vmrun, vmx_path, guest_user, guest_pass, file_path)
            .await
    }

    /// Check if file exists in guest.
    pub async fn file_exists_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        file_path: &str,
    ) -> VmwResult<bool> {
        let vmrun = self.require_vmrun()?;
        crate::guest::file_exists_in_guest(vmrun, vmx_path, guest_user, guest_pass, file_path)
            .await
    }

    /// Check if directory exists in guest.
    pub async fn directory_exists_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        dir_path: &str,
    ) -> VmwResult<bool> {
        let vmrun = self.require_vmrun()?;
        crate::guest::directory_exists_in_guest(vmrun, vmx_path, guest_user, guest_pass, dir_path)
            .await
    }

    /// Rename/move a file in the guest.
    pub async fn rename_file_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        old_path: &str,
        new_path: &str,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::rename_file_in_guest(
            vmrun, vmx_path, guest_user, guest_pass, old_path, new_path,
        )
        .await
    }

    /// List files in a guest directory.
    pub async fn list_directory_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        dir_path: &str,
    ) -> VmwResult<Vec<String>> {
        let vmrun = self.require_vmrun()?;
        crate::guest::list_directory_in_guest(vmrun, vmx_path, guest_user, guest_pass, dir_path)
            .await
    }

    /// List processes in the guest.
    pub async fn list_processes_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
    ) -> VmwResult<Vec<GuestProcess>> {
        let vmrun = self.require_vmrun()?;
        crate::guest::list_processes_in_guest(vmrun, vmx_path, guest_user, guest_pass).await
    }

    /// Kill a process in the guest.
    pub async fn kill_process_in_guest(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        pid: u64,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::kill_process_in_guest(vmrun, vmx_path, guest_user, guest_pass, pid).await
    }

    /// Read a guest variable.
    pub async fn read_variable(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        var_type: &str,
        name: &str,
    ) -> VmwResult<String> {
        let vmrun = self.require_vmrun()?;
        crate::guest::read_variable(vmrun, vmx_path, guest_user, guest_pass, var_type, name).await
    }

    /// Write a guest variable.
    pub async fn write_variable(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
        var_type: &str,
        name: &str,
        value: &str,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::write_variable(vmrun, vmx_path, guest_user, guest_pass, var_type, name, value)
            .await
    }

    /// List guest environment variables.
    pub async fn list_env_vars(
        &self,
        vmx_path: &str,
        guest_user: &str,
        guest_pass: &str,
    ) -> VmwResult<Vec<GuestEnvVar>> {
        let vmrun = self.require_vmrun()?;
        crate::guest::list_env_vars(vmrun, vmx_path, guest_user, guest_pass).await
    }

    /// Get VMware Tools status.
    pub async fn get_tools_status(&self, vmx_path: &str) -> VmwResult<ToolsStatus> {
        let vmrun = self.require_vmrun()?;
        crate::guest::get_tools_status(vmrun, vmx_path).await
    }

    /// Install VMware Tools.
    pub async fn install_tools(&self, vmx_path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::guest::install_tools(vmrun, vmx_path).await
    }

    /// Get the guest IP address.
    pub async fn get_ip_address(&self, vmx_path: &str) -> VmwResult<String> {
        let vmrun = self.require_vmrun()?;
        crate::guest::get_ip_address(vmrun, vmx_path).await
    }

    // ── Shared Folders ──────────────────────────────────────────────

    /// Enable shared folders on a VM.
    pub async fn enable_shared_folders(&self, vmx_path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::shared_folders::enable_shared_folders(vmrun, vmx_path).await
    }

    /// Disable shared folders on a VM.
    pub async fn disable_shared_folders(&self, vmx_path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::shared_folders::disable_shared_folders(vmrun, vmx_path).await
    }

    /// List shared folders.
    pub async fn list_shared_folders(&self, vmx_path: &str) -> VmwResult<Vec<SharedFolder>> {
        crate::shared_folders::list_shared_folders(vmx_path, self.rest.as_ref(), None).await
    }

    /// Add a shared folder.
    pub async fn add_shared_folder(
        &self,
        vmx_path: &str,
        req: SharedFolderRequest,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::shared_folders::add_shared_folder(vmrun, vmx_path, req).await
    }

    /// Remove a shared folder.
    pub async fn remove_shared_folder(&self, vmx_path: &str, name: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::shared_folders::remove_shared_folder(vmrun, vmx_path, name).await
    }

    /// Set shared folder read/write state.
    pub async fn set_shared_folder_state(
        &self,
        vmx_path: &str,
        name: &str,
        host_path: &str,
        writable: bool,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::shared_folders::set_shared_folder_state(vmrun, vmx_path, name, host_path, writable)
            .await
    }

    // ── Networking ──────────────────────────────────────────────────

    /// List virtual networks (requires vmrest).
    pub async fn list_networks(&self) -> VmwResult<Vec<VirtualNetwork>> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(
                VmwErrorKind::VmRestNotAvailable,
                "vmrest is required for network management",
            )
        })?;
        crate::networks::list_networks(rest).await
    }

    /// Get a network by name.
    pub async fn get_network(&self, name: &str) -> VmwResult<VirtualNetwork> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::get_network(rest, name).await
    }

    /// Create a network.
    pub async fn create_network(&self, req: CreateNetworkRequest) -> VmwResult<VirtualNetwork> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::create_network(rest, req).await
    }

    /// Update a network.
    pub async fn update_network(
        &self,
        name: &str,
        network_type: &str,
        subnet: Option<&str>,
        mask: Option<&str>,
    ) -> VmwResult<VirtualNetwork> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::update_network(rest, name, network_type, subnet, mask).await
    }

    /// Delete a network.
    pub async fn delete_network(&self, name: &str) -> VmwResult<()> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::delete_network(rest, name).await
    }

    /// List port forwards for a network.
    pub async fn list_port_forwards(&self, network: &str) -> VmwResult<Vec<NatPortForward>> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::list_port_forwards(rest, network).await
    }

    /// Set a port forward.
    pub async fn set_port_forward(
        &self,
        network: &str,
        req: AddPortForwardRequest,
    ) -> VmwResult<()> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::set_port_forward(rest, network, req).await
    }

    /// Delete a port forward.
    pub async fn delete_port_forward(
        &self,
        network: &str,
        protocol: &str,
        host_port: u16,
    ) -> VmwResult<()> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::delete_port_forward(rest, network, protocol, host_port).await
    }

    /// DHCP leases for a network.
    pub async fn get_dhcp_leases(&self, network: &str) -> VmwResult<Vec<DhcpLease>> {
        let rest = self.rest.as_ref().ok_or_else(|| {
            VmwError::new(VmwErrorKind::VmRestNotAvailable, "vmrest required")
        })?;
        crate::networks::get_dhcp_leases(rest, network).await
    }

    /// Read networking config file.
    pub fn read_networking_config(
        &self,
    ) -> VmwResult<std::collections::HashMap<String, String>> {
        crate::networks::read_networking_config()
    }

    // ── VMDK ────────────────────────────────────────────────────────

    /// Create a new VMDK.
    pub async fn create_vmdk(&self, req: CreateVmdkRequest) -> VmwResult<VmdkInfo> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::create_vmdk(vmrun, req).await
    }

    /// Get VMDK info.
    pub fn get_vmdk_info(&self, path: &str) -> VmwResult<VmdkInfo> {
        crate::vmdk::get_vmdk_info(path)
    }

    /// Defragment a VMDK.
    pub async fn defragment_vmdk(&self, path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::defragment_vmdk(vmrun, path).await
    }

    /// Shrink a VMDK.
    pub async fn shrink_vmdk(&self, path: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::shrink_vmdk(vmrun, path).await
    }

    /// Expand a VMDK.
    pub async fn expand_vmdk(&self, path: &str, new_size_mb: u64) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::expand_vmdk(vmrun, path, new_size_mb).await
    }

    /// Convert a VMDK.
    pub async fn convert_vmdk(
        &self,
        source: &str,
        disk_type: &str,
        dest: Option<&str>,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::convert_vmdk(vmrun, source, disk_type, dest).await
    }

    /// Rename/move a VMDK.
    pub async fn rename_vmdk(&self, source: &str, dest: &str) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::rename_vmdk(vmrun, source, dest).await
    }

    /// Add a disk to a VM.
    pub async fn add_disk_to_vm(&self, req: AddDiskRequest) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::add_disk_to_vm(vmrun, req).await
    }

    /// Remove a disk from a VM.
    pub async fn remove_disk_from_vm(
        &self,
        vmx_path: &str,
        controller_type: &str,
        bus: u32,
        unit: u32,
    ) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::vmdk::remove_disk_from_vm(vmrun, vmx_path, controller_type, bus, unit).await
    }

    /// List disks attached to a VM.
    pub fn list_vm_disks(&self, vmx_path: &str) -> VmwResult<Vec<VmDisk>> {
        crate::vmdk::list_vm_disks(vmx_path)
    }

    // ── OVF ─────────────────────────────────────────────────────────

    /// Import an OVF/OVA.
    pub async fn import_ovf(&self, req: OvfImportRequest) -> VmwResult<String> {
        let vmrun = self.require_vmrun()?;
        crate::ovf::import_ovf(vmrun, req).await
    }

    /// Export to OVF/OVA.
    pub async fn export_ovf(&self, req: OvfExportRequest) -> VmwResult<()> {
        let vmrun = self.require_vmrun()?;
        crate::ovf::export_ovf(vmrun, req).await
    }

    // ── VMX ─────────────────────────────────────────────────────────

    /// Parse a VMX file.
    pub fn parse_vmx(&self, vmx_path: &str) -> VmwResult<VmxFile> {
        crate::vmx::parse_vmx(vmx_path)
    }

    /// Update keys in a VMX file.
    pub fn update_vmx_keys(
        &self,
        vmx_path: &str,
        updates: &std::collections::HashMap<String, String>,
    ) -> VmwResult<()> {
        crate::vmx::update_vmx_keys(vmx_path, updates)
    }

    /// Remove keys from a VMX file.
    pub fn remove_vmx_keys(&self, vmx_path: &str, keys: &[String]) -> VmwResult<()> {
        crate::vmx::remove_vmx_keys(vmx_path, keys)
    }

    /// Discover VMX files in a directory.
    pub fn discover_vmx_files(&self, dir: &str) -> VmwResult<Vec<String>> {
        crate::vmx::discover_vmx_files(dir)
    }

    // ── Preferences ─────────────────────────────────────────────────

    /// Read VMware preferences.
    pub fn read_preferences(&self) -> VmwResult<VmwPreferences> {
        crate::prefs::read_preferences()
    }

    /// Get default VM directory.
    pub fn get_default_vm_dir(&self) -> String {
        crate::prefs::get_default_vm_dir()
    }

    /// Set a preference.
    pub fn set_preference(&self, key: &str, value: &str) -> VmwResult<()> {
        crate::prefs::set_preference(key, value)
    }
}
