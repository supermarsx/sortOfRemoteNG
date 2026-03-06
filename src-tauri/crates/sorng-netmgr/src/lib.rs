//! # sorng-netmgr — Network Management & Firewall Control
//!
//! Comprehensive crate for managing network interfaces and firewall rules
//! across Linux, BSD, macOS, and Windows platforms through a unified API.
//!
//! ## Supported Backends
//!
//! ### NetworkManager / nmcli
//! - Connection profiles (add, modify, delete, activate, deactivate)
//! - Device management (status, connect, disconnect, Wi-Fi scan)
//! - Wi-Fi networks (list, connect, forget, hotspot, hidden networks)
//! - VPN connections (import, configure, activate)
//! - Bonding, bridging, VLAN, teaming
//! - Dispatcher scripts
//! - Network profiles (location-aware switching)
//!
//! ### firewalld
//! - Zones (public, home, dmz, work, block, drop, trusted, internal, external)
//! - Services (add/remove/query in zones)
//! - Ports (tcp/udp/sctp permanent & runtime)
//! - Rich rules (complex firewall expressions)
//! - Direct rules (raw iptables/nftables passthrough)
//! - ICMP types (block/allow per zone)
//! - Masquerade / port forwarding
//! - IP sets, helpers, lockdown
//! - Runtime-to-permanent persistence
//!
//! ### iptables
//! - Table management (filter, nat, mangle, raw, security)
//! - Chain management (INPUT, OUTPUT, FORWARD, custom chains)
//! - Rule CRUD with match extensions (state, multiport, iprange, string, etc.)
//! - Connection tracking (conntrack)
//! - Saving / restoring rulesets (iptables-save / iptables-restore)
//! - IPv4 and IPv6 (ip6tables) unified handling
//!
//! ### nftables
//! - Table / chain / set / map management
//! - Rule expressions (verdict, match, payload, meta, counter)
//! - Atomic ruleset replacement
//! - JSON API (libnftables) interface
//! - Migration helpers from iptables
//!
//! ### ufw (Uncomplicated Firewall)
//! - Enable / disable / reset
//! - Allow / deny / reject / limit rules
//! - Application profiles
//! - Logging levels
//! - Numbered rules (insert / delete by number)
//! - Default policies (incoming, outgoing, routed)
//!
//! ### pf (Packet Filter — BSD/macOS)
//! - Ruleset load / flush
//! - Tables (persist, add/delete/flush addresses)
//! - Anchors (sub-rulesets)
//! - State table and statistics
//! - pflog interface monitoring
//!
//! ### Windows Firewall (netsh advfirewall)
//! - Profile management (domain, private, public)
//! - Inbound / outbound rules
//! - Program / port / predefined rules
//! - IPsec (connection security rules)
//! - Firewall state and logging
//!
//! ## Modules
//!
//! - **types** — Unified data types across all backends
//! - **service** — Central `NetMgrService` orchestrator
//! - **nmcli** — NetworkManager / nmcli wrapper
//! - **firewalld** — firewalld D-Bus / CLI wrapper
//! - **iptables** — iptables / ip6tables wrapper
//! - **nftables** — nftables / nft wrapper
//! - **ufw** — Uncomplicated Firewall wrapper
//! - **pf** — BSD/macOS Packet Filter wrapper
//! - **windows_fw** — Windows netsh advfirewall wrapper
//! - **interface** — Network interface management (ip link, ethtool)
//! - **wifi** — Wi-Fi management (wpa_supplicant, iwconfig, nmcli wifi)
//! - **vlan** — VLAN (802.1Q) management
//! - **bond** — Bonding / teaming configuration
//! - **bridge** — Bridge management
//! - **profile** — Network profile / location management
//! - **diagnostics** — Cross-backend health checks and rule auditing

pub mod types;
pub mod service;
pub mod nmcli;
pub mod firewalld;
pub mod iptables;
pub mod nftables;
pub mod ufw;
pub mod pf;
pub mod windows_fw;
pub mod interface;
pub mod wifi;
pub mod vlan;
pub mod bond;
pub mod bridge;
pub mod profile;
pub mod diagnostics;

pub use types::*;
pub use service::{NetMgrService, NetMgrServiceState};
