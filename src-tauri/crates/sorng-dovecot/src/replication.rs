// ── dovecot replication management ───────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

pub struct ReplicationManager;

impl ReplicationManager {
    /// Get replication status via `doveadm replicator status`.
    pub async fn status(client: &DovecotClient) -> DovecotResult<Vec<DovecotReplication>> {
        let out = client.doveadm("replicator status '*'").await?;
        let mut replications = Vec::new();

        // Parse doveadm replicator status output:
        // username priority fast_sync full_sync status
        for line in out.stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 2 {
                // Try whitespace split
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.is_empty() {
                    continue;
                }
                replications.push(DovecotReplication {
                    user: parts.first().unwrap_or(&"").to_string(),
                    priority: parts.get(1).map(|s| s.to_string()),
                    last_fast_sync: parts.get(2).map(|s| s.to_string()),
                    last_full_sync: parts.get(3).map(|s| s.to_string()),
                    status: parts.get(4).map(|s| s.to_string()),
                });
                continue;
            }

            replications.push(DovecotReplication {
                user: parts.first().unwrap_or(&"").trim().to_string(),
                priority: parts.get(1).map(|s| s.trim().to_string()),
                last_fast_sync: parts.get(2).map(|s| s.trim().to_string()),
                last_full_sync: parts.get(3).map(|s| s.trim().to_string()),
                status: parts.get(4).map(|s| s.trim().to_string()),
            });
        }

        Ok(replications)
    }

    /// Trigger replication for a specific user via `doveadm replicator replicate`.
    pub async fn replicate_user(
        client: &DovecotClient,
        user: &str,
        priority: &str,
    ) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "replicator replicate -p {} {}",
                shell_escape(priority),
                shell_escape(user)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "Failed to trigger replication for '{}': {}",
                user, out.stderr
            )));
        }
        Ok(())
    }

    /// Run dsync backup from remote to local for a user.
    pub async fn dsync_backup(
        client: &DovecotClient,
        user: &str,
        remote: &str,
    ) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "backup -u {} {}",
                shell_escape(user),
                shell_escape(remote)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "dsync backup failed for '{}': {}",
                user, out.stderr
            )));
        }
        Ok(())
    }

    /// Run dsync mirror (bidirectional sync) for a user.
    pub async fn dsync_mirror(
        client: &DovecotClient,
        user: &str,
        remote: &str,
    ) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "sync -u {} {}",
                shell_escape(user),
                shell_escape(remote)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "dsync mirror failed for '{}': {}",
                user, out.stderr
            )));
        }
        Ok(())
    }
}
