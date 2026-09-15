pub use sorng_draytek as draytek;
pub use sorng_fail2ban as fail2ban;
pub use sorng_pfsense as pfsense;
pub use sorng_port_knock as port_knock;

mod draytek_commands;
mod fail2ban_commands;
mod handler;
mod pfsense_commands;
mod port_knock_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
