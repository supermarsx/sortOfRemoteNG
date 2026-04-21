pub use sorng_app_domains::*;

mod ai_assist_commands;
mod ansible_commands;
mod command_palette_commands;
mod docker_commands;
mod docker_compose_commands;
mod extensions_commands;
mod fonts_commands;
mod k8s_commands;
mod llm_commands;
mod recording_commands;
mod secure_clip_commands;
mod terminal_themes_commands;
mod terraform_commands;

mod platform_handler;

pub fn is_command(command: &str) -> bool {
    platform_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    platform_handler::build()
}
