pub use sorng_app_domains::*;

#[allow(dead_code)]
#[path = "../../../src/app_shell_commands.rs"]
mod app_shell_commands;
#[path = "../../../src/bitwarden_commands.rs"]
mod bitwarden_commands;
#[path = "../../../src/digital_ocean_commands.rs"]
mod digital_ocean_commands;
#[path = "../../../src/heroku_commands.rs"]
mod heroku_commands;
#[path = "../../../src/ibm_commands.rs"]
mod ibm_commands;
#[path = "../../../src/keepass_commands.rs"]
mod keepass_commands;
#[path = "../../../src/linode_commands.rs"]
mod linode_commands;
#[path = "../../../src/ovh_commands.rs"]
mod ovh_commands;
#[path = "../../../src/passbolt_commands.rs"]
mod passbolt_commands;
#[path = "../../../src/scaleway_commands.rs"]
mod scaleway_commands;
#[path = "../../../src/scp_commands.rs"]
mod scp_commands;

mod access_handler;

pub fn is_command(command: &str) -> bool {
    access_handler::is_command(command)
}

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(access_handler::build())
}
