//! Guest operations — execute commands, scripts, file transfers,
//! directory ops, process management, environment variables, tools.

use crate::error::VmwResult;
use crate::types::*;
use crate::vmrun::VmRun;

/// Run a program inside the guest.
pub async fn exec_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    req: GuestExecRequest,
) -> VmwResult<GuestExecResult> {
    let output = vmrun
        .run_program_in_guest(
            vmx_path,
            guest_user,
            guest_pass,
            &req.program,
            &req.arguments,
            req.wait.unwrap_or(true),
            req.interactive.unwrap_or(false),
        )
        .await?;
    Ok(GuestExecResult {
        exit_code: 0,
        stdout: Some(output.clone()),
        stderr: None,
        duration_ms: None,
    })
}

/// Run a script inside the guest using an interpreter.
pub async fn run_script_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    req: GuestScriptRequest,
) -> VmwResult<GuestExecResult> {
    let output = vmrun
        .run_script_in_guest(
            vmx_path,
            guest_user,
            guest_pass,
            &req.interpreter,
            &req.script_text,
        )
        .await?;
    Ok(GuestExecResult {
        exit_code: 0,
        stdout: Some(output),
        stderr: None,
        duration_ms: None,
    })
}

/// Copy a file from the host to the guest.
pub async fn copy_to_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    host_path: &str,
    guest_path: &str,
) -> VmwResult<()> {
    vmrun
        .copy_file_from_host_to_guest(vmx_path, guest_user, guest_pass, host_path, guest_path)
        .await
}

/// Copy a file from the guest to the host.
pub async fn copy_from_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    guest_path: &str,
    host_path: &str,
) -> VmwResult<()> {
    vmrun
        .copy_file_from_guest_to_host(vmx_path, guest_user, guest_pass, guest_path, host_path)
        .await
}

/// Create a directory inside the guest.
pub async fn create_directory_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    dir_path: &str,
) -> VmwResult<()> {
    vmrun
        .create_directory_in_guest(vmx_path, guest_user, guest_pass, dir_path)
        .await
}

/// Delete a directory inside the guest.
pub async fn delete_directory_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    dir_path: &str,
) -> VmwResult<()> {
    vmrun
        .delete_directory_in_guest(vmx_path, guest_user, guest_pass, dir_path)
        .await
}

/// Delete a file inside the guest.
pub async fn delete_file_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    file_path: &str,
) -> VmwResult<()> {
    vmrun
        .delete_file_in_guest(vmx_path, guest_user, guest_pass, file_path)
        .await
}

/// Check if a file exists in the guest.
pub async fn file_exists_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    file_path: &str,
) -> VmwResult<bool> {
    vmrun
        .file_exists_in_guest(vmx_path, guest_user, guest_pass, file_path)
        .await
}

/// Check if a directory exists in the guest.
pub async fn directory_exists_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    dir_path: &str,
) -> VmwResult<bool> {
    vmrun
        .directory_exists_in_guest(vmx_path, guest_user, guest_pass, dir_path)
        .await
}

/// Rename/move a file in the guest.
pub async fn rename_file_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    old_path: &str,
    new_path: &str,
) -> VmwResult<()> {
    vmrun
        .rename_file_in_guest(vmx_path, guest_user, guest_pass, old_path, new_path)
        .await
}

/// List files in a guest directory.
pub async fn list_directory_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    dir_path: &str,
) -> VmwResult<Vec<String>> {
    vmrun
        .list_directory_in_guest(vmx_path, guest_user, guest_pass, dir_path)
        .await
}

/// List running processes in the guest.
pub async fn list_processes_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
) -> VmwResult<Vec<GuestProcess>> {
    let lines = vmrun
        .list_processes_in_guest(vmx_path, guest_user, guest_pass)
        .await?;
    let mut procs = Vec::new();
    for line in lines {
        // vmrun returns: pid=XXX, owner=YYY, cmd=ZZZ
        let mut pid = 0u32;
        let mut owner = String::new();
        let mut cmd = String::new();
        for part in line.split(", ") {
            if let Some(v) = part.strip_prefix("pid=") {
                pid = v.parse().unwrap_or(0);
            } else if let Some(v) = part.strip_prefix("owner=") {
                owner = v.to_string();
            } else if let Some(v) = part.strip_prefix("cmd=") {
                cmd = v.to_string();
            }
        }
        procs.push(GuestProcess {
            pid,
            name: cmd.clone(),
            owner: if owner.is_empty() { None } else { Some(owner) },
            command_line: Some(cmd),
            memory_kb: None,
            cpu_percent: None,
        });
    }
    Ok(procs)
}

/// Kill a process in the guest.
pub async fn kill_process_in_guest(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    pid: u64,
) -> VmwResult<()> {
    vmrun
        .kill_process_in_guest(vmx_path, guest_user, guest_pass, pid)
        .await
}

/// Read a guest/runtime/environment variable.
pub async fn read_variable(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    var_type: &str,
    name: &str,
) -> VmwResult<String> {
    vmrun
        .read_variable(vmx_path, guest_user, guest_pass, var_type, name)
        .await
}

/// Write a guest/runtime variable.
pub async fn write_variable(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
    var_type: &str,
    name: &str,
    value: &str,
) -> VmwResult<()> {
    vmrun
        .write_variable(vmx_path, guest_user, guest_pass, var_type, name, value)
        .await
}

/// List guest environment variables.
pub async fn list_env_vars(
    vmrun: &VmRun,
    vmx_path: &str,
    guest_user: &str,
    guest_pass: &str,
) -> VmwResult<Vec<GuestEnvVar>> {
    // Use the script approach to list env vars
    let is_windows = {
        let vmx_data = crate::vmx::parse_vmx(vmx_path).ok();
        vmx_data
            .as_ref()
            .map(|v| {
                v.settings
                    .get("guestos")
                    .map(|os| os.to_lowercase().contains("windows"))
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    };

    let output = if is_windows {
        vmrun
            .run_script_in_guest(vmx_path, guest_user, guest_pass, "cmd.exe", "set")
            .await?
    } else {
        vmrun
            .run_script_in_guest(vmx_path, guest_user, guest_pass, "/bin/sh", "env")
            .await?
    };

    let mut vars = Vec::new();
    for line in output.lines() {
        if let Some(eq_pos) = line.find('=') {
            let key = line[..eq_pos].to_string();
            let value = line[eq_pos + 1..].to_string();
            if !key.is_empty() {
                vars.push(GuestEnvVar {
                    name: key,
                    value,
                });
            }
        }
    }
    Ok(vars)
}

/// Get VMware Tools status.
pub async fn get_tools_status(vmrun: &VmRun, vmx_path: &str) -> VmwResult<ToolsStatus> {
    let state = vmrun.check_tools_state(vmx_path).await?;
    let lower = state.to_lowercase();
    Ok(ToolsStatus {
        installed: !lower.contains("not installed"),
        running: lower.contains("running"),
        version: None,
        upgrade_available: lower.contains("update"),
        status_text: state,
    })
}

/// Install VMware Tools in the guest.
pub async fn install_tools(vmrun: &VmRun, vmx_path: &str) -> VmwResult<()> {
    vmrun.install_tools(vmx_path).await
}

/// Get the guest IP address.
pub async fn get_ip_address(vmrun: &VmRun, vmx_path: &str) -> VmwResult<String> {
    vmrun.get_guest_ip_address(vmx_path, true).await
}
