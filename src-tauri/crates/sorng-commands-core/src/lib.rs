pub use sorng_app_domains::*;

#[path = "../../../src/agent_commands.rs"]
mod agent_commands;
#[path = "../../../src/anydesk_commands.rs"]
mod anydesk_commands;
#[path = "../../../src/app_auth_commands.rs"]
mod app_auth_commands;
#[allow(dead_code)]
#[path = "../../../src/app_shell_commands.rs"]
mod app_shell_commands;
#[path = "../../../src/aws_commands.rs"]
mod aws_commands;
#[path = "../../../src/biometrics_commands.rs"]
mod biometrics_commands;
#[path = "../../../src/cert_auth_commands.rs"]
mod cert_auth_commands;
#[path = "../../../src/cert_gen_commands.rs"]
mod cert_gen_commands;
#[path = "../../../src/chaining_commands.rs"]
mod chaining_commands;
#[path = "../../../src/cloudflare_commands.rs"]
mod cloudflare_commands;
#[path = "../../../src/commander_commands.rs"]
mod commander_commands;
#[path = "../../../src/db_commands.rs"]
mod db_commands;
#[path = "../../../src/ftp_commands.rs"]
mod ftp_commands;
#[path = "../../../src/http_commands.rs"]
mod http_commands;
#[path = "../../../src/legacy_crypto_commands.rs"]
mod legacy_crypto_commands;
#[path = "../../../src/meshcentral_commands.rs"]
mod meshcentral_commands;
#[path = "../../../src/network_commands.rs"]
mod network_commands;
#[path = "../../../src/openvpn_commands.rs"]
mod openvpn_commands;
#[path = "../../../src/passkey_commands.rs"]
mod passkey_commands;
#[path = "../../../src/proxy_commands.rs"]
mod proxy_commands;
#[path = "../../../src/qr_commands.rs"]
mod qr_commands;
#[path = "../../../src/raw_socket_commands.rs"]
mod raw_socket_commands;
#[cfg(not(feature = "rdp"))]
#[path = "../../../src/rdp.rs"]
mod rdp_commands;
#[cfg(feature = "rdp")]
#[path = "../../../src/rdp_commands.rs"]
mod rdp_commands;
#[path = "../../../src/rlogin_commands.rs"]
mod rlogin_commands;
#[path = "../../../src/rpc_commands.rs"]
mod rpc_commands;
#[path = "../../../src/security_commands.rs"]
mod security_commands;
#[path = "../../../src/serial_commands.rs"]
mod serial_commands;
#[path = "../../../src/storage_commands.rs"]
mod storage_commands;
#[path = "../../../src/tailscale_commands.rs"]
mod tailscale_commands;
#[path = "../../../src/telnet_commands.rs"]
mod telnet_commands;
#[path = "../../../src/totp_commands.rs"]
mod totp_commands;
#[path = "../../../src/trust_store_commands.rs"]
mod trust_store_commands;
#[path = "../../../src/vault_commands.rs"]
mod vault_commands;
#[path = "../../../src/vercel_commands.rs"]
mod vercel_commands;
#[path = "../../../src/vnc_commands.rs"]
mod vnc_commands;
#[path = "../../../src/wireguard_commands.rs"]
mod wireguard_commands;
#[path = "../../../src/wmi_commands.rs"]
mod wmi_commands;
#[path = "../../../src/wol_commands.rs"]
mod wol_commands;
#[path = "../../../src/zerotier_commands.rs"]
mod zerotier_commands;

#[path = "../../../src/ssh_commands.rs"]
mod ssh_commands;

#[allow(dead_code)]
#[path = "../../../src/event_bridge.rs"]
pub(crate) mod event_bridge;
#[allow(dead_code)]
#[path = "../../../src/splash.rs"]
mod splash;

mod core_handler;

pub fn is_command(command: &str) -> bool {
    core_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    core_handler::build()
}
