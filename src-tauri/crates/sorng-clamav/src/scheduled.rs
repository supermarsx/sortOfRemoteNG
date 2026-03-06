// ── ClamAV scheduled scan management ─────────────────────────────────────────

use crate::client::{shell_escape, ClamavClient};
use crate::error::{ClamavError, ClamavResult};
use crate::scanning::ScanManager;
use crate::types::*;

const SCHEDULES_DIR: &str = "/etc/clamav/schedules.d";

pub struct ScheduledScanManager;

impl ScheduledScanManager {
    /// List all scheduled scans.
    pub async fn list(client: &ClamavClient) -> ClamavResult<Vec<ScheduledScan>> {
        client
            .exec_ssh(&format!("sudo mkdir -p {}", shell_escape(SCHEDULES_DIR)))
            .await?;

        let out = client
            .exec_ssh(&format!(
                "ls -1 {}/*.json 2>/dev/null || true",
                shell_escape(SCHEDULES_DIR)
            ))
            .await?;

        let mut schedules = Vec::new();
        for line in out.stdout.lines() {
            let path = line.trim();
            if path.is_empty() {
                continue;
            }
            let content = client.read_remote_file(path).await?;
            if let Ok(scan) = serde_json::from_str::<ScheduledScan>(&content) {
                schedules.push(scan);
            }
        }
        Ok(schedules)
    }

    /// Get a specific scheduled scan by ID.
    pub async fn get(client: &ClamavClient, id: &str) -> ClamavResult<ScheduledScan> {
        let path = format!("{}/{}.json", SCHEDULES_DIR, id);
        let content = client.read_remote_file(&path).await.map_err(|_| {
            ClamavError::internal(format!("Scheduled scan not found: {}", id))
        })?;
        serde_json::from_str(&content)
            .map_err(|e| ClamavError::parse(format!("Failed to parse schedule: {}", e)))
    }

    /// Create a new scheduled scan.
    pub async fn create(
        client: &ClamavClient,
        scan: &ScheduledScan,
    ) -> ClamavResult<ScheduledScan> {
        let mut new_scan = scan.clone();
        if new_scan.id.is_empty() {
            new_scan.id = uuid::Uuid::new_v4().to_string();
        }

        let path = format!("{}/{}.json", SCHEDULES_DIR, new_scan.id);
        let content = serde_json::to_string_pretty(&new_scan)
            .map_err(|e| ClamavError::internal(format!("Failed to serialize schedule: {}", e)))?;

        client
            .exec_ssh(&format!("sudo mkdir -p {}", shell_escape(SCHEDULES_DIR)))
            .await?;
        client.write_remote_file(&path, &content).await?;

        // Install cron job
        Self::install_cron(client, &new_scan).await?;

        Ok(new_scan)
    }

    /// Update an existing scheduled scan.
    pub async fn update(
        client: &ClamavClient,
        id: &str,
        scan: &ScheduledScan,
    ) -> ClamavResult<ScheduledScan> {
        // Verify it exists
        let _ = Self::get(client, id).await?;

        let mut updated = scan.clone();
        updated.id = id.to_string();

        let path = format!("{}/{}.json", SCHEDULES_DIR, id);
        let content = serde_json::to_string_pretty(&updated)
            .map_err(|e| ClamavError::internal(format!("Failed to serialize schedule: {}", e)))?;
        client.write_remote_file(&path, &content).await?;

        // Remove old cron and install new one
        Self::remove_cron(client, id).await?;
        if updated.enabled {
            Self::install_cron(client, &updated).await?;
        }

        Ok(updated)
    }

    /// Delete a scheduled scan.
    pub async fn delete(client: &ClamavClient, id: &str) -> ClamavResult<()> {
        let path = format!("{}/{}.json", SCHEDULES_DIR, id);
        Self::remove_cron(client, id).await?;
        client
            .exec_ssh(&format!("sudo rm -f {}", shell_escape(&path)))
            .await?;
        Ok(())
    }

    /// Enable a scheduled scan.
    pub async fn enable(client: &ClamavClient, id: &str) -> ClamavResult<()> {
        let mut scan = Self::get(client, id).await?;
        scan.enabled = true;
        Self::update(client, id, &scan).await?;
        Ok(())
    }

    /// Disable a scheduled scan.
    pub async fn disable(client: &ClamavClient, id: &str) -> ClamavResult<()> {
        let mut scan = Self::get(client, id).await?;
        scan.enabled = false;
        Self::update(client, id, &scan).await?;
        Ok(())
    }

    /// Run a scheduled scan immediately.
    pub async fn run_now(client: &ClamavClient, id: &str) -> ClamavResult<ScanSummary> {
        let scan = Self::get(client, id).await?;
        let req = ScanRequest {
            path: scan.path,
            recursive: Some(scan.recursive),
            exclude_patterns: Vec::new(),
            max_filesize_mb: None,
            max_scansize_mb: None,
            max_files: None,
        };
        ScanManager::scan(client, &req).await
    }

    // ── Cron helpers ─────────────────────────────────────────────────

    async fn install_cron(client: &ClamavClient, scan: &ScheduledScan) -> ClamavResult<()> {
        if !scan.enabled {
            return Ok(());
        }

        let recursive_flag = if scan.recursive { "-r " } else { "" };
        let cron_line = format!(
            "{} /usr/bin/clamscan {}{} --log=/var/log/clamav/scheduled-{}.log # sorng-scheduled-{}",
            scan.schedule_cron,
            recursive_flag,
            shell_escape(&scan.path),
            scan.id,
            scan.id
        );

        let cmd = format!(
            "(crontab -l 2>/dev/null | grep -v 'sorng-scheduled-{}'; echo '{}') | crontab -",
            scan.id, cron_line
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    async fn remove_cron(client: &ClamavClient, id: &str) -> ClamavResult<()> {
        let cmd = format!(
            "crontab -l 2>/dev/null | grep -v 'sorng-scheduled-{}' | crontab - 2>/dev/null || true",
            id
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }
}
