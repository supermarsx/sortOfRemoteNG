//! VPN command compiler boundary. Service definitions stay in their original crates.

// These are aliases to the same concrete service types managed by app startup,
// not duplicate module definitions: Tauri managed state is keyed by TypeId.
#[cfg(feature = "vpn-softether")]
pub use sorng_vpn::softether;
pub use sorng_vpn::{
    chaining, ikev2, ipsec, l2tp, openvpn, pptp, proxy, sstp, tailscale, vpn_lifecycle, wireguard,
    zerotier,
};

mod chaining_commands;
mod ikev2_commands;
mod ipsec_commands;
mod l2tp_commands;
mod openvpn_commands;
mod openvpn_dedicated_commands;
mod pptp_commands;
mod proxy_commands;
#[cfg(feature = "vpn-softether")]
mod softether_commands;
mod sstp_commands;
mod tailscale_commands;
mod wireguard_commands;
mod zerotier_commands;

mod handler;
pub use handler::COMMAND_NAMES;

pub fn is_command(command: &str) -> bool {
    handler::is_command(command)
}

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}

#[cfg(test)]
mod dispatch_tests;
