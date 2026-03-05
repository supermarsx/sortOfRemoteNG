//! Power operations — start, stop, reset, suspend, pause, batch power.

use crate::error::VmwResult;
use crate::types::*;
use crate::vmrun::VmRun;

/// Start (power on) a VM.
pub async fn start_vm(vmrun: &VmRun, vmx_path: &str, gui: bool) -> VmwResult<()> {
    vmrun.start(vmx_path, gui).await
}

/// Stop (power off) a VM.
pub async fn stop_vm(vmrun: &VmRun, vmx_path: &str, hard: bool) -> VmwResult<()> {
    vmrun.stop(vmx_path, hard).await
}

/// Reset a VM.
pub async fn reset_vm(vmrun: &VmRun, vmx_path: &str, hard: bool) -> VmwResult<()> {
    vmrun.reset(vmx_path, hard).await
}

/// Suspend a VM.
pub async fn suspend_vm(vmrun: &VmRun, vmx_path: &str, hard: bool) -> VmwResult<()> {
    vmrun.suspend(vmx_path, hard).await
}

/// Pause a VM.
pub async fn pause_vm(vmrun: &VmRun, vmx_path: &str) -> VmwResult<()> {
    vmrun.pause(vmx_path).await
}

/// Unpause a VM.
pub async fn unpause_vm(vmrun: &VmRun, vmx_path: &str) -> VmwResult<()> {
    vmrun.unpause(vmx_path).await
}

/// Get the power state of a VM.
pub async fn get_power_state(vmrun: &VmRun, vmx_path: &str) -> VmwResult<VmPowerState> {
    let running = vmrun.list().await?;
    if running.iter().any(|p| p == vmx_path) {
        Ok(VmPowerState::PoweredOn)
    } else {
        // Check if there's a suspended state file
        let vmss = vmx_path.replace(".vmx", ".vmss");
        if std::path::Path::new(&vmss).exists() {
            Ok(VmPowerState::Suspended)
        } else {
            Ok(VmPowerState::PoweredOff)
        }
    }
}

/// Perform a power action on multiple VMs at once.
pub async fn batch_power(
    vmrun: &VmRun,
    vmx_paths: &[String],
    action: PowerAction,
) -> VmwResult<BatchPowerResult> {
    let mut successes = Vec::new();
    let mut failures = Vec::new();

    for path in vmx_paths {
        let result = match action {
            PowerAction::Start => vmrun.start(path, false).await,
            PowerAction::Stop => vmrun.stop(path, false).await,
            PowerAction::HardStop => vmrun.stop(path, true).await,
            PowerAction::Reset => vmrun.reset(path, false).await,
            PowerAction::Suspend => vmrun.suspend(path, false).await,
            PowerAction::Pause => vmrun.pause(path).await,
            PowerAction::Unpause => vmrun.unpause(path).await,
        };
        match result {
            Ok(_) => successes.push(path.clone()),
            Err(e) => failures.push(BatchPowerFailure {
                vmx_path: path.clone(),
                error: e.to_string(),
            }),
        }
    }

    Ok(BatchPowerResult {
        successes,
        failures,
    })
}
