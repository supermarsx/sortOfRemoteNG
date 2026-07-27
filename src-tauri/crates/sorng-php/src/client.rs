// ── sorng-php – SSH/CLI client ────────────────────────────────────────────────
//! Executes PHP commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and status queries.

use crate::error::{PhpError, PhpResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
use std::sync::Arc;

#[async_trait::async_trait]
pub(crate) trait SshTransport: Send + Sync {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String>;
    async fn disconnect(&self) -> Result<(), String>;
}

#[async_trait::async_trait]
impl SshTransport for IntegrationSshSession {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String> {
        IntegrationSshSession::execute(self, command, timeout_ms).await
    }

    async fn disconnect(&self) -> Result<(), String> {
        IntegrationSshSession::disconnect(self).await
    }
}

/// PHP management client – connects via SSH to manage PHP remotely.
pub struct PhpClient {
    pub config: PhpConnectionConfig,
    ssh: Arc<dyn SshTransport>,
}

impl PhpClient {
    pub fn new(config: PhpConnectionConfig) -> PhpResult<Self> {
        validate_config_executables(&config)?;
        let ssh = Arc::new(IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30),
        }));
        Ok(Self { config, ssh })
    }

    #[cfg(test)]
    pub(crate) fn with_test_transport(
        config: PhpConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> Self {
        Self { config, ssh }
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn php_bin(&self) -> &str {
        self.config.php_bin.as_deref().unwrap_or("php")
    }

    pub fn fpm_bin(&self) -> &str {
        self.config.fpm_bin.as_deref().unwrap_or("php-fpm")
    }

    pub fn composer_bin(&self) -> &str {
        self.config.composer_bin.as_deref().unwrap_or("composer")
    }

    pub fn config_dir(&self) -> &str {
        self.config.config_dir.as_deref().unwrap_or("/etc/php")
    }

    pub fn fpm_pool_dir(&self, version: &str) -> PhpResult<String> {
        validate_php_version(version)?;
        Ok(self
            .config
            .fpm_pool_dir
            .clone()
            .unwrap_or_else(|| format!("{}/{}/fpm/pool.d", self.config_dir(), version)))
    }

    /// Versioned PHP binary path
    pub fn versioned_php_bin(&self, version: &str) -> PhpResult<String> {
        validate_php_version(version)?;
        Ok(format!("php{}", version))
    }

    /// Versioned FPM service name
    pub fn fpm_service_name(&self, version: &str) -> PhpResult<String> {
        validate_php_version(version)?;
        Ok(format!("php{}-fpm", version))
    }

    // ── SSH command execution stub ───────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> PhpResult<SshOutput> {
        debug!("PHP SSH [{}]: {}", self.config.host, command);
        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(PhpError::ssh)?;
        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn disconnect(&self) -> PhpResult<()> {
        self.ssh.disconnect().await.map_err(PhpError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> PhpResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    /// Read a file that is allowed to be absent without treating transport,
    /// permission, or wrong-file-type failures as absence.
    pub async fn read_remote_file_if_exists(&self, path: &str) -> PhpResult<Option<String>> {
        const MISSING: &str = "__SORNG_FILE_NOT_FOUND__";
        let escaped = shell_escape(path);
        let out = self
            .exec_ssh(&format!(
                "if [ -f {escaped} ]; then cat -- {escaped}; elif [ ! -e {escaped} ]; then printf '%s' '{MISSING}'; else echo 'Path is not a regular file: {escaped}' >&2; exit 1; fi"
            ))
            .await?;
        if out.stdout == MISSING {
            Ok(None)
        } else {
            Ok(Some(out.stdout))
        }
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> PhpResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> PhpResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn dir_exists(&self, path: &str) -> PhpResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -d {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_dir(&self, path: &str) -> PhpResult<Vec<String>> {
        let out = self
            .exec_ssh(&format!("ls -1 -- {}", shell_escape(path)))
            .await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    /// List a directory that may be absent, preserving all other failures.
    pub async fn list_dir_if_exists(&self, path: &str) -> PhpResult<Option<Vec<String>>> {
        const MISSING: &str = "__SORNG_DIRECTORY_NOT_FOUND__";
        let escaped = shell_escape(path);
        let out = self
            .exec_ssh(&format!(
                "if [ -d {escaped} ]; then ls -1 -- {escaped}; elif [ ! -e {escaped} ]; then printf '%s' '{MISSING}'; else echo 'Path is not a directory: {escaped}' >&2; exit 1; fi"
            ))
            .await?;
        if out.stdout == MISSING {
            Ok(None)
        } else {
            Ok(Some(
                out.stdout
                    .lines()
                    .filter(|line| !line.is_empty())
                    .map(String::from)
                    .collect(),
            ))
        }
    }

    pub async fn symlink(&self, target: &str, link: &str) -> PhpResult<()> {
        self.exec_ssh(&format!(
            "sudo ln -sf {} {}",
            shell_escape(target),
            shell_escape(link)
        ))
        .await?;
        Ok(())
    }

    pub async fn remove_file(&self, path: &str) -> PhpResult<()> {
        self.exec_ssh(&format!("sudo rm -f {}", shell_escape(path)))
            .await?;
        Ok(())
    }

    pub async fn backup_file(&self, path: &str) -> PhpResult<String> {
        let backup = format!("{}.bak.{}", path, chrono::Utc::now().format("%Y%m%d%H%M%S"));
        self.exec_ssh(&format!(
            "sudo cp {} {}",
            shell_escape(path),
            shell_escape(&backup)
        ))
        .await?;
        Ok(backup)
    }

    /// Check if a command / binary exists on the remote host.
    pub async fn command_exists(&self, cmd: &str) -> PhpResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "command -v {} >/dev/null 2>&1 && echo yes || echo no",
                shell_escape(cmd)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }
}

/// Minimal shell escaping to prevent injection via file paths or arguments.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub(crate) fn validate_php_version(version: &str) -> PhpResult<()> {
    let mut components = version.split('.');
    let valid = !version.is_empty()
        && version.trim() == version
        && version
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        && components.by_ref().all(|part| !part.is_empty())
        && (1..=3).contains(&version.split('.').count());
    if !valid {
        return Err(PhpError::parse(
            "PHP version must contain one to three dot-separated numeric components",
        ));
    }
    Ok(())
}

fn validate_config_executables(config: &PhpConnectionConfig) -> PhpResult<()> {
    for (field, executable) in [
        ("php_bin", config.php_bin.as_deref()),
        ("fpm_bin", config.fpm_bin.as_deref()),
        ("composer_bin", config.composer_bin.as_deref()),
    ] {
        if let Some(executable) = executable {
            validate_executable(executable, field)?;
        }
    }
    Ok(())
}

fn validate_executable(value: &str, field: &str) -> PhpResult<()> {
    let is_absolute = value.starts_with('/');
    let is_identifier = !value.contains('/');
    let has_safe_characters = value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'+' | b'/')
    });
    let starts_safely = value
        .as_bytes()
        .first()
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'/');

    if value.is_empty()
        || value.trim() != value
        || (!is_absolute && !is_identifier)
        || !has_safe_characters
        || !starts_safely
        || value.split('/').any(|segment| segment == "..")
    {
        return Err(PhpError::parse(format!(
            "{field} must be a command identifier or absolute path containing only safe characters"
        )));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::SshTransport;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    pub(crate) struct FakeSshTransport {
        outcomes: Mutex<VecDeque<Result<String, String>>>,
        commands: Mutex<Vec<String>>,
    }

    impl FakeSshTransport {
        pub(crate) fn new(outcomes: Vec<Result<String, String>>) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into()),
                commands: Mutex::new(Vec::new()),
            }
        }

        pub(crate) fn commands(&self) -> Vec<String> {
            self.commands.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl SshTransport for FakeSshTransport {
        async fn execute(&self, command: &str, _: Option<u64>) -> Result<String, String> {
            self.commands.lock().unwrap().push(command.to_string());
            self.outcomes
                .lock()
                .unwrap()
                .pop_front()
                .expect("fake SSH outcome exhausted")
        }

        async fn disconnect(&self) -> Result<(), String> {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> PhpConnectionConfig {
        PhpConnectionConfig {
            host: "php.example.test".into(),
            port: Some(22),
            ssh_user: Some("admin".into()),
            ssh_password: None,
            ssh_key: None,
            php_bin: None,
            fpm_bin: None,
            composer_bin: None,
            config_dir: None,
            fpm_pool_dir: None,
            timeout_secs: Some(5),
        }
    }

    #[test]
    fn rejects_injectable_configured_executables_before_connecting() {
        for (field, value) in [
            ("php_bin", "php; touch /tmp/php-pwned"),
            ("fpm_bin", "php-fpm$(id)"),
            ("composer_bin", "composer && id"),
        ] {
            let mut config = config();
            match field {
                "php_bin" => config.php_bin = Some(value.into()),
                "fpm_bin" => config.fpm_bin = Some(value.into()),
                "composer_bin" => config.composer_bin = Some(value.into()),
                _ => unreachable!(),
            }
            let error = match PhpClient::new(config) {
                Ok(_) => panic!("injectable {field} must be rejected"),
                Err(error) => error,
            };
            assert!(error.message.contains(field));
        }
    }

    #[test]
    fn rejects_injectable_php_version_tokens() {
        for version in ["8.3; id", "$(id)", "8..3", "../8.3", "8.3-dev"] {
            let error = validate_php_version(version).unwrap_err();
            assert!(error.message.contains("PHP version"));
        }
        validate_php_version("8.3").unwrap();
        validate_php_version("8.3.12").unwrap();
    }

    #[tokio::test]
    async fn invalid_version_stops_before_remote_process_command() {
        let fake = Arc::new(test_support::FakeSshTransport::new(vec![]));
        let client = PhpClient::with_test_transport(config(), fake.clone());

        let error = crate::process::ProcessManager::start(&client, "8.3; id")
            .await
            .unwrap_err();

        assert!(error.message.contains("PHP version"));
        assert!(fake.commands().is_empty());
    }
}
