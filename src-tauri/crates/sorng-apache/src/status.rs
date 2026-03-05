// ── apache server-status / mod_status ────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct ApacheStatusManager;

impl ApacheStatusManager {
    pub async fn get_status(client: &ApacheClient) -> ApacheResult<ApacheServerStatus> {
        let raw = client.server_status().await?;
        Ok(parse_server_status(&raw))
    }

    pub async fn process_status(client: &ApacheClient) -> ApacheResult<ApacheProcess> {
        client.status().await
    }
}

fn parse_server_status(raw: &str) -> ApacheServerStatus {
    let mut status = ApacheServerStatus::default();
    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() != 2 { continue; }
        let key = parts[0].trim();
        let val = parts[1].trim();
        match key {
            "Total Accesses" => status.total_accesses = val.parse().ok(),
            "Total kBytes" => status.total_kbytes = val.parse().ok(),
            "Uptime" => status.uptime = val.parse().ok(),
            "ReqPerSec" => status.req_per_sec = val.parse().ok(),
            "BytesPerSec" => status.bytes_per_sec = val.parse().ok(),
            "BytesPerReq" => status.bytes_per_req = val.parse().ok(),
            "BusyWorkers" => status.busy_workers = val.parse().ok(),
            "IdleWorkers" => status.idle_workers = val.parse().ok(),
            "ConnsTotal" => status.conns_total = val.parse().ok(),
            "ConnsAsyncWriting" => status.conns_async_writing = val.parse().ok(),
            "ConnsAsyncKeepAlive" => status.conns_async_keep_alive = val.parse().ok(),
            "ConnsAsyncClosing" => status.conns_async_closing = val.parse().ok(),
            "ServerVersion" => status.server_version = Some(val.to_string()),
            "ServerMPM" => status.server_mpm = Some(val.to_string()),
            "Load1" => status.load1 = val.parse().ok(),
            "Load5" => status.load5 = val.parse().ok(),
            "Load15" => status.load15 = val.parse().ok(),
            _ => {}
        }
    }
    status
}
