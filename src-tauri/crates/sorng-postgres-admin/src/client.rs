// ── sorng-postgres-admin – SSH/CLI client ────────────────────────────────────
//! Executes PostgreSQL commands on a remote host via SSH.
//! Handles psql, pg_dump, pg_restore, and pg_basebackup invocations.

use crate::error::{PgAdminError, PgAdminResult};
use crate::types::*;
use log::debug;

/// PostgreSQL administration client – connects via SSH to manage PG remotely.
pub struct PgAdminClient {
    pub config: PgConnectionConfig,
}

impl PgAdminClient {
    pub fn new(config: PgConnectionConfig) -> PgAdminResult<Self> {
        Ok(Self { config })
    }

    // ── Helpers ──────────────────────────────────────────────────

    pub fn pg_user(&self) -> &str {
        self.config.pg_user.as_deref().unwrap_or("postgres")
    }

    pub fn pg_database(&self) -> &str {
        self.config.pg_database.as_deref().unwrap_or("postgres")
    }

    pub fn pg_config_dir(&self) -> &str {
        self.config.pg_config_dir.as_deref().unwrap_or("/etc/postgresql")
    }

    pub fn data_directory(&self) -> String {
        format!("{}/data", self.pg_config_dir())
    }

    // ── SSH command execution stub ───────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> PgAdminResult<SshOutput> {
        debug!("PG SSH [{}]: {}", self.config.host, command);
        Err(PgAdminError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    // ── psql helpers ─────────────────────────────────────────────

    pub async fn exec_psql(&self, query: &str) -> PgAdminResult<String> {
        self.exec_psql_db(self.pg_database(), query).await
    }

    pub async fn exec_psql_db(&self, db: &str, query: &str) -> PgAdminResult<String> {
        let escaped = shell_escape(query);
        let cmd = format!(
            "psql -U {} -d {} -c {} -t -A",
            self.pg_user(),
            db,
            escaped,
        );
        let out = self.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PgAdminError::query_failed(format!("psql failed: {}", out.stderr)));
        }
        Ok(out.stdout)
    }

    // ── Remote file helpers ──────────────────────────────────────

    pub async fn read_remote_file(&self, path: &str) -> PgAdminResult<String> {
        let out = self.exec_ssh(&format!("cat {}", shell_escape(path))).await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> PgAdminResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }
}

/// Shell-escape a string for safe use in remote commands.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
