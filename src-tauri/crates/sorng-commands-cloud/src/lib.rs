pub use sorng_app_domains::*;

mod azure_commands;
mod exchange_commands;
mod gcp_commands;
mod hetzner_commands;
mod oracle_cloud_commands;
mod powershell_commands;
mod smtp_commands;

mod cloud_handler;

pub fn is_command(command: &str) -> bool {
    cloud_handler::is_command(command)
}

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(cloud_handler::build())
}
