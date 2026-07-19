use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::future::Future;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task;

pub type WolServiceState = Arc<Mutex<WolService>>;

const DEFAULT_BROADCAST_ADDRESS: &str = "255.255.255.255";
const DNS_RESOLUTION_TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WolDevice {
    pub ip: String,
    pub mac: String,
    pub hostname: Option<String>,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WolSchedule {
    pub id: String,
    pub mac_address: String,
    pub name: Option<String>,
    pub broadcast_address: String,
    pub port: u16,
    pub password: Option<String>,
    #[serde(default)]
    pub target_address: Option<String>,
    pub wake_time: String,
    pub recurrence: Option<String>,
    pub enabled: bool,
}

pub struct WolService {
    schedules: Vec<WolSchedule>,
}

#[derive(Debug)]
struct WolDeliveryPlan {
    broadcast_destinations: Vec<SocketAddr>,
    target_destinations: Vec<SocketAddr>,
    used_limited_broadcast_fallback: bool,
    target_was_requested: bool,
    warnings: Vec<String>,
}

impl WolDeliveryPlan {
    fn destinations(&self) -> Vec<SocketAddr> {
        let mut seen = HashSet::new();
        self.broadcast_destinations
            .iter()
            .chain(&self.target_destinations)
            .copied()
            .filter(|address| seen.insert(*address))
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WolSendOutcome {
    pub sent_to: Vec<String>,
    pub warnings: Vec<String>,
    pub configured_broadcast_delivered: bool,
    pub limited_broadcast_fallback_delivered: bool,
    pub resolved_target_delivered: bool,
    pub target_resolution_failed: bool,
}

#[derive(Debug)]
struct WolSendReport {
    sent_to: HashSet<SocketAddr>,
    errors: Vec<String>,
}

fn normalize_address(address: &str) -> &str {
    let address = address.trim();
    address
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(address)
}

fn socket_target(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{}]:{}", host, port)
    } else {
        format!("{}:{}", host, port)
    }
}

async fn finish_dns_lookup<F>(
    hostname: &str,
    timeout: Duration,
    lookup: F,
) -> Result<Vec<SocketAddr>, String>
where
    F: Future<Output = io::Result<Vec<SocketAddr>>>,
{
    let resolved = tokio::time::timeout(timeout, lookup)
        .await
        .map_err(|_| {
            format!(
                "DNS resolution for '{}' timed out after {} ms",
                hostname,
                timeout.as_millis()
            )
        })?
        .map_err(|error| format!("DNS resolution for '{}' failed: {}", hostname, error))?;

    let mut seen = HashSet::new();
    let destinations: Vec<_> = resolved
        .into_iter()
        .filter(|address| seen.insert(*address))
        .collect();
    if destinations.is_empty() {
        return Err(format!(
            "DNS resolution for '{}' returned no usable IP addresses",
            hostname
        ));
    }
    Ok(destinations)
}

async fn resolve_wol_address_with_timeout(
    address: &str,
    port: u16,
    timeout: Duration,
) -> Result<Vec<SocketAddr>, String> {
    let address = normalize_address(address);
    if address.is_empty() {
        return Err("Wake-on-LAN address cannot be empty".to_string());
    }

    if let Ok(ip) = address.parse::<IpAddr>() {
        return Ok(vec![SocketAddr::new(ip, port)]);
    }

    // DNS host names are capped at 253 characters. Rejecting longer values also
    // keeps malformed URL/path input away from the OS resolver.
    if address.len() > 253 || address.chars().any(char::is_whitespace) {
        return Err(format!("Invalid Wake-on-LAN host name '{}'", address));
    }

    let hostname = address.to_string();
    let target = socket_target(&hostname, port);
    let lookup = async move {
        tokio::net::lookup_host(target)
            .await
            .map(|addresses| addresses.collect::<Vec<_>>())
    };
    finish_dns_lookup(&hostname, timeout, lookup).await
}

async fn build_delivery_plan(
    broadcast_address: Option<&str>,
    target_address: Option<&str>,
    port: u16,
    timeout: Duration,
) -> WolDeliveryPlan {
    let configured_broadcast = broadcast_address
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .unwrap_or(DEFAULT_BROADCAST_ADDRESS);
    let target = target_address
        .map(str::trim)
        .filter(|address| !address.is_empty());
    let broadcast_lookup = resolve_wol_address_with_timeout(configured_broadcast, port, timeout);
    let target_lookup = async {
        match target {
            Some(address) => Some(resolve_wol_address_with_timeout(address, port, timeout).await),
            None => None,
        }
    };
    let (broadcast_resolution, target_resolution) = tokio::join!(broadcast_lookup, target_lookup);

    let mut warnings = Vec::new();
    let mut used_limited_broadcast_fallback = false;
    let broadcast_destinations = match broadcast_resolution {
        Ok(destinations) => destinations,
        Err(error) => {
            used_limited_broadcast_fallback = true;
            warnings.push(format!(
                "{}; using limited broadcast {} instead",
                error, DEFAULT_BROADCAST_ADDRESS
            ));
            vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), port)]
        }
    };

    // A host/FQDN is an additional best-effort destination. The broadcast is
    // always retained because the target machine may be offline and therefore
    // unable to answer ARP/NDP even when its name resolves successfully.
    let target_destinations = match target_resolution {
        Some(resolution) => match resolution {
            Ok(resolved) => resolved,
            Err(error) => {
                warnings.push(format!(
                    "{}; continuing with the available broadcast destination",
                    error
                ));
                Vec::new()
            }
        },
        None => Vec::new(),
    };

    WolDeliveryPlan {
        broadcast_destinations,
        target_destinations,
        used_limited_broadcast_fallback,
        target_was_requested: target.is_some(),
        warnings,
    }
}

fn parse_hex_six_bytes(value: &str, label: &str) -> Result<Vec<u8>, String> {
    let cleaned = value.replace([':', '-'], "");
    if cleaned.len() != 12 {
        return Err(format!("{} must be 6 bytes (12 hex characters)", label));
    }
    (0..6)
        .map(|index| {
            u8::from_str_radix(&cleaned[index * 2..index * 2 + 2], 16)
                .map_err(|_| format!("Invalid {}", label))
        })
        .collect()
}

fn build_magic_packet(mac_address: &str, password: Option<&str>) -> Result<Vec<u8>, String> {
    let mac_bytes = parse_hex_six_bytes(mac_address, "MAC address")?;
    let mut packet = vec![0xFF; 6];
    for _ in 0..16 {
        packet.extend(&mac_bytes);
    }
    if let Some(password) = password {
        packet.extend(parse_hex_six_bytes(password, "SecureOn password")?);
    }
    Ok(packet)
}

fn send_magic_packet(packet: &[u8], destinations: &[SocketAddr]) -> Result<WolSendReport, String> {
    let mut sent_to = HashSet::new();
    let mut errors = Vec::new();

    for destination in destinations {
        let bind_address = if destination.is_ipv4() {
            "0.0.0.0:0"
        } else {
            "[::]:0"
        };
        let result = (|| {
            let socket = UdpSocket::bind(bind_address)?;
            if destination.is_ipv4() {
                socket.set_broadcast(true)?;
            }
            socket.send_to(packet, destination)?;
            Ok::<(), io::Error>(())
        })();

        match result {
            Ok(()) => {
                sent_to.insert(*destination);
            }
            Err(error) => errors.push(format!("{}: {}", destination, error)),
        }
    }

    if !sent_to.is_empty() {
        Ok(WolSendReport { sent_to, errors })
    } else {
        Err(format!(
            "Failed to send Wake-on-LAN packet to any destination: {}",
            errors.join("; ")
        ))
    }
}

fn build_send_outcome(plan: &WolDeliveryPlan, report: &WolSendReport) -> WolSendOutcome {
    let broadcast_delivered = plan
        .broadcast_destinations
        .iter()
        .any(|address| report.sent_to.contains(address));
    let resolved_target_delivered = plan
        .target_destinations
        .iter()
        .any(|address| report.sent_to.contains(address));
    let mut sent_to: Vec<_> = report.sent_to.iter().map(ToString::to_string).collect();
    sent_to.sort();

    let mut warnings = plan.warnings.clone();
    warnings.extend(
        report
            .errors
            .iter()
            .map(|error| format!("Wake packet delivery failed for {}", error)),
    );

    WolSendOutcome {
        sent_to,
        warnings,
        configured_broadcast_delivered: broadcast_delivered
            && !plan.used_limited_broadcast_fallback,
        limited_broadcast_fallback_delivered: broadcast_delivered
            && plan.used_limited_broadcast_fallback,
        resolved_target_delivered,
        target_resolution_failed: plan.target_was_requested && plan.target_destinations.is_empty(),
    }
}

impl WolService {
    pub fn new() -> WolServiceState {
        Arc::new(Mutex::new(WolService {
            schedules: Vec::new(),
        }))
    }

    /// Send a Wake-on-LAN magic packet in a dedicated thread
    /// Supports optional SecureOn password (6-byte password appended to packet)
    pub async fn wake_on_lan(
        &self,
        mac_address: String,
        broadcast_address: Option<String>,
        port: Option<u16>,
        password: Option<String>,
        target_address: Option<String>,
    ) -> Result<WolSendOutcome, String> {
        let wol_port = port.unwrap_or(9);
        let packet = build_magic_packet(&mac_address, password.as_deref())?;
        let plan = build_delivery_plan(
            broadcast_address.as_deref(),
            target_address.as_deref(),
            wol_port,
            DNS_RESOLUTION_TIMEOUT,
        )
        .await;
        for warning in &plan.warnings {
            log::warn!("Wake-on-LAN: {}", warning);
        }

        let destinations = plan.destinations();
        let report = task::spawn_blocking(move || send_magic_packet(&packet, &destinations))
            .await
            .map_err(|e| format!("Task join error: {}", e))??;
        for warning in &report.errors {
            log::warn!("Wake-on-LAN: delivery failed for {}", warning);
        }
        Ok(build_send_outcome(&plan, &report))
    }

    /// Wake multiple hosts in parallel, each in its own thread
    pub async fn wake_multiple(
        &self,
        mac_addresses: Vec<String>,
        broadcast_address: Option<String>,
        port: Option<u16>,
    ) -> Result<Vec<Result<(), String>>, String> {
        let wol_port = port.unwrap_or(9);
        let plan = build_delivery_plan(
            broadcast_address.as_deref(),
            None,
            wol_port,
            DNS_RESOLUTION_TIMEOUT,
        )
        .await;
        for warning in &plan.warnings {
            log::warn!("Wake-on-LAN: {}", warning);
        }
        let destinations = plan.destinations();

        // Spawn a thread for each host
        let handles: Vec<_> = mac_addresses
            .into_iter()
            .map(|mac_address| {
                let destinations = destinations.clone();
                task::spawn_blocking(move || {
                    let packet = build_magic_packet(&mac_address, None)?;
                    send_magic_packet(&packet, &destinations).map(|_| ())
                })
            })
            .collect();

        // Wait for all threads to complete
        let mut results = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(result) => results.push(result),
                Err(e) => results.push(Err(format!("Task join error: {}", e))),
            }
        }

        Ok(results)
    }

    /// Discover devices by scanning ARP table in a dedicated thread
    pub async fn discover_devices(&self) -> Result<Vec<WolDevice>, String> {
        task::spawn_blocking(|| {
            let mut devices = Vec::new();

            #[cfg(target_os = "windows")]
            {
                let output = Command::new("arp")
                    .arg("-a")
                    .output()
                    .map_err(|e| format!("Failed to execute arp command: {}", e))?;

                let stdout = String::from_utf8_lossy(&output.stdout);

                for line in stdout.lines() {
                    // Windows ARP output format: "  192.168.1.1       00-11-22-33-44-55     dynamic"
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let ip = parts[0];
                        let mac = parts[1];

                        // Validate IP and MAC format
                        if ip.contains('.') && (mac.contains('-') || mac.contains(':')) {
                            let normalized_mac = mac.replace("-", ":").to_lowercase();
                            if normalized_mac.len() == 17 {
                                devices.push(WolDevice {
                                    ip: ip.to_string(),
                                    mac: normalized_mac,
                                    hostname: None,
                                    last_seen: Some(chrono::Utc::now().to_rfc3339()),
                                });
                            }
                        }
                    }
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                let output = Command::new("arp")
                    .arg("-n")
                    .output()
                    .map_err(|e| format!("Failed to execute arp command: {}", e))?;

                let stdout = String::from_utf8_lossy(&output.stdout);

                for line in stdout.lines().skip(1) {
                    // Linux ARP output format: "Address    HWtype  HWaddress          Flags Mask    Iface"
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let ip = parts[0];
                        let mac = parts[2];

                        if ip.contains('.') && mac.contains(':') && mac.len() == 17 {
                            devices.push(WolDevice {
                                ip: ip.to_string(),
                                mac: mac.to_lowercase(),
                                hostname: None,
                                last_seen: Some(chrono::Utc::now().to_rfc3339()),
                            });
                        }
                    }
                }
            }

            // Try to resolve hostnames in parallel for efficiency
            let device_ips: Vec<String> = devices.iter().map(|d| d.ip.clone()).collect();
            let hostname_handles: Vec<_> = device_ips
                .into_iter()
                .map(|ip| {
                    std::thread::spawn(move || {
                        if let Ok(output) = Command::new("nslookup").arg(&ip).output() {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            for line in stdout.lines() {
                                if line.contains("name =") || line.contains("Name:") {
                                    if let Some(name) = line.split(['=', ':']).next_back() {
                                        let name = name.trim().trim_end_matches('.');
                                        if !name.is_empty() {
                                            return Some(name.to_string());
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                        None
                    })
                })
                .collect();

            // Collect hostname results
            for (device, handle) in devices.iter_mut().zip(hostname_handles) {
                match handle.join() {
                    Ok(hostname) => device.hostname = hostname,
                    Err(_) => log::warn!("Hostname resolution thread panicked for {}", device.ip),
                }
            }

            Ok(devices)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }

    /// Add a WOL schedule
    pub fn add_schedule(&mut self, schedule: WolSchedule) -> Result<String, String> {
        let id = schedule.id.clone();
        self.schedules.push(schedule);
        Ok(id)
    }

    /// Remove a WOL schedule
    pub fn remove_schedule(&mut self, schedule_id: &str) -> Result<(), String> {
        let initial_len = self.schedules.len();
        self.schedules.retain(|s| s.id != schedule_id);
        if self.schedules.len() == initial_len {
            Err("Schedule not found".to_string())
        } else {
            Ok(())
        }
    }

    /// List all schedules
    pub fn list_schedules(&self) -> Vec<WolSchedule> {
        self.schedules.clone()
    }

    /// Update a schedule
    pub fn update_schedule(&mut self, schedule: WolSchedule) -> Result<(), String> {
        if let Some(existing) = self.schedules.iter_mut().find(|s| s.id == schedule.id) {
            *existing = schedule;
            Ok(())
        } else {
            Err("Schedule not found".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_schedule(id: &str) -> WolSchedule {
        WolSchedule {
            id: id.to_string(),
            mac_address: "AA:BB:CC:DD:EE:FF".to_string(),
            name: Some("Test".to_string()),
            broadcast_address: "255.255.255.255".to_string(),
            port: 9,
            password: None,
            target_address: None,
            wake_time: "08:00".to_string(),
            recurrence: None,
            enabled: true,
        }
    }

    // ── Address resolution / delivery planning ──────────────────────────

    #[tokio::test]
    async fn literal_ipv4_is_preserved_without_dns() {
        let destinations =
            resolve_wol_address_with_timeout("192.168.50.255", 9, Duration::from_millis(50))
                .await
                .unwrap();
        assert_eq!(
            destinations,
            vec!["192.168.50.255:9".parse::<SocketAddr>().unwrap()]
        );
    }

    #[tokio::test]
    async fn literal_ipv6_is_preserved_without_dns() {
        let destinations =
            resolve_wol_address_with_timeout("[2001:db8::10]", 7, Duration::from_millis(50))
                .await
                .unwrap();
        assert_eq!(
            destinations,
            vec!["[2001:db8::10]:7".parse::<SocketAddr>().unwrap()]
        );
    }

    #[tokio::test]
    async fn resolvable_name_returns_usable_ip_destinations() {
        let destinations = resolve_wol_address_with_timeout("localhost", 9, Duration::from_secs(1))
            .await
            .unwrap();
        assert!(destinations
            .iter()
            .all(|address| address.ip().is_loopback()));
        assert!(destinations.iter().all(|address| address.port() == 9));
    }

    #[tokio::test]
    async fn failed_name_keeps_limited_broadcast_fallback() {
        let plan = build_delivery_plan(
            Some("not a valid host name"),
            None,
            9,
            Duration::from_millis(50),
        )
        .await;
        assert_eq!(
            plan.destinations(),
            vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), 9)]
        );
        assert!(plan.used_limited_broadcast_fallback);
        assert!(plan.warnings[0].contains("using limited broadcast"));
    }

    #[tokio::test]
    async fn failed_target_name_does_not_remove_valid_broadcast() {
        let plan = build_delivery_plan(
            Some("192.168.50.255"),
            Some("not a valid host name"),
            9,
            Duration::from_millis(50),
        )
        .await;
        assert_eq!(
            plan.destinations(),
            vec!["192.168.50.255:9".parse::<SocketAddr>().unwrap()]
        );
        assert!(plan.target_was_requested);
        assert!(plan.target_destinations.is_empty());
        assert!(plan.warnings[0].contains("continuing with the available broadcast"));
    }

    #[tokio::test]
    async fn dns_lookup_deduplicates_addresses() {
        let address = "127.0.0.1:9".parse::<SocketAddr>().unwrap();
        let destinations = finish_dns_lookup(
            "duplicate.example",
            Duration::from_millis(50),
            std::future::ready(Ok(vec![address, address])),
        )
        .await
        .unwrap();
        assert_eq!(destinations, vec![address]);
    }

    #[tokio::test]
    async fn dns_lookup_rejects_empty_results() {
        let error = finish_dns_lookup(
            "empty.example",
            Duration::from_millis(50),
            std::future::ready(Ok(Vec::new())),
        )
        .await
        .unwrap_err();
        assert_eq!(
            error,
            "DNS resolution for 'empty.example' returned no usable IP addresses"
        );
    }

    #[tokio::test]
    async fn dns_timeout_message_is_bounded_and_actionable() {
        let error = finish_dns_lookup(
            "slow.example",
            Duration::from_millis(5),
            std::future::pending::<io::Result<Vec<SocketAddr>>>(),
        )
        .await
        .unwrap_err();
        assert_eq!(
            error,
            "DNS resolution for 'slow.example' timed out after 5 ms"
        );
    }

    #[tokio::test]
    async fn dns_error_message_keeps_resolver_context() {
        let error = finish_dns_lookup(
            "missing.example",
            Duration::from_millis(50),
            std::future::ready(Err(io::Error::new(
                io::ErrorKind::NotFound,
                "resolver unavailable",
            ))),
        )
        .await
        .unwrap_err();
        assert!(error.contains("DNS resolution for 'missing.example' failed"));
        assert!(error.contains("resolver unavailable"));
    }

    #[test]
    fn magic_packet_preserves_standard_and_secureon_layouts() {
        let standard = build_magic_packet("AA:BB:CC:DD:EE:FF", None).unwrap();
        assert_eq!(standard.len(), 102);
        assert_eq!(&standard[..6], &[0xFF; 6]);
        assert_eq!(&standard[6..12], &[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
        assert_eq!(&standard[96..102], &[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);

        let secure = build_magic_packet("AA:BB:CC:DD:EE:FF", Some("01:02:03:04:05:06")).unwrap();
        assert_eq!(secure.len(), 108);
        assert_eq!(&secure[102..], &[1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn structured_outcome_distinguishes_limited_fallback_and_target() {
        let fallback = SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), 9);
        let target = "127.0.0.1:9".parse::<SocketAddr>().unwrap();
        let plan = WolDeliveryPlan {
            broadcast_destinations: vec![fallback],
            target_destinations: vec![target],
            used_limited_broadcast_fallback: true,
            target_was_requested: true,
            warnings: vec!["configured broadcast did not resolve".to_string()],
        };
        let report = WolSendReport {
            sent_to: HashSet::from([fallback, target]),
            errors: Vec::new(),
        };

        let outcome = build_send_outcome(&plan, &report);
        assert!(!outcome.configured_broadcast_delivered);
        assert!(outcome.limited_broadcast_fallback_delivered);
        assert!(outcome.resolved_target_delivered);
        assert!(!outcome.target_resolution_failed);
        let json = serde_json::to_value(outcome).unwrap();
        assert_eq!(json["limitedBroadcastFallbackDelivered"], true);
        assert_eq!(json["resolvedTargetDelivered"], true);
    }

    #[test]
    fn sends_to_ipv6_loopback_when_ipv6_is_available() {
        let receiver = match UdpSocket::bind("[::1]:0") {
            Ok(socket) => socket,
            Err(_) => return,
        };
        receiver
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let destination = receiver.local_addr().unwrap();
        let packet = build_magic_packet("00:11:22:33:44:55", None).unwrap();
        send_magic_packet(&packet, &[destination]).unwrap();

        let mut received = [0_u8; 102];
        let (length, _) = receiver.recv_from(&mut received).unwrap();
        assert_eq!(length, 102);
        assert_eq!(received, packet.as_slice());
    }

    // ── WolDevice / WolSchedule serde ───────────────────────────────────

    #[test]
    fn wol_device_serde_roundtrip() {
        let dev = WolDevice {
            ip: "192.168.1.100".to_string(),
            mac: "aa:bb:cc:dd:ee:ff".to_string(),
            hostname: Some("myhost".to_string()),
            last_seen: None,
        };
        let json = serde_json::to_string(&dev).unwrap();
        let back: WolDevice = serde_json::from_str(&json).unwrap();
        assert_eq!(back.ip, "192.168.1.100");
        assert_eq!(back.hostname, Some("myhost".to_string()));
    }

    #[test]
    fn wol_schedule_serde_roundtrip() {
        let sched = make_schedule("s1");
        let json = serde_json::to_string(&sched).unwrap();
        let back: WolSchedule = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "s1");
        assert_eq!(back.mac_address, "AA:BB:CC:DD:EE:FF");
        assert!(back.enabled);
    }

    // ── Schedule CRUD ───────────────────────────────────────────────────

    #[test]
    fn add_schedule_returns_id() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let mut svc = state.lock().await;
            let id = svc.add_schedule(make_schedule("s1")).unwrap();
            assert_eq!(id, "s1");
        });
    }

    #[test]
    fn list_schedules_empty() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let svc = state.lock().await;
            assert!(svc.list_schedules().is_empty());
        });
    }

    #[test]
    fn add_and_list_schedules() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let mut svc = state.lock().await;
            svc.add_schedule(make_schedule("s1")).unwrap();
            svc.add_schedule(make_schedule("s2")).unwrap();
            assert_eq!(svc.list_schedules().len(), 2);
        });
    }

    #[test]
    fn remove_schedule_success() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let mut svc = state.lock().await;
            svc.add_schedule(make_schedule("s1")).unwrap();
            svc.remove_schedule("s1").unwrap();
            assert!(svc.list_schedules().is_empty());
        });
    }

    #[test]
    fn remove_schedule_not_found() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let mut svc = state.lock().await;
            let result = svc.remove_schedule("nonexistent");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("not found"));
        });
    }

    #[test]
    fn update_schedule_success() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let mut svc = state.lock().await;
            svc.add_schedule(make_schedule("s1")).unwrap();
            let mut updated = make_schedule("s1");
            updated.wake_time = "09:00".to_string();
            updated.enabled = false;
            svc.update_schedule(updated).unwrap();
            let schedules = svc.list_schedules();
            assert_eq!(schedules[0].wake_time, "09:00");
            assert!(!schedules[0].enabled);
        });
    }

    #[test]
    fn update_schedule_not_found() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let mut svc = state.lock().await;
            let result = svc.update_schedule(make_schedule("nonexistent"));
            assert!(result.is_err());
        });
    }

    #[test]
    fn remove_only_matching_schedule() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let state = WolService::new();
            let mut svc = state.lock().await;
            svc.add_schedule(make_schedule("s1")).unwrap();
            svc.add_schedule(make_schedule("s2")).unwrap();
            svc.add_schedule(make_schedule("s3")).unwrap();
            svc.remove_schedule("s2").unwrap();
            let remaining: Vec<String> = svc.list_schedules().into_iter().map(|s| s.id).collect();
            assert_eq!(remaining.len(), 2);
            assert!(remaining.contains(&"s1".to_string()));
            assert!(remaining.contains(&"s3".to_string()));
        });
    }
}
