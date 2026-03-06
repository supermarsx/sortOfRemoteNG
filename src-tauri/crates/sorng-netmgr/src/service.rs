//! # Network Manager Service
//!
//! Central orchestrator for all network management operations — manages
//! firewall rules across backends, nmcli connections, interfaces, Wi-Fi,
//! VLANs, bonds, bridges, and network profiles.

use crate::types::*;
use chrono::Utc;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type NetMgrServiceState = Arc<Mutex<NetMgrService>>;

/// The network manager service.
pub struct NetMgrService {
    // Firewall state
    firewall_status: Option<FirewallStatus>,
    firewall_rules: HashMap<String, FirewallRule>,
    // firewalld
    firewalld_zones: HashMap<String, FirewalldZone>,
    firewalld_services: HashMap<String, FirewalldService>,
    // iptables
    iptables_chains: Vec<IptablesChain>,
    // nftables
    nft_tables: Vec<NftTable>,
    // ufw
    ufw_status: Option<UfwStatus>,
    ufw_app_profiles: Vec<UfwAppProfile>,
    // pf
    pf_status: Option<PfStatus>,
    pf_tables: HashMap<String, PfTable>,
    pf_anchors: Vec<PfAnchor>,
    // Windows Firewall
    win_fw_profiles: Vec<WinFwProfileStatus>,
    win_fw_rules: Vec<WinFwRule>,
    // NetworkManager
    nm_status: Option<NmGeneralStatus>,
    nm_connections: HashMap<String, NmConnection>,
    nm_devices: Vec<NmDevice>,
    // Wi-Fi
    wifi_access_points: Vec<WifiAccessPoint>,
    wifi_hotspot: Option<WifiHotspot>,
    // Interfaces
    interfaces: HashMap<String, NetworkInterface>,
    vlans: Vec<VlanConfig>,
    bonds: Vec<BondConfig>,
    bridges: Vec<BridgeConfig>,
    // Profiles
    profiles: HashMap<String, NetworkProfile>,
    active_profile: Option<String>,
    // Health
    health: Option<NetMgrHealthCheck>,
    event_log: Vec<NetMgrEvent>,
}

impl NetMgrService {
    pub fn new() -> Self {
        Self {
            firewall_status: None,
            firewall_rules: HashMap::new(),
            firewalld_zones: HashMap::new(),
            firewalld_services: HashMap::new(),
            iptables_chains: Vec::new(),
            nft_tables: Vec::new(),
            ufw_status: None,
            ufw_app_profiles: Vec::new(),
            pf_status: None,
            pf_tables: HashMap::new(),
            pf_anchors: Vec::new(),
            win_fw_profiles: Vec::new(),
            win_fw_rules: Vec::new(),
            nm_status: None,
            nm_connections: HashMap::new(),
            nm_devices: Vec::new(),
            wifi_access_points: Vec::new(),
            wifi_hotspot: None,
            interfaces: HashMap::new(),
            vlans: Vec::new(),
            bonds: Vec::new(),
            bridges: Vec::new(),
            profiles: HashMap::new(),
            active_profile: None,
            health: None,
            event_log: Vec::new(),
        }
    }

    // ── Firewall Status ────────────────────────────────────────

    pub fn set_firewall_status(&mut self, status: FirewallStatus) {
        self.firewall_status = Some(status);
    }

    pub fn get_firewall_status(&self) -> Option<&FirewallStatus> {
        self.firewall_status.as_ref()
    }

    pub fn detect_backend(&self) -> FirewallBackend {
        self.firewall_status
            .as_ref()
            .map(|s| s.backend)
            .unwrap_or(FirewallBackend::Unknown)
    }

    // ── Unified Firewall Rules ─────────────────────────────────

    pub fn add_firewall_rule(&mut self, rule: FirewallRule) -> Result<String, String> {
        let id = rule.id.clone();
        self.firewall_rules.insert(id.clone(), rule);
        info!("Added firewall rule {}", id);
        self.event_log.push(NetMgrEvent::FirewallRuleAdded { rule_id: id.clone() });
        Ok(id)
    }

    pub fn remove_firewall_rule(&mut self, id: &str) -> bool {
        let removed = self.firewall_rules.remove(id).is_some();
        if removed {
            self.event_log.push(NetMgrEvent::FirewallRuleRemoved { rule_id: id.to_string() });
        }
        removed
    }

    pub fn get_firewall_rule(&self, id: &str) -> Option<&FirewallRule> {
        self.firewall_rules.get(id)
    }

    pub fn list_firewall_rules(&self) -> Vec<&FirewallRule> {
        self.firewall_rules.values().collect()
    }

    pub fn rules_by_backend(&self, backend: FirewallBackend) -> Vec<&FirewallRule> {
        self.firewall_rules.values().filter(|r| r.backend == backend).collect()
    }

    pub fn rules_by_direction(&self, dir: RuleDirection) -> Vec<&FirewallRule> {
        self.firewall_rules.values().filter(|r| r.direction == dir).collect()
    }

    // ── firewalld ──────────────────────────────────────────────

    pub fn update_firewalld_zones(&mut self, zones: Vec<FirewalldZone>) {
        self.firewalld_zones.clear();
        for zone in zones {
            self.firewalld_zones.insert(zone.name.clone(), zone);
        }
    }

    pub fn get_firewalld_zone(&self, name: &str) -> Option<&FirewalldZone> {
        self.firewalld_zones.get(name)
    }

    pub fn list_firewalld_zones(&self) -> Vec<&FirewalldZone> {
        self.firewalld_zones.values().collect()
    }

    pub fn active_firewalld_zones(&self) -> Vec<&FirewalldZone> {
        self.firewalld_zones.values().filter(|z| z.is_active).collect()
    }

    pub fn default_firewalld_zone(&self) -> Option<&FirewalldZone> {
        self.firewalld_zones.values().find(|z| z.is_default)
    }

    pub fn update_firewalld_services(&mut self, services: Vec<FirewalldService>) {
        self.firewalld_services.clear();
        for svc in services {
            self.firewalld_services.insert(svc.name.clone(), svc);
        }
    }

    pub fn list_firewalld_services(&self) -> Vec<&FirewalldService> {
        self.firewalld_services.values().collect()
    }

    // ── iptables ───────────────────────────────────────────────

    pub fn update_iptables_chains(&mut self, chains: Vec<IptablesChain>) {
        self.iptables_chains = chains;
    }

    pub fn list_iptables_chains(&self) -> &[IptablesChain] {
        &self.iptables_chains
    }

    pub fn chains_by_table(&self, table: IptablesTable) -> Vec<&IptablesChain> {
        self.iptables_chains.iter().filter(|c| c.table == table).collect()
    }

    // ── nftables ───────────────────────────────────────────────

    pub fn update_nft_tables(&mut self, tables: Vec<NftTable>) {
        self.nft_tables = tables;
    }

    pub fn list_nft_tables(&self) -> &[NftTable] {
        &self.nft_tables
    }

    pub fn nft_table_by_name(&self, name: &str) -> Option<&NftTable> {
        self.nft_tables.iter().find(|t| t.name == name)
    }

    // ── ufw ────────────────────────────────────────────────────

    pub fn set_ufw_status(&mut self, status: UfwStatus) {
        self.ufw_status = Some(status);
    }

    pub fn get_ufw_status(&self) -> Option<&UfwStatus> {
        self.ufw_status.as_ref()
    }

    pub fn update_ufw_app_profiles(&mut self, profiles: Vec<UfwAppProfile>) {
        self.ufw_app_profiles = profiles;
    }

    pub fn list_ufw_app_profiles(&self) -> &[UfwAppProfile] {
        &self.ufw_app_profiles
    }

    // ── pf ─────────────────────────────────────────────────────

    pub fn set_pf_status(&mut self, status: PfStatus) {
        self.pf_status = Some(status);
    }

    pub fn get_pf_status(&self) -> Option<&PfStatus> {
        self.pf_status.as_ref()
    }

    pub fn update_pf_tables(&mut self, tables: Vec<PfTable>) {
        self.pf_tables.clear();
        for table in tables {
            self.pf_tables.insert(table.name.clone(), table);
        }
    }

    pub fn get_pf_table(&self, name: &str) -> Option<&PfTable> {
        self.pf_tables.get(name)
    }

    pub fn list_pf_tables(&self) -> Vec<&PfTable> {
        self.pf_tables.values().collect()
    }

    pub fn update_pf_anchors(&mut self, anchors: Vec<PfAnchor>) {
        self.pf_anchors = anchors;
    }

    pub fn list_pf_anchors(&self) -> &[PfAnchor] {
        &self.pf_anchors
    }

    // ── Windows Firewall ───────────────────────────────────────

    pub fn update_win_fw_profiles(&mut self, profiles: Vec<WinFwProfileStatus>) {
        self.win_fw_profiles = profiles;
    }

    pub fn list_win_fw_profiles(&self) -> &[WinFwProfileStatus] {
        &self.win_fw_profiles
    }

    pub fn win_fw_profile(&self, profile: WinFwProfile) -> Option<&WinFwProfileStatus> {
        self.win_fw_profiles.iter().find(|p| p.profile == profile)
    }

    pub fn update_win_fw_rules(&mut self, rules: Vec<WinFwRule>) {
        self.win_fw_rules = rules;
    }

    pub fn list_win_fw_rules(&self) -> &[WinFwRule] {
        &self.win_fw_rules
    }

    pub fn win_fw_rules_by_profile(&self, profile: WinFwProfile) -> Vec<&WinFwRule> {
        self.win_fw_rules.iter().filter(|r| r.profiles.contains(&profile)).collect()
    }

    // ── NetworkManager ─────────────────────────────────────────

    pub fn set_nm_status(&mut self, status: NmGeneralStatus) {
        self.nm_status = Some(status);
    }

    pub fn get_nm_status(&self) -> Option<&NmGeneralStatus> {
        self.nm_status.as_ref()
    }

    pub fn update_nm_connections(&mut self, connections: Vec<NmConnection>) {
        self.nm_connections.clear();
        for conn in connections {
            self.nm_connections.insert(conn.uuid.clone(), conn);
        }
    }

    pub fn get_nm_connection(&self, uuid: &str) -> Option<&NmConnection> {
        self.nm_connections.get(uuid)
    }

    pub fn list_nm_connections(&self) -> Vec<&NmConnection> {
        self.nm_connections.values().collect()
    }

    pub fn active_nm_connections(&self) -> Vec<&NmConnection> {
        self.nm_connections.values().filter(|c| c.active).collect()
    }

    pub fn update_nm_devices(&mut self, devices: Vec<NmDevice>) {
        self.nm_devices = devices;
    }

    pub fn list_nm_devices(&self) -> &[NmDevice] {
        &self.nm_devices
    }

    // ── Wi-Fi ──────────────────────────────────────────────────

    pub fn update_wifi_access_points(&mut self, aps: Vec<WifiAccessPoint>) {
        self.wifi_access_points = aps;
    }

    pub fn list_wifi_access_points(&self) -> &[WifiAccessPoint] {
        &self.wifi_access_points
    }

    pub fn connected_wifi(&self) -> Option<&WifiAccessPoint> {
        self.wifi_access_points.iter().find(|ap| ap.connected)
    }

    pub fn set_wifi_hotspot(&mut self, hotspot: Option<WifiHotspot>) {
        self.wifi_hotspot = hotspot;
    }

    pub fn get_wifi_hotspot(&self) -> Option<&WifiHotspot> {
        self.wifi_hotspot.as_ref()
    }

    // ── Interfaces ─────────────────────────────────────────────

    pub fn update_interfaces(&mut self, ifaces: Vec<NetworkInterface>) {
        self.interfaces.clear();
        for iface in ifaces {
            self.interfaces.insert(iface.name.clone(), iface);
        }
    }

    pub fn get_interface(&self, name: &str) -> Option<&NetworkInterface> {
        self.interfaces.get(name)
    }

    pub fn list_interfaces(&self) -> Vec<&NetworkInterface> {
        self.interfaces.values().collect()
    }

    pub fn up_interfaces(&self) -> Vec<&NetworkInterface> {
        self.interfaces.values().filter(|i| i.state == InterfaceState::Up).collect()
    }

    // ── VLAN ───────────────────────────────────────────────────

    pub fn update_vlans(&mut self, vlans: Vec<VlanConfig>) {
        self.vlans = vlans;
    }

    pub fn list_vlans(&self) -> &[VlanConfig] {
        &self.vlans
    }

    pub fn vlan_by_id(&self, id: u16) -> Option<&VlanConfig> {
        self.vlans.iter().find(|v| v.id == id)
    }

    // ── Bond ───────────────────────────────────────────────────

    pub fn update_bonds(&mut self, bonds: Vec<BondConfig>) {
        self.bonds = bonds;
    }

    pub fn list_bonds(&self) -> &[BondConfig] {
        &self.bonds
    }

    // ── Bridge ─────────────────────────────────────────────────

    pub fn update_bridges(&mut self, bridges: Vec<BridgeConfig>) {
        self.bridges = bridges;
    }

    pub fn list_bridges(&self) -> &[BridgeConfig] {
        &self.bridges
    }

    // ── Network Profiles ───────────────────────────────────────

    pub fn create_profile(&mut self, name: &str, description: &str) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let profile = NetworkProfile {
            id: id.clone(),
            name: name.to_string(),
            description: description.to_string(),
            detect_rules: Vec::new(),
            firewall_zone: None,
            dns_servers: Vec::new(),
            proxy: None,
            auto_vpn: None,
            auto_connections: Vec::new(),
            active: false,
            priority: 0,
            created_at: Utc::now(),
        };
        self.profiles.insert(id.clone(), profile);
        info!("Created network profile {} ({})", name, id);
        Ok(id)
    }

    pub fn get_profile(&self, id: &str) -> Option<&NetworkProfile> {
        self.profiles.get(id)
    }

    pub fn list_profiles(&self) -> Vec<&NetworkProfile> {
        self.profiles.values().collect()
    }

    pub fn delete_profile(&mut self, id: &str) -> bool {
        self.profiles.remove(id).is_some()
    }

    pub fn activate_profile(&mut self, id: &str) -> Result<(), String> {
        // Deactivate current
        if let Some(current_id) = &self.active_profile {
            if let Some(current) = self.profiles.get_mut(current_id) {
                current.active = false;
            }
        }
        let profile = self.profiles.get_mut(id).ok_or_else(|| "Profile not found".to_string())?;
        profile.active = true;
        self.active_profile = Some(id.to_string());
        self.event_log.push(NetMgrEvent::ProfileActivated { profile_id: id.to_string() });
        Ok(())
    }

    pub fn active_profile(&self) -> Option<&NetworkProfile> {
        self.active_profile.as_ref().and_then(|id| self.profiles.get(id))
    }

    // ── Health ─────────────────────────────────────────────────

    pub fn set_health(&mut self, health: NetMgrHealthCheck) {
        self.health = Some(health);
    }

    pub fn get_health(&self) -> Option<&NetMgrHealthCheck> {
        self.health.as_ref()
    }

    // ── Events ─────────────────────────────────────────────────

    pub fn push_event(&mut self, event: NetMgrEvent) {
        self.event_log.push(event);
    }

    pub fn recent_events(&self, count: usize) -> &[NetMgrEvent] {
        let start = self.event_log.len().saturating_sub(count);
        &self.event_log[start..]
    }

    pub fn clear_events(&mut self) {
        self.event_log.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_service() {
        let svc = NetMgrService::new();
        assert!(svc.get_firewall_status().is_none());
        assert_eq!(svc.detect_backend(), FirewallBackend::Unknown);
        assert!(svc.list_firewall_rules().is_empty());
        assert!(svc.list_interfaces().is_empty());
        assert!(svc.list_profiles().is_empty());
    }

    #[test]
    fn firewall_rule_crud() {
        let mut svc = NetMgrService::new();
        let rule = FirewallRule {
            id: "r1".to_string(),
            name: Some("Allow SSH".to_string()),
            description: None,
            backend: FirewallBackend::Iptables,
            direction: RuleDirection::Inbound,
            action: FirewallVerdict::Accept,
            protocol: Some(FirewallProtocol::Tcp),
            ip_family: IpFamily::IPv4,
            source_addr: None,
            source_port: None,
            dest_addr: None,
            dest_port: Some("22".to_string()),
            interface_in: None,
            interface_out: None,
            chain: Some("INPUT".to_string()),
            table: Some("filter".to_string()),
            zone: None,
            priority: None,
            enabled: true,
            persistent: true,
            comment: None,
            log_prefix: None,
            rate_limit: None,
            conntrack_state: vec![ConntrackState::New, ConntrackState::Established],
            created_at: Some(Utc::now()),
            raw_rule: None,
        };
        let id = svc.add_firewall_rule(rule).unwrap();
        assert_eq!(id, "r1");
        assert!(svc.get_firewall_rule("r1").is_some());
        assert_eq!(svc.list_firewall_rules().len(), 1);
        assert_eq!(svc.rules_by_backend(FirewallBackend::Iptables).len(), 1);
        assert_eq!(svc.rules_by_backend(FirewallBackend::Ufw).len(), 0);
        assert!(svc.remove_firewall_rule("r1"));
        assert!(svc.list_firewall_rules().is_empty());
    }

    #[test]
    fn firewalld_zones() {
        let mut svc = NetMgrService::new();
        let zone = FirewalldZone {
            name: "public".to_string(),
            description: "Public zone".to_string(),
            target: FirewallVerdict::Drop,
            interfaces: vec!["eth0".to_string()],
            sources: Vec::new(),
            services: vec!["ssh".to_string(), "dhcpv6-client".to_string()],
            ports: Vec::new(),
            protocols: Vec::new(),
            masquerade: false,
            forward_ports: Vec::new(),
            rich_rules: Vec::new(),
            icmp_blocks: Vec::new(),
            icmp_block_inversion: false,
            is_active: true,
            is_default: true,
        };
        svc.update_firewalld_zones(vec![zone]);
        assert_eq!(svc.list_firewalld_zones().len(), 1);
        assert!(svc.get_firewalld_zone("public").is_some());
        assert_eq!(svc.active_firewalld_zones().len(), 1);
        assert!(svc.default_firewalld_zone().is_some());
    }

    #[test]
    fn nm_connections() {
        let mut svc = NetMgrService::new();
        let conn = NmConnection {
            uuid: "abc-123".to_string(),
            name: "Wired Connection 1".to_string(),
            conn_type: NmConnectionType::Ethernet,
            device: Some("eth0".to_string()),
            active: true,
            autoconnect: true,
            ipv4_method: Some("auto".to_string()),
            ipv4_addresses: Vec::new(),
            ipv4_gateway: None,
            ipv4_dns: Vec::new(),
            ipv6_method: Some("auto".to_string()),
            ipv6_addresses: Vec::new(),
            ipv6_gateway: None,
            ipv6_dns: Vec::new(),
            zone: None,
            timestamp: None,
            read_only: false,
            filename: None,
        };
        svc.update_nm_connections(vec![conn]);
        assert_eq!(svc.list_nm_connections().len(), 1);
        assert!(svc.get_nm_connection("abc-123").is_some());
        assert_eq!(svc.active_nm_connections().len(), 1);
    }

    #[test]
    fn interfaces() {
        let mut svc = NetMgrService::new();
        let iface = NetworkInterface {
            name: "eth0".to_string(),
            iface_type: InterfaceType::Ethernet,
            state: InterfaceState::Up,
            mac_address: Some("aa:bb:cc:dd:ee:ff".to_string()),
            mtu: 1500,
            speed_mbps: Some(1000),
            duplex: Some(Duplex::Full),
            ipv4_addresses: vec!["192.168.1.100/24".to_string()],
            ipv6_addresses: Vec::new(),
            flags: vec!["UP".to_string(), "BROADCAST".to_string()],
            tx_bytes: 1000,
            rx_bytes: 2000,
            tx_packets: 10,
            rx_packets: 20,
            tx_errors: 0,
            rx_errors: 0,
            tx_dropped: 0,
            rx_dropped: 0,
            driver: Some("e1000e".to_string()),
            firmware_version: None,
            pci_bus: None,
        };
        svc.update_interfaces(vec![iface]);
        assert_eq!(svc.list_interfaces().len(), 1);
        assert!(svc.get_interface("eth0").is_some());
        assert_eq!(svc.up_interfaces().len(), 1);
    }

    #[test]
    fn profiles() {
        let mut svc = NetMgrService::new();
        let id = svc.create_profile("Office", "Company network").unwrap();
        assert!(svc.get_profile(&id).is_some());
        assert_eq!(svc.list_profiles().len(), 1);
        svc.activate_profile(&id).unwrap();
        assert!(svc.active_profile().is_some());
        assert!(svc.delete_profile(&id));
        assert!(svc.list_profiles().is_empty());
    }

    #[test]
    fn wifi_access_points() {
        let mut svc = NetMgrService::new();
        let ap = WifiAccessPoint {
            ssid: "MyWifi".to_string(),
            bssid: "00:11:22:33:44:55".to_string(),
            mode: WifiMode::Infrastructure,
            channel: 6,
            frequency: 2437,
            signal_strength: -45,
            security: vec![WifiSecurity::Wpa2Psk],
            connected: true,
            rate_mbps: Some(300),
            seen_at: Utc::now(),
        };
        svc.update_wifi_access_points(vec![ap]);
        assert_eq!(svc.list_wifi_access_points().len(), 1);
        assert!(svc.connected_wifi().is_some());
    }

    #[test]
    fn serde_roundtrip_firewall_rule() {
        let rule = FirewallRule {
            id: "test-rule".to_string(),
            name: Some("Block Telnet".to_string()),
            description: None,
            backend: FirewallBackend::Firewalld,
            direction: RuleDirection::Inbound,
            action: FirewallVerdict::Drop,
            protocol: Some(FirewallProtocol::Tcp),
            ip_family: IpFamily::IPv4,
            source_addr: None,
            source_port: None,
            dest_addr: None,
            dest_port: Some("23".to_string()),
            interface_in: None,
            interface_out: None,
            chain: None,
            table: None,
            zone: Some("public".to_string()),
            priority: None,
            enabled: true,
            persistent: true,
            comment: None,
            log_prefix: None,
            rate_limit: None,
            conntrack_state: Vec::new(),
            created_at: None,
            raw_rule: None,
        };
        let json = serde_json::to_string(&rule).unwrap();
        let back: FirewallRule = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "test-rule");
        assert_eq!(back.backend, FirewallBackend::Firewalld);
        assert_eq!(back.dest_port.unwrap(), "23");
    }

    #[test]
    fn serde_roundtrip_nm_connection() {
        let conn = NmConnection {
            uuid: "u-1".to_string(),
            name: "test".to_string(),
            conn_type: NmConnectionType::Wifi,
            device: None,
            active: false,
            autoconnect: true,
            ipv4_method: None,
            ipv4_addresses: Vec::new(),
            ipv4_gateway: None,
            ipv4_dns: Vec::new(),
            ipv6_method: None,
            ipv6_addresses: Vec::new(),
            ipv6_gateway: None,
            ipv6_dns: Vec::new(),
            zone: None,
            timestamp: None,
            read_only: false,
            filename: None,
        };
        let json = serde_json::to_string(&conn).unwrap();
        let back: NmConnection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.uuid, "u-1");
        assert_eq!(back.conn_type, NmConnectionType::Wifi);
    }

    #[test]
    fn serde_roundtrip_events() {
        let event = NetMgrEvent::FirewallRuleAdded { rule_id: "rule-42".to_string() };
        let json = serde_json::to_string(&event).unwrap();
        let back: NetMgrEvent = serde_json::from_str(&json).unwrap();
        match back {
            NetMgrEvent::FirewallRuleAdded { rule_id } => assert_eq!(rule_id, "rule-42"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn iptables_chains_by_table() {
        let mut svc = NetMgrService::new();
        let chain_filter = IptablesChain {
            name: "INPUT".to_string(),
            table: IptablesTable::Filter,
            policy: Some(FirewallVerdict::Accept),
            packets: 100,
            bytes: 5000,
            is_builtin: true,
            rules: Vec::new(),
        };
        let chain_nat = IptablesChain {
            name: "PREROUTING".to_string(),
            table: IptablesTable::Nat,
            policy: Some(FirewallVerdict::Accept),
            packets: 50,
            bytes: 2000,
            is_builtin: true,
            rules: Vec::new(),
        };
        svc.update_iptables_chains(vec![chain_filter, chain_nat]);
        assert_eq!(svc.chains_by_table(IptablesTable::Filter).len(), 1);
        assert_eq!(svc.chains_by_table(IptablesTable::Nat).len(), 1);
        assert_eq!(svc.chains_by_table(IptablesTable::Mangle).len(), 0);
    }

    #[test]
    fn nft_tables() {
        let mut svc = NetMgrService::new();
        let table = NftTable {
            name: "filter".to_string(),
            family: NftFamily::Inet,
            handle: 1,
            chains: Vec::new(),
            sets: Vec::new(),
        };
        svc.update_nft_tables(vec![table]);
        assert_eq!(svc.list_nft_tables().len(), 1);
        assert!(svc.nft_table_by_name("filter").is_some());
        assert!(svc.nft_table_by_name("mangle").is_none());
    }

    #[test]
    fn ufw_status() {
        let mut svc = NetMgrService::new();
        let status = UfwStatus {
            enabled: true,
            default_incoming: FirewallVerdict::Drop,
            default_outgoing: FirewallVerdict::Accept,
            default_routed: FirewallVerdict::Drop,
            logging: UfwLogLevel::Low,
            rules: Vec::new(),
        };
        svc.set_ufw_status(status);
        let s = svc.get_ufw_status().unwrap();
        assert!(s.enabled);
        assert_eq!(s.logging, UfwLogLevel::Low);
    }

    #[test]
    fn pf_tables() {
        let mut svc = NetMgrService::new();
        let table = PfTable {
            name: "bruteforce".to_string(),
            addresses: vec!["10.0.0.1".to_string(), "10.0.0.2".to_string()],
            flags: vec!["persist".to_string()],
            count: 2,
        };
        svc.update_pf_tables(vec![table]);
        assert_eq!(svc.list_pf_tables().len(), 1);
        assert!(svc.get_pf_table("bruteforce").is_some());
    }

    #[test]
    fn win_fw_rules_by_profile() {
        let mut svc = NetMgrService::new();
        let rule = WinFwRule {
            name: "Allow-HTTP".to_string(),
            display_name: "Allow HTTP".to_string(),
            description: None,
            direction: RuleDirection::Inbound,
            action: FirewallVerdict::Accept,
            enabled: true,
            profiles: vec![WinFwProfile::Private, WinFwProfile::Public],
            program: None,
            service: None,
            protocol: Some("TCP".to_string()),
            local_port: Some("80".to_string()),
            remote_port: None,
            local_address: None,
            remote_address: None,
            icmp_type: None,
            group: None,
            interface_types: Vec::new(),
            edge_traversal: false,
        };
        svc.update_win_fw_rules(vec![rule]);
        assert_eq!(svc.win_fw_rules_by_profile(WinFwProfile::Private).len(), 1);
        assert_eq!(svc.win_fw_rules_by_profile(WinFwProfile::Domain).len(), 0);
    }

    #[test]
    fn events() {
        let mut svc = NetMgrService::new();
        svc.push_event(NetMgrEvent::InterfaceUp { name: "eth0".to_string() });
        svc.push_event(NetMgrEvent::InterfaceDown { name: "wlan0".to_string() });
        assert_eq!(svc.recent_events(10).len(), 2);
        assert_eq!(svc.recent_events(1).len(), 1);
        svc.clear_events();
        assert_eq!(svc.recent_events(10).len(), 0);
    }

    #[test]
    fn vlans_and_bonds() {
        let mut svc = NetMgrService::new();
        let vlan = VlanConfig {
            id: 100,
            name: "vlan100".to_string(),
            parent_interface: "eth0".to_string(),
            protocol: VlanProtocol::Ieee802_1Q,
            flags: Vec::new(),
            ingress_qos_map: Vec::new(),
            egress_qos_map: Vec::new(),
        };
        svc.update_vlans(vec![vlan]);
        assert_eq!(svc.list_vlans().len(), 1);
        assert!(svc.vlan_by_id(100).is_some());
        assert!(svc.vlan_by_id(200).is_none());

        let bond = BondConfig {
            name: "bond0".to_string(),
            mode: BondMode::Ieee802_3ad,
            slaves: vec!["eth0".to_string(), "eth1".to_string()],
            primary: None,
            miimon: 100,
            updelay: 0,
            downdelay: 0,
            lacp_rate: Some(LacpRate::Fast),
            xmit_hash_policy: None,
            arp_interval: None,
            arp_ip_targets: Vec::new(),
            active_slave: None,
        };
        svc.update_bonds(vec![bond]);
        assert_eq!(svc.list_bonds().len(), 1);
    }
}
