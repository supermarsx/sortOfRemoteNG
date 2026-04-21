// ── sorng-postgres-admin/src/pg_hba.rs ────────────────────────────────────────
//! PostgreSQL pg_hba.conf management – read, parse, edit, and reload.

use crate::client::{shell_escape, PgClient};
use crate::error::PgResult;
use crate::types::PgHbaEntry;

pub struct HbaManager;

impl HbaManager {
    /// Resolve the pg_hba.conf path via SHOW or config_dir.
    async fn hba_path(client: &PgClient) -> PgResult<String> {
        let out = client.exec_sql("SHOW hba_file").await?;
        let path = out.trim().to_string();
        if path.is_empty() {
            Ok(format!(
                "{}/pg_hba.conf",
                client
                    .config
                    .config_dir
                    .as_deref()
                    .unwrap_or("/etc/postgresql")
            ))
        } else {
            Ok(path)
        }
    }

    /// List parsed pg_hba.conf entries.
    pub async fn list(client: &PgClient) -> PgResult<Vec<PgHbaEntry>> {
        let raw = Self::get_raw(client).await?;
        let mut entries = Vec::new();
        for (idx, line) in raw.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 4 {
                let (address, method_idx) = if parts[0] == "local" {
                    (None, 3)
                } else if parts.len() >= 5 {
                    (Some(parts[3].to_string()), 4)
                } else {
                    (None, 3)
                };
                let method = parts.get(method_idx).unwrap_or(&"").to_string();
                let options = if parts.len() > method_idx + 1 {
                    Some(parts[method_idx + 1..].join(" "))
                } else {
                    None
                };
                entries.push(PgHbaEntry {
                    line_number: (idx + 1) as u32,
                    entry_type: parts[0].to_string(),
                    database: parts[1].to_string(),
                    user: parts[2].to_string(),
                    address,
                    method,
                    options,
                });
            }
        }
        Ok(entries)
    }

    /// Add a new HBA entry at the end of pg_hba.conf (before final newline).
    pub async fn add(
        client: &PgClient,
        entry_type: &str,
        database: &str,
        user: &str,
        address: Option<&str>,
        method: &str,
        options: Option<&str>,
    ) -> PgResult<()> {
        let mut line = format!("{} {} {}", entry_type, database, user);
        if let Some(addr) = address {
            line.push_str(&format!(" {}", addr));
        }
        line.push_str(&format!(" {}", method));
        if let Some(opts) = options {
            line.push_str(&format!(" {}", opts));
        }
        let path = Self::hba_path(client).await?;
        let cmd = format!(
            "echo {} | sudo tee -a {} > /dev/null",
            shell_escape(&line),
            shell_escape(&path)
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Remove a line from pg_hba.conf by line number (1-based).
    pub async fn remove(client: &PgClient, line_number: u32) -> PgResult<()> {
        let path = Self::hba_path(client).await?;
        let cmd = format!("sudo sed -i '{}d' {}", line_number, shell_escape(&path));
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Update a line in pg_hba.conf by replacing the line at line_number.
    pub async fn update(client: &PgClient, line_number: u32, entry: &PgHbaEntry) -> PgResult<()> {
        let mut line = format!("{} {} {}", entry.entry_type, entry.database, entry.user);
        if let Some(ref addr) = entry.address {
            line.push_str(&format!(" {}", addr));
        }
        line.push_str(&format!(" {}", entry.method));
        if let Some(ref opts) = entry.options {
            line.push_str(&format!(" {}", opts));
        }
        let path = Self::hba_path(client).await?;
        let escaped_line = line.replace('/', "\\/").replace('\'', "'\\''");
        let cmd = format!(
            "sudo sed -i '{}s/.*/{}/g' {}",
            line_number,
            escaped_line,
            shell_escape(&path)
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Reload PostgreSQL configuration (pg_ctl reload or SELECT pg_reload_conf()).
    pub async fn reload(client: &PgClient) -> PgResult<()> {
        client.exec_sql("SELECT pg_reload_conf()").await?;
        Ok(())
    }

    /// Get the raw pg_hba.conf content.
    pub async fn get_raw(client: &PgClient) -> PgResult<String> {
        let path = Self::hba_path(client).await?;
        client.read_remote_file(&path).await
    }

    /// Overwrite pg_hba.conf with new content.
    pub async fn set_raw(client: &PgClient, content: &str) -> PgResult<()> {
        let path = Self::hba_path(client).await?;
        client.write_remote_file(&path, content).await
    }

    /// Validate pg_hba.conf using pg_hba_file_rules (PG 10+).
    pub async fn validate(client: &PgClient) -> PgResult<bool> {
        let sql = "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL";
        let out = client.exec_sql(sql).await?;
        let errors: u64 = out.trim().parse().unwrap_or(1);
        Ok(errors == 0)
    }
}
