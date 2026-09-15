pub use sorng_mysql_admin as mysql_admin;
pub use sorng_postgres_admin as pg_admin;

mod handler;
mod mysql_admin_commands;
mod pg_admin_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
