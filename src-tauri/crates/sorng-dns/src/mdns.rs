//! # mDNS / DNS-SD
//!
//! Multicast DNS (RFC 6762) and DNS-based Service Discovery (RFC 6763)
//! for LAN peer/service discovery. Used by sorng-p2p for local peer
//! finding without a central coordination server.

use crate::types::{DnsRecord, DnsRecordData, DnsRecordType, MdnsRegistration, MdnsService};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// mDNS multicast addresses.
pub const MDNS_IPV4_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
pub const MDNS_IPV6_ADDR: Ipv6Addr = Ipv6Addr::new(0xff02, 0, 0, 0, 0, 0, 0, 0xfb);
pub const MDNS_PORT: u16 = 5353;

/// Default service type for SortOfRemoteNG.
pub const SORNG_SERVICE_TYPE: &str = "_sorng._tcp.local.";
pub const SORNG_SERVICE_NAME: &str = "SortOfRemoteNG";

/// mDNS browser state.
pub type MdnsBrowserState = Arc<Mutex<MdnsBrowser>>;

/// Tracks discovered services and own registrations.
pub struct MdnsBrowser {
    /// Discovered services on the LAN.
    pub discovered: HashMap<String, DiscoveredService>,
    /// Our own service registrations.
    pub registrations: Vec<ActiveRegistration>,
    /// Whether the browser is actively listening.
    pub running: bool,
    /// Callback ID counter.
    _next_callback_id: u64,
    /// Discovery callbacks.
    pub callbacks: HashMap<u64, String>,
}

impl MdnsBrowser {
    pub fn new() -> Self {
        Self {
            discovered: HashMap::new(),
            registrations: Vec::new(),
            running: false,
            _next_callback_id: 0,
            callbacks: HashMap::new(),
        }
    }
}

impl Default for MdnsBrowser {
    fn default() -> Self {
        Self::new()
    }
}

/// A service discovered via mDNS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredService {
    pub instance_name: String,
    pub service_type: String,
    pub hostname: String,
    pub port: u16,
    pub ipv4_addresses: Vec<String>,
    pub ipv6_addresses: Vec<String>,
    pub txt_records: HashMap<String, String>,
    pub discovered_at: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
    pub ttl_seconds: u32,
}

/// An active registration we are advertising.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveRegistration {
    pub id: String,
    pub service: MdnsService,
    pub registered_at: chrono::DateTime<chrono::Utc>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Service registration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Create a SortOfRemoteNG mDNS service registration.
pub fn create_sorng_service(
    instance_name: &str,
    port: u16,
    node_id: &str,
    version: &str,
) -> MdnsRegistration {
    let mut txt = HashMap::new();
    txt.insert("node_id".to_string(), node_id.to_string());
    txt.insert("version".to_string(), version.to_string());
    txt.insert("app".to_string(), SORNG_SERVICE_NAME.to_string());

    MdnsRegistration {
        service_type: SORNG_SERVICE_TYPE.to_string(),
        instance_name: instance_name.to_string(),
        port,
        txt_records: txt,
    }
}

/// Register a service for mDNS advertisement.
pub async fn register_service(
    state: &MdnsBrowserState,
    registration: MdnsRegistration,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();

    let service = MdnsService {
        service_type: registration.service_type.clone(),
        instance_name: registration.instance_name.clone(),
        domain: "local".to_string(),
        hostname: String::new(),
        port: registration.port,
        addresses: Vec::new(),
        txt_records: registration.txt_records.clone(),
        ttl: 120,
        discovered_at: chrono::Utc::now().to_rfc3339(),
    };

    let active = ActiveRegistration {
        id: id.clone(),
        service,
        registered_at: chrono::Utc::now(),
    };

    let mut browser = state.lock().await;
    browser.registrations.push(active);

    log::info!(
        "Registered mDNS service: {} ({}:{})",
        registration.instance_name,
        registration.service_type,
        registration.port
    );

    Ok(id)
}

/// Unregister a service.
pub async fn unregister_service(
    state: &MdnsBrowserState,
    registration_id: &str,
) -> Result<(), String> {
    let mut browser = state.lock().await;
    let before = browser.registrations.len();
    browser.registrations.retain(|r| r.id != registration_id);

    if browser.registrations.len() < before {
        log::info!("Unregistered mDNS service: {}", registration_id);
        Ok(())
    } else {
        Err(format!(
            "Registration not found: {}",
            registration_id
        ))
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Service browsing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Start mDNS browsing for a service type.
pub async fn start_browsing(
    state: &MdnsBrowserState,
    service_type: &str,
) -> Result<(), String> {
    let mut browser = state.lock().await;

    if browser.running {
        return Err("mDNS browser is already running".to_string());
    }

    browser.running = true;
    log::info!("Started mDNS browsing for: {}", service_type);

    // In a full implementation, this would bind to the mDNS multicast group
    // and send PTR queries for the service_type. The response parsing feeds
    // into `process_mdns_response()` below.

    Ok(())
}

/// Stop mDNS browsing.
pub async fn stop_browsing(state: &MdnsBrowserState) -> Result<(), String> {
    let mut browser = state.lock().await;
    browser.running = false;
    log::info!("Stopped mDNS browsing");
    Ok(())
}

/// Process an mDNS response packet and update discovered services.
pub async fn process_mdns_response(
    state: &MdnsBrowserState,
    records: &[DnsRecord],
) -> Vec<DiscoveredService> {
    let mut new_services = Vec::new();
    let mut browser = state.lock().await;
    let now = chrono::Utc::now();

    // Group records by instance name
    let mut srv_records: HashMap<String, (String, u16)> = HashMap::new();
    let mut a_records: HashMap<String, Vec<String>> = HashMap::new();
    let mut aaaa_records: HashMap<String, Vec<String>> = HashMap::new();
    let mut txt_records: HashMap<String, HashMap<String, String>> = HashMap::new();

    for record in records {
        match &record.data {
            DnsRecordData::SRV {
                target, port, ..
            } => {
                srv_records.insert(record.name.clone(), (target.clone(), *port));
            }
            DnsRecordData::A { address } => {
                a_records
                    .entry(record.name.clone())
                    .or_default()
                    .push(address.clone());
            }
            DnsRecordData::AAAA { address } => {
                aaaa_records
                    .entry(record.name.clone())
                    .or_default()
                    .push(address.clone());
            }
            DnsRecordData::TXT { text } => {
                let mut map = HashMap::new();
                for v in text.split('\n') {
                    if let Some((k, val)) = v.split_once('=') {
                        map.insert(k.to_string(), val.to_string());
                    }
                }
                txt_records.insert(record.name.clone(), map);
            }
            _ => {}
        }
    }

    // Build discovered services from SRV records
    for (instance_name, (hostname, port)) in &srv_records {
        let ipv4 = a_records.get(hostname.as_str()).cloned().unwrap_or_default();
        let ipv6 = aaaa_records.get(hostname.as_str()).cloned().unwrap_or_default();
        let txt = txt_records.get(instance_name).cloned().unwrap_or_default();

        let service = DiscoveredService {
            instance_name: instance_name.clone(),
            service_type: extract_service_type(instance_name),
            hostname: hostname.clone(),
            port: *port,
            ipv4_addresses: ipv4,
            ipv6_addresses: ipv6,
            txt_records: txt,
            discovered_at: now,
            last_seen: now,
            ttl_seconds: 120,
        };

        let is_new = !browser.discovered.contains_key(instance_name);
        browser
            .discovered
            .insert(instance_name.clone(), service.clone());

        if is_new {
            new_services.push(service);
        }
    }

    new_services
}

/// Get all currently discovered services.
pub async fn get_discovered_services(state: &MdnsBrowserState) -> Vec<DiscoveredService> {
    let browser = state.lock().await;
    browser.discovered.values().cloned().collect()
}

/// Get only SortOfRemoteNG peer services.
pub async fn get_sorng_peers(state: &MdnsBrowserState) -> Vec<DiscoveredService> {
    let browser = state.lock().await;
    browser
        .discovered
        .values()
        .filter(|s| s.service_type == SORNG_SERVICE_TYPE)
        .cloned()
        .collect()
}

/// Remove expired services based on TTL.
pub async fn purge_expired_services(state: &MdnsBrowserState) -> usize {
    let mut browser = state.lock().await;
    let now = chrono::Utc::now();
    let before = browser.discovered.len();

    browser.discovered.retain(|_, service| {
        let age = now
            .signed_duration_since(service.last_seen)
            .num_seconds();
        age < service.ttl_seconds as i64 * 2 // 2x TTL grace period
    });

    let removed = before - browser.discovered.len();
    if removed > 0 {
        log::debug!("Purged {} expired mDNS services", removed);
    }
    removed
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  mDNS query helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build an mDNS PTR query packet for service discovery.
pub fn build_mdns_query(service_type: &str) -> Vec<u8> {
    let mut packet = Vec::with_capacity(512);

    // Header: ID=0, QR=0 (query), OPCODE=0, AA=0, TC=0, RD=0
    packet.extend_from_slice(&[0u8; 4]); // ID + flags = 0
    packet.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT = 1
    packet.extend_from_slice(&[0u8; 6]); // ANCOUNT, NSCOUNT, ARCOUNT = 0

    // Question: service_type as labels
    for label in service_type.trim_end_matches('.').split('.') {
        packet.push(label.len() as u8);
        packet.extend_from_slice(label.as_bytes());
    }
    packet.push(0); // root label

    // Type = PTR (12), Class = IN (1) with unicast-response bit clear
    packet.extend_from_slice(&DnsRecordType::PTR.type_code().to_be_bytes());
    packet.extend_from_slice(&1u16.to_be_bytes()); // IN class

    packet
}

/// Build an mDNS response packet for announcing a service.
pub fn build_mdns_announcement(
    registration: &MdnsRegistration,
    hostname: &str,
    ipv4: Option<&str>,
    ipv6: Option<&str>,
    ttl: u32,
) -> Vec<u8> {
    let mut packet = Vec::with_capacity(512);

    // Count answers: PTR + SRV + TXT + optional A + optional AAAA
    let answer_count: u16 = 3 + ipv4.is_some() as u16 + ipv6.is_some() as u16;

    // Header: QR=1 (response), AA=1, TC=0
    packet.extend_from_slice(&[0u8; 2]); // ID = 0
    packet.extend_from_slice(&[0x84, 0x00]); // flags: QR=1, AA=1
    packet.extend_from_slice(&0u16.to_be_bytes()); // QDCOUNT = 0
    packet.extend_from_slice(&answer_count.to_be_bytes()); // ANCOUNT
    packet.extend_from_slice(&[0u8; 4]); // NSCOUNT, ARCOUNT = 0

    // Helper: encode a DNS name as labels
    fn encode_name(packet: &mut Vec<u8>, name: &str) {
        for label in name.trim_end_matches('.').split('.') {
            packet.push(label.len() as u8);
            packet.extend_from_slice(label.as_bytes());
        }
        packet.push(0);
    }

    // PTR record: service_type -> instance_name.service_type
    let full_instance_name = format!(
        "{}.{}",
        registration.instance_name,
        registration.service_type.trim_end_matches('.')
    );
    encode_name(&mut packet, &registration.service_type);
    packet.extend_from_slice(&DnsRecordType::PTR.type_code().to_be_bytes());
    packet.extend_from_slice(&1u16.to_be_bytes()); // IN class + cache-flush
    packet.extend_from_slice(&ttl.to_be_bytes());

    // PTR RDATA: the instance name
    let mut rdata = Vec::new();
    encode_name(&mut rdata, &full_instance_name);
    packet.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
    packet.extend_from_slice(&rdata);

    // SRV record
    encode_name(&mut packet, &full_instance_name);
    packet.extend_from_slice(&DnsRecordType::SRV.type_code().to_be_bytes());
    packet.extend_from_slice(&0x8001u16.to_be_bytes()); // IN class + cache-flush
    packet.extend_from_slice(&ttl.to_be_bytes());

    let mut srv_rdata = Vec::new();
    srv_rdata.extend_from_slice(&0u16.to_be_bytes()); // priority
    srv_rdata.extend_from_slice(&0u16.to_be_bytes()); // weight
    srv_rdata.extend_from_slice(&registration.port.to_be_bytes());
    encode_name(&mut srv_rdata, hostname);
    packet.extend_from_slice(&(srv_rdata.len() as u16).to_be_bytes());
    packet.extend_from_slice(&srv_rdata);

    // TXT record
    encode_name(&mut packet, &full_instance_name);
    packet.extend_from_slice(&DnsRecordType::TXT.type_code().to_be_bytes());
    packet.extend_from_slice(&0x8001u16.to_be_bytes()); // IN class + cache-flush
    packet.extend_from_slice(&ttl.to_be_bytes());

    let mut txt_rdata = Vec::new();
    for (key, value) in &registration.txt_records {
        let entry = format!("{}={}", key, value);
        txt_rdata.push(entry.len() as u8);
        txt_rdata.extend_from_slice(entry.as_bytes());
    }
    if txt_rdata.is_empty() {
        txt_rdata.push(0); // empty TXT record
    }
    packet.extend_from_slice(&(txt_rdata.len() as u16).to_be_bytes());
    packet.extend_from_slice(&txt_rdata);

    // A record (if available)
    if let Some(ip4) = ipv4 {
        encode_name(&mut packet, hostname);
        packet.extend_from_slice(&DnsRecordType::A.type_code().to_be_bytes());
        packet.extend_from_slice(&0x8001u16.to_be_bytes());
        packet.extend_from_slice(&ttl.to_be_bytes());
        packet.extend_from_slice(&4u16.to_be_bytes()); // RDLENGTH
        if let Ok(addr) = ip4.parse::<Ipv4Addr>() {
            packet.extend_from_slice(&addr.octets());
        }
    }

    // AAAA record (if available)
    if let Some(ip6) = ipv6 {
        encode_name(&mut packet, hostname);
        packet.extend_from_slice(&DnsRecordType::AAAA.type_code().to_be_bytes());
        packet.extend_from_slice(&0x8001u16.to_be_bytes());
        packet.extend_from_slice(&ttl.to_be_bytes());
        packet.extend_from_slice(&16u16.to_be_bytes()); // RDLENGTH
        if let Ok(addr) = ip6.parse::<Ipv6Addr>() {
            packet.extend_from_slice(&addr.octets());
        }
    }

    packet
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Extract service type from a fully-qualified instance name.
/// e.g. "MyPC._sorng._tcp.local." -> "_sorng._tcp.local."
fn extract_service_type(instance_name: &str) -> String {
    if let Some(idx) = instance_name.find("._") {
        instance_name[idx + 1..].to_string()
    } else {
        instance_name.to_string()
    }
}

/// Get the multicast socket address for mDNS (IPv4).
pub fn mdns_socket_addr_v4() -> SocketAddr {
    SocketAddr::new(MDNS_IPV4_ADDR.into(), MDNS_PORT)
}

/// Get the multicast socket address for mDNS (IPv6).
pub fn mdns_socket_addr_v6() -> SocketAddr {
    SocketAddr::new(MDNS_IPV6_ADDR.into(), MDNS_PORT)
}
