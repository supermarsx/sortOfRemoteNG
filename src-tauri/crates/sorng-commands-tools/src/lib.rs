pub use sorng_warpgate as warpgate;
pub use sorng_opkssh as opkssh;
pub use sorng_ssh_scripts as ssh_scripts;
pub use sorng_mcp as mcp_server;
pub use sorng_snmp as snmp;
pub use sorng_dashboard as dashboard;
pub use sorng_hooks as hooks;
pub use sorng_notifications as notifications;
pub use sorng_topology as topology;
pub use sorng_filters as filters;
pub use sorng_credentials as credentials;
pub use sorng_replay as replay;
pub use sorng_rdpfile as rdpfile;
pub use sorng_updater as updater;
pub use sorng_marketplace as marketplace;
pub use sorng_portable as portable;
pub use sorng_scheduler as scheduler;

// Use #[path] to reference the command files in the ops crate
#[path = "../../sorng-commands-ops/src/warpgate_commands.rs"]
mod warpgate_commands;
#[path = "../../sorng-commands-ops/src/opkssh_commands.rs"]
mod opkssh_commands;
#[path = "../../sorng-commands-ops/src/ssh_scripts_commands.rs"]
mod ssh_scripts_commands;
#[path = "../../sorng-commands-ops/src/mcp_server_commands.rs"]
mod mcp_server_commands;
#[path = "../../sorng-commands-ops/src/snmp_commands.rs"]
mod snmp_commands;
#[path = "../../sorng-commands-ops/src/dashboard_commands.rs"]
mod dashboard_commands;
#[path = "../../sorng-commands-ops/src/hooks_commands.rs"]
mod hooks_commands;
#[path = "../../sorng-commands-ops/src/notifications_commands.rs"]
mod notifications_commands;
#[path = "../../sorng-commands-ops/src/topology_commands.rs"]
mod topology_commands;
#[path = "../../sorng-commands-ops/src/filters_commands.rs"]
mod filters_commands;
#[path = "../../sorng-commands-ops/src/credentials_commands.rs"]
mod credentials_commands;
#[path = "../../sorng-commands-ops/src/replay_commands.rs"]
mod replay_commands;
#[path = "../../sorng-commands-ops/src/rdpfile_commands.rs"]
mod rdpfile_commands;
#[path = "../../sorng-commands-ops/src/updater_commands.rs"]
mod updater_commands;
#[path = "../../sorng-commands-ops/src/marketplace_commands.rs"]
mod marketplace_commands;
#[path = "../../sorng-commands-ops/src/portable_commands.rs"]
mod portable_commands;
#[path = "../../sorng-commands-ops/src/scheduler_commands.rs"]
mod scheduler_commands;

mod tools_handler;

pub fn is_command(command: &str) -> bool {
    tools_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tools_handler::build()
}
