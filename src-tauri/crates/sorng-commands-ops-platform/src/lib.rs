pub use sorng_about as about;
pub use sorng_cups as cups;
pub use sorng_netbox as netbox;
pub use sorng_remote_backup as remote_backup;

mod about_commands;
mod cups_commands;
mod handler;
mod netbox_commands;
mod remote_backup_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
