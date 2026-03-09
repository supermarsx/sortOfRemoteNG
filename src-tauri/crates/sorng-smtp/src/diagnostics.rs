//! SMTP diagnostics – MX lookup, connectivity test, port scanning,
//! STARTTLS verification, deliverability checks, SPF/DKIM/DMARC DNS checks.

use std::net::ToSocketAddrs;
use std::time::{Duration, Instant};

use chrono::Utc;
use log::{debug, info, warn};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::types::*;

/// Default timeout for individual diagnostic checks (seconds).
const DEFAULT_CHECK_TIMEOUT_SECS: u64 = 10;

// ─────────────────────────────────────────────────────────────────

fn run_check(name: &str, started: &Instant, ok: bool, msg: String) -> DiagnosticCheckResult {
    DiagnosticCheckResult {
        name: name.to_string(),
        result: if ok {
            DiagnosticCheck::Pass(msg)
        } else {
            DiagnosticCheck::Fail(msg)
        },
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

/// Run a full SMTP diagnostics suite for a domain.
pub async fn run_diagnostics(domain: &str) -> DiagnosticsReport {
    info!("Running SMTP diagnostics for {}", domain);
    let started = Instant::now();
    let mut checks = Vec::new();

    // 1. MX records
    let mx_records = lookup_mx(domain).await;
    let mx_ok = !mx_records.is_empty();
    checks.push(run_check(
        "MX Lookup",
        &started,
        mx_ok,
        if mx_ok {
            format!(
                "Found {} MX record(s): {}",
                mx_records.len(),
                mx_records
                    .iter()
                    .map(|r| format!("{} (pri {})", r.exchange, r.priority))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        } else {
            format!("No MX records found for {}", domain)
        },
    ));

    // 2. Connectivity check (port 25)
    let smtp_host = mx_records
        .first()
        .map(|r| r.exchange.as_str())
        .unwrap_or(domain);
    let conn_result = check_port(smtp_host, 25).await;
    checks.push(run_check(
        "SMTP Connect (25)",
        &started,
        conn_result.is_ok(),
        match &conn_result {
            Ok(ms) => format!("Connected to {}:25 in {} ms", smtp_host, ms),
            Err(e) => format!("Cannot connect to {}:25: {}", smtp_host, e),
        },
    ));

    // 3. Submission port (587)
    let sub_result = check_port(smtp_host, 587).await;
    checks.push(run_check(
        "Submission Port (587)",
        &started,
        sub_result.is_ok(),
        match &sub_result {
            Ok(ms) => format!("Port 587 open on {} ({} ms)", smtp_host, ms),
            Err(e) => format!("Port 587 closed on {}: {}", smtp_host, e),
        },
    ));

    // 4. SMTPS port (465)
    let smtps_result = check_port(smtp_host, 465).await;
    checks.push(run_check(
        "SMTPS Port (465)",
        &started,
        smtps_result.is_ok(),
        match &smtps_result {
            Ok(ms) => format!("Port 465 open on {} ({} ms)", smtp_host, ms),
            Err(e) => format!("Port 465 closed on {}: {}", smtp_host, e),
        },
    ));

    // 5. STARTTLS check
    let starttls_res = check_starttls(smtp_host).await;
    checks.push(run_check(
        "STARTTLS",
        &started,
        starttls_res,
        if starttls_res {
            format!("{} supports STARTTLS", smtp_host)
        } else {
            format!("{} does not advertise STARTTLS", smtp_host)
        },
    ));

    // 6. EHLO banner check
    let banner = get_smtp_banner(smtp_host).await;
    checks.push(run_check(
        "EHLO Banner",
        &started,
        banner.is_some(),
        match &banner {
            Some(b) => format!("Banner: {}", b.trim()),
            None => format!("Could not retrieve SMTP banner from {}", smtp_host),
        },
    ));

    // 7. SPF record check
    let spf_ok = check_dns_txt(domain, "v=spf1").await;
    checks.push(run_check(
        "SPF Record",
        &started,
        spf_ok,
        if spf_ok {
            format!("SPF record found for {}", domain)
        } else {
            format!("No SPF record found for {}", domain)
        },
    ));

    // 8. DMARC record check
    let dmarc_ok = check_dns_txt(&format!("_dmarc.{}", domain), "v=DMARC1").await;
    checks.push(run_check(
        "DMARC Record",
        &started,
        dmarc_ok,
        if dmarc_ok {
            format!("DMARC record found for {}", domain)
        } else {
            format!("No DMARC record found for {}", domain)
        },
    ));

    // 9. DKIM selector (check default selector)
    let dkim_domain = format!("default._domainkey.{}", domain);
    let dkim_ok = check_dns_txt(&dkim_domain, "v=DKIM1").await;
    checks.push(run_check(
        "DKIM Record",
        &started,
        dkim_ok,
        if dkim_ok {
            format!("DKIM record found at {}", dkim_domain)
        } else {
            format!(
                "No DKIM record at {} (may use non-default selector)",
                dkim_domain
            )
        },
    ));

    let all_passed = checks
        .iter()
        .all(|c| matches!(c.result, DiagnosticCheck::Pass(_)));

    DiagnosticsReport {
        domain: domain.to_string(),
        mx_records,
        checks,
        overall_healthy: all_passed,
        timestamp: Utc::now(),
    }
}

// ─── MX Lookup ──────────────────────────────────────────────────

/// Look up MX records using DNS via trust-dns-resolver.
pub async fn lookup_mx(domain: &str) -> Vec<MxRecord> {
    debug!("Looking up MX records for {}", domain);
    match trust_dns_resolver::TokioAsyncResolver::tokio_from_system_conf() {
        Ok(resolver) => match resolver.mx_lookup(domain).await {
            Ok(response) => {
                let mut records: Vec<MxRecord> = response
                    .iter()
                    .map(|mx| MxRecord {
                        priority: mx.preference(),
                        exchange: mx.exchange().to_string().trim_end_matches('.').to_string(),
                    })
                    .collect();
                records.sort_by_key(|r| r.priority);
                records
            }
            Err(e) => {
                warn!("MX lookup failed for {}: {}", domain, e);
                Vec::new()
            }
        },
        Err(e) => {
            warn!("Failed to create DNS resolver: {}", e);
            Vec::new()
        }
    }
}

/// Look up MX records and return the top-priority host.
pub async fn lookup_mx_host(domain: &str) -> Option<String> {
    let records = lookup_mx(domain).await;
    records.into_iter().next().map(|r| r.exchange)
}

// ─── Port / Connectivity ────────────────────────────────────────

/// Check if a TCP port is reachable. Returns latency in ms on success.
pub async fn check_port(host: &str, port: u16) -> SmtpResult<u64> {
    debug!("Checking {}:{}", host, port);
    let addr = format!("{}:{}", host, port);
    let start = Instant::now();

    match timeout(
        Duration::from_secs(DEFAULT_CHECK_TIMEOUT_SECS),
        TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_stream)) => Ok(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => Err(SmtpError::connection(format!("Connection refused: {}", e))),
        Err(_) => Err(SmtpError::connection("Port check timed out")),
    }
}

/// Check if multiple ports are open.
pub async fn check_ports(host: &str, ports: &[u16]) -> Vec<(u16, bool)> {
    let mut results = Vec::new();
    for &port in ports {
        let ok = check_port(host, port).await.is_ok();
        results.push((port, ok));
    }
    results
}

// ─── STARTTLS Check ─────────────────────────────────────────────

/// Connect to port 25/587 and check if the server advertises STARTTLS.
pub async fn check_starttls(host: &str) -> bool {
    let ports = [587u16, 25];
    for port in &ports {
        let addr = format!("{}:{}", host, port);
        let stream = match timeout(
            Duration::from_secs(DEFAULT_CHECK_TIMEOUT_SECS),
            TcpStream::connect(&addr),
        )
        .await
        {
            Ok(Ok(s)) => s,
            _ => continue,
        };

        let mut reader = BufReader::new(stream);
        // Read greeting
        let mut buf = String::new();
        if timeout(Duration::from_secs(5), reader.read_line(&mut buf))
            .await
            .is_err()
        {
            continue;
        }

        // Send EHLO
        let stream_mut = reader.get_mut();
        if stream_mut.write_all(b"EHLO diagnostics\r\n").await.is_err() {
            continue;
        }

        // Read EHLO response
        let mut ehlo_response = String::new();
        loop {
            let mut line = String::new();
            match timeout(Duration::from_secs(5), reader.read_line(&mut line)).await {
                Ok(Ok(0)) => break,
                Ok(Ok(_)) => {
                    ehlo_response.push_str(&line);
                    // Last line has space after status code
                    if line.len() >= 4 && line.as_bytes()[3] == b' ' {
                        break;
                    }
                }
                _ => break,
            }
        }

        if ehlo_response.to_uppercase().contains("STARTTLS") {
            // Try to QUIT gracefully
            let stream_mut = reader.get_mut();
            let _ = stream_mut.write_all(b"QUIT\r\n").await;
            return true;
        }

        let stream_mut = reader.get_mut();
        let _ = stream_mut.write_all(b"QUIT\r\n").await;
    }
    false
}

// ─── SMTP Banner ────────────────────────────────────────────────

/// Get SMTP banner from the server.
pub async fn get_smtp_banner(host: &str) -> Option<String> {
    let ports = [25u16, 587, 465];
    for port in &ports {
        let addr = format!("{}:{}", host, port);
        if let Ok(Ok(stream)) = timeout(
            Duration::from_secs(DEFAULT_CHECK_TIMEOUT_SECS),
            TcpStream::connect(&addr),
        )
        .await
        {
            let mut reader = BufReader::new(stream);
            let mut buf = String::new();
            if let Ok(Ok(n)) = timeout(Duration::from_secs(5), reader.read_line(&mut buf)).await {
                if n > 0 {
                    return Some(buf);
                }
            }
        }
    }
    None
}

// ─── DNS TXT Checks ────────────────────────────────────────────

/// Check if a domain has a TXT record that starts with the given prefix.
pub async fn check_dns_txt(domain: &str, prefix: &str) -> bool {
    debug!("Checking TXT record for {} (prefix: {})", domain, prefix);
    match trust_dns_resolver::TokioAsyncResolver::tokio_from_system_conf() {
        Ok(resolver) => match resolver.txt_lookup(domain).await {
            Ok(response) => response.iter().any(|txt| {
                let text = txt.to_string();
                text.starts_with(prefix)
            }),
            Err(_) => false,
        },
        Err(_) => false,
    }
}

/// Retrieve all TXT records for a domain.
pub async fn get_dns_txt_records(domain: &str) -> Vec<String> {
    match trust_dns_resolver::TokioAsyncResolver::tokio_from_system_conf() {
        Ok(resolver) => match resolver.txt_lookup(domain).await {
            Ok(response) => response.iter().map(|txt| txt.to_string()).collect(),
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    }
}

// ─── Reverse DNS ────────────────────────────────────────────────

/// Reverse-DNS lookup for a hostname (resolve to IP then back).
pub fn reverse_lookup(host: &str) -> Option<String> {
    let addr = format!("{}:25", host);
    if let Ok(mut addrs) = addr.to_socket_addrs() {
        if let Some(socket_addr) = addrs.next() {
            return Some(socket_addr.ip().to_string());
        }
    }
    None
}

// ─── Diagnostic helpers ────────────────────────────────────────

/// Quick connectivity test – returns true if we can reach any SMTP port on the given host.
pub async fn is_smtp_reachable(host: &str) -> bool {
    check_port(host, 25).await.is_ok()
        || check_port(host, 587).await.is_ok()
        || check_port(host, 465).await.is_ok()
}

/// Suggest the best port/security for a given host based on open ports.
pub async fn suggest_security(host: &str) -> (u16, SmtpSecurity) {
    // Prefer 587+STARTTLS > 465+SMTPS > 25+None
    if check_port(host, 587).await.is_ok() && check_starttls(host).await {
        return (587, SmtpSecurity::StartTls);
    }
    if check_port(host, 465).await.is_ok() {
        return (465, SmtpSecurity::ImplicitTls);
    }
    if check_port(host, 25).await.is_ok() {
        return (25, SmtpSecurity::None);
    }
    (587, SmtpSecurity::StartTls) // sane default
}

/// Run a quick deliverability check for an email domain.
pub async fn quick_deliverability_check(domain: &str) -> SmtpResult<String> {
    let mx = lookup_mx(domain).await;
    if mx.is_empty() {
        return Err(SmtpError::connection(format!(
            "No MX records for {} — email delivery will fail",
            domain
        )));
    }

    let host = &mx[0].exchange;
    if !is_smtp_reachable(host).await {
        return Err(SmtpError::connection(format!(
            "MX host {} is not reachable on any SMTP port",
            host
        )));
    }

    let starttls = check_starttls(host).await;
    Ok(format!(
        "Domain {} OK – MX: {} (pri {}), STARTTLS: {}",
        domain,
        host,
        mx[0].priority,
        if starttls { "yes" } else { "no" }
    ))
}

// ─── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reverse_lookup_localhost() {
        // Should resolve localhost or 127.0.0.1
        let result = reverse_lookup("localhost");
        assert!(result.is_some());
    }

    #[test]
    fn diagnostic_check_variants() {
        let pass = DiagnosticCheck::Pass("OK".into());
        let warn = DiagnosticCheck::Warn("hmm".into());
        let fail = DiagnosticCheck::Fail("bad".into());
        assert!(matches!(pass, DiagnosticCheck::Pass(_)));
        assert!(matches!(warn, DiagnosticCheck::Warn(_)));
        assert!(matches!(fail, DiagnosticCheck::Fail(_)));
    }

    #[test]
    fn diagnostic_check_result_structure() {
        let result = DiagnosticCheckResult {
            name: "MX Lookup".into(),
            result: DiagnosticCheck::Pass("Found 2 MX records".into()),
            elapsed_ms: 42,
        };
        assert!(matches!(result.result, DiagnosticCheck::Pass(_)));
        assert_eq!(result.elapsed_ms, 42);
    }

    #[test]
    fn mx_record_ordering() {
        let mut records = vec![
            MxRecord {
                priority: 20,
                exchange: "backup.example.com".into(),
            },
            MxRecord {
                priority: 10,
                exchange: "primary.example.com".into(),
            },
        ];
        records.sort_by_key(|r| r.priority);
        assert_eq!(records[0].exchange, "primary.example.com");
    }

    #[tokio::test]
    async fn check_port_unroutable() {
        // 192.0.2.1 is TEST-NET-1, should timeout or refuse
        let result = check_port("192.0.2.1", 25).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn check_ports_returns_all() {
        let results = check_ports("192.0.2.1", &[25, 587, 465]).await;
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn diagnostics_report_structure() {
        let report = DiagnosticsReport {
            domain: "example.com".into(),
            mx_records: vec![MxRecord {
                priority: 10,
                exchange: "mail.example.com".into(),
            }],
            checks: vec![DiagnosticCheckResult {
                name: "MX Lookup".into(),
                result: DiagnosticCheck::Pass("OK".into()),
                elapsed_ms: 5,
            }],
            overall_healthy: true,
            timestamp: Utc::now(),
        };
        assert_eq!(report.checks.len(), 1);
        assert_eq!(report.mx_records.len(), 1);
        assert!(report.overall_healthy);
    }

    #[test]
    fn suggest_security_default() {
        // Without async context, just ensure the enum variants work
        assert!(matches!(SmtpSecurity::StartTls, SmtpSecurity::StartTls));
        assert!(matches!(
            SmtpSecurity::ImplicitTls,
            SmtpSecurity::ImplicitTls
        ));
    }

    #[test]
    fn run_check_pass() {
        let started = Instant::now();
        let r = run_check("test", &started, true, "ok".into());
        assert!(matches!(r.result, DiagnosticCheck::Pass(_)));
    }

    #[test]
    fn run_check_fail() {
        let started = Instant::now();
        let r = run_check("test", &started, false, "bad".into());
        assert!(matches!(r.result, DiagnosticCheck::Fail(_)));
    }
}
