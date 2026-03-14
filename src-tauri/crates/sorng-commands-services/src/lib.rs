pub use sorng_budibase as budibase;
pub use sorng_osticket as osticket;
pub use sorng_jira as jira;
pub use sorng_i18n as i18n;
pub use sorng_letsencrypt as letsencrypt;
pub use sorng_ssh_agent as ssh_agent;
pub use sorng_gpg_agent as gpg_agent;
pub use sorng_yubikey as yubikey;

// Use #[path] to reference the command files in the ops crate
#[path = "../../sorng-commands-ops/src/budibase_commands.rs"]
mod budibase_commands;
#[path = "../../sorng-commands-ops/src/osticket_commands.rs"]
mod osticket_commands;
#[path = "../../sorng-commands-ops/src/jira_commands.rs"]
mod jira_commands;
#[path = "../../sorng-commands-ops/src/i18n_commands.rs"]
mod i18n_commands;
#[path = "../../sorng-commands-ops/src/letsencrypt_commands.rs"]
mod letsencrypt_commands;
#[path = "../../sorng-commands-ops/src/ssh_agent_commands.rs"]
mod ssh_agent_commands;
#[path = "../../sorng-commands-ops/src/gpg_agent_commands.rs"]
mod gpg_agent_commands;
#[path = "../../sorng-commands-ops/src/yubikey_commands.rs"]
mod yubikey_commands;

mod services_handler;

pub fn is_command(command: &str) -> bool {
    services_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    services_handler::build()
}
