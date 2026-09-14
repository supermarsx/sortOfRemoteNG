pub use sorng_app_domains::*;

mod dropbox_commands;
mod gdrive_commands;
mod mremoteng_dedicated_commands;
mod nextcloud_commands;
mod onedrive_commands;
mod termserv_commands;
mod whatsapp_commands;

mod collab_handler;

pub fn is_command(command: &str) -> bool {
    collab_handler::is_command(command)
}

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(collab_handler::build())
}
