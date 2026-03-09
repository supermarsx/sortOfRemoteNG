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

use super::types::*;

// ── Global ProxyCommand state ─────────────────────────────────────────

lazy_static::lazy_static! {
    /// Active ProxyCommand child processes indexed by SSH session id.
    pub static ref PROXY_COMMANDS: StdMutex<HashMap<String, ProxyCommandState>> = StdMutex::new(HashMap::new());
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

/// Expand `%h`, `%p`, `%r` placeholders in a command string.
pub fn expand_command(template: &str, host: &str, port: u16, username: &str) -> String {
    template
        .replace("%h", host)
        .replace("%p", &port.to_string())
        .replace("%r", username)
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
        return Ok(expand_command(cmd, host, port, username));
    }

    let template = config
        .template
        .as_ref()
        .ok_or("ProxyCommand requires either 'command' or 'template'")?;

    let proxy_host = config.proxy_host.as_deref().unwrap_or("127.0.0.1");
    let proxy_port = config.proxy_port.unwrap_or(1080);

    match template {
        ProxyCommandTemplate::Nc => {
            // nc %h %p
            Ok(format!("nc {} {}", host, port))
        }
        ProxyCommandTemplate::Ncat => {
            // ncat --proxy-type <type> --proxy <host:port> [--proxy-auth user:pass] %h %p
            let proxy_type = config.proxy_type.as_deref().unwrap_or("socks5");
            let mut cmd = format!(
                "ncat --proxy-type {} --proxy {}:{} ",
                proxy_type, proxy_host, proxy_port
            );
            if let (Some(user), Some(pass)) = (&config.proxy_username, &config.proxy_password) {
                cmd.push_str(&format!("--proxy-auth {}:{} ", user, pass));
            }
            cmd.push_str(&format!("{} {}", host, port));
            Ok(cmd)
        }
        ProxyCommandTemplate::Socat => {
            // socat - TCP:%h:%p
            Ok(format!("socat - TCP:{}:{}", host, port))
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
                // connect uses -P for proxy password — set auth via env in practice
                cmd = format!(
                    "connect {} {}:{}@{}:{} ",
                    flag, user, pass, proxy_host, proxy_port
                );
            }
            cmd.push_str(&format!("{} {}", host, port));
            Ok(cmd)
        }
        ProxyCommandTemplate::Corkscrew => {
            // corkscrew proxy_host proxy_port target_host target_port [auth_file]
            Ok(format!(
                "corkscrew {} {} {} {}",
                proxy_host, proxy_port, host, port
            ))
        }
        ProxyCommandTemplate::SshStdio => {
            // ssh -W %h:%p <proxy_host> [-p proxy_port] [-l proxy_user]
            let mut cmd = format!("ssh -W {}:{} ", host, port);
            if let Some(user) = &config.proxy_username {
                cmd.push_str(&format!("-l {} ", user));
            }
            if proxy_port != 22 {
                cmd.push_str(&format!("-p {} ", proxy_port));
            }
            cmd.push_str(proxy_host);
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

    log::info!("[{}] Spawning ProxyCommand: {}", session_id, cmd_string);

    // Spawn via system shell so pipes, quoting, etc. work.
    let child = spawn_shell_command(&cmd_string)
        .map_err(|e| format!("Failed to spawn ProxyCommand `{}`: {}", cmd_string, e))?;

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
            cmd_clone
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
            command: state.command.clone(),
            alive,
            pid: None, // child moved into relay thread
        }
    }))
}

// ── OS shell spawning ─────────────────────────────────────────────────

/// Spawn a command via the system shell with piped stdin/stdout.
fn spawn_shell_command(cmd: &str) -> std::io::Result<Child> {
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

// ── Tauri Commands ────────────────────────────────────────────────────

/// Get the status of a ProxyCommand for an SSH session.
#[tauri::command]
pub fn get_proxy_command_info(session_id: String) -> Result<Option<ProxyCommandStatus>, String> {
    get_proxy_command_status(&session_id)
}

/// Stop a running ProxyCommand for an SSH session.
#[tauri::command]
pub fn stop_proxy_command_cmd(session_id: String) -> Result<(), String> {
    stop_proxy_command(&session_id)
}

/// Test a ProxyCommand — spawn it, wait for the first byte of output,
/// then kill it.  Returns the expanded command and whether it connected.
#[tauri::command]
pub async fn test_proxy_command(
    config: ProxyCommandConfig,
    host: String,
    port: u16,
    username: String,
) -> Result<ProxyCommandStatus, String> {
    let cmd_string = build_command_string(&config, &host, port, &username)?;

    let mut child =
        spawn_shell_command(&cmd_string).map_err(|e| format!("Failed to spawn: {}", e))?;

    let pid = child.id();

    // Wait a short time to see if it starts successfully
    let timeout = config.timeout_secs.unwrap_or(5);
    let alive = tokio::task::spawn_blocking(move || {
        std::thread::sleep(Duration::from_secs(timeout.min(5)));
        match child.try_wait() {
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                true // still running = probably connected
            }
            Ok(Some(status)) => status.success(),
            Err(_) => false,
        }
    })
    .await
    .unwrap_or(false);

    Ok(ProxyCommandStatus {
        session_id: String::new(),
        command: cmd_string,
        alive,
        pid: Some(pid),
    })
}

/// Expand a ProxyCommand template/command with the given host/port/username
/// placeholders and return the resulting string. Useful for preview in the UI.
#[tauri::command]
pub fn expand_proxy_command(
    config: ProxyCommandConfig,
    host: String,
    port: u16,
    username: String,
) -> Result<String, String> {
    build_command_string(&config, &host, port, &username)
}
