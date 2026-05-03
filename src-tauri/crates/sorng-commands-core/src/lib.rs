pub use sorng_app_domains::*;

#[cfg(all(feature = "opkssh", not(feature = "ops")))]
pub use sorng_opkssh as opkssh;

// t5-e7: connection clone command (in-crate module, not an `include!` shim)
pub mod connection_clone_cmds;

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
#[cfg(feature = "ops")]
#[path = "../../../src/backup_verify_commands.rs"]
mod backup_verify_commands;
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
#[cfg(feature = "ops")]
#[path = "../../../src/consul_commands.rs"]
mod consul_commands;
#[path = "../../../src/cryptojs_compat_commands.rs"]
mod cryptojs_compat_commands;
#[path = "../../../src/db_commands.rs"]
mod db_commands;
#[cfg(feature = "ops")]
#[path = "../../../src/docker_compose_commands.rs"]
mod docker_compose_commands;
#[cfg(feature = "ops")]
#[path = "../../../src/etcd_commands.rs"]
mod etcd_commands;
#[path = "../../../src/ftp_commands.rs"]
mod ftp_commands;
#[path = "../../../src/http_commands.rs"]
mod http_commands;
#[path = "../../../src/ikev2_commands.rs"]
mod ikev2_commands;
#[path = "../../../src/ipsec_commands.rs"]
mod ipsec_commands;
#[path = "../../../src/l2tp_commands.rs"]
mod l2tp_commands;
#[path = "../../../src/legacy_crypto_commands.rs"]
mod legacy_crypto_commands;
#[path = "../../../src/meshcentral_commands.rs"]
mod meshcentral_commands;
#[path = "../../../src/network_commands.rs"]
mod network_commands;
#[path = "../../../src/openvpn_commands.rs"]
mod openvpn_commands;
#[path = "../../../src/openvpn_dedicated_commands.rs"]
mod openvpn_dedicated_commands;
#[cfg(feature = "opkssh")]
#[path = "../../../src/opkssh_commands.rs"]
mod opkssh_commands;
#[path = "../../../src/passkey_commands.rs"]
mod passkey_commands;
#[cfg(feature = "ops")]
#[path = "../../../src/powershell_commands.rs"]
mod powershell_commands;
#[path = "../../../src/pptp_commands.rs"]
mod pptp_commands;
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
#[path = "../../../src/rustdesk_commands.rs"]
mod rustdesk_commands;
#[path = "../../../src/security_commands.rs"]
mod security_commands;
#[path = "../../../src/serial_commands.rs"]
mod serial_commands;
#[path = "../../../src/sftp_commands.rs"]
mod sftp_commands;
#[path = "../../../src/smb_commands.rs"]
mod smb_commands;
#[cfg(feature = "vpn-softether")]
#[path = "../../../src/softether_commands.rs"]
mod softether_commands;
#[path = "../../../src/sstp_commands.rs"]
mod sstp_commands;
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
// ── t3-e55: remote-display protocols ───────────────────────────────
#[path = "../../../src/ard_commands.rs"]
mod ard_commands;
#[path = "../../../src/nx_commands.rs"]
mod nx_commands;
#[path = "../../../src/spice_commands.rs"]
mod spice_commands;
#[path = "../../../src/wireguard_commands.rs"]
mod wireguard_commands;
#[path = "../../../src/wmi_commands.rs"]
mod wmi_commands;
#[path = "../../../src/wol_commands.rs"]
mod wol_commands;
#[path = "../../../src/x2go_commands.rs"]
mod x2go_commands;
#[path = "../../../src/xdmcp_commands.rs"]
mod xdmcp_commands;
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
