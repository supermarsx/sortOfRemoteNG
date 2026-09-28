//! Literal-IP discovery with sequential composite probes and one total budget.
use serde::Serialize;
use std::future::Future;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::net::{TcpStream, UdpSocket};
use tokio::time::{timeout_at, Instant};

#[path = "discovery_ping_platform.rs"]
mod platform;
pub use platform::get_discovery_probe_capabilities;

const SINGLES: [&str; 7] = ["icmp", "icmp4", "icmp6", "icmp-native", "arp", "tcp", "udp"];
const RESPONSIVE: &str = "responsive";
const UNRESPONSIVE: &str = "unresponsive";
const UNAVAILABLE: &str = "unavailable";

#[derive(Debug, Serialize)]
pub struct DiscoveryProbeResult {
    pub reachable: bool,
    pub elapsed_ms: u64,
    pub error: Option<String>,
    pub status: String,
    pub attempts: Vec<DiscoveryProbeAttempt>,
    pub mac_address: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DiscoveryProbeAttempt {
    pub method: String,
    pub status: String,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryProbeCapabilities {
    pub platform: String,
    pub methods: Vec<DiscoveryProbeCapability>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryProbeCapability {
    pub id: String,
    pub available: bool,
    pub description: String,
}

#[derive(Debug)]
struct Outcome {
    status: &'static str,
    error: Option<String>,
    mac: Option<String>,
}
impl Outcome {
    fn responsive() -> Self {
        Self {
            status: RESPONSIVE,
            error: None,
            mac: None,
        }
    }
    fn unavailable(error: impl Into<String>) -> Self {
        Self {
            status: UNAVAILABLE,
            error: Some(error.into()),
            mac: None,
        }
    }
    fn unresponsive(error: impl Into<String>) -> Self {
        Self {
            status: UNRESPONSIVE,
            error: Some(error.into()),
            mac: None,
        }
    }
}

fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis().min(u64::MAX as u128) as u64
}
fn bounded_timeout(timeout_ms: u64) -> Duration {
    Duration::from_millis(timeout_ms.clamp(100, 30_000))
}

fn validate_methods(
    method: &str,
    methods: Option<Vec<String>>,
    port: Option<u16>,
    udp_port: Option<u16>,
) -> Result<Vec<String>, String> {
    let composite = matches!(method, "adaptive" | "combined");
    if !composite && !SINGLES.contains(&method) {
        return Err("Unknown discovery probe method".into());
    }
    if !composite && methods.is_some() {
        return Err("Custom methods are only valid for adaptive or combined probes".into());
    }
    let selected = if composite {
        methods.unwrap_or_else(|| ["arp", "icmp", "tcp"].map(String::from).to_vec())
    } else {
        vec![method.to_string()]
    };
    if selected.is_empty() || selected.len() > SINGLES.len() {
        return Err("Select between 1 and 7 unique single probe methods".into());
    }
    for (index, value) in selected.iter().enumerate() {
        if !SINGLES.contains(&value.as_str()) || selected[..index].contains(value) {
            return Err("Select between 1 and 7 unique single probe methods".into());
        }
    }
    if selected.iter().any(|method| method == "tcp") && port.filter(|p| *p != 0).is_none() {
        return Err("TCP port must be between 1 and 65535".into());
    }
    if selected.iter().any(|method| method == "udp") && udp_port.filter(|p| *p != 0).is_none() {
        return Err("UDP port must be between 1 and 65535".into());
    }
    Ok(selected)
}

fn family_unavailable(method: &str, ip: IpAddr) -> Option<&'static str> {
    match method {
        "icmp4" if !ip.is_ipv4() => Some("icmp4 requires an IPv4 literal"),
        "icmp6" if !ip.is_ipv6() => Some("icmp6 requires an IPv6 literal"),
        "arp" if !ip.is_ipv4() => Some("ARP requires IPv4; IPv6 uses neighbor discovery"),
        "icmp-native" if !cfg!(windows) => Some("Native ICMP is only available on Windows"),
        "icmp-native" if !ip.is_ipv4() => Some("Native ICMP requires IPv4"),
        _ => None,
    }
}

// Keep unsupported choices in the audit, but prefer methods suitable for this
// platform/family/link. Stable sorting preserves ties in the caller's selection.
fn adaptive_order(selected: &mut [String], ip: IpAddr, direct_link: bool) {
    selected.sort_by_key(|method| {
        if family_unavailable(method, ip).is_some() || (method == "arp" && !direct_link) {
            return 10;
        }
        match method.as_str() {
            "arp" => 0,
            "icmp-native" => 1,
            "icmp4" | "icmp6" => 2,
            "icmp" => 3,
            "tcp" => 4,
            "udp" => 5,
            _ => 10,
        }
    });
}

/// Compatibility wrapper. A refused TCP connection proves host responsiveness,
/// not that the selected port is open.
pub async fn probe_discovery_host(
    host: String,
    method: String,
    timeout_ms: u64,
    port: Option<u16>,
) -> DiscoveryProbeResult {
    probe_discovery_host_with_options(host, method, timeout_ms, port, None, None).await
}

/// All inputs are validated before I/O. Composite defaults: ARP, ICMP, TCP.
/// Nonzero TCP/UDP ports are required when those transports are selected.
///
/// Windows synchronous native probes are drained BEFORE returning a timeout.
/// Thus OS completion may exceed the budget, but a caller retaining its permit
/// until this response cannot start another probe while SendARP still runs.
/// Later methods do not start after the total deadline. Explicit cancellation
/// of the whole Rust future cannot cancel an OS call; native worker permits
/// still remain held inside the worker until it exits.
pub async fn probe_discovery_host_with_options(
    host: String,
    method: String,
    timeout_ms: u64,
    port: Option<u16>,
    methods: Option<Vec<String>>,
    udp_port: Option<u16>,
) -> DiscoveryProbeResult {
    let start = Instant::now();
    let budget = bounded_timeout(timeout_ms);
    let validated = host
        .parse::<IpAddr>()
        .map_err(|_| "Host must be an IPv4 or IPv6 literal".to_string())
        .and_then(|ip| {
            validate_methods(&method, methods, port, udp_port).map(|selected| (ip, selected))
        });
    let (ip, mut selected) = match validated {
        Ok(value) => value,
        Err(error) => {
            return DiscoveryProbeResult {
                reachable: false,
                elapsed_ms: elapsed_ms(start),
                error: Some(error),
                status: UNAVAILABLE.into(),
                attempts: vec![],
                mac_address: None,
            }
        }
    };
    // Limit local metadata/dialect preparation to one fair share of the budget.
    let arp = if selected.iter().any(|m| m == "arp") && ip.is_ipv4() {
        Some(platform::prepare_arp(ip, start + budget / (selected.len() as u32 + 1)).await)
    } else {
        None
    };
    if method == "adaptive" {
        adaptive_order(&mut selected, ip, matches!(&arp, Some(Ok(_))));
    }
    run_sequence(
        start,
        budget,
        &selected,
        method == "adaptive",
        |method, slice| {
            let arp = &arp;
            async move {
                if let Some(reason) = family_unavailable(&method, ip) {
                    return Outcome::unavailable(reason);
                }
                match method.as_str() {
                    "icmp" | "icmp4" | "icmp6" => platform::system_ping(ip, slice).await,
                    "icmp-native" => platform::native_ping(ip, slice).await,
                    "arp" => match arp {
                        Some(Ok(context)) => platform::arp(ip, context, slice).await,
                        Some(Err(error)) => Outcome::unavailable(error.clone()),
                        None => Outcome::unavailable("ARP has no suitable direct-link interface"),
                    },
                    "tcp" => tcp(ip, port.expect("validated TCP port")).await,
                    "udp" => udp(ip, udp_port.expect("validated UDP port")).await,
                    _ => Outcome::unavailable("Unknown discovery probe method"),
                }
            }
        },
    )
    .await
}

async fn run_sequence<F, Fut>(
    start: Instant,
    budget: Duration,
    selected: &[String],
    adaptive: bool,
    mut probe: F,
) -> DiscoveryProbeResult
where
    F: FnMut(String, Duration) -> Fut,
    Fut: Future<Output = Outcome>,
{
    let deadline = start + budget;
    let mut attempts = Vec::with_capacity(selected.len());
    let mut mac_address = None;
    for (index, method) in selected.iter().enumerate() {
        let attempt_start = Instant::now();
        let slice =
            deadline.saturating_duration_since(attempt_start) / (selected.len() - index) as u32;
        let outcome = if slice.is_zero() {
            Outcome::unavailable("Total probe deadline exhausted before this method could start")
        } else if cfg!(windows) && matches!(method.as_str(), "arp" | "icmp-native") {
            // These implementations enforce their deadline and then drain. An
            // outer timeout would detach SendARP and break the frontend cap.
            probe(method.clone(), slice).await
        } else {
            match timeout_at(attempt_start + slice, probe(method.clone(), slice)).await {
                Ok(outcome) => outcome,
                Err(_) => {
                    Outcome::unresponsive(format!("Probe timed out after {} ms", slice.as_millis()))
                }
            }
        };
        let responsive = outcome.status == RESPONSIVE;
        mac_address = mac_address.or(outcome.mac);
        attempts.push(DiscoveryProbeAttempt {
            method: method.clone(),
            status: outcome.status.into(),
            elapsed_ms: elapsed_ms(attempt_start),
            error: outcome.error,
        });
        if adaptive && responsive {
            break;
        }
    }
    let reachable = attempts.iter().any(|a| a.status == RESPONSIVE);
    let status = if reachable {
        RESPONSIVE
    } else if attempts.iter().any(|a| a.status == UNRESPONSIVE) {
        UNRESPONSIVE
    } else {
        UNAVAILABLE
    };
    let error = if reachable {
        None
    } else {
        Some(
            attempts
                .iter()
                .filter_map(|a| a.error.as_ref().map(|e| format!("{}: {e}", a.method)))
                .collect::<Vec<_>>()
                .join("; "),
        )
    };
    DiscoveryProbeResult {
        reachable,
        elapsed_ms: elapsed_ms(start),
        error,
        status: status.into(),
        attempts,
        mac_address,
    }
}

fn socket_error(transport: &str, error: io::Error, refusal_is_evidence: bool) -> Outcome {
    // A connected UDP receive uses WSAECONNRESET for ICMP port unreachable.
    if refusal_is_evidence
        && (error.kind() == io::ErrorKind::ConnectionRefused
            || (cfg!(windows) && transport == "UDP" && error.raw_os_error() == Some(10054)))
    {
        return Outcome::responsive();
    }
    if matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied
            | io::ErrorKind::AddrNotAvailable
            | io::ErrorKind::Unsupported
    ) {
        Outcome::unavailable(format!("{transport} unavailable: {error}"))
    } else {
        Outcome::unresponsive(format!("{transport} probe failed: {error}"))
    }
}

async fn tcp(ip: IpAddr, port: u16) -> Outcome {
    match TcpStream::connect(SocketAddr::new(ip, port)).await {
        Ok(_) => Outcome::responsive(),
        Err(error) => socket_error("TCP", error, true),
    }
}

async fn udp(ip: IpAddr, port: u16) -> Outcome {
    let socket = match UdpSocket::bind(if ip.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }).await {
        Ok(socket) => socket,
        Err(error) => return Outcome::unavailable(format!("Could not bind UDP probe: {error}")),
    };
    if let Err(error) = socket.connect(SocketAddr::new(ip, port)).await {
        return socket_error("UDP", error, false);
    }
    // One harmless empty datagram. Sending successfully is NOT host evidence.
    if let Err(error) = socket.send(&[]).await {
        return socket_error("UDP", error, true);
    }
    let mut reply = [0u8; 512];
    match socket.recv(&mut reply).await {
        Ok(_) => Outcome::responsive(),
        Err(error) => socket_error("UDP", error, true),
    }
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
            for method in ["icmp", "tcp", "combined"] {
                let result = probe_discovery_host(host.into(), method.into(), 100, Some(443)).await;
                assert_eq!(result.status, UNAVAILABLE);
                assert!(result.attempts.is_empty());
                assert_eq!(
                    result.error.as_deref(),
                    Some("Host must be an IPv4 or IPv6 literal")
                );
            }
        }
    }

    #[tokio::test]
    async fn validates_entire_selection_and_ports_before_io() {
        for selected in [
            vec![],
            vec!["tcp", "nope"],
            vec!["tcp", "tcp"],
            vec!["adaptive"],
            vec!["combined"],
            vec!["ICMP"],
            vec!["icmp"; 8],
        ] {
            let result = probe_discovery_host_with_options(
                "127.0.0.1".into(),
                "combined".into(),
                100,
                Some(443),
                Some(selected.into_iter().map(String::from).collect()),
                Some(9),
            )
            .await;
            assert_eq!(result.status, UNAVAILABLE);
            assert!(result.attempts.is_empty());
        }
        for (method, port, udp_port) in [
            ("tcp", None, None),
            ("tcp", Some(0), None),
            ("udp", Some(9), None),
            ("udp", None, Some(0)),
        ] {
            let result = probe_discovery_host_with_options(
                "127.0.0.1".into(),
                method.into(),
                100,
                port,
                None,
                udp_port,
            )
            .await;
            assert_eq!(result.status, UNAVAILABLE);
            assert!(result.attempts.is_empty());
        }
        assert!(validate_methods("tcp", Some(vec!["icmp".into()]), Some(443), None).is_err());
        assert!(validate_methods("", None, None, None).is_err());
        assert_eq!(
            validate_methods("adaptive", None, Some(443), None).unwrap(),
            ["arp", "icmp", "tcp"]
        );
        assert!(validate_methods(
            "combined",
            Some(SINGLES.map(String::from).to_vec()),
            Some(443),
            Some(9)
        )
        .is_ok());
        // Invalid late options cannot cause the first valid method to send.
        let result = probe_discovery_host_with_options(
            "127.0.0.1".into(),
            "combined".into(),
            100,
            Some(443),
            Some(vec!["icmp".into(), "udp".into()]),
            Some(0),
        )
        .await;
        assert!(result.attempts.is_empty());
    }

    #[tokio::test]
    async fn wrong_family_and_all_unavailable_are_not_host_down() {
        for (host, method) in [
            ("::1", "arp"),
            ("::1", "icmp4"),
            ("127.0.0.1", "icmp6"),
            ("::1", "icmp-native"),
        ] {
            let result = probe_discovery_host(host.into(), method.into(), 100, None).await;
            assert_eq!(result.status, UNAVAILABLE);
            assert!(!result.reachable);
            assert_eq!(result.attempts.len(), 1);
        }
        let result = probe_discovery_host_with_options(
            "::1".into(),
            "combined".into(),
            100,
            None,
            Some(vec!["arp".into(), "icmp4".into(), "icmp-native".into()]),
            None,
        )
        .await;
        assert_eq!(result.status, UNAVAILABLE);
        assert_eq!(result.attempts.len(), 3);
    }

    #[test]
    fn adaptive_order_accounts_for_platform_family_and_direct_link() {
        let mut methods = ["udp", "tcp", "arp", "icmp", "icmp6", "icmp-native"].map(String::from);
        adaptive_order(&mut methods, "::1".parse().unwrap(), false);
        assert_eq!(
            methods,
            ["icmp6", "icmp", "tcp", "udp", "arp", "icmp-native"]
        );
        let mut methods = ["tcp", "icmp", "arp"].map(String::from);
        adaptive_order(&mut methods, "192.0.2.4".parse().unwrap(), true);
        assert_eq!(methods, ["arp", "icmp", "tcp"]);
    }

    #[tokio::test]
    async fn tcp_listener_proves_host_up_and_serializes_evidence() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let result = probe_discovery_host(
            "127.0.0.1".into(),
            "tcp".into(),
            1000,
            Some(listener.local_addr().unwrap().port()),
        )
        .await;
        assert!(result.reachable, "{result:?}");
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["status"], RESPONSIVE);
        assert!(value["elapsed_ms"].is_u64());
        assert!(value["mac_address"].is_null());
        assert_eq!(value["attempts"][0]["method"], "tcp");
    }

    #[tokio::test]
    async fn non_listening_tcp_socket_keeps_the_deadline() {
        // Some kernels refuse a bound, non-listening socket; Windows may drop
        // its SYN instead. Refusal classification is tested deterministically
        // in only_transport_refusal_is_positive_error_evidence.
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let result = probe_discovery_host(
            "127.0.0.1".into(),
            "tcp".into(),
            100,
            Some(socket.local_addr().unwrap().port()),
        )
        .await;
        assert!(
            matches!(result.status.as_str(), RESPONSIVE | UNRESPONSIVE),
            "{result:?}"
        );
        assert!(result.elapsed_ms < 1000, "{result:?}");
    }

    #[tokio::test]
    async fn udp_requires_reply_and_sends_only_an_empty_datagram() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = server.local_addr().unwrap().port();
        let responder = async {
            let mut data = [0u8; 8];
            let (length, peer) = server.recv_from(&mut data).await.unwrap();
            assert_eq!(length, 0);
            server.send_to(b"ok", peer).await.unwrap();
        };
        let probe = probe_discovery_host_with_options(
            "127.0.0.1".into(),
            "udp".into(),
            1000,
            None,
            None,
            Some(port),
        );
        let (result, ()) = tokio::join!(probe, responder);
        assert!(result.reachable, "{result:?}");
        // Still bound, but now silent. A successful send is not a response.
        let result = probe_discovery_host_with_options(
            "127.0.0.1".into(),
            "udp".into(),
            100,
            None,
            None,
            Some(port),
        )
        .await;
        assert!(!result.reachable);
        assert_eq!(result.status, UNRESPONSIVE);
    }

    #[test]
    fn only_transport_refusal_is_positive_error_evidence() {
        assert_eq!(
            socket_error("UDP", io::ErrorKind::ConnectionRefused.into(), true).status,
            RESPONSIVE
        );
        assert_eq!(
            socket_error("TCP", io::ErrorKind::ConnectionRefused.into(), true).status,
            RESPONSIVE
        );
        assert_ne!(
            socket_error("TCP", io::ErrorKind::ConnectionReset.into(), true).status,
            RESPONSIVE
        );
        assert_eq!(
            socket_error("UDP", io::ErrorKind::PermissionDenied.into(), true).status,
            UNAVAILABLE
        );
        #[cfg(windows)]
        assert_eq!(
            socket_error("UDP", io::Error::from_raw_os_error(10054), true).status,
            RESPONSIVE
        );
    }

    #[tokio::test]
    async fn combined_preserves_order_runs_after_success_and_gives_later_methods_time() {
        let selected = ["tcp", "icmp", "udp"].map(String::from);
        let mut calls = vec![];
        let result = run_sequence(
            Instant::now(),
            Duration::from_millis(180),
            &selected,
            false,
            |method, budget| {
                calls.push((method.clone(), budget));
                async move {
                    if method == "tcp" {
                        std::future::pending::<()>().await;
                    }
                    Outcome::responsive()
                }
            },
        )
        .await;
        assert!(result.reachable);
        assert_eq!(
            calls
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            ["tcp", "icmp", "udp"]
        );
        assert!(calls[0].1 <= Duration::from_millis(60));
        assert!(calls[1].1 > Duration::from_millis(10));
        assert_eq!(result.attempts[0].status, UNRESPONSIVE);
        assert_eq!(result.attempts.len(), 3);
    }

    #[tokio::test]
    async fn adaptive_stops_and_unavailable_returns_budget() {
        let selected = ["arp", "tcp", "udp"].map(String::from);
        let mut calls = vec![];
        let result = run_sequence(
            Instant::now(),
            Duration::from_secs(1),
            &selected,
            true,
            |method, budget| {
                calls.push((method.clone(), budget));
                async move {
                    if method == "arp" {
                        Outcome::unavailable("No direct link")
                    } else {
                        Outcome::responsive()
                    }
                }
            },
        )
        .await;
        assert!(result.reachable);
        assert_eq!(result.attempts.len(), 2);
        assert!(calls[1].1 > calls[0].1);
    }

    #[tokio::test]
    async fn deadline_drops_pending_probe_and_caller_cancellation_starts_no_more() {
        let selected = ["tcp", "udp"].map(String::from);
        let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
        let mut sender = Some(sender);
        let result = run_sequence(
            Instant::now(),
            Duration::from_millis(100),
            &selected[..1],
            false,
            |_, _| {
                let sender = sender.take();
                async move {
                    let _sender = sender;
                    std::future::pending::<Outcome>().await
                }
            },
        )
        .await;
        assert_eq!(result.status, UNRESPONSIVE);
        assert!(receiver.await.is_err());
        let mut calls = 0;
        let result = timeout_at(
            Instant::now() + Duration::from_millis(20),
            run_sequence(
                Instant::now(),
                Duration::from_secs(1),
                &selected,
                false,
                |_, _| {
                    calls += 1;
                    std::future::pending::<Outcome>()
                },
            ),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(calls, 1);
    }

    #[tokio::test]
    async fn expired_total_budget_dispatches_nothing() {
        let selected = ["arp", "tcp"].map(String::from);
        let result = run_sequence(
            Instant::now() - Duration::from_secs(1),
            Duration::from_millis(100),
            &selected,
            false,
            |_, _| {
                panic!("expired budget must not dispatch");
                #[allow(unreachable_code)]
                std::future::ready(Outcome::responsive())
            },
        )
        .await;
        assert_eq!(result.status, UNAVAILABLE);
        assert_eq!(result.attempts.len(), 2);
    }

    #[tokio::test]
    #[cfg(windows)]
    async fn native_drain_cannot_be_detached_by_sequence_deadline() {
        let selected = ["arp", "tcp"].map(String::from);
        let mut calls = vec![];
        let result = run_sequence(
            Instant::now(),
            Duration::from_millis(10),
            &selected,
            false,
            |method, _| {
                calls.push(method);
                async {
                    tokio::time::sleep(Duration::from_millis(30)).await;
                    Outcome::unresponsive("Native timeout after drain")
                }
            },
        )
        .await;
        assert_eq!(calls, ["arp"]);
        assert_eq!(result.attempts[1].status, UNAVAILABLE);
        assert!(result.elapsed_ms >= 30);
    }

    #[tokio::test]
    #[cfg(windows)]
    async fn native_and_system_icmp_reach_only_loopback() {
        for method in ["icmp-native", "icmp", "icmp4"] {
            let result = probe_discovery_host("127.0.0.1".into(), method.into(), 2000, None).await;
            assert!(result.reachable, "{result:?}");
        }
    }
}
