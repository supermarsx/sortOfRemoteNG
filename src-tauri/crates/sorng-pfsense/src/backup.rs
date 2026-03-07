//! Backup and restore management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct BackupManager;

impl BackupManager {
    pub async fn create_backup(client: &PfsenseClient, config: &BackupConfig) -> PfsenseResult<BackupEntry> {
        let body = serde_json::to_value(config)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/diagnostics/backup", &body).await?;
        let data = resp.get("data").cloned().unwrap_or(resp);
        Ok(BackupEntry {
            filename: data.get("filename").and_then(|v| v.as_str()).unwrap_or("backup.xml").to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            size: data.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
            description: format!("Backup area: {}", config.area),
        })
    }

    pub async fn restore_backup(client: &PfsenseClient, config: &RestoreConfig) -> PfsenseResult<()> {
        let body = serde_json::to_value(config)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        client.api_post("/diagnostics/restore", &body).await?;
        Ok(())
    }

    pub async fn list_backups(client: &PfsenseClient) -> PfsenseResult<Vec<BackupEntry>> {
        let resp = client.api_get("/diagnostics/backup").await?;
        let backups = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        backups.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn download_backup(client: &PfsenseClient, filename: &str) -> PfsenseResult<String> {
        let output = client.read_remote_file(&format!("/cf/conf/backup/{filename}")).await?;
        Ok(output)
    }

    pub async fn delete_backup(client: &PfsenseClient, filename: &str) -> PfsenseResult<()> {
        let output = client.exec_ssh(&format!(
            "rm -f /cf/conf/backup/{}",
            client.shell_escape(filename)
        )).await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::backup(format!(
                "Failed to delete backup {filename}: {}",
                output.stderr
            )));
        }
        Ok(())
    }

    pub async fn get_backup_history(client: &PfsenseClient) -> PfsenseResult<Vec<BackupEntry>> {
        let output = client.exec_ssh("ls -lt /cf/conf/backup/*.xml 2>/dev/null").await?;
        let mut entries = Vec::new();
        for line in output.stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 9 {
                let filename = parts[8..].join(" ");
                let size = parts.get(4).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                let date = format!("{} {} {}", parts.get(5).unwrap_or(&""), parts.get(6).unwrap_or(&""), parts.get(7).unwrap_or(&""));
                entries.push(BackupEntry {
                    filename,
                    timestamp: date,
                    size,
                    description: String::new(),
                });
            }
        }
        Ok(entries)
    }
}
