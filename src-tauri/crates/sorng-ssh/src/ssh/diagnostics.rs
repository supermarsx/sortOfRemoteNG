use secrecy::{ExposeSecret, SecretString};
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use sorng_core::diagnostics::{self, DiagnosticReport, DiagnosticStep};

#[path = "diagnostics_helpers.rs"]
mod helpers;
pub use helpers::observed_host_key_bits;
use helpers::*;

/// Run a deep SSH diagnostic probe.
///
/// The probe password is taken as a [`secrecy::SecretString`] (not a bare
/// `&str`) so it is zeroized on drop and never logs/`Debug`-prints — matching
/// the production SSH path (`ssh/service.rs`, which wraps every credential in
/// `SecretString`). It is exposed only at the single `userauth_password` call
/// site below.
pub fn run_ssh_diagnostics(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&SecretString>,
    private_key_path: Option<&str>,
    private_key_passphrase: Option<&str>,
    timeout_secs: u64,
) -> DiagnosticReport {
    let run_start = std::time::Instant::now();
    let mut steps = vec![scope_step(timeout_secs)];
    let mut resolved_ip: Option<String> = None;
    let timeout = effective_timeout(timeout_secs);
    let mut sess = match Session::new() {
        Ok(session) => session,
        Err(error) => {
            steps.push(DiagnosticStep {
                name: "Client Algorithms".into(),
                status: "fail".into(),
                duration_ms: 0,
                message: "Could not initialize libssh2".into(),
                detail: Some(error_identity(&error)),
            });
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    };
    steps.push(capabilities_step(&sess));

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

    steps.push(DiagnosticStep {
        name: "Selected Endpoint".into(), status: "info".into(), duration_ms: 0,
        message: format!("Direct TCP target: {socket_addr}"),
        detail: Some("First DNS result selected; no alternate-address retries. Both TCP probes target this address.".into()),
    });

    // Step 2: TCP Connect
    let tcp_stream = match diagnostics::probe_tcp(socket_addr, timeout, true, &mut steps) {
        Some(s) => s,
        None => {
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    };

    // Step 3: SSH Banner / Protocol Version
    let t = std::time::Instant::now();
    let banner_timeout = timeout.min(Duration::from_secs(5));
    match read_identification(
        |buffer, remaining| {
            tcp_stream.set_read_timeout(Some(remaining))?;
            Read::read(&mut &tcp_stream, buffer)
        },
        banner_timeout,
    ) {
        Ok((banner, preamble_lines)) => {
            steps.push(DiagnosticStep {
                name: "SSH Banner".into(),
                status: "pass".into(),
                message: format!("Server version: {banner}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some(format!("Banner-only connection; skipped {preamble_lines} preamble lines (contents omitted). Identification is not proof of server identity.")),
            });
        }
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "SSH Banner".into(),
                status: "warn".into(),
                message: format!("Banner observation incomplete: {}", safe_text(&e.to_string(), 256)),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some(format!("I/O category={:?}; OS code={:?}. Limit: 4096 bytes, 32 preamble lines, 255 bytes per line, {}ms deadline. Continuing with an independent handshake: some servers wait for client identification.", e.kind(), e.raw_os_error(), banner_timeout.as_millis())),
            });
        }
    }
    drop(tcp_stream);

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
                detail: Some(format!("Selected endpoint: {socket_addr}; timeout: {}ms; I/O category={:?}; OS code={:?}", timeout.as_millis(), e.kind(), e.raw_os_error())),
            });
            return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
        }
    };

    if let Err(e) = fresh_tcp
        .set_read_timeout(Some(timeout))
        .and_then(|()| fresh_tcp.set_write_timeout(Some(timeout)))
    {
        steps.push(DiagnosticStep {
            name: "Key Exchange".into(),
            status: "fail".into(),
            message: format!("Could not configure bounded handshake I/O: {e}"),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: None,
        });
        return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
    }
    sess.set_tcp_stream(fresh_tcp);
    sess.set_timeout(timeout.as_millis() as u32);

    let handshake = sess.handshake();
    steps.push(handshake_step(&handshake, t.elapsed()));
    steps.push(negotiated_step(&sess, handshake.is_ok()));
    if handshake.is_err() {
        return diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start);
    }

    // Step 5: Host Key Observation (no trust verification)
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

            let key_bits = observed_host_key_bits(raw_key, key_type);

            let weak_key = matches!(key_type, ssh2::HostKeyType::Dss)
                || (matches!(key_type, ssh2::HostKeyType::Rsa)
                    && key_bits.is_some_and(|bits| bits < 2048));

            steps.push(DiagnosticStep {
                name: "Host Key".into(),
                status: "warn".into(),
                message: format!(
                    "Type: {} ({} bits). Fingerprint: SHA256:{}",
                    key_type_str,
                    key_bits.map(|b| b.to_string()).unwrap_or_else(|| "?".into()),
                    fingerprint_hex
                ),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some(format!("Host key observed only; no Trust Center/known_hosts verification was performed. Verify this fingerprint through a trusted channel. Key parameter bits are not security-strength bits.{}", if weak_key { " This key is considered weak; replace it with a modern server key supported by the client." } else { "" })),
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
    let auth_methods_result = sess
        .auth_methods(username)
        .map(|methods| safe_text(methods, 512));
    if let Err(error) = &auth_methods_result {
        steps.push(DiagnosticStep {
            name: "Auth Methods".into(),
            status: "warn".into(),
            duration_ms: t.elapsed().as_millis() as u64,
            message: "Could not discover server authentication methods".into(),
            detail: Some(error_identity(error)),
        });
    }
    let auth_methods_str = auth_methods_result.as_deref().unwrap_or("");
    let auth_methods: Vec<&str> = auth_methods_str
        .split(',')
        .filter(|s| !s.is_empty())
        .collect();

    if auth_methods.is_empty() && auth_methods_result.is_ok() {
        steps.push(DiagnosticStep {
            name: "Auth Methods".into(),
            status: "info".into(),
            message: "Server did not report specific auth methods (may accept 'none')".into(),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: None,
        });
    } else if !auth_methods.is_empty() {
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

    let mut auth_ok = sess.authenticated();
    let mut auth_detail = if auth_ok {
        "Server accepted 'none' authentication".into()
    } else {
        String::new()
    };

    if let Some(key_path) = private_key_path.filter(|_| !auth_ok) {
        // Check if this is an SK (security-key) type
        let is_sk = std::fs::File::open(key_path)
            .ok()
            .and_then(|file| {
                let mut contents = String::new();
                let read = file.take(65537).read_to_string(&mut contents);
                let contents = SecretString::from(contents);
                (read.is_ok() && contents.expose_secret().len() <= 65536)
                    .then(|| super::fido2::is_sk_private_key(contents.expose_secret()))
            })
            .unwrap_or(false);

        if is_sk {
            // Security key (FIDO2) authentication key detected.
            // User touch on the authenticator may be required.
        }

        match sess.userauth_pubkey_file(username, None, Path::new(key_path), private_key_passphrase)
        {
            Ok(()) => {
                auth_ok = true;
                let sk_note = if is_sk { " (security key)" } else { "" };
                auth_detail = format!("Public key{sk_note} authentication succeeded");
            }
            Err(e) => {
                let sk_hint = if is_sk {
                    " Ensure your FIDO2 authenticator is connected and touch was provided."
                } else {
                    ""
                };
                auth_detail = format!("Public key auth failed: {}.{sk_hint}", error_identity(&e));
            }
        }
    }

    if !auth_ok {
        if let Some(pwd) = password {
            match sess.userauth_password(username, pwd.expose_secret()) {
                Ok(()) => {
                    auth_ok = true;
                    auth_detail = "Password authentication succeeded".into();
                }
                Err(e) => {
                    if auth_detail.is_empty() {
                        auth_detail = format!("Password auth failed: {}", error_identity(&e));
                    } else {
                        auth_detail.push_str(&format!(
                            ". Password auth also failed: {}",
                            error_identity(&e)
                        ));
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
                auth_detail = format!(
                    "Agent auth failed: {}. No password or key provided.",
                    error_identity(&e)
                );
            }
        }
    }

    steps.push(DiagnosticStep {
        name: "Authentication".into(),
        status: if auth_ok { "pass" } else { "fail" }.into(),
        message: if auth_ok {
            "Authentication succeeded for the supplied account".into()
        } else {
            "Authentication failed for the supplied account".into()
        },
        duration_ms: t.elapsed().as_millis() as u64,
        detail: Some(auth_detail),
    });

    if auth_ok {
        let t = std::time::Instant::now();
        let env_info = match sess.channel_session() {
            Ok(mut channel) => {
                if channel
                    .exec("uname -a 2>/dev/null || ver 2>nul || echo unknown")
                    .is_err()
                {
                    String::new()
                } else {
                    // Bound both bytes and wall time even if a peer trickles output forever.
                    let start = std::time::Instant::now();
                    let mut output = Vec::new();
                    while output.len() < 4096 {
                        let Some(remaining) = timeout.checked_sub(start.elapsed()) else {
                            break;
                        };
                        sess.set_timeout(remaining.as_millis().clamp(1, 300_000) as u32);
                        let mut buffer = [0; 512];
                        match channel.read(&mut buffer) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => output.extend_from_slice(&buffer[..n]),
                        }
                    }
                    sess.set_timeout(timeout.as_millis() as u32);
                    safe_text(String::from_utf8_lossy(&output).trim(), 120)
                }
            }
            Err(_) => String::new(),
        };

        if !env_info.is_empty() {
            steps.push(DiagnosticStep {
                name: "Server Environment".into(),
                status: "info".into(),
                message: env_info.chars().take(120).collect::<String>().to_string(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some("Best-effort environment sample only; read capped at 4096 bytes and displayed at 120 characters. Output may be incomplete.".into()),
            });
        }
    }

    diagnostics::finish_report(host, port, "ssh", resolved_ip, steps, run_start)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    #[test]
    fn ssh_diagnostics_loopback_report_retains_capabilities_endpoint_and_failure() {
        // Only our ephemeral loopback listener is contacted; no credentials or agent access.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let start = std::time::Instant::now();
            for attempt in 0..2 {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(
                                start.elapsed() < Duration::from_secs(10),
                                "fixture accept deadline"
                            );
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("fixture accept: {error}"),
                    }
                };
                stream
                    .set_write_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                if attempt == 0 {
                    stream
                        .write_all(b"private preamble omitted\r\nSSH-2.0-banner_fixture\r\n")
                        .unwrap();
                } else {
                    stream.write_all(b"SSH-2.0-handshake_fixture\r\n").unwrap();
                    let mut buffer = [0; 1024];
                    let _ = stream.read(&mut buffer);
                    // Close during KEX. No protocol or authentication success is simulated.
                }
            }
        });
        let report =
            run_ssh_diagnostics("127.0.0.1", endpoint.port(), "unused", None, None, None, 1);
        server.join().unwrap();
        let step = |name: &str| report.steps.iter().find(|step| step.name == name).unwrap();
        assert_eq!(step("Client Algorithms").status, "info");
        assert!(step("Selected Endpoint")
            .message
            .contains(&endpoint.to_string()));
        assert_eq!(step("SSH Banner").status, "pass");
        assert!(step("SSH Banner").message.contains("banner_fixture"));
        assert_eq!(step("Key Exchange").status, "fail");
        assert!(step("Key Exchange")
            .detail
            .as_ref()
            .unwrap()
            .contains("category="));
        assert!(step("Negotiated Algorithms")
            .detail
            .as_ref()
            .unwrap()
            .contains("Partial selections only"));
        assert!(!report
            .steps
            .iter()
            .any(|step| step.name == "Authentication"));
        assert!(!serde_json::to_string(&report)
            .unwrap()
            .contains("private preamble omitted"));
        assert!(!report.summary.contains("All diagnostic probes passed"));
    }
}
