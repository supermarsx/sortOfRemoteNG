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
    let mut total_accesses = 0u64;
    let mut total_kbytes = 0u64;
    let mut cpu_load = None;
    let mut uptime = 0u64;
    let mut requests_per_sec = 0.0f64;
    let mut bytes_per_sec = 0.0f64;
    let mut bytes_per_request = 0.0f64;
    let mut busy_workers = 0u32;
    let mut idle_workers = 0u32;
    let mut scoreboard = String::new();

    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() != 2 { continue; }
        let key = parts[0].trim();
        let val = parts[1].trim();
        match key {
            "Total Accesses" => total_accesses = val.parse().unwrap_or(0),
            "Total kBytes" => total_kbytes = val.parse().unwrap_or(0),
            "CPULoad" => cpu_load = val.parse().ok(),
            "Uptime" => uptime = val.parse().unwrap_or(0),
            "ReqPerSec" => requests_per_sec = val.parse().unwrap_or(0.0),
            "BytesPerSec" => bytes_per_sec = val.parse().unwrap_or(0.0),
            "BytesPerReq" => bytes_per_request = val.parse().unwrap_or(0.0),
            "BusyWorkers" => busy_workers = val.parse().unwrap_or(0),
            "IdleWorkers" => idle_workers = val.parse().unwrap_or(0),
            "Scoreboard" => scoreboard = val.to_string(),
            _ => {}
        }
    }
    ApacheServerStatus {
        total_accesses,
        total_kbytes,
        cpu_load,
        uptime,
        requests_per_sec,
        bytes_per_sec,
        bytes_per_request,
        busy_workers,
        idle_workers,
        scoreboard,
        workers: vec![],
    }
}
