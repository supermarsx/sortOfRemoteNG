//! PowerShell Remoting diagnostics.
//!
//! Test-WSMan, WinRM service checks, connectivity diagnostics,
//! TLS/certificate validation, firewall rule checks, and performance analysis.

use crate::transport::WinRmTransport;
use crate::types::*;
use crate::session::PsSessionManager;
use log::{debug, info, warn};
use std::collections::HashMap;

/// PowerShell Remoting diagnostic operations.
pub struct PsDiagnosticsManager;

impl PsDiagnosticsManager {
    /// Test WinRM connectivity to a remote host (equivalent to Test-WSMan).
    pub async fn test_wsman(config: &PsRemotingConfig) -> Result<PsDiagnosticResult, String> {
        let start = std::time::Instant::now();
        let mut checks: Vec<DiagnosticCheck> = Vec::new();

        // Check 1: DNS resolution
        let dns_check = test_dns_resolution(&config.computer_name).await;
        checks.push(dns_check);

        // Check 2: TCP port connectivity
        let port = config.effective_port();
        let port_check = test_tcp_port(&config.computer_name, port).await;
        checks.push(port_check);

        // Check 3: HTTP(S) endpoint availability
        let endpoint_check = test_winrm_endpoint(config).await;
        checks.push(endpoint_check);

        // Check 4: WS-Man identify
        let identify_check = test_wsman_identify(config).await;
        checks.push(identify_check);

        let elapsed = start.elapsed();
        let all_passed = checks.iter().all(|c| c.passed);

        Ok(PsDiagnosticResult {
            computer_name: config.computer_name.clone(),
            wsman_reachable: all_passed,
            protocol_version: None,
            product_vendor: None,
            product_version: None,
            stack_version: None,
            os_info: None,
            ps_version: None,
            latency_ms: None,
            auth_methods_available: Vec::new(),
            max_envelope_size_kb: None,
            max_timeout_ms: None,
            locale: None,
            certificate_info: None,
            errors: Vec::new(),
            warnings: Vec::new(),
            timestamp: chrono::Utc::now(),
            success: all_passed,
            checks,
            duration_ms: elapsed.as_millis() as u64,
        })
    }

    /// Perform a comprehensive connection diagnostic.
    pub async fn diagnose_connection(
        config: &PsRemotingConfig,
    ) -> Result<PsDiagnosticResult, String> {
        let start = std::time::Instant::now();
        let mut checks: Vec<DiagnosticCheck> = Vec::new();

        // DNS resolution
        checks.push(test_dns_resolution(&config.computer_name).await);

        // TCP connectivity on standard ports
        let port = config.effective_port();
        checks.push(test_tcp_port(&config.computer_name, port).await);

        // Also test the other port
        let alt_port = if port == 5985 { 5986 } else { 5985 };
        let alt_check = test_tcp_port(&config.computer_name, alt_port).await;
        let mut alt_check_named = alt_check;
        alt_check_named.name = format!("TCP Port {} (alternate)", alt_port);
        checks.push(alt_check_named);

        // WinRM endpoint
        checks.push(test_winrm_endpoint(config).await);

        // WS-Man identify
        checks.push(test_wsman_identify(config).await);

        // TLS certificate (if HTTPS)
        if config.use_ssl || port == 5986 {
            checks.push(test_tls_certificate(config).await);
        }

        // Authentication
        checks.push(test_authentication(config).await);

        let elapsed = start.elapsed();
        let all_passed = checks.iter().all(|c| c.passed);
        let critical_passed = checks
            .iter()
            .filter(|c| c.severity == DiagnosticSeverity::Critical)
            .all(|c| c.passed);

        Ok(PsDiagnosticResult {
            computer_name: config.computer_name.clone(),
            wsman_reachable: all_passed,
            protocol_version: None,
            product_vendor: None,
            product_version: None,
            stack_version: None,
            os_info: None,
            ps_version: None,
            latency_ms: None,
            auth_methods_available: Vec::new(),
            max_envelope_size_kb: None,
            max_timeout_ms: None,
            locale: None,
            certificate_info: None,
            errors: Vec::new(),
            warnings: Vec::new(),
            timestamp: chrono::Utc::now(),
            success: all_passed,
            checks,
            duration_ms: elapsed.as_millis() as u64,
        })
    }

    /// Check WinRM service status on a remote host (requires an established session).
    pub async fn check_winrm_service(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<WinRmServiceStatus, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = r#"
$svc = Get-Service WinRM
$config = @{
    ServiceStatus = $svc.Status.ToString()
    StartType = $svc.StartType.ToString()
    MaxEnvelopeSizekb = (Get-Item WSMan:\localhost\MaxEnvelopeSizekb).Value
    MaxTimeoutms = (Get-Item WSMan:\localhost\MaxTimeoutms).Value
    MaxBatchItems = (Get-Item WSMan:\localhost\MaxBatchItems).Value
    MaxConcurrentUsers = (Get-Item WSMan:\localhost\Service\MaxConcurrentUsers).Value
    MaxConcurrentOperationsPerUser = (Get-Item WSMan:\localhost\Service\MaxConcurrentOperationsPerUser).Value
    MaxConnections = (Get-Item WSMan:\localhost\Service\MaxConnections).Value
    AllowUnencrypted = (Get-Item WSMan:\localhost\Service\AllowUnencrypted).Value
    AuthBasic = (Get-Item WSMan:\localhost\Service\Auth\Basic).Value
    AuthKerberos = (Get-Item WSMan:\localhost\Service\Auth\Kerberos).Value
    AuthNegotiate = (Get-Item WSMan:\localhost\Service\Auth\Negotiate).Value
    AuthCertificate = (Get-Item WSMan:\localhost\Service\Auth\Certificate).Value
    AuthCredSSP = (Get-Item WSMan:\localhost\Service\Auth\CredSSP).Value
    IdleTimeout = (Get-Item WSMan:\localhost\Shell\IdleTimeout).Value
    MaxProcessesPerShell = (Get-Item WSMan:\localhost\Shell\MaxProcessesPerShell).Value
    MaxMemoryPerShellMB = (Get-Item WSMan:\localhost\Shell\MaxMemoryPerShellMB).Value
    MaxShellsPerUser = (Get-Item WSMan:\localhost\Shell\MaxShellsPerUser).Value
}
$listeners = Get-ChildItem WSMan:\localhost\Listener | ForEach-Object {
    $props = Get-ChildItem $_.PSPath
    @{
        Address = ($props | Where-Object Name -eq 'Address').Value
        Transport = ($props | Where-Object Name -eq 'Transport').Value
        Port = ($props | Where-Object Name -eq 'Port').Value
        Hostname = ($props | Where-Object Name -eq 'Hostname').Value
        Enabled = ($props | Where-Object Name -eq 'Enabled').Value
        CertificateThumbprint = ($props | Where-Object Name -eq 'CertificateThumbprint').Value
    }
}
@{
    Config = $config
    Listeners = $listeners
} | ConvertTo-Json -Depth 4
"#;

        let (stdout, _) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        parse_winrm_service_status(&stdout)
    }

    /// Check firewall rules related to WinRM on a remote host.
    pub async fn check_firewall_rules(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Vec<FirewallRuleInfo>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = r#"Get-NetFirewallRule -DisplayGroup "Windows Remote Management" -ErrorAction SilentlyContinue | ForEach-Object {
    $portFilter = $_ | Get-NetFirewallPortFilter
    [PSCustomObject]@{
        Name = $_.Name
        DisplayName = $_.DisplayName
        Enabled = $_.Enabled.ToString()
        Direction = $_.Direction.ToString()
        Action = $_.Action.ToString()
        Profile = $_.Profile.ToString()
        Protocol = $portFilter.Protocol
        LocalPort = $portFilter.LocalPort
    }
} | ConvertTo-Json -Depth 3"#;

        let (stdout, _) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        parse_firewall_rules(&stdout)
    }

    /// Run Enable-PSRemoting equivalent checks and configuration.
    pub async fn enable_ps_remoting(
        ps_manager: &PsSessionManager,
        session_id: &str,
        skip_network_profile_check: bool,
    ) -> Result<Vec<DiagnosticCheck>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let skip_flag = if skip_network_profile_check {
            " -SkipNetworkProfileCheck"
        } else {
            ""
        };

        let script = format!(
            "Enable-PSRemoting -Force{} 2>&1 | ForEach-Object {{ $_.ToString() }}",
            skip_flag
        );

        let (stdout, stderr) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        let mut checks = Vec::new();

        // Parse output for configuration steps
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let passed = !trimmed.to_lowercase().contains("fail")
                && !trimmed.to_lowercase().contains("error");
            checks.push(DiagnosticCheck {
                name: "Enable-PSRemoting".to_string(),
                passed,
                message: trimmed.to_string(),
                severity: DiagnosticSeverity::Info,
                duration_ms: None,
            });
        }

        if !stderr.trim().is_empty() {
            checks.push(DiagnosticCheck {
                name: "Enable-PSRemoting Errors".to_string(),
                passed: false,
                message: stderr.trim().to_string(),
                severity: DiagnosticSeverity::Critical,
                duration_ms: None,
            });
        }

        Ok(checks)
    }

    /// Measure PS Remoting round-trip latency.
    pub async fn measure_latency(
        ps_manager: &PsSessionManager,
        session_id: &str,
        iterations: u32,
    ) -> Result<LatencyResult, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;
        let iterations = iterations.min(100).max(1);

        let mut latencies: Vec<u64> = Vec::new();

        for i in 0..iterations {
            let start = std::time::Instant::now();

            let (stdout, _) = {
                let mut t = transport.lock().await;
                let cmd_id = t
                    .execute_ps_command(&shell_id, "Write-Output 'pong'")
                    .await?;
                let result = t.receive_all_output(&shell_id, &cmd_id).await?;
                let _ = t
                    .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                    .await;
                result
            };

            let elapsed = start.elapsed().as_millis() as u64;
            latencies.push(elapsed);
        }

        let total: u64 = latencies.iter().sum();
        let avg = total / latencies.len() as u64;
        let min = *latencies.iter().min().unwrap_or(&0);
        let max = *latencies.iter().max().unwrap_or(&0);

        // Standard deviation
        let mean = total as f64 / latencies.len() as f64;
        let variance = latencies
            .iter()
            .map(|&l| {
                let diff = l as f64 - mean;
                diff * diff
            })
            .sum::<f64>()
            / latencies.len() as f64;
        let stddev = variance.sqrt();

        // Percentiles
        let mut sorted = latencies.clone();
        sorted.sort();
        let p50 = sorted[sorted.len() / 2];
        let p95_idx = ((sorted.len() as f64 * 0.95) as usize).min(sorted.len() - 1);
        let p95 = sorted[p95_idx];
        let p99_idx = ((sorted.len() as f64 * 0.99) as usize).min(sorted.len() - 1);
        let p99 = sorted[p99_idx];

        Ok(LatencyResult {
            iterations: latencies.len() as u32,
            avg_ms: avg,
            min_ms: min,
            max_ms: max,
            stddev_ms: stddev,
            p50_ms: p50,
            p95_ms: p95,
            p99_ms: p99,
            samples: latencies,
        })
    }

    /// Check certificate details for HTTPS WinRM listener.
    pub async fn get_certificate_info(
        ps_manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Vec<PsCertificateInfo>, String> {
        let transport = ps_manager.get_transport(session_id)?;
        let shell_id = ps_manager.get_shell_id(session_id)?;

        let script = r#"Get-ChildItem WSMan:\localhost\Listener | ForEach-Object {
    $props = Get-ChildItem $_.PSPath
    $thumbprint = ($props | Where-Object Name -eq 'CertificateThumbprint').Value
    if ($thumbprint) {
        $cert = Get-ChildItem "Cert:\LocalMachine\My\$thumbprint" -ErrorAction SilentlyContinue
        if ($cert) {
            [PSCustomObject]@{
                Subject = $cert.Subject
                Issuer = $cert.Issuer
                Thumbprint = $cert.Thumbprint
                NotBefore = $cert.NotBefore.ToString('o')
                NotAfter = $cert.NotAfter.ToString('o')
                DnsNameList = ($cert.DnsNameList | ForEach-Object { $_.Unicode })
                HasPrivateKey = $cert.HasPrivateKey
                SerialNumber = $cert.SerialNumber
                SignatureAlgorithm = $cert.SignatureAlgorithm.FriendlyName
                KeyUsage = ($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' }).Format($false)
            }
        }
    }
} | ConvertTo-Json -Depth 3"#;

        let (stdout, _) = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, script).await?;
            let result = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            result
        };

        parse_certificate_info(&stdout)
    }
}

// ─── Diagnostic Types ────────────────────────────────────────────────

// DiagnosticCheck and DiagnosticSeverity are defined in types.rs

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinRmServiceStatus {
    pub service_status: String,
    pub start_type: String,
    pub max_envelope_size_kb: Option<String>,
    pub max_timeout_ms: Option<String>,
    pub max_batch_items: Option<String>,
    pub max_concurrent_users: Option<String>,
    pub max_concurrent_operations_per_user: Option<String>,
    pub max_connections: Option<String>,
    pub allow_unencrypted: Option<String>,
    pub auth_basic: Option<String>,
    pub auth_kerberos: Option<String>,
    pub auth_negotiate: Option<String>,
    pub auth_certificate: Option<String>,
    pub auth_credss_p: Option<String>,
    pub idle_timeout: Option<String>,
    pub max_processes_per_shell: Option<String>,
    pub max_memory_per_shell_mb: Option<String>,
    pub max_shells_per_user: Option<String>,
    pub listeners: Vec<ListenerInfo>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerInfo {
    pub address: Option<String>,
    pub transport: Option<String>,
    pub port: Option<String>,
    pub hostname: Option<String>,
    pub enabled: Option<String>,
    pub certificate_thumbprint: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallRuleInfo {
    pub name: String,
    pub display_name: String,
    pub enabled: String,
    pub direction: String,
    pub action: String,
    pub profile: String,
    pub protocol: Option<String>,
    pub local_port: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyResult {
    pub iterations: u32,
    pub avg_ms: u64,
    pub min_ms: u64,
    pub max_ms: u64,
    pub stddev_ms: f64,
    pub p50_ms: u64,
    pub p95_ms: u64,
    pub p99_ms: u64,
    pub samples: Vec<u64>,
}

// ─── Diagnostic Test Routines ────────────────────────────────────────

async fn test_dns_resolution(hostname: &str) -> DiagnosticCheck {
    let start = std::time::Instant::now();

    match tokio::net::lookup_host(format!("{}:0", hostname)).await {
        Ok(addrs) => {
            let addr_list: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: "DNS Resolution".to_string(),
                passed: !addr_list.is_empty(),
                message: if addr_list.is_empty() {
                    format!("No addresses found for '{}'", hostname)
                } else {
                    format!(
                        "Resolved '{}' to: {}",
                        hostname,
                        addr_list.join(", ")
                    )
                },
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: "DNS Resolution".to_string(),
                passed: false,
                message: format!("Failed to resolve '{}': {}", hostname, e),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
    }
}

async fn test_tcp_port(hostname: &str, port: u16) -> DiagnosticCheck {
    let start = std::time::Instant::now();
    let addr = format!("{}:{}", hostname, port);

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: format!("TCP Port {}", port),
                passed: true,
                message: format!("Successfully connected to {}:{}", hostname, port),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
        Ok(Err(e)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: format!("TCP Port {}", port),
                passed: false,
                message: format!("Connection to {}:{} failed: {}", hostname, port, e),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
        Err(_) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: format!("TCP Port {}", port),
                passed: false,
                message: format!("Connection to {}:{} timed out (5s)", hostname, port),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
    }
}

async fn test_winrm_endpoint(config: &PsRemotingConfig) -> DiagnosticCheck {
    let start = std::time::Instant::now();
    let endpoint_url = config.endpoint_uri();

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.skip_ca_check)
        .timeout(std::time::Duration::from_secs(10))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => {
            return DiagnosticCheck {
                name: "WinRM Endpoint".to_string(),
                passed: false,
                message: format!("Failed to create HTTP client: {}", e),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(start.elapsed().as_millis() as u64),
            };
        }
    };

    // Send a simple POST to the WinRM endpoint — we expect 401 (auth required) or 200
    match client.post(&endpoint_url).body("").send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let elapsed = start.elapsed().as_millis() as u64;

            let (passed, msg) = if status == 401 {
                (
                    true,
                    format!(
                        "WinRM endpoint at {} responded with 401 (authentication required — expected)",
                        endpoint_url
                    ),
                )
            } else if status == 200 || status == 500 {
                (
                    true,
                    format!("WinRM endpoint at {} responded with {}", endpoint_url, status),
                )
            } else {
                (
                    false,
                    format!(
                        "WinRM endpoint at {} responded with unexpected status {}",
                        endpoint_url, status
                    ),
                )
            };

            DiagnosticCheck {
                name: "WinRM Endpoint".to_string(),
                passed,
                message: msg,
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: "WinRM Endpoint".to_string(),
                passed: false,
                message: format!("Failed to reach WinRM endpoint at {}: {}", endpoint_url, e),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
    }
}

async fn test_wsman_identify(config: &PsRemotingConfig) -> DiagnosticCheck {
    let start = std::time::Instant::now();
    let endpoint_url = config.endpoint_uri();

    let identify_body = r#"<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Header/>
  <s:Body>
    <wsmid:Identify/>
  </s:Body>
</s:Envelope>"#;

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.skip_ca_check)
        .timeout(std::time::Duration::from_secs(10))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => {
            return DiagnosticCheck {
                name: "WS-Man Identify".to_string(),
                passed: false,
                message: format!("Failed to create HTTP client: {}", e),
                severity: DiagnosticSeverity::Warning,
                duration_ms: Some(start.elapsed().as_millis() as u64),
            };
        }
    };

    match client
        .post(&endpoint_url)
        .header("Content-Type", "application/soap+xml;charset=UTF-8")
        .body(identify_body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            let elapsed = start.elapsed().as_millis() as u64;

            let passed = body.contains("IdentifyResponse")
                || body.contains("ProductVersion")
                || status == 401; // Auth required but endpoint is there

            let msg = if body.contains("ProductVersion") {
                // Parse product version
                let version = extract_xml_value(&body, "ProductVersion")
                    .unwrap_or_else(|| "unknown".to_string());
                format!(
                    "WS-Man identify succeeded. Product version: {}",
                    version
                )
            } else if status == 401 {
                "WS-Man endpoint responded (authentication required)".to_string()
            } else {
                format!("WS-Man identify response: HTTP {}", status)
            };

            DiagnosticCheck {
                name: "WS-Man Identify".to_string(),
                passed,
                message: msg,
                severity: DiagnosticSeverity::Warning,
                duration_ms: Some(elapsed),
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: "WS-Man Identify".to_string(),
                passed: false,
                message: format!("WS-Man identify failed: {}", e),
                severity: DiagnosticSeverity::Warning,
                duration_ms: Some(elapsed),
            }
        }
    }
}

async fn test_tls_certificate(config: &PsRemotingConfig) -> DiagnosticCheck {
    let start = std::time::Instant::now();
    let endpoint_url = config.endpoint_uri();

    // Try connecting with strict certificate validation
    let strict_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();

    match strict_client {
        Ok(client) => match client.get(&endpoint_url).send().await {
            Ok(_) => {
                let elapsed = start.elapsed().as_millis() as u64;
                DiagnosticCheck {
                    name: "TLS Certificate".to_string(),
                    passed: true,
                    message: format!("TLS certificate for {} is valid and trusted", config.computer_name),
                    severity: DiagnosticSeverity::Warning,
                    duration_ms: Some(elapsed),
                }
            }
            Err(e) => {
                let elapsed = start.elapsed().as_millis() as u64;
                let is_cert_error = e.to_string().to_lowercase().contains("certificate")
                    || e.to_string().to_lowercase().contains("ssl")
                    || e.to_string().to_lowercase().contains("tls");

                DiagnosticCheck {
                    name: "TLS Certificate".to_string(),
                    passed: !is_cert_error,
                    message: if is_cert_error {
                        format!(
                            "TLS certificate validation failed: {}. Consider using skip_ca_check or installing the CA certificate.",
                            e
                        )
                    } else {
                        format!("TLS connection issue: {}", e)
                    },
                    severity: DiagnosticSeverity::Warning,
                    duration_ms: Some(elapsed),
                }
            }
        },
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: "TLS Certificate".to_string(),
                passed: false,
                message: format!("Failed to create strict TLS client: {}", e),
                severity: DiagnosticSeverity::Warning,
                duration_ms: Some(elapsed),
            }
        }
    }
}

async fn test_authentication(config: &PsRemotingConfig) -> DiagnosticCheck {
    let start = std::time::Instant::now();

    // Attempt to create a WinRM transport and authenticate
    let mut transport = match WinRmTransport::new(config) {
        Ok(t) => t,
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            return DiagnosticCheck {
                name: "Authentication".to_string(),
                passed: false,
                message: format!("Failed to create transport: {}", e),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            };
        }
    };

    match transport.send_message("").await {
        Ok(_) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: "Authentication".to_string(),
                passed: true,
                message: format!(
                    "Authentication succeeded using {:?}",
                    config.auth_method
                ),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            DiagnosticCheck {
                name: "Authentication".to_string(),
                passed: false,
                message: format!(
                    "Authentication failed using {:?}: {}",
                    config.auth_method, e
                ),
                severity: DiagnosticSeverity::Critical,
                duration_ms: Some(elapsed),
            }
        }
    }
}

// ─── Parsing Helpers ─────────────────────────────────────────────────

fn extract_xml_value(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}", tag);
    let end_tag = format!("</{}", tag);

    if let Some(start_idx) = xml.find(&start_tag) {
        // Find the closing > of the start tag
        if let Some(gt_idx) = xml[start_idx..].find('>') {
            let content_start = start_idx + gt_idx + 1;
            if let Some(end_idx) = xml[content_start..].find(&end_tag) {
                return Some(xml[content_start..content_start + end_idx].to_string());
            }
        }
    }
    None
}

fn parse_winrm_service_status(json_str: &str) -> Result<WinRmServiceStatus, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Err("Empty response from WinRM service check".to_string());
    }

    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse WinRM status: {}", e))?;

    let config = value
        .get("Config")
        .ok_or("Missing 'Config' in response")?;

    let listeners_val = value.get("Listeners");
    let mut listeners = Vec::new();

    if let Some(serde_json::Value::Array(arr)) = listeners_val {
        for item in arr {
            listeners.push(ListenerInfo {
                address: item.get("Address").and_then(|v| v.as_str()).map(String::from),
                transport: item.get("Transport").and_then(|v| v.as_str()).map(String::from),
                port: item.get("Port").and_then(|v| v.as_str()).map(String::from),
                hostname: item.get("Hostname").and_then(|v| v.as_str()).map(String::from),
                enabled: item.get("Enabled").and_then(|v| v.as_str()).map(String::from),
                certificate_thumbprint: item
                    .get("CertificateThumbprint")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            });
        }
    } else if let Some(item @ serde_json::Value::Object(_)) = listeners_val {
        listeners.push(ListenerInfo {
            address: item.get("Address").and_then(|v| v.as_str()).map(String::from),
            transport: item.get("Transport").and_then(|v| v.as_str()).map(String::from),
            port: item.get("Port").and_then(|v| v.as_str()).map(String::from),
            hostname: item.get("Hostname").and_then(|v| v.as_str()).map(String::from),
            enabled: item.get("Enabled").and_then(|v| v.as_str()).map(String::from),
            certificate_thumbprint: item
                .get("CertificateThumbprint")
                .and_then(|v| v.as_str())
                .map(String::from),
        });
    }

    Ok(WinRmServiceStatus {
        service_status: config
            .get("ServiceStatus")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        start_type: config
            .get("StartType")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        max_envelope_size_kb: config
            .get("MaxEnvelopeSizekb")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_timeout_ms: config
            .get("MaxTimeoutms")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_batch_items: config
            .get("MaxBatchItems")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_concurrent_users: config
            .get("MaxConcurrentUsers")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_concurrent_operations_per_user: config
            .get("MaxConcurrentOperationsPerUser")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_connections: config
            .get("MaxConnections")
            .and_then(|v| v.as_str())
            .map(String::from),
        allow_unencrypted: config
            .get("AllowUnencrypted")
            .and_then(|v| v.as_str())
            .map(String::from),
        auth_basic: config
            .get("AuthBasic")
            .and_then(|v| v.as_str())
            .map(String::from),
        auth_kerberos: config
            .get("AuthKerberos")
            .and_then(|v| v.as_str())
            .map(String::from),
        auth_negotiate: config
            .get("AuthNegotiate")
            .and_then(|v| v.as_str())
            .map(String::from),
        auth_certificate: config
            .get("AuthCertificate")
            .and_then(|v| v.as_str())
            .map(String::from),
        auth_credss_p: config
            .get("AuthCredSSP")
            .and_then(|v| v.as_str())
            .map(String::from),
        idle_timeout: config
            .get("IdleTimeout")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_processes_per_shell: config
            .get("MaxProcessesPerShell")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_memory_per_shell_mb: config
            .get("MaxMemoryPerShellMB")
            .and_then(|v| v.as_str())
            .map(String::from),
        max_shells_per_user: config
            .get("MaxShellsPerUser")
            .and_then(|v| v.as_str())
            .map(String::from),
        listeners,
    })
}

fn parse_firewall_rules(json_str: &str) -> Result<Vec<FirewallRuleInfo>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse firewall rules: {}", e))?;

    let items = match &value {
        serde_json::Value::Array(arr) => arr.clone(),
        obj @ serde_json::Value::Object(_) => vec![obj.clone()],
        _ => return Ok(Vec::new()),
    };

    let mut rules = Vec::new();
    for item in items {
        if let serde_json::Value::Object(map) = &item {
            rules.push(FirewallRuleInfo {
                name: map
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                display_name: map
                    .get("DisplayName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                enabled: map
                    .get("Enabled")
                    .and_then(|v| v.as_str())
                    .unwrap_or("False")
                    .to_string(),
                direction: map
                    .get("Direction")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                action: map
                    .get("Action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                profile: map
                    .get("Profile")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                protocol: map
                    .get("Protocol")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                local_port: map
                    .get("LocalPort")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            });
        }
    }

    Ok(rules)
}

fn parse_certificate_info(json_str: &str) -> Result<Vec<PsCertificateInfo>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse certificate info: {}", e))?;

    let items = match &value {
        serde_json::Value::Array(arr) => arr.clone(),
        obj @ serde_json::Value::Object(_) => vec![obj.clone()],
        _ => return Ok(Vec::new()),
    };

    let mut certs = Vec::new();
    for item in items {
        if let serde_json::Value::Object(map) = &item {
            let dns_names: Vec<String> = map
                .get("DnsNameList")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            certs.push(PsCertificateInfo {
                subject: map
                    .get("Subject")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                issuer: map
                    .get("Issuer")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                thumbprint: map
                    .get("Thumbprint")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                not_before: map
                    .get("NotBefore")
                    .and_then(|v| v.as_str())
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(chrono::Utc::now),
                not_after: map
                    .get("NotAfter")
                    .and_then(|v| v.as_str())
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(chrono::Utc::now),
                dns_name_list: dns_names,
                has_private_key: map
                    .get("HasPrivateKey")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                serial_number: map
                    .get("SerialNumber")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                signature_algorithm: map
                    .get("SignatureAlgorithm")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                key_usage: map
                    .get("KeyUsage")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                is_self_signed: map
                    .get("Subject")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    == map.get("Issuer").and_then(|v| v.as_str()).unwrap_or(""),
                key_size: map
                    .get("PublicKey")
                    .and_then(|v| v.get("Key"))
                    .and_then(|v| v.get("KeySize"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32,
            });
        }
    }

    Ok(certs)
}
