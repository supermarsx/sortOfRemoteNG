pub use sorng_freeipa as freeipa;
pub use sorng_hashicorp_vault as hashicorp_vault;
pub use sorng_mac as mac_mgmt;
pub use sorng_pam as pam;

mod freeipa_commands;
mod handler;
mod hashicorp_vault_commands;
mod mac_mgmt_commands;
mod pam_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
