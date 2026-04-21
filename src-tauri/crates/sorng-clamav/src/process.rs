// ── ClamAV process management ────────────────────────────────────────────────

use crate::client::{shell_escape, ClamavClient};
use crate::error::{ClamavError, ClamavResult};
use crate::types::*;

pub struct ClamavProcessManager;

impl ClamavProcessManager {
    /// Start clamd service.
    pub async fn start_clamd(client: &ClamavClient) -> ClamavResult<()> {
        let out = client
            .exec_ssh("sudo systemctl start clamav-daemon 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(ClamavError::process_error(format!(
                "Failed to start clamd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Stop clamd service.
    pub async fn stop_clamd(client: &ClamavClient) -> ClamavResult<()> {
        let out = client
            .exec_ssh("sudo systemctl stop clamav-daemon 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(ClamavError::process_error(format!(
                "Failed to stop clamd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Restart clamd service.
    pub async fn restart_clamd(client: &ClamavClient) -> ClamavResult<()> {
        let out = client
            .exec_ssh("sudo systemctl restart clamav-daemon 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(ClamavError::process_error(format!(
                "Failed to restart clamd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Reload clamd (re-read configuration and database).
    pub async fn reload_clamd(client: &ClamavClient) -> ClamavResult<()> {
        let out = client
            .exec_ssh(&format!(
                "echo RELOAD | socat - UNIX-CONNECT:{} 2>&1",
                shell_escape(client.clamd_socket())
            ))
            .await?;
        if !out.stdout.contains("RELOADING") {
            return Err(ClamavError::process_error(format!(
                "Reload failed: {}",
                out.stdout
            )));
        }
        Ok(())
    }

    /// Get clamd daemon statistics.
    pub async fn clamd_status(client: &ClamavClient) -> ClamavResult<ClamdStats> {
        let out = client
            .exec_ssh(&format!(
                "echo STATS | socat - UNIX-CONNECT:{} 2>&1",
                shell_escape(client.clamd_socket())
            ))
            .await?;
        parse_clamd_stats(&out.stdout)
    }

    /// Start freshclam service.
    pub async fn start_freshclam(client: &ClamavClient) -> ClamavResult<()> {
        let out = client
            .exec_ssh("sudo systemctl start clamav-freshclam 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(ClamavError::process_error(format!(
                "Failed to start freshclam: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Stop freshclam service.
    pub async fn stop_freshclam(client: &ClamavClient) -> ClamavResult<()> {
        let out = client
            .exec_ssh("sudo systemctl stop clamav-freshclam 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(ClamavError::process_error(format!(
                "Failed to stop freshclam: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Restart freshclam service.
    pub async fn restart_freshclam(client: &ClamavClient) -> ClamavResult<()> {
        let out = client
            .exec_ssh("sudo systemctl restart clamav-freshclam 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(ClamavError::process_error(format!(
                "Failed to restart freshclam: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Get ClamAV version string.
    pub async fn version(client: &ClamavClient) -> ClamavResult<String> {
        client.version().await
    }

    /// Get comprehensive ClamAV info.
    pub async fn info(client: &ClamavClient) -> ClamavResult<ClamavInfo> {
        let version = client.version().await.unwrap_or_default();

        // Get clamd version for engine info
        let clamd_ver = client.clamd_version().await.ok();
        let (database_version, signature_count, engine_version) = match clamd_ver {
            Some(ref ver_str) => parse_clamd_version(ver_str),
            None => (None, None, None),
        };

        // Check if clamd is running
        let clamd_out = client
            .exec_ssh("systemctl is-active clamav-daemon 2>&1")
            .await;
        let clamd_running = clamd_out
            .map(|o| o.stdout.trim() == "active")
            .unwrap_or(false);

        // Check if freshclam is running
        let freshclam_out = client
            .exec_ssh("systemctl is-active clamav-freshclam 2>&1")
            .await;
        let freshclam_running = freshclam_out
            .map(|o| o.stdout.trim() == "active")
            .unwrap_or(false);

        Ok(ClamavInfo {
            version,
            database_version,
            signature_count,
            engine_version,
            clamd_running,
            freshclam_running,
        })
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_clamd_stats(output: &str) -> ClamavResult<ClamdStats> {
    let mut pools: u32 = 1;
    let mut state = "unknown".to_string();
    let mut threads_live: u32 = 0;
    let mut threads_idle: u32 = 0;
    let mut threads_max: u32 = 0;
    let mut queue_items: u32 = 0;
    let mut memory_used: u64 = 0;
    let mut malware_detected: u64 = 0;
    let mut bytes_scanned: u64 = 0;
    let mut uptime_secs: u64 = 0;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("POOLS:") {
            pools = trimmed
                .trim_start_matches("POOLS:")
                .trim()
                .parse()
                .unwrap_or(1);
        } else if trimmed.starts_with("STATE:") {
            state = trimmed.trim_start_matches("STATE:").trim().to_string();
        } else if trimmed.starts_with("THREADS:") {
            // THREADS: live N idle N max N
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            for (i, p) in parts.iter().enumerate() {
                match *p {
                    "live" => {
                        threads_live = parts.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(0)
                    }
                    "idle" => {
                        threads_idle = parts.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(0)
                    }
                    "max" => {
                        threads_max = parts.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(0)
                    }
                    _ => {}
                }
            }
        } else if trimmed.starts_with("QUEUE:") {
            queue_items = trimmed
                .trim_start_matches("QUEUE:")
                .trim()
                .parse()
                .unwrap_or(0);
        } else if trimmed.contains("MEMUSED:") || trimmed.contains("memory") {
            // Try to extract memory used
            if let Some(num_str) = trimmed
                .split_whitespace()
                .find(|s| s.parse::<u64>().is_ok())
            {
                memory_used = num_str.parse().unwrap_or(0);
            }
        } else if trimmed.contains("malware") {
            if let Some(num_str) = trimmed
                .split_whitespace()
                .find(|s| s.parse::<u64>().is_ok())
            {
                malware_detected = num_str.parse().unwrap_or(0);
            }
        } else if trimmed.contains("bytes scanned") || trimmed.contains("SCANNED:") {
            if let Some(num_str) = trimmed
                .split_whitespace()
                .find(|s| s.parse::<u64>().is_ok())
            {
                bytes_scanned = num_str.parse().unwrap_or(0);
            }
        } else if trimmed.contains("uptime") || trimmed.contains("UPTIME:") {
            if let Some(num_str) = trimmed
                .split_whitespace()
                .find(|s| s.parse::<u64>().is_ok())
            {
                uptime_secs = num_str.parse().unwrap_or(0);
            }
        }
    }

    Ok(ClamdStats {
        pools,
        state,
        threads_live,
        threads_idle,
        threads_max,
        queue_items,
        memory_used,
        malware_detected,
        bytes_scanned,
        uptime_secs,
    })
}

fn parse_clamd_version(ver_str: &str) -> (Option<String>, Option<u64>, Option<String>) {
    // ClamAV 0.103.8/26850/Thu Mar  2 09:23:20 2023
    let parts: Vec<&str> = ver_str.split('/').collect();
    let engine_version = parts.first().map(|s| s.trim().to_string());
    let database_version = parts.get(1).map(|s| s.trim().to_string());
    let signature_count = None; // Not directly in version string
    (database_version, signature_count, engine_version)
}
