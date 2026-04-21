pub use sorng_app_domains::*;

mod dropbox_commands;
mod gdrive_commands;
mod mremoteng_dedicated_commands;
mod nextcloud_commands;
mod onedrive_commands;
mod telegram_commands;
mod termserv_commands;
mod whatsapp_commands;

mod collab_handler;

pub fn is_command(command: &str) -> bool {
    collab_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    collab_handler::build()
}
