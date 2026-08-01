//! Terraform CLI wrapper: binary detection, version parsing, and bounded execution.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use log::debug;
use regex::Regex;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::error::{TerraformError, TerraformResult};
use crate::types::{ProviderVersion, TerraformConnectionConfig, TerraformInfo};

const MAX_STDOUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 2 * 1024 * 1024;
const MAX_BACKEND_METADATA_BYTES: u64 = 1024 * 1024;
const PIPE_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_REAP_TIMEOUT: Duration = Duration::from_secs(5);

const FAST_OPERATION_TIMEOUT: Duration = Duration::from_secs(60);
const LOCAL_OPERATION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const NETWORK_OPERATION_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const MUTATING_OPERATION_TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// Wraps a single Terraform working directory connection.
#[derive(Debug, Clone)]
pub struct TerraformClient {
    /// Path to the `terraform` binary.
    pub terraform_bin: PathBuf,
    /// Working directory containing `.tf` files.
    pub working_dir: PathBuf,
    /// Backend configuration overrides.
    pub backend_configs: HashMap<String, String>,
    /// Extra environment variables injected into every call.
    pub env_vars: HashMap<String, String>,
    /// CLI config file override.
    pub cli_config_file: Option<PathBuf>,
    /// Data dir override.
    pub data_dir: Option<PathBuf>,
}

impl TerraformClient {
    /// Build a client from a connection config (validates binary and working dir).
    pub async fn from_config(cfg: &TerraformConnectionConfig) -> TerraformResult<Self> {
        let terraform_bin = if let Some(ref configured_path) = cfg.terraform_path {
            let path = PathBuf::from(configured_path);
            if !is_direct_executable(&path) {
                return Err(TerraformError::binary_not_found(
                    "configured Terraform executable is unavailable",
                ));
            }
            path
        } else {
            Self::resolve_bin("terraform").await?
        };

        let working_dir = PathBuf::from(&cfg.working_dir);
        if !working_dir.is_dir() {
            return Err(TerraformError::working_dir_not_found(
                "configured Terraform working directory is unavailable",
            ));
        }

        Ok(Self {
            terraform_bin,
            working_dir,
            backend_configs: cfg.backend_configs.clone(),
            env_vars: cfg.env_vars.clone(),
            cli_config_file: cfg.cli_config_file.as_ref().map(PathBuf::from),
            data_dir: cfg.data_dir.as_ref().map(PathBuf::from),
        })
    }

    /// Resolve a native executable by name from PATH without invoking a shell or helper process.
    async fn resolve_bin(name: &str) -> TerraformResult<PathBuf> {
        let path = std::env::var_os("PATH").ok_or_else(|| {
            TerraformError::binary_not_found("Terraform executable was not found in PATH")
        })?;

        for directory in std::env::split_paths(&path) {
            for file_name in executable_names(name) {
                let candidate = directory.join(file_name);
                if is_direct_executable(&candidate) {
                    return Ok(candidate);
                }
            }
        }

        Err(TerraformError::binary_not_found(
            "Terraform executable was not found in PATH",
        ))
    }

    /// Detect version and environment info.
    pub async fn detect_info(&self) -> TerraformResult<TerraformInfo> {
        let output = self.run_json(&["version", "-json"]).await?;
        let parsed: serde_json::Value = serde_json::from_str(&output.stdout).map_err(|_| {
            TerraformError::json_parse("Terraform returned invalid version metadata")
        })?;

        let version = parsed["terraform_version"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        let platform = parsed["platform"].as_str().unwrap_or("unknown").to_string();

        let providers = if let Some(obj) = parsed["provider_selections"].as_object() {
            obj.iter()
                .map(|(key, value)| {
                    let parts: Vec<&str> = key.rsplitn(3, '/').collect();
                    ProviderVersion {
                        source: key.clone(),
                        name: parts.first().unwrap_or(&"").to_string(),
                        namespace: parts.get(1).unwrap_or(&"").to_string(),
                        version: value.as_str().unwrap_or("").to_string(),
                    }
                })
                .collect()
        } else {
            Vec::new()
        };

        let workspace = self
            .run_raw(&["workspace", "show"])
            .await?
            .stdout
            .trim()
            .to_string();
        let backend_type = self.detect_backend_type().await;

        Ok(TerraformInfo {
            version,
            platform,
            providers,
            working_dir: self.working_dir.display().to_string(),
            backend_type,
            workspace,
        })
    }

    /// Try to read the backend type from size-bounded local state metadata.
    async fn detect_backend_type(&self) -> Option<String> {
        let state_path = self
            .working_dir
            .join(".terraform")
            .join("terraform.tfstate");
        let file = tokio::fs::File::open(state_path).await.ok()?;
        let mut limited = file.take(MAX_BACKEND_METADATA_BYTES + 1);
        let mut content = Vec::new();
        limited.read_to_end(&mut content).await.ok()?;
        if content.len() as u64 > MAX_BACKEND_METADATA_BYTES {
            return None;
        }

        let value = serde_json::from_slice::<serde_json::Value>(&content).ok()?;
        value["backend"]["type"].as_str().map(str::to_owned)
    }

    /// Execute Terraform with the given args and return raw stdout/stderr/exit code.
    pub async fn run_raw(&self, args: &[&str]) -> TerraformResult<RawOutput> {
        self.execute(args, false).await
    }

    /// Execute Terraform with JSON output support.
    pub async fn run_json(&self, args: &[&str]) -> TerraformResult<RawOutput> {
        self.execute(args, false).await
    }

    /// Execute Terraform with `-no-color` automatically appended.
    pub async fn run_no_color(&self, args: &[&str]) -> TerraformResult<RawOutput> {
        self.execute(args, true).await
    }

    /// Execute one direct-argument Terraform process under bounded supervision.
    async fn execute(&self, args: &[&str], no_color: bool) -> TerraformResult<RawOutput> {
        let mut command = Command::new(&self.terraform_bin);
        command.current_dir(&self.working_dir);
        command.args(args);

        if no_color {
            command.arg("-no-color");
        }

        command.env("TF_IN_AUTOMATION", "1");
        for (key, value) in &self.env_vars {
            command.env(key, value);
        }
        if let Some(cli_config) = &self.cli_config_file {
            command.env("TF_CLI_CONFIG_FILE", cli_config);
        }
        if let Some(data_dir) = &self.data_dir {
            command.env("TF_DATA_DIR", data_dir);
        }

        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.kill_on_drop(true);

        debug!("starting bounded Terraform invocation");
        let start = Instant::now();
        let mut child = command.spawn().map_err(|_| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                "Terraform process could not be started",
            )
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                "Terraform output channel was unavailable",
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                "Terraform diagnostic channel was unavailable",
            )
        })?;

        let sensitive_literals = self.sensitive_literals(args);
        let timeout = operation_timeout(args);
        let (mut cancellation_guard, cancellation) = CancellationGuard::new();
        let supervisor = tokio::spawn(supervise_child(
            child,
            stdout,
            stderr,
            timeout,
            cancellation,
        ));

        let supervised = supervisor.await.map_err(|_| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                "Terraform process supervision failed",
            )
        });
        cancellation_guard.disarm();
        let supervised = supervised??;

        if supervised.stdout.truncated {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                "Terraform output exceeded the configured safety limit",
            ));
        }

        let mut stdout = String::from_utf8_lossy(&supervised.stdout.bytes).into_owned();
        let mut stderr = redact_diagnostic(
            &String::from_utf8_lossy(&supervised.stderr.bytes),
            &sensitive_literals,
        );
        if supervised.stderr.truncated {
            stderr.push_str("\n[Terraform diagnostic truncated at safety limit]");
        }
        if !supervised.status.success() {
            stdout = redact_diagnostic(&stdout, &sensitive_literals);
        }

        let elapsed = u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX);
        let exit_code = supervised.status.code().unwrap_or(-1);
        debug!(
            "Terraform invocation completed with exit code {} in {} ms",
            exit_code, elapsed
        );

        Ok(RawOutput {
            stdout,
            stderr,
            exit_code,
            duration_ms: elapsed,
        })
    }

    fn sensitive_literals(&self, args: &[&str]) -> Vec<String> {
        let mut literals = vec![
            self.terraform_bin.to_string_lossy().into_owned(),
            self.working_dir.to_string_lossy().into_owned(),
        ];

        literals.extend(self.backend_configs.values().cloned());
        literals.extend(
            self.env_vars
                .iter()
                .filter(|(key, _)| is_sensitive_environment_key(key))
                .map(|(_, value)| value.clone()),
        );
        if let Some(path) = &self.cli_config_file {
            literals.push(path.to_string_lossy().into_owned());
        }
        if let Some(path) = &self.data_dir {
            literals.push(path.to_string_lossy().into_owned());
        }

        let mut next_is_sensitive = false;
        for arg in args {
            if next_is_sensitive {
                literals.push((*arg).to_owned());
                next_is_sensitive = false;
                continue;
            }

            let flag = arg.split_once('=').map_or(*arg, |(flag, _)| flag);
            if is_sensitive_argument(flag) {
                if let Some((_, value)) = arg.split_once('=') {
                    literals.push(value.to_owned());
                    if let Some((_, nested_value)) = value.split_once('=') {
                        literals.push(nested_value.to_owned());
                    }
                } else {
                    next_is_sensitive = true;
                }
            }
        }

        literals.retain(|value| value.len() >= 8);
        literals.sort_by_key(|value| std::cmp::Reverse(value.len()));
        literals.dedup();
        literals
    }

    /// Build the backend-config args for `terraform init`.
    pub fn backend_config_args(&self) -> Vec<String> {
        self.backend_configs
            .iter()
            .map(|(key, value)| format!("-backend-config={key}={value}"))
            .collect()
    }
}

#[derive(Debug)]
struct SupervisedOutput {
    status: ExitStatus,
    stdout: BoundedCapture,
    stderr: BoundedCapture,
}

#[derive(Debug)]
struct BoundedCapture {
    bytes: Vec<u8>,
    truncated: bool,
}

#[derive(Debug)]
enum Completion {
    Exited(ExitStatus),
    TimedOut,
    Cancelled,
    WaitFailed,
}

struct CancellationGuard {
    sender: Option<oneshot::Sender<()>>,
}

impl CancellationGuard {
    fn new() -> (Self, oneshot::Receiver<()>) {
        let (sender, receiver) = oneshot::channel();
        (
            Self {
                sender: Some(sender),
            },
            receiver,
        )
    }

    fn disarm(&mut self) {
        self.sender.take();
    }
}

impl Drop for CancellationGuard {
    fn drop(&mut self) {
        if let Some(sender) = self.sender.take() {
            let _ = sender.send(());
        }
    }
}

async fn supervise_child(
    mut child: Child,
    stdout: ChildStdout,
    stderr: ChildStderr,
    timeout: Duration,
    mut cancellation: oneshot::Receiver<()>,
) -> TerraformResult<SupervisedOutput> {
    let mut stdout_task = tokio::spawn(read_bounded(stdout, MAX_STDOUT_BYTES));
    let mut stderr_task = tokio::spawn(read_bounded(stderr, MAX_STDERR_BYTES));

    let completion = tokio::select! {
        status = child.wait() => match status {
            Ok(status) => Completion::Exited(status),
            Err(_) => Completion::WaitFailed,
        },
        _ = tokio::time::sleep(timeout) => Completion::TimedOut,
        _ = &mut cancellation => Completion::Cancelled,
    };

    if !matches!(completion, Completion::Exited(_)) {
        terminate_and_reap(&mut child).await;
    }

    let captures = finish_capture_tasks(&mut stdout_task, &mut stderr_task).await;
    match completion {
        Completion::TimedOut => Err(TerraformError::timeout(
            "Terraform operation exceeded its safety deadline",
        )),
        Completion::Cancelled => Err(TerraformError::new(
            crate::error::TerraformErrorKind::ProcessExecution,
            "Terraform operation was cancelled",
        )),
        Completion::WaitFailed => Err(TerraformError::new(
            crate::error::TerraformErrorKind::ProcessExecution,
            "Terraform process could not be monitored",
        )),
        Completion::Exited(status) => {
            let (stdout, stderr) = captures?;
            Ok(SupervisedOutput {
                status,
                stdout,
                stderr,
            })
        }
    }
}

async fn terminate_and_reap(child: &mut Child) {
    let _ = child.start_kill();
    if tokio::time::timeout(PROCESS_REAP_TIMEOUT, child.wait())
        .await
        .is_err()
    {
        let _ = child.start_kill();
    }
}

async fn finish_capture_tasks(
    stdout_task: &mut JoinHandle<io::Result<BoundedCapture>>,
    stderr_task: &mut JoinHandle<io::Result<BoundedCapture>>,
) -> TerraformResult<(BoundedCapture, BoundedCapture)> {
    finish_capture_tasks_with_timeout(stdout_task, stderr_task, PIPE_DRAIN_TIMEOUT).await
}

async fn finish_capture_tasks_with_timeout(
    stdout_task: &mut JoinHandle<io::Result<BoundedCapture>>,
    stderr_task: &mut JoinHandle<io::Result<BoundedCapture>>,
    drain_timeout: Duration,
) -> TerraformResult<(BoundedCapture, BoundedCapture)> {
    let joined = tokio::time::timeout(drain_timeout, async {
        let stdout = (&mut *stdout_task).await;
        let stderr = (&mut *stderr_task).await;
        (stdout, stderr)
    })
    .await;

    let (stdout, stderr) = match joined {
        Ok(captures) => captures,
        Err(_) => {
            stdout_task.abort();
            stderr_task.abort();
            let _ = tokio::time::timeout(PIPE_DRAIN_TIMEOUT, async {
                let _ = (&mut *stdout_task).await;
                let _ = (&mut *stderr_task).await;
            })
            .await;
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::ProcessExecution,
                "Terraform output channels did not close safely",
            ));
        }
    };

    let stdout = stdout
        .map_err(|_| opaque_capture_error())?
        .map_err(|_| opaque_capture_error())?;
    let stderr = stderr
        .map_err(|_| opaque_capture_error())?
        .map_err(|_| opaque_capture_error())?;
    Ok((stdout, stderr))
}

fn opaque_capture_error() -> TerraformError {
    TerraformError::new(
        crate::error::TerraformErrorKind::ProcessExecution,
        "Terraform output could not be captured safely",
    )
}

async fn read_bounded<R>(mut reader: R, limit: usize) -> io::Result<BoundedCapture>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 16 * 1024];
    let mut truncated = false;

    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }

        let remaining = limit.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&buffer[..retained]);
        truncated |= retained < read;
    }

    Ok(BoundedCapture { bytes, truncated })
}

fn operation_timeout(args: &[&str]) -> Duration {
    let command_index = args
        .iter()
        .position(|arg| !arg.starts_with('-'))
        .unwrap_or(0);
    let command = args.get(command_index).copied().unwrap_or_default();
    let subcommand = args.get(command_index + 1).copied().unwrap_or_default();

    match (command, subcommand) {
        ("version" | "output" | "show" | "graph", _)
        | ("workspace", "show" | "list")
        | ("state", "list" | "show" | "pull") => FAST_OPERATION_TIMEOUT,
        ("validate" | "fmt" | "providers" | "get", _)
        | ("workspace", "new" | "select" | "delete")
        | ("state", "mv" | "rm" | "replace-provider") => LOCAL_OPERATION_TIMEOUT,
        ("init" | "plan" | "refresh" | "import", _) | ("state", "push") => {
            NETWORK_OPERATION_TIMEOUT
        }
        ("apply" | "destroy", _) => MUTATING_OPERATION_TIMEOUT,
        _ => LOCAL_OPERATION_TIMEOUT,
    }
}

fn is_sensitive_environment_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.starts_with("tf_var_")
        || [
            "token",
            "secret",
            "password",
            "passphrase",
            "api_key",
            "apikey",
            "access_key",
            "private_key",
            "credential",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn is_sensitive_argument(flag: &str) -> bool {
    matches!(
        flag,
        "-var"
            | "-var-file"
            | "-backend-config"
            | "-state"
            | "-state-out"
            | "-backup"
            | "-out"
            | "-plugin-dir"
            | "-chdir"
    )
}

fn redact_diagnostic(input: &str, sensitive_literals: &[String]) -> String {
    static ASSIGNMENT: OnceLock<Regex> = OnceLock::new();
    static ARGUMENT: OnceLock<Regex> = OnceLock::new();
    static BEARER: OnceLock<Regex> = OnceLock::new();
    static URL: OnceLock<Regex> = OnceLock::new();
    static WINDOWS_PATH: OnceLock<Regex> = OnceLock::new();
    static UNIX_PATH: OnceLock<Regex> = OnceLock::new();
    static TERRAFORM_FILE: OnceLock<Regex> = OnceLock::new();

    let mut redacted = input.to_owned();
    for literal in sensitive_literals {
        redacted = redacted.replace(literal, "<redacted>");
    }

    redacted = ASSIGNMENT
        .get_or_init(|| {
            Regex::new(
                r#"(?i)\b(TF_VAR_[A-Z0-9_]+|(?:access|api|client|private)[_-]?(?:key|secret)|password|passphrase|token|credential)\b(\s*(?:=|:)\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)"#,
            )
            .expect("valid diagnostic assignment pattern")
        })
        .replace_all(&redacted, "$1$2<redacted>")
        .into_owned();
    redacted = ARGUMENT
        .get_or_init(|| {
            Regex::new(
                r#"(?i)(-(?:var|var-file|backend-config|state|state-out|backup|out|plugin-dir|chdir)(?:=|\s+))(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)"#,
            )
            .expect("valid Terraform argument pattern")
        })
        .replace_all(&redacted, "$1<redacted>")
        .into_owned();
    redacted = BEARER
        .get_or_init(|| {
            Regex::new(r"(?i)\b(Bearer)\s+[A-Za-z0-9._~+/=-]+").expect("valid bearer token pattern")
        })
        .replace_all(&redacted, "$1 <redacted>")
        .into_owned();
    redacted = URL
        .get_or_init(|| {
            Regex::new(r#"(?i)\b(?:https?|ssh|s3)://[^\s\"'<>]+"#).expect("valid URL pattern")
        })
        .replace_all(&redacted, "<redacted-url>")
        .into_owned();
    redacted = WINDOWS_PATH
        .get_or_init(|| {
            Regex::new(r#"(?i)(?:\b[A-Z]:[\\/]|\\\\)[^\s\"'<>|]+"#)
                .expect("valid Windows path pattern")
        })
        .replace_all(&redacted, "<redacted-path>")
        .into_owned();
    redacted = UNIX_PATH
        .get_or_init(|| {
            Regex::new(r#"(^|[\s(\"'=])/(?:[^\s\"'<>]+)"#).expect("valid Unix path pattern")
        })
        .replace_all(&redacted, "$1<redacted-path>")
        .into_owned();
    TERRAFORM_FILE
        .get_or_init(|| {
            Regex::new(r#"\b[^\s\"'<>]+\.(?:tf|tfvars)(?::\d+(?::\d+)?)?"#)
                .expect("valid Terraform file pattern")
        })
        .replace_all(&redacted, "<redacted-path>")
        .into_owned()
}

fn executable_names(name: &str) -> Vec<OsString> {
    #[cfg(windows)]
    {
        if Path::new(name).extension().is_some() {
            vec![OsString::from(name)]
        } else {
            vec![
                OsString::from(format!("{name}.exe")),
                OsString::from(format!("{name}.com")),
            ]
        }
    }

    #[cfg(not(windows))]
    {
        vec![OsString::from(name)]
    }
}

fn is_direct_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(windows)]
    {
        path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("exe") || extension.eq_ignore_ascii_case("com")
            })
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }

    #[cfg(not(any(windows, unix)))]
    {
        true
    }
}

/// Raw output from a CLI invocation.
#[derive(Debug, Clone)]
pub struct RawOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn bounded_capture_drains_input_without_exceeding_limit() {
        let (mut writer, reader) = tokio::io::duplex(32);
        let write = async move {
            writer.write_all(b"0123456789").await.unwrap();
            writer.shutdown().await.unwrap();
        };
        let read = read_bounded(reader, 4);

        let (_, capture) = tokio::join!(write, read);
        let capture = capture.unwrap();
        assert_eq!(capture.bytes, b"0123");
        assert!(capture.truncated);
    }

    #[tokio::test]
    async fn dropping_guard_notifies_fake_supervisor() {
        let (guard, cancellation) = CancellationGuard::new();
        let fake_supervisor = async move { cancellation.await.is_ok() };

        drop(guard);

        assert!(fake_supervisor.await);
    }

    #[tokio::test]
    async fn drain_deadline_aborts_fake_reader_tasks() {
        let mut stdout_task =
            tokio::spawn(async { std::future::pending::<io::Result<BoundedCapture>>().await });
        let mut stderr_task =
            tokio::spawn(async { std::future::pending::<io::Result<BoundedCapture>>().await });

        let result =
            finish_capture_tasks_with_timeout(&mut stdout_task, &mut stderr_task, Duration::ZERO)
                .await;

        assert!(result.is_err());
        assert!(stdout_task.is_finished());
        assert!(stderr_task.is_finished());
    }

    #[test]
    fn operation_deadlines_are_conservative_by_command_risk() {
        assert_eq!(
            operation_timeout(&["version", "-json"]),
            FAST_OPERATION_TIMEOUT
        );
        assert_eq!(operation_timeout(&["plan"]), NETWORK_OPERATION_TIMEOUT);
        assert_eq!(operation_timeout(&["apply"]), MUTATING_OPERATION_TIMEOUT);
        assert_eq!(
            operation_timeout(&["-chdir=ignored", "workspace", "show"]),
            FAST_OPERATION_TIMEOUT
        );
    }

    #[test]
    fn diagnostics_redact_credentials_variables_urls_and_paths() {
        let diagnostic = concat!(
            "token=secret-token-value TF_VAR_password=hunter2 ",
            "-var=db_password=plaintext https://user:pass@example.test/path?token=x ",
            "C:\\Users\\person\\main.tf /home/person/project/main.tf"
        );
        let redacted = redact_diagnostic(diagnostic, &["secret-token-value".to_owned()]);

        assert!(!redacted.contains("secret-token-value"));
        assert!(!redacted.contains("hunter2"));
        assert!(!redacted.contains("plaintext"));
        assert!(!redacted.contains("user:pass"));
        assert!(!redacted.contains("person"));
        assert!(redacted.contains("<redacted>"));
        assert!(redacted.contains("<redacted-url>"));
        assert!(redacted.contains("<redacted-path>"));
    }
}
