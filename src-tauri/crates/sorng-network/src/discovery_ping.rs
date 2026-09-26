//! Single-host discovery reachability with literal IPs and a bounded deadline.

use serde::Serialize;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::process::Stdio;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::process::Command;
use tokio::time::{timeout_at, Instant};

#[derive(Debug, Serialize)]
pub struct DiscoveryProbeResult {
    pub reachable: bool,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

fn bounded_timeout(timeout_ms: u64) -> Duration {
    Duration::from_millis(timeout_ms.clamp(100, 30_000))
}

fn ping_command(ip: IpAddr, timeout: Duration) -> Command {
    // BSD/macOS use a separate executable for IPv6; Linux uses ping -6.
    #[cfg(any(
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    let program = if ip.is_ipv6() { "ping6" } else { "ping" };
    #[cfg(not(any(
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    )))]
    let program = "ping";
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        command.args(["-n", "1", "-w", &timeout.as_millis().to_string()]);
        // CREATE_NO_WINDOW: discovery must not flash a console window.
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = timeout; // Unix timeout flags differ; the outer deadline is authoritative.
        command.args(["-n", "-c", "1"]);
        #[cfg(not(any(
            target_os = "macos",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        )))]
        if ip.is_ipv6() {
            command.arg("-6");
        }
    }
    // Only a parsed, canonical IP reaches argv. No shell or hostname lookup.
    command
        .arg(ip.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    command
}

async fn finish_probe(
    start: Instant,
    timeout: Duration,
    probe: impl Future<Output = Result<(), String>>,
) -> DiscoveryProbeResult {
    let result = match timeout_at(start + timeout, probe).await {
        Ok(result) => result,
        Err(_) => Err(format!("Probe timed out after {} ms", timeout.as_millis())),
    };
    DiscoveryProbeResult {
        reachable: result.is_ok(),
        elapsed_ms: start.elapsed().as_millis().min(u64::MAX as u128) as u64,
        error: result.err(),
    }
}

/// `port` is required for TCP (the frontend supplies its default of 443).
/// Validation and reachability failures are returned in the same response shape.
pub async fn probe_discovery_host(
    host: String,
    method: String,
    timeout_ms: u64,
    port: Option<u16>,
) -> DiscoveryProbeResult {
    let start = Instant::now();
    let timeout = bounded_timeout(timeout_ms);
    finish_probe(start, timeout, async move {
        let ip: IpAddr = host
            .parse()
            .map_err(|_| "Host must be an IPv4 or IPv6 literal".to_string())?;
        match method.as_str() {
            "icmp" => {
                let status = ping_command(ip, timeout)
                    .status()
                    .await
                    .map_err(|error| format!("Could not run ping: {error}"))?;
                if status.success() {
                    Ok(())
                } else {
                    Err(format!("Ping failed: {status}"))
                }
            }
            "tcp" => {
                let port = port
                    .filter(|port| *port != 0)
                    .ok_or_else(|| "TCP port must be between 1 and 65535".to_string())?;
                TcpStream::connect(SocketAddr::new(ip, port))
                    .await
                    .map(|_| ())
                    .map_err(|error| format!("TCP connection failed: {error}"))
            }
            _ => Err("Method must be icmp or tcp".to_string()),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_is_clamped_without_overflow() {
        for (input, expected) in [
            (0, 100),
            (99, 100),
            (100, 100),
            (1234, 1234),
            (30_000, 30_000),
            (u64::MAX, 30_000),
        ] {
            assert_eq!(bounded_timeout(input).as_millis(), expected);
        }
    }

    #[test]
    fn ping_arguments_are_numeric_single_packet_and_canonical() {
        for host in ["127.0.0.1", "2001:0db8::1"] {
            let ip: IpAddr = host.parse().unwrap();
            let command = ping_command(ip, Duration::from_millis(1234));
            let args: Vec<_> = command
                .as_std()
                .get_args()
                .map(|arg| arg.to_str().unwrap().to_string())
                .collect();
            assert_eq!(args.last().unwrap(), &ip.to_string());
            #[cfg(windows)]
            assert_eq!(&args[..4], &["-n", "1", "-w", "1234"]);
            #[cfg(not(windows))]
            assert_eq!(&args[..3], &["-n", "-c", "1"]);
        }
    }

    #[tokio::test]
    async fn rejects_hostnames_options_and_shell_input_before_io() {
        for host in [
            "localhost",
            "example.com",
            "-n",
            "127.0.0.1 & calc",
            "127.0.0.1\n",
            "[::1]",
            "",
            "fe80::1%eth0",
        ] {
            for method in ["icmp", "tcp"] {
                let result = probe_discovery_host(host.into(), method.into(), 100, Some(443)).await;
                assert!(!result.reachable);
                assert_eq!(
                    result.error.as_deref(),
                    Some("Host must be an IPv4 or IPv6 literal")
                );
            }
        }
    }

    #[tokio::test]
    async fn rejects_unknown_methods_and_missing_or_zero_tcp_port() {
        for method in ["", "udp", "ICMP", "tcp "] {
            let result = probe_discovery_host("::1".into(), method.into(), 100, Some(443)).await;
            assert_eq!(result.error.as_deref(), Some("Method must be icmp or tcp"));
        }
        for port in [None, Some(0)] {
            let result = probe_discovery_host("127.0.0.1".into(), "tcp".into(), 100, port).await;
            assert!(!result.reachable);
            assert_eq!(
                result.error.as_deref(),
                Some("TCP port must be between 1 and 65535")
            );
        }
    }

    #[tokio::test]
    async fn tcp_reaches_loopback_listener_and_serializes_contract() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let result = probe_discovery_host(
            "127.0.0.1".into(),
            "tcp".into(),
            1000,
            Some(listener.local_addr().unwrap().port()),
        )
        .await;
        assert!(result.reachable, "{:?}", result.error);
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["reachable"], true);
        assert!(value["elapsed_ms"].is_u64());
        assert!(value["error"].is_null());
        assert_eq!(value.as_object().unwrap().len(), 3);
    }

    #[tokio::test]
    #[cfg(windows)]
    async fn icmp_reaches_windows_loopback() {
        let result = probe_discovery_host("127.0.0.1".into(), "icmp".into(), 2000, None).await;
        assert!(result.reachable, "{:?}", result.error);
        assert!(result.error.is_none());
    }

    #[tokio::test]
    async fn tcp_closed_loopback_port_is_unreachable() {
        // Keep the port reserved without listening, so another process cannot take it.
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let result = probe_discovery_host(
            "127.0.0.1".into(),
            "tcp".into(),
            100,
            Some(socket.local_addr().unwrap().port()),
        )
        .await;
        assert!(!result.reachable);
        assert!(result.error.is_some());
    }

    #[tokio::test]
    async fn deadline_cancels_and_drops_pending_probe() {
        let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
        let result = finish_probe(Instant::now(), Duration::from_millis(100), async move {
            let _sender = sender;
            std::future::pending::<Result<(), String>>().await
        })
        .await;
        assert!(!result.reachable);
        assert_eq!(
            result.error.as_deref(),
            Some("Probe timed out after 100 ms")
        );
        assert!(
            receiver.await.is_err(),
            "deadline must drop the probe future"
        );
        assert!(result.elapsed_ms < 2000);
    }
}
