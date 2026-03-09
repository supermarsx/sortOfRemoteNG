// ── sorng-mysql-admin – SSH/CLI client ────────────────────────────────────────
//! Executes MySQL commands on a remote host via SSH.
//! Handles SQL execution, config file reading/writing, and command building.

use crate::error::{MysqlError, MysqlResult};
use crate::types::*;
use log::debug;

/// MySQL administration client – connects via SSH to manage MySQL remotely.
pub struct MysqlClient {
    pub config: MysqlConnectionConfig,
}

impl MysqlClient {
    pub fn new(config: MysqlConnectionConfig) -> MysqlResult<Self> {
        Ok(Self { config })
    }

    // ── Binary paths ─────────────────────────────────────────────

    pub fn mysql_bin(&self) -> &str {
        "mysql"
    }

    pub fn mysqldump_bin(&self) -> &str {
        "mysqldump"
    }

    // ── Command builders ─────────────────────────────────────────

    /// Build a base `mysql` invocation with credentials and connection options.
    fn mysql_base_args(&self) -> String {
        let user = self.config.mysql_user.as_deref().unwrap_or("root");
        let host = self.config.mysql_host.as_deref().unwrap_or("127.0.0.1");
        let port = self.config.mysql_port.unwrap_or(3306);

        let mut args = format!("{} -u {} -h {} -P {}", self.mysql_bin(), user, host, port);

        if let Some(ref socket) = self.config.mysql_socket {
            args = format!(
                "{} -u {} --socket={}",
                self.mysql_bin(),
                user,
                shell_escape(socket)
            );
        }

        if let Some(ref pw) = self.config.mysql_password {
            args.push_str(&format!(" -p'{}'", pw.replace('\'', "'\\''")));
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

    /// Build a `mysqldump` invocation with credentials and connection options.
    fn mysqldump_base_args(&self) -> String {
        let user = self.config.mysql_user.as_deref().unwrap_or("root");
        let host = self.config.mysql_host.as_deref().unwrap_or("127.0.0.1");
        let port = self.config.mysql_port.unwrap_or(3306);

        let mut args = format!(
            "{} -u {} -h {} -P {}",
            self.mysqldump_bin(),
            user,
            host,
            port
        );

        if let Some(ref socket) = self.config.mysql_socket {
            args = format!(
                "{} -u {} --socket={}",
                self.mysqldump_bin(),
                user,
                shell_escape(socket)
            );
        }

        if let Some(ref pw) = self.config.mysql_password {
            args.push_str(&format!(" -p'{}'", pw.replace('\'', "'\\''")));
        }

        args
    }

    /// Build a `mysqldump` command for one or more databases.
    pub fn mysqldump_cmd(&self, dbs: &[&str], extra_flags: &str) -> String {
        let base = self.mysqldump_base_args();
        let db_list = dbs.join(" ");
        if extra_flags.is_empty() {
            format!("{} --databases {}", base, db_list)
        } else {
            format!("{} {} --databases {}", base, extra_flags, db_list)
        }
    }

    // ── SSH command execution stub ───────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> MysqlResult<SshOutput> {
        debug!("MySQL SSH [{}]: {}", self.config.host, command);
        Err(MysqlError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    /// Execute a SQL statement via SSH → mysql CLI.
    pub async fn exec_sql(&self, sql: &str) -> MysqlResult<String> {
        let cmd = self.mysql_cmd(sql);
        let out = self.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(MysqlError::query(format!(
                "SQL error (exit {}): {}",
                out.exit_code,
                out.stderr.trim()
            )));
        }
        Ok(out.stdout)
    }

    /// Execute a SQL statement in a specific database via SSH → mysql CLI.
    pub async fn exec_sql_db(&self, db: &str, sql: &str) -> MysqlResult<String> {
        let cmd = self.mysql_cmd_db(db, sql);
        let out = self.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(MysqlError::query(format!(
                "SQL error in {db} (exit {}): {}",
                out.exit_code,
                out.stderr.trim()
            )));
        }
        Ok(out.stdout)
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
