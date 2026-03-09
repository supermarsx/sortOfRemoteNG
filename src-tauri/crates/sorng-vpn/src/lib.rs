//! # SortOfRemote NG – VPN
//!
//! VPN services (OpenVPN, WireGuard, ZeroTier, Tailscale), proxy management,
//! and connection chaining/routing.

pub mod chaining;
pub mod openvpn;
pub mod proxy;
pub mod tailscale;
pub mod wireguard;
pub mod zerotier;
