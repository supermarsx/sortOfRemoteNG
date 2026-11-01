//! In-process diagnostic primitives. Never launch an operating-system utility.
//! These are explicit general-network probes; native browser diagnostics use
//! their authenticated private relay instead and must not call these helpers.
use super::{TlsCheckResult, TracerouteHop};
use std::net::IpAddr;
#[cfg(any(windows, target_os = "linux"))]
use std::net::Ipv4Addr;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

#[derive(Debug)]
pub struct EchoReply {
    pub address: Option<IpAddr>,
    pub status: u32,
    pub time_ms: u64,
    pub ttl: Option<u8>,
}

impl EchoReply {
    pub fn reached(&self, target: IpAddr) -> bool {
        self.status == 0 && self.address == Some(target)
    }
}

pub async fn resolve(host: &str, budget: Duration) -> Result<IpAddr, String> {
    use std::net::ToSocketAddrs;
    if let Ok(ip) = host.parse() {
        return Ok(ip);
    }
    let host = host.to_owned();
    blocking(budget, move |_| {
        let addresses = (host.as_str(), 0)
            .to_socket_addrs()
            .map_err(|_| "Diagnostic DNS lookup failed".to_string())?;
        select_icmp_address(addresses)
            .ok_or_else(|| "Diagnostic DNS returned no addresses".to_string())
    })
    .await
}

// The current native ICMP provider supports IPv4. A dual-stack DNS ordering
// must not make a reachable IPv4 endpoint unavailable just because IPv6 came
// first. Keep IPv6-only answers for the explicit unsupported-family report.
fn select_icmp_address(
    mut addresses: impl Iterator<Item = std::net::SocketAddr>,
) -> Option<IpAddr> {
    let first = addresses.next()?.ip();
    if first.is_ipv4() {
        Some(first)
    } else {
        addresses
            .find(|address| address.is_ipv4())
            .map(|address| address.ip())
            .or(Some(first))
    }
}

/// The caller deadline bounds queueing and completion. A running OS resolver
/// cannot be interrupted: its worker retains its permit after timeout/cancel,
/// so repeated calls cannot create unbounded detached native operations.
async fn blocking<T: Send + 'static>(
    budget: Duration,
    work: impl FnOnce(Duration) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    static PERMITS: OnceLock<Arc<Semaphore>> = OnceLock::new();
    let deadline = tokio::time::Instant::now()
        + budget.clamp(Duration::from_millis(1), Duration::from_secs(10));
    let permit = tokio::time::timeout_at(
        deadline,
        PERMITS
            .get_or_init(|| Arc::new(Semaphore::new(8)))
            .clone()
            .acquire_owned(),
    )
    .await
    .map_err(|_| "Native diagnostic capacity timed out".to_string())?
    .map_err(|_| "Native diagnostic capacity unavailable".to_string())?;
    let worker = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("Native diagnostic deadline expired".into());
        }
        work(remaining)
    });
    tokio::time::timeout_at(deadline, worker)
        .await
        .map_err(|_| "Native diagnostic timed out".to_string())?
        .map_err(|_| "Native diagnostic worker failed".to_string())?
}

pub async fn echo(
    target: IpAddr,
    ttl: u8,
    payload: u16,
    df: bool,
    budget: Duration,
) -> Result<EchoReply, String> {
    blocking(budget, move |remaining| {
        platform_echo(target, ttl, payload.min(1472), df, remaining)
    })
    .await
}

#[cfg(windows)]
fn platform_echo(
    target: IpAddr,
    ttl: u8,
    payload_size: u16,
    df: bool,
    budget: Duration,
) -> Result<EchoReply, String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, HANDLE, INVALID_HANDLE_VALUE},
        NetworkManagement::IpHelper::*,
    };
    let IpAddr::V4(target) = target else {
        return Err(
            "Native diagnostic ICMP currently requires IPv4; no external utility was launched"
                .into(),
        );
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                IcmpCloseHandle(self.0);
            }
        }
    }
    let raw = unsafe { IcmpCreateFile() };
    if raw.is_null() || raw == INVALID_HANDLE_VALUE {
        return Err("Native ICMP handle unavailable".into());
    }
    let handle = Handle(raw);
    let payload = vec![0u8; payload_size as usize];
    // u64 storage provides the alignment required by ICMP_ECHO_REPLY. The OS
    // needs payload bytes plus an additional eight bytes for an ICMP error.
    let bytes = std::mem::size_of::<ICMP_ECHO_REPLY>() + payload.len() + 8;
    let mut storage = vec![0u64; bytes.div_ceil(8)];
    let options = IP_OPTION_INFORMATION {
        Ttl: ttl.max(1),
        Flags: if df { 2 } else { 0 },
        ..Default::default()
    };
    let count = unsafe {
        IcmpSendEcho(
            handle.0,
            u32::from_ne_bytes(target.octets()),
            payload.as_ptr().cast(),
            payload_size,
            &options,
            storage.as_mut_ptr().cast(),
            (storage.len() * 8) as u32,
            budget.as_millis().clamp(1, 5000) as u32,
        )
    };
    if count == 0 {
        let status = unsafe { GetLastError() };
        if (11002..=11050).contains(&status) {
            return Ok(EchoReply {
                address: None,
                status,
                time_ms: 0,
                ttl: None,
            });
        }
        return Err(format!("Native ICMP unavailable (OS status {status})"));
    }
    let reply = unsafe { &*storage.as_ptr().cast::<ICMP_ECHO_REPLY>() };
    Ok(EchoReply {
        address: Some(IpAddr::V4(Ipv4Addr::from(reply.Address.to_ne_bytes()))),
        status: reply.Status,
        time_ms: reply.RoundTripTime as u64,
        ttl: (reply.Options.Ttl != 0).then_some(reply.Options.Ttl),
    })
}

#[cfg(not(windows))]
fn platform_echo(
    _target: IpAddr,
    _ttl: u8,
    _payload: u16,
    _df: bool,
    _budget: Duration,
) -> Result<EchoReply, String> {
    Err("In-process ICMP diagnostics are unavailable on this platform; no external utility was launched".into())
}

pub async fn ping(host: &str, budget: Duration) -> Result<(bool, Option<u64>), String> {
    let started = Instant::now();
    let target = resolve(host, budget).await?;
    let reply = echo(
        target,
        64,
        32,
        false,
        budget.saturating_sub(started.elapsed()),
    )
    .await?;
    Ok((
        reply.reached(target),
        reply.reached(target).then_some(reply.time_ms),
    ))
}

pub async fn trace(
    host: &str,
    max_hops: u32,
    hop_budget: Duration,
) -> Result<Vec<TracerouteHop>, String> {
    let started = Instant::now();
    let target = resolve(host, Duration::from_secs(3)).await?;
    let mut hops = Vec::new();
    for hop in 1..=max_hops.clamp(1, 30) {
        let remaining = Duration::from_secs(15).saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        let reply = echo(target, hop as u8, 32, false, hop_budget.min(remaining)).await?;
        let finished = reply.reached(target);
        let observed = reply.address.is_some() && (reply.status == 0 || reply.status == 11013);
        hops.push(TracerouteHop {
            hop,
            ip: observed.then(|| reply.address.unwrap().to_string()),
            hostname: None,
            time_ms: observed.then_some(reply.time_ms),
            timeout: !observed,
        });
        if finished {
            break;
        }
    }
    Ok(hops)
}

#[cfg(windows)]
pub fn gateway() -> Result<String, String> {
    use windows_sys::Win32::{NetworkManagement::IpHelper::*, Networking::WinSock::AF_INET};
    let mut table = std::ptr::null_mut();
    let status = unsafe { GetIpForwardTable2(AF_INET, &mut table) };
    if status != 0 || table.is_null() {
        return Err("Native route table unavailable".into());
    }
    struct Table(*mut MIB_IPFORWARD_TABLE2);
    impl Drop for Table {
        fn drop(&mut self) {
            unsafe {
                FreeMibTable(self.0.cast());
            }
        }
    }
    let table = Table(table);
    // The OS allocates the flexible array with NumEntries initialized rows.
    let rows = unsafe {
        std::slice::from_raw_parts((*table.0).Table.as_ptr(), (*table.0).NumEntries as usize)
    };
    rows.iter()
        .filter(|r| r.DestinationPrefix.PrefixLength == 0 && !r.Loopback)
        .filter_map(|r| {
            let ip = unsafe { Ipv4Addr::from(r.NextHop.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()) };
            let mut interface = MIB_IPINTERFACE_ROW {
                Family: AF_INET,
                InterfaceIndex: r.InterfaceIndex,
                ..Default::default()
            };
            let metric = if unsafe { GetIpInterfaceEntry(&mut interface) } == 0 {
                r.Metric.saturating_add(interface.Metric)
            } else {
                // Do not silently rank an unknown interface above a measured
                // route. Keep it only when no complete candidate is present.
                u32::MAX
            };
            (!ip.is_unspecified()).then_some((metric, ip))
        })
        .min_by_key(|(metric, _)| *metric)
        .map(|(_, ip)| ip.to_string())
        .ok_or_else(|| "No default IPv4 gateway found".into())
}

#[cfg(target_os = "linux")]
pub fn gateway() -> Result<String, String> {
    let routes = std::fs::read_to_string("/proc/net/route")
        .map_err(|_| "Native route table unavailable".to_string())?;
    routes
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 8 || fields[1] != "00000000" {
                return None;
            }
            let flags = u32::from_str_radix(fields[3], 16).ok()?;
            if flags & 3 != 3 {
                return None;
            }
            Some((
                fields[6].parse::<u32>().ok()?,
                Ipv4Addr::from(u32::from_str_radix(fields[2], 16).ok()?.to_le_bytes()),
            ))
        })
        .min_by_key(|(metric, _)| *metric)
        .map(|(_, ip)| ip.to_string())
        .ok_or_else(|| "No default IPv4 gateway found".into())
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn gateway() -> Result<String, String> {
    Err("In-process gateway discovery unavailable on this platform".into())
}

#[cfg(windows)]
pub fn dns_servers() -> Result<Vec<String>, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::*;
    let mut size = 0u32;
    unsafe {
        GetNetworkParams(std::ptr::null_mut(), &mut size);
    }
    if size == 0 || size > 1024 * 1024 {
        return Err("Native DNS configuration unavailable".into());
    }
    let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
    let info = buffer.as_mut_ptr().cast::<FIXED_INFO_W2KSP1>();
    if unsafe { GetNetworkParams(info, &mut size) } != 0 {
        return Err("Native DNS configuration changed or unavailable".into());
    }
    let mut next = unsafe { &(*info).DnsServerList as *const IP_ADDR_STRING };
    let mut servers = Vec::new();
    for _ in 0..64 {
        if next.is_null() {
            break;
        }
        let row = unsafe { &*next };
        let bytes: Vec<u8> = row
            .IpAddress
            .String
            .iter()
            .take_while(|b| **b != 0)
            .map(|b| *b as u8)
            .collect();
        if let Ok(value) = std::str::from_utf8(&bytes) {
            if let Ok(ip) = value.parse::<IpAddr>() {
                if !ip.is_unspecified() {
                    servers.push(ip.to_string());
                }
            }
        }
        next = row.Next;
    }
    servers.sort();
    servers.dedup();
    Ok(servers)
}

/// A verified handshake using the OS trust verifier. No insecure retry and no
/// application request is sent; certificate metadata comes from the peer DER.
pub async fn tls(host: String, port: u16) -> TlsCheckResult {
    let started = Instant::now();
    // OS trust verification can synchronously consult certificate/revocation
    // state. Keep it off the application's async workers. Caller timeout does
    // not free this native worker's capacity until that OS work has drained.
    let report = blocking(Duration::from_secs(10), move |_| {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "TLS diagnostic runtime unavailable".to_string())?;
        Ok(runtime.block_on(tls_handshake(host, port)))
    })
    .await;
    let mut report = report.unwrap_or_else(|error| TlsCheckResult {
        tls_supported: false,
        tls_version: None,
        certificate_valid: false,
        certificate_subject: None,
        certificate_issuer: None,
        certificate_expiry: None,
        handshake_time_ms: 0,
        error: Some(error),
    });
    report.handshake_time_ms = started.elapsed().as_millis() as u64;
    report
}

async fn tls_handshake(host: String, port: u16) -> TlsCheckResult {
    let started = Instant::now();
    let mut result = TlsCheckResult {
        tls_supported: false,
        tls_version: None,
        certificate_valid: false,
        certificate_subject: None,
        certificate_issuer: None,
        certificate_expiry: None,
        handshake_time_ms: 0,
        error: None,
    };
    let work = async {
        let provider = rustls::crypto::CryptoProvider::get_default()
            .cloned()
            .unwrap_or_else(|| Arc::new(rustls::crypto::aws_lc_rs::default_provider()));
        let verifier = rustls_platform_verifier::Verifier::new(provider.clone())
            .map_err(|_| "TLS platform verifier unavailable".to_string())?;
        let config = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| "TLS configuration unavailable".to_string())?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth();
        let name = rustls::pki_types::ServerName::try_from(host.clone())
            .map_err(|_| "Invalid TLS endpoint name".to_string())?;
        let stream = tokio::net::TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|_| "TLS TCP connection failed".to_string())?;
        let stream = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(name, stream)
            .await
            .map_err(|_| "TLS handshake or certificate verification failed".to_string())?;
        let session = stream.get_ref().1;
        result.tls_supported = true;
        result.certificate_valid = true;
        result.tls_version = session.protocol_version().map(|v| format!("{v:?}"));
        if let Some(der) = session.peer_certificates().and_then(|chain| chain.first()) {
            if let Ok((_, cert)) = x509_parser::parse_x509_certificate(der.as_ref()) {
                let bounded = |value: String| {
                    value
                        .chars()
                        .filter(|c| !c.is_control())
                        .take(512)
                        .collect()
                };
                result.certificate_subject = Some(bounded(cert.subject().to_string()));
                result.certificate_issuer = Some(bounded(cert.issuer().to_string()));
                result.certificate_expiry = Some(cert.validity().not_after.to_string());
            }
        }
        Ok::<(), String>(())
    };
    result.error = match tokio::time::timeout(Duration::from_secs(10), work).await {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error),
        Err(_) => Some("TLS diagnostic timed out".into()),
    };
    result.handshake_time_ms = started.elapsed().as_millis() as u64;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dual_stack_dns_order_keeps_the_supported_icmp_family() {
        let ipv4 = "127.0.0.1:0".parse().unwrap();
        let ipv6 = "[::1]:0".parse().unwrap();
        assert_eq!(
            select_icmp_address([ipv6, ipv4].into_iter()),
            Some(ipv4.ip())
        );
        assert_eq!(select_icmp_address([ipv6].into_iter()), Some(ipv6.ip()));
    }

    #[test]
    fn saturated_blocking_pool_times_out_without_dispatching_a_late_probe() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(async {
            let (started, waiting) = tokio::sync::oneshot::channel();
            let (release, blocked) = std::sync::mpsc::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                blocked.recv().unwrap();
            });
            waiting.await.unwrap();
            let dispatched = Arc::new(AtomicBool::new(false));
            let observed = dispatched.clone();
            let result = blocking(Duration::from_millis(20), move |_| {
                observed.store(true, Ordering::SeqCst);
                Ok(())
            })
            .await;
            assert!(result.is_err());
            release.send(()).unwrap();
            blocker.await.unwrap();
            tokio::task::spawn_blocking(|| ()).await.unwrap();
            assert!(!dispatched.load(Ordering::SeqCst));
        });
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn native_loopback_echo_accepts_payload_and_df_without_a_child_process() {
        let target: IpAddr = "127.0.0.1".parse().unwrap();
        for payload in [0, 1472] {
            let reply = echo(target, 64, payload, true, Duration::from_secs(2))
                .await
                .unwrap();
            assert!(reply.reached(target), "native ICMP status {}", reply.status);
        }
    }

    #[test]
    fn only_success_from_exact_target_establishes_reachability() {
        let target: IpAddr = "192.0.2.1".parse().unwrap();
        for (address, status, expected) in [
            (Some(target), 0, true),
            (Some(target), 11013, false),
            (Some("192.0.2.2".parse().unwrap()), 0, false),
            (None, 11010, false),
        ] {
            assert_eq!(
                EchoReply {
                    address,
                    status,
                    time_ms: 0,
                    ttl: None
                }
                .reached(target),
                expected
            );
        }
    }
    #[tokio::test]
    async fn tls_does_not_accept_a_plaintext_peer_or_send_an_http_request() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let peer = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut input = [0u8; 1024];
            let n = socket.read(&mut input).await.unwrap();
            assert!(!input[..n].starts_with(b"GET "));
            socket.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
        });
        let report = tls("127.0.0.1".into(), port).await;
        peer.await.unwrap();
        assert!(!report.certificate_valid);
        assert!(report.error.is_some());
    }
}
