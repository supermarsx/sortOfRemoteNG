//! # sorng-netutils — Network Utilities & Diagnostics
//!
//! Comprehensive crate for network diagnostic, monitoring, and analysis
//! utilities. Wraps commonly used CLI tools into a unified Rust API with
//! structured output parsing and Tauri command integration.
//!
//! ## Supported Utilities
//!
//! ### Connectivity & Routing
//! - **ping** — ICMP echo (IPv4/IPv6), flood, adaptive interval, payload size
//! - **traceroute** — UDP/ICMP/TCP path tracing, ASN lookup, Paris traceroute
//! - **mtr** — Continuous traceroute with loss/jitter/latency statistics
//! - **route** — Routing table inspection (ip route, netstat -rn, route print)
//! - **arping** — ARP-level host probing
//!
//! ### Discovery & Scanning
//! - **nmap** — Port scanning, OS fingerprinting, service detection, scripts (NSE)
//! - **arp** — ARP cache inspection and management
//! - **neighbor** — IPv6 neighbor discovery (NDP)
//! - **wake_on_lan** — Magic packet generation (WoL)
//! - **mdns** — mDNS/DNS-SD service browser
//!
//! ### DNS & Name Resolution
//! - **dig** — DNS query tool (A, AAAA, MX, TXT, SRV, PTR, CNAME, NS, SOA)
//! - **nslookup** — Legacy name resolution
//! - **whois** — Domain/IP WHOIS lookup with RDAP support
//! - **host** — Simple DNS lookup utility
//!
//! ### Interface & Link
//! - **netstat** — Socket / connection listing (netstat / ss)
//! - **ethtool** — NIC capabilities, offloads, driver info, statistics
//! - **ip** — ip address / ip link / ip neigh inspection
//! - **ifconfig** — Legacy interface configuration
//! - **iwconfig** — Wireless interface statistics (signal, bitrate, frequency)
//!
//! ### Capture & Analysis
//! - **tcpdump** — Packet capture with BPF filters, pcap export
//! - **tshark** — Wireshark CLI capture and protocol dissection
//! - **ngrep** — Pattern-matched packet sniffing
//!
//! ### Performance & Bandwidth
//! - **iperf** — iperf3 TCP/UDP bandwidth measurement (client & server)
//! - **speedtest** — CLI speed test (Ookla / Cloudflare / LibreSpeed)
//! - **curl** — HTTP(S) timing, headers, TLS info
//! - **wget** — Recursive download, mirroring, retry
//!
//! ### Miscellaneous
//! - **nc** — Netcat connectivity probing (TCP/UDP)
//! - **socat** — Advanced socket relay / proxy
//! - **nload** — Real-time bandwidth monitor
//! - **iftop** — Per-connection bandwidth monitor
//! - **ss** — Socket statistics (replacement for netstat)
//! - **lsof** — Network file descriptor listing
//!
//! ## Modules
//!
//! - **types** — Shared data types for all utilities
//! - **service** — Central `NetUtilsService` orchestrator
//! - **ping** — ICMP ping wrapper
//! - **traceroute** — Traceroute / tracepath wrapper
//! - **mtr** — MTR continuous trace wrapper
//! - **nmap** — Nmap scanner wrapper
//! - **netstat** — netstat / ss socket listing
//! - **arp** — ARP cache management
//! - **dig** — DNS dig query tool
//! - **whois** — WHOIS / RDAP lookup
//! - **ethtool** — NIC diagnostics
//! - **tcpdump** — Packet capture engine
//! - **iperf** — Bandwidth measurement
//! - **speedtest** — Internet speed testing
//! - **route** — Routing table management
//! - **wake_on_lan** — WoL magic packet sender
//! - **curl** — HTTP timing and diagnostics
//! - **netcat** — TCP/UDP probing
//! - **lsof** — Network fd listing
//! - **bandwidth** — Real-time bandwidth monitoring (nload/iftop)
//! - **diagnostics** — Cross-utility health checks and reporting

pub mod types;
pub mod service;
pub mod ping;
pub mod traceroute;
pub mod mtr;
pub mod nmap;
pub mod netstat;
pub mod arp;
pub mod dig;
pub mod whois;
pub mod ethtool;
pub mod tcpdump;
pub mod iperf;
pub mod speedtest;
pub mod route;
pub mod wake_on_lan;
pub mod curl;
pub mod netcat;
pub mod lsof;
pub mod bandwidth;
pub mod diagnostics;

pub use types::*;
pub use service::{NetUtilsService, NetUtilsServiceState};
