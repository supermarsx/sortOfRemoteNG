//! System logs and connection logs.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct LogsManager;

impl LogsManager {
    /// Get recent system log entries.
    pub async fn get_system_logs(
        client: &SynoClient,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<Vec<LogEntry>> {
        let v = client.best_version("SYNO.Core.SyslogClient.Log", 1).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        client.api_call(
            "SYNO.Core.SyslogClient.Log",
            v,
            "list",
            &[("offset", &off), ("limit", &lim)],
        )
        .await
    }

    /// Get connection logs (login/logout events).
    pub async fn get_connection_logs(
        client: &SynoClient,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<Vec<ConnectionEntry>> {
        let v = client.best_version("SYNO.Core.CurrentConnection", 2).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        client.api_call(
            "SYNO.Core.CurrentConnection",
            v,
            "list",
            &[("offset", &off), ("limit", &lim)],
        )
        .await
    }

    /// Get current active connections.
    pub async fn get_active_connections(client: &SynoClient) -> SynologyResult<Vec<ConnectionEntry>> {
        let v = client.best_version("SYNO.Core.CurrentConnection", 2).unwrap_or(1);
        client.api_call("SYNO.Core.CurrentConnection", v, "list", &[]).await
    }

    /// Kick an active connection (disconnect user).
    pub async fn kick_connection(
        client: &SynoClient,
        who: &str,
        ip: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.CurrentConnection", 2).unwrap_or(1);
        client.api_post_void(
            "SYNO.Core.CurrentConnection",
            v,
            "kick",
            &[("who", who), ("ip", ip)],
        )
        .await
    }

    /// Get file transfer log.
    pub async fn get_transfer_logs(
        client: &SynoClient,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.SyslogClient.Log", 1).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        client.api_call(
            "SYNO.Core.SyslogClient.Log",
            v,
            "list",
            &[("offset", &off), ("limit", &lim), ("logtype", "transfer")],
        )
        .await
    }

    /// Clear system logs.
    pub async fn clear_logs(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.SyslogClient.Log", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.SyslogClient.Log", v, "clear", &[]).await
    }
}
