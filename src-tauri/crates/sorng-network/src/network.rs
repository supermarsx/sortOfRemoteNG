// Re-exported for use by network_cmds.rs (compiled via include!() in the app crate).
pub use dns_lookup::lookup_addr;
pub use futures::future::join_all;
use mac_address::get_mac_address;
use serde::{Deserialize, Serialize};
pub use std::process::Stdio;
use std::sync::Arc;
pub use tokio::io::{AsyncReadExt, AsyncWriteExt};
pub use tokio::net::TcpStream;
pub use tokio::process::Command;
use tokio::sync::Mutex;
pub use tokio::time::{timeout, Duration};

pub type NetworkServiceState = Arc<Mutex<NetworkService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredHost {
    pub id: String,
    pub ip: String,
    pub hostname: Option<String>,
    pub mac: Option<String>,
    pub services: Vec<DiscoveredService>,
    pub last_seen: u64,
    pub response_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredService {
    pub port: u16,
    pub protocol: String,
    pub service_name: String,
    pub status: String,
}

pub struct NetworkService {
    // Placeholder
}

impl NetworkService {
    pub fn new() -> NetworkServiceState {
        Arc::new(Mutex::new(NetworkService {}))
    }

    pub async fn ping_host(&self, host: String) -> Result<bool, String> {
        // Use system ping command
        let mut cmd = Command::new("ping");
        cmd.arg("-n")
            .arg("1") // Windows: -n 1 (1 packet)
            .arg("-w")
            .arg("1000") // Windows: -w 1000 (1 second timeout)
            .arg(&host)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let output = cmd
            .status()
            .await
            .map_err(|e| format!("Failed to execute ping: {}", e))?;

        Ok(output.success())
    }

    pub async fn ping_host_with_timing(&self, host: String) -> Result<(bool, Option<u64>), String> {
        let start = std::time::Instant::now();
        let result = self.ping_host(host).await;
        let elapsed = start.elapsed().as_millis() as u64;

        match result {
            Ok(true) => Ok((true, Some(elapsed))),
            Ok(false) => Ok((false, None)),
            Err(e) => Err(e),
        }
    }

    pub async fn resolve_hostname(&self, ip: &str) -> Option<String> {
        lookup_addr(&ip.parse().unwrap()).ok()
    }

    pub async fn get_mac_address(&self, _ip: &str) -> Option<String> {
        // This is a simplified implementation
        // In a real implementation, you'd use ARP table lookup or send ARP requests
        match get_mac_address() {
            Ok(Some(ma)) => Some(ma.to_string()),
            _ => None,
        }
    }

    pub async fn scan_port(&self, ip: &str, port: u16) -> Result<bool, String> {
        let addr = format!("{}:{}", ip, port);
        match timeout(Duration::from_millis(1000), TcpStream::connect(&addr)).await {
            Ok(Ok(_)) => Ok(true),
            Ok(Err(_)) => Ok(false),
            Err(_) => Ok(false),
        }
    }

    pub fn get_common_ports() -> Vec<(u16, String)> {
        vec![
            (22, "ssh".to_string()),
            (23, "telnet".to_string()),
            (25, "smtp".to_string()),
            (53, "dns".to_string()),
            (80, "http".to_string()),
            (110, "pop3".to_string()),
            (143, "imap".to_string()),
            (443, "https".to_string()),
            (993, "imaps".to_string()),
            (995, "pop3s".to_string()),
            (3389, "rdp".to_string()),
            (5900, "vnc".to_string()),
            (3306, "mysql".to_string()),
            (5432, "postgresql".to_string()),
            (6379, "redis".to_string()),
        ]
    }

    pub async fn discover_services(&self, ip: &str, ports: Vec<u16>) -> Vec<DiscoveredService> {
        let mut services = Vec::new();

        for port in ports {
            if let Ok(true) = self.scan_port(ip, port).await {
                let service_name = NetworkService::get_common_ports()
                    .iter()
                    .find(|(p, _)| *p == port)
                    .map(|(_, name)| name.clone())
                    .unwrap_or_else(|| "unknown".to_string());

                services.push(DiscoveredService {
                    port,
                    protocol: "tcp".to_string(),
                    service_name,
                    status: "open".to_string(),
                });
            }
        }

        services
    }

    pub async fn scan_network_comprehensive(
        &self,
        subnet: String,
        scan_ports: bool,
    ) -> Result<Vec<DiscoveredHost>, String> {
        let mut discovered_hosts = Vec::new();

        // Parse subnet (e.g., "192.168.1.0/24" -> "192.168.1")
        let base_ip = if subnet.contains('/') {
            subnet.split('/').next().unwrap().to_string()
        } else {
            subnet.clone()
        };

        // Extract base IP parts
        let parts: Vec<&str> = base_ip.split('.').collect();
        if parts.len() != 4 {
            return Err("Invalid subnet format".to_string());
        }

        let base = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
        let start_octet: u8 = parts[3].parse().unwrap_or(1);
        let end_octet: u8 = if subnet.contains("/24") {
            254
        } else {
            start_octet + 10
        };

        // Scan IP range concurrently
        let mut handles = vec![];

        for i in start_octet..=end_octet {
            let ip = format!("{}.{}", base, i);
            let ip_clone = ip.clone();

            let handle = tokio::spawn(async move {
                // Check if host is up
                let network_service = NetworkService::new();
                let network = network_service.lock().await;

                match network.ping_host_with_timing(ip_clone.clone()).await {
                    Ok((true, response_time)) => {
                        // Host is up, gather more info
                        let hostname = network.resolve_hostname(&ip_clone).await;
                        let mac = network.get_mac_address(&ip_clone).await;

                        let services = if scan_ports {
                            let common_ports: Vec<u16> = NetworkService::get_common_ports()
                                .iter()
                                .map(|(port, _)| *port)
                                .collect();
                            network.discover_services(&ip_clone, common_ports).await
                        } else {
                            Vec::new()
                        };

                        Some(DiscoveredHost {
                            id: uuid::Uuid::new_v4().to_string(),
                            ip: ip_clone,
                            hostname,
                            mac,
                            services,
                            last_seen: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_secs(),
                            response_time,
                        })
                    }
                    _ => None,
                }
            });
            handles.push(handle);
        }

        // Wait for all scans to complete
        for handle in handles {
            if let Ok(Some(host)) = handle.await {
                discovered_hosts.push(host);
            }
        }

        Ok(discovered_hosts)
    }

    pub async fn scan_network(&self, subnet: String) -> Result<Vec<String>, String> {
        let mut results = Vec::new();

        // Parse subnet (e.g., "192.168.1.0/24" -> "192.168.1")
        let base_ip = if subnet.contains('/') {
            subnet.split('/').next().unwrap().to_string()
        } else {
            subnet.clone()
        };

        // Extract base IP parts
        let parts: Vec<&str> = base_ip.split('.').collect();
        if parts.len() != 4 {
            return Err("Invalid subnet format".to_string());
        }

        let base = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
        let start_octet: u8 = parts[3].parse().unwrap_or(1);
        let end_octet: u8 = if subnet.contains("/24") {
            254
        } else {
            start_octet + 10
        };

        // Scan IP range concurrently
        let mut handles = vec![];

        for i in start_octet..=end_octet {
            let ip = format!("{}.{}", base, i);
            let ip_clone = ip.clone();
            let handle = tokio::spawn(async move {
                // Simple ping check - in production, you'd want more sophisticated scanning
                let mut cmd = Command::new("ping");
                cmd.arg("-n")
                    .arg("1")
                    .arg("-w")
                    .arg("500") // Shorter timeout for scanning
                    .arg(&ip_clone)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());

                match cmd.status().await {
                    Ok(status) if status.success() => Some(ip_clone),
                    _ => None,
                }
            });
            handles.push(handle);
        }

        // Wait for all ping operations to complete
        for handle in handles {
            if let Ok(Some(ip)) = handle.await {
                results.push(ip);
            }
        }

        Ok(results)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub success: bool,
    pub time_ms: Option<u64>,
    pub error: Option<String>,
}

/// Parse ping time from ping command output
pub fn parse_ping_time(output: &str) -> Option<u64> {
    // Windows: "time=XXms" or "time<1ms"
    // Unix: "time=XX.X ms"
    for line in output.lines() {
        let line_lower = line.to_lowercase();
        if let Some(pos) = line_lower.find("time=") {
            let after_time = &line[pos + 5..];
            let num_str: String = after_time
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(ms) = num_str.parse::<f64>() {
                return Some(ms.round() as u64);
            }
        }
        if line_lower.contains("time<1ms") || line_lower.contains("time<1 ms") {
            return Some(1);
        }
    }
    None
}

pub fn get_default_gateway() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, use ipconfig
        let output = std::process::Command::new("ipconfig")
            .output()
            .map_err(|e| format!("Failed to get gateway: {}", e))?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            if line.contains("Default Gateway") && line.contains(":") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() > 1 {
                    let gateway = parts[1].trim();
                    if !gateway.is_empty() && gateway.contains('.') {
                        return Ok(gateway.to_string());
                    }
                }
            }
        }
        Err("Could not find default gateway".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| format!("Failed to get gateway: {}", e))?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() > 2 && parts[0] == "default" {
                return Ok(parts[2].to_string());
            }
        }
        Err("Could not find default gateway".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("netstat")
            .args(["-nr"])
            .output()
            .map_err(|e| format!("Failed to get gateway: {}", e))?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            if line.starts_with("default") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() > 1 {
                    return Ok(parts[1].to_string());
                }
            }
        }
        Err("Could not find default gateway".to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err("Gateway detection not supported on this platform".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortCheckResult {
    pub port: u16,
    pub open: bool,
    pub service: Option<String>,
    pub time_ms: Option<u64>,
    pub banner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResult {
    pub success: bool,
    pub resolved_ips: Vec<String>,
    pub reverse_dns: Option<String>,
    pub resolution_time_ms: u64,
    pub dns_server: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpClassification {
    pub ip: String,
    pub ip_type: String, // "private", "public", "loopback", "link_local", "cgnat", "multicast"
    pub ip_class: Option<String>, // "A", "B", "C", "D", "E" for IPv4
    pub is_ipv6: bool,
    pub network_info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteHop {
    pub hop: u32,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub time_ms: Option<u64>,
    pub timeout: bool,
}

// ============================================================================
// Advanced Diagnostics
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpTimingResult {
    pub connect_time_ms: u64,
    pub syn_ack_time_ms: Option<u64>,
    pub total_time_ms: u64,
    pub success: bool,
    pub slow_connection: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtuCheckResult {
    pub path_mtu: Option<u32>,
    pub fragmentation_needed: bool,
    pub recommended_mtu: u32,
    pub test_results: Vec<MtuTestPoint>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtuTestPoint {
    pub size: u32,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcmpBlockadeResult {
    pub icmp_allowed: bool,
    pub tcp_reachable: bool,
    pub likely_blocked: bool,
    pub diagnosis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCheckResult {
    pub tls_supported: bool,
    pub tls_version: Option<String>,
    pub certificate_valid: bool,
    pub certificate_subject: Option<String>,
    pub certificate_issuer: Option<String>,
    pub certificate_expiry: Option<String>,
    pub handshake_time_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceFingerprint {
    pub port: u16,
    pub service: String,
    pub version: Option<String>,
    pub banner: Option<String>,
    pub protocol_detected: Option<String>,
    pub response_preview: Option<String>,
}

// ============================================================================
// Asymmetric Routing Detection
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsymmetricRoutingResult {
    pub asymmetry_detected: bool,
    pub confidence: String, // "high", "medium", "low", "none"
    pub outbound_hops: Vec<String>,
    pub ttl_analysis: TtlAnalysis,
    pub latency_variance: Option<f64>,
    pub path_stability: String, // "stable", "unstable", "unknown"
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtlAnalysis {
    pub expected_ttl: Option<u8>,
    pub received_ttl: Option<u8>,
    pub estimated_hops: Option<u8>,
    pub ttl_consistent: bool,
}

pub fn parse_ttl_from_ping(output: &str) -> Option<u8> {
    let lower = output.to_lowercase();
    // Windows: TTL=64, Unix: ttl=64
    if let Some(idx) = lower.find("ttl=") {
        let start = idx + 4;
        let end = lower[start..]
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(lower.len() - start);
        lower[start..start + end].parse().ok()
    } else {
        None
    }
}

pub fn parse_latency_from_ping(output: &str) -> Option<f64> {
    let lower = output.to_lowercase();
    // Windows: time=23ms or time<1ms, Unix: time=23.4 ms
    if let Some(idx) = lower.find("time=") {
        let start = idx + 5;
        let end = lower[start..]
            .find(|c: char| !c.is_ascii_digit() && c != '.')
            .unwrap_or(lower.len() - start);
        lower[start..start + end].parse().ok()
    } else if lower.contains("time<1") {
        Some(0.5)
    } else {
        None
    }
}

pub fn extract_ip_from_traceroute_line(line: &str) -> Option<String> {
    // Look for IP address pattern in the line
    let parts: Vec<&str> = line.split_whitespace().collect();
    for part in parts {
        let trimmed = part.trim_matches(|c| c == '[' || c == ']' || c == '(' || c == ')');
        if is_valid_ip(trimmed) {
            return Some(trimmed.to_string());
        }
    }
    None
}

pub fn is_valid_ip(s: &str) -> bool {
    s.parse::<std::net::Ipv4Addr>().is_ok() || s.parse::<std::net::Ipv6Addr>().is_ok()
}

pub fn analyze_ttl(ttl_values: &[u8]) -> TtlAnalysis {
    if ttl_values.is_empty() {
        return TtlAnalysis {
            expected_ttl: None,
            received_ttl: None,
            estimated_hops: None,
            ttl_consistent: true,
        };
    }

    let first_ttl = ttl_values[0];
    let ttl_consistent = ttl_values.iter().all(|&t| t == first_ttl);

    // Common initial TTL values: 64 (Linux), 128 (Windows), 255 (Cisco/network devices)
    let expected_ttl = if first_ttl <= 64 {
        Some(64)
    } else if first_ttl <= 128 {
        Some(128)
    } else {
        Some(255)
    };

    let estimated_hops = expected_ttl.map(|e| e - first_ttl);

    TtlAnalysis {
        expected_ttl,
        received_ttl: Some(first_ttl),
        estimated_hops,
        ttl_consistent,
    }
}

// ============================================================================
// UDP Reachability Probe
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UdpProbeResult {
    pub port: u16,
    pub reachable: Option<bool>, // None = unknown (no response)
    pub response_received: bool,
    pub response_type: Option<String>, // "response", "icmp_unreachable", "timeout"
    pub response_data: Option<String>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

// ============================================================================
// ASN/Geo Detection
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpGeoInfo {
    pub ip: String,
    pub asn: Option<u32>,
    pub asn_org: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub isp: Option<String>,
    pub is_proxy: Option<bool>,
    pub is_vpn: Option<bool>,
    pub is_tor: Option<bool>,
    pub is_datacenter: Option<bool>,
    pub source: String, // API used
    pub error: Option<String>,
}

pub async fn lookup_ip_api(ip: &str) -> Result<IpGeoInfo, String> {
    let url = format!("http://ip-api.com/json/{}?fields=status,message,country,countryCode,region,city,isp,org,as,asname,proxy,hosting,query", ip);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned status: {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if json.get("status").and_then(|s| s.as_str()) != Some("success") {
        return Err(json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    // Parse ASN number from "as" field (format: "AS12345 Organization Name")
    let as_field = json.get("as").and_then(|a| a.as_str()).unwrap_or("");
    let asn = if let Some(stripped) = as_field.strip_prefix("AS") {
        stripped
            .split_whitespace()
            .next()
            .and_then(|n| n.parse().ok())
    } else {
        None
    };

    Ok(IpGeoInfo {
        ip: json
            .get("query")
            .and_then(|q| q.as_str())
            .unwrap_or(ip)
            .to_string(),
        asn,
        asn_org: json
            .get("asname")
            .and_then(|a| a.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                json.get("org")
                    .and_then(|o| o.as_str())
                    .map(|s| s.to_string())
            }),
        country: json
            .get("country")
            .and_then(|c| c.as_str())
            .map(|s| s.to_string()),
        country_code: json
            .get("countryCode")
            .and_then(|c| c.as_str())
            .map(|s| s.to_string()),
        region: json
            .get("region")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string()),
        city: json
            .get("city")
            .and_then(|c| c.as_str())
            .map(|s| s.to_string()),
        isp: json
            .get("isp")
            .and_then(|i| i.as_str())
            .map(|s| s.to_string()),
        is_proxy: json.get("proxy").and_then(|p| p.as_bool()),
        is_vpn: None, // ip-api doesn't differentiate VPN
        is_tor: None,
        is_datacenter: json.get("hosting").and_then(|h| h.as_bool()),
        source: "ip-api.com".to_string(),
        error: None,
    })
}

pub async fn lookup_ipinfo(ip: &str) -> Result<IpGeoInfo, String> {
    let url = format!("https://ipinfo.io/{}/json", ip);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned status: {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Parse ASN from org field (format: "AS12345 Organization Name")
    let org = json.get("org").and_then(|o| o.as_str()).unwrap_or("");
    let asn = if let Some(stripped) = org.strip_prefix("AS") {
        stripped
            .split_whitespace()
            .next()
            .and_then(|n| n.parse().ok())
    } else {
        None
    };
    let asn_org = if org.contains(' ') {
        Some(org.split_once(' ').map(|x| x.1).unwrap_or("").to_string())
    } else {
        None
    };

    Ok(IpGeoInfo {
        ip: json
            .get("ip")
            .and_then(|i| i.as_str())
            .unwrap_or(ip)
            .to_string(),
        asn,
        asn_org,
        country: json
            .get("country")
            .and_then(|c| c.as_str())
            .map(|s| s.to_string()),
        country_code: json
            .get("country")
            .and_then(|c| c.as_str())
            .map(|s| s.to_string()),
        region: json
            .get("region")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string()),
        city: json
            .get("city")
            .and_then(|c| c.as_str())
            .map(|s| s.to_string()),
        isp: None,
        is_proxy: None,
        is_vpn: None,
        is_tor: None,
        is_datacenter: None,
        source: "ipinfo.io".to_string(),
        error: None,
    })
}

// ============================================================================
// Proxy/VPN Leakage Detection
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakageDetectionResult {
    pub dns_leak_detected: bool,
    pub webrtc_leak_possible: bool,
    pub ip_mismatch_detected: bool,
    pub detected_public_ip: Option<String>,
    pub expected_proxy_ip: Option<String>,
    pub dns_servers_detected: Vec<String>,
    pub notes: Vec<String>,
    pub overall_status: String, // "secure", "potential_leak", "leak_detected"
}

pub async fn get_public_ip() -> Option<String> {
    let services = [
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
        "https://icanhazip.com",
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;

    for service in &services {
        if let Ok(response) = client.get(*service).send().await {
            if let Ok(ip) = response.text().await {
                let ip = ip.trim().to_string();
                if is_valid_ip(&ip) {
                    return Some(ip);
                }
            }
        }
    }

    None
}

pub async fn resolve_dns_with_server_detection(_domain: &str) -> Result<Vec<String>, String> {
    // This is a simplified implementation
    // Real DNS leak detection requires specialized test infrastructure
    // that returns the resolver's IP in the DNS response

    // For now, just return system DNS servers from config
    let mut servers = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Try to get DNS servers from ipconfig
        if let Ok(output) = Command::new("ipconfig").arg("/all").output().await {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.to_lowercase().contains("dns servers")
                    || (line.starts_with("   ")
                        && line.trim().parse::<std::net::Ipv4Addr>().is_ok())
                {
                    let parts: Vec<&str> = line.split(':').collect();
                    if parts.len() > 1 {
                        let ip = parts[1].trim();
                        if is_valid_ip(ip) {
                            servers.push(ip.to_string());
                        }
                    } else {
                        let ip = line.trim();
                        if is_valid_ip(ip) {
                            servers.push(ip.to_string());
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Try to read from /etc/resolv.conf
        if let Ok(content) = tokio::fs::read_to_string("/etc/resolv.conf").await {
            for line in content.lines() {
                if line.starts_with("nameserver") {
                    if let Some(ip) = line.split_whitespace().nth(1) {
                        if is_valid_ip(ip) {
                            servers.push(ip.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(servers)
}

/// Perform reverse DNS lookup for an IP address
pub async fn reverse_dns_lookup(ip: &str) -> Option<String> {
    // Parse the IP address
    let addr: std::net::IpAddr = match ip.parse() {
        Ok(a) => a,
        Err(_) => return None,
    };

    // Use tokio's spawn_blocking since dns_lookup is synchronous
    let result = tokio::task::spawn_blocking(move || lookup_addr(&addr).ok()).await;

    match result {
        Ok(Some(hostname)) => {
            // Don't return if hostname is just the IP address
            if hostname != ip {
                Some(hostname)
            } else {
                None
            }
        }
        _ => None,
    }
}

