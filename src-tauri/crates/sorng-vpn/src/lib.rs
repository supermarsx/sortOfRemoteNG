//! # SortOfRemote NG – VPN
//!
//! VPN services (OpenVPN, WireGuard, ZeroTier, Tailscale), proxy management,
//! and connection chaining/routing.

pub mod chaining;
pub mod credential_vault;
pub mod ikev2;
pub mod ipsec;
pub mod l2tp;
pub mod nesting;
pub mod openvpn;
pub mod persistence;
pub mod platform;
pub mod pptp;
pub mod proxy;
pub mod ras_helper;
#[cfg(feature = "vpn-softether")]
pub mod softether;
// NOTE: softether_cmds.rs is NOT listed here. Like the other `_cmds.rs`
// files (ikev2_cmds, pptp_cmds, etc.), it's included via `include!` from
// the app crate (`src-tauri/src/softether_commands.rs`). sorng-vpn has no
// tauri dep, so declaring it as a module would fail to compile.
pub mod sstp;
pub mod strongswan_helper;
pub mod tailscale;
pub mod unified_chain;
pub mod unified_chain_service;
pub mod validation;
pub mod wireguard;
pub mod zerotier;

/// Build a structured tracing span for a VPN connection (t3-e23).
///
/// Attach at VPN tunnel entry points so every log event emitted within
/// carries a `conn_id` field for correlation with orchestration traces.
#[inline]
pub fn conn_span(conn_id: &str) -> tracing::Span {
    tracing::info_span!(target: "sorng_vpn::conn", "conn", proto = "vpn", conn_id = %conn_id)
}
