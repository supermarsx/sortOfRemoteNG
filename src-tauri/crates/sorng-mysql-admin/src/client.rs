// ── sorng-mysql-admin – SSH/CLI client ────────────────────────────────────────

use crate::error::{MysqlAdminError, MysqlAdminResult};
use crate::types::*;
use log::debug;

/// MySQL administration client – connects via SSH to manage MySQL/MariaDB remotely.
pub struct MysqlAdminClient {
    pub config: MysqlConnectionConfig,
}

impl MysqlAdminClient {
    pub fn new(config: MysqlConnectionConfig) -> MysqlAdminResult<Self> {
        Ok(Self { config })
    }

    fn mysql_user(&self) -> &str {
        self.config.mysql_user.as_deref().unwrap_or("root")
    }

    fn mysql_port(&self) -> u16 {
        self.config.port.unwrap_or(3306)
    }

    // ── SSH command execution stub ───────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> MysqlAdminResult<SshOutput> {
        debug!("MYSQL-ADMIN SSH [{}]: {}", self.config.host, command);
        Err(MysqlAdminError::connection(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    // ── MySQL query execution ────────────────────────────────────────

    pub async fn exec_mysql(&self, query: &str) -> MysqlAdminResult<String> {
        let mut cmd = format!("mysql -u {}", shell_escape(self.mysql_user()));
        if let Some(ref pw) = self.config.mysql_password {
            cmd.push_str(&format!(" -p{}", shell_escape(pw)));
        }
        if let Some(ref socket) = self.config.mysql_socket {
            cmd.push_str(&format!(" -S {}", shell_escape(socket)));
        } else {
            cmd.push_str(&format!(" -P {}", self.mysql_port()));
        }
        cmd.push_str(&format!(" -N -B -e {}", shell_escape(query)));
        let out = self.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(MysqlAdminError::query(format!(
                "MySQL query failed (exit {}): {}",
                out.exit_code,
                out.stderr.trim()
            )));
        }
        Ok(out.stdout)
    }

    pub async fn exec_mysql_db(&self, db: &str, query: &str) -> MysqlAdminResult<String> {
        let mut cmd = format!("mysql -u {}", shell_escape(self.mysql_user()));
        if let Some(ref pw) = self.config.mysql_password {
            cmd.push_str(&format!(" -p{}", shell_escape(pw)));
        }
        if let Some(ref socket) = self.config.mysql_socket {
            cmd.push_str(&format!(" -S {}", shell_escape(socket)));
        } else {
            cmd.push_str(&format!(" -P {}", self.mysql_port()));
        }
        cmd.push_str(&format!(" -N -B {} -e {}", shell_escape(db), shell_escape(query)));
        let out = self.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(MysqlAdminError::query(format!(
                "MySQL query on '{}' failed (exit {}): {}",
                db, out.exit_code,
                out.stderr.trim()
            )));
        }
        Ok(out.stdout)
    }

    // ── mysqldump execution ──────────────────────────────────────────

    pub async fn exec_mysqldump(&self, args: &str) -> MysqlAdminResult<SshOutput> {
        let mut cmd = format!("mysqldump -u {}", shell_escape(self.mysql_user()));
        if let Some(ref pw) = self.config.mysql_password {
            cmd.push_str(&format!(" -p{}", shell_escape(pw)));
        }
        if let Some(ref socket) = self.config.mysql_socket {
            cmd.push_str(&format!(" -S {}", shell_escape(socket)));
        } else {
            cmd.push_str(&format!(" -P {}", self.mysql_port()));
        }
        cmd.push_str(&format!(" {}", args));
        self.exec_ssh(&cmd).await
    }

    // ── Remote file helpers ──────────────────────────────────────────

    pub async fn read_remote_file(&self, path: &str) -> MysqlAdminResult<String> {
        let out = self.exec_ssh(&format!("cat {}", shell_escape(path))).await?;
        if out.exit_code != 0 {
            return Err(MysqlAdminError::config(format!(
                "Failed to read remote file '{}': {}", path, out.stderr.trim()
            )));
        }
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> MysqlAdminResult<()> {
        let escaped = shell_escape(content);
        let out = self.exec_ssh(&format!("printf '%s' {} > {}", escaped, shell_escape(path))).await?;
        if out.exit_code != 0 {
            return Err(MysqlAdminError::config(format!(
                "Failed to write remote file '{}': {}", path, out.stderr.trim()
            )));
        }
        Ok(())
    }
}

/// Shell-escape a value for safe inclusion in a remote command.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
