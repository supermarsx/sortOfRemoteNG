use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Instant;

use crate::ironrdp::connector::{self, ClientConnector, State as _};
use crate::ironrdp_blocking::Framed;

use super::cert_trust;
use super::network::{extract_cert_fingerprint, tls_upgrade, BlockingNetworkClient};
use super::settings::ResolvedSettings;
use super::RdpTlsConfig;

use sorng_core::diagnostics::{self, DiagnosticReport, DiagnosticStep};


// Re-export shared types so the frontend API stays unchanged.
pub use sorng_core::diagnostics::{DiagnosticReport as DiagReport, DiagnosticStep as DiagStep};

#[allow(clippy::too_many_arguments)]
pub fn run_diagnostics(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    settings: &ResolvedSettings,
    cached_tls_connector: Option<RdpTlsConfig>,
    cached_http_client: Option<Arc<reqwest::blocking::Client>>,
) -> DiagnosticReport {
    // Library callers and tests can invoke diagnostics without going through
    // the Tauri app bootstrap that normally installs the rustls provider.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let run_start = Instant::now();
    let mut steps: Vec<DiagnosticStep> = Vec::new();
    let mut resolved_ip: Option<String> = None;

    // -- Step 1: DNS Resolution (multi-address) --

    let (socket_addr, ip_str, _all_ips) = diagnostics::probe_dns(host, port, &mut steps);
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
        desktop_size: connector::DesktopSize {
            width: 1024,
            height: 768,
        },
        desktop_scale_factor: 100,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: false,
            color_depth: 32,
            codecs: crate::ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: crate::ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
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

    match crate::ironrdp_blocking::connect_begin(&mut framed, &mut connector) {
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

                    // Inspect how the cert actually cleared verification. A
                    // clean chain is a full pass; a trust-store pin or an
                    // Ignore-mode bypass let the connection through but means
                    // the chain did not validate against system roots — we
                    // pass the diagnostic step so the run continues, but mark
                    // it as `warn` with a detail line so the user can see the
                    // partial-compliance state at a glance.
                    let outcome = cert_trust::take_last_verify_outcome();
                    let (status, message, mut detail_lines) =
                        match outcome.as_ref() {
                            Some(cert_trust::VerifyOutcome::TrustStorePinned { chain_error }) => (
                                "warn",
                                format!(
                                    "TLS handshake completed via local trust store \
                                     (server pubkey: {} bytes)",
                                    server_public_key.len()
                                ),
                                vec![
                                    "Pinned in trust store: passing this step although \
                                     chain validation against system roots failed."
                                        .to_string(),
                                    format!("Chain error: {chain_error}"),
                                ],
                            ),
                            Some(cert_trust::VerifyOutcome::ValidationIgnored) => (
                                "warn",
                                format!(
                                    "TLS handshake completed (validation disabled, \
                                     server pubkey: {} bytes)",
                                    server_public_key.len()
                                ),
                                vec![
                                    "Validation mode is set to 'Ignore' for this connection \
                                     — the certificate chain was not checked."
                                        .to_string(),
                                ],
                            ),
                            Some(cert_trust::VerifyOutcome::UserApproved { remembered }) => (
                                "pass",
                                format!(
                                    "TLS handshake completed (user approved, \
                                     server pubkey: {} bytes)",
                                    server_public_key.len()
                                ),
                                vec![if *remembered {
                                    "Cert approved by the user and pinned to the local \
                                     trust store for future connections."
                                        .to_string()
                                } else {
                                    "Cert approved by the user for this session only."
                                        .to_string()
                                }],
                            ),
                            // `ChainValid` and the unknown/unset case both treat
                            // a clean handshake as a full pass.
                            _ => (
                                "pass",
                                format!(
                                    "TLS handshake completed (server pubkey: {} bytes)",
                                    server_public_key.len()
                                ),
                                vec![],
                            ),
                        };
                    detail_lines.push(cert_detail);
                    steps.push(DiagnosticStep {
                        name: "TLS Upgrade".into(),
                        status: status.into(),
                        message,
                        duration_ms: tls_ms,
                        detail: Some(detail_lines.join("\n")),
                    });

                    let upgraded =
                        crate::ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);

                    // -- Step 5: CredSSP / NLA + Session Setup --

                    let t = Instant::now();
                    let mut network_client = BlockingNetworkClient::new(cached_http_client.clone());
                    let server_name = crate::ironrdp::connector::ServerName::new(host);

                    match crate::ironrdp_blocking::connect_finalize(
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

                            // -- Step 6: Server Capabilities --
                            steps.push(build_server_capabilities_step(
                                settings,
                                &connection_result,
                            ));

                            // -- Step 7: Configuration Audit --
                            if let Some(audit_step) = build_configuration_audit_step(
                                settings,
                                &connection_result,
                            ) {
                                steps.push(audit_step);
                            }

                            // -- Step 8 (RDP-specific): Color Depth Compatibility --
                            // Probe which color depths the server actually accepts.
                            let user_depth = settings.color_depth;
                            if user_depth != 32 {
                                // The probe just succeeded with 32-bit.  If the user
                                // wants a different depth, test it too.
                                let depth_result = probe_color_depth(
                                    host,
                                    port,
                                    username,
                                    password,
                                    domain,
                                    settings,
                                    user_depth,
                                    cached_http_client,
                                );
                                steps.push(depth_result);
                            }
                        }
                        Err(e) => {
                            let auth_ms = t.elapsed().as_millis() as u64;
                            let mut err_detail = format!("{e}");
                            let mut source: Option<&dyn std::error::Error> =
                                std::error::Error::source(&e);
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

                            if err_detail.contains("10054")
                                || err_detail.contains("forcibly closed")
                            {
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
                    let raw = e.to_string();
                    // Network::tls_upgrade already prefixes with "TLS handshake failed: ".
                    // Strip the duplicate so the UI doesn't render it twice.
                    let inner = raw
                        .strip_prefix("TLS handshake failed: ")
                        .unwrap_or(&raw);
                    let detail = classify_tls_failure(inner);
                    steps.push(DiagnosticStep {
                        name: "TLS Upgrade".into(),
                        status: "fail".into(),
                        message: format!("TLS handshake failed: {inner}"),
                        duration_ms: tls_ms,
                        detail: Some(detail),
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
            let status = "fail";

            steps.push(DiagnosticStep {
                name: "X.224 Negotiation".into(),
                status: status.into(),
                message: format!("Protocol negotiation failed: {e}"),
                duration_ms: negotiate_ms,
                detail: Some(err_detail.clone()),
            });

            // Try alternative protocol flags if negotiation failed
            let alt_step =
                probe_alternative_protocols(host, port, username, password, domain, settings);
            if let Some(s) = alt_step {
                steps.push(s);
            }
        }
    }

    diagnostics::finish_report(host, port, "rdp", resolved_ip, steps, run_start)
}

/// Quick probe: can the server accept a specific color depth?
/// Performs a new TCP -> X.224 -> TLS -> finalize cycle with the given depth.
#[allow(clippy::too_many_arguments)]
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
        desktop_size: connector::DesktopSize {
            width: 1024,
            height: 768,
        },
        desktop_scale_factor: 100,
        bitmap: Some(connector::BitmapConfig {
            lossy_compression: false,
            color_depth: depth,
            codecs: crate::ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
        }),
        client_build: settings.client_build,
        client_name: settings.client_name.clone(),
        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
        platform: crate::ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
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

    let should_upgrade = match crate::ironrdp_blocking::connect_begin(&mut framed, &mut conn) {
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

    let upgraded = crate::ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut conn);
    let mut net_client = BlockingNetworkClient::new(cached_http_client);
    let sn = crate::ironrdp::connector::ServerName::new(host);

    match crate::ironrdp_blocking::connect_finalize(
        upgraded,
        conn,
        &mut tls_framed,
        &mut net_client,
        sn,
        server_pk,
        None,
    ) {
        Ok(cr) => DiagnosticStep {
            name: format!("Color Depth Probe ({depth}bpp)"),
            status: "pass".into(),
            message: format!(
                "{depth}bpp accepted -- desktop {}x{}",
                cr.desktop_size.width, cr.desktop_size.height
            ),
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
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
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
                    let tcp = match TcpStream::connect_timeout(
                        &socket_addr,
                        settings.tcp_connect_timeout,
                    ) {
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
                        desktop_size: connector::DesktopSize {
                            width: 1024,
                            height: 768,
                        },
                        desktop_scale_factor: 100,
                        bitmap: Some(connector::BitmapConfig {
                            lossy_compression: false,
                            color_depth: 32,
                            codecs: crate::ironrdp::pdu::rdp::capability_sets::BitmapCodecs(Vec::new()),
                        }),
                        client_build: settings.client_build,
                        client_name: settings.client_name.clone(),
                        client_dir: String::from("C:\\Windows\\System32\\mstscax.dll"),
                        platform: crate::ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
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

                    match crate::ironrdp_blocking::connect_begin(&mut framed, &mut conn) {
                        Ok(_) => (label, true),
                        Err(_) => (label, false),
                    }
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });

    let accepted: Vec<&str> = results
        .iter()
        .filter(|(_, ok)| *ok)
        .map(|(l, _)| *l)
        .collect();
    let rejected: Vec<&str> = results
        .iter()
        .filter(|(_, ok)| !*ok)
        .map(|(l, _)| *l)
        .collect();

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

/// Build the "Server Capabilities" diagnostic step from the successful connection result.
fn build_server_capabilities_step(
    settings: &ResolvedSettings,
    result: &connector::ConnectionResult,
) -> DiagnosticStep {
    let desktop_w = result.desktop_size.width;
    let desktop_h = result.desktop_size.height;

    // Determine which security protocols were active based on settings that
    // led to the successful connection.
    let tls_status = if settings.enable_tls { "supported" } else { "not requested" };
    let credssp_status = if settings.enable_credssp {
        if settings.enable_tls {
            "supported"
        } else {
            "required (NLA)"
        }
    } else {
        "not requested"
    };
    let hybrid_ex_status = if settings.allow_hybrid_ex {
        "supported"
    } else {
        "not supported"
    };

    // Color depth: the probe always uses 32-bit, so report that as the
    // negotiated depth.  The user's preferred depth is handled in the
    // Configuration Audit step.
    let probe_depth = 32;

    // Determine RDP protocol version heuristic from connection state.
    // If HYBRID_EX succeeded the server is at least RDP 8.x+.
    // If CredSSP succeeded it is at least RDP 6.x+.
    let rdp_version = if settings.allow_hybrid_ex && settings.enable_credssp {
        "RDP 10.x (HYBRID_EX)"
    } else if settings.enable_credssp {
        "RDP 6.x+ (CredSSP/NLA)"
    } else if settings.enable_tls {
        "RDP 5.2+ (TLS)"
    } else {
        "RDP 5.x (Standard)"
    };

    // FastPath output: always advertised by ironrdp client
    let fastpath = "supported (client advertised)";

    // Large pointers: always advertised up to 384x384 by ironrdp client
    let large_pointers = "up to 384x384 (advertised by client)";

    // Multitransport: server support is detected from GCC but ironrdp does
    // not expose it on ConnectionResult.  Report based on HYBRID_EX which
    // is a prerequisite.
    let multitransport = if settings.allow_hybrid_ex {
        "available (HYBRID_EX enabled)"
    } else {
        "not available (HYBRID_EX disabled)"
    };

    // Server pointer rendering
    let pointer_mode = if result.enable_server_pointer {
        if result.pointer_software_rendering {
            "server pointer, software rendering"
        } else {
            "server pointer, hardware rendering"
        }
    } else {
        "client-side pointer"
    };

    let detail = format!(
        "Security Protocols:\n\
         \x20 TLS: {tls_status}\n\
         \x20 CredSSP (NLA): {credssp_status}\n\
         \x20 HYBRID_EX: {hybrid_ex_status}\n\
         \n\
         Server Info:\n\
         \x20 Desktop: {desktop_w}x{desktop_h}\n\
         \x20 Color Depth: {probe_depth}-bit (probe)\n\
         \x20 Protocol Version: {rdp_version}\n\
         \n\
         Features:\n\
         \x20 FastPath Output: {fastpath}\n\
         \x20 Large Pointers: {large_pointers}\n\
         \x20 Multitransport: {multitransport}\n\
         \x20 Pointer Mode: {pointer_mode}"
    );

    let summary = format!(
        "{rdp_version}, {desktop_w}x{desktop_h}, {probe_depth}-bit color",
    );

    DiagnosticStep {
        name: "Server Capabilities".into(),
        status: "info".into(),
        message: summary,
        duration_ms: 0,
        detail: Some(detail),
    }
}

/// Build the "Configuration Audit" step that compares user settings against
/// what the server actually supports.  Returns `None` if there are no
/// mismatches to report.
fn build_configuration_audit_step(
    settings: &ResolvedSettings,
    result: &connector::ConnectionResult,
) -> Option<DiagnosticStep> {
    let mut warnings: Vec<String> = Vec::new();

    // -- Color depth mismatch --
    // The diagnostic probe connects at 32-bit.  If that succeeded but the
    // user has configured a different depth, flag it as something to watch.
    let user_depth = settings.color_depth;
    if user_depth != 32 {
        warnings.push(format!(
            "Color depth: you requested {user_depth}-bit but the probe succeeded at 32-bit. \
             The server may or may not accept {user_depth}-bit; see the Color Depth Probe step."
        ));
    }

    // -- CredSSP / NLA audit --
    // The probe connected with enable_credssp=<value>.  If the user has it
    // disabled, the server might require it.
    if !settings.enable_credssp {
        // The probe ran with *the user's* settings, and if we reached this
        // point it succeeded without CredSSP.  But many enterprise servers
        // require NLA, so warn if the user has it off.
        warnings.push(
            "CredSSP (NLA) is disabled in your settings. Many enterprise servers require NLA; \
             if you encounter connection failures, enable CredSSP in Security settings."
                .into(),
        );
    }

    // -- TLS audit --
    if !settings.enable_tls && !settings.enable_credssp {
        warnings.push(
            "Both TLS and CredSSP are disabled. The connection uses standard RDP security \
             (RC4) which is insecure and unsupported by most modern servers. Enable TLS \
             or CredSSP in Security settings."
                .into(),
        );
    } else if !settings.enable_tls && settings.enable_credssp {
        // CredSSP implies TLS at the transport layer, but the user has TLS
        // explicitly disabled.  If the server only supports TLS (without
        // CredSSP), this would fail.
        warnings.push(
            "TLS is disabled but CredSSP is enabled. If the server does not support NLA \
             and only accepts TLS, the connection will fail. Consider enabling TLS as a \
             fallback in Security settings."
                .into(),
        );
    }

    // -- Desktop size audit --
    let server_w = result.desktop_size.width;
    let server_h = result.desktop_size.height;
    let user_w = settings.width;
    let user_h = settings.height;
    // The probe used 1024x768 so the server responded with its constrained
    // size.  If the user wants a much larger resolution we can note it.
    if user_w > 0 && user_h > 0 && (user_w > server_w * 2 || user_h > server_h * 2) {
        warnings.push(format!(
            "Desktop size: you requested {user_w}x{user_h} but the server negotiated \
             {server_w}x{server_h} for the probe (which requested 1024x768). \
             Very large resolutions may be constrained by the server."
        ));
    }

    // -- HYBRID_EX audit --
    if settings.allow_hybrid_ex {
        warnings.push(
            "HYBRID_EX is enabled. Some servers (especially non-Microsoft or older ones) \
             negotiate HYBRID_EX but fail to send the EarlyUserAuthResult PDU, causing \
             connection errors. If you see read-frame failures, disable HYBRID_EX."
                .into(),
        );
    }

    if warnings.is_empty() {
        return None;
    }

    let count = warnings.len();
    let detail = warnings
        .iter()
        .enumerate()
        .map(|(i, w)| format!("{}. {w}", i + 1))
        .collect::<Vec<_>>()
        .join("\n\n");

    Some(DiagnosticStep {
        name: "Configuration Audit".into(),
        status: "warn".into(),
        message: format!(
            "{count} configuration mismatch{} detected",
            if count == 1 { "" } else { "es" }
        ),
        duration_ms: 0,
        detail: Some(detail),
    })
}

/// Extract username and domain from various formats (DOMAIN\\user, user@domain, plain user)
pub fn resolve_credentials(
    username: &str,
    domain: Option<&str>,
    host: &str,
) -> (String, Option<String>) {
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

    if lower.contains("10054")
        || lower.contains("forcibly closed")
        || lower.contains("connection reset")
    {
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
        return (
            "fail",
            Some(
                "The server sent a TCP RST (forcible close). The connection was dropped \
             before the session could be established. Check the server's Event Viewer \
             for the specific rejection reason."
                    .into(),
            ),
        );
    }

    if lower.contains("access denied") || lower.contains("accessdenied") {
        return (
            "fail",
            Some("Access was explicitly denied by the server.".into()),
        );
    }

    if lower.contains("license") {
        return ("fail", Some(
            "A licensing error occurred. The RD licensing server may be unreachable or out of CALs."
            .into(),
        ));
    }

    // sspi/NTLM emits "Got empty identity" when CredSSP starts without a
    // username — usually because the connection was initiated with no
    // credentials, or the saved credential record was cleared. NLA can't
    // proceed with an anonymous identity, so the server rejects with
    // InvalidToken.
    if lower.contains("got empty identity") || lower.contains("empty identity") {
        return ("fail", Some(
            "CredSSP/NLA requires a username and password, but no identity was \
             supplied for this connection.\n\n\
             Fixes:\n\
             * Open the connection's editor and set Username + Password (or a \
               saved credential reference).\n\
             * If you intend to authenticate at the remote desktop's logon \
               screen instead, disable NLA on this connection (Security → \
               'Network Level Authentication') so the server falls back to \
               classic RDP security. Many servers refuse this for security \
               reasons; if the server enforces NLA you must provide credentials.\n\
             * For domain accounts use `DOMAIN\\\\user` or `user@domain` so the \
               domain reaches the server."
                .into(),
        ));
    }

    if lower.contains("invalidtoken") {
        return ("fail", Some(
            "CredSSP rejected the authentication token. This usually means the \
             credentials are wrong, the account is locked, or the negotiated \
             security package (NTLM/Kerberos) couldn't complete. Verify the \
             username/password (and domain if applicable), and check that the \
             account isn't locked or expired on the server."
                .into(),
        ));
    }

    ("fail", None)
}

/// Classify a TLS handshake failure into a user-actionable detail message.
/// The input should be the inner error text (without any "TLS handshake failed:"
/// prefix). Returned text is shown in the diagnostic step's detail field and
/// must distinguish "you can opt to trust this" from "this is a real attack
/// surface" so the user knows whether it's safe to relax validation.
fn classify_tls_failure(inner: &str) -> String {
    let lower = inner.to_lowercase();

    // Trust prompt timed out: backend asked the UI for a decision and never
    // got one. Today there's no frontend handler for the prompt event, so
    // every Warn-mode connection to an untrusted host hits this. Tell the
    // user to switch to Ignore (auto-accept) until the prompt UI ships.
    if lower.contains("certificate trust prompt timed out")
        || lower.contains("prompt timeout")
    {
        return "The server's certificate isn't trusted, and your connection's 'Server \
                certificate validation' is set to 'Warn' (prompt-on-first-connect). \
                The prompt UI didn't respond within the timeout, so the connection \
                was aborted.\n\n\
                Open the connection's Security settings and change 'Server certificate \
                validation' to 'Ignore' if you want to auto-accept this server's cert, \
                or to 'Validate' (strict) to fail fast without prompting. Verify the \
                cert fingerprint against the value reported by the server admin before \
                choosing 'Ignore' on a host you can't physically trust.".into();
    }

    // Untrusted issuer: typical for self-signed/internal CA. Common and
    // legitimate in lab/intranet RDP, but it also masks active MITM, so
    // surface both paths and tell the user how to verify.
    if lower.contains("unknownissuer") || lower.contains("unknown issuer") {
        return "The server's certificate is signed by a CA your system doesn't trust \
                (typically a self-signed or internal CA). This is normal for lab and \
                intranet RDP hosts.\n\n\
                If you trust this server: open the connection's Security settings and \
                set 'Server certificate validation' to 'Warn' (prompts on first connect, \
                pins the fingerprint) or 'Ignore' (always accepts). Compare the \
                certificate fingerprint shown in the prompt against the value reported \
                by the server admin before accepting.\n\n\
                If you didn't expect this on a host you've connected to before, the \
                connection may be intercepted -- do NOT relax validation until you've \
                verified the fingerprint out-of-band.".into();
    }

    // Hostname mismatch: cert is real but doesn't match what we connected to.
    // Often a pinhole/NAT issue or a misconfigured cert.
    if lower.contains("notvalidforname")
        || lower.contains("not valid for name")
        || lower.contains("certificatenotvalidforname")
    {
        return "The server's certificate is valid, but it isn't issued for the hostname \
                you connected to. This usually means you're connecting via an IP \
                address, an alternate DNS name, or a NAT/port-forward that isn't on \
                the certificate's Subject Alternative Name list.\n\n\
                Options: connect using the hostname listed on the certificate, ask the \
                server admin to reissue with the correct SAN, or set 'Server \
                certificate validation' to 'Warn'/'Ignore' if you've verified the host \
                identity by other means.".into();
    }

    // Expired or not-yet-valid certificate.
    if lower.contains("expired") || lower.contains("notvalidatthistime") {
        return "The server's certificate has expired (or isn't yet valid). Verify the \
                local clock first -- a wrong system time is the most common cause. If \
                the clock is correct, the server admin needs to renew the certificate. \
                You can temporarily set 'Server certificate validation' to 'Warn' or \
                'Ignore' to connect, but an expired cert means the server has likely \
                been neglected; treat with caution.".into();
    }

    // Server actively rejected our TLS configuration (cipher mismatch, version
    // mismatch, etc.) -- not a trust issue, a compatibility issue.
    if lower.contains("handshakefailure") || lower.contains("handshake_failure") {
        return "The server rejected our TLS configuration during handshake. This is \
                usually a protocol/cipher mismatch -- common with very old servers \
                that only speak TLS 1.0/1.1. There is no client-side toggle that \
                fixes this safely; the server needs to enable a modern TLS version, \
                or you need to use a different transport (e.g. an RD Gateway).".into();
    }

    // Generic fallback: server probably isn't speaking TLS at all on this port.
    "TLS handshake failed before certificate validation. The server likely isn't \
     speaking TLS on this port (e.g. plain RDP without NLA), or a network device \
     is intercepting the connection. Verify the port, check whether NLA is required, \
     and confirm no proxy/firewall is doing TLS inspection."
        .into()
}
