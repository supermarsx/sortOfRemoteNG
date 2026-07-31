// ── sorng-mysql-admin – SSH/CLI client ────────────────────────────────────────
//! Executes MySQL commands on a remote host via SSH.
//! Handles SQL execution, config file reading/writing, and command building.

use crate::error::{MysqlError, MysqlResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};

const MAX_SSH_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SSH_ERROR_BYTES: usize = 64 * 1024;
const MAX_MYSQL_PASSWORD_BYTES: usize = 64 * 1024;

/// MySQL administration client – connects via SSH to manage MySQL remotely.
pub struct MysqlClient {
    pub config: MysqlConnectionConfig,
    ssh: IntegrationSshSession,
}

impl MysqlClient {
    pub fn new(mut config: MysqlConnectionConfig) -> MysqlResult<Self> {
        config.host = config.host.trim().to_string();
        if config.host.is_empty() {
            return Err(MysqlError::ssh("SSH host cannot be empty"));
        }

        if let Some(user) = config.ssh_user.as_mut() {
            *user = user.trim().to_string();
            if user.is_empty() {
                return Err(MysqlError::ssh("SSH user cannot be empty"));
            }
        }

        let ssh = IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30).max(1),
        });

        Ok(Self { config, ssh })
    }

    // ── Binary paths ─────────────────────────────────────────────

    pub fn mysql_bin(&self) -> &str {
        "mysql"
    }

    pub fn mysqldump_bin(&self) -> &str {
        "mysqldump"
    }

    // ── Command builders ─────────────────────────────────────────

    /// Build a base `mysql` invocation without placing credentials in argv.
    fn mysql_base_args(&self) -> String {
        self.mysql_base_args_for(false)
    }

    fn mysql_base_args_for(&self, protected_defaults: bool) -> String {
        let user = self.config.mysql_user.as_deref().unwrap_or("root");
        let host = self.config.mysql_host.as_deref().unwrap_or("127.0.0.1");
        let port = self.config.mysql_port.unwrap_or(3306);
        let binary = if protected_defaults {
            format!(
                "{} --defaults-extra-file=\"$d/client.cnf\"",
                self.mysql_bin()
            )
        } else {
            self.mysql_bin().to_string()
        };

        let mut args = format!(
            "{} -u {} -h {} -P {}",
            binary,
            shell_escape(user),
            shell_escape(host),
            port
        );

        if let Some(ref socket) = self.config.mysql_socket {
            args = format!(
                "{} -u {} --socket={}",
                binary,
                shell_escape(user),
                shell_escape(socket)
            );
        }

        args
    }

    /// Build a full `mysql` command that runs SQL in batch mode.
    pub fn mysql_cmd(&self, sql: &str) -> String {
        let base = self.mysql_base_args();
        let escaped_sql = sql.replace('\'', "'\\''");
        format!("{} --batch --skip-column-names -e '{}'", base, escaped_sql)
    }

    /// Build a full `mysql` command that runs SQL against a specific database.
    pub fn mysql_cmd_db(&self, db: &str, sql: &str) -> String {
        let base = self.mysql_base_args();
        let escaped_sql = sql.replace('\'', "'\\''");
        format!(
            "{} --batch --skip-column-names {} -e '{}'",
            base,
            shell_escape(db),
            escaped_sql
        )
    }

    /// Build a `mysqldump` invocation without placing credentials in argv.
    fn mysqldump_base_args(&self) -> String {
        self.mysqldump_base_args_for(false)
    }

    fn mysqldump_base_args_for(&self, protected_defaults: bool) -> String {
        let user = self.config.mysql_user.as_deref().unwrap_or("root");
        let host = self.config.mysql_host.as_deref().unwrap_or("127.0.0.1");
        let port = self.config.mysql_port.unwrap_or(3306);
        let binary = if protected_defaults {
            format!(
                "{} --defaults-extra-file=\"$d/client.cnf\"",
                self.mysqldump_bin()
            )
        } else {
            self.mysqldump_bin().to_string()
        };

        let mut args = format!(
            "{} -u {} -h {} -P {}",
            binary,
            shell_escape(user),
            shell_escape(host),
            port
        );

        if let Some(ref socket) = self.config.mysql_socket {
            args = format!(
                "{} -u {} --socket={}",
                binary,
                shell_escape(user),
                shell_escape(socket)
            );
        }

        args
    }

    /// Build a `mysqldump` command for one or more databases.
    pub fn mysqldump_cmd(&self, dbs: &[&str], extra_flags: &str) -> String {
        self.mysqldump_cmd_for(dbs, extra_flags, false)
    }

    fn mysqldump_cmd_for(
        &self,
        dbs: &[&str],
        extra_flags: &str,
        protected_defaults: bool,
    ) -> String {
        let base = if protected_defaults {
            self.mysqldump_base_args_for(true)
        } else {
            self.mysqldump_base_args()
        };
        let db_list = dbs
            .iter()
            .map(|database| shell_escape(database))
            .collect::<Vec<_>>()
            .join(" ");
        if extra_flags.is_empty() {
            format!("{} --databases {}", base, db_list)
        } else {
            format!("{} {} --databases {}", base, extra_flags, db_list)
        }
    }

    // ── SSH command execution ────────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> MysqlResult<SshOutput> {
        debug!("Executing MySQL admin SSH command on {}", self.config.host);

        let output = self
            .ssh
            .execute(
                command,
                Some(
                    self.config
                        .timeout_secs
                        .unwrap_or(30)
                        .max(1)
                        .saturating_mul(1000),
                ),
            )
            .await
            .map_err(|error| {
                MysqlError::ssh(redact_and_bound_error(
                    error,
                    &[
                        self.config.ssh_password.as_deref(),
                        self.config.mysql_password.as_deref(),
                    ],
                ))
            })?;

        if output.len() > MAX_SSH_OUTPUT_BYTES {
            return Err(MysqlError::ssh(format!(
                "SSH command output exceeded the {} byte limit",
                MAX_SSH_OUTPUT_BYTES
            )));
        }

        Ok(SshOutput {
            stdout: output,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    async fn exec_ssh_with_input(&self, command: &str, input: Vec<u8>) -> MysqlResult<SshOutput> {
        debug!(
            "Executing MySQL admin SSH command with protected stdin on {}",
            self.config.host
        );
        let output = self
            .ssh
            .execute_with_input(
                command,
                input,
                Some(
                    self.config
                        .timeout_secs
                        .unwrap_or(30)
                        .max(1)
                        .saturating_mul(1000),
                ),
            )
            .await
            .map_err(|error| {
                MysqlError::ssh(redact_and_bound_error(
                    error,
                    &[
                        self.config.ssh_password.as_deref(),
                        self.config.mysql_password.as_deref(),
                    ],
                ))
            })?;
        Ok(SshOutput {
            stdout: output,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    fn protected_defaults(&self, operation: String) -> MysqlResult<(String, Vec<u8>)> {
        let Some(password) = self.config.mysql_password.as_deref() else {
            return Ok((operation, Vec::new()));
        };
        if password.len() > MAX_MYSQL_PASSWORD_BYTES
            || password
                .as_bytes()
                .iter()
                .any(|byte| matches!(*byte, b'\0' | b'\r' | b'\n'))
        {
            return Err(MysqlError::query(
                "MySQL passwords containing NUL or line breaks, or exceeding 64 KiB, are unavailable through the protected transport",
            ));
        }

        let mut option_file = Vec::with_capacity(password.len().saturating_add(32));
        option_file.extend_from_slice(b"[client]\npassword=\"");
        for byte in password.as_bytes() {
            if matches!(byte, b'\\' | b'"') {
                option_file.push(b'\\');
            }
            option_file.push(*byte);
        }
        option_file.extend_from_slice(b"\"\n");

        let mut input = option_file.len().to_string().into_bytes();
        input.push(b'\n');
        input.extend_from_slice(&option_file);
        option_file.fill(0);

        let wrapper = format!(
            "umask 077; d=$(mktemp -d) || exit 125; \
             cleanup() {{ rm -rf \"$d\"; }}; trap cleanup EXIT; \
             trap 'cleanup; exit 130' HUP INT TERM; \
             IFS= read -r n || exit 125; \
             case \"$n\" in ''|*[!0-9]*) exit 125;; esac; \
             [ \"$n\" -le 131072 ] || exit 125; \
             dd bs=1 count=\"$n\" of=\"$d/client.cnf\" 2>/dev/null || exit 125; \
             chmod 600 \"$d/client.cnf\" || exit 125; {operation}"
        );
        Ok((wrapper, input))
    }

    fn mysql_invocation(&self, db: Option<&str>) -> String {
        let mut command = self.mysql_base_args_for(self.config.mysql_password.is_some());
        command.push_str(" --batch --skip-column-names");
        if let Some(db) = db {
            command.push(' ');
            command.push_str(&shell_escape(db));
        }
        command
    }

    async fn exec_sql_stdin(&self, db: Option<&str>, sql: &str) -> MysqlResult<String> {
        let (command, mut input) = self.protected_defaults(self.mysql_invocation(db))?;
        input.extend_from_slice(sql.as_bytes());
        input.push(b'\n');
        let out = self.exec_ssh_with_input(&command, input).await?;
        Ok(out.stdout)
    }

    /// Execute a SQL statement via SSH → mysql CLI.
    pub async fn exec_sql(&self, sql: &str) -> MysqlResult<String> {
        self.exec_sql_stdin(None, sql).await
    }

    /// Execute password-bearing SQL while ensuring no secret can survive an
    /// SSH, CLI, or database error boundary.
    pub async fn exec_sql_sensitive(&self, sql: &str, secrets: &[&str]) -> MysqlResult<String> {
        self.exec_sql(sql).await.map_err(|error| {
            let secret_options = secrets.iter().copied().map(Some).collect::<Vec<_>>();
            MysqlError::query(redact_and_bound_error(error.to_string(), &secret_options))
        })
    }

    /// Execute a SQL statement in a specific database via SSH → mysql CLI.
    pub async fn exec_sql_db(&self, db: &str, sql: &str) -> MysqlResult<String> {
        self.exec_sql_stdin(Some(db), sql).await
    }

    pub async fn dump_to_file(
        &self,
        databases: &[&str],
        extra_flags: &str,
        output_path: &str,
        compress: bool,
    ) -> MysqlResult<SshOutput> {
        let protected = self.config.mysql_password.is_some();
        let dump = self.mysqldump_cmd_for(databases, extra_flags, protected);
        let operation = if compress {
            format!("{dump} | gzip > {}", shell_escape(output_path))
        } else {
            format!("{dump} > {}", shell_escape(output_path))
        };
        let timed = format!(
            "START_T=$(date +%s); {operation}; status=$?; \
             END_T=$(date +%s); [ \"$status\" -eq 0 ] || exit \"$status\"; \
             echo \"DURATION:$((END_T - START_T))\""
        );
        let (command, input) = self.protected_defaults(timed)?;
        self.exec_ssh_with_input(&command, input).await
    }

    pub async fn dump_table_to_file(&self, db: &str, table: &str, path: &str) -> MysqlResult<()> {
        let protected = self.config.mysql_password.is_some();
        let base = self.mysqldump_base_args_for(protected);
        let operation = format!(
            "{base} --single-transaction {} {} > {}",
            shell_escape(db),
            shell_escape(table),
            shell_escape(path)
        );
        let (command, input) = self.protected_defaults(operation)?;
        self.exec_ssh_with_input(&command, input).await?;
        Ok(())
    }

    pub async fn restore_from_file(&self, db: &str, path: &str) -> MysqlResult<()> {
        let mysql = format!(
            "{} {}",
            self.mysql_base_args_for(self.config.mysql_password.is_some()),
            shell_escape(db)
        );
        let operation = if path.ends_with(".gz") {
            format!("gunzip -c {} | {mysql}", shell_escape(path))
        } else {
            format!("{mysql} < {}", shell_escape(path))
        };
        let (command, input) = self.protected_defaults(operation)?;
        self.exec_ssh_with_input(&command, input).await?;
        Ok(())
    }

    // ── Remote file helpers ──────────────────────────────────────

    pub async fn read_remote_file(&self, path: &str) -> MysqlResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> MysqlResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> MysqlResult<bool> {
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

fn redact_and_bound_error(mut error: String, secrets: &[Option<&str>]) -> String {
    for secret in secrets.iter().filter_map(|value| *value) {
        if !secret.is_empty() {
            error = error.replace(secret, "[REDACTED]");
            error = error.replace(&shell_escape(secret), "[REDACTED]");
            error = error.replace(
                &secret.replace('\'', "\\'").replace('\\', "\\\\"),
                "[REDACTED]",
            );
        }
    }

    truncate_utf8(error, MAX_SSH_ERROR_BYTES)
}

fn truncate_utf8(mut value: String, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value;
    }

    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value.push_str(" [truncated]");
    value
}
