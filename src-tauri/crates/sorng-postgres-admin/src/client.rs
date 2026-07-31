// ── sorng-postgres-admin – SSH/CLI client ─────────────────────────────────────
//! Executes PostgreSQL commands on a remote host via SSH.
//! Builds psql/pg_dump/pg_restore command lines with connection parameters.

use crate::error::{PgError, PgResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};

const MAX_SSH_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SSH_ERROR_BYTES: usize = 64 * 1024;
const MAX_SSH_TIMEOUT_SECS: u64 = 600;

/// PostgreSQL administration client – connects via SSH to manage PG remotely.
pub struct PgClient {
    pub config: PgConnectionConfig,
    ssh: IntegrationSshSession,
}

impl PgClient {
    pub fn new(config: PgConnectionConfig) -> PgResult<Self> {
        if config.host.trim().is_empty() {
            return Err(PgError::connection("SSH host cannot be empty"));
        }

        let ssh_user = config.ssh_user.as_deref().unwrap_or("root");
        if ssh_user.trim().is_empty() {
            return Err(PgError::connection("SSH user cannot be empty"));
        }

        let ssh = IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: ssh_user,
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config
                .timeout_secs
                .unwrap_or(30)
                .clamp(1, MAX_SSH_TIMEOUT_SECS),
        });

        Ok(Self { config, ssh })
    }

    // ── Binary paths ─────────────────────────────────────────────

    pub fn psql_bin(&self) -> &str {
        "psql"
    }

    pub fn pg_dump_bin(&self) -> &str {
        "pg_dump"
    }

    pub fn pg_restore_bin(&self) -> &str {
        "pg_restore"
    }

    pub fn pg_basebackup_bin(&self) -> &str {
        "pg_basebackup"
    }

    // ── Connection defaults ──────────────────────────────────────

    fn pg_user(&self) -> &str {
        self.config.pg_user.as_deref().unwrap_or("postgres")
    }

    fn pg_host(&self) -> &str {
        self.config.pg_host.as_deref().unwrap_or("127.0.0.1")
    }

    fn pg_port(&self) -> u16 {
        self.config.pg_port.unwrap_or(5432)
    }

    fn pg_database(&self) -> &str {
        self.config.pg_database.as_deref().unwrap_or("postgres")
    }

    fn _data_dir(&self) -> &str {
        self.config
            .data_dir
            .as_deref()
            .unwrap_or("/var/lib/postgresql")
    }

    fn _config_dir(&self) -> &str {
        self.config
            .config_dir
            .as_deref()
            .unwrap_or("/etc/postgresql")
    }

    // ── Command builders ─────────────────────────────────────────

    /// Build a psql command against the default database.
    /// Produces: PGPASSWORD=xx psql -U user -h host -p port -d db -t -A -c "sql"
    pub fn psql_cmd(&self, sql: &str) -> String {
        self.psql_cmd_db(self.pg_database(), sql)
    }

    /// Build a psql command against a specific database.
    pub fn psql_cmd_db(&self, db: &str, sql: &str) -> String {
        let mut parts = Vec::new();
        if let Some(ref pw) = self.config.pg_password {
            parts.push(format!("PGPASSWORD={}", shell_escape(pw)));
        }
        parts.push(self.psql_bin().to_string());
        parts.push(format!("-U {}", shell_escape(self.pg_user())));
        parts.push(format!("-h {}", shell_escape(self.pg_host())));
        parts.push(format!("-p {}", self.pg_port()));
        parts.push(format!("-d {}", shell_escape(db)));
        parts.push("-t -A".to_string());
        parts.push(format!("-c {}", shell_escape(sql)));
        parts.join(" ")
    }

    /// Build a pg_dump connection string fragment.
    pub fn pg_dump_conn_args(&self, db: &str) -> String {
        let mut parts = Vec::new();
        parts.push(format!("-U {}", shell_escape(self.pg_user())));
        parts.push(format!("-h {}", shell_escape(self.pg_host())));
        parts.push(format!("-p {}", self.pg_port()));
        parts.push(shell_escape(db));
        parts.join(" ")
    }

    /// Build a PGPASSWORD prefix for pg_dump/pg_restore.
    pub fn pgpassword_prefix(&self) -> String {
        match &self.config.pg_password {
            Some(pw) => format!("PGPASSWORD={} ", shell_escape(pw)),
            None => String::new(),
        }
    }

    // ── SSH command execution ────────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> PgResult<SshOutput> {
        debug!(
            "Executing PostgreSQL administration command on {}",
            self.config.host
        );

        let stdout = self
            .ssh
            .execute(
                command,
                Some(
                    self.config
                        .timeout_secs
                        .unwrap_or(30)
                        .clamp(1, MAX_SSH_TIMEOUT_SECS)
                        .saturating_mul(1000),
                ),
            )
            .await
            .map_err(|error| PgError::ssh(self.redact_transport_error(&error)))?;

        if stdout.len() > MAX_SSH_OUTPUT_BYTES {
            return Err(PgError::command_failed(
                "Remote command output exceeded the 8 MiB safety limit",
            ));
        }

        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    fn redact_transport_error(&self, error: &str) -> String {
        let mut boundary = error.len().min(MAX_SSH_ERROR_BYTES);
        while !error.is_char_boundary(boundary) {
            boundary -= 1;
        }
        let mut redacted = error[..boundary].to_string();
        for secret in [
            self.config.ssh_password.as_deref(),
            self.config.pg_password.as_deref(),
        ]
        .into_iter()
        .flatten()
        .filter(|secret| !secret.is_empty())
        {
            redacted = redacted.replace(&shell_escape(secret), "[REDACTED]");
            redacted = redacted.replace(secret, "[REDACTED]");
        }
        if boundary < error.len() {
            redacted.push_str(" [truncated]");
        }
        redacted
    }

    /// Execute SQL against the default database and return stdout.
    pub async fn exec_sql(&self, sql: &str) -> PgResult<String> {
        let cmd = self.psql_cmd(sql);
        let out = self.exec_ssh(&cmd).await?;
        Ok(out.stdout)
    }

    /// Execute SQL against a specific database and return stdout.
    pub async fn exec_sql_db(&self, db: &str, sql: &str) -> PgResult<String> {
        let cmd = self.psql_cmd_db(db, sql);
        let out = self.exec_ssh(&cmd).await?;
        Ok(out.stdout)
    }

    // ── File operations ──────────────────────────────────────────

    pub async fn read_remote_file(&self, path: &str) -> PgResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> PgResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> PgResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }
}

/// Minimal shell escaping to prevent injection via file paths or arguments.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
