use super::network::*;

#[tauri::command]
pub async fn ping_host(
    state: tauri::State<'_, NetworkServiceState>,
    host: String,
) -> Result<bool, String> {
    let network = state.lock().await;
    network.ping_host(host).await
}

#[tauri::command]
pub async fn ping_host_detailed(
    state: tauri::State<'_, NetworkServiceState>,
    host: String,
    _count: Option<u32>,
    _timeout_secs: Option<u64>,
) -> Result<PingResult, String> {
    let network = state.lock().await;
    let start = std::time::Instant::now();

    match network.ping_host(host).await {
        Ok(success) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(PingResult {
                success,
                time_ms: if success { Some(elapsed) } else { None },
                error: None,
            })
        }
        Err(e) => Ok(PingResult {
            success: false,
            time_ms: None,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn ping_gateway(timeout_secs: Option<u64>) -> Result<PingResult, String> {
    // Try to get the default gateway
    let gateway = get_default_gateway()?;

    let start = std::time::Instant::now();
    #[cfg(target_os = "windows")]
    let timeout_ms = (timeout_secs.unwrap_or(5) * 1000) as u32;

    // Use ICMP ping directly - gateways typically don't have TCP services open
    let mut cmd = Command::new("ping");
    #[cfg(target_os = "windows")]
    cmd.arg("-n").arg("1").arg("-w").arg(timeout_ms.to_string());
    #[cfg(not(target_os = "windows"))]
    cmd.arg("-c")
        .arg("1")
        .arg("-W")
        .arg((timeout_secs.unwrap_or(5)).to_string());
    cmd.arg(&gateway)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    match cmd.output().await {
        Ok(output) if output.status.success() => {
            // Try to parse ping time from output
            let stdout = String::from_utf8_lossy(&output.stdout);
            let time_ms = parse_ping_time(&stdout).unwrap_or(start.elapsed().as_millis() as u64);
            Ok(PingResult {
                success: true,
                time_ms: Some(time_ms),
                error: None,
            })
        }
        Ok(_) => Ok(PingResult {
            success: false,
            time_ms: None,
            error: Some(format!("Gateway {} not reachable via ICMP", gateway)),
        }),
        Err(e) => Ok(PingResult {
            success: false,
            time_ms: None,
            error: Some(format!("Ping command failed: {}", e)),
        }),
    }
}

#[tauri::command]
pub async fn check_port(
    host: String,
    port: u16,
    timeout_secs: Option<u64>,
) -> Result<PortCheckResult, String> {
    let start = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(5));
    let addr = format!("{}:{}", host, port);

    let service = NetworkService::get_common_ports()
        .iter()
        .find(|(p, _)| *p == port)
        .map(|(_, s)| s.clone());

    match timeout(timeout_duration, TcpStream::connect(&addr)).await {
        Ok(Ok(mut stream)) => {
            let elapsed = start.elapsed().as_millis() as u64;

            // Try to grab a banner (first ~128 bytes within 2 seconds)
            let banner = {
                let mut buf = vec![0u8; 128];
                let banner_timeout = Duration::from_secs(2);
                match timeout(banner_timeout, stream.read(&mut buf)).await {
                    Ok(Ok(n)) if n > 0 => {
                        // Convert to string, filter non-printable chars, take first 64 chars
                        let raw = String::from_utf8_lossy(&buf[..n]);
                        let cleaned: String = raw
                            .chars()
                            .filter(|c| c.is_ascii_graphic() || *c == ' ')
                            .take(64)
                            .collect();
                        if !cleaned.is_empty() {
                            Some(cleaned)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            };

            Ok(PortCheckResult {
                port,
                open: true,
                service,
                time_ms: Some(elapsed),
                banner,
            })
        }
        _ => Ok(PortCheckResult {
            port,
            open: false,
            service,
            time_ms: None,
            banner: None,
        }),
    }
}

#[tauri::command]
pub async fn dns_lookup(host: String, timeout_secs: Option<u64>) -> Result<DnsResult, String> {
    use std::net::ToSocketAddrs;

    let start = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(5));

    // Try to resolve hostname to IP addresses
    let resolve_result = tokio::task::spawn_blocking(move || {
        let addr_with_port = format!("{}:80", host);
        addr_with_port
            .to_socket_addrs()
            .map(|addrs| addrs.map(|a| a.ip().to_string()).collect::<Vec<_>>())
    });

    match timeout(timeout_duration, resolve_result).await {
        Ok(Ok(Ok(ips))) if !ips.is_empty() => {
            let elapsed = start.elapsed().as_millis() as u64;

            // Try reverse DNS on first IP
            let first_ip = ips.first().cloned();
            let reverse = if let Some(ref ip) = first_ip {
                if let Ok(addr) = ip.parse::<std::net::IpAddr>() {
                    lookup_addr(&addr).ok()
                } else {
                    None
                }
            } else {
                None
            };

            Ok(DnsResult {
                success: true,
                resolved_ips: ips,
                reverse_dns: reverse,
                resolution_time_ms: elapsed,
                dns_server: None,
                error: None,
            })
        }
        Ok(Ok(Ok(_))) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some("No addresses found".to_string()),
        }),
        Ok(Ok(Err(e))) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some(format!("DNS resolution failed: {}", e)),
        }),
        Ok(Err(_)) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some("DNS lookup task failed".to_string()),
        }),
        Err(_) => Ok(DnsResult {
            success: false,
            resolved_ips: vec![],
            reverse_dns: None,
            resolution_time_ms: start.elapsed().as_millis() as u64,
            dns_server: None,
            error: Some("DNS lookup timed out".to_string()),
        }),
    }
}

#[tauri::command]
pub fn classify_ip(ip: String) -> Result<IpClassification, String> {
    use std::net::IpAddr;

    let addr: IpAddr = ip
        .parse()
        .map_err(|e| format!("Invalid IP address: {}", e))?;

    match addr {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            let first = octets[0];

            // Determine IP type
            let (ip_type, network_info) = if v4.is_loopback() {
                ("loopback", Some("127.0.0.0/8 - Loopback"))
            } else if v4.is_private() {
                let info = if first == 10 {
                    "10.0.0.0/8 - Class A Private"
                } else if first == 172 && (16..=31).contains(&octets[1]) {
                    "172.16.0.0/12 - Class B Private"
                } else {
                    "192.168.0.0/16 - Class C Private"
                };
                ("private", Some(info))
            } else if v4.is_link_local() {
                ("link_local", Some("169.254.0.0/16 - Link-Local (APIPA)"))
            } else if v4.is_multicast() {
                ("multicast", Some("224.0.0.0/4 - Multicast"))
            } else if v4.is_broadcast() {
                ("broadcast", Some("255.255.255.255 - Broadcast"))
            } else if first == 100 && (64..=127).contains(&octets[1]) {
                ("cgnat", Some("100.64.0.0/10 - Carrier-Grade NAT"))
            } else if first == 0 {
                ("reserved", Some("0.0.0.0/8 - Current Network"))
            } else {
                ("public", None)
            };

            // Determine IP class (legacy classful networking)
            let ip_class = if first < 128 {
                Some("A")
            } else if first < 192 {
                Some("B")
            } else if first < 224 {
                Some("C")
            } else if first < 240 {
                Some("D")
            } else {
                Some("E")
            };

            Ok(IpClassification {
                ip,
                ip_type: ip_type.to_string(),
                ip_class: ip_class.map(String::from),
                is_ipv6: false,
                network_info: network_info.map(String::from),
            })
        }
        IpAddr::V6(v6) => {
            let ip_type = if v6.is_loopback() {
                "loopback"
            } else if v6.is_multicast() {
                "multicast"
            } else if v6.is_unspecified() {
                "unspecified"
            } else {
                // Check for common IPv6 prefixes
                let segments = v6.segments();
                if segments[0] & 0xfe00 == 0xfc00 {
                    "private" // Unique local address (fc00::/7)
                } else if segments[0] & 0xffc0 == 0xfe80 {
                    "link_local" // Link-local (fe80::/10)
                } else {
                    "public"
                }
            };

            Ok(IpClassification {
                ip,
                ip_type: ip_type.to_string(),
                ip_class: None, // IPv6 doesn't use classful addressing
                is_ipv6: true,
                network_info: None,
            })
        }
    }
}

#[tauri::command]
pub async fn traceroute(
    host: String,
    max_hops: Option<u32>,
    timeout_secs: Option<u64>,
) -> Result<Vec<TracerouteHop>, String> {
    let max_hops = max_hops.unwrap_or(30);

    #[cfg(target_os = "windows")]
    let cmd_name = "tracert";
    #[cfg(not(target_os = "windows"))]
    let cmd_name = "traceroute";

    let mut cmd = Command::new(cmd_name);

    #[cfg(target_os = "windows")]
    {
        cmd.arg("-d") // Don't resolve hostnames (faster)
            .arg("-h")
            .arg(max_hops.to_string())
            .arg("-w")
            .arg((timeout_secs.unwrap_or(3) * 1000).to_string())
            .arg(&host);
    }

    #[cfg(not(target_os = "windows"))]
    {
        cmd.arg("-n") // Don't resolve hostnames
            .arg("-m")
            .arg(max_hops.to_string())
            .arg("-w")
            .arg(timeout_secs.unwrap_or(3).to_string())
            .arg(&host);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run traceroute: {}", e))?;

    let output_str = String::from_utf8_lossy(&output.stdout);
    let mut hops = Vec::new();

    for line in output_str.lines() {
        // Parse traceroute output - format varies by OS
        let trimmed = line.trim();

        // Skip empty lines and headers
        if trimmed.is_empty() || trimmed.starts_with("Tracing") || trimmed.starts_with("traceroute")
        {
            continue;
        }

        // Try to parse hop number
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        if let Ok(hop_num) = parts[0].parse::<u32>() {
            let mut hop = TracerouteHop {
                hop: hop_num,
                ip: None,
                hostname: None,
                time_ms: None,
                timeout: false,
            };

            // Check for timeout (asterisks)
            if trimmed.contains("*") && !trimmed.contains("ms") {
                hop.timeout = true;
            } else {
                // Try to find IP address
                for part in &parts[1..] {
                    // Check if it looks like an IP
                    if part.contains('.') && !part.contains("ms") {
                        let ip =
                            part.trim_matches(|c| c == '(' || c == ')' || c == '[' || c == ']');
                        hop.ip = Some(ip.to_string());
                        break;
                    }
                }

                // Try to find timing
                for (i, part) in parts.iter().enumerate() {
                    if *part == "ms" || part.ends_with("ms") {
                        // Get the number before "ms"
                        let num_str = if *part == "ms" {
                            if i > 0 {
                                parts[i - 1]
                            } else {
                                continue;
                            }
                        } else {
                            part.trim_end_matches("ms")
                        };

                        if let Ok(time) = num_str.parse::<f64>() {
                            hop.time_ms = Some(time as u64);
                            break;
                        }
                    }
                }
            }

            let hop_num_check = hop.hop;
            hops.push(hop);

            // Stop if we've reached the target (check if "Trace complete" or similar)
            if trimmed.contains("Trace complete") || hop_num_check >= max_hops {
                break;
            }
        }
    }

    // Perform reverse DNS lookups for all discovered IPs in parallel
    let dns_futures: Vec<_> = hops
        .iter()
        .enumerate()
        .filter_map(|(idx, hop)| {
            hop.ip.as_ref().map(|ip| {
                let ip_clone = ip.clone();
                async move { (idx, reverse_dns_lookup(&ip_clone).await) }
            })
        })
        .collect();

    let dns_results = join_all(dns_futures).await;

    // Apply reverse DNS results to hops
    for (idx, hostname) in dns_results {
        if let Some(hop) = hops.get_mut(idx) {
            hop.hostname = hostname;
        }
    }

    Ok(hops)
}

#[tauri::command]
pub async fn scan_network(
    state: tauri::State<'_, NetworkServiceState>,
    subnet: String,
    max_concurrent: Option<usize>,
) -> Result<Vec<String>, String> {
    let network = state.lock().await;
    network
        .scan_network_with_concurrency(subnet, max_concurrent)
        .await
}

#[tauri::command]
pub async fn scan_network_comprehensive(
    state: tauri::State<'_, NetworkServiceState>,
    subnet: String,
    scan_ports: bool,
) -> Result<Vec<DiscoveredHost>, String> {
    let network = state.lock().await;
    network.scan_network_comprehensive(subnet, scan_ports).await
}

#[tauri::command]
pub async fn probe_vnc_rfb(host: String, port: u16, timeout_ms: u64) -> VncRfbProbeResult {
    super::network::probe_vnc_rfb(&host, port, timeout_ms).await
}

/// Measure TCP connection timing in detail
#[tauri::command]
pub async fn tcp_connection_timing(
    host: String,
    port: u16,
    timeout_secs: Option<u64>,
) -> Result<TcpTimingResult, String> {
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(10));
    let addr = format!("{}:{}", host, port);

    let start = std::time::Instant::now();

    match timeout(timeout_duration, TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => {
            let connect_time = start.elapsed().as_millis() as u64;

            // Connection time > 200ms is considered slow
            let slow = connect_time > 200;

            Ok(TcpTimingResult {
                connect_time_ms: connect_time,
                syn_ack_time_ms: Some(connect_time), // In async, these are effectively the same
                total_time_ms: connect_time,
                success: true,
                slow_connection: slow,
                error: None,
            })
        }
        Ok(Err(e)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(TcpTimingResult {
                connect_time_ms: elapsed,
                syn_ack_time_ms: None,
                total_time_ms: elapsed,
                success: false,
                slow_connection: false,
                error: Some(format!("Connection failed: {}", e)),
            })
        }
        Err(_) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(TcpTimingResult {
                connect_time_ms: elapsed,
                syn_ack_time_ms: None,
                total_time_ms: elapsed,
                success: false,
                slow_connection: true,
                error: Some("Connection timed out".to_string()),
            })
        }
    }
}

/// Check MTU to host using ping with don't fragment flag
#[tauri::command]
pub async fn check_mtu(host: String) -> Result<MtuCheckResult, String> {
    let test_sizes = vec![1472, 1400, 1300, 1200, 1000, 576];
    let mut test_results = Vec::new();
    let mut largest_working = 576u32;
    let mut fragmentation_needed = false;

    for size in &test_sizes {
        let mut cmd = Command::new("ping");

        #[cfg(target_os = "windows")]
        {
            cmd.arg("-n")
                .arg("1")
                .arg("-f") // Don't fragment
                .arg("-l")
                .arg(size.to_string())
                .arg("-w")
                .arg("2000")
                .arg(&host);
        }

        #[cfg(not(target_os = "windows"))]
        {
            cmd.arg("-c")
                .arg("1")
                .arg("-M")
                .arg("do") // Don't fragment (Linux)
                .arg("-s")
                .arg(size.to_string())
                .arg("-W")
                .arg("2")
                .arg(&host);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        match cmd.output().await {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}{}", stdout, stderr).to_lowercase();

                // Check for fragmentation needed messages
                let needs_frag = combined.contains("fragmentation needed")
                    || combined.contains("frag needed")
                    || combined.contains("message too long")
                    || combined.contains("packet needs to be fragmented");

                let success = output.status.success() && !needs_frag;

                if needs_frag {
                    fragmentation_needed = true;
                }

                if success && *size as u32 > largest_working {
                    largest_working = *size as u32;
                }

                test_results.push(MtuTestPoint {
                    size: *size as u32,
                    success,
                });
            }
            Err(_) => {
                test_results.push(MtuTestPoint {
                    size: *size as u32,
                    success: false,
                });
            }
        }
    }

    // Path MTU = largest working payload + 28 (IP header + ICMP header)
    let path_mtu = if largest_working > 576 {
        Some(largest_working + 28)
    } else {
        None
    };

    // Standard ethernet MTU is 1500, recommend 1400 for safe internet traversal
    let recommended = if largest_working >= 1472 {
        1500
    } else if largest_working >= 1400 {
        1428
    } else {
        largest_working + 28
    };

    Ok(MtuCheckResult {
        path_mtu,
        fragmentation_needed,
        recommended_mtu: recommended,
        test_results,
        error: None,
    })
}

/// Detect if ICMP is being blocked to a host
#[tauri::command]
pub async fn detect_icmp_blockade(
    host: String,
    port: Option<u16>,
) -> Result<IcmpBlockadeResult, String> {
    // First try ICMP ping
    let mut ping_cmd = Command::new("ping");

    #[cfg(target_os = "windows")]
    ping_cmd.arg("-n").arg("2").arg("-w").arg("2000").arg(&host);

    #[cfg(not(target_os = "windows"))]
    ping_cmd.arg("-c").arg("2").arg("-W").arg("2").arg(&host);

    ping_cmd.stdout(Stdio::null()).stderr(Stdio::null());

    let icmp_result = ping_cmd.status().await;
    let icmp_allowed = icmp_result.map(|s| s.success()).unwrap_or(false);

    // Try TCP connection to common ports or specified port
    let ports_to_try = if let Some(p) = port {
        vec![p]
    } else {
        vec![80, 443, 22]
    };

    let mut tcp_reachable = false;
    for p in ports_to_try {
        let addr = format!("{}:{}", host, p);
        if let Ok(Ok(_)) = timeout(Duration::from_secs(3), TcpStream::connect(&addr)).await {
            tcp_reachable = true;
            break;
        }
    }

    let (likely_blocked, diagnosis) = match (icmp_allowed, tcp_reachable) {
        (true, true) => (false, "Host fully reachable via ICMP and TCP".to_string()),
        (true, false) => (
            false,
            "ICMP allowed but TCP ports closed/filtered".to_string(),
        ),
        (false, true) => (
            true,
            "ICMP appears blocked - host reachable via TCP but not ping".to_string(),
        ),
        (false, false) => (false, "Host unreachable via both ICMP and TCP".to_string()),
    };

    Ok(IcmpBlockadeResult {
        icmp_allowed,
        tcp_reachable,
        likely_blocked,
        diagnosis,
    })
}

const MAX_TLS_HOST_BYTES: usize = 253;
const MAX_TLS_PROCESS_STREAM_BYTES: usize = 8 * 1024;
const MAX_TLS_DIAGNOSTIC_CHARS: usize = 1_536;

struct BoundedTlsCommandOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
}

fn canonical_tls_host(input: &str) -> Result<String, String> {
    if input.is_empty() || input.len() > MAX_TLS_HOST_BYTES {
        return Err("TLS host must contain between 1 and 253 ASCII bytes".to_string());
    }
    if input.trim() != input || !input.is_ascii() {
        return Err("TLS host must be a canonical ASCII DNS name or IP address".to_string());
    }

    if let Ok(ip) = input.parse::<std::net::IpAddr>() {
        return Ok(ip.to_string());
    }

    if input.contains(':')
        || input.starts_with('.')
        || input.ends_with('.')
        || input
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return Err("TLS host is not a valid canonical DNS name or IP address".to_string());
    }

    for label in input.split('.') {
        if label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("TLS host contains an invalid DNS label".to_string());
        }
    }

    Ok(input.to_ascii_lowercase())
}

fn validated_tls_port(port: Option<u16>) -> Result<u16, String> {
    let port = port.unwrap_or(443);
    if port == 0 {
        return Err("TLS port must be between 1 and 65535".to_string());
    }
    Ok(port)
}

fn sanitize_tls_diagnostic(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

fn failed_tls_check(start: &std::time::Instant, error: impl Into<String>) -> TlsCheckResult {
    TlsCheckResult {
        tls_supported: false,
        tls_version: None,
        certificate_valid: false,
        certificate_subject: None,
        certificate_issuer: None,
        certificate_expiry: None,
        handshake_time_ms: start.elapsed().as_millis() as u64,
        error: Some(error.into()),
    }
}

async fn read_bounded_tls_stream<R>(mut reader: R, limit: usize) -> std::io::Result<(Vec<u8>, bool)>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut retained = Vec::with_capacity(limit.min(1024));
    let mut buffer = [0u8; 1024];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(retained.len());
        let keep = remaining.min(count);
        retained.extend_from_slice(&buffer[..keep]);
        truncated |= keep < count;
    }
    Ok((retained, truncated))
}

async fn run_bounded_tls_command(
    mut command: Command,
    timeout_duration: Duration,
) -> Result<BoundedTlsCommandOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| format!("TLS check failed: {}", error))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "TLS check failed to capture standard output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "TLS check failed to capture standard error".to_string())?;

    let collect = async move {
        let (status, stdout, stderr) = tokio::join!(
            child.wait(),
            read_bounded_tls_stream(stdout, MAX_TLS_PROCESS_STREAM_BYTES),
            read_bounded_tls_stream(stderr, MAX_TLS_PROCESS_STREAM_BYTES),
        );
        let status = status.map_err(|error| format!("TLS check failed: {}", error))?;
        let (stdout, stdout_truncated) =
            stdout.map_err(|error| format!("TLS output read failed: {}", error))?;
        let (stderr, stderr_truncated) =
            stderr.map_err(|error| format!("TLS error output read failed: {}", error))?;
        Ok(BoundedTlsCommandOutput {
            success: status.success(),
            stdout,
            stderr,
            truncated: stdout_truncated || stderr_truncated,
        })
    };

    timeout(timeout_duration, collect)
        .await
        .map_err(|_| "TLS check timed out".to_string())?
}

/// Check TLS/SSL handshake and platform trust for a canonical DNS name or IP.
#[tauri::command]
pub async fn check_tls(host: String, port: Option<u16>) -> Result<TlsCheckResult, String> {
    let host = canonical_tls_host(&host)?;
    let port = validated_tls_port(port)?;
    let start = std::time::Instant::now();

    #[cfg(target_os = "windows")]
    {
        // The script is constant. Untrusted endpoint values are passed through the
        // child environment and parsed as data, never interpolated as PowerShell.
        const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Limit-Text {
    param([AllowNull()][object]$Value, [int]$Maximum = 512)
    if ($null -eq $Value) { return $null }
    $text = [string]$Value
    $text = $text -replace '[\x00-\x1f\x7f]', ' '
    if ($text.Length -gt $Maximum) { return $text.Substring(0, $Maximum) }
    return $text
}

$tcp = $null
$ssl = $null
try {
    $hostName = [Environment]::GetEnvironmentVariable('SORNG_TLS_HOST', 'Process')
    $portText = [Environment]::GetEnvironmentVariable('SORNG_TLS_PORT', 'Process')
    [UInt16]$portNumber = 0
    if ([string]::IsNullOrWhiteSpace($hostName) -or
        -not [UInt16]::TryParse($portText, [ref]$portNumber) -or
        $portNumber -eq 0) {
        throw 'TLS endpoint input is invalid.'
    }

    $script:policyErrors = [System.Net.Security.SslPolicyErrors]::None
    $script:chainStatuses = @()
    $script:certificatePresented = $false
    $script:certificateSubject = $null
    $script:certificateIssuer = $null
    $script:certificateExpiry = $null
    $script:certificateNotBefore = $null
    $script:authenticationError = $null

    $validationCallback = {
        param($sender, $certificate, $chain, $sslPolicyErrors)
        $script:policyErrors = $sslPolicyErrors
        if ($null -ne $certificate) {
            $script:certificatePresented = $true
            $certificate2 = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate)
            $script:certificateSubject = Limit-Text $certificate2.Subject
            $script:certificateIssuer = Limit-Text $certificate2.Issuer
            $script:certificateExpiry = $certificate2.NotAfter.ToUniversalTime()
            $script:certificateNotBefore = $certificate2.NotBefore.ToUniversalTime()
        }
        if ($null -ne $chain) {
            $script:chainStatuses = @(
                $chain.ChainStatus |
                    Where-Object {
                        $_.Status -ne [System.Security.Cryptography.X509Certificates.X509ChainStatusFlags]::NoError
                    } |
                    ForEach-Object {
                        Limit-Text ('{0}: {1}' -f $_.Status, $_.StatusInformation) 256
                    }
            )
        }
        return ($sslPolicyErrors -eq [System.Net.Security.SslPolicyErrors]::None)
    }

    $tcp = [System.Net.Sockets.TcpClient]::new()
    $connectTask = $tcp.ConnectAsync($hostName, $portNumber)
    if (-not $connectTask.Wait([TimeSpan]::FromSeconds(5))) {
        throw 'TCP connection timed out.'
    }
    $ssl = [System.Net.Security.SslStream]::new(
        $tcp.GetStream(),
        $false,
        $validationCallback
    )

    $authenticated = $false
    try {
        $ssl.AuthenticateAsClient($hostName)
        $authenticated = $ssl.IsAuthenticated
    } catch {
        $script:authenticationError = Limit-Text $_.Exception.Message
    }

    $nameMismatch = [System.Net.Security.SslPolicyErrors]::RemoteCertificateNameMismatch
    $chainErrors = [System.Net.Security.SslPolicyErrors]::RemoteCertificateChainErrors
    $nameValid = $script:certificatePresented -and (($script:policyErrors -band $nameMismatch) -eq 0)
    $chainValid = $script:certificatePresented -and
        (($script:policyErrors -band $chainErrors) -eq 0) -and
        $script:chainStatuses.Count -eq 0
    $now = [DateTime]::UtcNow
    $timeValid = $script:certificatePresented -and
        $script:certificateNotBefore -le $now -and
        $script:certificateExpiry -ge $now
    $valid = $authenticated -and
        $script:policyErrors -eq [System.Net.Security.SslPolicyErrors]::None -and
        $nameValid -and $chainValid -and $timeValid

    $issues = @()
    if ($script:policyErrors -ne [System.Net.Security.SslPolicyErrors]::None) {
        $issues += 'SslPolicyErrors: ' + $script:policyErrors.ToString()
    }
    if (-not $nameValid) { $issues += 'Certificate name validation failed' }
    if (-not $chainValid) {
        $chainSummary = if ($script:chainStatuses.Count -gt 0) {
            $script:chainStatuses -join ', '
        } else {
            'no valid certificate chain'
        }
        $issues += 'Certificate chain validation failed: ' + $chainSummary
    }
    if (-not $timeValid) { $issues += 'Certificate time validation failed' }
    if (-not $authenticated -and $script:authenticationError) {
        $issues += 'TLS authentication failed: ' + $script:authenticationError
    }

    [ordered]@{
        TlsSupported = ($script:certificatePresented -or $authenticated)
        HandshakeSucceeded = $authenticated
        TlsVersion = if ($authenticated) { $ssl.SslProtocol.ToString() } else { $null }
        Subject = $script:certificateSubject
        Issuer = $script:certificateIssuer
        Expiry = if ($script:certificateExpiry) { $script:certificateExpiry.ToString('o') } else { $null }
        Valid = $valid
        PolicyErrors = $script:policyErrors.ToString()
        NameValid = $nameValid
        ChainValid = $chainValid
        TimeValid = $timeValid
        ChainStatus = Limit-Text ($script:chainStatuses -join ', ') 1024
        Error = if ($issues.Count -gt 0) { Limit-Text ($issues -join '; ') 1536 } else { $null }
    } | ConvertTo-Json -Compress -Depth 3
} catch {
    [ordered]@{
        TlsSupported = $false
        HandshakeSucceeded = $false
        TlsVersion = $null
        Subject = $null
        Issuer = $null
        Expiry = $null
        Valid = $false
        PolicyErrors = 'Unknown'
        NameValid = $false
        ChainValid = $false
        TimeValid = $false
        ChainStatus = $null
        Error = Limit-Text $_.Exception.Message 1536
    } | ConvertTo-Json -Compress -Depth 3
} finally {
    if ($null -ne $ssl) { $ssl.Dispose() }
    if ($null -ne $tcp) { $tcp.Dispose() }
}
"#;

        let mut command = Command::new("powershell");
        command
            .arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(SCRIPT)
            .env("SORNG_TLS_HOST", &host)
            .env("SORNG_TLS_PORT", port.to_string());

        let output = match run_bounded_tls_command(command, Duration::from_secs(10)).await {
            Ok(output) => output,
            Err(error) => return Ok(failed_tls_check(&start, error)),
        };
        if output.truncated {
            return Ok(failed_tls_check(
                &start,
                "TLS diagnostic output exceeded the safety limit",
            ));
        }
        if !output.success {
            return Ok(failed_tls_check(&start, "TLS diagnostic process failed"));
        }

        let json = match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
            Ok(json) => json,
            Err(_) => {
                return Ok(failed_tls_check(
                    &start,
                    "Failed to parse bounded TLS response",
                ))
            }
        };
        let tls_supported = json
            .get("TlsSupported")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let handshake_succeeded = json
            .get("HandshakeSucceeded")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let policy_errors = json
            .get("PolicyErrors")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown");
        let name_valid = json
            .get("NameValid")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let chain_valid = json
            .get("ChainValid")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let time_valid = json
            .get("TimeValid")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let certificate_valid = handshake_succeeded
            && policy_errors == "None"
            && name_valid
            && chain_valid
            && time_valid
            && json
                .get("Valid")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);

        let mut issues = Vec::new();
        if let Some(error) = json.get("Error").and_then(|value| value.as_str()) {
            let error = sanitize_tls_diagnostic(error, MAX_TLS_DIAGNOSTIC_CHARS);
            if !error.is_empty() {
                issues.push(error);
            }
        }
        if !certificate_valid && issues.is_empty() {
            issues.push(format!(
                "Certificate validation failed (policy: {}; name valid: {}; chain valid: {}; time valid: {})",
                sanitize_tls_diagnostic(policy_errors, 128),
                name_valid,
                chain_valid,
                time_valid
            ));
        }

        Ok(TlsCheckResult {
            tls_supported,
            tls_version: json
                .get("TlsVersion")
                .and_then(|value| value.as_str())
                .map(|value| sanitize_tls_diagnostic(value, 64)),
            certificate_valid,
            certificate_subject: json
                .get("Subject")
                .and_then(|value| value.as_str())
                .map(|value| sanitize_tls_diagnostic(value, 512)),
            certificate_issuer: json
                .get("Issuer")
                .and_then(|value| value.as_str())
                .map(|value| sanitize_tls_diagnostic(value, 512)),
            certificate_expiry: json
                .get("Expiry")
                .and_then(|value| value.as_str())
                .map(|value| sanitize_tls_diagnostic(value, 64)),
            handshake_time_ms: start.elapsed().as_millis() as u64,
            error: if issues.is_empty() {
                None
            } else {
                Some(sanitize_tls_diagnostic(
                    &issues.join("; "),
                    MAX_TLS_DIAGNOSTIC_CHARS,
                ))
            },
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let endpoint = match host.parse::<std::net::IpAddr>() {
            Ok(std::net::IpAddr::V6(_)) => format!("[{}]:{}", host, port),
            _ => format!("{}:{}", host, port),
        };
        let mut command = Command::new("openssl");
        command
            .arg("s_client")
            .arg("-connect")
            .arg(endpoint)
            .arg("-brief")
            .arg("-verify_return_error");
        if host.parse::<std::net::IpAddr>().is_ok() {
            command.arg("-verify_ip").arg(&host);
        } else {
            command
                .arg("-verify_hostname")
                .arg(&host)
                .arg("-servername")
                .arg(&host);
        }

        let output = match run_bounded_tls_command(command, Duration::from_secs(10)).await {
            Ok(output) => output,
            Err(error) => return Ok(failed_tls_check(&start, error)),
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{}\n{}", stdout, stderr);
        let tls_supported = combined.contains("CONNECTION ESTABLISHED")
            || combined.contains("Protocol version:")
            || combined.contains("Verification:");
        let tls_version = if combined.contains("TLSv1.3") {
            Some("TLS 1.3".to_string())
        } else if combined.contains("TLSv1.2") {
            Some("TLS 1.2".to_string())
        } else if combined.contains("TLSv1.1") {
            Some("TLS 1.1".to_string())
        } else if combined.contains("TLSv1") {
            Some("TLS 1.0".to_string())
        } else {
            None
        };
        let certificate_valid =
            !output.truncated && output.success && combined.contains("Verification: OK");

        let error = if output.truncated {
            Some("TLS diagnostic output exceeded the safety limit".to_string())
        } else if certificate_valid {
            None
        } else {
            let diagnostic = combined
                .lines()
                .find(|line| {
                    let lower = line.to_ascii_lowercase();
                    lower.contains("verify error")
                        || lower.contains("verification error")
                        || lower.contains("certificate verify failed")
                        || lower.contains("connect:")
                })
                .map(|line| sanitize_tls_diagnostic(line, 512))
                .filter(|line| !line.is_empty())
                .unwrap_or_else(|| {
                    if tls_supported {
                        "TLS certificate chain or endpoint name validation failed".to_string()
                    } else {
                        "TLS connection failed".to_string()
                    }
                });
            Some(diagnostic)
        };

        Ok(TlsCheckResult {
            tls_supported,
            tls_version,
            certificate_valid,
            certificate_subject: None,
            certificate_issuer: None,
            certificate_expiry: None,
            handshake_time_ms: start.elapsed().as_millis() as u64,
            error,
        })
    }
}

#[cfg(test)]
mod check_tls_input_tests {
    use super::{canonical_tls_host, validated_tls_port};

    #[test]
    fn canonicalizes_valid_dns_and_ip_hosts() {
        assert_eq!(
            canonical_tls_host("API.Example.COM").unwrap(),
            "api.example.com"
        );
        assert_eq!(canonical_tls_host("192.0.2.10").unwrap(), "192.0.2.10");
        assert_eq!(canonical_tls_host("2001:0db8::1").unwrap(), "2001:db8::1");
    }

    #[test]
    fn rejects_noncanonical_or_injection_shaped_hosts() {
        for host in [
            "",
            " example.com",
            "example.com ",
            "https://example.com",
            "example.com.",
            "*.example.com",
            "bad_label.example",
            "-bad.example",
            "bad-.example",
            "example.com'; Write-Output owned; '",
            "999.999.999.999",
        ] {
            assert!(canonical_tls_host(host).is_err(), "{host}");
        }
        assert!(canonical_tls_host(&"a".repeat(254)).is_err());
    }

    #[test]
    fn validates_tls_port_range() {
        assert_eq!(validated_tls_port(None).unwrap(), 443);
        assert_eq!(validated_tls_port(Some(1)).unwrap(), 1);
        assert_eq!(validated_tls_port(Some(u16::MAX)).unwrap(), u16::MAX);
        assert!(validated_tls_port(Some(0)).is_err());
    }
}

/// Enhanced service fingerprinting with protocol detection
#[tauri::command]
pub async fn fingerprint_service(host: String, port: u16) -> Result<ServiceFingerprint, String> {
    let addr = format!("{}:{}", host, port);
    let timeout_duration = Duration::from_secs(5);

    // Known service name
    let service_name = NetworkService::get_common_ports()
        .iter()
        .find(|(p, _)| *p == port)
        .map(|(_, s)| s.clone())
        .unwrap_or_else(|| "unknown".to_string());

    // Try to connect and probe
    match timeout(timeout_duration, TcpStream::connect(&addr)).await {
        Ok(Ok(mut stream)) => {
            let mut banner = None;
            let mut protocol_detected = None;
            let mut version = None;
            let mut response_preview = None;

            // Send protocol-specific probes based on port
            let probe_data: Option<&[u8]> = match port {
                80 | 8080 | 8000 | 8888 => Some(b"HEAD / HTTP/1.0\r\nHost: test\r\n\r\n"),
                443 | 8443 => None, // TLS ports - just connect
                21 => Some(b""),    // FTP sends banner automatically
                22 => Some(b""),    // SSH sends banner automatically
                25 | 587 => Some(b"EHLO test\r\n"),
                110 => Some(b""),  // POP3 sends banner automatically
                143 => Some(b""),  // IMAP sends banner automatically
                3306 => Some(b""), // MySQL sends greeting
                5432 => Some(b"\x00\x00\x00\x08\x04\xd2\x16\x2f"), // PostgreSQL startup
                6379 => Some(b"PING\r\n"), // Redis
                _ => Some(b""),
            };

            // Send probe if any
            if let Some(probe) = probe_data {
                if !probe.is_empty() {
                    let _ = stream.write_all(probe).await;
                }
            }

            // Read response
            let mut buf = vec![0u8; 512];
            let read_timeout = Duration::from_secs(3);

            if let Ok(Ok(n)) = timeout(read_timeout, stream.read(&mut buf)).await {
                if n > 0 {
                    let raw = String::from_utf8_lossy(&buf[..n]);

                    // Clean banner (printable chars only)
                    let cleaned: String = raw
                        .chars()
                        .filter(|c| c.is_ascii_graphic() || c.is_ascii_whitespace())
                        .take(128)
                        .collect();

                    if !cleaned.trim().is_empty() {
                        banner = Some(cleaned.trim().to_string());
                    }

                    // Detect protocol from response
                    let response_lower = raw.to_lowercase();

                    if response_lower.contains("http/") {
                        protocol_detected = Some("HTTP".to_string());
                        // Try to extract server version
                        for line in raw.lines() {
                            if line.to_lowercase().starts_with("server:") {
                                version = Some(line[7..].trim().to_string());
                                break;
                            }
                        }
                    } else if response_lower.starts_with("ssh-") {
                        protocol_detected = Some("SSH".to_string());
                        version = raw.lines().next().map(|s| s.to_string());
                    } else if response_lower.contains("220")
                        && (response_lower.contains("ftp") || response_lower.contains("smtp"))
                    {
                        protocol_detected = Some(
                            if response_lower.contains("ftp") {
                                "FTP"
                            } else {
                                "SMTP"
                            }
                            .to_string(),
                        );
                        version = raw.lines().next().map(|s| s.trim().to_string());
                    } else if response_lower.starts_with("+ok")
                        || response_lower.starts_with("-err")
                    {
                        protocol_detected = Some("POP3".to_string());
                    } else if response_lower.starts_with("* ok") {
                        protocol_detected = Some("IMAP".to_string());
                    } else if response_lower.contains("mysql") {
                        protocol_detected = Some("MySQL".to_string());
                    } else if response_lower.contains("postgresql") || buf[0] == b'R' {
                        protocol_detected = Some("PostgreSQL".to_string());
                    } else if response_lower.starts_with("+pong") || response_lower.starts_with("-")
                    {
                        protocol_detected = Some("Redis".to_string());
                    }

                    // Truncated preview
                    response_preview = Some(cleaned.chars().take(64).collect());
                }
            }

            Ok(ServiceFingerprint {
                port,
                service: service_name,
                version,
                banner,
                protocol_detected,
                response_preview,
            })
        }
        Ok(Err(e)) => Err(format!("Connection failed: {}", e)),
        Err(_) => Err("Connection timed out".to_string()),
    }
}

/// Attempt to detect asymmetric routing by analyzing TTL values and path variance
#[tauri::command]
pub async fn detect_asymmetric_routing(
    host: String,
    sample_count: Option<u32>,
) -> Result<AsymmetricRoutingResult, String> {
    let samples = sample_count.unwrap_or(5);
    let mut notes = Vec::new();
    let mut latencies: Vec<f64> = Vec::new();
    let mut ttl_values: Vec<u8> = Vec::new();
    let mut outbound_hops: Vec<String> = Vec::new();

    // Run multiple pings to gather TTL data
    #[cfg(target_os = "windows")]
    let ping_cmd = "ping";
    #[cfg(not(target_os = "windows"))]
    let ping_cmd = "ping";

    for _ in 0..samples {
        let output = Command::new(ping_cmd)
            .args(if cfg!(target_os = "windows") {
                vec!["-n", "1", "-w", "2000", &host]
            } else {
                vec!["-c", "1", "-W", "2", &host]
            })
            .output()
            .await
            .map_err(|e| format!("Ping failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse TTL from ping output
        if let Some(ttl) = parse_ttl_from_ping(&stdout) {
            ttl_values.push(ttl);
        }

        // Parse latency
        if let Some(latency) = parse_latency_from_ping(&stdout) {
            latencies.push(latency);
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Run a quick traceroute to get outbound path (limited hops)
    let traceroute_output = Command::new(if cfg!(target_os = "windows") {
        "tracert"
    } else {
        "traceroute"
    })
    .args(if cfg!(target_os = "windows") {
        vec!["-d", "-h", "5", "-w", "1000", &host]
    } else {
        vec!["-n", "-m", "5", "-w", "1", &host]
    })
    .output()
    .await;

    if let Ok(output) = traceroute_output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().skip(1) {
            // Extract IP addresses from traceroute output
            if let Some(ip) = extract_ip_from_traceroute_line(line) {
                if !ip.is_empty() && ip != "*" {
                    outbound_hops.push(ip);
                }
            }
        }
    }

    // Analyze TTL values
    let ttl_analysis = analyze_ttl(&ttl_values);

    // Calculate latency variance
    let latency_variance = if latencies.len() >= 2 {
        let mean: f64 = latencies.iter().sum::<f64>() / latencies.len() as f64;
        let variance: f64 =
            latencies.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / latencies.len() as f64;
        Some(variance.sqrt())
    } else {
        None
    };

    // Determine path stability
    let path_stability = match latency_variance {
        Some(v) if v < 5.0 => "stable",
        Some(v) if v < 20.0 => "moderate",
        Some(_) => "unstable",
        None => "unknown",
    }
    .to_string();

    // High variance could indicate asymmetric routing
    if let Some(variance) = latency_variance {
        if variance > 30.0 {
            notes.push("High latency variance detected, may indicate path changes".to_string());
        }
    }

    // TTL inconsistency could indicate asymmetric routing
    if !ttl_analysis.ttl_consistent && ttl_values.len() >= 3 {
        notes.push(
            "TTL values vary between responses, suggesting different return paths".to_string(),
        );
    }

    // Determine confidence level
    let asymmetry_detected =
        !ttl_analysis.ttl_consistent || latency_variance.is_some_and(|v| v > 30.0);

    let confidence =
        if !ttl_analysis.ttl_consistent && latency_variance.is_some_and(|v| v > 30.0) {
            "high"
        } else if !ttl_analysis.ttl_consistent || latency_variance.is_some_and(|v| v > 30.0) {
            "medium"
        } else if latency_variance.is_some_and(|v| v > 15.0) {
            "low"
        } else {
            "none"
        }
        .to_string();

    if confidence == "none" {
        notes.push("No clear signs of asymmetric routing detected".to_string());
    }

    Ok(AsymmetricRoutingResult {
        asymmetry_detected,
        confidence,
        outbound_hops,
        ttl_analysis,
        latency_variance,
        path_stability,
        notes,
    })
}

/// Probe UDP port reachability
/// Note: UDP is connectionless, so we can only detect if port is definitely closed
/// (ICMP port unreachable) or possibly open (no response or actual response)
#[tauri::command]
pub async fn probe_udp_port(
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
    probe_data: Option<String>,
) -> Result<UdpProbeResult, String> {
    use tokio::net::UdpSocket;

    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(3000));
    let start = std::time::Instant::now();

    // Bind to any available local port
    let socket = match UdpSocket::bind("0.0.0.0:0").await {
        Ok(s) => s,
        Err(e) => return Err(format!("Failed to create UDP socket: {}", e)),
    };

    let target = format!("{}:{}", host, port);
    if let Err(e) = socket.connect(&target).await {
        return Ok(UdpProbeResult {
            port,
            reachable: None,
            response_received: false,
            response_type: Some("connect_failed".to_string()),
            response_data: None,
            latency_ms: None,
            error: Some(format!("Connect failed: {}", e)),
        });
    }

    // Prepare probe data based on common protocols
    let data = if let Some(custom) = probe_data {
        custom.into_bytes()
    } else {
        // Default probe based on port
        match port {
            53 => {
                // DNS query for "." (root)
                vec![
                    0x00, 0x01, // Transaction ID
                    0x01, 0x00, // Flags: Standard query
                    0x00, 0x01, // Questions: 1
                    0x00, 0x00, // Answer RRs: 0
                    0x00, 0x00, // Authority RRs: 0
                    0x00, 0x00, // Additional RRs: 0
                    0x00, // Root domain
                    0x00, 0x01, // Type: A
                    0x00, 0x01, // Class: IN
                ]
            }
            123 => {
                // NTP request
                vec![0x1b; 48]
            }
            161 | 162 => {
                // SNMP GetRequest (simple probe)
                vec![
                    0x30, 0x26, 0x02, 0x01, 0x00, 0x04, 0x06, 0x70, 0x75, 0x62, 0x6c, 0x69, 0x63,
                    0xa0, 0x19, 0x02, 0x01, 0x01, 0x02, 0x01, 0x00, 0x02, 0x01, 0x00, 0x30, 0x0e,
                    0x30, 0x0c, 0x06, 0x08, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00, 0x05,
                    0x00,
                ]
            }
            _ => {
                // Generic probe
                b"PROBE\r\n".to_vec()
            }
        }
    };

    // Send probe
    if let Err(e) = socket.send(&data).await {
        return Ok(UdpProbeResult {
            port,
            reachable: None,
            response_received: false,
            response_type: Some("send_failed".to_string()),
            response_data: None,
            latency_ms: None,
            error: Some(format!("Send failed: {}", e)),
        });
    }

    // Wait for response
    let mut buf = [0u8; 1024];
    match timeout(timeout_duration, socket.recv(&mut buf)).await {
        Ok(Ok(len)) => {
            let latency = start.elapsed().as_millis() as u64;
            let response_data = if len > 0 {
                // Show first 64 bytes as hex
                let preview_len = std::cmp::min(len, 64);
                Some(
                    buf[..preview_len]
                        .iter()
                        .map(|b| format!("{:02x}", b))
                        .collect::<Vec<_>>()
                        .join(" "),
                )
            } else {
                None
            };

            Ok(UdpProbeResult {
                port,
                reachable: Some(true),
                response_received: true,
                response_type: Some("response".to_string()),
                response_data,
                latency_ms: Some(latency),
                error: None,
            })
        }
        Ok(Err(e)) => {
            // Check if ICMP unreachable
            let error_str = e.to_string().to_lowercase();
            let (response_type, reachable) =
                if error_str.contains("refused") || error_str.contains("unreachable") {
                    ("icmp_unreachable".to_string(), Some(false))
                } else {
                    ("error".to_string(), None)
                };

            Ok(UdpProbeResult {
                port,
                reachable,
                response_received: false,
                response_type: Some(response_type),
                response_data: None,
                latency_ms: None,
                error: Some(e.to_string()),
            })
        }
        Err(_) => {
            // Timeout - port could be open (filtered) or closed (no ICMP)
            Ok(UdpProbeResult {
                port,
                reachable: None, // Unknown - no response doesn't mean closed
                response_received: false,
                response_type: Some("timeout".to_string()),
                response_data: None,
                latency_ms: None,
                error: None,
            })
        }
    }
}

/// Lookup ASN and geolocation information for an IP address
/// Uses free public APIs with fallbacks
#[tauri::command]
pub async fn lookup_ip_geo(ip: String) -> Result<IpGeoInfo, String> {
    // Try ip-api.com first (free, no key required, 45 requests/minute)
    if let Ok(info) = lookup_ip_api(&ip).await {
        return Ok(info);
    }

    // Fallback to ipinfo.io (free tier, limited)
    if let Ok(info) = lookup_ipinfo(&ip).await {
        return Ok(info);
    }

    // Return minimal info if all APIs fail
    Ok(IpGeoInfo {
        ip: ip.clone(),
        asn: None,
        asn_org: None,
        country: None,
        country_code: None,
        region: None,
        city: None,
        isp: None,
        is_proxy: None,
        is_vpn: None,
        is_tor: None,
        is_datacenter: None,
        source: "none".to_string(),
        error: Some("All geolocation APIs failed".to_string()),
    })
}

/// Detect potential proxy/VPN leaks by checking DNS servers and public IP
#[tauri::command]
pub async fn detect_proxy_leakage(
    expected_exit_ip: Option<String>,
) -> Result<LeakageDetectionResult, String> {
    let mut notes = Vec::new();
    let mut dns_servers: Vec<String> = Vec::new();
    let mut dns_leak = false;
    let mut ip_mismatch = false;

    // Get our public IP using multiple services
    let public_ip = get_public_ip().await;

    // Check if public IP matches expected proxy exit
    if let (Some(ref detected), Some(ref expected)) = (&public_ip, &expected_exit_ip) {
        if detected != expected {
            ip_mismatch = true;
            notes.push(format!(
                "IP mismatch: detected {} but expected {}",
                detected, expected
            ));
        }
    }

    // Try to detect DNS servers by resolving known test domains
    // This is a simplified check - real DNS leak tests use specialized servers
    let dns_test_domains = ["whoami.akamai.net", "o-o.myaddr.l.google.com"];

    for domain in &dns_test_domains {
        if let Ok(result) = resolve_dns_with_server_detection(domain).await {
            for server in result {
                if !dns_servers.contains(&server) {
                    dns_servers.push(server);
                }
            }
        }
    }

    // Check DNS servers against known public DNS (potential leak indicators)
    let public_dns = [
        "8.8.8.8",
        "8.8.4.4",
        "1.1.1.1",
        "1.0.0.1",
        "9.9.9.9",
        "208.67.222.222",
    ];
    for server in &dns_servers {
        if public_dns.contains(&server.as_str()) {
            // Using public DNS while on VPN might indicate DNS leak
            // (though this isn't always the case)
            notes.push(format!("Using public DNS server: {}", server));
        }
    }

    // If expected proxy IP provided and we detect different DNS servers, could be leak
    if expected_exit_ip.is_some() && !dns_servers.is_empty() {
        // This is a heuristic - proper DNS leak detection requires specialized infrastructure
        dns_leak = dns_servers.iter().any(|s| public_dns.contains(&s.as_str()));

        if dns_leak {
            notes.push("DNS queries may not be going through VPN/proxy".to_string());
        }
    }

    // WebRTC leak is browser-side and can't be detected from Rust backend
    // Just note that it's a potential concern
    let webrtc_note = "WebRTC leaks can only be detected in browser context".to_string();
    notes.push(webrtc_note);

    // Determine overall status
    let overall_status = if ip_mismatch || dns_leak {
        "leak_detected"
    } else if expected_exit_ip.is_some() && !dns_servers.is_empty() {
        "potential_leak"
    } else {
        "secure"
    }
    .to_string();

    Ok(LeakageDetectionResult {
        dns_leak_detected: dns_leak,
        webrtc_leak_possible: true, // Always possible from browser
        ip_mismatch_detected: ip_mismatch,
        detected_public_ip: public_ip,
        expected_proxy_ip: expected_exit_ip,
        dns_servers_detected: dns_servers,
        notes,
        overall_status,
    })
}
