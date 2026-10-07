//! Credential-free diagnostics. No session creation, protocol writes, auth or input.
//! Routed paths fail closed until VNC has a verified route-aware transport API.

use serde::{Deserialize, Serialize};
use std::{io, net::IpAddr, time::Duration};
use tokio::{
    io::AsyncReadExt,
    net::TcpStream,
    sync::Semaphore,
    time::{timeout_at, Instant},
};

static DIAGNOSTIC_SLOTS: Semaphore = Semaphore::const_new(2);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VncDiagnosticRequest {
    pub host: String,
    pub port: u16,
    pub route: DiagnosticRoute,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticRoute {
    Direct,
    Blocked,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncDiagnosticStep {
    stage: &'static str,
    status: &'static str,
    code: &'static str,
    duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncDiagnosticReport {
    code: &'static str,
    steps: Vec<VncDiagnosticStep>,
    resolved_addresses: Vec<String>,
    protocol_version: Option<String>,
    duration_ms: u64,
}

impl VncDiagnosticReport {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            steps: vec![],
            resolved_addresses: vec![],
            protocol_version: None,
            duration_ms: 0,
        }
    }
    fn step(&mut self, stage: &'static str, code: &'static str, start: Instant) {
        self.steps.push(VncDiagnosticStep {
            stage,
            status: if code == "ready" { "passed" } else { "failed" },
            code,
            duration_ms: start.elapsed().as_millis() as u64,
        });
    }
    fn finish(mut self, code: &'static str, start: Instant) -> Self {
        self.code = code;
        self.duration_ms = start.elapsed().as_millis() as u64;
        for stage in ["dns", "tcp", "rfb"] {
            if !self.steps.iter().any(|step| step.stage == stage) {
                self.steps.push(VncDiagnosticStep {
                    stage,
                    status: "skipped",
                    code,
                    duration_ms: 0,
                });
            }
        }
        self
    }
}

fn io_code(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::ConnectionRefused => "refused",
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => "timeout",
        io::ErrorKind::ConnectionReset
        | io::ErrorKind::UnexpectedEof
        | io::ErrorKind::ConnectionAborted => "closed",
        io::ErrorKind::NetworkUnreachable | io::ErrorKind::HostUnreachable => "unreachable",
        _ => "unknown",
    }
}

fn target_host(request: &VncDiagnosticRequest) -> Option<&str> {
    let host = request.host.as_str();
    if request.port == 0 || host.is_empty() || host.len() > 253 {
        return None;
    }
    if host.starts_with('[') && host.ends_with(']') {
        let inner = &host[1..host.len() - 1];
        return inner.parse::<std::net::Ipv6Addr>().ok().map(|_| inner);
    }
    if host.parse::<IpAddr>().is_ok() {
        return Some(host);
    }
    if host
        .strip_suffix('.')
        .unwrap_or(host)
        .split('.')
        .all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        Some(host)
    } else {
        None
    }
}

fn rfb_version(bytes: &[u8; 12]) -> Option<String> {
    if &bytes[..4] != b"RFB "
        || bytes[7] != b'.'
        || bytes[11] != b'\n'
        || !bytes[4..7]
            .iter()
            .chain(bytes[8..11].iter())
            .all(u8::is_ascii_digit)
    {
        return None;
    }
    // Match the engine's RFB 3.x negotiation range; an unfamiliar service is not success.
    super::types::RfbVersion::from_version_string(std::str::from_utf8(bytes).ok()?)?;
    Some(String::from_utf8_lossy(&bytes[4..11]).into_owned())
}

/// Total budget: DNS 3s, all TCP attempts 5s, greeting 2s. At most four addresses.
/// Requires explicit invocation. This command accepts no credential/config fields.
#[tauri::command]
pub async fn diagnose_vnc(request: VncDiagnosticRequest) -> VncDiagnosticReport {
    let start = Instant::now();
    let report = VncDiagnosticReport::new("unknown");
    if request.route != DiagnosticRoute::Direct {
        return report.finish("routeBlocked", start);
    }
    let Some(host) = target_host(&request) else {
        return report.finish("invalidTarget", start);
    };
    let Ok(_permit) = DIAGNOSTIC_SLOTS.try_acquire() else {
        return report.finish("busy", start);
    };
    probe(
        host,
        request.port,
        Duration::from_secs(3),
        Duration::from_secs(5),
        Duration::from_secs(2),
    )
    .await
}

async fn probe(
    host: &str,
    port: u16,
    dns_budget: Duration,
    tcp_budget: Duration,
    rfb_budget: Duration,
) -> VncDiagnosticReport {
    let start = Instant::now();
    let mut report = VncDiagnosticReport::new("unknown");
    let addresses =
        match timeout_at(start + dns_budget, tokio::net::lookup_host((host, port))).await {
            Ok(Ok(addresses)) => addresses.take(4).collect::<Vec<_>>(),
            result => {
                let code = if result.is_err() { "timeout" } else { "dns" };
                report.step("dns", code, start);
                return report.finish(code, start);
            }
        };
    if addresses.is_empty() {
        report.step("dns", "dns", start);
        return report.finish("dns", start);
    }
    report.resolved_addresses = addresses
        .iter()
        .map(|address| address.ip().to_string())
        .collect();
    report.step("dns", "ready", start);
    let tcp_start = Instant::now();
    let deadline = tcp_start + tcp_budget;
    let mut last_error = "unknown";
    let mut stream = None;
    for address in addresses {
        match timeout_at(deadline, TcpStream::connect(address)).await {
            Ok(Ok(connected)) => {
                stream = Some(connected);
                break;
            }
            Ok(Err(error)) => {
                last_error = io_code(&error);
            }
            Err(_) => {
                last_error = "timeout";
                break;
            }
        }
    }
    let Some(mut stream) = stream else {
        report.step("tcp", last_error, tcp_start);
        return report.finish(last_error, start);
    };
    report.step("tcp", "ready", tcp_start);
    let rfb_start = Instant::now();
    let mut banner = [0u8; 12];
    let code = match timeout_at(rfb_start + rfb_budget, stream.read_exact(&mut banner)).await {
        Ok(Ok(_)) => match rfb_version(&banner) {
            Some(version) => {
                report.protocol_version = Some(version);
                "ready"
            }
            None => "protocol",
        },
        Ok(Err(error)) => io_code(&error),
        Err(_) => "timeout",
    };
    report.step("rfb", code, rfb_start);
    report.finish(code, start)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::AsyncWriteExt, net::TcpListener};

    #[tokio::test]
    async fn blocked_route_does_not_resolve_or_connect() {
        let report = diagnose_vnc(VncDiagnosticRequest {
            host: "must-not-resolve.invalid".into(),
            port: 5900,
            route: DiagnosticRoute::Blocked,
        })
        .await;
        assert_eq!(report.code, "routeBlocked");
        assert!(report.steps.iter().all(|step| step.status == "skipped"));
        assert!(report.resolved_addresses.is_empty());
    }

    #[tokio::test]
    async fn rejects_credentials_and_invalid_target() {
        assert!(serde_json::from_str::<VncDiagnosticRequest>(
            r#"{"host":"localhost","port":5900,"route":"direct","password":"secret"}"#
        )
        .is_err());
        for host in [
            "vnc://user:secret@localhost",
            "host/path",
            "host\n",
            "[oops]",
            "",
        ] {
            let report = diagnose_vnc(VncDiagnosticRequest {
                host: host.into(),
                port: 5900,
                route: DiagnosticRoute::Direct,
            })
            .await;
            assert_eq!(report.code, "invalidTarget");
        }
    }

    #[test]
    fn classifies_refusal_and_rejects_non_rfb_banners() {
        assert_eq!(
            io_code(&io::Error::from(io::ErrorKind::ConnectionRefused)),
            "refused"
        );
        assert_eq!(rfb_version(b"RFB 003.008\n").as_deref(), Some("003.008"));
        assert_eq!(rfb_version(b"HTTP/1.1 200"), None);
        assert_eq!(rfb_version(b"RFB 999.999\n"), None);
        assert_eq!(rfb_version(b"RFB 003.889\n"), None);
    }

    #[tokio::test]
    async fn malformed_and_truncated_greetings_are_not_success() {
        for (banner, expected) in [(&b"HTTP/1.1 200"[..], "protocol"), (&b"RFB "[..], "closed")] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                socket.write_all(banner).await.unwrap();
            });
            let report = probe(
                "127.0.0.1",
                port,
                Duration::from_secs(1),
                Duration::from_secs(1),
                Duration::from_secs(1),
            )
            .await;
            assert_eq!(report.code, expected);
            assert!(report.protocol_version.is_none());
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn refused_socket_skips_rfb() {
        // Reserve a local port without listening; no production endpoint or DNS.
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let port = socket.local_addr().unwrap().port();
        let report = probe(
            "127.0.0.1",
            port,
            Duration::from_secs(1),
            // Windows may retransmit a loopback SYN before reporting refusal.
            Duration::from_secs(5),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(report.code, "refused");
        assert_eq!(report.steps[2].status, "skipped");
    }

    #[tokio::test]
    async fn greeting_probe_sends_no_bytes_and_handles_fragmentation() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            socket.write_all(b"RFB 003.").await.unwrap();
            tokio::task::yield_now().await;
            socket.write_all(b"008\n").await.unwrap();
            let mut data = [0; 1];
            assert_eq!(socket.read(&mut data).await.unwrap(), 0);
        });
        let report = probe(
            "127.0.0.1",
            port,
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(report.code, "ready");
        assert!(report.steps.iter().all(|step| step.status == "passed"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn silent_server_is_bounded() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut data = [0; 1];
            assert_eq!(socket.read(&mut data).await.unwrap(), 0);
        });
        let report = probe(
            "127.0.0.1",
            port,
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_millis(30),
        )
        .await;
        assert_eq!(report.code, "timeout");
        assert_eq!(report.steps[2].stage, "rfb");
        server.await.unwrap();
    }
}
