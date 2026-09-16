pub use sorng_app_domains::*;
pub use sorng_llm as llm;
pub use sorng_telegram as telegram;

#[path = "../../../src/llm_commands.rs"]
mod llm_commands;
// Shared with the startup mock-runtime regression; no optional platform graph.
#[doc(hidden)]
pub mod llm_handler;

#[path = "../../../src/telegram_commands.rs"]
mod telegram_commands;
#[doc(hidden)]
pub mod telegram_handler;

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
#[path = "../../../src/app_settings_commands.rs"]
#[doc(hidden)]
pub mod app_settings_commands;
#[allow(dead_code)]
#[path = "../../../src/app_shell_commands.rs"]
mod app_shell_commands;
#[path = "../../../src/artifact_encryption_commands.rs"]
mod artifact_encryption_commands;
#[doc(hidden)]
pub mod artifact_handler;
#[path = "../../../src/artifact_storage_adapters.rs"]
mod artifact_storage_adapters;
#[path = "../../../src/cpu_commands.rs"]
mod cpu_commands;
#[path = "../../../src/database_files.rs"]
mod database_files;
#[path = "../../../src/database_protection.rs"]
pub mod database_protection;
#[path = "../../../src/encryption_rotation_commands.rs"]
mod encryption_rotation_commands;
// The enum + resolver are only consumed by the middleware in the main
// app crate; from the core-commands crate's perspective only the static
// metadata is read by `api_capability_commands::get_api_capabilities`.
#[allow(dead_code)]
#[path = "../../../src/api_capability.rs"]
mod api_capability;
#[path = "../../../src/api_capability_commands.rs"]
pub mod api_capability_commands;
// t41-e6: REST API server lifecycle controller + commands. `pub` so the main
// app crate (`state_registry`) can register the *same concrete*
// `ApiServerController` / `ApiServerLauncher` type these commands read from
// Tauri state — state is keyed by `TypeId`, so a same-named type from the app
// crate would be invisible here (same reason as `DisabledCapsSetter`).
#[path = "../../../src/api_server_commands.rs"]
pub mod api_server_commands;
#[path = "../../../src/aws_commands.rs"]
mod aws_commands;
#[path = "../../../src/backup_commands.rs"]
mod backup_commands;
#[cfg(feature = "ops")]
#[path = "../../../src/backup_verify_commands.rs"]
mod backup_verify_commands;
#[path = "../../../src/biometrics_commands.rs"]
mod biometrics_commands;
#[path = "../../../src/cert_auth_commands.rs"]
mod cert_auth_commands;
#[path = "../../../src/cert_gen_commands.rs"]
mod cert_gen_commands;
#[path = "../../../src/cloudflare_commands.rs"]
mod cloudflare_commands;
#[path = "../../../src/commander_commands.rs"]
mod commander_commands;
#[path = "../../../src/cryptojs_compat_commands.rs"]
mod cryptojs_compat_commands;
#[path = "../../../src/db_commands.rs"]
mod db_commands;
#[path = "../../../src/ftp_commands.rs"]
mod ftp_commands;
#[path = "../../../src/http_commands.rs"]
mod http_commands;
#[path = "../../../src/https_trust_commands.rs"]
mod https_trust_commands;
#[path = "../../../src/legacy_crypto_commands.rs"]
mod legacy_crypto_commands;
#[path = "../../../src/meshcentral_commands.rs"]
mod meshcentral_commands;
#[path = "../../../src/network_commands.rs"]
mod network_commands;
#[cfg(all(feature = "opkssh", not(feature = "ops")))]
#[path = "../../../src/opkssh_commands.rs"]
mod opkssh_commands;
#[path = "../../../src/passkey_commands.rs"]
mod passkey_commands;
#[cfg(feature = "ops")]
#[path = "../../../src/powershell_commands.rs"]
mod powershell_commands;
#[cfg(feature = "ops")]
#[path = "../../../src/powershell_session_commands.rs"]
mod powershell_session_commands;
#[path = "../../../src/qr_commands.rs"]
mod qr_commands;
#[path = "../../../src/raw_socket_commands.rs"]
pub mod raw_socket_commands;
#[cfg(not(feature = "rdp"))]
#[path = "../../../src/rdp.rs"]
mod rdp_commands;
#[cfg(feature = "rdp")]
#[path = "../../../src/rdp_commands.rs"]
mod rdp_commands;
#[path = "../../../src/rlogin_commands.rs"]
pub mod rlogin_commands;
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
#[path = "../../../src/storage_commands.rs"]
mod storage_commands;
#[path = "../../../src/telnet_commands.rs"]
mod telnet_commands;
#[path = "../../../src/totp_commands.rs"]
mod totp_commands;
#[path = "../../../src/trust_store_commands.rs"]
mod trust_store_commands;
/// The production force-cleanup handlers, separately composable for isolated IPC fixtures.
pub fn build_force_delete_trust_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    trust_store_commands::build_force_delete()
}
mod updater_commands;
#[path = "../../../src/vault_commands.rs"]
mod vault_commands;
#[path = "../../../src/vercel_commands.rs"]
mod vercel_commands;
#[path = "../../../src/vnc_commands.rs"]
mod vnc_commands;
#[path = "../../../src/xlsx_crypto_commands.rs"]
mod xlsx_crypto_commands;
// ── t3-e55: remote-display protocols ───────────────────────────────
#[path = "../../../src/ard_commands.rs"]
mod ard_commands;
#[path = "../../../src/nx_commands.rs"]
mod nx_commands;
#[path = "../../../src/spice_commands.rs"]
mod spice_commands;
#[path = "../../../src/wmi_commands.rs"]
mod wmi_commands;
#[path = "../../../src/wol_commands.rs"]
mod wol_commands;
#[path = "../../../src/x2go_commands.rs"]
mod x2go_commands;
#[path = "../../../src/xdmcp_commands.rs"]
mod xdmcp_commands;

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

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    core_handler::build()
}
