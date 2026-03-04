//! # OID Utilities
//!
//! Parse, format, compare, and manipulate SNMP Object Identifiers.

use crate::error::{SnmpError, SnmpResult};
use serde::{Deserialize, Serialize};

/// A parsed OID as a sequence of unsigned sub-identifiers.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Oid {
    /// Sub-identifiers, e.g. [1, 3, 6, 1, 2, 1, 1, 1, 0].
    pub components: Vec<u32>,
}

impl Oid {
    /// Parse a dotted-decimal OID string like "1.3.6.1.2.1.1.1.0".
    pub fn parse(s: &str) -> SnmpResult<Self> {
        let s = s.trim().trim_start_matches('.');
        if s.is_empty() {
            return Err(SnmpError::invalid_oid("Empty OID string"));
        }
        let components: Result<Vec<u32>, _> = s.split('.').map(|part| {
            part.parse::<u32>().map_err(|_| SnmpError::invalid_oid(format!("Invalid OID component: '{}'", part)))
        }).collect();
        Ok(Self { components: components? })
    }

    /// Create from raw component slice.
    pub fn from_components(components: &[u32]) -> Self {
        Self { components: components.to_vec() }
    }

    /// Dot-separated string representation.
    pub fn to_dotted(&self) -> String {
        self.components.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(".")
    }

    /// Returns true if `self` is a prefix of `other`.
    pub fn is_parent_of(&self, other: &Oid) -> bool {
        if self.components.len() >= other.components.len() {
            return false;
        }
        other.components.starts_with(&self.components)
    }

    /// Returns true if `other` is a prefix of `self`.
    pub fn is_child_of(&self, other: &Oid) -> bool {
        other.is_parent_of(self)
    }

    /// Returns the parent OID (removing the last component).
    pub fn parent(&self) -> Option<Self> {
        if self.components.len() <= 1 {
            return None;
        }
        Some(Self { components: self.components[..self.components.len() - 1].to_vec() })
    }

    /// Append a sub-identifier.
    pub fn child(&self, sub: u32) -> Self {
        let mut comps = self.components.clone();
        comps.push(sub);
        Self { components: comps }
    }

    /// Number of sub-identifiers.
    pub fn len(&self) -> usize {
        self.components.len()
    }

    /// Whether the OID is empty.
    pub fn is_empty(&self) -> bool {
        self.components.is_empty()
    }

    /// Extract the index suffix after a base OID.
    /// E.g. "1.3.6.1.2.1.2.2.1.1.5".suffix_after("1.3.6.1.2.1.2.2.1.1") => Some("5")
    pub fn suffix_after(&self, base: &Oid) -> Option<String> {
        if !self.is_child_of(base) && self != base {
            return None;
        }
        if self.components.len() <= base.components.len() {
            return None;
        }
        let suffix = &self.components[base.components.len()..];
        Some(suffix.iter().map(|c| c.to_string()).collect::<Vec<_>>().join("."))
    }

    /// BER-encode the OID value bytes (without the tag/length wrapper).
    pub fn encode_value(&self) -> Vec<u8> {
        if self.components.len() < 2 {
            return vec![];
        }
        let mut bytes = vec![];
        // First two components encoded as single byte: 40*X + Y
        bytes.push((self.components[0] * 40 + self.components[1]) as u8);
        for &comp in &self.components[2..] {
            encode_sub_id(&mut bytes, comp);
        }
        bytes
    }

    /// Decode OID from BER value bytes.
    pub fn decode_value(bytes: &[u8]) -> SnmpResult<Self> {
        if bytes.is_empty() {
            return Err(SnmpError::encoding("Empty OID value bytes"));
        }
        let mut components = vec![];
        // First byte encodes two components
        let first = bytes[0] as u32;
        components.push(first / 40);
        components.push(first % 40);

        let mut i = 1;
        while i < bytes.len() {
            let (sub_id, consumed) = decode_sub_id(&bytes[i..])?;
            components.push(sub_id);
            i += consumed;
        }
        Ok(Self { components })
    }
}

impl std::fmt::Display for Oid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_dotted())
    }
}

impl PartialOrd for Oid {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Oid {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.components.cmp(&other.components)
    }
}

// ── BER sub-identifier encoding helpers ─────────────────────────────

fn encode_sub_id(buf: &mut Vec<u8>, mut value: u32) {
    if value == 0 {
        buf.push(0);
        return;
    }
    let mut temp = vec![];
    while value > 0 {
        temp.push((value & 0x7F) as u8);
        value >>= 7;
    }
    temp.reverse();
    for (i, byte) in temp.iter().enumerate() {
        if i < temp.len() - 1 {
            buf.push(byte | 0x80);
        } else {
            buf.push(*byte);
        }
    }
}

fn decode_sub_id(bytes: &[u8]) -> SnmpResult<(u32, usize)> {
    let mut value: u32 = 0;
    let mut consumed = 0;
    for &b in bytes {
        consumed += 1;
        value = value.checked_shl(7)
            .ok_or_else(|| SnmpError::encoding("OID sub-identifier overflow"))?
            | (b & 0x7F) as u32;
        if b & 0x80 == 0 {
            return Ok((value, consumed));
        }
    }
    Err(SnmpError::encoding("Truncated OID sub-identifier"))
}

// ── Well-known OID constants ────────────────────────────────────────

/// Well-known SNMP OIDs.
pub mod well_known {
    /// iso.org.dod.internet prefix: 1.3.6.1
    pub const INTERNET: &str = "1.3.6.1";
    /// MIB-2 prefix: 1.3.6.1.2.1
    pub const MIB2: &str = "1.3.6.1.2.1";
    /// system group: 1.3.6.1.2.1.1
    pub const SYSTEM: &str = "1.3.6.1.2.1.1";
    pub const SYS_DESCR: &str = "1.3.6.1.2.1.1.1.0";
    pub const SYS_OBJECT_ID: &str = "1.3.6.1.2.1.1.2.0";
    pub const SYS_UPTIME: &str = "1.3.6.1.2.1.1.3.0";
    pub const SYS_CONTACT: &str = "1.3.6.1.2.1.1.4.0";
    pub const SYS_NAME: &str = "1.3.6.1.2.1.1.5.0";
    pub const SYS_LOCATION: &str = "1.3.6.1.2.1.1.6.0";
    pub const SYS_SERVICES: &str = "1.3.6.1.2.1.1.7.0";

    /// interfaces group: 1.3.6.1.2.1.2
    pub const INTERFACES: &str = "1.3.6.1.2.1.2";
    pub const IF_NUMBER: &str = "1.3.6.1.2.1.2.1.0";
    pub const IF_TABLE: &str = "1.3.6.1.2.1.2.2";
    pub const IF_ENTRY: &str = "1.3.6.1.2.1.2.2.1";
    pub const IF_INDEX: &str = "1.3.6.1.2.1.2.2.1.1";
    pub const IF_DESCR: &str = "1.3.6.1.2.1.2.2.1.2";
    pub const IF_TYPE: &str = "1.3.6.1.2.1.2.2.1.3";
    pub const IF_MTU: &str = "1.3.6.1.2.1.2.2.1.4";
    pub const IF_SPEED: &str = "1.3.6.1.2.1.2.2.1.5";
    pub const IF_PHYS_ADDRESS: &str = "1.3.6.1.2.1.2.2.1.6";
    pub const IF_ADMIN_STATUS: &str = "1.3.6.1.2.1.2.2.1.7";
    pub const IF_OPER_STATUS: &str = "1.3.6.1.2.1.2.2.1.8";
    pub const IF_IN_OCTETS: &str = "1.3.6.1.2.1.2.2.1.10";
    pub const IF_OUT_OCTETS: &str = "1.3.6.1.2.1.2.2.1.16";
    pub const IF_IN_ERRORS: &str = "1.3.6.1.2.1.2.2.1.14";
    pub const IF_OUT_ERRORS: &str = "1.3.6.1.2.1.2.2.1.20";

    /// ifXTable (IF-MIB): 1.3.6.1.2.1.31.1.1
    pub const IF_X_TABLE: &str = "1.3.6.1.2.1.31.1.1";
    pub const IF_HC_IN_OCTETS: &str = "1.3.6.1.2.1.31.1.1.1.6";
    pub const IF_HC_OUT_OCTETS: &str = "1.3.6.1.2.1.31.1.1.1.10";
    pub const IF_HIGH_SPEED: &str = "1.3.6.1.2.1.31.1.1.1.15";
    pub const IF_ALIAS: &str = "1.3.6.1.2.1.31.1.1.1.18";

    /// IP group
    pub const IP: &str = "1.3.6.1.2.1.4";
    pub const IP_FORWARDING: &str = "1.3.6.1.2.1.4.1.0";
    pub const IP_ADDR_TABLE: &str = "1.3.6.1.2.1.4.20";
    pub const IP_ROUTE_TABLE: &str = "1.3.6.1.2.1.4.21";

    /// TCP group
    pub const TCP: &str = "1.3.6.1.2.1.6";
    pub const TCP_CONN_TABLE: &str = "1.3.6.1.2.1.6.13";

    /// UDP group
    pub const UDP: &str = "1.3.6.1.2.1.7";

    /// SNMP group (SNMP-MIB)
    pub const SNMP: &str = "1.3.6.1.2.1.11";
    pub const SNMP_IN_PKTS: &str = "1.3.6.1.2.1.11.1.0";
    pub const SNMP_OUT_PKTS: &str = "1.3.6.1.2.1.11.2.0";

    /// Host resources (HOST-RESOURCES-MIB)
    pub const HOST_RESOURCES: &str = "1.3.6.1.2.1.25";
    pub const HR_SYSTEM_UPTIME: &str = "1.3.6.1.2.1.25.1.1.0";
    pub const HR_STORAGE_TABLE: &str = "1.3.6.1.2.1.25.2.3";
    pub const HR_PROCESSOR_TABLE: &str = "1.3.6.1.2.1.25.3.3";

    /// Entity MIB
    pub const ENTITY_MIB: &str = "1.3.6.1.2.1.47";

    /// SNMP notification prefix
    pub const SNMP_TRAP_OID: &str = "1.3.6.1.6.3.1.1.4.1.0";
    pub const SNMP_TRAP_ENTERPRISE: &str = "1.3.6.1.6.3.1.1.4.3.0";

    /// linkDown / linkUp traps
    pub const LINK_DOWN: &str = "1.3.6.1.6.3.1.1.5.3";
    pub const LINK_UP: &str = "1.3.6.1.6.3.1.1.5.4";
    pub const AUTH_FAILURE: &str = "1.3.6.1.6.3.1.1.5.5";

    /// Enterprises prefix
    pub const ENTERPRISES: &str = "1.3.6.1.4.1";
}
