pub use sorng_idrac as idrac;
pub use sorng_ilo as ilo;
pub use sorng_lenovo as lenovo;
pub use sorng_supermicro as supermicro;

mod handler;
mod idrac_commands;
mod ilo_commands;
mod lenovo_commands;
mod supermicro_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
