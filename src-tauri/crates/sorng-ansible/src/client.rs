// ── sorng-ansible/src/client.rs ──────────────────────────────────────────────
//! Ansible CLI wrapper — binary detection, version parsing, and process execution.
//!
//! This is the foundation layer: every other module ultimately delegates to
//! `AnsibleClient::run_command` to invoke an ansible CLI tool and capture its
//! output.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use regex::Regex;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::task::JoinHandle;

use crate::error::{AnsibleError, AnsibleResult};
use crate::types::{AnsibleConnectionConfig, AnsibleInfo};

const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const TRUNCATED_MARKER: &str = "\n[output truncated after 1048576 bytes]";
const PROTECTED_OUTPUT_MARKER: &str = "[Ansible output withheld because protected input was used]";
const FAILED_OUTPUT_MARKER: &str = "Ansible command failed; diagnostic output was withheld";
const MAX_COMMAND_TIMEOUT_SECS: u64 = 3600;
const REAP_TIMEOUT: Duration = Duration::from_secs(5);
const COLLECTOR_JOIN_TIMEOUT: Duration = Duration::from_secs(5);

static SECRET_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

struct ProtectedFile {
    path: PathBuf,
}

impl Drop for ProtectedFile {
    fn drop(&mut self) {
        if let Ok(file) = OpenOptions::new().write(true).open(&self.path) {
            let _ = file.set_len(0);
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

struct PreparedArguments {
    values: Vec<String>,
    protected_input: bool,
    redactions: Vec<String>,
    _files: Vec<ProtectedFile>,
}

struct BoundedBytes {
    bytes: Vec<u8>,
    truncated: bool,
}

#[cfg(unix)]
unsafe extern "C" {
    fn kill(pid: i32, signal: i32) -> i32;
}

#[cfg(unix)]
struct ProcessTree {
    group_id: i32,
}

#[cfg(unix)]
impl ProcessTree {
    fn configure(command: &mut Command) {
        command.process_group(0);
    }

    fn attach(process_id: u32) -> std::io::Result<Self> {
        let group_id = i32::try_from(process_id)
            .map_err(|_| std::io::Error::other("process identifier is out of range"))?;
        Ok(Self { group_id })
    }

    fn terminate(&self) {
        const SIGKILL: i32 = 9;
        unsafe {
            let _ = kill(-self.group_id, SIGKILL);
        }
    }
}

#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(windows)]
type Handle = *mut std::ffi::c_void;

#[cfg(windows)]
#[repr(C)]
#[derive(Default)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *mut std::ffi::c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(
        job: Handle,
        information_class: u32,
        information: *mut std::ffi::c_void,
        information_length: u32,
    ) -> i32;
    fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> Handle;
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
    fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
    fn CloseHandle(object: Handle) -> i32;
}

#[cfg(windows)]
struct ProcessTree {
    job: isize,
}

#[cfg(windows)]
impl ProcessTree {
    fn configure(_command: &mut Command) {}

    fn attach(process_id: u32) -> std::io::Result<Self> {
        const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
        const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
        const PROCESS_TERMINATE: u32 = 0x0000_0001;
        const PROCESS_SET_QUOTA: u32 = 0x0000_0100;

        let job = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }

        let mut limits = JobObjectExtendedLimitInformation::default();
        limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                (&mut limits as *mut JobObjectExtendedLimitInformation).cast(),
                std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
            )
        };
        if configured == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(job);
            }
            return Err(error);
        }

        let process = unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, 0, process_id) };
        if process.is_null() {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(job);
            }
            return Err(error);
        }
        let assigned = unsafe { AssignProcessToJobObject(job, process) };
        unsafe {
            CloseHandle(process);
        }
        if assigned == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(job);
            }
            return Err(error);
        }

        Ok(Self { job: job as isize })
    }

    fn terminate(&self) {
        unsafe {
            let _ = TerminateJobObject(self.job as Handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
        unsafe {
            CloseHandle(self.job as Handle);
        }
    }
}

#[cfg(not(any(unix, windows)))]
struct ProcessTree;

#[cfg(not(any(unix, windows)))]
impl ProcessTree {
    fn configure(_command: &mut Command) {}

    fn attach(_process_id: u32) -> std::io::Result<Self> {
        Ok(Self)
    }

    fn terminate(&self) {}
}

/// Low-level wrapper around Ansible CLI binaries.
#[derive(Debug, Clone)]
pub struct AnsibleClient {
    /// Resolved path to `ansible`.
    pub ansible_bin: String,
    /// Resolved path to `ansible-playbook`.
    pub playbook_bin: String,
    /// Resolved path to `ansible-vault`.
    pub vault_bin: String,
    /// Resolved path to `ansible-galaxy`.
    pub galaxy_bin: String,
    /// Resolved path to `ansible-config`.
    pub config_bin: String,
    /// Resolved path to `ansible-inventory`.
    pub inventory_bin: String,
    /// Resolved path to `ansible-doc`.
    pub doc_bin: String,
    /// Working directory.
    pub working_dir: Option<String>,
    /// Extra environment variables.
    pub env_vars: HashMap<String, String>,
    /// Default verbosity (0–4).
    pub verbosity: u8,
    /// Default inventory source.
    pub default_inventory: Option<String>,
    /// Vault password file.
    pub vault_password_file: Option<String>,
    /// Default remote user.
    pub remote_user: Option<String>,
    /// Default private-key path.
    pub private_key: Option<String>,
    /// SSH common args.
    pub ssh_common_args: Option<String>,
    /// Maximum wall-clock time for a CLI process.
    pub command_timeout_secs: u64,
}

/// Result of running any CLI command.
#[derive(Debug, Clone)]
pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl AnsibleClient {
    // ── Construction ─────────────────────────────────────────────────

    /// Build a client from the connection config.
    pub async fn from_config(config: &AnsibleConnectionConfig) -> AnsibleResult<Self> {
        Self::validate_configured_environment(&config.env_vars)?;
        if config.verbosity > 4 {
            return Err(AnsibleError::validation(
                "Verbosity must be between 0 and 4",
            ));
        }
        if config.ask_vault_pass {
            return Err(AnsibleError::validation(
                "Interactive vault password prompts are unsupported in the headless backend",
            ));
        }
        if let Some(directory) = config.working_directory.as_deref() {
            let path = std::path::Path::new(directory);
            if !path.is_dir() {
                return Err(AnsibleError::validation(format!(
                    "Working directory does not exist or is not a directory: {directory}"
                )));
            }
        }
        for (label, path) in [
            ("Ansible config", config.config_path.as_deref()),
            ("private key", config.private_key_path.as_deref()),
            ("vault password file", config.vault_password_file.as_deref()),
        ] {
            if let Some(path) = path {
                if !std::path::Path::new(path).is_file() {
                    return Err(AnsibleError::validation(format!(
                        "{label} does not exist or is not a file: {path}"
                    )));
                }
            }
        }

        let ansible_bin = Self::resolve_bin(config.ansible_bin_path.as_deref(), "ansible").await?;

        let playbook_bin = Self::resolve_bin(
            config.ansible_playbook_bin_path.as_deref(),
            "ansible-playbook",
        )
        .await?;

        let vault_bin =
            Self::resolve_bin(config.ansible_vault_bin_path.as_deref(), "ansible-vault").await?;

        let galaxy_bin =
            Self::resolve_bin(config.ansible_galaxy_bin_path.as_deref(), "ansible-galaxy").await?;

        let config_bin = Self::resolve_bin(None, "ansible-config").await?;
        let inventory_bin = Self::resolve_bin(None, "ansible-inventory").await?;
        let doc_bin = Self::resolve_bin(None, "ansible-doc").await?;

        let mut env_vars = config.env_vars.clone();
        if let Some(config_path) = config.config_path.as_deref() {
            env_vars.insert("ANSIBLE_CONFIG".to_string(), config_path.to_string());
        }

        Ok(Self {
            ansible_bin,
            playbook_bin,
            vault_bin,
            galaxy_bin,
            config_bin,
            inventory_bin,
            doc_bin,
            working_dir: config.working_directory.clone(),
            env_vars,
            verbosity: config.verbosity,
            default_inventory: config.default_inventory.clone(),
            vault_password_file: config.vault_password_file.clone(),
            remote_user: config.remote_user.clone(),
            private_key: config.private_key_path.clone(),
            ssh_common_args: config.ssh_common_args.clone(),
            command_timeout_secs: Self::clamp_command_timeout(config.command_timeout_secs),
        })
    }

    /// Return a short-lived client lease with validated per-operation environment.
    pub fn with_environment(&self, env_vars: &HashMap<String, String>) -> AnsibleResult<Self> {
        Self::validate_configured_environment(env_vars)?;
        let mut client = self.clone();
        client.env_vars.extend(env_vars.clone());
        Ok(client)
    }

    fn clamp_command_timeout(timeout_secs: u64) -> u64 {
        timeout_secs.clamp(1, MAX_COMMAND_TIMEOUT_SECS)
    }

    /// Try to resolve a binary path — either explicit or via `which`.
    async fn resolve_bin(explicit: Option<&str>, name: &str) -> AnsibleResult<String> {
        if let Some(path) = explicit {
            return Self::trusted_executable(Path::new(path))
                .map(|path| path.to_string_lossy().into_owned())
                .ok_or_else(|| {
                    AnsibleError::not_installed("Configured Ansible executable is unavailable")
                });
        }

        let path = std::env::var_os("PATH").unwrap_or_default();
        for directory in std::env::split_paths(&path).filter(|path| path.is_absolute()) {
            for candidate in Self::executable_candidates(&directory, name) {
                if let Some(path) = Self::trusted_executable(&candidate) {
                    return Ok(path.to_string_lossy().into_owned());
                }
            }
        }

        Err(AnsibleError::not_installed(format!(
            "Required Ansible executable '{name}' is unavailable"
        )))
    }

    fn executable_candidates(directory: &Path, name: &str) -> Vec<PathBuf> {
        let requested = Path::new(name);
        if requested.extension().is_some() {
            return vec![directory.join(requested)];
        }

        #[cfg(windows)]
        {
            let extensions =
                std::env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE"));
            extensions
                .to_string_lossy()
                .split(';')
                .filter(|extension| {
                    extension.eq_ignore_ascii_case(".com") || extension.eq_ignore_ascii_case(".exe")
                })
                .map(|extension| directory.join(format!("{name}{extension}")))
                .collect()
        }

        #[cfg(not(windows))]
        {
            vec![directory.join(requested)]
        }
    }

    fn trusted_executable(path: &Path) -> Option<PathBuf> {
        let canonical = path.canonicalize().ok()?;
        let metadata = canonical.metadata().ok()?;
        if !metadata.is_file() {
            return None;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return None;
            }
        }

        #[cfg(windows)]
        {
            let extension = canonical.extension()?.to_string_lossy();
            if !extension.eq_ignore_ascii_case("exe") && !extension.eq_ignore_ascii_case("com") {
                return None;
            }
        }

        Some(canonical)
    }

    // ── Info ─────────────────────────────────────────────────────────

    /// Detect Ansible version and environment info.
    pub async fn detect_info(&self) -> AnsibleResult<AnsibleInfo> {
        let output = self.run_raw(&self.ansible_bin, &["--version"]).await?;
        if output.exit_code != 0 {
            return Err(AnsibleError::process(format!(
                "Ansible version probe failed with exit code {}",
                output.exit_code
            )));
        }

        let version = Self::parse_version(&output.stdout)?;
        let python_version = Self::parse_python_version(&output.stdout);
        let config_file = Self::parse_config_file(&output.stdout);
        let module_path = Self::parse_module_path(&output.stdout);

        Ok(AnsibleInfo {
            version,
            python_version,
            config_file,
            default_module_path: module_path,
            executable: self.ansible_bin.clone(),
            available_modules: Vec::new(),
            available_plugins: Vec::new(),
        })
    }

    /// Check that the ansible binary is reachable.
    pub async fn is_available(&self) -> bool {
        self.run_raw(&self.ansible_bin, &["--version"])
            .await
            .map(|output| output.exit_code == 0)
            .unwrap_or(false)
    }

    // ── Command execution ────────────────────────────────────────────

    /// Run an arbitrary ansible-related binary with args.
    pub async fn run_raw(&self, bin: &str, args: &[&str]) -> AnsibleResult<CliOutput> {
        Self::validate_configured_environment(&self.env_vars)?;
        let executable = if Path::new(bin).components().count() > 1 {
            Self::trusted_executable(Path::new(bin))
        } else {
            let mut resolved = None;
            let path = std::env::var_os("PATH").unwrap_or_default();
            for directory in std::env::split_paths(&path).filter(|path| path.is_absolute()) {
                for candidate in Self::executable_candidates(&directory, bin) {
                    if let Some(path) = Self::trusted_executable(&candidate) {
                        resolved = Some(path);
                        break;
                    }
                }
                if resolved.is_some() {
                    break;
                }
            }
            resolved
        }
        .ok_or_else(|| AnsibleError::process("Ansible executable is unavailable or untrusted"))?;

        Self::validate_vault_invocation(&executable, &self.vault_bin, args)?;
        let prepared = Self::prepare_arguments(args)?;

        let mut cmd = Command::new(executable);
        cmd.args(&prepared.values)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        ProcessTree::configure(&mut cmd);

        if let Some(ref dir) = self.working_dir {
            cmd.current_dir(dir);
        }

        cmd.env_clear();
        for (key, value) in Self::inherited_environment() {
            cmd.env(key, value);
        }
        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }
        if let Some(ssh_args) = self.ssh_common_args.as_deref() {
            cmd.env("ANSIBLE_SSH_COMMON_ARGS", ssh_args);
        }

        let mut child = cmd
            .spawn()
            .map_err(|_| AnsibleError::process("Unable to start Ansible process"))?;
        let process_id = child
            .id()
            .ok_or_else(|| AnsibleError::process("Unable to identify Ansible process"))?;
        let process_tree = match ProcessTree::attach(process_id) {
            Ok(process_tree) => process_tree,
            Err(_) => {
                let _ = child.start_kill();
                let _ = tokio::time::timeout(REAP_TIMEOUT, child.wait()).await;
                return Err(AnsibleError::process(
                    "Unable to isolate the Ansible process tree",
                ));
            }
        };

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AnsibleError::process("Unable to capture Ansible process output"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AnsibleError::process("Unable to capture Ansible process output"))?;
        let stdout_task = tokio::spawn(Self::read_bounded(stdout));
        let stderr_task = tokio::spawn(Self::read_bounded(stderr));

        let deadline = tokio::time::sleep(Duration::from_secs(self.command_timeout_secs));
        tokio::pin!(deadline);
        let status = tokio::select! {
            status = child.wait() => Some(
                status.map_err(|_| AnsibleError::process("Ansible process wait failed"))?
            ),
            _ = &mut deadline => None,
        };

        let timed_out = status.is_none();
        let status = if let Some(status) = status {
            status
        } else {
            process_tree.terminate();
            let _ = child.start_kill();
            let reaped = tokio::time::timeout(REAP_TIMEOUT, child.wait()).await;
            if !matches!(reaped, Ok(Ok(_))) {
                stdout_task.abort();
                stderr_task.abort();
                return Err(AnsibleError::timeout(
                    "Ansible process timed out and could not be reaped",
                ));
            }
            reaped
                .expect("checked bounded child reap")
                .expect("checked successful child reap")
        };

        process_tree.terminate();
        drop(process_tree);

        let (stdout, stderr) = tokio::join!(
            Self::join_collector(stdout_task),
            Self::join_collector(stderr_task)
        );

        if timed_out {
            return Err(AnsibleError::timeout(format!(
                "Ansible process exceeded the {} second command timeout",
                self.command_timeout_secs
            )));
        }

        let stdout = stdout?;
        let stderr = stderr?;

        let exit_code = status.code().unwrap_or(-1);
        if exit_code != 0 {
            return Ok(CliOutput {
                stdout: String::new(),
                stderr: FAILED_OUTPUT_MARKER.to_string(),
                exit_code,
            });
        }

        if prepared.protected_input {
            return Ok(CliOutput {
                stdout: PROTECTED_OUTPUT_MARKER.to_string(),
                stderr: String::new(),
                exit_code,
            });
        }

        let mut redactions = self.sensitive_environment_values();
        redactions.extend(prepared.redactions);
        let stdout = Self::render_output(stdout, &redactions);
        let stderr = Self::render_output(stderr, &redactions);

        Ok(CliOutput {
            stdout,
            stderr,
            exit_code,
        })
    }

    async fn join_collector(
        mut task: JoinHandle<std::io::Result<BoundedBytes>>,
    ) -> AnsibleResult<BoundedBytes> {
        match tokio::time::timeout(COLLECTOR_JOIN_TIMEOUT, &mut task).await {
            Ok(Ok(Ok(output))) => Ok(output),
            Ok(Ok(Err(_))) => Err(AnsibleError::process("Ansible output collection failed")),
            Ok(Err(_)) => Err(AnsibleError::process("Ansible output collector failed")),
            Err(_) => {
                task.abort();
                let _ = task.await;
                Err(AnsibleError::process(
                    "Ansible output collector exceeded its shutdown timeout",
                ))
            }
        }
    }

    async fn read_bounded<R>(mut reader: R) -> std::io::Result<BoundedBytes>
    where
        R: AsyncRead + Unpin,
    {
        let mut bytes = Vec::with_capacity(MAX_CAPTURE_BYTES.min(16 * 1024));
        let mut buffer = [0_u8; 8192];
        let mut truncated = false;
        loop {
            let read = reader.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            let remaining = MAX_CAPTURE_BYTES.saturating_sub(bytes.len());
            let retained = remaining.min(read);
            bytes.extend_from_slice(&buffer[..retained]);
            truncated |= retained < read;
        }
        Ok(BoundedBytes { bytes, truncated })
    }

    fn render_output(output: BoundedBytes, redactions: &[String]) -> String {
        let mut rendered = String::from_utf8_lossy(&output.bytes).into_owned();
        let mut ordered = redactions
            .iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        ordered.sort_unstable_by_key(|value| std::cmp::Reverse(value.len()));
        for value in ordered {
            rendered = rendered.replace(value, "[REDACTED]");
        }
        if output.truncated {
            rendered.push_str(TRUNCATED_MARKER);
        }
        rendered
    }

    fn sensitive_environment_values(&self) -> Vec<String> {
        let mut values = self.env_vars.values().cloned().collect::<Vec<_>>();
        for value in [
            self.ssh_common_args.as_ref(),
            self.vault_password_file.as_ref(),
            self.private_key.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            values.push(value.clone());
        }
        values
    }

    fn inherited_environment() -> Vec<(OsString, OsString)> {
        std::env::vars_os()
            .filter(|(key, _)| Self::is_inherited_environment_allowed(key))
            .collect()
    }

    fn is_inherited_environment_allowed(key: &OsStr) -> bool {
        let key = key.to_string_lossy().to_ascii_uppercase();
        matches!(
            key.as_str(),
            "PATH"
                | "PATHEXT"
                | "HOME"
                | "USERPROFILE"
                | "SYSTEMROOT"
                | "WINDIR"
                | "COMSPEC"
                | "TMPDIR"
                | "TMP"
                | "TEMP"
                | "LANG"
                | "LC_ALL"
                | "LC_CTYPE"
        )
    }

    fn validate_configured_environment(env_vars: &HashMap<String, String>) -> AnsibleResult<()> {
        for (key, value) in env_vars {
            let mut characters = key.chars();
            let valid_name = characters
                .next()
                .is_some_and(|character| character == '_' || character.is_ascii_alphabetic())
                && characters
                    .all(|character| character == '_' || character.is_ascii_alphanumeric());
            let uppercase = key.to_ascii_uppercase();
            let process_injection = matches!(
                uppercase.as_str(),
                "PATH"
                    | "PATHEXT"
                    | "COMSPEC"
                    | "BASH_ENV"
                    | "ENV"
                    | "SHELLOPTS"
                    | "IFS"
                    | "CDPATH"
                    | "GCONV_PATH"
                    | "NODE_OPTIONS"
                    | "PERL5OPT"
                    | "PERL5LIB"
                    | "RUBYOPT"
                    | "RUBYLIB"
            ) || uppercase.starts_with("LD_")
                || uppercase.starts_with("DYLD_")
                || uppercase.starts_with("PYTHON");
            if !valid_name || value.contains('\0') || process_injection {
                return Err(AnsibleError::validation(
                    "Configured Ansible environment contains an unsafe entry",
                ));
            }
        }
        Ok(())
    }

    fn prepare_arguments(args: &[&str]) -> AnsibleResult<PreparedArguments> {
        let mut values = Vec::with_capacity(args.len());
        let mut files = Vec::new();
        let mut protected_input = false;
        let mut redactions = Vec::new();
        let mut index = 0;

        while index < args.len() {
            let argument = args[index];
            if matches!(argument, "-a" | "--args" | "--module-args")
                || argument.starts_with("-a=")
                || (argument.starts_with("-a") && !argument.starts_with("--") && argument.len() > 2)
                || argument.starts_with("--args=")
                || argument.starts_with("--module-args=")
            {
                return Err(AnsibleError::validation(
                    "Inline Ansible module arguments are disabled because the CLI has no protected transport for them",
                ));
            }

            if argument.starts_with("-e")
                && !argument.starts_with("--")
                && !argument.starts_with("-e=")
                && argument.len() > 2
            {
                return Err(AnsibleError::validation(
                    "Attached Ansible extra-vars are disabled; use a separated extra-vars value so it can be protected",
                ));
            }

            if matches!(
                argument,
                "-k" | "-K" | "--ask-pass" | "--ask-become-pass" | "--ask-vault-pass"
            ) {
                return Err(AnsibleError::validation(
                    "Interactive Ansible secret prompts are unsupported",
                ));
            }

            if Self::is_raw_secret_option(argument) {
                return Err(AnsibleError::validation(
                    "Secret values may not be supplied as command-line arguments",
                ));
            }

            if argument == "--vault-id" {
                let value = *args.get(index + 1).ok_or_else(|| {
                    AnsibleError::validation("Ansible vault-id option requires a value")
                })?;
                if Self::vault_id_uses_prompt(value) {
                    return Err(AnsibleError::validation(
                        "Interactive Ansible vault-id prompts are unsupported",
                    ));
                }
                values.push(argument.to_string());
                values.push(value.to_string());
                redactions.push(value.to_string());
                index += 2;
                continue;
            }

            if let Some(value) = argument.strip_prefix("--vault-id=") {
                if Self::vault_id_uses_prompt(value) {
                    return Err(AnsibleError::validation(
                        "Interactive Ansible vault-id prompts are unsupported",
                    ));
                }
                redactions.push(value.to_string());
            }

            if matches!(
                argument,
                "--private-key" | "--vault-password-file" | "--ssh-common-args"
            ) {
                let value = *args.get(index + 1).ok_or_else(|| {
                    AnsibleError::validation("Sensitive Ansible option requires a value")
                })?;
                values.push(argument.to_string());
                values.push(value.to_string());
                redactions.push(value.to_string());
                index += 2;
                continue;
            }

            if let Some(value) = [
                "--private-key=",
                "--vault-password-file=",
                "--ssh-common-args=",
            ]
            .into_iter()
            .find_map(|prefix| argument.strip_prefix(prefix))
            {
                redactions.push(value.to_string());
            }

            let extra_vars = if matches!(argument, "-e" | "--extra-vars") {
                index += 1;
                Some(*args.get(index).ok_or_else(|| {
                    AnsibleError::validation("Ansible extra-vars option requires a value")
                })?)
            } else if let Some(value) = argument.strip_prefix("--extra-vars=") {
                Some(value)
            } else {
                argument.strip_prefix("-e=")
            };

            if let Some(extra_vars) = extra_vars {
                protected_input = true;
                redactions.push(extra_vars.to_string());
                values.push("--extra-vars".to_string());
                if extra_vars.starts_with('@') {
                    values.push(extra_vars.to_string());
                } else {
                    let protected = Self::write_protected_file(extra_vars.as_bytes())?;
                    values.push(format!("@{}", protected.path.to_string_lossy()));
                    files.push(protected);
                }
            } else {
                values.push(argument.to_string());
            }
            index += 1;
        }

        Ok(PreparedArguments {
            values,
            protected_input,
            redactions,
            _files: files,
        })
    }

    fn validate_vault_invocation(
        executable: &Path,
        configured_vault: &str,
        args: &[&str],
    ) -> AnsibleResult<()> {
        let configured_vault = Path::new(configured_vault).canonicalize().ok();
        let executable_name = executable
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default();
        let is_vault = configured_vault.as_deref() == Some(executable)
            || executable_name.eq_ignore_ascii_case("ansible-vault")
            || executable_name.eq_ignore_ascii_case("ansible-vault.exe");

        if is_vault && args.contains(&"encrypt_string") {
            return Err(AnsibleError::validation(
                "Ansible vault encrypt_string is disabled because this runner has no protected stdin transport",
            ));
        }
        Ok(())
    }

    fn vault_id_uses_prompt(value: &str) -> bool {
        let source = value
            .rsplit_once('@')
            .map(|(_, source)| source)
            .unwrap_or(value)
            .trim();
        source.eq_ignore_ascii_case("prompt")
            || source.eq_ignore_ascii_case("prompt_ask_vault_pass")
    }

    fn is_raw_secret_option(argument: &str) -> bool {
        const OPTIONS: &[&str] = &[
            "--api-key",
            "--become-password",
            "--password",
            "--secret",
            "--token",
            "--vault-password",
        ];
        OPTIONS.iter().any(|option| {
            argument == *option
                || argument
                    .strip_prefix(option)
                    .is_some_and(|suffix| suffix.starts_with('='))
        })
    }

    fn write_protected_file(contents: &[u8]) -> AnsibleResult<ProtectedFile> {
        for _ in 0..32 {
            let sequence = SECRET_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
            let name = format!(
                ".sortofremoteng-ansible-{}-{sequence}.vars",
                std::process::id()
            );
            let path = std::env::temp_dir().join(name);
            match Self::create_owner_only_file(&path) {
                Ok(mut file) => {
                    if file.write_all(contents).is_err() || file.flush().is_err() {
                        drop(file);
                        let _ = std::fs::remove_file(&path);
                        return Err(AnsibleError::process(
                            "Unable to stage protected Ansible input",
                        ));
                    }
                    return Ok(ProtectedFile { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(AnsibleError::process(
                        "Unable to create protected Ansible input",
                    ));
                }
            }
        }
        Err(AnsibleError::process(
            "Unable to allocate protected Ansible input",
        ))
    }

    #[cfg(unix)]
    fn create_owner_only_file(path: &Path) -> std::io::Result<File> {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
    }

    #[cfg(windows)]
    fn create_owner_only_file(path: &Path) -> std::io::Result<File> {
        use std::ffi::c_void;
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::io::FromRawHandle;

        #[repr(C)]
        struct SecurityAttributes {
            length: u32,
            descriptor: *mut c_void,
            inherit_handle: i32,
        }

        #[link(name = "advapi32")]
        unsafe extern "system" {
            fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
                string_security_descriptor: *const u16,
                string_sd_revision: u32,
                security_descriptor: *mut *mut c_void,
                security_descriptor_size: *mut u32,
            ) -> i32;
        }

        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn CreateFileW(
                file_name: *const u16,
                desired_access: u32,
                share_mode: u32,
                security_attributes: *mut SecurityAttributes,
                creation_disposition: u32,
                flags_and_attributes: u32,
                template_file: *mut c_void,
            ) -> *mut c_void;
            fn LocalFree(memory: *mut c_void) -> *mut c_void;
        }

        const SDDL_REVISION_1: u32 = 1;
        const GENERIC_WRITE: u32 = 0x4000_0000;
        const FILE_SHARE_READ: u32 = 0x0000_0001;
        const CREATE_NEW: u32 = 1;
        const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x0000_0100;
        const INVALID_HANDLE_VALUE: *mut c_void = -1_isize as *mut c_void;

        let sddl = "D:P(A;;GA;;;OW)"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let mut descriptor = std::ptr::null_mut();
        let converted = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        };
        if converted == 0 {
            return Err(std::io::Error::last_os_error());
        }

        let mut attributes = SecurityAttributes {
            length: std::mem::size_of::<SecurityAttributes>() as u32,
            descriptor,
            inherit_handle: 0,
        };
        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let handle = unsafe {
            CreateFileW(
                wide_path.as_ptr(),
                GENERIC_WRITE,
                FILE_SHARE_READ,
                &mut attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_TEMPORARY,
                std::ptr::null_mut(),
            )
        };
        unsafe {
            LocalFree(descriptor);
        }
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
        }

        Ok(unsafe { File::from_raw_handle(handle) })
    }

    #[cfg(not(any(unix, windows)))]
    fn create_owner_only_file(_path: &Path) -> std::io::Result<File> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "owner-only files are unsupported on this platform",
        ))
    }

    /// Run `ansible` with dynamic args, applying client defaults.
    pub async fn run_ansible(&self, args: &[String]) -> AnsibleResult<CliOutput> {
        let mut full_args: Vec<String> = Vec::new();

        // Inventory
        if let Some(ref inv) = self.default_inventory {
            full_args.push("-i".to_string());
            full_args.push(inv.clone());
        }

        // Verbosity
        if self.verbosity > 0 {
            let v_flag = format!("-{}", "v".repeat(self.verbosity as usize));
            full_args.push(v_flag);
        }

        // Vault
        if let Some(ref vp) = self.vault_password_file {
            full_args.push("--vault-password-file".to_string());
            full_args.push(vp.clone());
        }

        // Remote user
        if let Some(ref user) = self.remote_user {
            full_args.push("--user".to_string());
            full_args.push(user.clone());
        }

        // Private key
        if let Some(ref key) = self.private_key {
            full_args.push("--private-key".to_string());
            full_args.push(key.clone());
        }

        full_args.extend_from_slice(args);

        let str_args: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
        self.run_raw(&self.ansible_bin, &str_args).await
    }

    /// Run `ansible-playbook` with dynamic args, applying client defaults.
    pub async fn run_playbook(&self, args: &[String]) -> AnsibleResult<CliOutput> {
        let mut full_args: Vec<String> = Vec::new();

        if let Some(ref inv) = self.default_inventory {
            full_args.push("-i".to_string());
            full_args.push(inv.clone());
        }
        if self.verbosity > 0 {
            full_args.push(format!("-{}", "v".repeat(self.verbosity as usize)));
        }
        if let Some(ref vp) = self.vault_password_file {
            full_args.push("--vault-password-file".to_string());
            full_args.push(vp.clone());
        }
        if let Some(ref user) = self.remote_user {
            full_args.push("--user".to_string());
            full_args.push(user.clone());
        }
        if let Some(ref key) = self.private_key {
            full_args.push("--private-key".to_string());
            full_args.push(key.clone());
        }
        full_args.extend_from_slice(args);
        let str_args: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
        self.run_raw(&self.playbook_bin, &str_args).await
    }

    // ── Parsing helpers ──────────────────────────────────────────────

    fn parse_version(output: &str) -> AnsibleResult<String> {
        // First line: "ansible [core 2.16.3]" or "ansible 2.9.27"
        let re =
            Regex::new(r"ansible\s+\[?(?:core\s+)?(\d+\.\d+[\.\d]*)").expect("valid regex literal");
        if let Some(caps) = re.captures(output) {
            return Ok(caps[1].to_string());
        }
        // Fallback: first line as-is
        if let Some(line) = output.lines().next() {
            if !line.trim().is_empty() {
                return Ok(line.trim().to_string());
            }
        }
        Err(AnsibleError::parse("Could not parse Ansible version"))
    }

    fn parse_python_version(output: &str) -> String {
        let re = Regex::new(r"python\s+version\s*=\s*(\S+)").expect("valid regex literal");
        re.captures(output)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }

    fn parse_config_file(output: &str) -> Option<String> {
        let re = Regex::new(r"config\s+file\s*=\s*(.+)").expect("valid regex literal");
        re.captures(output).map(|c| c[1].trim().to_string())
    }

    fn parse_module_path(output: &str) -> Option<String> {
        let re = Regex::new(r"configured\s+module\s+search\s+path\s*=\s*(.+)")
            .expect("valid regex literal");
        re.captures(output).map(|c| c[1].trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_client(mode: &str) -> AnsibleClient {
        let executable = std::env::current_exe()
            .expect("test executable")
            .to_string_lossy()
            .into_owned();
        let mut env_vars = HashMap::new();
        env_vars.insert("SORNG_ANSIBLE_FAKE_MODE".to_string(), mode.to_string());
        AnsibleClient {
            ansible_bin: executable.clone(),
            playbook_bin: executable.clone(),
            vault_bin: executable.clone(),
            galaxy_bin: executable.clone(),
            config_bin: executable.clone(),
            inventory_bin: executable.clone(),
            doc_bin: executable,
            working_dir: None,
            env_vars,
            verbosity: 0,
            default_inventory: None,
            vault_password_file: None,
            remote_user: None,
            private_key: None,
            ssh_common_args: None,
            command_timeout_secs: 5,
        }
    }

    fn fake_runner_args() -> [&'static str; 3] {
        [
            "--exact",
            "client::tests::fake_runner_process",
            "--nocapture",
        ]
    }

    #[test]
    fn fake_runner_process() {
        match std::env::var("SORNG_ANSIBLE_FAKE_MODE").as_deref() {
            Ok("large") => {
                let chunk = vec![b'x'; 8192];
                for _ in 0..=((MAX_CAPTURE_BYTES / chunk.len()) + 2) {
                    std::io::stdout().write_all(&chunk).expect("write stdout");
                    std::io::stderr().write_all(&chunk).expect("write stderr");
                }
            }
            Ok("secret") => {
                let secret = std::env::var("ANSIBLE_TEST_SECRET").expect("test secret");
                println!("value={secret}");
            }
            Ok("failure") => {
                eprintln!("sensitive failure detail");
                std::process::exit(23);
            }
            _ => {}
        }
    }

    #[tokio::test]
    async fn concurrently_bounds_both_output_streams() {
        let client = fake_client("large");
        let output = client
            .run_raw(&client.ansible_bin, &fake_runner_args())
            .await
            .expect("fake runner output");
        assert!(output.stdout.len() <= MAX_CAPTURE_BYTES + TRUNCATED_MARKER.len());
        assert!(output.stderr.len() <= MAX_CAPTURE_BYTES + TRUNCATED_MARKER.len());
        assert!(output.stdout.ends_with(TRUNCATED_MARKER));
        assert!(output.stderr.ends_with(TRUNCATED_MARKER));
    }

    #[tokio::test]
    async fn redacts_environment_values_from_success_output() {
        let mut client = fake_client("secret");
        client.env_vars.insert(
            "ANSIBLE_TEST_SECRET".to_string(),
            "deterministic-test-secret".to_string(),
        );
        let output = client
            .run_raw(&client.ansible_bin, &fake_runner_args())
            .await
            .expect("fake runner output");
        assert!(!output.stdout.contains("deterministic-test-secret"));
        assert!(output.stdout.contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn failed_process_output_is_opaque() {
        let client = fake_client("failure");
        let output = client
            .run_raw(&client.ansible_bin, &fake_runner_args())
            .await
            .expect("non-zero exit is represented in output");
        assert_eq!(output.exit_code, 23);
        assert!(output.stdout.is_empty());
        assert_eq!(output.stderr, FAILED_OUTPUT_MARKER);
    }

    #[test]
    fn rejects_module_args_and_raw_secret_options_without_echoing_values() {
        let module_secret = "password=hunter2";
        let module_error = AnsibleClient::prepare_arguments(&["-a", module_secret])
            .err()
            .expect("module args must fail closed")
            .to_string();
        assert!(!module_error.contains(module_secret));

        let token_secret = "--token=deterministic-test-secret";
        let token_error = AnsibleClient::prepare_arguments(&[token_secret])
            .err()
            .expect("raw token must fail closed")
            .to_string();
        assert!(!token_error.contains("deterministic-test-secret"));

        for attached in [
            "-apassword=deterministic-test-secret",
            "-epassword=deterministic-test-secret",
        ] {
            let error = AnsibleClient::prepare_arguments(&[attached])
                .err()
                .expect("attached secret-bearing short option must fail closed")
                .to_string();
            assert!(!error.contains("deterministic-test-secret"));
        }
    }

    #[test]
    fn rejects_interactive_vault_id_sources_without_echoing_them() {
        for arguments in [
            vec!["--vault-id", "production@prompt"],
            vec!["--vault-id=production@prompt"],
            vec!["--vault-id", "prompt_ask_vault_pass"],
        ] {
            let error = AnsibleClient::prepare_arguments(&arguments)
                .err()
                .expect("interactive vault-id source must fail closed")
                .to_string();
            assert!(!error.contains("production"));
            assert!(!error.contains("prompt_ask_vault_pass"));
        }
    }

    #[tokio::test]
    async fn rejects_vault_encrypt_string_before_spawning() {
        let client = fake_client("unused");
        let secret = "deterministic-positional-vault-secret";
        let error = client
            .run_raw(&client.vault_bin, &["encrypt_string", secret])
            .await
            .expect_err("positional vault plaintext must fail closed")
            .to_string();
        assert!(!error.contains(secret));
    }

    #[test]
    fn stages_literal_extra_vars_in_an_owner_only_raii_file() {
        let prepared = AnsibleClient::prepare_arguments(&[
            "--extra-vars",
            "{\"password\":\"deterministic-test-secret\"}",
        ])
        .expect("protected extra vars");
        assert!(prepared.protected_input);
        assert_eq!(prepared.values[0], "--extra-vars");
        assert!(prepared.values[1].starts_with('@'));
        assert!(!prepared.values[1].contains("deterministic-test-secret"));
        let path = PathBuf::from(&prepared.values[1][1..]);
        assert!(path.is_file());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = path.metadata().expect("metadata").permissions().mode();
            assert_eq!(mode & 0o077, 0);
        }

        drop(prepared);
        assert!(!path.exists());
    }

    #[test]
    fn inherited_environment_allowlist_excludes_credentials_and_loader_hooks() {
        assert!(AnsibleClient::is_inherited_environment_allowed(OsStr::new(
            "PATH"
        )));
        assert!(!AnsibleClient::is_inherited_environment_allowed(
            OsStr::new("AWS_SECRET_ACCESS_KEY")
        ));
        assert!(!AnsibleClient::is_inherited_environment_allowed(
            OsStr::new("LD_PRELOAD")
        ));
    }

    #[test]
    fn rejects_process_injection_environment_without_echoing_it() {
        let mut env_vars = HashMap::new();
        env_vars.insert(
            "LD_PRELOAD".to_string(),
            "deterministic-loader-secret".to_string(),
        );
        let error = AnsibleClient::validate_configured_environment(&env_vars)
            .expect_err("loader environment must fail closed")
            .to_string();
        assert!(!error.contains("LD_PRELOAD"));
        assert!(!error.contains("deterministic-loader-secret"));
    }

    #[test]
    fn clamps_process_timeout_to_a_finite_range() {
        assert_eq!(AnsibleClient::clamp_command_timeout(0), 1);
        assert_eq!(
            AnsibleClient::clamp_command_timeout(u64::MAX),
            MAX_COMMAND_TIMEOUT_SECS
        );
    }
}
