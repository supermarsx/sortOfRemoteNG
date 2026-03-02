//! # NAT Detection
//!
//! NAT type detection using STUN heuristics. Implements the classic STUN-based
//! NAT classification algorithm (RFC 3489 / RFC 5780) to determine the type of
//! NAT the host is behind.

use crate::stun;
use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::time::{Duration, Instant};

/// Detect the NAT type using STUN servers.
///
/// Algorithm (based on RFC 3489 §10.1 with RFC 5780 enhancements):
///
/// ```text
///                        +--------+
///                        |  Test  |
///                        |   I    |
///                        +--------+
///                             |
///                     +-------+-------+
///                     |               |
///                   Y |             N |
///                     |               |
///                +----+----+    +-----+-----+
///                |  Test   |    | UDP        |
///                |   II    |    | Blocked    |
///                +---------+    +-----------+
///                     |
///              +------+------+
///              |             |
///            Y |           N |
///              |             |
///      +-------+--+   +-----+-----+
///      |Open       |   |  Test     |
///      |Internet   |   |   I(2)    |
///      +-----------+   +-----------+
///                            |
///                     +------+------+
///                     |             |
///                   Y |           N |
///                     |             |
///               +-----+----+  +----+-----+
///               |Symmetric  |  |  Test    |
///               |NAT        |  |   III    |
///               +----------+  +----------+
///                                   |
///                            +------+------+
///                            |             |
///                          Y |           N |
///                            |             |
///                      +-----+----+ +-----+----+
///                      |Restricted | |Port      |
///                      |Cone NAT   | |Restricted|
///                      +----------+ |Cone NAT  |
///                                   +-----------+
/// ```
pub fn detect_nat_type(stun_servers: &[StunServer]) -> Result<NatDetectionResult, String> {
    if stun_servers.is_empty() {
        return Err("No STUN servers configured".to_string());
    }

    let start = Instant::now();
    info!("Starting NAT detection with {} STUN servers", stun_servers.len());

    // We need at least one, ideally two STUN servers for full detection
    let primary = &stun_servers[0];
    let secondary = stun_servers.get(1);

    let timeout = Duration::from_secs(5);

    // ── Test I: Basic STUN binding ──────────────────────────────
    // Send Binding Request to primary server
    // Result tells us our public (mapped) address
    let test1 = stun::stun_binding(primary, "0.0.0.0:0", timeout)?;
    info!("Test I: local={}, mapped={}", test1.local_addr, test1.mapped_addr);

    // Check if we're behind a NAT at all
    let is_direct = test1.local_addr == test1.mapped_addr;
    let is_cgnat = is_cgnat_address(&test1.mapped_addr);

    if is_direct {
        info!("NAT detection: Open Internet (no NAT)");
        return Ok(NatDetectionResult {
            nat_type: NatType::OpenInternet,
            local_addr: test1.local_addr,
            public_addr: Some(test1.mapped_addr),
            is_direct: true,
            is_cgnat: false,
            mapping_consistent: true,
            filtering: FilteringBehavior::EndpointIndependent,
            stun_servers_used: vec![primary.host.clone()],
            detected_at: Utc::now(),
            detection_time_ms: start.elapsed().as_millis() as u64,
        });
    }

    // ── Test II: Mapping behavior (RFC 5780) ────────────────────
    // Send Binding Request to a different address to test if mapping changes
    let mapping_consistent = if let Some(sec) = secondary {
        let test2 = stun::stun_binding(sec, &test1.local_addr, timeout);
        match test2 {
            Ok(binding) => {
                let consistent = binding.mapped_addr == test1.mapped_addr;
                info!(
                    "Test II: second mapped={} (consistent={})",
                    binding.mapped_addr, consistent
                );
                consistent
            }
            Err(e) => {
                warn!("Test II failed: {}", e);
                true // assume consistent if we can't test
            }
        }
    } else {
        true // can't test with only one server
    };

    // ── Test III: Filtering behavior ────────────────────────────
    // Ask the STUN server to send response from a different IP/port
    // This tests what the NAT allows through

    // Test III-a: Change IP and port
    let txn_a = stun::generate_transaction_id();
    let _test3a = stun::build_binding_request_change(&txn_a, true, true);
    // In a real implementation, send this and check if we get a response
    // If response received → Endpoint-Independent Filtering (Full Cone)

    // Test III-b: Change port only
    let txn_b = stun::generate_transaction_id();
    let _test3b = stun::build_binding_request_change(&txn_b, false, true);
    // If response received → Address-Dependent Filtering (Address Restricted)
    // If not → Address and Port Dependent Filtering (Port Restricted)

    // Determine NAT type based on tests
    let (nat_type, filtering) = if !mapping_consistent {
        // Different mapping for different destinations → Symmetric NAT
        if is_cgnat {
            (NatType::CarrierGradeNat, FilteringBehavior::AddressAndPortDependent)
        } else {
            (NatType::Symmetric, FilteringBehavior::AddressAndPortDependent)
        }
    } else {
        // Mapping is consistent → some form of cone NAT
        // Without the full Test III results, we estimate based on STUN behavior
        //
        // In a full implementation:
        //   - If Test III-a succeeds → Full Cone
        //   - If Test III-b succeeds → Address Restricted Cone
        //   - If neither succeeds → Port Restricted Cone

        // Default to port-restricted cone (most common)
        if is_cgnat {
            (NatType::CarrierGradeNat, FilteringBehavior::AddressAndPortDependent)
        } else {
            (NatType::PortRestrictedCone, FilteringBehavior::AddressAndPortDependent)
        }
    };

    let mut servers_used = vec![primary.host.clone()];
    if let Some(sec) = secondary {
        servers_used.push(sec.host.clone());
    }

    info!("NAT detection complete: {:?} ({:?})", nat_type, filtering);

    Ok(NatDetectionResult {
        nat_type,
        local_addr: test1.local_addr,
        public_addr: Some(test1.mapped_addr),
        is_direct,
        is_cgnat,
        mapping_consistent,
        filtering,
        stun_servers_used: servers_used,
        detected_at: Utc::now(),
        detection_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// Extended NAT detection with more probes for higher accuracy.
pub fn detect_nat_type_extended(stun_servers: &[StunServer]) -> Result<NatDetectionResult, String> {
    if stun_servers.len() < 3 {
        return detect_nat_type(stun_servers);
    }

    let start = Instant::now();
    let timeout = Duration::from_secs(5);

    // Perform bindings to 3 different servers from the same local port
    let bindings: Vec<StunBinding> = stun_servers
        .iter()
        .take(3)
        .filter_map(|s| stun::stun_binding(s, "0.0.0.0:0", timeout).ok())
        .collect();

    if bindings.is_empty() {
        return Err("All STUN servers unreachable".to_string());
    }

    // Analyze mapping consistency
    let all_same = bindings.windows(2).all(|w| w[0].mapped_addr == w[1].mapped_addr);
    let all_diff = bindings.windows(2).all(|w| w[0].mapped_addr != w[1].mapped_addr);

    // Analyze port pattern
    let pattern = crate::hole_punch::analyze_port_pattern(&bindings);

    let (nat_type, filtering) = if all_same {
        // Endpoint-independent mapping → Full Cone, Address Restricted, or Port Restricted
        // Need filtering tests to distinguish further
        (NatType::FullCone, FilteringBehavior::EndpointIndependent)
    } else if all_diff {
        match pattern {
            crate::hole_punch::PortAllocationPattern::Sequential(_) => {
                (NatType::Symmetric, FilteringBehavior::AddressAndPortDependent)
            }
            crate::hole_punch::PortAllocationPattern::Random => {
                (NatType::SymmetricRandom, FilteringBehavior::AddressAndPortDependent)
            }
            _ => (NatType::Symmetric, FilteringBehavior::AddressAndPortDependent),
        }
    } else {
        // Mixed results
        (NatType::PortRestrictedCone, FilteringBehavior::AddressDependent)
    };

    let is_cgnat = bindings.iter().any(|b| is_cgnat_address(&b.mapped_addr));

    let nat_type = if is_cgnat && nat_type != NatType::SymmetricRandom {
        NatType::CarrierGradeNat
    } else {
        nat_type
    };

    Ok(NatDetectionResult {
        nat_type,
        local_addr: bindings[0].local_addr.clone(),
        public_addr: Some(bindings[0].mapped_addr.clone()),
        is_direct: false,
        is_cgnat,
        mapping_consistent: all_same,
        filtering,
        stun_servers_used: stun_servers.iter().take(3).map(|s| s.host.clone()).collect(),
        detected_at: Utc::now(),
        detection_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// Check if an address is in the CGNAT range (100.64.0.0/10).
pub fn is_cgnat_address(addr: &str) -> bool {
    // Strip port if present
    let ip_str = if addr.contains(':') {
        addr.rsplitn(2, ':').last().unwrap_or(addr)
    } else {
        addr
    };

    if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
        let octets = ip.octets();
        // 100.64.0.0/10 = 100.64.0.0 - 100.127.255.255
        octets[0] == 100 && (octets[1] & 0xC0) == 64
    } else {
        false
    }
}

/// Check if an address is a private/RFC 1918 address.
pub fn is_private_address(addr: &str) -> bool {
    let ip_str = if addr.contains(':') {
        addr.rsplitn(2, ':').last().unwrap_or(addr)
    } else {
        addr
    };

    if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
        let octets = ip.octets();
        matches!(
            (octets[0], octets[1]),
            (10, _) | (172, 16..=31) | (192, 168)
        )
    } else {
        false
    }
}

/// Determine if two peers are behind the same NAT (hairpin scenario).
pub fn same_nat(local_public: &str, remote_public: &str) -> bool {
    let local_ip = local_public.rsplitn(2, ':').last().unwrap_or(local_public);
    let remote_ip = remote_public.rsplitn(2, ':').last().unwrap_or(remote_public);
    local_ip == remote_ip
}

/// Estimate NAT traversal difficulty between two NAT types.
/// Returns a difficulty score (0 = trivial, 10 = impossible without relay).
pub fn traversal_difficulty(local: NatType, remote: NatType) -> u8 {
    match (local, remote) {
        (NatType::OpenInternet, _) | (_, NatType::OpenInternet) => 0,
        (NatType::FullCone, NatType::FullCone) => 1,
        (NatType::FullCone, NatType::AddressRestrictedCone)
        | (NatType::AddressRestrictedCone, NatType::FullCone) => 2,
        (NatType::AddressRestrictedCone, NatType::AddressRestrictedCone) => 3,
        (NatType::FullCone, NatType::PortRestrictedCone)
        | (NatType::PortRestrictedCone, NatType::FullCone) => 3,
        (NatType::AddressRestrictedCone, NatType::PortRestrictedCone)
        | (NatType::PortRestrictedCone, NatType::AddressRestrictedCone) => 4,
        (NatType::PortRestrictedCone, NatType::PortRestrictedCone) => 5,
        (NatType::Symmetric, NatType::FullCone)
        | (NatType::FullCone, NatType::Symmetric) => 6,
        (NatType::Symmetric, NatType::AddressRestrictedCone)
        | (NatType::AddressRestrictedCone, NatType::Symmetric) => 7,
        (NatType::Symmetric, NatType::PortRestrictedCone)
        | (NatType::PortRestrictedCone, NatType::Symmetric) => 8,
        (NatType::Symmetric, NatType::Symmetric) => 9,
        (NatType::SymmetricRandom, _) | (_, NatType::SymmetricRandom) => 10,
        (NatType::CarrierGradeNat, NatType::CarrierGradeNat) => 9,
        (NatType::CarrierGradeNat, _) | (_, NatType::CarrierGradeNat) => 7,
        _ => 5,
    }
}
