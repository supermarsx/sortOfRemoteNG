pub use sorng_cpanel as cpanel;
pub use sorng_php as php_mgmt;

mod cpanel_commands;
mod handler;
mod php_mgmt_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
