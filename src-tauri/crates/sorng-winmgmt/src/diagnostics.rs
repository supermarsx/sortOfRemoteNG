//! Deep connection diagnostics for WinRM/WMI.
//!
//! Runs a sequence of probes (DNS → TCP → WinRM Identify → Auth → WMI query)
//! and reports per-step timings, status, and a root-cause hint.

use crate::transport::WmiTransport;
use crate::types::*;
use log::debug;
use sorng_core::diagnostics::{
    self, DiagnosticReport, DiagnosticStep,
};
use std::time::{Duration, Instant};

/// Run the full WinRM/WMI diagnostic sequence.
///
/// This is designed to be called from a Tauri command handler.
pub async fn run_diagnostics(
    host: &str,
    config: &WmiConnectionConfig,
) -> DiagnosticReport {
    let run_start = Instant::now();
    let port = config.effective_port();
    let protocol_label = if config.use_ssl { "HTTPS" } else { "HTTP" };
    let mut steps: Vec<DiagnosticStep> = Vec::new();

    debug!(
        "Starting WinRM diagnostics for {}:{} ({})",
        host, port, protocol_label
    );

    // ── Step 1: DNS Resolution ──────────────────────────────────────
    let (socket_addr, resolved_ip, _all_ips) = diagnostics::probe_dns(host, port, &mut steps);

    let socket_addr = match socket_addr {
        Some(addr) => addr,
        None => {
            return diagnostics::finish_report(
                host, port, "winrm", None, steps, run_start,
            );
        }
    };

    // ── Step 2: TCP Connect to WinRM port ───────────────────────────
    let tcp_timeout = Duration::from_secs(config.timeout_sec.min(15) as u64);
    let tcp_stream = diagnostics::probe_tcp(socket_addr, tcp_timeout, true, &mut steps);

    if tcp_stream.is_none() {
        // Also scan both WinRM ports to help with misconfiguration
        diagnostics::probe_ports_parallel(
            host,
            &[5985, 5986, 135],
            Duration::from_secs(5),
            &mut steps,
        );
        add_root_cause(
            "TCP connection failed. WinRM may not be running, the port may be \
             firewalled, or the host is unreachable.\n\n\
             Fix: On the target, run `winrm quickconfig` in elevated PowerShell \
             and ensure the Windows Firewall allows TCP {} inbound.",
            &mut steps,
            port,
        );
        return diagnostics::finish_report(
            host, port, "winrm", resolved_ip, steps, run_start,
        );
    }
    // Drop the sync TcpStream — the async probes below use reqwest
    drop(tcp_stream);

    // ── Step 3: WinRM Identify (anonymous) ──────────────────────────
    // This tests that WinRM is responding to SOAP requests,
    // independent of authentication.
    let identify_result = probe_winrm_identify(host, config).await;
    match &identify_result {
        Ok(product_info) => {
            steps.push(DiagnosticStep {
                name: "WinRM Identify".into(),
                status: "pass".into(),
                message: format!("WinRM service responded — {product_info}"),
                duration_ms: 0, // filled by the probe
                detail: None,
            });
        }
        Err((ms, err)) => {
            let is_auth_error = err.contains("401") || err.contains("403");
            if is_auth_error {
                // 401 on Identify means the server requires auth for all requests.
                // This is actually fine — it proves WinRM is listening.
                steps.push(DiagnosticStep {
                    name: "WinRM Identify".into(),
                    status: "pass".into(),
                    message: "WinRM service is listening (requires authentication for all requests)".into(),
                    duration_ms: *ms,
                    detail: Some(err.clone()),
                });
            } else {
                steps.push(DiagnosticStep {
                    name: "WinRM Identify".into(),
                    status: "fail".into(),
                    message: format!("WinRM Identify failed: {err}"),
                    duration_ms: *ms,
                    detail: Some(
                        "The TCP port is open but WinRM did not respond with a valid \
                         SOAP IdentifyResponse. The service may be misconfigured or \
                         another HTTP service is running on this port."
                            .into(),
                    ),
                });
                add_root_cause(
                    "WinRM Identify failed — the service on port {} is not responding \
                     as a WS-Management endpoint.\n\n\
                     Fix: Verify WinRM is properly configured:\n\
                     winrm enumerate winrm/config/listener",
                    &mut steps,
                    port,
                );
                return diagnostics::finish_report(
                    host, port, "winrm", resolved_ip, steps, run_start,
                );
            }
        }
    }

    // ── Step 4: HTTP Authentication ─────────────────────────────────
    let auth_result = probe_winrm_auth(host, config).await;
    match &auth_result {
        Ok((ms, response_snippet)) => {
            steps.push(DiagnosticStep {
                name: "HTTP Authentication".into(),
                status: "pass".into(),
                message: "Credentials accepted by WinRM service".into(),
                duration_ms: *ms,
                detail: if response_snippet.is_empty() {
                    None
                } else {
                    Some(response_snippet.clone())
                },
            });
        }
        Err((ms, err)) => {
            let is_401 = err.contains("401");
            let is_403 = err.contains("403");
            if is_401 {
                steps.push(DiagnosticStep {
                    name: "HTTP Authentication".into(),
                    status: "fail".into(),
                    message: "HTTP 401 Unauthorized — credentials rejected".into(),
                    duration_ms: *ms,
                    detail: Some(format!(
                        "{err}\n\n\
                         Possible causes:\n\
                         • Wrong username or password\n\
                         • Basic auth not enabled (winrm get winrm/config/service/auth)\n\
                         • Domain/username format issue — try DOMAIN\\user or user@domain"
                    )),
                });
                add_root_cause(
                    "Authentication failed (HTTP 401). The WinRM service rejected the \
                     credentials.\n\n\
                     Fix:\n\
                     1. Verify username/password are correct\n\
                     2. Enable Basic auth: winrm set winrm/config/service/auth @{{Basic=\"true\"}}\n\
                     3. For non-domain: try .\\username format\n\
                     4. Check the account is not locked/expired",
                    &mut steps,
                    port,
                );
            } else if is_403 {
                steps.push(DiagnosticStep {
                    name: "HTTP Authentication".into(),
                    status: "fail".into(),
                    message: "HTTP 403 Forbidden — credentials accepted but access denied".into(),
                    duration_ms: *ms,
                    detail: Some(format!(
                        "{err}\n\n\
                         The user authenticated but lacks permission to use WinRM.\n\
                         The account may need to be in the local Administrators group \
                         or have explicit WinRM access."
                    )),
                });
                add_root_cause(
                    "Access denied (HTTP 403). The account authenticated but is not \
                     authorized to use WinRM.\n\n\
                     Fix:\n\
                     1. Add the user to the local Administrators group on the target\n\
                     2. Or set LocalAccountTokenFilterPolicy = 1 (for non-domain admins)\n\
                     3. Or grant WinRM permissions via WinRM security descriptor",
                    &mut steps,
                    port,
                );
            } else {
                steps.push(DiagnosticStep {
                    name: "HTTP Authentication".into(),
                    status: "fail".into(),
                    message: format!("Authentication request failed: {err}"),
                    duration_ms: *ms,
                    detail: None,
                });
            }
            return diagnostics::finish_report(
                host, port, "winrm", resolved_ip, steps, run_start,
            );
        }
    }

    // ── Step 5: WMI Namespace Access ────────────────────────────────
    let wmi_result = probe_wmi_query(host, config).await;
    match &wmi_result {
        Ok((ms, os_caption)) => {
            steps.push(DiagnosticStep {
                name: "WMI Namespace Access".into(),
                status: "pass".into(),
                message: format!(
                    "WQL query succeeded — namespace {} accessible",
                    config.namespace
                ),
                duration_ms: *ms,
                detail: if os_caption.is_empty() {
                    None
                } else {
                    Some(format!("OS: {os_caption}"))
                },
            });
        }
        Err((ms, err)) => {
            let is_access_denied = err.to_lowercase().contains("access denied")
                || err.to_lowercase().contains("access is denied");
            let is_namespace =
                err.to_lowercase().contains("invalid namespace") || err.contains("0x8004");

            if is_access_denied {
                steps.push(DiagnosticStep {
                    name: "WMI Namespace Access".into(),
                    status: "fail".into(),
                    message: format!("WMI access denied on namespace {}", config.namespace),
                    duration_ms: *ms,
                    detail: Some(format!(
                        "{err}\n\n\
                         The WinRM authentication succeeded but the account lacks WMI \
                         remote access permissions on the target namespace."
                    )),
                });
                add_root_cause(
                    "WMI access denied. The user can authenticate to WinRM but cannot \
                     query the {ns} namespace.\n\n\
                     Fix:\n\
                     1. On target: wmimgmt.msc → WMI Control → Properties → Security\n\
                     2. Navigate to {ns} → Add user → Enable Account + Remote Enable\n\
                     3. Also grant DCOM permissions via dcomcnfg if needed\n\
                     4. For local non-admin accounts: set LocalAccountTokenFilterPolicy = 1",
                    &mut steps,
                    port,
                );
            } else if is_namespace {
                steps.push(DiagnosticStep {
                    name: "WMI Namespace Access".into(),
                    status: "fail".into(),
                    message: format!("WMI namespace {} does not exist or is invalid", config.namespace),
                    duration_ms: *ms,
                    detail: Some(err.clone()),
                });
                add_root_cause(
                    "WMI namespace error. The namespace {ns} is not available on the \
                     target machine.\n\n\
                     Fix: Verify the namespace exists:\n\
                     Get-WmiObject -Namespace root -Class __Namespace | Select-Object Name",
                    &mut steps,
                    port,
                );
            } else {
                steps.push(DiagnosticStep {
                    name: "WMI Namespace Access".into(),
                    status: "fail".into(),
                    message: format!("WMI query failed: {err}"),
                    duration_ms: *ms,
                    detail: None,
                });
            }
            return diagnostics::finish_report(
                host, port, "winrm", resolved_ip, steps, run_start,
            );
        }
    }

    // ── Step 6: WMI Enumeration (heavier query) ─────────────────────
    let enum_result = probe_wmi_enum(host, config).await;
    match &enum_result {
        Ok((ms, count)) => {
            steps.push(DiagnosticStep {
                name: "WMI Enumeration".into(),
                status: "pass".into(),
                message: format!(
                    "Enumerated {count} services in {}ms — full WMI access confirmed",
                    ms
                ),
                duration_ms: *ms,
                detail: None,
            });
        }
        Err((ms, err)) => {
            steps.push(DiagnosticStep {
                name: "WMI Enumeration".into(),
                status: "warn".into(),
                message: format!("Service enumeration warning: {err}"),
                duration_ms: *ms,
                detail: Some(
                    "The basic WMI query passed but a heavier enumeration encountered \
                     an issue. This may indicate resource limits or partial WMI access."
                        .into(),
                ),
            });
        }
    }

    diagnostics::finish_report(host, port, "winrm", resolved_ip, steps, run_start)
}

// ── Individual probe implementations ────────────────────────────────────

/// Probe WinRM with an anonymous Identify request.
/// Returns Ok(product_info_string) or Err((duration_ms, error_message)).
async fn probe_winrm_identify(
    _host: &str,
    config: &WmiConnectionConfig,
) -> Result<String, (u64, String)> {
    let t = Instant::now();
    // Build a transport WITHOUT auth to test anonymous Identify
    let mut anon_config = config.clone();
    anon_config.credential = None;

    let mut transport = WmiTransport::new(&anon_config)
        .map_err(|e| (t.elapsed().as_millis() as u64, e))?;

    match transport.test_connection().await {
        Ok(_) => Ok("WS-Management IdentifyResponse received".into()),
        Err(e) => Err((t.elapsed().as_millis() as u64, e)),
    }
}

/// Probe WinRM with authenticated Identify request.
/// Returns Ok((duration_ms, response_snippet)) or Err((duration_ms, error)).
async fn probe_winrm_auth(
    _host: &str,
    config: &WmiConnectionConfig,
) -> Result<(u64, String), (u64, String)> {
    let t = Instant::now();
    let mut transport = WmiTransport::new(config)
        .map_err(|e| (t.elapsed().as_millis() as u64, e))?;

    if let Some(header) = WmiTransport::build_auth_header(config) {
        transport.set_auth(header);
    }

    match transport.test_connection().await {
        Ok(_) => Ok((t.elapsed().as_millis() as u64, String::new())),
        Err(e) => Err((t.elapsed().as_millis() as u64, e)),
    }
}

/// Probe WMI with a lightweight query.
/// Returns Ok((duration_ms, os_caption)) or Err((duration_ms, error)).
async fn probe_wmi_query(
    _host: &str,
    config: &WmiConnectionConfig,
) -> Result<(u64, String), (u64, String)> {
    let t = Instant::now();
    let mut transport = WmiTransport::new(config)
        .map_err(|e| (t.elapsed().as_millis() as u64, e))?;

    if let Some(header) = WmiTransport::build_auth_header(config) {
        transport.set_auth(header);
    }

    match transport
        .wql_query("SELECT Caption FROM Win32_OperatingSystem")
        .await
    {
        Ok(rows) => {
            let caption = rows
                .first()
                .and_then(|r| r.get("Caption"))
                .cloned()
                .unwrap_or_default();
            Ok((t.elapsed().as_millis() as u64, caption))
        }
        Err(e) => Err((t.elapsed().as_millis() as u64, e)),
    }
}

/// Probe with a heavier WMI enumeration (Win32_Service, limited to 10 rows).
/// Returns Ok((duration_ms, service_count)) or Err((duration_ms, error)).
async fn probe_wmi_enum(
    _host: &str,
    config: &WmiConnectionConfig,
) -> Result<(u64, usize), (u64, String)> {
    let t = Instant::now();
    let mut transport = WmiTransport::new(config)
        .map_err(|e| (t.elapsed().as_millis() as u64, e))?;

    if let Some(header) = WmiTransport::build_auth_header(config) {
        transport.set_auth(header);
    }

    match transport
        .wql_query("SELECT Name FROM Win32_Service")
        .await
    {
        Ok(rows) => Ok((t.elapsed().as_millis() as u64, rows.len())),
        Err(e) => Err((t.elapsed().as_millis() as u64, e)),
    }
}

/// Add a "Root Cause Analysis" step with a formatted hint.
fn add_root_cause(
    hint_template: &str,
    steps: &mut Vec<DiagnosticStep>,
    port: u16,
) {
    let hint = hint_template
        .replace("{}", &port.to_string())
        .replace("{ns}", "root\\cimv2");
    steps.push(DiagnosticStep {
        name: "Root Cause Analysis".into(),
        status: "info".into(),
        message: "Analyzed failure pattern".into(),
        duration_ms: 0,
        detail: Some(hint),
    });
}
