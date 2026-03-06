//! # Network Utilities Service
//!
//! Central orchestrator for all network diagnostic utilities — manages
//! ping, traceroute, mtr, nmap, netstat, arp, dig, whois, ethtool,
//! tcpdump, iperf, speedtest, route, WoL, curl, netcat, lsof, and
//! bandwidth monitoring state and history.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type NetUtilsServiceState = Arc<Mutex<NetUtilsService>>;

/// The network utilities service.
pub struct NetUtilsService {
    // Results cache / history
    ping_history: Vec<PingResult>,
    traceroute_history: Vec<TracerouteResult>,
    mtr_history: Vec<MtrResult>,
    nmap_history: Vec<NmapScanResult>,
    dig_history: Vec<DigResult>,
    whois_cache: HashMap<String, WhoisResult>,
    speedtest_history: Vec<SpeedtestResult>,
    iperf_history: Vec<IperfResult>,
    // Live state
    sockets: Vec<SocketEntry>,
    arp_cache: Vec<ArpEntry>,
    routing_table: Vec<RouteEntry>,
    interfaces_ethtool: HashMap<String, EthtoolInfo>,
    network_fds: Vec<NetworkFd>,
    // Captures
    captures: HashMap<String, CaptureStatus>,
    // Bandwidth
    bandwidth_samples: Vec<BandwidthSample>,
    connection_bandwidth: Vec<ConnectionBandwidth>,
    // WoL
    wol_targets: Vec<WolTarget>,
    // HTTP timing
    http_timings: Vec<HttpTiming>,
    // Tool availability
    available_tools: HashMap<String, bool>,
    // Health / diagnostics
    health: Option<NetUtilsHealthCheck>,
    event_log: Vec<NetUtilsEvent>,
}

impl NetUtilsService {
    pub fn new() -> Self {
        Self {
            ping_history: Vec::new(),
            traceroute_history: Vec::new(),
            mtr_history: Vec::new(),
            nmap_history: Vec::new(),
            dig_history: Vec::new(),
            whois_cache: HashMap::new(),
            speedtest_history: Vec::new(),
            iperf_history: Vec::new(),
            sockets: Vec::new(),
            arp_cache: Vec::new(),
            routing_table: Vec::new(),
            interfaces_ethtool: HashMap::new(),
            network_fds: Vec::new(),
            captures: HashMap::new(),
            bandwidth_samples: Vec::new(),
            connection_bandwidth: Vec::new(),
            wol_targets: Vec::new(),
            http_timings: Vec::new(),
            available_tools: HashMap::new(),
            health: None,
            event_log: Vec::new(),
        }
    }

    // ── Ping ───────────────────────────────────────────────────

    pub fn add_ping_result(&mut self, result: PingResult) {
        info!("Ping complete: {} → loss={:.1}%, avg={:.2}ms", result.host, result.packet_loss_pct, result.avg_ms);
        self.event_log.push(NetUtilsEvent::PingComplete {
            host: result.host.clone(),
            loss_pct: result.packet_loss_pct,
            avg_ms: result.avg_ms,
        });
        self.ping_history.push(result);
    }

    pub fn ping_history(&self) -> &[PingResult] {
        &self.ping_history
    }

    pub fn last_ping(&self, host: &str) -> Option<&PingResult> {
        self.ping_history.iter().rev().find(|p| p.host == host)
    }

    // ── Traceroute ─────────────────────────────────────────────

    pub fn add_traceroute_result(&mut self, result: TracerouteResult) {
        info!("Traceroute complete: {} → {} hops", result.host, result.hops.len());
        self.event_log.push(NetUtilsEvent::TracerouteComplete {
            host: result.host.clone(),
            hops: result.hops.len() as u8,
        });
        self.traceroute_history.push(result);
    }

    pub fn traceroute_history(&self) -> &[TracerouteResult] {
        &self.traceroute_history
    }

    // ── MTR ────────────────────────────────────────────────────

    pub fn add_mtr_result(&mut self, result: MtrResult) {
        info!("MTR complete: {} → {} cycles", result.host, result.cycles);
        self.event_log.push(NetUtilsEvent::MtrComplete {
            host: result.host.clone(),
            cycles: result.cycles,
        });
        self.mtr_history.push(result);
    }

    pub fn mtr_history(&self) -> &[MtrResult] {
        &self.mtr_history
    }

    // ── Nmap ───────────────────────────────────────────────────

    pub fn add_nmap_result(&mut self, result: NmapScanResult) {
        info!("Nmap scan complete: {} → {} hosts up", result.target, result.total_hosts_up);
        self.event_log.push(NetUtilsEvent::NmapScanComplete {
            target: result.target.clone(),
            hosts_up: result.total_hosts_up,
        });
        self.nmap_history.push(result);
    }

    pub fn nmap_history(&self) -> &[NmapScanResult] {
        &self.nmap_history
    }

    pub fn last_nmap_scan(&self) -> Option<&NmapScanResult> {
        self.nmap_history.last()
    }

    // ── Dig / DNS ──────────────────────────────────────────────

    pub fn add_dig_result(&mut self, result: DigResult) {
        self.dig_history.push(result);
    }

    pub fn dig_history(&self) -> &[DigResult] {
        &self.dig_history
    }

    // ── WHOIS ──────────────────────────────────────────────────

    pub fn cache_whois(&mut self, query: &str, result: WhoisResult) {
        self.whois_cache.insert(query.to_string(), result);
    }

    pub fn get_whois(&self, query: &str) -> Option<&WhoisResult> {
        self.whois_cache.get(query)
    }

    pub fn whois_cache_size(&self) -> usize {
        self.whois_cache.len()
    }

    // ── Speedtest ──────────────────────────────────────────────

    pub fn add_speedtest_result(&mut self, result: SpeedtestResult) {
        info!("Speedtest: ↓{:.1} Mbps / ↑{:.1} Mbps", result.download_mbps, result.upload_mbps);
        self.event_log.push(NetUtilsEvent::SpeedtestComplete {
            download_mbps: result.download_mbps,
            upload_mbps: result.upload_mbps,
        });
        self.speedtest_history.push(result);
    }

    pub fn speedtest_history(&self) -> &[SpeedtestResult] {
        &self.speedtest_history
    }

    pub fn last_speedtest(&self) -> Option<&SpeedtestResult> {
        self.speedtest_history.last()
    }

    // ── iperf ──────────────────────────────────────────────────

    pub fn add_iperf_result(&mut self, result: IperfResult) {
        let mbps = result.summary.bits_per_sec / 1_000_000.0;
        info!("iperf: {} → {:.1} Mbps", result.host, mbps);
        self.event_log.push(NetUtilsEvent::IperfComplete {
            host: result.host.clone(),
            mbps,
        });
        self.iperf_history.push(result);
    }

    pub fn iperf_history(&self) -> &[IperfResult] {
        &self.iperf_history
    }

    // ── Sockets (netstat/ss) ───────────────────────────────────

    pub fn update_sockets(&mut self, sockets: Vec<SocketEntry>) {
        self.sockets = sockets;
    }

    pub fn list_sockets(&self) -> &[SocketEntry] {
        &self.sockets
    }

    pub fn listening_sockets(&self) -> Vec<&SocketEntry> {
        self.sockets.iter().filter(|s| s.state == SocketState::Listen).collect()
    }

    pub fn established_sockets(&self) -> Vec<&SocketEntry> {
        self.sockets.iter().filter(|s| s.state == SocketState::Established).collect()
    }

    // ── ARP ────────────────────────────────────────────────────

    pub fn update_arp_cache(&mut self, entries: Vec<ArpEntry>) {
        self.arp_cache = entries;
    }

    pub fn list_arp(&self) -> &[ArpEntry] {
        &self.arp_cache
    }

    pub fn arp_lookup(&self, ip: &str) -> Option<&ArpEntry> {
        self.arp_cache.iter().find(|e| e.ip == ip)
    }

    // ── Routing Table ──────────────────────────────────────────

    pub fn update_routing_table(&mut self, routes: Vec<RouteEntry>) {
        self.routing_table = routes;
    }

    pub fn list_routes(&self) -> &[RouteEntry] {
        &self.routing_table
    }

    pub fn default_routes(&self) -> Vec<&RouteEntry> {
        self.routing_table.iter().filter(|r| r.destination == "default" || r.destination == "0.0.0.0/0").collect()
    }

    // ── Ethtool ────────────────────────────────────────────────

    pub fn update_ethtool(&mut self, iface: &str, info: EthtoolInfo) {
        self.interfaces_ethtool.insert(iface.to_string(), info);
    }

    pub fn get_ethtool(&self, iface: &str) -> Option<&EthtoolInfo> {
        self.interfaces_ethtool.get(iface)
    }

    pub fn list_ethtool(&self) -> Vec<&EthtoolInfo> {
        self.interfaces_ethtool.values().collect()
    }

    // ── Network FDs (lsof) ─────────────────────────────────────

    pub fn update_network_fds(&mut self, fds: Vec<NetworkFd>) {
        self.network_fds = fds;
    }

    pub fn list_network_fds(&self) -> &[NetworkFd] {
        &self.network_fds
    }

    pub fn fds_by_pid(&self, pid: u32) -> Vec<&NetworkFd> {
        self.network_fds.iter().filter(|fd| fd.pid == pid).collect()
    }

    // ── Captures (tcpdump) ─────────────────────────────────────

    pub fn register_capture(&mut self, status: CaptureStatus) {
        let id = status.id.clone();
        if status.running {
            self.event_log.push(NetUtilsEvent::CaptureStarted {
                id: id.clone(),
                interface: String::new(),
            });
        }
        self.captures.insert(id, status);
    }

    pub fn update_capture_status(&mut self, status: CaptureStatus) {
        if !status.running {
            self.event_log.push(NetUtilsEvent::CaptureStopped {
                id: status.id.clone(),
                packets: status.packets_captured,
            });
        }
        self.captures.insert(status.id.clone(), status);
    }

    pub fn get_capture(&self, id: &str) -> Option<&CaptureStatus> {
        self.captures.get(id)
    }

    pub fn list_captures(&self) -> Vec<&CaptureStatus> {
        self.captures.values().collect()
    }

    pub fn running_captures(&self) -> Vec<&CaptureStatus> {
        self.captures.values().filter(|c| c.running).collect()
    }

    // ── Bandwidth ──────────────────────────────────────────────

    pub fn add_bandwidth_sample(&mut self, sample: BandwidthSample) {
        self.bandwidth_samples.push(sample);
        // Keep last 1000 samples
        if self.bandwidth_samples.len() > 1000 {
            self.bandwidth_samples.drain(..self.bandwidth_samples.len() - 1000);
        }
    }

    pub fn bandwidth_samples(&self) -> &[BandwidthSample] {
        &self.bandwidth_samples
    }

    pub fn update_connection_bandwidth(&mut self, connections: Vec<ConnectionBandwidth>) {
        self.connection_bandwidth = connections;
    }

    pub fn list_connection_bandwidth(&self) -> &[ConnectionBandwidth] {
        &self.connection_bandwidth
    }

    // ── WoL ────────────────────────────────────────────────────

    pub fn add_wol_target(&mut self, target: WolTarget) {
        info!("WoL target added: {}", target.mac_address);
        self.wol_targets.push(target);
    }

    pub fn list_wol_targets(&self) -> &[WolTarget] {
        &self.wol_targets
    }

    pub fn mark_wol_sent(&mut self, mac: &str) {
        if let Some(target) = self.wol_targets.iter_mut().find(|t| t.mac_address == mac) {
            target.status = WolStatus::Sent;
            target.sent_at = Some(Utc::now());
            self.event_log.push(NetUtilsEvent::WolSent { mac: mac.to_string() });
        }
    }

    // ── HTTP Timing (curl) ─────────────────────────────────────

    pub fn add_http_timing(&mut self, timing: HttpTiming) {
        self.http_timings.push(timing);
    }

    pub fn http_timing_history(&self) -> &[HttpTiming] {
        &self.http_timings
    }

    // ── Tool Availability ──────────────────────────────────────

    pub fn set_tool_available(&mut self, tool: &str, available: bool) {
        if !available {
            self.event_log.push(NetUtilsEvent::ToolNotFound { tool: tool.to_string() });
        }
        self.available_tools.insert(tool.to_string(), available);
    }

    pub fn is_tool_available(&self, tool: &str) -> Option<bool> {
        self.available_tools.get(tool).copied()
    }

    pub fn available_tools(&self) -> &HashMap<String, bool> {
        &self.available_tools
    }

    // ── Health ─────────────────────────────────────────────────

    pub fn set_health(&mut self, health: NetUtilsHealthCheck) {
        self.health = Some(health);
    }

    pub fn get_health(&self) -> Option<&NetUtilsHealthCheck> {
        self.health.as_ref()
    }

    // ── Events ─────────────────────────────────────────────────

    pub fn push_event(&mut self, event: NetUtilsEvent) {
        self.event_log.push(event);
    }

    pub fn recent_events(&self, count: usize) -> &[NetUtilsEvent] {
        let start = self.event_log.len().saturating_sub(count);
        &self.event_log[start..]
    }

    pub fn clear_events(&mut self) {
        self.event_log.clear();
    }

    pub fn clear_all_history(&mut self) {
        self.ping_history.clear();
        self.traceroute_history.clear();
        self.mtr_history.clear();
        self.nmap_history.clear();
        self.dig_history.clear();
        self.whois_cache.clear();
        self.speedtest_history.clear();
        self.iperf_history.clear();
        self.http_timings.clear();
        self.event_log.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ping_result(host: &str, loss: f64, avg: f64) -> PingResult {
        PingResult {
            host: host.to_string(),
            resolved_ip: Some("1.2.3.4".to_string()),
            packets_sent: 4,
            packets_received: 4,
            packet_loss_pct: loss,
            min_ms: avg - 1.0,
            avg_ms: avg,
            max_ms: avg + 1.0,
            stddev_ms: 0.5,
            replies: Vec::new(),
            started_at: Utc::now(),
            duration_ms: 3000,
            ttl: Some(64),
            payload_size: 56,
            ip_version: IpVersion::V4,
        }
    }

    #[test]
    fn create_service() {
        let svc = NetUtilsService::new();
        assert!(svc.ping_history().is_empty());
        assert!(svc.nmap_history().is_empty());
        assert!(svc.list_sockets().is_empty());
        assert!(svc.list_captures().is_empty());
    }

    #[test]
    fn ping_history() {
        let mut svc = NetUtilsService::new();
        svc.add_ping_result(make_ping_result("google.com", 0.0, 15.0));
        svc.add_ping_result(make_ping_result("github.com", 0.0, 25.0));
        assert_eq!(svc.ping_history().len(), 2);
        assert!(svc.last_ping("google.com").is_some());
        assert!(svc.last_ping("example.com").is_none());
    }

    #[test]
    fn sockets() {
        let mut svc = NetUtilsService::new();
        let socket = SocketEntry {
            protocol: SocketProtocol::Tcp,
            state: SocketState::Listen,
            local_addr: "0.0.0.0".to_string(),
            local_port: 80,
            remote_addr: None,
            remote_port: None,
            pid: Some(1234),
            process_name: Some("nginx".to_string()),
            user: Some("www-data".to_string()),
            inode: None,
            recv_queue: 0,
            send_queue: 0,
            timer: None,
        };
        let socket2 = SocketEntry {
            protocol: SocketProtocol::Tcp,
            state: SocketState::Established,
            local_addr: "192.168.1.5".to_string(),
            local_port: 443,
            remote_addr: Some("93.184.216.34".to_string()),
            remote_port: Some(443),
            pid: Some(5678),
            process_name: Some("curl".to_string()),
            user: Some("user".to_string()),
            inode: None,
            recv_queue: 0,
            send_queue: 512,
            timer: None,
        };
        svc.update_sockets(vec![socket, socket2]);
        assert_eq!(svc.list_sockets().len(), 2);
        assert_eq!(svc.listening_sockets().len(), 1);
        assert_eq!(svc.established_sockets().len(), 1);
    }

    #[test]
    fn arp_cache() {
        let mut svc = NetUtilsService::new();
        let entry = ArpEntry {
            ip: "192.168.1.1".to_string(),
            mac: "aa:bb:cc:dd:ee:ff".to_string(),
            interface: "eth0".to_string(),
            state: ArpState::Reachable,
            hw_type: None,
            flags: None,
        };
        svc.update_arp_cache(vec![entry]);
        assert_eq!(svc.list_arp().len(), 1);
        assert!(svc.arp_lookup("192.168.1.1").is_some());
        assert!(svc.arp_lookup("10.0.0.1").is_none());
    }

    #[test]
    fn routing_table() {
        let mut svc = NetUtilsService::new();
        let route = RouteEntry {
            destination: "default".to_string(),
            gateway: Some("192.168.1.1".to_string()),
            netmask: None,
            prefix_len: Some(0),
            interface: "eth0".to_string(),
            metric: 100,
            protocol: Some("dhcp".to_string()),
            scope: Some("global".to_string()),
            route_type: None,
            flags: vec!["UG".to_string()],
            mtu: None,
            table_id: None,
        };
        svc.update_routing_table(vec![route]);
        assert_eq!(svc.list_routes().len(), 1);
        assert_eq!(svc.default_routes().len(), 1);
    }

    #[test]
    fn captures() {
        let mut svc = NetUtilsService::new();
        let status = CaptureStatus {
            id: "cap1".to_string(),
            running: true,
            packets_captured: 0,
            packets_dropped: 0,
            bytes_captured: 0,
            started_at: Some(Utc::now()),
            duration_secs: 0,
            output_file: Some("/tmp/capture.pcap".to_string()),
        };
        svc.register_capture(status);
        assert_eq!(svc.list_captures().len(), 1);
        assert_eq!(svc.running_captures().len(), 1);

        let stopped = CaptureStatus {
            id: "cap1".to_string(),
            running: false,
            packets_captured: 150,
            packets_dropped: 2,
            bytes_captured: 50000,
            started_at: Some(Utc::now()),
            duration_secs: 60,
            output_file: Some("/tmp/capture.pcap".to_string()),
        };
        svc.update_capture_status(stopped);
        assert_eq!(svc.running_captures().len(), 0);
        assert_eq!(svc.get_capture("cap1").unwrap().packets_captured, 150);
    }

    #[test]
    fn wol_targets() {
        let mut svc = NetUtilsService::new();
        let target = WolTarget {
            mac_address: "00:11:22:33:44:55".to_string(),
            hostname: Some("server1".to_string()),
            ip_address: None,
            broadcast_addr: None,
            port: None,
            secure_password: None,
            sent_at: None,
            status: WolStatus::Pending,
        };
        svc.add_wol_target(target);
        assert_eq!(svc.list_wol_targets().len(), 1);
        svc.mark_wol_sent("00:11:22:33:44:55");
        assert_eq!(svc.list_wol_targets()[0].status, WolStatus::Sent);
        assert!(svc.list_wol_targets()[0].sent_at.is_some());
    }

    #[test]
    fn tool_availability() {
        let mut svc = NetUtilsService::new();
        svc.set_tool_available("nmap", true);
        svc.set_tool_available("tcpdump", true);
        svc.set_tool_available("mtr", false);
        assert_eq!(svc.is_tool_available("nmap"), Some(true));
        assert_eq!(svc.is_tool_available("mtr"), Some(false));
        assert_eq!(svc.is_tool_available("unknown"), None);
        assert_eq!(svc.available_tools().len(), 3);
    }

    #[test]
    fn bandwidth_samples_limit() {
        let mut svc = NetUtilsService::new();
        for i in 0..1100 {
            svc.add_bandwidth_sample(BandwidthSample {
                interface: "eth0".to_string(),
                timestamp: Utc::now(),
                rx_bytes_per_sec: i as u64 * 1000,
                tx_bytes_per_sec: i as u64 * 500,
                rx_packets_per_sec: i as u64,
                tx_packets_per_sec: i as u64,
            });
        }
        assert_eq!(svc.bandwidth_samples().len(), 1000);
    }

    #[test]
    fn whois_cache() {
        let mut svc = NetUtilsService::new();
        let result = WhoisResult {
            query: "example.com".to_string(),
            registrar: Some("Example Registrar".to_string()),
            registrant: None,
            creation_date: Some("1995-08-14".to_string()),
            expiration_date: None,
            updated_date: None,
            name_servers: vec!["ns1.example.com".to_string()],
            status: Vec::new(),
            dnssec: None,
            abuse_contact: None,
            raw: "Domain Name: EXAMPLE.COM".to_string(),
            queried_at: Utc::now(),
            rdap: None,
        };
        svc.cache_whois("example.com", result);
        assert_eq!(svc.whois_cache_size(), 1);
        assert!(svc.get_whois("example.com").is_some());
        assert!(svc.get_whois("other.com").is_none());
    }

    #[test]
    fn serde_roundtrip_ping() {
        let result = make_ping_result("test.com", 5.0, 20.0);
        let json = serde_json::to_string(&result).unwrap();
        let back: PingResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.host, "test.com");
        assert!((back.packet_loss_pct - 5.0).abs() < 0.01);
    }

    #[test]
    fn serde_roundtrip_nmap() {
        let result = NmapScanResult {
            target: "192.168.1.0/24".to_string(),
            hosts: Vec::new(),
            scan_type: NmapScanType::TcpSyn,
            started_at: Utc::now(),
            duration_ms: 30000,
            total_hosts_up: 5,
            total_hosts_down: 250,
            nmap_version: Some("7.94".to_string()),
            xml_output: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        let back: NmapScanResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.target, "192.168.1.0/24");
        assert_eq!(back.total_hosts_up, 5);
    }

    #[test]
    fn serde_roundtrip_events() {
        let event = NetUtilsEvent::WolSent { mac: "aa:bb:cc:dd:ee:ff".to_string() };
        let json = serde_json::to_string(&event).unwrap();
        let back: NetUtilsEvent = serde_json::from_str(&json).unwrap();
        match back {
            NetUtilsEvent::WolSent { mac } => assert_eq!(mac, "aa:bb:cc:dd:ee:ff"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn clear_all_history() {
        let mut svc = NetUtilsService::new();
        svc.add_ping_result(make_ping_result("a.com", 0.0, 10.0));
        svc.add_dig_result(DigResult {
            query_name: "test.com".to_string(),
            query_type: "A".to_string(),
            server: "8.8.8.8".to_string(),
            query_time_ms: 20,
            status: DnsStatus::NoError,
            answers: Vec::new(),
            authority: Vec::new(),
            additional: Vec::new(),
            flags: Vec::new(),
            opcode: "QUERY".to_string(),
            rcode: "NOERROR".to_string(),
            msg_size: 100,
        });
        assert!(!svc.ping_history().is_empty());
        assert!(!svc.dig_history().is_empty());
        svc.clear_all_history();
        assert!(svc.ping_history().is_empty());
        assert!(svc.dig_history().is_empty());
    }

    #[test]
    fn events() {
        let mut svc = NetUtilsService::new();
        svc.push_event(NetUtilsEvent::ToolNotFound { tool: "mtr".to_string() });
        svc.push_event(NetUtilsEvent::WolSent { mac: "aa:bb:cc:dd:ee:ff".to_string() });
        assert_eq!(svc.recent_events(10).len(), 2);
        assert_eq!(svc.recent_events(1).len(), 1);
        svc.clear_events();
        assert_eq!(svc.recent_events(10).len(), 0);
    }

    #[test]
    fn network_fds() {
        let mut svc = NetUtilsService::new();
        let fd = NetworkFd {
            pid: 1234,
            process_name: "nginx".to_string(),
            user: "www-data".to_string(),
            fd: "6u".to_string(),
            fd_type: "IPv4".to_string(),
            protocol: Some("TCP".to_string()),
            local_addr: Some("0.0.0.0".to_string()),
            local_port: Some(80),
            remote_addr: None,
            remote_port: None,
            state: Some("LISTEN".to_string()),
            node: None,
        };
        svc.update_network_fds(vec![fd]);
        assert_eq!(svc.list_network_fds().len(), 1);
        assert_eq!(svc.fds_by_pid(1234).len(), 1);
        assert_eq!(svc.fds_by_pid(9999).len(), 0);
    }
}
