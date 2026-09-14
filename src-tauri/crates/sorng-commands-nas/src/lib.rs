pub use sorng_synology as synology;

mod handler;
mod synology_commands;

#[cfg(test)]
mod synology_dispatch_tests;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
