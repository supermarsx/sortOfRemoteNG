// ── ClamAV quarantine management ─────────────────────────────────────────────

use crate::client::{shell_escape, ClamavClient};
use crate::error::{ClamavError, ClamavResult};
use crate::types::*;

const QUARANTINE_DIR: &str = "/var/lib/clamav/quarantine";
const QUARANTINE_META: &str = "/var/lib/clamav/quarantine/.metadata";

pub struct QuarantineManager;

impl QuarantineManager {
    /// List all quarantined files.
    pub async fn list(client: &ClamavClient) -> ClamavResult<Vec<QuarantineEntry>> {
        // Ensure quarantine dir exists
        client
            .exec_ssh(&format!("sudo mkdir -p {} {}", QUARANTINE_DIR, QUARANTINE_META))
            .await?;

        let out = client
            .exec_ssh(&format!(
                "ls -1 {} 2>/dev/null | grep -v '^\\.metadata$' || true",
                shell_escape(QUARANTINE_DIR)
            ))
            .await?;

        let mut entries = Vec::new();
        for filename in out.stdout.lines() {
            let filename = filename.trim();
            if filename.is_empty() {
                continue;
            }
            if let Ok(entry) = Self::read_entry(client, filename).await {
                entries.push(entry);
            }
        }
        Ok(entries)
    }

    /// Get a specific quarantine entry by ID.
    pub async fn get(client: &ClamavClient, id: &str) -> ClamavResult<QuarantineEntry> {
        Self::read_entry(client, id).await
    }

    /// Restore a quarantined file to its original path.
    pub async fn restore(client: &ClamavClient, id: &str) -> ClamavResult<()> {
        let entry = Self::read_entry(client, id).await?;
        let qpath = format!("{}/{}", QUARANTINE_DIR, id);

        // Restore file to original location
        client
            .exec_ssh(&format!(
                "sudo cp {} {} && sudo rm -f {} && sudo rm -f {}/{}",
                shell_escape(&qpath),
                shell_escape(&entry.original_path),
                shell_escape(&qpath),
                QUARANTINE_META,
                shell_escape(id)
            ))
            .await?;
        Ok(())
    }

    /// Delete a quarantine entry permanently.
    pub async fn delete(client: &ClamavClient, id: &str) -> ClamavResult<()> {
        let qpath = format!("{}/{}", QUARANTINE_DIR, id);
        let meta_path = format!("{}/{}", QUARANTINE_META, id);
        client
            .exec_ssh(&format!(
                "sudo rm -f {} {}",
                shell_escape(&qpath),
                shell_escape(&meta_path)
            ))
            .await?;
        Ok(())
    }

    /// Delete all quarantine entries.
    pub async fn delete_all(client: &ClamavClient) -> ClamavResult<()> {
        client
            .exec_ssh(&format!(
                "sudo rm -rf {}/* {}/*",
                QUARANTINE_DIR, QUARANTINE_META
            ))
            .await?;
        // Recreate metadata dir
        client
            .exec_ssh(&format!("sudo mkdir -p {}", QUARANTINE_META))
            .await?;
        Ok(())
    }

    /// Get quarantine statistics.
    pub async fn get_stats(client: &ClamavClient) -> ClamavResult<QuarantineStats> {
        let out = client
            .exec_ssh(&format!(
                "find {} -maxdepth 1 -type f ! -name '.metadata' 2>/dev/null | wc -l",
                shell_escape(QUARANTINE_DIR)
            ))
            .await?;
        let total_items: u64 = out.stdout.trim().parse().unwrap_or(0);

        let size_out = client
            .exec_ssh(&format!(
                "du -sb {} 2>/dev/null | cut -f1",
                shell_escape(QUARANTINE_DIR)
            ))
            .await?;
        let total_size_bytes: u64 = size_out.stdout.trim().parse().unwrap_or(0);

        Ok(QuarantineStats {
            total_items,
            total_size_bytes,
        })
    }

    // ── Internal helpers ─────────────────────────────────────────────

    async fn read_entry(client: &ClamavClient, id: &str) -> ClamavResult<QuarantineEntry> {
        let meta_path = format!("{}/{}", QUARANTINE_META, id);
        let meta_content = client.read_remote_file(&meta_path).await.map_err(|_| {
            ClamavError::internal(format!("Quarantine entry not found: {}", id))
        })?;

        let mut original_path = String::new();
        let mut virus_name = String::new();
        let mut quarantined_at = String::new();
        let mut size_bytes: u64 = 0;

        for line in meta_content.lines() {
            let trimmed = line.trim();
            if let Some((key, value)) = trimmed.split_once('=') {
                match key.trim() {
                    "original_path" => original_path = value.trim().to_string(),
                    "virus_name" => virus_name = value.trim().to_string(),
                    "quarantined_at" => quarantined_at = value.trim().to_string(),
                    "size_bytes" => size_bytes = value.trim().parse().unwrap_or(0),
                    _ => {}
                }
            }
        }

        Ok(QuarantineEntry {
            id: id.to_string(),
            original_path,
            virus_name,
            quarantine_path: format!("{}/{}", QUARANTINE_DIR, id),
            quarantined_at,
            size_bytes,
        })
    }
}
