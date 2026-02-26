use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;
use std::io::Read;
use ssh2::Session;

use crate::diagnostics::{self, DiagnosticReport, DiagnosticStep};
use super::types::*;

/// Retrieve the host key information for an active SSH session.
#[tauri::command]
pub async fn get_ssh_host_key_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<SshHostKeyInfo, String> {
    let guard = state.lock().await;
    let ssh_session = guard.sessions.get(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    let (raw_key, host_key_type) = ssh_session.session.host_key()
        .ok_or("No host key available for this session")?;

    // SHA-256 fingerprint
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(raw_key);
    let fingerprint = hex::encode(hasher.finalize());

    let key_type_str = match host_key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    };

    let key_bits: Option<u32> = match host_key_type {
        ssh2::HostKeyType::Rsa => Some((raw_key.len() as u32).saturating_mul(8)),
        ssh2::HostKeyType::Ed25519 => Some(256),
        ssh2::HostKeyType::Ecdsa256 => Some(256),
        ssh2::HostKeyType::Ecdsa384 => Some(384),
        ssh2::HostKeyType::Ecdsa521 => Some(521),
        _ => None,
    };

    let public_key = Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        raw_key,
    ));

    Ok(SshHostKeyInfo {
        fingerprint,
        key_type: Some(key_type_str.to_string()),
        key_bits,
        public_key,
    })
}

/// Run a deep diagnostic probe against an SSH server.
///
/// Steps:
///   1. DNS Resolution (multi-address)
///   2. TCP Connect
///   3. SSH Banner / Protocol Version
///   4. Key Exchange (handshake)
///   5. Host Key Verification
///   6. Authentication Methods Discovery
///   7. Authentication Test
#[tauri::command]
pub async fn diagnose_ssh_connection(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    connect_timeout_secs: Option<u64>,
) -> Result<DiagnosticReport, String> {
    let h = host.clone();
    tokio::task::spawn_blocking(move || {
        run_ssh_diagnostics(
            &h,
            port,
            &username,
            password.as_deref(),
            private_key_path.as_deref(),
            private_key_passphrase.as_deref(),
            connect_timeout_secs.unwrap_or(10),
        )
    })
    .await
    .map_err(|e| format!("SSH diagnostic task panicked: {e}"))
}

fn run_ssh_diagnostics(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key_path: Option<&str>,
    private_key_passphrase: Option<&str>,
    timeout_secs: u64,
) -> DiagnosticReport {
    let run_start = std::time::Instant::now();
    let mut steps: Vec<DiagnosticStep> = Vec::new();
    let mut resolved_ip: Option<String> = None;
    let timeout = Duration::from_secs(timeout_secs);

    // Step 1: DNS Resolution
    let (socket_addr, ip_str, _all_ips) = diagnostics::probe_dns(host, port, &mut steps);
    let socket_addr = match socket_addr {
        Some(a) => {
            resolved_ip = ip_str;
            a
        }
        None => {
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    };

    // Step 2: TCP Connect
    let tcp_stream = match diagnostics::probe_tcp(socket_addr, timeout, true, &mut steps) {
        Some(s) => s,
        None => {
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    };

    // Step 3: SSH Banner / Protocol Version
    let t = std::time::Instant::now();
    let _ = tcp_stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut banner_buf = [0u8; 512];
    let banner = match Read::read(&mut &tcp_stream, &mut banner_buf) {
        Ok(0) => {
            steps.push(DiagnosticStep {
                name: "SSH Banner".into(),
                status: "warn".into(),
                message: "Server closed connection without sending banner".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some("The service on this port may not be SSH".into()),
            });
            None
        }
        Ok(n) => {
            let raw = String::from_utf8_lossy(&banner_buf[..n]).trim().to_string();
            let is_ssh = raw.starts_with("SSH-");
            steps.push(DiagnosticStep {
                name: "SSH Banner".into(),
                status: if is_ssh { "pass" } else { "warn" }.into(),
                message: if is_ssh {
                    format!("Server version: {}", raw.lines().next().unwrap_or(&raw))
                } else {
                    format!("Unexpected banner (not SSH): {}", raw.chars().take(80).collect::<String>())
                },
                duration_ms: t.elapsed().as_millis() as u64,
                detail: if !is_ssh {
                    Some("Expected a banner starting with 'SSH-'. This port may not be running an SSH server.".into())
                } else {
                    let parts: Vec<&str> = raw.split('-').collect();
                    if parts.len() >= 3 {
                        Some(format!(
                            "Protocol: {}, Software: {}",
                            parts.get(1).unwrap_or(&"?"),
                            parts[2..].join("-")
                        ))
                    } else {
                        None
                    }
                },
            });
            if is_ssh { Some(raw) } else { None }
        }
        Err(e) => {
            let status = if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut
            {
                "warn"
            } else {
                "fail"
            };
            steps.push(DiagnosticStep {
                name: "SSH Banner".into(),
                status: status.into(),
                message: format!("Failed to read SSH banner: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some("The server did not send a version string within the timeout".into()),
            });
            None
        }
    };

    if banner.is_none() {
        steps.push(DiagnosticStep {
            name: "Root Cause Analysis".into(),
            status: "warn".into(),
            message: "Could not identify an SSH service on this port".into(),
            duration_ms: 0,
            detail: Some(format!(
                "The service on {host}:{port} did not respond with an SSH banner. \
                 Verify the SSH server is running and the port number is correct."
            )),
        });
        return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
    }

    // Step 4: Key Exchange (Handshake)
    let t = std::time::Instant::now();
    let fresh_tcp = match TcpStream::connect_timeout(&socket_addr, timeout) {
        Ok(s) => {
            let _ = s.set_nodelay(true);
            s
        }
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "Key Exchange".into(),
                status: "fail".into(),
                message: format!("Could not reconnect for handshake: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    };

    let mut sess = match Session::new() {
        Ok(s) => s,
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "Key Exchange".into(),
                status: "fail".into(),
                message: format!("Failed to create SSH session object: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    };
    sess.set_tcp_stream(fresh_tcp);
    sess.set_timeout(timeout_secs as u32 * 1000);

    match sess.handshake() {
        Ok(()) => {
            steps.push(DiagnosticStep {
                name: "Key Exchange".into(),
                status: "pass".into(),
                message: "SSH handshake completed successfully".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some(format!(
                    "Encryption established. Session is ready for authentication."
                )),
            });
        }
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "Key Exchange".into(),
                status: "fail".into(),
                message: format!("SSH handshake failed: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some(
                    "Key exchange, encryption algorithm negotiation, or protocol version mismatch. \
                     Check that the server supports modern key exchange algorithms."
                    .into(),
                ),
            });
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    }

    // Step 5: Host Key Verification
    let t = std::time::Instant::now();
    match sess.host_key() {
        Some((raw_key, key_type)) => {
            let fingerprint_hex = sess
                .host_key_hash(ssh2::HashType::Sha256)
                .map(|h| base64::Engine::encode(&base64::engine::general_purpose::STANDARD, h))
                .unwrap_or_else(|| {
                    use sha2::Digest;
                    let hash = sha2::Sha256::digest(raw_key);
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, hash)
                });

            let key_type_str = match key_type {
                ssh2::HostKeyType::Rsa => "ssh-rsa",
                ssh2::HostKeyType::Dss => "ssh-dss",
                ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
                ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
                ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
                ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
                _ => "unknown",
            };

            let key_bits = match key_type {
                ssh2::HostKeyType::Rsa => Some((raw_key.len() as u32).saturating_mul(8)),
                ssh2::HostKeyType::Ed25519 => Some(256),
                ssh2::HostKeyType::Ecdsa256 => Some(256),
                ssh2::HostKeyType::Ecdsa384 => Some(384),
                ssh2::HostKeyType::Ecdsa521 => Some(521),
                _ => None,
            };

            let weak_key = matches!(key_type, ssh2::HostKeyType::Dss)
                || (matches!(key_type, ssh2::HostKeyType::Rsa) && key_bits.unwrap_or(0) < 2048);

            steps.push(DiagnosticStep {
                name: "Host Key".into(),
                status: if weak_key { "warn" } else { "pass" }.into(),
                message: format!(
                    "Type: {} ({} bits). Fingerprint: SHA256:{}",
                    key_type_str,
                    key_bits.map(|b| b.to_string()).unwrap_or_else(|| "?".into()),
                    fingerprint_hex
                ),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: if weak_key {
                    Some(format!(
                        "WARNING: {} is considered weak. Upgrade to Ed25519 or ECDSA on the server.",
                        key_type_str
                    ))
                } else {
                    None
                },
            });
        }
        None => {
            steps.push(DiagnosticStep {
                name: "Host Key".into(),
                status: "warn".into(),
                message: "Host key not available after handshake".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
        }
    }

    // Step 6: Authentication Methods
    let t = std::time::Instant::now();
    let auth_methods_str = sess
        .auth_methods(username)
        .unwrap_or_else(|_| "");
    let auth_methods: Vec<&str> = auth_methods_str.split(',').filter(|s| !s.is_empty()).collect();

    if auth_methods.is_empty() {
        steps.push(DiagnosticStep {
            name: "Auth Methods".into(),
            status: "info".into(),
            message: "Server did not report specific auth methods (may accept 'none')".into(),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: None,
        });
    } else {
        let has_password = auth_methods.contains(&"password");
        let has_publickey = auth_methods.contains(&"publickey");
        let has_keyboard = auth_methods
            .iter()
            .any(|m| m.contains("keyboard-interactive"));

        let mut notes = Vec::new();
        if !has_password && password.is_some() {
            notes.push(
                "You provided a password but the server does not advertise 'password' auth. \
                 It may still work via keyboard-interactive."
                    .to_string(),
            );
        }
        if !has_publickey && private_key_path.is_some() {
            notes.push(
                "You provided a key but the server does not advertise 'publickey' auth."
                    .to_string(),
            );
        }

        steps.push(DiagnosticStep {
            name: "Auth Methods".into(),
            status: "pass".into(),
            message: format!("Server accepts: {}", auth_methods.join(", ")),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: if notes.is_empty() {
                Some(format!(
                    "password={}, publickey={}, keyboard-interactive={}",
                    has_password, has_publickey, has_keyboard
                ))
            } else {
                Some(notes.join("\n"))
            },
        });
    }

    // Step 7: Authentication Test
    let t = std::time::Instant::now();

    let mut auth_ok = false;
    let mut auth_detail = String::new();

    if let Some(key_path) = private_key_path {
        match sess.userauth_pubkey_file(
            username,
            None,
            Path::new(key_path),
            private_key_passphrase,
        ) {
            Ok(()) => {
                auth_ok = true;
                auth_detail = format!("Public key authentication succeeded (key: {key_path})");
            }
            Err(e) => {
                auth_detail = format!("Public key auth failed: {e}");
            }
        }
    }

    if !auth_ok {
        if let Some(pwd) = password {
            match sess.userauth_password(username, pwd) {
                Ok(()) => {
                    auth_ok = true;
                    auth_detail = "Password authentication succeeded".into();
                }
                Err(e) => {
                    if auth_detail.is_empty() {
                        auth_detail = format!("Password auth failed: {e}");
                    } else {
                        auth_detail.push_str(&format!(". Password auth also failed: {e}"));
                    }
                }
            }
        }
    }

    if !auth_ok && password.is_none() && private_key_path.is_none() {
        match sess.userauth_agent(username) {
            Ok(()) => {
                auth_ok = true;
                auth_detail = "SSH agent authentication succeeded".into();
            }
            Err(e) => {
                auth_detail = format!("Agent auth failed: {e}. No password or key provided.");
            }
        }
    }

    steps.push(DiagnosticStep {
        name: "Authentication".into(),
        status: if auth_ok { "pass" } else { "fail" }.into(),
        message: if auth_ok {
            format!("Authenticated as '{username}'")
        } else {
            format!("Authentication failed for '{username}'")
        },
        duration_ms: t.elapsed().as_millis() as u64,
        detail: Some(auth_detail),
    });

    if auth_ok {
        let t = std::time::Instant::now();
        let env_info = match sess.channel_session() {
            Ok(mut channel) => {
                let _ = channel.exec("uname -a 2>/dev/null || ver 2>nul || echo unknown");
                let mut output = String::new();
                let _ = Read::read_to_string(&mut channel, &mut output);
                let _ = channel.wait_close();
                output.trim().to_string()
            }
            Err(_) => String::new(),
        };

        if !env_info.is_empty() {
            steps.push(DiagnosticStep {
                name: "Server Environment".into(),
                status: "info".into(),
                message: format!(
                    "{}",
                    env_info.chars().take(120).collect::<String>()
                ),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: if env_info.len() > 120 {
                    Some(env_info)
                } else {
                    None
                },
            });
        }
    }

    diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start)
}
