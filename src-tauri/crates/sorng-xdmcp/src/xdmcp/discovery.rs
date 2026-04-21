//! XDMCP host discovery via Query, BroadcastQuery, and IndirectQuery.

use crate::xdmcp::protocol;
use crate::xdmcp::types::*;
use std::collections::HashMap;
use std::net::IpAddr;

/// A discovered XDMCP host.
#[derive(Debug, Clone)]
pub struct DiscoveredHost {
    pub address: IpAddr,
    pub hostname: String,
    pub status: String,
    pub auth_name: String,
    pub discovered_at: String,
    pub willing: bool,
}

/// Manages XDMCP host discovery.
#[derive(Debug)]
pub struct DiscoveryManager {
    hosts: HashMap<IpAddr, DiscoveredHost>,
    query_type: QueryType,
    broadcast_address: Option<String>,
    auth_names: Vec<String>,
    timeout_secs: u32,
}

impl DiscoveryManager {
    pub fn new(query_type: QueryType) -> Self {
        Self {
            hosts: HashMap::new(),
            query_type,
            broadcast_address: None,
            auth_names: Vec::new(),
            timeout_secs: 5,
        }
    }

    pub fn set_broadcast_address(&mut self, addr: String) {
        self.broadcast_address = Some(addr);
    }

    pub fn set_timeout(&mut self, secs: u32) {
        self.timeout_secs = secs;
    }

    pub fn set_auth_names(&mut self, names: Vec<String>) {
        self.auth_names = names;
    }

    /// Build the query packet for the configured type.
    pub fn build_query_packet(&self) -> bytes::BytesMut {
        let auth_refs: Vec<&str> = self.auth_names.iter().map(|s| s.as_str()).collect();
        match self.query_type {
            QueryType::Direct | QueryType::Indirect => protocol::build_query(&auth_refs),
            QueryType::Broadcast => protocol::build_broadcast_query(&auth_refs),
        }
    }

    /// Process a Willing response.
    pub fn handle_willing(&mut self, addr: IpAddr, response: &protocol::WillingResponse) {
        self.hosts.insert(
            addr,
            DiscoveredHost {
                address: addr,
                hostname: response.hostname.clone(),
                status: response.status.clone(),
                auth_name: response.auth_name.clone(),
                discovered_at: chrono::Utc::now().to_rfc3339(),
                willing: true,
            },
        );
    }

    /// Process an Unwilling response.
    pub fn handle_unwilling(&mut self, addr: IpAddr, hostname: &str, status: &str) {
        self.hosts.insert(
            addr,
            DiscoveredHost {
                address: addr,
                hostname: hostname.to_string(),
                status: status.to_string(),
                auth_name: String::new(),
                discovered_at: chrono::Utc::now().to_rfc3339(),
                willing: false,
            },
        );
    }

    /// List all discovered hosts.
    pub fn list_hosts(&self) -> Vec<&DiscoveredHost> {
        self.hosts.values().collect()
    }

    /// List only willing hosts.
    pub fn list_willing(&self) -> Vec<&DiscoveredHost> {
        self.hosts.values().filter(|h| h.willing).collect()
    }

    /// Get a specific host.
    pub fn get_host(&self, addr: &IpAddr) -> Option<&DiscoveredHost> {
        self.hosts.get(addr)
    }

    /// Clear all discovered hosts.
    pub fn clear(&mut self) {
        self.hosts.clear();
    }

    /// Number of discovered hosts.
    pub fn count(&self) -> usize {
        self.hosts.len()
    }

    /// Target address for the query.
    pub fn target_address(&self) -> String {
        match self.query_type {
            QueryType::Broadcast => self
                .broadcast_address
                .clone()
                .unwrap_or_else(|| "255.255.255.255".to_string()),
            _ => "0.0.0.0".to_string(), // Direct/Indirect use the config host
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn discovery_lifecycle() {
        let mut mgr = DiscoveryManager::new(QueryType::Broadcast);
        assert_eq!(mgr.count(), 0);

        let willing = protocol::WillingResponse {
            auth_name: String::new(),
            hostname: "server1.local".into(),
            status: "Ready".into(),
        };
        mgr.handle_willing(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)), &willing);

        assert_eq!(mgr.count(), 1);
        assert_eq!(mgr.list_willing().len(), 1);
    }

    #[test]
    fn unwilling_host() {
        let mut mgr = DiscoveryManager::new(QueryType::Direct);
        mgr.handle_unwilling(
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            "busy-server",
            "Too many sessions",
        );
        assert_eq!(mgr.list_willing().len(), 0);
        assert_eq!(mgr.list_hosts().len(), 1);
    }

    #[test]
    fn broadcast_target() {
        let mgr = DiscoveryManager::new(QueryType::Broadcast);
        assert_eq!(mgr.target_address(), "255.255.255.255");

        let mut mgr2 = DiscoveryManager::new(QueryType::Broadcast);
        mgr2.set_broadcast_address("192.168.1.255".into());
        assert_eq!(mgr2.target_address(), "192.168.1.255");
    }

    #[test]
    fn query_packet_builds() {
        let mgr = DiscoveryManager::new(QueryType::Direct);
        let pkt = mgr.build_query_packet();
        assert!(pkt.len() >= 6); // At least header
    }
}
