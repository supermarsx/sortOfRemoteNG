pub use sorng_app_domains::*;

#[path = "../../../src/backup_commands.rs"]
mod backup_commands;
#[path = "../../../src/bitwarden_commands.rs"]
mod bitwarden_commands;
#[path = "../../../src/digital_ocean_commands.rs"]
mod digital_ocean_commands;
#[path = "../../../src/keepass_commands.rs"]
mod keepass_commands;
#[path = "../../../src/passbolt_commands.rs"]
mod passbolt_commands;
#[path = "../../../src/rustdesk_commands.rs"]
mod rustdesk_commands;
#[path = "../../../src/scp_commands.rs"]
mod scp_commands;
#[path = "../../../src/sftp_commands.rs"]
mod sftp_commands;
#[allow(dead_code)]
#[path = "../../../src/app_shell_commands.rs"]
mod app_shell_commands;

mod access_handler;

pub fn is_command(command: &str) -> bool {
    access_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    access_handler::build()
}
