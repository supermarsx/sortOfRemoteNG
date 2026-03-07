// ── Prometheus service management ────────────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct ServiceMgmtManager;

impl ServiceMgmtManager {
    pub async fn get_service_status(client: &PrometheusClient) -> PrometheusResult<ServiceStatus> {
        let svc = client.service_name();
        let out = client.exec_ssh(&format!(
            "systemctl show {svc} --property=ActiveState,SubState,MainPID,MemoryCurrent,CPUUsageNSec,UnitFileState"
        )).await?;
        parse_systemctl_status(&out.stdout)
    }

    pub async fn start_service(client: &PrometheusClient) -> PrometheusResult<()> {
        let svc = client.service_name();
        let out = client.exec_ssh(&format!("sudo systemctl start {svc}")).await?;
        if out.exit_code != 0 {
            return Err(PrometheusError::command_failed(format!("start failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn stop_service(client: &PrometheusClient) -> PrometheusResult<()> {
        let svc = client.service_name();
        let out = client.exec_ssh(&format!("sudo systemctl stop {svc}")).await?;
        if out.exit_code != 0 {
            return Err(PrometheusError::command_failed(format!("stop failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn restart_service(client: &PrometheusClient) -> PrometheusResult<()> {
        let svc = client.service_name();
        let out = client.exec_ssh(&format!("sudo systemctl restart {svc}")).await?;
        if out.exit_code != 0 {
            return Err(PrometheusError::command_failed(format!("restart failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn enable_service(client: &PrometheusClient) -> PrometheusResult<()> {
        let svc = client.service_name();
        let out = client.exec_ssh(&format!("sudo systemctl enable {svc}")).await?;
        if out.exit_code != 0 {
            return Err(PrometheusError::command_failed(format!("enable failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn disable_service(client: &PrometheusClient) -> PrometheusResult<()> {
        let svc = client.service_name();
        let out = client.exec_ssh(&format!("sudo systemctl disable {svc}")).await?;
        if out.exit_code != 0 {
            return Err(PrometheusError::command_failed(format!("disable failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn get_service_logs(client: &PrometheusClient, query: &ServiceLogQuery) -> PrometheusResult<Vec<ServiceLog>> {
        let svc = client.service_name();
        let mut cmd = format!("journalctl -u {svc} --no-pager -o json");
        if let Some(lines) = query.lines {
            cmd.push_str(&format!(" -n {lines}"));
        }
        if let Some(since) = &query.since {
            cmd.push_str(&format!(" --since '{since}'"));
        }
        if let Some(until) = &query.until {
            cmd.push_str(&format!(" --until '{until}'"));
        }
        if let Some(grep) = &query.grep {
            cmd.push_str(&format!(" -g '{grep}'"));
        }
        let out = client.exec_ssh(&cmd).await?;
        let mut logs = Vec::new();
        for line in out.stdout.lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                logs.push(ServiceLog {
                    timestamp: v["__REALTIME_TIMESTAMP"].as_str().map(String::from),
                    level: v["PRIORITY"].as_str().map(String::from),
                    message: v["MESSAGE"].as_str().unwrap_or("").to_string(),
                    caller: v["SYSLOG_IDENTIFIER"].as_str().map(String::from),
                });
            }
        }
        Ok(logs)
    }

    pub async fn get_prometheus_version(client: &PrometheusClient) -> PrometheusResult<String> {
        let out = client.exec_ssh("prometheus --version 2>&1 | head -1").await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn get_config_file_path(client: &PrometheusClient) -> PrometheusResult<String> {
        Ok(client.config_path().to_string())
    }

    pub async fn update_config_file(client: &PrometheusClient, req: &UpdateConfigFileRequest) -> PrometheusResult<()> {
        client.write_remote_file(client.config_path(), &req.content).await?;
        Ok(())
    }

    pub async fn backup_config(client: &PrometheusClient) -> PrometheusResult<BackupResult> {
        let config_path = client.config_path();
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let backup_path = format!("{config_path}.backup.{timestamp}");
        client.exec_ssh(&format!("sudo cp '{config_path}' '{backup_path}'")).await?;
        let out = client.exec_ssh(&format!("stat --format='%s' '{backup_path}'")).await?;
        let size: u64 = out.stdout.trim().parse().unwrap_or(0);
        Ok(BackupResult {
            path: backup_path,
            size_bytes: size,
            created_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    pub async fn restore_config(client: &PrometheusClient, backup_path: &str) -> PrometheusResult<()> {
        let config_path = client.config_path();
        client.exec_ssh(&format!("sudo cp '{backup_path}' '{config_path}'")).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

fn parse_systemctl_status(output: &str) -> PrometheusResult<ServiceStatus> {
    let mut active_state = String::new();
    let mut pid: Option<u32> = None;
    let mut enabled = false;
    let mut memory = None;

    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(2, '=').collect();
        if parts.len() != 2 { continue; }
        match parts[0] {
            "ActiveState" => active_state = parts[1].to_string(),
            "MainPID" => pid = parts[1].parse().ok().filter(|&p: &u32| p > 0),
            "UnitFileState" => enabled = parts[1] == "enabled",
            "MemoryCurrent" => memory = Some(parts[1].to_string()),
            _ => {}
        }
    }

    Ok(ServiceStatus {
        active: active_state == "active",
        state: active_state,
        pid,
        uptime: None,
        memory_usage: memory,
        cpu_usage: None,
        enabled,
    })
}
