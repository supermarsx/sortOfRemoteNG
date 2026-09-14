pub use sorng_meshcentral::meshcentral as meshcentral_dedicated;
pub use sorng_voip_phone as voip_phone;

mod handler;
mod meshcentral_dedicated_commands;
mod voip_phone_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
