//! # ProxyCommand
//!
//! Implements OpenSSH-style ProxyCommand support.  A ProxyCommand spawns an
//! external process whose stdin/stdout are used as the SSH transport instead
//! of a direct TCP connection.
//!
//! Common use cases:
//! - `ssh -W %h:%p jumpbox`   (OpenSSH stdio forward through a jump host)
//! - `nc -X 5 -x proxy:1080 %h %p`  (SOCKS5 via netcat)
//! - `ncat --proxy-type socks5 --proxy proxy:1080 %h %p`
//! - `socat - TCP:%h:%p`
//! - `connect -H proxy:3128 %h %p`  (HTTP CONNECT via connect-proxy)
//! - `corkscrew proxy 3128 %h %p`  (HTTP CONNECT via corkscrew)
//!
//! The module converts the child process's stdio into a `std::net::TcpStream`
//! compatible pipe by using an intermediate TCP socket pair.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use secrecy::ExposeSecret;

use super::types::*;

// ── Import-confirmation gate ──────────────────────────────────────────

/// Stable, machine-detectable error code emitted when an unconfirmed
/// (import/sync-origin) ProxyCommand is about to be executed.
///
/// The whole `spawn_proxy_command` / `connect_ssh` error surface is
/// `Result<_, String>`, so this is returned as a string that BEGINS with this
/// exact prefix. The Wave-2 frontend detects a confirmation-required failure by
/// testing `error.startsWith("PROXY_COMMAND_CONFIRMATION_REQUIRED")` (and may
/// strip the prefix to show the human-readable tail). Keep this literal stable.
pub const PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE: &str =
    "PROXY_COMMAND_CONFIRMATION_REQUIRED";

/// Typed error for the ProxyCommand execution path. The crate's public API is
/// stringly-typed (`Result<_, String>`); this enum exists so the gate and its
/// tests have a single source of truth for the wire string via `Display`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyCommandError {
    /// The ProxyCommand is configured but not yet confirmed by the user. It
    /// arrived from an untrusted origin (import/sync) and must be reviewed and
    /// confirmed once before it is allowed to execute.
    ConfirmationRequired,
}

impl std::fmt::Display for ProxyCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProxyCommandError::ConfirmationRequired => write!(
                f,
                "{}: This SSH connection's ProxyCommand has not been confirmed. \
                 It may have been added via import or sync. Review the command \
                 and confirm it once before connecting.",
                PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE
            ),
        }
    }
}

/// Compute a stable identity for an expanded ProxyCommand string. The backend
/// confirmation registry is keyed by this so that confirming one specific
/// command does not implicitly trust a *different* (e.g. edited or re-imported)
/// command — any change re-arms the gate.
fn command_fingerprint(expanded_cmd: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(expanded_cmd.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ── Global ProxyCommand state ─────────────────────────────────────────

lazy_static::lazy_static! {
    /// Active ProxyCommand child processes indexed by SSH session id.
    pub static ref PROXY_COMMANDS: StdMutex<HashMap<String, ProxyCommandState>> = StdMutex::new(HashMap::new());

    /// Fingerprints of ProxyCommand strings the user has explicitly confirmed
    /// at runtime via [`confirm_proxy_command`]. The gate is intentionally keyed
    /// only by the expanded command fingerprint so imported or persisted boolean
    /// flags cannot bless different command contents.
    static ref CONFIRMED_PROXY_COMMANDS: StdMutex<std::collections::HashSet<String>> =
        StdMutex::new(std::collections::HashSet::new());
}

/// Record that the user has reviewed and confirmed a specific expanded
/// ProxyCommand string. After this, [`spawn_proxy_command`] will execute that
/// exact command.
pub fn mark_proxy_command_confirmed(expanded_cmd: &str) {
    if let Ok(mut set) = CONFIRMED_PROXY_COMMANDS.lock() {
        set.insert(command_fingerprint(expanded_cmd));
    }
}

/// Whether a given expanded ProxyCommand string has been confirmed at runtime.
fn is_proxy_command_confirmed(expanded_cmd: &str) -> bool {
    CONFIRMED_PROXY_COMMANDS
        .lock()
        .map(|set| set.contains(&command_fingerprint(expanded_cmd)))
        .unwrap_or(false)
}

/// Runtime state for an active ProxyCommand process.
#[derive(Debug)]
pub struct ProxyCommandState {
    pub session_id: String,
    /// The expanded command string.
    pub command: String,
    /// The child process handle.
    pub child: Option<Child>,
    /// Cancellation flag.
    pub cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Relay thread handles (stdin/stdout relay).
    pub relay_handles: Vec<std::thread::JoinHandle<()>>,
}

// ── Template expansion ────────────────────────────────────────────────

/// Validates that a string is a safe hostname or IP address (no shell metacharacters).
fn validate_shell_safe(input: &str) -> Result<String, String> {
    // Allow alphanumeric, dots, hyphens, underscores, colons (IPv6), square brackets
    if input
        .chars()
        .all(|c| c.is_alphanumeric() || ".-_:[]".contains(c))
    {
        Ok(input.to_string())
    } else {
        Err(format!(
            "Invalid characters in input: '{}'",
            input.chars().take(20).collect::<String>()
        ))
    }
}

/// Redact credentials from a proxy command string before it is logged or
/// returned to the frontend.
///
/// This masks:
/// - `--proxy-auth user:pass` (ncat) and `-P pass` (connect) flag values
/// - inline `user:pass@host` authorities (connect / ssh URLs)
/// - and then defers to the shared [`crate::redact::redact_secrets`] sweep
///   which additionally catches `-p<password>` flags, `key=secret`/`token`
///   pairs, private-key blocks, and AWS/GCP token shapes.
///
/// Callers must use the redacted value anywhere the expanded command can reach
/// a log sink or a serialised `ProxyCommandStatus`.
///
/// NOTE: must be `pub` (not `pub(crate)`) — `proxy_command_cmds.rs` is
/// `include!`-d into BOTH `sorng-ssh` and the `app` crate (via the
/// `src-tauri/src/ssh_commands.rs` shim, which re-exports this module with
/// `pub use crate::ssh::proxy_command::*`). A `pub(crate)` item would not flow
/// through that glob re-export into the app compile context, breaking the
/// `use super::proxy_command::*;` import there (E0425). Mirrors the other
/// `pub` proxy-command symbols referenced the same way.
pub fn redact_proxy_credentials(cmd: &str) -> String {
    // Redact --proxy-auth user:pass patterns (ncat)
    let result = regex::Regex::new(r"--proxy-auth\s+\S+")
        .expect("valid regex literal")
        .replace_all(cmd, "--proxy-auth [REDACTED]");
    // Redact user:pass@host patterns (connect / inline URL credentials)
    let result = regex::Regex::new(r"\S+:\S+@(\S+)")
        .expect("valid regex literal")
        .replace_all(&result, "[REDACTED]@$1");
    // Defer to the shared crate-wide secret sweep for the remaining shapes
    // (-p<pass> flags, key=secret pairs, key blocks, cloud tokens).
    crate::redact::redact_secrets(&result, &[])
}

/// Expand `%h`, `%p`, `%r` placeholders in a command string.
pub fn expand_command(
    template: &str,
    host: &str,
    port: u16,
    username: &str,
) -> Result<String, String> {
    let safe_host = validate_shell_safe(host)?;
    let safe_user = validate_shell_safe(username)?;
    Ok(template
        .replace("%h", &safe_host)
        .replace("%p", &port.to_string())
        .replace("%r", &safe_user))
}

/// Build the full command string from a `ProxyCommandConfig`.
pub fn build_command_string(
    config: &ProxyCommandConfig,
    host: &str,
    port: u16,
    username: &str,
) -> Result<String, String> {
    if let Some(ref cmd) = config.command {
        // Direct command — just expand placeholders
        return expand_command(cmd, host, port, username);
    }

    let template = config
        .template
        .as_ref()
        .ok_or("ProxyCommand requires either 'command' or 'template'")?;

    let proxy_host = validate_shell_safe(config.proxy_host.as_deref().unwrap_or("127.0.0.1"))?;
    let proxy_port = config.proxy_port.unwrap_or(1080);
    let safe_host = validate_shell_safe(host)?;
    if let Some(ref user) = config.proxy_username {
        validate_shell_safe(user)?;
    }

    match template {
        ProxyCommandTemplate::Nc => {
            // nc %h %p
            Ok(format!("nc {} {}", safe_host, port))
        }
        ProxyCommandTemplate::Ncat => {
            // ncat --proxy-type <type> --proxy <host:port> [--proxy-auth user:pass] %h %p
            let proxy_type = config.proxy_type.as_deref().unwrap_or("socks5");
            let safe_proxy_type = validate_shell_safe(proxy_type)?;
            let mut cmd = format!(
                "ncat --proxy-type {} --proxy {}:{} ",
                safe_proxy_type, proxy_host, proxy_port
            );
            if let (Some(user), Some(pass)) = (&config.proxy_username, &config.proxy_password) {
                let safe_user = validate_shell_safe(user)?;
                let safe_pass = validate_shell_safe(pass.expose_secret())?;
                cmd.push_str(&format!("--proxy-auth {}:{} ", safe_user, safe_pass));
            }
            cmd.push_str(&format!("{} {}", safe_host, port));
            Ok(cmd)
        }
        ProxyCommandTemplate::Socat => {
            // socat - TCP:%h:%p
            Ok(format!("socat - TCP:{}:{}", safe_host, port))
        }
        ProxyCommandTemplate::Connect => {
            // connect -H proxy:port %h %p   (HTTP CONNECT)
            // connect -S proxy:port %h %p   (SOCKS)
            let flag = match config.proxy_type.as_deref() {
                Some("socks4") | Some("socks5") => "-S",
                _ => "-H",
            };
            let mut cmd = format!("connect {} {}:{} ", flag, proxy_host, proxy_port);
            if let (Some(user), Some(pass)) = (&config.proxy_username, &config.proxy_password) {
                let safe_user = validate_shell_safe(user)?;
                let safe_pass = validate_shell_safe(pass.expose_secret())?;
                // connect uses -P for proxy password — set auth via env in practice
                cmd = format!(
                    "connect {} {}:{}@{}:{} ",
                    flag, safe_user, safe_pass, proxy_host, proxy_port
                );
            }
            cmd.push_str(&format!("{} {}", safe_host, port));
            Ok(cmd)
        }
        ProxyCommandTemplate::Corkscrew => {
            // corkscrew proxy_host proxy_port target_host target_port [auth_file]
            Ok(format!(
                "corkscrew {} {} {} {}",
                proxy_host, proxy_port, safe_host, port
            ))
        }
        ProxyCommandTemplate::SshStdio => {
            // ssh -W %h:%p <proxy_host> [-p proxy_port] [-l proxy_user]
            let mut cmd = format!("ssh -W {}:{} ", safe_host, port);
            if let Some(user) = &config.proxy_username {
                let safe_user = validate_shell_safe(user)?;
                cmd.push_str(&format!("-l {} ", safe_user));
            }
            if proxy_port != 22 {
                cmd.push_str(&format!("-p {} ", proxy_port));
            }
            cmd.push_str(&proxy_host);
            Ok(cmd)
        }
    }
}

// ── Core: spawn ProxyCommand and produce a TcpStream ──────────────────

/// Spawn the ProxyCommand child process and return a `TcpStream` whose
/// reads/writes are relayed to the child's stdout/stdin respectively.
///
/// This works by:
/// 1. Spawning the command via the system shell.
/// 2. Binding a local TCP listener on an ephemeral port.
/// 3. Starting two relay threads (child stdout → TCP, TCP → child stdin).
/// 4. Connecting to the local listener and returning that `TcpStream`.
///
/// The caller (service.rs `connect_ssh`) uses the returned stream exactly
/// like a direct TCP connection.
pub fn spawn_proxy_command(
    session_id: &str,
    config: &ProxyCommandConfig,
    host: &str,
    port: u16,
    username: &str,
    connect_timeout: u64,
) -> Result<TcpStream, String> {
    let cmd_string = build_command_string(config, host, port, username)?;

    // ── Import-confirmation gate ──────────────────────────────────────
    // ProxyCommand stays fully free-form, but the exact expanded command must
    // be confirmed once before it is ever spawned. Persisted/imported
    // `command_confirmed` booleans are deliberately ignored here because they
    // are not bound to the expanded command fingerprint.
    if !is_proxy_command_confirmed(&cmd_string) {
        log::warn!(
            "[{}] Refusing unconfirmed ProxyCommand (import/sync origin): {}",
            session_id,
            redact_proxy_credentials(&cmd_string)
        );
        return Err(ProxyCommandError::ConfirmationRequired.to_string());
    }

    // Redact credentials from log output
    let redacted_cmd = redact_proxy_credentials(&cmd_string);
    log::info!("[{}] Spawning ProxyCommand: {}", session_id, redacted_cmd);

    // Spawn via system shell so pipes, quoting, etc. work.
    let child = spawn_shell_command(&cmd_string)
        .map_err(|e| format!("Failed to spawn ProxyCommand: {}", e))?;

    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Bind an ephemeral local listener — the relay threads will bridge
    // between the child's stdio and this socket.
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind ProxyCommand relay listener: {}", e))?;
    let relay_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get relay address: {}", e))?;

    let timeout = Duration::from_secs(if connect_timeout > 0 {
        connect_timeout
    } else {
        15
    });

    // Accept thread: accepts one connection on the relay listener and does
    // the bi-directional relay to the child.
    let mut child_handle = child;
    let cancelled_clone = cancelled.clone();
    let session_id_owned = session_id.to_string();
    let cmd_clone = cmd_string.clone();

    let relay_thread = std::thread::spawn(move || {
        listener.set_nonblocking(false).ok();
        // Accept the first connection (from our own TcpStream::connect below)
        let socket = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) => {
                log::error!(
                    "[{}] ProxyCommand relay accept failed: {}",
                    session_id_owned,
                    e
                );
                return;
            }
        };
        drop(listener);

        let mut child_stdin = match child_handle.stdin.take() {
            Some(s) => s,
            None => {
                log::error!("[{}] ProxyCommand has no stdin", session_id_owned);
                return;
            }
        };
        let mut child_stdout = match child_handle.stdout.take() {
            Some(s) => s,
            None => {
                log::error!("[{}] ProxyCommand has no stdout", session_id_owned);
                return;
            }
        };

        // Clone the socket for the second direction
        let mut socket_read = match socket.try_clone() {
            Ok(s) => s,
            Err(e) => {
                log::error!("[{}] Socket clone failed: {}", session_id_owned, e);
                return;
            }
        };
        let mut socket_write = socket;

        let session_id_a = session_id_owned.clone();
        let cancel_a = cancelled_clone.clone();
        // child stdout → socket write
        let t1 = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];
            loop {
                if cancel_a.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                match child_stdout.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if socket_write.write_all(&buf[..n]).is_err() {
                            break;
                        }
                        let _ = socket_write.flush();
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    Err(_) => break,
                }
            }
            log::debug!("[{}] ProxyCommand stdout→socket relay ended", session_id_a);
        });

        let session_id_b = session_id_owned.clone();
        let cancel_b = cancelled_clone.clone();
        // socket read → child stdin
        let t2 = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];
            socket_read.set_nonblocking(false).ok();
            loop {
                if cancel_b.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                match socket_read.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if child_stdin.write_all(&buf[..n]).is_err() {
                            break;
                        }
                        let _ = child_stdin.flush();
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    Err(_) => break,
                }
            }
            log::debug!("[{}] ProxyCommand socket→stdin relay ended", session_id_b);
        });

        // Wait for relay threads
        let _ = t1.join();
        let _ = t2.join();

        // Clean up child
        let _ = child_handle.kill();
        let _ = child_handle.wait();
        log::info!(
            "[{}] ProxyCommand `{}` terminated",
            session_id_owned,
            redact_proxy_credentials(&cmd_clone)
        );
    });

    // Connect to the relay socket — this is the stream we'll hand to ssh2
    let stream = std::net::TcpStream::connect_timeout(&relay_addr, timeout)
        .map_err(|e| format!("Failed to connect to ProxyCommand relay: {}", e))?;

    stream
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

    // Store state
    if let Ok(mut cmds) = PROXY_COMMANDS.lock() {
        cmds.insert(
            session_id.to_string(),
            ProxyCommandState {
                session_id: session_id.to_string(),
                command: cmd_string.clone(),
                child: None, // child moved into relay thread
                cancelled,
                relay_handles: vec![relay_thread],
            },
        );
    }

    log::info!(
        "[{}] ProxyCommand connected via relay at {}",
        session_id,
        relay_addr
    );

    Ok(stream)
}

/// Stop a ProxyCommand process for a session.
pub fn stop_proxy_command(session_id: &str) -> Result<(), String> {
    if let Ok(mut cmds) = PROXY_COMMANDS.lock() {
        if let Some(state) = cmds.remove(session_id) {
            state
                .cancelled
                .store(true, std::sync::atomic::Ordering::Relaxed);
            if let Some(mut child) = state.child {
                let _ = child.kill();
                let _ = child.wait();
            }
            log::info!("[{}] ProxyCommand stopped", session_id);
        }
    }
    Ok(())
}

/// Get ProxyCommand status for a session.
pub fn get_proxy_command_status(session_id: &str) -> Result<Option<ProxyCommandStatus>, String> {
    let cmds = PROXY_COMMANDS
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(cmds.get(session_id).map(|state| {
        let alive = !state.cancelled.load(std::sync::atomic::Ordering::Relaxed);
        ProxyCommandStatus {
            session_id: session_id.to_string(),
            // Never surface the raw expanded command — it can contain inline
            // `user:pass@host` or proxy-auth credentials.
            command: redact_proxy_credentials(&state.command),
            alive,
            pid: None, // child moved into relay thread
        }
    }))
}

// ── OS shell spawning ─────────────────────────────────────────────────

/// Spawn a command via the system shell with piped stdin/stdout.
pub fn spawn_shell_command(cmd: &str) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", cmd])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    }

    #[cfg(not(windows))]
    {
        Command::new("sh")
            .args(["-c", cmd])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::types::ProxyCommandConfig;

    fn free_form_config(command_confirmed: bool) -> ProxyCommandConfig {
        ProxyCommandConfig {
            command: Some("nc %h %p".to_string()),
            template: None,
            proxy_host: None,
            proxy_port: None,
            proxy_username: None,
            proxy_password: None,
            proxy_type: None,
            timeout_secs: Some(5),
            command_confirmed,
        }
    }

    #[test]
    fn unconfirmed_proxy_command_is_refused_with_confirmation_required() {
        // An imported config defaults command_confirmed=false → must NOT spawn.
        let cfg = free_form_config(false);
        let err = spawn_proxy_command("sess-unconfirmed", &cfg, "host.example.com", 22, "user", 5)
            .expect_err("unconfirmed ProxyCommand must be refused, not spawned");
        assert!(
            err.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE),
            "error must carry the stable detection prefix, got: {err}"
        );
        // It must not have registered/spawned anything.
        assert!(
            get_proxy_command_status("sess-unconfirmed")
                .unwrap()
                .is_none(),
            "refused ProxyCommand must not register a session"
        );
    }

    #[test]
    fn confirmed_flag_does_not_bypass_fingerprint_gate() {
        // command_confirmed may arrive from persisted/imported config, so it
        // must not bypass the fingerprint-scoped runtime confirmation gate.
        let cfg = free_form_config(true);
        let err = spawn_proxy_command("sess-confirmed-flag", &cfg, "host.example.com", 22, "user", 1)
            .expect_err("confirmed flag alone must be refused, not spawned");
        assert!(
            err.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE),
            "confirmed flag alone must still require confirmation, got: {err}"
        );
    }

    #[test]
    fn runtime_confirmation_passes_the_gate() {
        // An imported (unconfirmed) config is allowed once the EXACT expanded
        // command is confirmed at runtime via mark_proxy_command_confirmed.
        let cfg = free_form_config(false);
        let expanded =
            build_command_string(&cfg, "runtime.example.com", 2222, "alice").unwrap();
        mark_proxy_command_confirmed(&expanded);

        let result = spawn_proxy_command(
            "sess-runtime-confirm",
            &cfg,
            "runtime.example.com",
            2222,
            "alice",
            1,
        );
        if let Err(e) = &result {
            assert!(
                !e.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE),
                "runtime-confirmed command must clear the gate, got: {e}"
            );
        }
        let _ = stop_proxy_command("sess-runtime-confirm");
    }

    #[test]
    fn runtime_confirmation_is_fingerprint_scoped() {
        // Confirming one command must not implicitly trust a different one.
        let cfg = free_form_config(false);
        let expanded =
            build_command_string(&cfg, "trusted.example.com", 22, "user").unwrap();
        mark_proxy_command_confirmed(&expanded);

        // A different host → different expansion → still gated.
        let err =
            spawn_proxy_command("sess-other", &cfg, "evil.example.com", 22, "user", 5)
                .expect_err("a different command must remain gated");
        assert!(err.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE));
        let _ = stop_proxy_command("sess-trusted");
    }

    #[test]
    fn confirmation_required_error_string_is_stable() {
        let s = ProxyCommandError::ConfirmationRequired.to_string();
        assert!(s.starts_with(PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE));
    }

    #[test]
    fn no_proxy_command_configured_is_never_built_or_gated() {
        // The connect path only reaches the gate when command OR template is
        // set (service.rs: `proxy_cmd.command.is_some() || template.is_some()`).
        // A config with neither is not a ProxyCommand connection at all — prove
        // it doesn't even produce a command string to gate.
        let mut cfg = free_form_config(false);
        cfg.command = None;
        cfg.template = None;
        assert!(
            build_command_string(&cfg, "host", 22, "user").is_err(),
            "empty ProxyCommand config must not yield an executable command"
        );
    }


    #[test]
    fn redacts_inline_user_pass_at_host() {
        let cmd = "connect -S alice:s3cr3t@proxy.example.com:1080 target.example.com 22";
        let red = redact_proxy_credentials(cmd);
        assert!(!red.contains("s3cr3t"), "password leaked: {red}");
        assert!(!red.contains("alice:s3cr3t"), "user:pass leaked: {red}");
        // The non-secret host/port context is preserved.
        assert!(red.contains("target.example.com"));
        assert!(red.contains("[REDACTED]@"));
    }

    #[test]
    fn redacts_ncat_proxy_auth_flag() {
        let cmd = "ncat --proxy-type socks5 --proxy 10.0.0.1:1080 --proxy-auth bob:hunter2 host 22";
        let red = redact_proxy_credentials(cmd);
        assert!(!red.contains("hunter2"), "proxy-auth secret leaked: {red}");
        assert!(!red.contains("bob:hunter2"), "proxy-auth pair leaked: {red}");
        assert!(red.contains("--proxy-auth [REDACTED]"));
    }

    #[test]
    fn redacts_short_password_flag_via_shared_sweep() {
        // -psecret is caught by the shared crate::redact sweep.
        let cmd = "someproxy -psupersecret host 22";
        let red = redact_proxy_credentials(cmd);
        assert!(!red.contains("supersecret"), "-p secret leaked: {red}");
    }

    #[test]
    fn leaves_credential_free_command_intact() {
        let cmd = "nc target.example.com 22";
        assert_eq!(redact_proxy_credentials(cmd), cmd);
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────
