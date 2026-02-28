use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Instant;

use ironrdp::connector::{self, ClientConnector, State as _};
use ironrdp_blocking::Framed;

use super::network::{BlockingNetworkClient, extract_cert_fingerprint, tls_upgrade};
use super::settings::ResolvedSettings;
use super::RdpServiceState;

use sorng_core::diagnostics::{self, DiagnosticReport, DiagnosticStep};

use super::settings::RdpSettingsPayload;

// Re-export shared types so the frontend API stays unchanged.
pub use sorng_core::diagnostics::{DiagnosticStep as DiagStep, DiagnosticReport as DiagReport};

/// Run a deep diagnostic probe against an RDP server.
/// This performs each connection phase independently and reports
/// detailed results for each step, without actually creating an
/// active session.
#[tauri::command]
pub async fn diagnose_rdp_connection(
    state: tauri::State<'_, RdpServiceState>,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    rdp_settings: Option<RdpSettingsPayload>,
) -> Result<DiagnosticReport, String> {
    let h = host.clone();
    let u = username.clone();
    let p = password.clone();
    let d = domain.clone();

    let payload = rdp_settings.unwrap_or_default();
    let settings = ResolvedSettings::from_payload(&payload, 1024, 768);

    let service = state.lock().await;
    let cached_tls = service.cached_tls_connector.clone();
    let cached_http = service.cached_http_client.clone();
    drop(service);

    tokio::task::spawn_blocking(move || {
        run_diagnostics(&h, port, &u, &p, d.as_deref(), &settings, cached_tls, cached_http)
    })
    .await
    .map_err(|e| format!("Diagnostic task panicked: {e}"))
}

fn run_diagnostics(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
) -> DiagnosticReport {
    let run_start = Instant::now();
    let mut steps: Vec<DiagnosticStep> = Vec::new();
    let mut resolved_ip: Option<String> = None;

    // -- Step 1: DNS Resolution (multi-address) --

    let (socket_addr, ip_str, _all_ips) =
        diagnostics::probe_dns(host, port, &mut steps);
    let socket_addr = match socket_addr {
        Some(a) => {
            resolved_ip = ip_str;
            a
        }
        None => {
            return diagnostics::finish_report(host, port, "rdp", resolved_ip, steps, run_start);
        }
    };

    // -- Step 2: TCP Connect --

    let tcp_stream = match diagnostics::probe_tcp(
        socket_addr,
        settings.tcp_connect_timeout,
        settings.tcp_nodelay,
        &mut steps,
    ) {
        Some(s) => s,
        None => {
            return diagnostics::finish_report(host, port, "rdp", resolved_ip, steps, run_start);
        }
    };

    // -- Step 3: X.224 / RDP Negotiation --

    let t = Instant::now();
    let mut framed = Framed::new(tcp_stream);

    let (actual_user, actual_domain) = resolve_credentials(username, domain, host);
    let probe_config = connector::Config {
        credentials: connector::Credentials::UsernamePassword {
            username: actual_user.clone(),
            password: password.to_string(),
        },
        domain: actual_domain,
        enable_tls: settings.enable_tls,
        enable_credssp: settings.enable_credssp,
        keyboard_type: settings.keyboard_type,
        keyboard_subtype: settings.keyboard_subtype,
        keyboard_functional_keys_count: settings.keyboard_functional_keys_count,
        keyboard_layout: settings.keyboard_layout,
        ime_file_name: settings.ime_file_name.clone(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize { width: 1024, height: 768 },
        desktop_scale_factor: 100,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: false,
            color_depth: 32,
            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        performance_flags: settings.performance_flags,
        license_cache: None,
        timezone_info: Default::default(),
        enable_server_pointer: true,
        pointer_software_rendering: false,
        allow_hybrid_ex: settings.allow_hybrid_ex,
        sspi_package_list: None,
    };

    let server_socket_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
    let mut connector = ClientConnector::new(probe_config, server_socket_addr);

    match ironrdp_blocking::connect_begin(&mut framed, &mut connector) {
        Ok(should_upgrade) => {
            let negotiate_ms = t.elapsed().as_millis() as u64;
            let negotiated_proto = connector.state.name();
            steps.push(DiagnosticStep {
                name: "X.224 Negotiation".into(),
                status: "pass".into(),
                message: format!("Protocol negotiated -> state: {negotiated_proto}"),
                duration_ms: negotiate_ms,
                detail: Some(format!(
                    "TLS={}, CredSSP={}, HYBRID_EX={}",
                    settings.enable_tls, settings.enable_credssp, settings.allow_hybrid_ex
                )),
            });

            // -- Step 4: TLS Upgrade --

            let t = Instant::now();
            let (tcp_stream, leftover) = framed.into_inner();
            match tls_upgrade(tcp_stream, host, leftover, cached_tls_connector) {
                Ok((mut tls_framed, server_public_key)) => {
                    let tls_ms = t.elapsed().as_millis() as u64;

                    let cert_detail = {
                        let (tls_stream, _) = tls_framed.get_inner();
                        extract_cert_fingerprint(tls_stream)
                            .map(|fp| format!("SHA-256: {fp}"))
                            .unwrap_or_else(|| "Certificate fingerprint unavailable".into())
                    };

                    steps.push(DiagnosticStep {
                        name: "TLS Upgrade".into(),
                        status: "pass".into(),
                        message: format!("TLS handshake completed (server pubkey: {} bytes)", server_public_key.len()),
                        duration_ms: tls_ms,
                        detail: Some(cert_detail),
                    });

                    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);

                    // -- Step 5: CredSSP / NLA + Session Setup --

                    let t = Instant::now();
                    let mut network_client = BlockingNetworkClient::new(cached_http_client.clone());
                    let server_name = ironrdp::connector::ServerName::new(host);

                    match ironrdp_blocking::connect_finalize(
                        upgraded,
                        connector,
                        &mut tls_framed,
                        &mut network_client,
                        server_name,
                        server_public_key,
                        None,
                    ) {
                        Ok(connection_result) => {
                            let auth_ms = t.elapsed().as_millis() as u64;
                            steps.push(DiagnosticStep {
                                name: "CredSSP / NLA + Session Setup".into(),
                                status: "pass".into(),
                                message: format!(
                                    "Fully connected! Desktop: {}x{}",
                                    connection_result.desktop_size.width,
                                    connection_result.desktop_size.height
                                ),
                                duration_ms: auth_ms,
                                detail: Some("Authentication, licensing, and capability exchange all succeeded".into()),
                            });

                            // -- Step 6 (RDP-specific): Color Depth Compatibility --
                            // Probe which color depths the server actually accepts.
                            let user_depth = settings.color_depth;
                            if user_depth != 32 {
                                // The probe just succeeded with 32-bit.  If the user
                                // wants a different depth, test it too.
                                let depth_result = probe_color_depth(
                                    host, port, username, password, domain,
                                    settings, user_depth, cached_http_client,
                                );
                                steps.push(depth_result);
                            }
                        }
                        Err(e) => {
                            let auth_ms = t.elapsed().as_millis() as u64;
                            let mut err_detail = format!("{e}");
                            let mut source: Option<&dyn std::error::Error> = std::error::Error::source(&e);
                            while let Some(cause) = source {
                                err_detail.push_str(&format!(" -> {cause}"));
                                source = std::error::Error::source(cause);
                            }

                            let (status, root_hint) = classify_finalize_error(&err_detail);

                            steps.push(DiagnosticStep {
                                name: "CredSSP / NLA + Session Setup".into(),
                                status: status.into(),
                                message: format!("Failed: {e}"),
                                duration_ms: auth_ms,
                                detail: Some(err_detail.clone()),
                            });

                            if err_detail.contains("10054") || err_detail.contains("forcibly closed") {
                                steps.push(DiagnosticStep {
                                    name: "Root Cause Analysis".into(),
                                    status: "warn".into(),
                                    message: "Server accepted TLS but closed connection during/after CredSSP".into(),
                                    duration_ms: 0,
                                    detail: Some(root_hint.unwrap_or_else(|| {
                                        "The CredSSP handshake itself may have succeeded (NTLM OK), \
                                         but the server rejected the session during BasicSettingsExchange. \
                                         This typically means the server accepted your identity but a \
                                         policy or licensing issue prevented session creation. \
                                         Check Windows Event Viewer on the server: \
                                         Applications and Services Logs -> Microsoft -> Windows -> \
                                         TerminalServices-RemoteConnectionManager -> Operational \
                                         for the specific rejection reason.".into()
                                    })),
                                });
                            }

                            // -- Additional: Color Depth Probe on failure --
                            // If the session setup failed, probe multiple color
                            // depths to see if a different one works.
                            let depth_step = probe_color_depths_on_failure(
                                host, port, username, password, domain, settings,
                            );
                            if let Some(ds) = depth_step {
                                steps.push(ds);
                            }
                        }
                    }
                }
                Err(e) => {
                    let tls_ms = t.elapsed().as_millis() as u64;
                    steps.push(DiagnosticStep {
                        name: "TLS Upgrade".into(),
                        status: "fail".into(),
                        message: format!("TLS handshake failed: {e}"),
                        duration_ms: tls_ms,
                        detail: Some("The server may not support TLS, or its certificate is invalid. Try disabling TLS in connection settings.".into()),
                    });
                }
            }
        }
        Err(e) => {
            let negotiate_ms = t.elapsed().as_millis() as u64;
            let mut err_detail = format!("{e}");
            let mut source: Option<&dyn std::error::Error> = std::error::Error::source(&e);
            while let Some(cause) = source {
                err_detail.push_str(&format!(" -> {cause}"));
                source = std::error::Error::source(cause);
            }

            // Detect specific negotiation failure -- server requires CredSSP
            let status = if err_detail.to_lowercase().contains("negotiation")
                || err_detail.to_lowercase().contains("security")
            {
                "fail"
            } else {
                "fail"
            };

            steps.push(DiagnosticStep {
                name: "X.224 Negotiation".into(),
                status: status.into(),
                message: format!("Protocol negotiation failed: {e}"),
                duration_ms: negotiate_ms,
                detail: Some(err_detail.clone()),
            });

            // Try alternative protocol flags if negotiation failed
            let alt_step = probe_alternative_protocols(host, port, username, password, domain, settings);
            if let Some(s) = alt_step {
                steps.push(s);
            }
        }
    }

    diagnostics::finish_report(host, port, "rdp", resolved_ip, steps, run_start)
}

/// Quick probe: can the server accept a specific color depth?
/// Performs a new TCP -> X.224 -> TLS -> finalize cycle with the given depth.
fn probe_color_depth(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    depth: u32,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
) -> DiagnosticStep {
    let t = Instant::now();
    let addr = format!("{host}:{port}");
    let socket_addr = match addr.to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "skip".into(),
                message: "DNS failed (skipped)".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };

    let tcp = match TcpStream::connect_timeout(&socket_addr, settings.tcp_connect_timeout) {
        Ok(s) => s,
        Err(_) => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "skip".into(),
                message: "TCP failed (skipped)".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };
    let _ = tcp.set_nodelay(true);
    let mut framed = Framed::new(tcp);

    let (actual_user, actual_domain) = resolve_credentials(username, domain, host);
    let config = connector::Config {
        credentials: connector::Credentials::UsernamePassword {
            username: actual_user,
            password: password.to_string(),
        },
        domain: actual_domain,
        enable_tls: settings.enable_tls,
        enable_credssp: settings.enable_credssp,
        keyboard_type: settings.keyboard_type,
        keyboard_subtype: settings.keyboard_subtype,
        keyboard_functional_keys_count: settings.keyboard_functional_keys_count,
        keyboard_layout: settings.keyboard_layout,
        ime_file_name: settings.ime_file_name.clone(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize { width: 1024, height: 768 },
        desktop_scale_factor: 100,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: false,
            color_depth: depth,
            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
        hardware_id: None,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        performance_flags: settings.performance_flags,
        license_cache: None,
        timezone_info: Default::default(),
        enable_server_pointer: true,
        pointer_software_rendering: false,
        allow_hybrid_ex: settings.allow_hybrid_ex,
        sspi_package_list: None,
    };

    let server_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
    let mut conn = ClientConnector::new(config, server_addr);

    let should_upgrade = match ironrdp_blocking::connect_begin(&mut framed, &mut conn) {
        Ok(u) => u,
        Err(e) => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "warn".into(),
                message: format!("Negotiation failed: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };

    let (tcp_inner, leftover) = framed.into_inner();
    let (mut tls_framed, server_pk) = match tls_upgrade(tcp_inner, host, leftover, None) {
        Ok(r) => r,
        Err(e) => {
            return DiagnosticStep {
                name: format!("Color Depth Probe ({depth}bpp)"),
                status: "warn".into(),
                message: format!("TLS failed: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            };
        }
    };

    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut conn);
    let mut net_client = BlockingNetworkClient::new(cached_http_client);
    let sn = ironrdp::connector::ServerName::new(host);

    match ironrdp_blocking::connect_finalize(upgraded, conn, &mut tls_framed, &mut net_client, sn, server_pk, None) {
        Ok(cr) => DiagnosticStep {
            name: format!("Color Depth Probe ({depth}bpp)"),
            status: "pass".into(),
            message: format!("{depth}bpp accepted -- desktop {}x{}", cr.desktop_size.width, cr.desktop_size.height),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: Some(format!("The server accepts {depth}-bit color depth")),
        },
        Err(e) => DiagnosticStep {
            name: format!("Color Depth Probe ({depth}bpp)"),
            status: "warn".into(),
            message: format!("{depth}bpp REJECTED -- {e}"),
            duration_ms: t.elapsed().as_millis() as u64,
            detail: Some(format!(
                "The server does NOT accept {depth}-bit color depth. \
                 Try 32-bit or 16-bit in connection settings."
            )),
        },
    }
}

/// After a session-setup failure, quick-test multiple color depths to find
/// which ones the server accepts.
fn probe_color_depths_on_failure(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
) -> Option<DiagnosticStep> {
    let t = Instant::now();
    let depths = [32u32, 24, 16, 15];

    // Probe all depths in parallel -- each one opens its own TCP connection.
    let results: Vec<(u32, DiagnosticStep)> = std::thread::scope(|scope| {
        let handles: Vec<_> = depths
            .iter()
            .map(|&depth| {
                scope.spawn(move || {
                    let step = probe_color_depth(
                        host, port, username, password, domain, settings, depth, None,
                    );
                    (depth, step)
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect()
    });

    let mut accepted: Vec<u32> = Vec::new();
    let mut rejected: Vec<u32> = Vec::new();
    for (depth, step) in &results {
        if step.status == "pass" {
            accepted.push(*depth);
        } else if step.status == "warn" && step.message.contains("REJECTED") {
            rejected.push(*depth);
        }
    }

    if accepted.is_empty() && rejected.is_empty() {
        return None; // couldn't test any
    }

    let accepted_str: Vec<String> = accepted.iter().map(|d| format!("{d}bpp")).collect();
    let rejected_str: Vec<String> = rejected.iter().map(|d| format!("{d}bpp")).collect();

    let user_depth = settings.color_depth;
    let user_ok = accepted.contains(&user_depth);

    let message = if user_ok {
        format!(
            "Your color depth ({user_depth}bpp) is accepted. Accepted: {}",
            accepted_str.join(", ")
        )
    } else if !accepted.is_empty() {
        format!(
            "Your color depth ({user_depth}bpp) may be rejected! Accepted: {}. Rejected: {}",
            accepted_str.join(", "),
            rejected_str.join(", ")
        )
    } else {
        format!(
            "No color depths tested successfully. Rejected: {}",
            rejected_str.join(", ")
        )
    };

    Some(DiagnosticStep {
        name: "Color Depth Compatibility".into(),
        status: if user_ok { "pass" } else { "warn" }.into(),
        message,
        duration_ms: t.elapsed().as_millis() as u64,
        detail: Some(format!(
            "Tested depths: {:?}. Accepted: {:?}. Rejected: {:?}. \
             If your chosen depth is rejected, change it in Display settings.",
            depths, accepted, rejected
        )),
    })
}

/// If X.224 negotiation failed, try alternative protocol flag combinations
/// to see which ones the server accepts.  All combos are probed in parallel.
fn probe_alternative_protocols(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
) -> Option<DiagnosticStep> {
    let t = Instant::now();
    let combos: &[(bool, bool, bool, &str)] = &[
        (true, true, false, "TLS+CredSSP"),
        (true, true, true, "TLS+CredSSP+HYBRID_EX"),
        (true, false, false, "TLS only"),
        (false, false, false, "Plain (no security)"),
    ];

    // Probe all protocol combinations in parallel.
    let results: Vec<(&str, bool)> = std::thread::scope(|scope| {
        let handles: Vec<_> = combos
            .iter()
            .map(|&(tls, credssp, hybrid_ex, label)| {
                scope.spawn(move || {
                    let addr = format!("{host}:{port}");
                    let socket_addr = match addr.to_socket_addrs().ok().and_then(|mut a| a.next()) {
                        Some(a) => a,
                        None => return (label, false),
                    };
                    let tcp = match TcpStream::connect_timeout(&socket_addr, settings.tcp_connect_timeout) {
                        Ok(s) => s,
                        Err(_) => return (label, false),
                    };
                    let _ = tcp.set_nodelay(true);
                    let mut framed = Framed::new(tcp);

                    let (actual_user, actual_domain) = resolve_credentials(username, domain, host);
                    let config = connector::Config {
                        credentials: connector::Credentials::UsernamePassword {
                            username: actual_user,
                            password: password.to_string(),
                        },
                        domain: actual_domain,
                        enable_tls: tls,
                        enable_credssp: credssp,
                        keyboard_type: settings.keyboard_type,
                        keyboard_subtype: settings.keyboard_subtype,
                        keyboard_functional_keys_count: settings.keyboard_functional_keys_count,
                        keyboard_layout: settings.keyboard_layout,
                        ime_file_name: settings.ime_file_name.clone(),
                        dig_product_id: String::new(),
                        desktop_size: connector::DesktopSize { width: 1024, height: 768 },
                        desktop_scale_factor: 100,
                        bitmap: Some(connector::BitmapConfig {
                            lossy_compression: false,
                            color_depth: 32,
                            codecs: ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
                        }),
                        client_build: settings.client_build,
                        client_name: settings.client_name.clone(),
                        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
                        platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
                        hardware_id: None,
                        request_data: None,
                        autologon: false,
                        enable_audio_playback: false,
                        performance_flags: settings.performance_flags,
                        license_cache: None,
                        timezone_info: Default::default(),
                        enable_server_pointer: true,
                        pointer_software_rendering: false,
                        allow_hybrid_ex: hybrid_ex,
                        sspi_package_list: None,
                    };

                    let server_addr = std::net::SocketAddr::new(socket_addr.ip(), port);
                    let mut conn = ClientConnector::new(config, server_addr);

                    match ironrdp_blocking::connect_begin(&mut framed, &mut conn) {
                        Ok(_) => (label, true),
                        Err(_) => (label, false),
                    }
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect()
    });

    let accepted: Vec<&str> = results.iter().filter(|(_, ok)| *ok).map(|(l, _)| *l).collect();
    let rejected: Vec<&str> = results.iter().filter(|(_, ok)| !*ok).map(|(l, _)| *l).collect();

    if accepted.is_empty() && rejected.is_empty() {
        return None;
    }

    let current = format!(
        "TLS={}, CredSSP={}, HYBRID_EX={}",
        settings.enable_tls, settings.enable_credssp, settings.allow_hybrid_ex
    );

    Some(DiagnosticStep {
        name: "Protocol Compatibility".into(),
        status: if accepted.is_empty() { "fail" } else { "warn" }.into(),
        message: if accepted.is_empty() {
            format!("No protocol combinations accepted by the server. Current: {current}")
        } else {
            format!(
                "Server accepts: {}. Rejected: {}. Current: {current}",
                accepted.join(", "),
                rejected.join(", ")
            )
        },
        duration_ms: t.elapsed().as_millis() as u64,
        detail: Some(
            "Enable Auto-detect negotiation or switch to an accepted protocol combination in Security settings.".into()
        ),
    })
}

/// Extract username and domain from various formats (DOMAIN\\user, user@domain, plain user)
pub(crate) fn resolve_credentials(username: &str, domain: Option<&str>, host: &str) -> (String, Option<String>) {
    if let Some(d) = domain {
        if !d.is_empty() {
            return (username.to_string(), Some(d.to_string()));
        }
    }
    if let Some(idx) = username.find('\\') {
        let d = &username[..idx];
        let u = &username[idx + 1..];
        return (u.to_string(), Some(d.to_string()));
    }
    if let Some(idx) = username.find('@') {
        let u = &username[..idx];
        let d = &username[idx + 1..];
        return (u.to_string(), Some(d.to_string()));
    }
    let _ = host; // hostname fallback not used in diagnostics
    (username.to_string(), None)
}

/// Classify the connect_finalize error to provide a root cause hint.
fn classify_finalize_error(err: &str) -> (&'static str, Option<String>) {
    let lower = err.to_lowercase();

    if lower.contains("10054") || lower.contains("forcibly closed") || lower.contains("connection reset") {
        if lower.contains("basicsettingsexchange") || lower.contains("basic settings") {
            // Server closed after CredSSP but during MCS GCC exchange -- policy / licensing
            return ("fail", Some(
                "The server authenticated you (CredSSP/NTLM succeeded) but refused the session \
                 during MCS/GCC negotiation. This usually points to:\n\
                 * RD Licensing: no licenses available or licensing server unreachable\n\
                 * Group Policy: the user is denied logon via 'Allow/Deny log on through Remote Desktop Services'\n\
                 * Max sessions: the server has reached its connection limit\n\
                 * Account restrictions: logon hours, workstation restrictions, or disabled account\n\n\
                 -> Check Event Viewer on the server:\n\
                   Applications and Services Logs -> Microsoft -> Windows ->\n\
                   TerminalServices-RemoteConnectionManager -> Operational\n\
                   TerminalServices-LocalSessionManager -> Operational\n\
                   System log (source: TermService)"
                .into(),
            ));
        }
        if lower.contains("credssp") || lower.contains("nla") || lower.contains("authenticat") {
            return ("fail", Some(
                "The connection was reset during the CredSSP/NLA authentication phase. \
                 This usually means invalid credentials, CredSSP oracle remediation policy mismatch, \
                 or the account lacks remote logon rights."
                .into(),
            ));
        }
        // Generic 10054
        return ("fail", Some(
            "The server sent a TCP RST (forcible close). The connection was dropped \
             before the session could be established. Check the server's Event Viewer \
             for the specific rejection reason."
            .into(),
        ));
    }

    if lower.contains("access denied") || lower.contains("accessdenied") {
        return ("fail", Some("Access was explicitly denied by the server.".into()));
    }

    if lower.contains("license") {
        return ("fail", Some(
            "A licensing error occurred. The RD licensing server may be unreachable or out of CALs."
            .into(),
        ));
    }

    ("fail", None)
}
