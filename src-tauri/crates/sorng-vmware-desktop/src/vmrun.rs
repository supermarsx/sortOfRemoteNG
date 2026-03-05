//! VMware `vmrun` CLI wrapper.
//!
//! `vmrun` is the primary command-line tool shipped with Workstation, Player,
//! and Fusion.  This module wraps every useful sub-command in an ergonomic
//! async Rust API, parsing stdout/stderr into typed results.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Wraps the vmrun executable and provides typed access to its commands.
#[derive(Debug, Clone)]
pub struct VmRun {
    /// Absolute path to the vmrun binary.
    pub path: PathBuf,
    /// Host type flag: either "-T ws" (Workstation / Player) or "-T fusion".
    pub host_type: String,
    /// Default timeout for commands (seconds).
    pub timeout_secs: u64,
}

impl VmRun {
    // ── Construction ─────────────────────────────────────────────────────

    /// Try to auto-detect vmrun on the current platform.
    pub fn detect() -> VmwResult<Self> {
        let path = Self::find_vmrun()?;
        let host_type = if cfg!(target_os = "macos") {
            "fusion".to_string()
        } else {
            "ws".to_string()
        };
        Ok(Self {
            path,
            host_type,
            timeout_secs: 60,
        })
    }

    /// Create with an explicit path.
    pub fn new(path: impl Into<PathBuf>, host_type: impl Into<String>, timeout: u64) -> Self {
        Self {
            path: path.into(),
            host_type: host_type.into(),
            timeout_secs: timeout,
        }
    }

    fn find_vmrun() -> VmwResult<PathBuf> {
        // Common locations
        let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
            vec![
                PathBuf::from(r"C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe"),
                PathBuf::from(r"C:\Program Files\VMware\VMware Workstation\vmrun.exe"),
                PathBuf::from(r"C:\Program Files (x86)\VMware\VMware Player\vmrun.exe"),
                PathBuf::from(r"C:\Program Files\VMware\VMware Player\vmrun.exe"),
            ]
        } else if cfg!(target_os = "macos") {
            vec![
                PathBuf::from("/Applications/VMware Fusion.app/Contents/Library/vmrun"),
                PathBuf::from("/Applications/VMware Fusion.app/Contents/Public/vmrun"),
            ]
        } else {
            vec![
                PathBuf::from("/usr/bin/vmrun"),
                PathBuf::from("/usr/local/bin/vmrun"),
            ]
        };

        for p in &candidates {
            if p.exists() {
                return Ok(p.clone());
            }
        }
        // Fall back to PATH
        if let Ok(output) = std::process::Command::new(if cfg!(target_os = "windows") { "where" } else { "which" })
            .arg("vmrun")
            .output()
        {
            if output.status.success() {
                let s = String::from_utf8_lossy(&output.stdout);
                let line = s.lines().next().unwrap_or("").trim();
                if !line.is_empty() {
                    return Ok(PathBuf::from(line));
                }
            }
        }
        Err(VmwError::vmrun_not_found())
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    async fn run(&self, args: &[&str]) -> VmwResult<String> {
        let mut cmd = Command::new(&self.path);
        cmd.arg("-T").arg(&self.host_type);
        for a in args {
            cmd.arg(a);
        }
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(self.timeout_secs),
            cmd.output(),
        )
        .await
        .map_err(|_| VmwError::new(VmwErrorKind::Timeout, "vmrun command timed out"))?
        .map_err(|e| VmwError::io(e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            let msg = if stderr.trim().is_empty() { &stdout } else { &stderr };
            return Err(VmwError::command_failed("vmrun", msg.trim()));
        }
        Ok(stdout)
    }

    async fn run_long(&self, args: &[&str], timeout_secs: u64) -> VmwResult<String> {
        let mut cmd = Command::new(&self.path);
        cmd.arg("-T").arg(&self.host_type);
        for a in args {
            cmd.arg(a);
        }
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            cmd.output(),
        )
        .await
        .map_err(|_| VmwError::new(VmwErrorKind::Timeout, "vmrun command timed out"))?
        .map_err(|e| VmwError::io(e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            let msg = if stderr.trim().is_empty() { &stdout } else { &stderr };
            return Err(VmwError::command_failed("vmrun", msg.trim()));
        }
        Ok(stdout)
    }

    // ── VM Lifecycle ─────────────────────────────────────────────────────

    /// List absolute paths of all running VMs.
    pub async fn list(&self) -> VmwResult<Vec<String>> {
        let out = self.run(&["list"]).await?;
        let mut vms = Vec::new();
        for line in out.lines().skip(1) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                vms.push(trimmed.to_string());
            }
        }
        Ok(vms)
    }

    /// Power on a VM.
    pub async fn start(&self, vmx: &str, gui: bool) -> VmwResult<()> {
        let mode = if gui { "gui" } else { "nogui" };
        self.run(&["start", vmx, mode]).await?;
        Ok(())
    }

    /// Power off a VM (hard).
    pub async fn stop(&self, vmx: &str, hard: bool) -> VmwResult<()> {
        let mode = if hard { "hard" } else { "soft" };
        self.run(&["stop", vmx, mode]).await?;
        Ok(())
    }

    /// Reset a VM.
    pub async fn reset(&self, vmx: &str, hard: bool) -> VmwResult<()> {
        let mode = if hard { "hard" } else { "soft" };
        self.run(&["reset", vmx, mode]).await?;
        Ok(())
    }

    /// Suspend a VM.
    pub async fn suspend(&self, vmx: &str, hard: bool) -> VmwResult<()> {
        let mode = if hard { "hard" } else { "soft" };
        self.run(&["suspend", vmx, mode]).await?;
        Ok(())
    }

    /// Pause a VM.
    pub async fn pause(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["pause", vmx]).await?;
        Ok(())
    }

    /// Unpause a VM.
    pub async fn unpause(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["unpause", vmx]).await?;
        Ok(())
    }

    /// Delete a VM (deletes all files).
    pub async fn delete_vm(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["deleteVM", vmx]).await?;
        Ok(())
    }

    // ── Snapshots ────────────────────────────────────────────────────────

    /// List snapshots for a VM.
    pub async fn list_snapshots(&self, vmx: &str) -> VmwResult<Vec<String>> {
        let out = self.run(&["listSnapshots", vmx]).await?;
        let mut snaps = Vec::new();
        for line in out.lines().skip(1) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                snaps.push(trimmed.to_string());
            }
        }
        Ok(snaps)
    }

    /// Create a snapshot.
    pub async fn snapshot(&self, vmx: &str, name: &str) -> VmwResult<()> {
        self.run(&["snapshot", vmx, name]).await?;
        Ok(())
    }

    /// Revert to a snapshot.
    pub async fn revert_to_snapshot(&self, vmx: &str, name: &str) -> VmwResult<()> {
        self.run(&["revertToSnapshot", vmx, name]).await?;
        Ok(())
    }

    /// Delete a snapshot.
    pub async fn delete_snapshot(&self, vmx: &str, name: &str, and_children: bool) -> VmwResult<()> {
        if and_children {
            self.run(&["deleteSnapshot", vmx, name, "andDeleteChildren"]).await?;
        } else {
            self.run(&["deleteSnapshot", vmx, name]).await?;
        }
        Ok(())
    }

    // ── Cloning ──────────────────────────────────────────────────────────

    /// Clone a VM (Workstation Pro / Fusion Pro only).
    pub async fn clone_vm(
        &self,
        source_vmx: &str,
        dest_vmx: &str,
        clone_type: &str,
        snapshot_name: Option<&str>,
    ) -> VmwResult<()> {
        let ct = match clone_type {
            "linked" => "linked",
            _ => "full",
        };
        let mut args: Vec<&str> = vec!["clone", source_vmx, dest_vmx, ct];
        if let Some(snap) = snapshot_name {
            args.push("-snapshot");
            args.push(snap);
        }
        self.run_long(&args, 600).await?;
        Ok(())
    }

    // ── Guest Operations ─────────────────────────────────────────────────

    /// Run a program in the guest.
    pub async fn run_program_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        program: &str,
        args_str: Option<&str>,
        no_wait: bool,
        interactive: bool,
    ) -> VmwResult<String> {
        let mut cmd_args: Vec<&str> = vec!["-gu", user, "-gp", pass];
        if no_wait {
            cmd_args.push("-noWait");
        }
        if interactive {
            cmd_args.push("-interactive");
        }
        cmd_args.extend_from_slice(&["runProgramInGuest", vmx, program]);
        if let Some(a) = args_str {
            cmd_args.push(a);
        }
        self.run_long(&cmd_args, 300).await
    }

    /// Run a script in the guest (bash, cmd, powershell, etc.).
    pub async fn run_script_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        interpreter: &str,
        script_text: &str,
        no_wait: bool,
    ) -> VmwResult<String> {
        let mut cmd_args: Vec<&str> = vec!["-gu", user, "-gp", pass];
        if no_wait {
            cmd_args.push("-noWait");
        }
        cmd_args.extend_from_slice(&["runScriptInGuest", vmx, interpreter, script_text]);
        self.run_long(&cmd_args, 300).await
    }

    /// Copy a file from host to guest.
    pub async fn copy_file_from_host_to_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        host_path: &str,
        guest_path: &str,
    ) -> VmwResult<()> {
        self.run(&[
            "-gu", user, "-gp", pass,
            "copyFileFromHostToGuest", vmx, host_path, guest_path,
        ]).await?;
        Ok(())
    }

    /// Copy a file from guest to host.
    pub async fn copy_file_from_guest_to_host(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        guest_path: &str,
        host_path: &str,
    ) -> VmwResult<()> {
        self.run(&[
            "-gu", user, "-gp", pass,
            "copyFileFromGuestToHost", vmx, guest_path, host_path,
        ]).await?;
        Ok(())
    }

    /// Create a directory in the guest.
    pub async fn create_directory_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<()> {
        self.run(&[
            "-gu", user, "-gp", pass,
            "createDirectoryInGuest", vmx, dir_path,
        ]).await?;
        Ok(())
    }

    /// Delete a directory in the guest.
    pub async fn delete_directory_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<()> {
        self.run(&[
            "-gu", user, "-gp", pass,
            "deleteDirectoryInGuest", vmx, dir_path,
        ]).await?;
        Ok(())
    }

    /// Delete a file in the guest.
    pub async fn delete_file_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        file_path: &str,
    ) -> VmwResult<()> {
        self.run(&[
            "-gu", user, "-gp", pass,
            "deleteFileInGuest", vmx, file_path,
        ]).await?;
        Ok(())
    }

    /// Check if a file exists in the guest.
    pub async fn file_exists_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        file_path: &str,
    ) -> VmwResult<bool> {
        match self
            .run(&["-gu", user, "-gp", pass, "fileExistsInGuest", vmx, file_path])
            .await
        {
            Ok(_) => Ok(true),
            Err(e) if matches!(e.kind, VmwErrorKind::CommandFailed) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Check if a directory exists in the guest.
    pub async fn directory_exists_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<bool> {
        match self
            .run(&["-gu", user, "-gp", pass, "directoryExistsInGuest", vmx, dir_path])
            .await
        {
            Ok(_) => Ok(true),
            Err(e) if matches!(e.kind, VmwErrorKind::CommandFailed) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Rename a file in the guest.
    pub async fn rename_file_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        old_name: &str,
        new_name: &str,
    ) -> VmwResult<()> {
        self.run(&[
            "-gu", user, "-gp", pass,
            "renameFileInGuest", vmx, old_name, new_name,
        ]).await?;
        Ok(())
    }

    /// List directory contents in the guest.
    pub async fn list_directory_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        dir_path: &str,
    ) -> VmwResult<Vec<String>> {
        let out = self.run(&[
            "-gu", user, "-gp", pass,
            "listDirectoryInGuest", vmx, dir_path,
        ]).await?;
        Ok(out.lines().map(|l| l.to_string()).collect())
    }

    /// List running processes in the guest.
    pub async fn list_processes_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
    ) -> VmwResult<String> {
        self.run(&["-gu", user, "-gp", pass, "listProcessesInGuest", vmx]).await
    }

    /// Kill a guest process by PID.
    pub async fn kill_process_in_guest(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        pid: u64,
    ) -> VmwResult<()> {
        let pid_str = pid.to_string();
        self.run(&["-gu", user, "-gp", pass, "killProcessInGuest", vmx, &pid_str]).await?;
        Ok(())
    }

    /// Read an environment variable in the guest.
    pub async fn read_variable(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        var_type: &str,
        name: &str,
    ) -> VmwResult<String> {
        let out = self.run(&[
            "-gu", user, "-gp", pass,
            "readVariable", vmx, var_type, name,
        ]).await?;
        Ok(out.trim().to_string())
    }

    /// Write a variable to the VMX runtime or guest environment.
    pub async fn write_variable(
        &self,
        vmx: &str,
        user: &str,
        pass: &str,
        var_type: &str,
        name: &str,
        value: &str,
    ) -> VmwResult<()> {
        self.run(&[
            "-gu", user, "-gp", pass,
            "writeVariable", vmx, var_type, name, value,
        ]).await?;
        Ok(())
    }

    // ── Shared Folders ───────────────────────────────────────────────────

    /// Enable shared folders for a VM.
    pub async fn enable_shared_folders(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["enableSharedFolders", vmx]).await?;
        Ok(())
    }

    /// Disable shared folders for a VM.
    pub async fn disable_shared_folders(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["disableSharedFolders", vmx]).await?;
        Ok(())
    }

    /// Add a shared folder.
    pub async fn add_shared_folder(
        &self,
        vmx: &str,
        share_name: &str,
        host_path: &str,
    ) -> VmwResult<()> {
        self.run(&["addSharedFolder", vmx, share_name, host_path]).await?;
        Ok(())
    }

    /// Remove a shared folder.
    pub async fn remove_shared_folder(&self, vmx: &str, share_name: &str) -> VmwResult<()> {
        self.run(&["removeSharedFolder", vmx, share_name]).await?;
        Ok(())
    }

    /// Set shared folder writable/read-only.
    pub async fn set_shared_folder_state(
        &self,
        vmx: &str,
        share_name: &str,
        host_path: &str,
        writable: bool,
    ) -> VmwResult<()> {
        let perm = if writable { "writable" } else { "readonly" };
        self.run(&["setSharedFolderState", vmx, share_name, host_path, perm]).await?;
        Ok(())
    }

    // ── Network Adapters ─────────────────────────────────────────────────

    /// List virtual network adapters for a VM (Workstation only).
    pub async fn list_network_adapters(&self, vmx: &str) -> VmwResult<String> {
        self.run(&["listNetworkAdapters", vmx]).await
    }

    // ── VMware Tools & IP ────────────────────────────────────────────────

    /// Get the IP address of the guest.
    pub async fn get_guest_ip_address(&self, vmx: &str, wait: bool) -> VmwResult<String> {
        let mut args: Vec<&str> = vec!["getGuestIPAddress", vmx];
        if wait {
            args.push("-wait");
        }
        let out = self.run(&args).await?;
        Ok(out.trim().to_string())
    }

    /// Check if VMware Tools is running in the guest.
    pub async fn check_tools_state(&self, vmx: &str) -> VmwResult<String> {
        let out = self.run(&["checkToolsState", vmx]).await?;
        Ok(out.trim().to_string())
    }

    /// Install VMware Tools in the guest.
    pub async fn install_tools(&self, vmx: &str) -> VmwResult<()> {
        self.run(&["installTools", vmx]).await?;
        Ok(())
    }

    // ── OVF / OVA ────────────────────────────────────────────────────────

    /// Import an OVF/OVA (via ovftool if available alongside vmrun).
    pub async fn import_ovf(&self, source: &str, dest_vmx: &str) -> VmwResult<()> {
        // vmrun does not have import; we look for ovftool next to vmrun
        let ovftool = self.find_ovftool()?;
        let mut cmd = Command::new(&ovftool);
        cmd.arg(source).arg(dest_vmx);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("ovftool", stderr.trim()));
        }
        Ok(())
    }

    /// Export a VM to OVF/OVA.
    pub async fn export_ovf(&self, vmx: &str, dest: &str) -> VmwResult<()> {
        let ovftool = self.find_ovftool()?;
        let mut cmd = Command::new(&ovftool);
        cmd.arg(vmx).arg(dest);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("ovftool", stderr.trim()));
        }
        Ok(())
    }

    fn find_ovftool(&self) -> VmwResult<PathBuf> {
        let dir = self.path.parent().unwrap_or(Path::new(""));
        let candidates = if cfg!(target_os = "windows") {
            vec![
                dir.join("ovftool").join("ovftool.exe"),
                dir.join("OVFTool").join("ovftool.exe"),
                PathBuf::from(r"C:\Program Files\VMware\VMware OVF Tool\ovftool.exe"),
            ]
        } else if cfg!(target_os = "macos") {
            vec![
                dir.join("ovftool"),
                dir.parent()
                    .unwrap_or(Path::new(""))
                    .join("OVFTool")
                    .join("ovftool"),
            ]
        } else {
            vec![
                PathBuf::from("/usr/bin/ovftool"),
                PathBuf::from("/usr/local/bin/ovftool"),
            ]
        };
        for c in &candidates {
            if c.exists() {
                return Ok(c.clone());
            }
        }
        Err(VmwError::new(
            VmwErrorKind::VmRunNotFound,
            "ovftool executable not found",
        ))
    }

    // ── VMDK ─────────────────────────────────────────────────────────────

    /// Create a virtual disk using vmware-vdiskmanager (ships with WS/Fusion).
    pub async fn create_disk(
        &self,
        path: &str,
        size_mb: u64,
        disk_type: Option<&str>,
        adapter_type: Option<&str>,
    ) -> VmwResult<()> {
        let vdm = self.find_vdiskmanager()?;
        let size_str = format!("{}MB", size_mb);
        let mut cmd = Command::new(&vdm);
        cmd.arg("-c").arg("-s").arg(&size_str);
        if let Some(dt) = disk_type {
            let t = match dt {
                "monolithicFlat" => "2",
                "twoGbMaxExtentSparse" => "1",
                "twoGbMaxExtentFlat" => "4",
                _ => "0", // monolithicSparse (default)
            };
            cmd.arg("-t").arg(t);
        }
        if let Some(at) = adapter_type {
            cmd.arg("-a").arg(at);
        }
        cmd.arg(path);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("vmware-vdiskmanager", stderr.trim()));
        }
        Ok(())
    }

    /// Defragment a virtual disk.
    pub async fn defragment_disk(&self, vmdk_path: &str) -> VmwResult<()> {
        let vdm = self.find_vdiskmanager()?;
        let mut cmd = Command::new(&vdm);
        cmd.arg("-d").arg(vmdk_path);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("vmware-vdiskmanager", stderr.trim()));
        }
        Ok(())
    }

    /// Shrink a virtual disk.
    pub async fn shrink_disk(&self, vmdk_path: &str) -> VmwResult<()> {
        let vdm = self.find_vdiskmanager()?;
        let mut cmd = Command::new(&vdm);
        cmd.arg("-k").arg(vmdk_path);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("vmware-vdiskmanager", stderr.trim()));
        }
        Ok(())
    }

    /// Expand a virtual disk.
    pub async fn expand_disk(&self, vmdk_path: &str, new_size_mb: u64) -> VmwResult<()> {
        let vdm = self.find_vdiskmanager()?;
        let size_str = format!("{}MB", new_size_mb);
        let mut cmd = Command::new(&vdm);
        cmd.arg("-x").arg(&size_str).arg(vmdk_path);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("vmware-vdiskmanager", stderr.trim()));
        }
        Ok(())
    }

    /// Convert a virtual disk type.
    pub async fn convert_disk(&self, source: &str, dest: &str, disk_type: &str) -> VmwResult<()> {
        let vdm = self.find_vdiskmanager()?;
        let t = match disk_type {
            "monolithicFlat" => "2",
            "twoGbMaxExtentSparse" => "1",
            "twoGbMaxExtentFlat" => "4",
            _ => "0",
        };
        let mut cmd = Command::new(&vdm);
        cmd.arg("-r").arg(source).arg("-t").arg(t).arg(dest);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("vmware-vdiskmanager", stderr.trim()));
        }
        Ok(())
    }

    /// Rename a VMDK.
    pub async fn rename_disk(&self, source: &str, dest: &str) -> VmwResult<()> {
        let vdm = self.find_vdiskmanager()?;
        let mut cmd = Command::new(&vdm);
        cmd.arg("-n").arg(source).arg(dest);
        let output = cmd.output().await.map_err(|e| VmwError::io(e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VmwError::command_failed("vmware-vdiskmanager", stderr.trim()));
        }
        Ok(())
    }

    fn find_vdiskmanager(&self) -> VmwResult<PathBuf> {
        let dir = self.path.parent().unwrap_or(Path::new(""));
        let name = if cfg!(target_os = "windows") {
            "vmware-vdiskmanager.exe"
        } else {
            "vmware-vdiskmanager"
        };
        let candidate = dir.join(name);
        if candidate.exists() {
            return Ok(candidate);
        }
        Err(VmwError::new(
            VmwErrorKind::VmRunNotFound,
            "vmware-vdiskmanager executable not found",
        ))
    }
}
