pub use sorng_app_domains::*;

mod azure_commands;
mod exchange_commands;
mod gcp_commands;
mod hetzner_commands;
mod powershell_commands;
mod smtp_commands;

mod cloud_handler;

pub fn is_command(command: &str) -> bool {
    cloud_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    cloud_handler::build()
}
