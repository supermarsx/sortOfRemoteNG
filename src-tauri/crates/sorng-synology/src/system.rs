//! System information and management — DSM info, utilization, processes, reboot/shutdown.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct SystemManager;

impl SystemManager {
    /// Get DSM information (model, version, serial, uptime, temperature, etc.)
    pub async fn get_info(client: &SynoClient) -> SynologyResult<DsmInfo> {
        let v = client.best_version("SYNO.DSM.Info", 2).unwrap_or(1);
        client.api_call("SYNO.DSM.Info", v, "getinfo", &[]).await
    }

    /// Get current system utilization (CPU, memory, network, disk).
    pub async fn get_utilization(client: &SynoClient) -> SynologyResult<SystemUtilization> {
        let v = client.best_version("SYNO.Core.System.Utilization", 1).unwrap_or(1);
        client.api_call("SYNO.Core.System.Utilization", v, "get", &[]).await
    }

    /// List running processes.
    pub async fn list_processes(client: &SynoClient) -> SynologyResult<Vec<ProcessInfo>> {
        let v = client.best_version("SYNO.Core.System.Process", 1).unwrap_or(1);
        client.api_call("SYNO.Core.System.Process", v, "list", &[]).await
    }

    /// Reboot the NAS.
    pub async fn reboot(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.System", 3).unwrap_or(1);
        client.api_call_void("SYNO.Core.System", v, "reboot", &[]).await
    }

    /// Shutdown the NAS.
    pub async fn shutdown(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.System", 3).unwrap_or(1);
        client.api_call_void("SYNO.Core.System", v, "shutdown", &[]).await
    }

    /// Enable/disable system beep (locate NAS).
    pub async fn set_beep(client: &SynoClient, enable: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.System", 3).unwrap_or(1);
        let val = if enable { "true" } else { "false" };
        client.api_call_void("SYNO.Core.System", v, "set_beep", &[("enable", val)]).await
    }

    /// Get DSM update / available version information.
    pub async fn check_update(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Upgrade.Server", 2).unwrap_or(1);
        client.api_call("SYNO.Core.Upgrade.Server", v, "check", &[]).await
    }

    /// Get NAS network name
    pub async fn get_network_name(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.System", 3).unwrap_or(1);
        client.api_call("SYNO.Core.System", v, "info", &[("type", "network")]).await
    }
}
