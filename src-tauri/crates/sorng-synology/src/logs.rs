//! System logs and connection logs.
//!
//! DSM answers are decoded through private `*Wire` structs that carry DSM's own
//! field names and are mapped into the camelCase IPC DTOs in `types`.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use crate::wire::string_param;
use serde::Deserialize;

const SYSLOG: &str = "SYNO.Core.SyslogClient.Log";
const CURRENT_CONNECTION: &str = "SYNO.Core.CurrentConnection";

/// One `SYNO.Core.SyslogClient.Log` `list` item:
/// `{"descr":"...","level":"info","logtype":"System","orginalLogType":"system",
/// "time":"2026/04/06 06:23:51","who":"SYSTEM"}`. DSM items carry no id, and
/// DSM spells `orginalLogType` that way. `time` is required: the renderer keys
/// log rows by it, so a row without one is a schema failure.
#[derive(Deserialize)]
struct LogWire {
    time: String,
    level: String,
    descr: String,
    who: Option<String>,
    logtype: Option<String>,
    #[serde(rename = "orginalLogType")]
    original_log_type: Option<String>,
}

impl From<LogWire> for LogEntry {
    fn from(row: LogWire) -> Self {
        Self {
            id: None,
            time: row.time,
            msg: row.descr,
            level: row.level,
            user: row.who,
            event: None,
            log_type: row.logtype.or(row.original_log_type),
        }
    }
}

/// One `SYNO.Core.CurrentConnection` `list` item:
/// `{"can_be_kicked":true,"descr":"DiskStation Manager","from":"192.0.2.30",
/// "protocol":"HTTP/HTTPS","time":"2026/09/14 17:57:20","type":"HTTP/HTTPS",
/// "who":"admin",...}`. DSM reports no login or success flag.
#[derive(Deserialize)]
struct ConnectionWire {
    time: String,
    from: String,
    who: String,
    #[serde(rename = "type")]
    kind: String,
    descr: Option<String>,
    protocol: Option<String>,
    can_be_kicked: Option<bool>,
}

impl From<ConnectionWire> for ConnectionEntry {
    fn from(row: ConnectionWire) -> Self {
        Self {
            time: row.time,
            ip: row.from,
            user: row.who,
            r#type: row.kind,
            is_login: None,
            success: None,
            description: row.descr,
            protocol: row.protocol,
            can_be_kicked: row.can_be_kicked,
        }
    }
}

pub struct LogsManager;

impl LogsManager {
    /// Get recent system log entries.
    ///
    /// DSM pages logs with `start` (vcf-content-factory `synology-events.md`
    /// "start … required"; dsm_helper), while other clients send `offset`, so
    /// both carry the offset. `target`/`logtype` select the local system log
    /// (gaaasp/nas `lib/logs.ts`).
    pub async fn get_system_logs(
        client: &SynoClient,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<Vec<LogEntry>> {
        let v = client.best_version(SYSLOG, 1).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        let target = string_param(client, SYSLOG, "LOCAL");
        let logtype = string_param(client, SYSLOG, "system");
        let rows = client
            .api_list::<LogWire>(
                SYSLOG,
                v,
                "list",
                &[
                    ("start", &off),
                    ("offset", &off),
                    ("limit", &lim),
                    ("target", &target),
                    ("logtype", &logtype),
                ],
                &["items"],
            )
            .await?;
        Ok(rows.into_iter().map(LogEntry::from).collect())
    }

    /// Get connection entries.
    ///
    /// `SYNO.Core.CurrentConnection` lists the **active sessions**, not DSM's
    /// connection log (that is `SyslogClient.Log` with a connection log type);
    /// the command keeps this API until the F1 follow-up.
    pub async fn get_connection_logs(
        client: &SynoClient,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<Vec<ConnectionEntry>> {
        let v = client.best_version(CURRENT_CONNECTION, 2).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        Self::list_connections(client, v, &[("offset", &off), ("limit", &lim)]).await
    }

    /// Get current active connections.
    pub async fn get_active_connections(
        client: &SynoClient,
    ) -> SynologyResult<Vec<ConnectionEntry>> {
        let v = client.best_version(CURRENT_CONNECTION, 2).unwrap_or(1);
        Self::list_connections(client, v, &[]).await
    }

    async fn list_connections(
        client: &SynoClient,
        version: u32,
        form: &[(&str, &str)],
    ) -> SynologyResult<Vec<ConnectionEntry>> {
        let rows = client
            .api_list::<ConnectionWire>(CURRENT_CONNECTION, version, "list", form, &["items"])
            .await?;
        Ok(rows.into_iter().map(ConnectionEntry::from).collect())
    }

    /// Kick an active connection (disconnect user).
    pub async fn kick_connection(client: &SynoClient, who: &str, ip: &str) -> SynologyResult<()> {
        let v = client.best_version(CURRENT_CONNECTION, 2).unwrap_or(1);
        client
            .api_post_void(CURRENT_CONNECTION, v, "kick", &[("who", who), ("ip", ip)])
            .await
    }

    /// Get file transfer log.
    pub async fn get_transfer_logs(
        client: &SynoClient,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<serde_json::Value> {
        let v = client.best_version(SYSLOG, 1).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        client
            .api_call(
                SYSLOG,
                v,
                "list",
                &[("offset", &off), ("limit", &lim), ("logtype", "transfer")],
            )
            .await
    }

    /// Clear system logs.
    pub async fn clear_logs(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version(SYSLOG, 1).unwrap_or(1);
        client.api_post_void(SYSLOG, v, "clear", &[]).await
    }
}
