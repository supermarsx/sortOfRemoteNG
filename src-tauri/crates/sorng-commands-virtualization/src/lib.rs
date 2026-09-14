pub use sorng_hyperv as hyperv;
pub use sorng_vmware as vmware;

mod handler;
mod hyperv_commands;
mod vmware_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
