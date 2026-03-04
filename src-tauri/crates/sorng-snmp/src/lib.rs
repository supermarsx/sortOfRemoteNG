//! # sorng-snmp — Comprehensive SNMP Management
//!
//! Full-featured SNMP (Simple Network Management Protocol) crate providing:
//!
//! - **Protocol versions** — SNMPv1, SNMPv2c, and SNMPv3 (USM)
//! - **Core operations** — GET, GET-NEXT, GET-BULK, SET, INFORM
//! - **Walk / bulk-walk** — tree traversal with automatic next-OID chaining
//! - **Table retrieval** — columnar table fetch with index extraction
//! - **Trap receiver** — async listener for v1 Traps, v2c/v3 Trap2 & InformRequest
//! - **MIB browser** — parse MIB modules, resolve OID ↔ name, display tree
//! - **Device discovery** — broadcast/unicast SNMP probes on subnets
//! - **Monitoring engine** — polled & threshold-based alerts, history ring-buffers
//! - **SNMPv3 security** — USM users, auth (MD5/SHA/SHA-256/SHA-512), priv (DES/AES-128/AES-256)
//! - **BER codec** — encode / decode ASN.1 Basic Encoding Rules for SNMP PDUs
//! - **OID helpers** — parse, format, compare, wildcard match, MIB name resolution
//! - **Interface statistics** — IF-MIB helpers for bandwidth, errors, utilisation
//! - **System info** — sysDescr, sysUpTime, sysContact, sysName, sysLocation
//!
//! Used by the sortOfRemoteNG front-end for network device management and monitoring.

pub mod types;
pub mod error;
pub mod oid;
pub mod ber;
pub mod pdu;
pub mod v3;
pub mod client;
pub mod get;
pub mod walk;
pub mod set;
pub mod table;
pub mod bulk;
pub mod trap;
pub mod mib;
pub mod discovery;
pub mod monitor;
pub mod ifmib;
pub mod system_info;
pub mod service;
pub mod commands;

pub use types::*;
pub use error::{SnmpError, SnmpErrorKind, SnmpResult};
pub use service::{SnmpService, SnmpServiceState};
